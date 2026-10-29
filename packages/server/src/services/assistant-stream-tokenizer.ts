/**
 * Bounded incremental tokenizer for the model's JSON envelope.
 *
 * The provider streams a chat message whose content is expected to be one JSON object
 * shaped like `{"message":"...","toolCall":...}` (optionally with `clarification`).
 * Only the characters of the *value* of the top-level `message` key may reach the user,
 * and only once they are complete decoded characters — never raw envelope bytes.
 *
 * Why a hand-written scanner instead of a regex or `JSON.parse` on a prefix:
 *   * a regex cannot respect string/escape boundaries and would happily emit `\"` halves;
 *   * `JSON.parse` needs a complete document, which defeats incremental delivery;
 *   * the scanner can enforce bounds (depth, decoded size) and reject duplicate keys,
 *     lone surrogates and truncated escapes deterministically.
 *
 * The scanner is deliberately strict: malformed input throws instead of degrading,
 * because a half-validated envelope must never produce a clarification card.
 */
import { AssistantStreamError } from './assistant-stream-types.js';

const MAX_DEPTH = 32;
const MAX_KEY_CHARS = 256;
const NUMBER_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

const INVALID_ENVELOPE = 'AI 返回内容无法识别，本次生成未产生结果。';
const OVERSIZE_MESSAGE = 'AI 回复超出长度上限，本次生成未产生结果。';

type Frame =
  | { readonly kind: 'object'; readonly keys: Set<string>; key: string | null; sawValue: boolean }
  | { readonly kind: 'array'; sawValue: boolean };

type ScanState =
  | 'value'
  | 'key'
  | 'colon'
  | 'comma'
  | 'string'
  | 'literal'
  | 'number'
  | 'trailing';

type StringKind = 'key' | 'message' | 'other';

export interface AssistantMessageTokenizerOptions {
  /** Maximum decoded message characters; exceeding it fails the stream explicitly. */
  readonly maxMessageChars: number;
  /** Receives newly decoded, complete characters of the top-level message string. */
  readonly onText?: ((text: string) => void) | undefined;
}

export interface AssistantMessageTokenizerResult {
  /** True when the top-level object was closed and the message string was seen. */
  readonly complete: boolean;
  /** Decoded message text accumulated so far. */
  readonly message: string;
}

class TokenizerFailure extends Error {
  constructor() {
    super('provider envelope is not a bounded, well-formed JSON object');
    this.name = 'TokenizerFailure';
  }
}

const WHITESPACE = new Set([' ', '\t', '\n', '\r']);
const NUMBER_CHARS = new Set('0123456789+-.eE'.split(''));
const HEX_CHARS = new Set('0123456789abcdefABCDEF'.split(''));
const LITERALS: Readonly<Record<string, string>> = { t: 'true', f: 'false', n: 'null' };

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

export class AssistantMessageJsonTokenizer {
  private readonly maxMessageChars: number;
  private readonly onText: ((text: string) => void) | undefined;

  private state: ScanState = 'value';
  private readonly frames: Frame[] = [];
  private index = 0;

  /** Pending escape: `null` = none, `{ hex: false }` = one simple escape, `{ hex: true, digits }`. */
  private escape: { readonly hex: false } | { readonly hex: true; digits: string } | null = null;
  private pendingHigh: number | null = null;
  private readonly literal = { text: '', offset: 0 };
  private readonly number = { text: '' };
  private stringKind: StringKind = 'other';
  private keyBuffer = '';

  private decoded = '';
  private flushed = '';
  private sawMessageKey = false;
  private messageWasString = false;
  private failed = false;

  constructor(options: AssistantMessageTokenizerOptions) {
    this.maxMessageChars = options.maxMessageChars;
    this.onText = options.onText;
  }

  /** Decoded characters delivered so far. */
  get text(): string {
    return this.decoded;
  }

  /** Consumes a chunk of envelope text. Chunk boundaries may fall anywhere. */
  push(text: string): void {
    this.guard(() => {
      this.scan(text);
      this.flush();
    });
  }

  /** Completes the envelope. Throws when truncated, unfinished or missing the message. */
  finish(): AssistantMessageTokenizerResult {
    this.guard(() => {
      if (this.escape !== null || this.pendingHigh !== null || this.frames.length !== 0) {
        throw new TokenizerFailure();
      }
      if (this.state !== 'trailing') throw new TokenizerFailure();
      if (!this.sawMessageKey || !this.messageWasString) throw new TokenizerFailure();
      this.flush();
    });
    return { complete: true, message: this.decoded };
  }

  private guard(run: () => void): void {
    if (this.failed) throw new AssistantStreamError('ASSISTANT_STREAM_BOUNDS', INVALID_ENVELOPE);
    try {
      run();
    } catch (error) {
      this.failed = true;
      if (error instanceof AssistantStreamError) throw error;
      throw new AssistantStreamError('ASSISTANT_STREAM_BOUNDS', INVALID_ENVELOPE);
    }
  }

  private flush(): void {
    if (this.flushed === '') return;
    const chunk = this.flushed;
    this.flushed = '';
    this.decoded += chunk;
    this.onText?.(chunk);
  }

  private appendDecoded(text: string): void {
    if (text === '') return;
    if (this.decoded.length + this.flushed.length + text.length > this.maxMessageChars) {
      throw new AssistantStreamError('ASSISTANT_STREAM_BOUNDS', OVERSIZE_MESSAGE);
    }
    this.flushed += text;
  }

  private currentFrame(): Frame | undefined {
    return this.frames[this.frames.length - 1];
  }

  private pushFrame(frame: Frame): void {
    if (this.frames.length + 1 > MAX_DEPTH) throw new TokenizerFailure();
    this.frames.push(frame);
  }

  /**
   * Marks that the innermost frame just received a complete value. Array frames need it
   * to reject `[,` / `[1,,2]`; object frames need it to reject a trailing comma
   * (`{"a":1,}`) while still accepting a genuinely empty object (`{}`).
   */
  private markValue(): void {
    const frame = this.currentFrame();
    if (frame !== undefined) frame.sawValue = true;
  }

  /**
   * Completes the value that just ended: either another member/`]`/`}` or end of document.
   *
   * Only a frame that received a real value reaches this state, which is what makes `[],`
   * distinguishable from `[]`: the empty-container transition below does *not* mark a value.
   */
  private completeValue(): void {
    this.markValue();
    this.state = this.frames.length === 0 ? 'trailing' : 'comma';
  }

  /** Closes a container whose value list is non-empty (`}`/`]` reached from `comma`). */
  private closeContainer(): void {
    this.frames.pop();
    this.completeValue();
  }

  /**
   * Closes an empty container (`{}`/`[]`). The empty value belongs to the *parent* frame,
   * so the parent is marked; the container itself is popped without marking, which keeps
   * `[],` illegal at the parent's comma state.
   */
  private closeEmptyContainer(): void {
    this.frames.pop();
    this.markValue();
    this.state = this.frames.length === 0 ? 'trailing' : 'comma';
  }

  /** Rejects a comma that follows `[` or an earlier comma with no intervening value. */
  private rejectEmptyArrayElement(): void {
    const frame = this.currentFrame();
    if (frame !== undefined && frame.kind === 'array' && !frame.sawValue) {
      throw new TokenizerFailure();
    }
  }

  private scan(text: string): void {
    try {
      const { length } = text;
      while (this.index < length) {
        if (this.state === 'string') {
          if (!this.scanString(text)) return;
          continue;
        }
        if (this.state === 'literal') {
          if (!this.scanLiteral(text)) return;
          continue;
        }
        if (this.state === 'number') {
          if (!this.scanNumber(text)) return;
          continue;
        }
        if (!this.scanStructural(text)) return;
      }
    } finally {
      // Chunk-local cursor: a partial token keeps its state, never its offset. Forgetting
      // this leaves the cursor past the end of the next chunk and silently drops input.
      this.index = 0;
    }
  }

  /** Structural states: consumes at most one character. Returns false to wait for more input. */
  private scanStructural(text: string): boolean {
    const character = text[this.index] as string;
    switch (this.state) {
      case 'trailing': {
        if (!WHITESPACE.has(character)) throw new TokenizerFailure();
        this.index += 1;
        return true;
      }
      case 'value': {
        if (WHITESPACE.has(character)) {
          this.index += 1;
          return true;
        }
        if (character === '{') {
          this.pushFrame({ kind: 'object', keys: new Set<string>(), key: null, sawValue: false });
          this.state = 'key';
          this.index += 1;
          return true;
        }
        if (character === '[') {
          this.pushFrame({ kind: 'array', sawValue: false });
          this.state = 'value';
          this.index += 1;
          return true;
        }
        const frame = this.currentFrame();
        if (character === ']' && frame !== undefined && frame.kind === 'array' && !frame.sawValue) {
          // Empty array: closes immediately and counts as one value of the parent frame.
          this.index += 1;
          this.closeEmptyContainer();
          return true;
        }
        if (character === '"') {
          this.beginString(this.valueIsMessage() ? 'message' : 'other');
          this.index += 1;
          return true;
        }
        const literal = LITERALS[character];
        if (literal !== undefined) {
          this.literal.text = literal;
          this.literal.offset = 1;
          this.state = 'literal';
          this.index += 1;
          return true;
        }
        if (character === '-' || (character >= '0' && character <= '9')) {
          this.number.text = character;
          this.state = 'number';
          this.index += 1;
          return true;
        }
        throw new TokenizerFailure();
      }
      case 'key': {
        if (WHITESPACE.has(character)) {
          this.index += 1;
          return true;
        }
        if (character === '"') {
          this.beginString('key');
          this.index += 1;
          return true;
        }
        const frame = this.currentFrame();
        if (character === '}' && frame !== undefined && frame.kind === 'object' && !frame.sawValue) {
          // Empty object. A `}` after a member is only legal through `completeValue`'s
          // path, so a trailing comma cannot land here.
          this.index += 1;
          this.closeEmptyContainer();
          return true;
        }
        throw new TokenizerFailure();
      }
      case 'colon': {
        if (WHITESPACE.has(character)) {
          this.index += 1;
          return true;
        }
        if (character !== ':') throw new TokenizerFailure();
        this.state = 'value';
        this.index += 1;
        return true;
      }
      case 'comma': {
        if (WHITESPACE.has(character)) {
          this.index += 1;
          return true;
        }
        const frame = this.currentFrame();
        if (frame === undefined) throw new TokenizerFailure();
        if (character === ',') {
          this.rejectEmptyArrayElement();
          if (frame.kind === 'object') frame.key = null;
          this.state = frame.kind === 'object' ? 'key' : 'value';
          this.index += 1;
          return true;
        }
        if (frame.kind === 'object' && character === '}') {
          this.index += 1;
          this.closeContainer();
          return true;
        }
        if (frame.kind === 'array' && character === ']') {
          this.index += 1;
          this.closeContainer();
          return true;
        }
        throw new TokenizerFailure();
      }
      default:
        throw new TokenizerFailure();
    }
  }

  /** True when the value about to start is the top-level `message` member. */
  private valueIsMessage(): boolean {
    if (this.frames.length !== 1) return false;
    const frame = this.currentFrame();
    if (frame === undefined || frame.kind !== 'object') return false;
    return frame.key === 'message';
  }

  private beginString(kind: StringKind): void {
    if (kind === 'message') {
      this.sawMessageKey = true;
      this.messageWasString = true;
    }
    this.stringKind = kind;
    this.keyBuffer = '';
    this.escape = null;
    this.state = 'string';
  }

  /** String state: consumes characters until the closing quote. Returns false to wait. */
  private scanString(text: string): boolean {
    const { length } = text;
    while (this.index < length) {
      const character = text[this.index] as string;
      const code = text.charCodeAt(this.index);

      if (this.escape !== null) {
        if (!this.escape.hex) {
          this.escape = null;
          const simple = this.decodeSimpleEscape(character);
          if (simple !== null) this.emitUnit(simple);
          this.index += 1;
          continue;
        }
        if (!HEX_CHARS.has(character)) throw new TokenizerFailure();
        const digits = this.escape.digits + character;
        this.index += 1;
        if (digits.length < 4) {
          this.escape = { hex: true, digits };
          continue;
        }
        this.escape = null;
        this.emitUnit(Number.parseInt(digits, 16));
        continue;
      }

      if (character === '"') {
        this.endString();
        this.index += 1;
        return true;
      }
      if (character === '\\') {
        this.escape = { hex: false };
        this.index += 1;
        continue;
      }
      if (code < 0x20) throw new TokenizerFailure();
      if (this.stringKind === 'message') {
        this.emitUnit(code);
      } else if (this.stringKind === 'key') {
        this.keyBuffer += character;
        if (this.keyBuffer.length > MAX_KEY_CHARS) throw new TokenizerFailure();
      }
      this.index += 1;
    }
    return false;
  }

  /** Returns the numeric escape target, or `null` when `\uXXXX` digits are still pending. */
  private decodeSimpleEscape(character: string): number | null {
    switch (character) {
      case '"':
        return 0x22;
      case '\\':
        return 0x5c;
      case '/':
        return 0x2f;
      case 'b':
        return 0x08;
      case 'f':
        return 0x0c;
      case 'n':
        return 0x0a;
      case 'r':
        return 0x0d;
      case 't':
        return 0x09;
      case 'u':
        this.escape = { hex: true, digits: '' };
        return null;
      default:
        throw new TokenizerFailure();
    }
  }

  /**
   * Routes one decoded UTF-16 code unit. Only the message value is retained; other
   * strings are still scanned for validity so a malformed escape cannot slip through.
   */
  private emitUnit(code: number): void {
    if (this.stringKind !== 'message') return;
    if (this.pendingHigh !== null) {
      if (!isLowSurrogate(code)) throw new TokenizerFailure();
      const high = this.pendingHigh;
      this.pendingHigh = null;
      this.appendDecoded(String.fromCharCode(high, code));
      return;
    }
    if (isHighSurrogate(code)) {
      this.pendingHigh = code;
      return;
    }
    if (isLowSurrogate(code)) throw new TokenizerFailure();
    this.appendDecoded(String.fromCharCode(code));
  }

  private endString(): void {
    if (this.escape !== null || this.pendingHigh !== null) throw new TokenizerFailure();
    const kind = this.stringKind;
    this.stringKind = 'other';
    if (kind === 'key') {
      const frame = this.currentFrame();
      if (frame === undefined || frame.kind !== 'object') throw new TokenizerFailure();
      if (frame.keys.has(this.keyBuffer)) throw new TokenizerFailure();
      frame.keys.add(this.keyBuffer);
      frame.key = this.keyBuffer;
      this.keyBuffer = '';
      this.state = 'colon';
      return;
    }
    this.keyBuffer = '';
    this.completeValue();
  }

  private scanLiteral(text: string): boolean {
    const { length } = text;
    while (this.index < length) {
      if (this.literal.offset >= this.literal.text.length) {
        this.completeValue();
        return true;
      }
      if (this.literal.text[this.literal.offset] !== text[this.index]) throw new TokenizerFailure();
      this.literal.offset += 1;
      this.index += 1;
    }
    return false;
  }

  private scanNumber(text: string): boolean {
    const { length } = text;
    while (this.index < length) {
      const character = text[this.index] as string;
      if (!NUMBER_CHARS.has(character)) {
        if (!NUMBER_PATTERN.test(this.number.text)) throw new TokenizerFailure();
        this.number.text = '';
        this.completeValue();
        return true;
      }
      this.number.text += character;
      this.index += 1;
    }
    return false;
  }
}
