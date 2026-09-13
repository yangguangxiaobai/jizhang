import { defineConfig, devices } from '@playwright/test';

/*
 * Real iPhone viewport and locale, in both engines, against an isolated in-process ledger
 * (see `e2e/fixtures.mjs` — every test owns its own HTTP listener and temp database, so
 * nothing here touches `.env`, `data/`, or the running container).
 *
 * `JIZHANG_E2E_CHANNEL=chrome` runs the Chromium project on the machine's installed Chrome
 * instead of the Playwright-downloaded build. This exists because `playwright install`
 * failed on this network (`Chrome for Testing … Download failure`), which made the whole
 * suite unrunnable even though it was the only layer able to check a real browser main flow.
 * Use it as a fallback, never as the default: it tests a different build than CI would, and
 * it cannot substitute for the WebKit project, which is the closest available proxy for the
 * iOS Safari the app actually ships to.
 */
const channel = process.env.JIZHANG_E2E_CHANNEL;
const engine = channel === undefined ? {} : { channel };

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  outputDir: './test-results',
  reporter: [['line'], ['html', { outputFolder: './playwright-report', open: 'never' }]],
  use: {
    ...devices['iPhone 13'],
    locale: 'zh-CN', timezoneId: 'Asia/Shanghai',
    trace: 'retain-on-failure', screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium-iphone', use: { browserName: 'chromium', viewport: { width: 375, height: 667 }, ...engine } },
    { name: 'webkit-iphone', use: { browserName: 'webkit', viewport: { width: 375, height: 667 }, ...engine } },
  ],
});
