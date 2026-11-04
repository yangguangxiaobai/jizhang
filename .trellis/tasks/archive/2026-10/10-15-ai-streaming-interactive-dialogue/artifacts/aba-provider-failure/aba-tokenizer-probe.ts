/**
 * Read-only local probe (no network, no provider, no DB):
 * distinguishes the tokenizer's two failure shapes for `ASSISTANT_STREAM_BOUNDS`:
 *   - OVERSIZE_MESSAGE  -> decoded message exceeded maxMessageChars (4000)
 *   - INVALID_ENVELOPE  -> envelope bytes could not be recognised as the bounded JSON object
 * Run: packages/server/node_modules/.bin/tsx <this file>
 */
import { AssistantMessageJsonTokenizer } from '../../../../../packages/server/src/services/assistant-stream-tokenizer.js';
import { MAX_PROVIDER_MESSAGE_CHARS } from '../../../../../packages/server/src/services/assistant-stream-types.js';

const OVERSIZE = 'AI 回复超出长度上限，本次生成未产生结果。';
const INVALID = 'AI 返回内容无法识别，本次生成未产生结果。';

interface CaseResult {
  readonly name: string;
  readonly thrown: boolean;
  readonly code: string | null;
  readonly message: string | null;
  readonly shape: 'oversize' | 'invalid' | 'none';
  readonly decodedChars: number;
  readonly complete: boolean;
}

function run(name: string, chunks: readonly string[]): CaseResult {
  const tokenizer = new AssistantMessageJsonTokenizer({
    maxMessageChars: MAX_PROVIDER_MESSAGE_CHARS,
    onText: () => undefined,
  });
  let thrown: unknown = null;
  let complete = false;
  try {
    for (const chunk of chunks) tokenizer.push(chunk);
    complete = tokenizer.finish().complete;
  } catch (error) {
    thrown = error;
  }
  const message = thrown instanceof Error ? thrown.message : null;
  const code = (thrown as { code?: string } | null)?.code ?? null;
  const shape = message === OVERSIZE ? 'oversize' : thrown === null ? 'none' : 'invalid';
  return { name, thrown: thrown !== null, code, message, shape, decodedChars: tokenizer.text.length, complete };
}

const results: CaseResult[] = [];

// 1) Envelope truncated mid-stream after 219 decoded chars (the aba generation's partial length).
const head = '{"message":"';
const body = 'A'.repeat(219);
results.push(run('truncated envelope, 219 decoded chars, no closing quote', [`${head}${body}`]));

// 2) Same truncation but finished() is called: an unterminated envelope is INVALID, not OVERSIZE.
{
  const tokenizer = new AssistantMessageJsonTokenizer({
    maxMessageChars: MAX_PROVIDER_MESSAGE_CHARS,
    onText: () => undefined,
  });
  let shape: CaseResult['shape'] = 'none';
  let message: string | null = null;
  try {
    tokenizer.push(`${head}${body}`);
    tokenizer.finish();
  } catch (error) {
    message = error instanceof Error ? error.message : null;
    shape = message === OVERSIZE ? 'oversize' : 'invalid';
  }
  results.push({
    name: 'same input then finish() on unterminated envelope',
    thrown: true,
    code: (null as string | null),
    message,
    shape,
    decodedChars: tokenizer.text.length,
    complete: false,
  });
}

// 3) A complete envelope whose message is exactly 4000 chars -> accepted.
results.push(run('complete envelope, message exactly 4000 chars', [
  `{"message":"${'B'.repeat(4000)}"}`,
]));

// 4) A complete envelope whose message is 4001 chars -> OVERSIZE (the 4000 ceiling).
results.push(run('complete envelope, message 4001 chars', [
  `{"message":"${'C'.repeat(4001)}"}`,
]));

// 5) Non-JSON provider payload -> INVALID at a tiny decoded length.
results.push(run('non-JSON payload', ['I am not a JSON envelope']));
results.push(run('markdown-fenced JSON payload', ['```json\n{"message":"hi"}\n```']));
results.push(run('envelope schema drift (content instead of message)', ['{"content":"hi","toolCall":null}']));

console.log(JSON.stringify({ maxMessageChars: MAX_PROVIDER_MESSAGE_CHARS, results }, null, 2));
