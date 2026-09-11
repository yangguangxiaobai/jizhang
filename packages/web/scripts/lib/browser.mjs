/**
 * Shared headless-browser driver for the frontend checks.
 *
 * ## Why this exists
 *
 * HTTP assertions cannot tell the difference between "the API returns the right numbers"
 * and "the page renders them". This drives a real Chrome over the DevTools protocol:
 * log in over the API, set the session cookie, load a route, then read and measure the
 * DOM. The static audit in `check-mobile.mjs` reads CSS *source* and cannot see a
 * computed size, a wrapped label, or a sentence assembled from template fragments; this
 * is where those get verified as facts.
 *
 * Extracted so the dashboard and the recycle bin share one driver instead of diverging
 * copies — a second hand-rolled copy is how the two checks would start disagreeing about
 * what "44px" or "offline" means.
 *
 * ## Two traps baked in
 *
 * - **`spawn(..., { stdio: 'ignore' })` is deliberate.** The sandbox cannot open named
 *   pipes, so capturing a child's output through a pipe fails with EPERM.
 * - **The profile directory must be removable.** Chrome caches aggressively in a
 *   `--user-data-dir`; reusing one across runs can serve a previous build and report the
 *   old DOM, which is a silent false result. `profileDir` is deleted on `close()`.
 */

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Tall enough to be a real phone; the width is what the layout rules are about. */
export const PHONE_VIEWPORT = { width: 375, height: 812 };

export function makeChecker() {
  let failures = 0;
  const check = (label, ok, detail = '') => {
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
    if (!ok) failures += 1;
  };
  return {
    check,
    get failures() {
      return failures;
    },
    finish(suiteName) {
      console.log(
        `\n${failures === 0 ? `ALL ${suiteName} CHECKS PASSED` : `${failures} ${suiteName} CHECK(S) FAILED`}`,
      );
      if (failures > 0) process.exitCode = 1;
      return failures;
    },
  };
}

/**
 * Logs in over the API and returns the session cookie pair.
 *
 * Doing the login over HTTP rather than by driving the form keeps the browser part
 * focused on rendering, and it means a login regression shows up in the API suites
 * rather than as a confusing "the dashboard is blank" here.
 */
async function loginOverHttp(origin, username, password) {
  const response = await fetch(`${origin}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'X-Requested-With': 'fetch', 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (response.status !== 200) {
    throw new Error(`login failed: ${response.status} ${await response.text()}`);
  }
  const cookie = (response.headers.getSetCookie?.() ?? [])
    .find((entry) => entry.startsWith('jizhang_session='))
    ?.split(';')[0];
  if (cookie === undefined) throw new Error('no session cookie in the login response');
  return cookie;
}

/**
 * True when `status === 0` / the request never reached the server.
 *
 * `ConnectionResetError` and `ECONNREFUSED` surface differently per platform, so this
 * treats any throw as "not listening yet".
 */
async function serverIsUp(origin, attempts = 40) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`${origin}/api/v1/health`);
      if (response.ok) return true;
    } catch {
      // not up yet
    }
    await sleep(250);
  }
  return false;
}

/**
 * Starts a browser session against `origin` and returns a driver.
 *
 * @param {object} options
 * @param {string} options.origin          e.g. `http://127.0.0.1:8081`
 * @param {string} [options.profileDir]    Chrome profile; deleted on close
 * @param {number} [options.port]          DevTools port
 * @param {string} [options.username]
 * @param {string} [options.password]
 */
export async function openBrowser({
  origin,
  profileDir,
  port = 9222,
  username = process.env.JIZHANG_E2E_USER ?? 'admin',
  password = process.env.JIZHANG_E2E_PASSWORD ?? 'probe-password',
}) {
  const debugOrigin = `http://127.0.0.1:${port}`;
  const sessionCookie = await loginOverHttp(origin, username, password);

  const chromePath = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
  if (chromePath === undefined) throw new Error('no Chrome/Edge binary found');

  const resolvedProfile = profileDir ?? `${process.env.TEMP ?? '/tmp'}/jizhang-cdp-profile`;
  // A stale profile can serve the previous build out of the HTTP cache.
  rmSync(resolvedProfile, { recursive: true, force: true });

  // `stdio: 'ignore'`: the sandbox cannot open named pipes, so a piped child fails with
  // EPERM. Progress is judged from the page, not from the browser's log.
  const chrome = spawn(
    chromePath,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--remote-debugging-port=${port}`,
      `--window-size=${PHONE_VIEWPORT.width},${PHONE_VIEWPORT.height}`,
      `--user-data-dir=${resolvedProfile}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  let version;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${debugOrigin}/json/version`);
      if (response.ok) {
        version = await response.json();
        break;
      }
    } catch {
      // not up yet
    }
    await sleep(250);
  }
  if (version === undefined) throw new Error('DevTools endpoint never became available');

  const targets = await (await fetch(`${debugOrigin}/json/list`)).json();
  const page = targets.find((target) => target.type === 'page');
  if (page === undefined) throw new Error('no page target');

  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  let nextId = 0;
  const pending = new Map();
  /** Runtime errors the page emitted, so a broken bundle cannot pass unnoticed. */
  const consoleErrors = [];

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== undefined) {
      const entry = pending.get(message.id);
      if (entry !== undefined) {
        pending.delete(message.id);
        entry(message);
      }
      return;
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      consoleErrors.push(message.params.args.map((a) => a.value ?? a.description).join(' '));
    }
    if (message.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(
        message.params.exceptionDetails?.exception?.description ?? 'uncaught exception',
      );
    }
  });

  function send(method, params = {}) {
    const id = (nextId += 1);
    return new Promise((resolve, reject) => {
      pending.set(id, (message) => {
        if (message.error !== undefined) reject(new Error(`${method}: ${message.error.message}`));
        else resolve(message.result);
      });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');
  await send('DOM.enable');
  await send('CSS.enable');
  await send('Network.setCookie', {
    name: 'jizhang_session',
    value: sessionCookie.slice('jizhang_session='.length),
    domain: new URL(origin).hostname,
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
  });

  /**
   * Evaluates an expression in the page.
   *
   * Surfaces page-side throws: without this a failing expression comes back as
   * `undefined` and shows up later as a confusing "cannot read properties of undefined".
   */
  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    const details = result.exceptionDetails;
    if (details !== undefined) {
      throw new Error(`page evaluation failed: ${details.exception?.description ?? details.text}`);
    }
    return result.result?.value;
  }

  /** Navigates and waits until `markers` all appear, or gives up. */
  async function navigateAndWait(path, markers, { attempts = 40, delay = 250 } = {}) {
    await send('Page.navigate', { url: `${origin}${path}` });
    let text = '';
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      await sleep(delay);
      text = (await evaluate('document.body.innerText')) ?? '';
      if (markers.every((marker) => text.includes(marker))) return text;
    }
    return text;
  }

  /** Applies the phone viewport, so measurements describe the real device width. */
  async function usePhoneViewport() {
    await send('Emulation.setDeviceMetricsOverride', {
      ...PHONE_VIEWPORT,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await sleep(400);
  }

  /**
   * Measures the rendered layout.
   *
   * Kept as a named function serialised with `toString()` rather than an inline template
   * literal: the page code contains backticks, quotes and `${}`, and embedding that in a
   * template string is a quoting trap that already cost a debugging round.
   */
  async function measureLayout() {
    function measure() {
      const interactive = Array.from(
        document.querySelectorAll('button, a, input, select, textarea'),
      );
      const rect = (el) => {
        const r = el.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height) };
      };
      return {
        docWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        interactiveCount: interactive.length,
        smallTargets: interactive
          .map((el) => ({
            tag: el.tagName,
            text: (el.innerText || el.name || '').trim().slice(0, 14),
            ...rect(el),
          }))
          // Zero-height elements are hidden, not small.
          .filter((t) => t.h > 0 && t.h < 44),
        tabs: Array.from(document.querySelectorAll('.tabbar .tab')).map((tab) => {
          const lines = (tab.innerText || '')
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean);
          return { label: lines[lines.length - 1] || '', ...rect(tab) };
        }),
      };
    }
    return evaluate(`(${measure.toString()})()`);
  }

  /** Stops the app container — the only honest way to test "server unreachable". */
  function stopServer(service = 'jizhang') {
    try {
      execFileSync('docker', ['compose', 'stop', service], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Records every CSS animation that *starts*, from inside the page.
   *
   * Sampling `document.getAnimations()` after navigating cannot see this app's motion: the
   * longest arrival is 320ms and the navigation wait alone sleeps 250ms, so by the time an
   * assertion runs the animations have finished and been discarded — a suite built that way
   * would pass on a page with no animation at all. Listening for `animationstart` via
   * `Page.addScriptToEvaluateOnNewDocument` catches them as they begin, on every document,
   * and is immune to how long the test takes to look.
   */
  async function installMotionRecorder() {
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => {
        window.__motion = [];
        // Keyframe metadata that is not an animated property.
        const META = ['offset', 'computedOffset', 'easing', 'composite'];
        document.addEventListener(
          'animationstart',
          (event) => {
            const target = event.target;
            const className =
              typeof target.className === 'string'
                ? target.className
                : (target.className && target.className.baseVal) || '';
            // Read the properties the engine actually built the animation from, at the
            // moment it starts. This is what makes "no layout property is animated" a
            // measured fact rather than a claim about the stylesheet's text.
            let properties = [];
            try {
              const animation = target
                .getAnimations()
                .find((candidate) => candidate.animationName === event.animationName);
              const frames = animation ? animation.effect.getKeyframes() : [];
              const keys = new Set();
              for (const frame of frames) {
                for (const key of Object.keys(frame)) {
                  if (!META.includes(key)) keys.add(key);
                }
              }
              properties = [...keys];
            } catch {
              properties = [];
            }
            window.__motion.push({
              name: event.animationName,
              tag: target.tagName.toLowerCase(),
              className: String(className).slice(0, 60),
              properties,
              // The *computed* timing function, read from the element that is animating.
              // The Web Animations API reports a CSS animation's effect-level easing as
              // 'linear' and keeps the real curve on the keyframes, so reading it from
              // there reports 'linear' for every animation in the app.
              easing: getComputedStyle(target).animationTimingFunction,
              at: Math.round(performance.now()),
            });
          },
          true,
        );
      })();`,
    });
  }

  /** Every animation that has started in the current document. */
  async function readMotionLog() {
    return (await evaluate('window.__motion ?? []')) ?? [];
  }

  /**
   * Makes the browser report a different `prefers-reduced-motion`.
   *
   * The only way to test the reduced-motion path without a second machine, and the whole
   * reason the contract is worth having: a claim about what a setting does, that nothing
   * ever exercises, is a comment.
   */
  async function emulateReducedMotion(enabled) {
    await send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: enabled ? 'reduce' : 'no-preference' }],
    });
  }

  /**
   * Applies a pseudo-class to an element without a pointer, and returns a handle.
   *
   * A press state cannot be produced by dispatching events: `:active` is browser-owned and
   * `element.click()` never sets it. `CSS.forcePseudoState` is the only way to ask "what
   * does this look like under a finger", and therefore the only way to verify that press
   * feedback exists at all.
   *
   * ## Release through the handle, never by re-resolving the selector
   *
   * `DOM.getDocument` **discards the node map**: two consecutive calls over an unchanged
   * page returned different ids for the same element (101/115, then 151/165). Forcing
   * `:active` on the first id and clearing on the second left the element *stuck* at the
   * pressed transform — measured, not inferred: `released` stayed at `matrix(0.97, …)`
   * for the next 500ms. The clear has to name the id the force used, so the handle owns
   * it and the caller never sees an id.
   */
  async function forcePseudoState(selector, pseudoClasses = ['active']) {
    const { root } = await send('DOM.getDocument', { depth: 1 });
    const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector });
    if (nodeId === 0 || nodeId === undefined) throw new Error(`no element matches ${selector}`);
    await send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: pseudoClasses });
    return {
      nodeId,
      release: () => send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] }),
    };
  }

  function startServer(service = 'jizhang') {
    try {
      execFileSync('docker', ['compose', 'start', service], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  async function screenshot(path) {
    const result = await send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
    });
    const { writeFileSync } = await import('node:fs');
    writeFileSync(path, Buffer.from(result.data, 'base64'));
  }

  return {
    browserVersion: version.Browser,
    send,
    evaluate,
    navigateAndWait,
    usePhoneViewport,
    measureLayout,
    stopServer,
    startServer,
    installMotionRecorder,
    readMotionLog,
    emulateReducedMotion,
    forcePseudoState,
    waitForServer: () => serverIsUp(origin),
    screenshot,
    consoleErrors,
    async close() {
      socket.close();
      chrome.kill();
      // Wait for the process to actually exit before touching its profile directory:
      // on Windows Chrome still holds Crashpad files open for a moment, and an
      // unhandled EBUSY here would mask the suite's own result line.
      await Promise.race([
        new Promise((resolve) => chrome.once('exit', resolve)),
        sleep(3_000),
      ]);
      try {
        rmSync(resolvedProfile, { recursive: true, force: true });
      } catch {
        // A locked profile directory is harmless: it is keyed per suite and wiped at
        // the start of the next run.
      }
    },
  };
}
