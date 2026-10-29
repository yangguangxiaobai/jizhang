import { describe, expect, it } from 'vitest';
import { AssistantStreamError } from '../src/services/assistant-stream-types.js';
import { AssistantMessageJsonTokenizer } from '../src/services/assistant-stream-tokenizer.js';
import { AiProviderService, AiProviderStream } from '../src/services/ai-provider-service.js';

function envelope(message: string): string {
  return JSON.stringify({ message, toolCall: null });
}

function collect(): { text: () => string; chunks: string[]; onText: (text: string) => void } {
  const chunks: string[] = [];
  return { chunks, text: () => chunks.join(''), onText: (text: string) => chunks.push(text) };
}

describe('assistant message JSON tokenizer', () => {
  it('decodes the top-level message string incrementally, one character at a time', () => {
    const sink = collect();
    const tokenizer = new AssistantMessageJsonTokenizer({ maxMessageChars: 1_000, onText: sink.onText });
    const source = envelope('你好，世界');
    for (const character of source) tokenizer.push(character);
    const result = tokenizer.finish();
    expect(result.complete).toBe(true);
    expect(result.message).toBe('你好，世界');
    expect(sink.text()).toBe('你好，世界');
  });

  it('handles proper JSON escapes without emitting partial escapes', () => {
    const sink = collect();
    const tokenizer = new AssistantMessageJsonTokenizer({ maxMessageChars: 1_000, onText: sink.onText });
    const raw = '{"message":"a\\"b\\\\c\\/d\\n\\t\\u4f60\\u597d\\uD83D\\uDE00","toolCall":null}';
    for (let index = 0; index < raw.length; index += 1) tokenizer.push(raw[index] as string);
    tokenizer.finish();
    expect(sink.text()).toBe('a"b\\c/d\n\t你好😀');
  });

  it('never splits a surrogate pair, even across chunks', () => {
    const sink = collect();
    const tokenizer = new AssistantMessageJsonTokenizer({ maxMessageChars: 1_000, onText: sink.onText });
    tokenizer.push('{"message":"\\uD83D');
    expect(sink.text()).toBe('');
    tokenizer.push('\\uDE00","toolCall":null}');
    tokenizer.finish();
    expect(sink.text()).toBe('😀');
  });

  it('emits literal (non-escaped) characters as soon as they are complete', () => {
    const sink = collect();
    const tokenizer = new AssistantMessageJsonTokenizer({ maxMessageChars: 1_000, onText: sink.onText });
    tokenizer.push('{"message":"first ');
    expect(sink.text()).toBe('first ');
    tokenizer.push('second');
    expect(sink.text()).toBe('first second');
    tokenizer.push('","toolCall":null}');
    tokenizer.finish();
  });

  it('rejects a lone surrogate', () => {
    const tokenizer = new AssistantMessageJsonTokenizer({ maxMessageChars: 1_000 });
    expect(() => tokenizer.push('{"message":"\\uD83D\\u0041","toolCall":null}')).toThrow(AssistantStreamError);
  });

  it('rejects duplicate top-level keys', () => {
    const tokenizer = new AssistantMessageJsonTokenizer({ maxMessageChars: 1_000 });
    expect(() => tokenizer.push('{"message":"a","message":"b","toolCall":null}')).toThrow(AssistantStreamError);
  });

  it('rejects nesting beyond the depth bound', () => {
    const tokenizer = new AssistantMessageJsonTokenizer({ maxMessageChars: 1_000 });
    const deep = `${'{"a":'.repeat(40)}null${'}'.repeat(40)}`;
    expect(() => tokenizer.push(deep)).toThrow(AssistantStreamError);
  });

  it('rejects a message that exceeds the decoded character bound', () => {
    const tokenizer = new AssistantMessageJsonTokenizer({ maxMessageChars: 4 });
    expect(() => tokenizer.push('{"message":"12345')).toThrow(AssistantStreamError);
  });

  it('rejects truncated envelopes at finish()', () => {
    const tokenizer = new AssistantMessageJsonTokenizer({ maxMessageChars: 1_000 });
    tokenizer.push('{"message":"hello"');
    expect(() => tokenizer.finish()).toThrow(AssistantStreamError);
  });

  it('rejects a missing top-level message member', () => {
    const tokenizer = new AssistantMessageJsonTokenizer({ maxMessageChars: 1_000 });
    tokenizer.push('{"toolCall":null}');
    expect(() => tokenizer.finish()).toThrow(AssistantStreamError);
  });

  it('rejects malformed numbers and stray text', () => {
    expect(() => new AssistantMessageJsonTokenizer({ maxMessageChars: 100 }).push('{"n":01,"message":"x"}')).toThrow(AssistantStreamError);
    expect(() => new AssistantMessageJsonTokenizer({ maxMessageChars: 100 }).push('nope')).toThrow(AssistantStreamError);
  });
});

describe('tokenizer empty containers and trailing commas', () => {
  function run(raw: string, chunked = false): string {
    const tokenizer = new AssistantMessageJsonTokenizer({ maxMessageChars: 4_000 });
    if (chunked) {
      for (const character of raw) tokenizer.push(character);
    } else {
      tokenizer.push(raw);
    }
    return tokenizer.finish().message;
  }

  it('accepts an empty array or object anywhere in the envelope', () => {
    expect(run('{"message":"hi","a":[]}')).toBe('hi');
    expect(run('{"message":"hi","a":{}}')).toBe('hi');
    expect(run('{"message":"hi","toolCall":[]}')).toBe('hi');
  });

  it('accepts empty containers nested inside arrays and objects', () => {
    expect(run('{"message":"hi","a":[[],[[]],[1,2]]}')).toBe('hi');
    expect(run('{"message":"hi","a":{"b":{},"c":{"d":[]}}}')).toBe('hi');
    expect(run('{"message":"hi","a":[[],{"b":[]},[{}]]}')).toBe('hi');
  });

  it('accepts an empty array for the organization.apply actionIds argument', () => {
    const raw = '{"message":"ok","toolCall":{"name":"organization.apply","arguments":{"actionIds":[]}}}';
    expect(run(raw)).toBe('ok');
  });

  it('accepts an empty array that is split across chunk boundaries', () => {
    expect(run('{"message":"hi","a":[]}', true)).toBe('hi');
    expect(run('{"message":"hi","a":{}}', true)).toBe('hi');
  });

  it('accepts an empty array followed by another member', () => {
    expect(run('{"message":"hi","a":[],"b":1}')).toBe('hi');
  });

  it('rejects a non-string top-level message value even when otherwise well-formed', () => {
    // The contract requires the top-level `message` member to be a string; an empty
    // array there is well-formed JSON but not a valid assistant envelope.
    expect(() => run('{"message":[]}')).toThrow(AssistantStreamError);
  });

  it('keeps the surrogate guarantee while an empty array is present', () => {
    const literal = run('{"message":"😀中文","toolCall":{"name":"organization.apply","arguments":{"actionIds":[]}}}', true);
    expect(literal).toBe('😀中文');
    const escaped = run('{"message":"\\uD83D\\uDE00\\u4e2d\\u6587","a":[]}', true);
    expect(escaped).toBe('😀中文');
    for (const character of literal) {
      const code = character.codePointAt(0) ?? 0;
      expect(code < 0xd800 || code > 0xdfff).toBe(true);
    }
  });

  it('still rejects a trailing comma in an array and in an object', () => {
    expect(() => run('{"message":"hi","a":[1,]}')).toThrow(AssistantStreamError);
    expect(() => run('{"message":"hi","a":1,}')).toThrow(AssistantStreamError);
    expect(run('{"message":"hi","a":{},"b":1}')).toBe('hi');
  });

  it('rejects empty array element positions produced by commas', () => {
    expect(() => run('{"message":"hi","a":[,1]}')).toThrow(AssistantStreamError);
    expect(() => run('{"message":"hi","a":[1,,2]}')).toThrow(AssistantStreamError);
    expect(() => run('{"message":"hi","a":[],}')).toThrow(AssistantStreamError);
  });
});

function sseStream(chunks: readonly string[], contentType = 'text/event-stream'): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) enqueue(controller, chunk);
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': contentType } });
}

function sseData(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function delta(payload: Record<string, unknown>, content: string): string {
  return sseData({ choices: [{ index: 0, delta: { ...payload, content } }] });
}

function finishFrame(reason = 'stop'): string {
  return sseData({ choices: [{ index: 0, delta: {}, finish_reason: reason }] });
}

function doneFrame(): string {
  return 'data: [DONE]\n\n';
}

function enqueue(controller: ReadableStreamDefaultController<Uint8Array>, text: string): void {
  controller.enqueue(new TextEncoder().encode(text));
}

async function drive(stream: AiProviderStream): Promise<string[]> {
  const output: string[] = [];
  for (;;) {
    const chunk = await stream.next();
    if (chunk === null) break;
    output.push(chunk);
  }
  return output;
}

async function openProviderStream(response: Response): Promise<AiProviderStream> {
  const body = response.body;
  if (body === null) throw new Error('no body');
  return new AiProviderStream(body.getReader(), {
    step: 0,
    streamTotalTimeoutMs: 1_000,
    contentPath: 'choices[0].message.content',
    onDone: () => undefined,
    onError: () => undefined,
  });
}

describe('provider streaming transport', () => {
  it('delivers decoded text before the upstream stream completes', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const full = envelope('前半后半');
    const cut = full.indexOf('后半');
    const firstHalf = full.slice(0, cut);
    const secondHalf = full.slice(cut);
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        enqueue(controller, delta({}, firstHalf));
        await gate;
        enqueue(controller, delta({}, secondHalf));
        enqueue(controller, finishFrame());
        enqueue(controller, doneFrame());
        controller.close();
      },
    });
    const stream = new AiProviderStream(body.getReader(), {
      step: 0,
      streamTotalTimeoutMs: 2_000,
      contentPath: 'choices[0].message.content',
      onDone: () => undefined,
      onError: () => undefined,
    });
    const first = await stream.next();
    expect(first).toBe('前半');
    release();
    const rest = await drive(stream);
    expect([first, ...rest].join('')).toBe('前半后半');
  });

  it('supports CRLF framing, heartbeat comments and extra delta fields', async () => {
    const full = envelope('ok');
    const firstHalf = full.slice(0, 8);
    const secondHalf = full.slice(8);
    const stream = await openProviderStream(
      sseStream([
        ': keepalive\r\n',
        '\r\n',
        'event: message\r\n',
        `data: ${JSON.stringify({ choices: [{ delta: { content: firstHalf } }] })}\r\n`,
        '\r\n',
        `data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant', content: secondHalf } }] })}\r\n`,
        '\r\n',
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\r\n\r\ndata: [DONE]\r\n\r\n`,
      ]),
    );
    const chunks = await drive(stream);
    expect(chunks.join('')).toBe('ok');
  });

  it('never splits a multi-byte UTF-8 character across chunks', async () => {
    const bytes = new TextEncoder().encode(delta({}, envelope('中文')) + finishFrame() + doneFrame());
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
        controller.close();
      },
    });
    const stream = new AiProviderStream(body.getReader(), {
      step: 0,
      streamTotalTimeoutMs: 2_000,
      contentPath: 'choices[0].message.content',
      onDone: () => undefined,
      onError: () => undefined,
    });
    const chunks = await drive(stream);
    expect(chunks.join('')).toBe('中文');
  });

  it('fails when finish_reason is not stop', async () => {
    const stream = await openProviderStream(
      sseStream([delta({}, envelope('x')), finishFrame('length'), doneFrame()]),
    );
    await expect(drive(stream)).rejects.toBeInstanceOf(AssistantStreamError);
  });

  it('fails when [DONE] is missing', async () => {
    const stream = await openProviderStream(sseStream([delta({}, envelope('hello')), finishFrame()]));
    await expect(drive(stream)).rejects.toBeInstanceOf(AssistantStreamError);
  });

  it('fails on a tool_calls delta instead of silently dropping it', async () => {
    const payload = { choices: [{ delta: { tool_calls: [{ id: 'x' }] } }] };
    const stream = await openProviderStream(
      sseStream([sseData(payload), finishFrame(), doneFrame()]),
    );
    await expect(drive(stream)).rejects.toBeInstanceOf(AssistantStreamError);
  });

  it('fails on an incomplete envelope even when [DONE] arrives', async () => {
    const stream = await openProviderStream(
      sseStream([delta({}, '{"message":"truncated'), finishFrame(), doneFrame()]),
    );
    await expect(drive(stream)).rejects.toBeInstanceOf(AssistantStreamError);
  });

  it('fails on oversize total bytes', async () => {
    const stream = await openProviderStream(sseStream([delta({}, 'a'.repeat(3 * 1024 * 1024))]));
    await expect(drive(stream)).rejects.toBeInstanceOf(AssistantStreamError);
  });

  it('cancels the reader and stops producing', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        enqueue(controller, delta({}, '{"message":"x'));
      },
      cancel() {
        cancelled = true;
      },
    });
    const stream = new AiProviderStream(body.getReader(), {
      step: 0,
      streamTotalTimeoutMs: 2_000,
      contentPath: 'choices[0].message.content',
      onDone: () => undefined,
      onError: () => undefined,
    });
    stream.cancel();
    expect(cancelled).toBe(true);
  });

  it('aborts with a timeout error when the body stalls', async () => {
    const errors: unknown[] = [];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        enqueue(controller, delta({}, '{"message":"a'));
      },
    });
    const stream = new AiProviderStream(body.getReader(), {
      step: 0,
      streamTotalTimeoutMs: 30,
      contentPath: 'choices[0].message.content',
      onDone: () => undefined,
      onError: (error) => errors.push(error),
    });
    await expect(drive(stream)).rejects.toThrow();
    expect(errors.length).toBe(1);
  });

  it('exposes only decoded message characters through next()', async () => {
    // Without an `onText` callback, `next()`/`text` must expose the decoded message value,
    // never the raw envelope JSON that the provider actually sent.
    const stream = await openProviderStream(
      sseStream([delta({}, envelope('值 42')), finishFrame(), doneFrame()]),
    );
    const chunks = await drive(stream);
    expect(chunks.join('')).toBe('值 42');
    expect(stream.text).toBe('值 42');
  });
});

describe('buffered provider modes', () => {
  it('returns null from openStream for responses and custom modes', async () => {
    const service = new AiProviderService(() => Promise.reject(new Error('must not be called')));
    const base = {
      version: 1 as const,
      enabled: true,
      name: 'p',
      url: 'https://provider.example.test/x',
      method: 'POST' as const,
      model: 'm',
      timeoutMs: 1_000,
      headers: {},
      auth: { kind: 'none' as const },
      bodyTemplate: '{"q":"{{input}}"}',
      responsePath: 'choices[0].message.content',
      encryptedSecret: null,
      updatedAt: 0,
    };
    const context = {
      input: 'hi',
      categories: [],
      accounts: [],
      model: 'm',
      today: '2026-09-22',
      responseSchema: { type: 'object' },
    };
    expect(await service.openStream({ ...base, mode: 'responses' }, null, context)).toBeNull();
    expect(await service.openStream({ ...base, mode: 'custom' }, null, context)).toBeNull();
  });
});
