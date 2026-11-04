/**
 * Provider-reliability probe #1 (pure local, no network, no DB, no provider call).
 *
 * Question under review (Q1): is the stream-body deadline really the configured timeout
 * measured from the fetch, or is it multiplied / extended?
 *
 * Method: inject a fake `fetch` whose headers resolve immediately (or after a delay) and
 * whose body never completes, then drive the real `AiProviderService.openStream` +
 * `AiProviderStream` pipeline and measure wall-clock time to the timeout rejection.
 * A short configured timeout (800 ms) is used so the arithmetic is measurable without
 * waiting 20 s; the shape of the result is what matters (one configured budget, not two).
 */
import { AiProviderService, AiProviderStream } from '../../../../../packages/server/src/services/ai-provider-service.js';
import type { StoredAiProviderConfig } from '../../../../../packages/server/src/services/ai-types.js';

const encoder = new TextEncoder();

function stalledBody(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      // One valid delta then silence: closest local analog of the real 20.002 s case.
      controller.enqueue(encoder.encode(
        `data: ${JSON.stringify({ choices: [{ delta: { content: '{"message":"hel' } }] })}\n\n`,
      ));
      // never close
    },
  });
}

function neverBody(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    // headers arrive, body never produces anything and never closes
  });
}

function stubFetch(headersDelayMs: number, body: () => ReadableStream<Uint8Array>) {
  return async (_url: string, _init?: unknown): Promise<Response> => {
    if (headersDelayMs > 0) await new Promise((r) => setTimeout(r, headersDelayMs));
    return new Response(body(), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  };
}

const config: StoredAiProviderConfig = {
  version: 1,
  enabled: true,
  name: 'probe',
  mode: 'chat-completions',
  url: 'https://provider.example.test/v1/chat/completions',
  method: 'POST',
  model: 'probe-model',
  timeoutMs: 800,
  headers: {},
  auth: { kind: 'none' },
  bodyTemplate: null,
  responsePath: 'choices[0].message.content',
  encryptedSecret: null,
  updatedAt: 0,
};

const context = {
  input: 'probe',
  categories: [],
  accounts: [],
  model: 'probe-model',
  today: '2026-10-16',
  responseSchema: { type: 'object' },
};

interface Case {
  readonly name: string;
  readonly configuredTimeoutMs: number;
  readonly headersDelayMs: number;
  readonly bodyFactory: () => ReadableStream<Uint8Array>;
}

const cases: Case[] = [
  { name: 'headers immediate, body stalls after 1 delta', configuredTimeoutMs: 800, headersDelayMs: 0, bodyFactory: stalledBody },
  { name: 'headers immediate, body never produces', configuredTimeoutMs: 800, headersDelayMs: 0, bodyFactory: neverBody },
  { name: 'headers delayed 300ms, body stalls after 1 delta', configuredTimeoutMs: 800, headersDelayMs: 300, bodyFactory: stalledBody },
  { name: 'headers immediate, configured 400ms', configuredTimeoutMs: 400, headersDelayMs: 0, bodyFactory: stalledBody },
];

async function runProbe(testCase: Case): Promise<Record<string, unknown>> {
  const service = new AiProviderService(stubFetch(testCase.headersDelayMs, testCase.bodyFactory));
  const cfg = { ...config, timeoutMs: testCase.configuredTimeoutMs };
  const t0 = Date.now();
  const opened = await service.openStream(cfg, null, context);
  const tAfterHeaders = Date.now();
  if (opened === null) return { name: testCase.name, opened: false };
  let failure: { code?: string; message?: string } | null = null;
  let decodedChars = 0;
  try {
    const stream = new AiProviderStream(opened.body.getReader(), {
      step: 0,
      contentPath: opened.contentPath,
      streamTotalTimeoutMs: opened.streamTotalTimeoutMs,
      onDone: () => undefined,
      onError: () => undefined,
    });
    for (;;) {
      const chunk = await stream.next();
      if (chunk === null) break;
      decodedChars += chunk.length;
    }
  } catch (error) {
    const candidate = error as { code?: string; message?: string };
    failure = { code: candidate.code, message: candidate.message };
  } finally {
    opened.cancel?.();
    opened.dispose?.();
  }
  const totalMs = Date.now() - t0;
  return {
    name: testCase.name,
    configuredTimeoutMs: testCase.configuredTimeoutMs,
    headersDelayMs: testCase.headersDelayMs,
    reportedStreamTotalTimeoutMs: opened.streamTotalTimeoutMs,
    headersResolveMs: tAfterHeaders - t0,
    totalToTimeoutMs: totalMs,
    bodyPhaseMs: totalMs - (tAfterHeaders - t0),
    decodedChars,
    failureCode: failure?.code ?? null,
    failureMessage: failure?.message ?? null,
  };
}

const results: Array<Record<string, unknown>> = [];
for (const testCase of cases) results.push(await runProbe(testCase));
console.log(JSON.stringify({ configuredTimeoutMs: config.timeoutMs, results }, null, 2));
