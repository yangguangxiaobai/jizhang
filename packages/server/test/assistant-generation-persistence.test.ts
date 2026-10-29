/**
 * Persistence unit tests for the v1 generation service.
 *
 * These cover the durability rules that the route-level tests can only observe indirectly:
 * the provisional message id surviving into the validated row, one uninterruptible write
 * unit for message(s) + terminal frame, duplicate suppression, ownership-checked cancel and
 * terminal-sequence reservations that are never reused or collided with.
 */
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { initializeDatabase, type Db } from '../src/db/index.js';
import {
  AssistantConversationService,
  createConversationWriteLock,
} from '../src/services/assistant-conversation-service.js';
import { AssistantGenerationService } from '../src/services/assistant-generation-service.js';
import type { AssistantStreamEvent } from '../src/services/assistant-stream-types.js';

const PROVISIONAL = '11111111-1111-1111-1111-111111111111';

let db: Db;
let conversations: AssistantConversationService;
let generations: AssistantGenerationService;
let conversationId: string;
let generationId: string;

function assistantRows(id: string): number {
  return (db
    .prepare("SELECT COUNT(*) AS c FROM assistant_messages WHERE conversation_id = ? AND role = 'assistant'")
    .get(id) as { c: number }).c;
}

function events(): AssistantStreamEvent[] {
  return generations.listEvents(conversationId, generationId, 0);
}

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initializeDatabase(db, null);
  const withConversationLock = createConversationWriteLock();
  conversations = new AssistantConversationService(db, () => Date.now(), { withConversationLock });
  generations = new AssistantGenerationService(db, conversations, () => Date.now(), { withConversationLock });
  const conversation = conversations.create('persistence');
  conversationId = conversation.id;
  const created = generations.create(
    conversationId,
    { version: 1, clientRequestId: 'req_1', input: { type: 'text', text: '你好' } },
    { delivery: 'stream', today: '2026-10-15' },
  );
  generationId = created.generation.id;
  generations.setStatus(conversationId, generationId, 'running');
});

describe('persistTurn', () => {
  it('reuses the announced provisional id and drops the provisional snapshot', () => {
    generations.announcePartial(conversationId, generationId, {
      messageId: PROVISIONAL,
      step: 0,
      text: '',
      validated: false,
    });
    generations.updatePartialText(conversationId, generationId, PROVISIONAL, '先到的一段');
    expect(generations.get(conversationId, generationId).partialMessages.length).toBe(1);

    generations.persistTurn(conversationId, generationId, {
      messages: [{
        id: PROVISIONAL,
        role: 'assistant',
        kind: 'text',
        content: { version: 1, text: '先到的一段', generationId },
      }],
      transition: { status: 'completed', outcome: 'answer', error: null },
    });

    const snapshot = generations.get(conversationId, generationId);
    expect(snapshot.status).toBe('completed');
    expect(snapshot.messageIds).toEqual([PROVISIONAL]);
    expect(snapshot.partialMessages).toEqual([]);
    expect(snapshot.messages.length).toBe(1);
    expect(assistantRows(conversationId)).toBe(1);
    // One bubble: the validated row replaced the provisional one, it did not follow it.
    expect(events().filter((event) => event.type === 'message').length).toBe(1);
  });

  it('rolls the whole unit back and leaves no message or terminal frame when it fails', () => {
    // A tool-card without a card fails content normalization *inside* the unit, after the
    // row was already inserted: nothing may survive that.
    expect(() =>
      generations.persistTurn(conversationId, generationId, {
        messages: [{ id: PROVISIONAL, role: 'assistant', kind: 'tool-card', content: { version: 1, text: 'x', generationId } }],
        transition: { status: 'completed', outcome: 'pending-confirmation', error: null },
      }),
    ).toThrow();

    const snapshot = generations.get(conversationId, generationId);
    expect(snapshot.status).toBe('running');
    expect(snapshot.messageIds).toEqual([]);
    expect(assistantRows(conversationId)).toBe(0);
    expect(events().some((event) => event.type === 'message')).toBe(false);
    expect(events().some((event) => event.type === 'terminal')).toBe(false);

    // The same unit succeeds afterwards, and the reserved terminal seq is skipped (never
    // reused), so no two committed events share a sequence number.
    generations.persistTurn(conversationId, generationId, {
      messages: [{ id: PROVISIONAL, role: 'assistant', kind: 'text', content: { version: 1, text: '好了', generationId } }],
      transition: { status: 'completed', outcome: 'answer', error: null },
    });
    const seqs = events().map((event) => event.seq);
    expect(seqs).toEqual([...new Set(seqs)]);
    expect(seqs.at(-1)).toBe(generations.get(conversationId, generationId).lastSeq);
    expect(generations.get(conversationId, generationId).status).toBe('completed');
  });

  it('never duplicates a message id that was already committed', () => {
    const plan = {
      messages: [{
        id: PROVISIONAL,
        role: 'assistant' as const,
        kind: 'text' as const,
        content: { version: 1 as const, text: '查询中', generationId },
      }],
    };
    generations.persistTurn(conversationId, generationId, plan);
    generations.persistTurn(conversationId, generationId, plan);
    expect(assistantRows(conversationId)).toBe(1);
    expect(events().filter((event) => event.type === 'message').length).toBe(1);
    expect(generations.get(conversationId, generationId).messageIds).toEqual([PROVISIONAL]);

    // Intermediate writes leave the generation live; only the terminal plan completes it.
    expect(generations.get(conversationId, generationId).status).toBe('running');
    generations.persistTurn(conversationId, generationId, {
      messages: [{
        id: PROVISIONAL,
        role: 'assistant',
        kind: 'result',
        content: {
          version: 1,
          text: '完成',
          generationId,
          result: { version: 1, toolName: 'accounts.balances', summary: '账户余额', data: {} },
        },
      }],
      transition: { status: 'completed', outcome: 'answer', error: null },
    });
    const snapshot = generations.get(conversationId, generationId);
    expect(snapshot.status).toBe('completed');
    expect(snapshot.messageIds).toEqual([PROVISIONAL]);
    expect(assistantRows(conversationId)).toBe(1);
  });

  it('refuses a late turn after a terminal status without touching the conversation', () => {
    generations.finalize(conversationId, generationId, {
      status: 'cancelled',
      outcome: null,
      error: { code: 'ASSISTANT_GENERATION_CANCELLED', message: '生成已被用户停止。' },
    });
    generations.persistTurn(conversationId, generationId, {
      messages: [{ id: PROVISIONAL, role: 'assistant', kind: 'text', content: { version: 1, text: '迟到的答复', generationId } }],
      transition: { status: 'completed', outcome: 'answer', error: null },
    });
    const snapshot = generations.get(conversationId, generationId);
    expect(snapshot.status).toBe('cancelled');
    expect(snapshot.messageIds).toEqual([]);
    expect(assistantRows(conversationId)).toBe(0);
    expect(events().filter((event) => event.type === 'terminal').length).toBe(1);
  });

  it('persists a pending action and its card in the same unit', () => {
    generations.persistTurn(conversationId, generationId, {
      pendingActions: [{
        id: 'pending-1',
        conversationId,
        sourceMessageId: generations.get(conversationId, generationId).userMessageId,
        toolName: 'transaction.create',
        arguments: {
          type: 'expense',
          amountCents: 2500,
          categoryId: 'builtin-expense-food',
          accountId: 'builtin-default-account',
          date: '2026-10-15',
        },
        preview: { type: 'expense' },
        fingerprint: 'fingerprint-1',
      }],
      messages: [{
        id: PROVISIONAL,
        role: 'assistant',
        kind: 'tool-card',
        content: {
          version: 1,
          text: '请确认',
          generationId,
          card: {
            version: 1,
            actionId: 'pending-1',
            toolName: 'transaction.create',
            operation: 'create',
            summary: '支出 25.00 元',
            writes: true,
            affected: { count: 1 },
            values: { amountCents: 2500 },
            warnings: [],
            fingerprint: 'fingerprint-1',
            status: 'pending',
            preview: { type: 'expense' },
          },
        },
      }],
      transition: { status: 'completed', outcome: 'pending-confirmation', error: null },
    });
    const snapshot = generations.get(conversationId, generationId);
    expect(snapshot.outcome).toBe('pending-confirmation');
    expect(conversations.pending('pending-1').status).toBe('pending');
    expect(assistantRows(conversationId)).toBe(1);
  });
});

describe('ownership and sequence reservations', () => {
  it('refuses a cancel issued from a different conversation', () => {
    const other = conversations.create('other');
    expect(() => generations.cancel(other.id, generationId)).toThrowError(
      expect.objectContaining({ code: 'ASSISTANT_GENERATION_NOT_FOUND' }),
    );
    // The generation is untouched: the wrong-conversation request must not act on it.
    expect(generations.get(conversationId, generationId).status).toBe('running');
    expect(() => generations.cancel(conversationId, generationId)).not.toThrow();
    expect(generations.get(conversationId, generationId).status).toBe('cancelled');
  });

  it('keeps one terminal frame and never reuses its seq', () => {
    generations.cancel(conversationId, generationId);
    generations.cancel(conversationId, generationId);
    const terminal = events().filter((event) => event.type === 'terminal');
    expect(terminal.length).toBe(1);
    const seqs = events().map((event) => event.seq);
    expect(seqs).toEqual([...new Set(seqs)]);
    expect(generations.get(conversationId, generationId).lastSeq).toBe(seqs.at(-1));
  });
});

describe('bounded subscribers and defensive snapshots', () => {
  it('closes and wakes an overflowing subscriber without stopping the producer', async () => {
    generations.announcePartial(conversationId, generationId, {
      messageId: PROVISIONAL, step: 0, text: '', validated: false,
    });
    const subscriber = generations.subscribe(generationId, generations.get(conversationId, generationId).lastSeq);
    const wake = generations.waitForEvent(subscriber, 15000);
    for (let offset = 0; offset < 130; offset += 1) {
      generations.appendTextDelta(conversationId, generationId, {
        messageId: PROVISIONAL, step: 0, offset, text: 'x',
      });
    }
    await wake;
    expect(subscriber.closed).toBe(true);
    expect(subscriber.peek()).toBeUndefined();
    expect(generations.get(conversationId, generationId).status).toBe('running');
    expect(events().filter((event) => event.type === 'text-delta')).toHaveLength(130);
    generations.cancel(conversationId, generationId);
  });

  it('rejects corrupt persisted partial entries instead of silently removing them', () => {
    db.prepare('UPDATE assistant_generations SET partials_json = ? WHERE id = ?').run('[null]', generationId);
    expect(() => generations.get(conversationId, generationId)).toThrow();
  });
});

it('reserves a terminal event even when the producer reaches its replay event cap', () => {
  generations.announcePartial(conversationId, generationId, {
    messageId: PROVISIONAL, step: 0, text: '', validated: false,
  });
  let bounded = false;
  for (let offset = 0; offset < 2050; offset += 1) {
    try {
      generations.appendTextDelta(conversationId, generationId, { messageId: PROVISIONAL, step: 0, offset, text: 'x' });
    } catch {
      bounded = true;
      break;
    }
  }
  expect(bounded).toBe(true);
  expect(() => generations.finalize(conversationId, generationId, {
    status: 'failed', outcome: null, error: { code: 'ASSISTANT_STREAM_BOUNDS', message: 'limit reached' },
  })).not.toThrow();
  expect(generations.get(conversationId, generationId).status).toBe('failed');
  expect(events().at(-1)?.type).toBe('terminal');
  expect(events().length).toBeLessThanOrEqual(2048);
});
