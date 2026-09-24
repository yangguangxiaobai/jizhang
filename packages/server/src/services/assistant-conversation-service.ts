/** Persistence boundary for normalized assistant conversations and pending actions. */
import { randomUUID } from 'node:crypto';
import type { Db } from '../db/index.js';
import {
  assistantJsonObject,
  normalizeAssistantContent,
  type AssistantActionStatus,
  type AssistantAttachmentMetadata,
  type AssistantContextMessage,
  type AssistantConversationDto,
  type AssistantJsonObject,
  type AssistantMessageContent,
  type AssistantMessageDto,
  type AssistantMessageKind,
  type AssistantPendingActionDto,
  type AssistantRole,
  type AssistantToolName,
  AssistantError,
  AssistantNotFoundError,
  AssistantValidationError,
  isAssistantToolName,
} from './assistant-types.js';

const MAX_TITLE_LENGTH = 120;
const MAX_CONTEXT_MESSAGES = 20;
const MAX_CONTEXT_TEXT = 2_000;

interface ConversationRow {
  readonly id: string;
  readonly title: string;
  readonly archived: number;
  readonly created_at: number;
  readonly updated_at: number;
}

interface MessageRow {
  readonly id: string;
  readonly conversation_id: string;
  readonly role: AssistantRole;
  readonly kind: AssistantMessageKind;
  readonly content_json: string;
  readonly created_at: number;
  readonly row_id: number;
}

interface PendingRow {
  readonly id: string;
  readonly conversation_id: string;
  readonly source_message_id: string;
  readonly tool_name: string;
  readonly arguments_json: string;
  readonly preview_json: string;
  readonly fingerprint: string;
  readonly attachment_sha256: string | null;
  readonly attachment_name: string | null;
  readonly attachment_size: number | null;
  readonly status: AssistantActionStatus;
  readonly result_json: string | null;
  readonly created_at: number;
  readonly updated_at: number;
}

export interface AppendMessageInput {
  readonly conversationId: string;
  readonly role: AssistantRole;
  readonly kind: AssistantMessageKind;
  readonly content: AssistantMessageContent;
  readonly clientRequestId?: string | undefined;
}

export interface CreatePendingActionInput {
  readonly conversationId: string;
  readonly sourceMessageId: string;
  readonly toolName: AssistantToolName;
  readonly arguments: AssistantJsonObject;
  readonly preview: AssistantJsonObject;
  readonly fingerprint: string;
  readonly attachment?: AssistantAttachmentMetadata | undefined;
}

function boundedTitle(value: string): string {
  return value.trim().slice(0, MAX_TITLE_LENGTH);
}

function parseJson(value: string, field: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new AssistantError(500, 'INTERNAL_ERROR', `助手存储的${field}无法读取。`);
  }
}

function toConversation(row: ConversationRow): AssistantConversationDto {
  return {
    id: row.id,
    title: row.title,
    archived: row.archived === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toMessage(row: MessageRow): AssistantMessageDto {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    kind: row.kind,
    content: normalizeAssistantContent(row.kind, parseJson(row.content_json, '消息内容')),
    createdAt: row.created_at,
  };
}

function toAttachment(row: PendingRow): AssistantAttachmentMetadata | null {
  if (row.attachment_sha256 === null && row.attachment_name === null && row.attachment_size === null) {
    return null;
  }
  if (
    row.attachment_sha256 === null ||
    row.attachment_name === null ||
    row.attachment_size === null ||
    !/^[a-f0-9]{64}$/i.test(row.attachment_sha256) ||
    !Number.isSafeInteger(row.attachment_size) ||
    row.attachment_size < 0
  ) {
    throw new AssistantError(500, 'INTERNAL_ERROR', '助手存储的附件信息无法读取。');
  }
  return {
    source: 'auto',
    fileName: row.attachment_name,
    sizeBytes: row.attachment_size,
    sha256: row.attachment_sha256.toLowerCase(),
  };
}

function toPending(row: PendingRow): AssistantPendingActionDto {
  if (!isAssistantToolName(row.tool_name)) {
    throw new AssistantError(500, 'INTERNAL_ERROR', '助手存储的工具名称无法读取。');
  }
  return {
    id: row.id,
    conversationId: row.conversation_id,
    sourceMessageId: row.source_message_id,
    toolName: row.tool_name,
    arguments: assistantJsonObject(parseJson(row.arguments_json, '操作参数'), '操作参数'),
    preview: assistantJsonObject(parseJson(row.preview_json, '操作预览'), '操作预览'),
    fingerprint: row.fingerprint,
    attachment: toAttachment(row),
    status: row.status,
    result:
      row.result_json === null
        ? null
        : assistantJsonObject(parseJson(row.result_json, '操作结果'), '操作结果'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Exposes only server-owned, bounded projections to the provider context window. */
function contextMessage(message: AssistantMessageDto): AssistantContextMessage {
  const content = message.content;
  const text = (content.text ?? content.card?.summary ?? content.result?.summary ?? content.error?.message ?? '').slice(
    0,
    MAX_CONTEXT_TEXT,
  );
  if (content.result !== undefined) {
    return { role: message.role, kind: message.kind, text, data: content.result.data };
  }
  if (content.card !== undefined) {
    return {
      role: message.role,
      kind: message.kind,
      text,
      data: { toolName: content.card.toolName, status: content.card.status, preview: content.card.preview },
    };
  }
  return { role: message.role, kind: message.kind, text };
}

export class AssistantConversationService {
  private readonly db: Db;
  private readonly now: () => number;

  constructor(db: Db, now: () => number = () => Date.now()) {
    this.db = db;
    this.now = now;
  }

  create(title = ''): AssistantConversationDto {
    const id = randomUUID();
    const at = this.now();
    this.db
      .prepare(
        `INSERT INTO assistant_conversations (id, title, archived, created_at, updated_at)
         VALUES (?, ?, 0, ?, ?)`,
      )
      .run(id, boundedTitle(title), at, at);
    return this.get(id);
  }

  get(id: string): AssistantConversationDto {
    const row = this.db
      .prepare('SELECT id, title, archived, created_at, updated_at FROM assistant_conversations WHERE id = ?')
      .get(id) as ConversationRow | undefined;
    if (row === undefined || row.archived === 1) throw new AssistantNotFoundError('助手对话不存在。');
    return toConversation(row);
  }

  list(): AssistantConversationDto[] {
    const rows = this.db
      .prepare(
        `SELECT id, title, archived, created_at, updated_at
           FROM assistant_conversations
          WHERE archived = 0
          ORDER BY updated_at DESC, id DESC`,
      )
      .all() as ConversationRow[];
    return rows.map(toConversation);
  }

  archive(id: string): void {
    const result = this.db
      .prepare('UPDATE assistant_conversations SET archived = 1, updated_at = ? WHERE id = ? AND archived = 0')
      .run(this.now(), id);
    if (result.changes === 0) throw new AssistantNotFoundError('助手对话不存在。');
    this.db
      .prepare(
        `UPDATE assistant_pending_actions
            SET status = 'expired', updated_at = ?
          WHERE conversation_id = ? AND status = 'pending'`,
      )
      .run(this.now(), id);
  }

  appendMessage(input: AppendMessageInput): AssistantMessageDto {
    this.get(input.conversationId);
    const normalized = normalizeAssistantContent(input.kind, input.content);
    const requestId = input.clientRequestId?.trim().slice(0, 120);
    if (requestId !== undefined && requestId !== '') {
      const existing = this.db
        .prepare(
          `SELECT id, conversation_id, role, kind, content_json, created_at, rowid AS row_id
             FROM assistant_messages
            WHERE conversation_id = ? AND client_request_id = ?`,
        )
        .get(input.conversationId, requestId) as MessageRow | undefined;
      if (existing !== undefined) return toMessage(existing);
    }

    const id = randomUUID();
    const at = this.now();
    try {
      this.db
        .prepare(
          `INSERT INTO assistant_messages
             (id, conversation_id, client_request_id, role, kind, content_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.conversationId,
          requestId === '' ? null : (requestId ?? null),
          input.role,
          input.kind,
          JSON.stringify(normalized),
          at,
        );
    } catch (error) {
      if (requestId !== undefined && requestId !== '') {
        const existing = this.db
          .prepare(
            `SELECT id, conversation_id, role, kind, content_json, created_at, rowid AS row_id
               FROM assistant_messages
              WHERE conversation_id = ? AND client_request_id = ?`,
          )
          .get(input.conversationId, requestId) as MessageRow | undefined;
        if (existing !== undefined) return toMessage(existing);
      }
      throw error;
    }

    const title = normalized.text === undefined ? '' : boundedTitle(normalized.text);
    this.db
      .prepare(
        `UPDATE assistant_conversations
            SET title = CASE WHEN title = '' AND ? <> '' THEN ? ELSE title END,
                updated_at = ?
          WHERE id = ? AND archived = 0`,
      )
      .run(title, title, at, input.conversationId);
    return this.getMessage(id);
  }

  findByClientRequestId(conversationId: string, clientRequestId: string): AssistantMessageDto | undefined {
    const row = this.db
      .prepare(
        `SELECT id, conversation_id, role, kind, content_json, created_at, rowid AS row_id
           FROM assistant_messages
          WHERE conversation_id = ? AND client_request_id = ?`,
      )
      .get(conversationId, clientRequestId.trim().slice(0, 120)) as MessageRow | undefined;
    return row === undefined ? undefined : toMessage(row);
  }

  getMessage(id: string): AssistantMessageDto {
    const row = this.db
      .prepare(
        `SELECT id, conversation_id, role, kind, content_json, created_at, rowid AS row_id
           FROM assistant_messages WHERE id = ?`,
      )
      .get(id) as MessageRow | undefined;
    if (row === undefined) throw new AssistantNotFoundError('助手消息不存在。');
    return toMessage(row);
  }

  messages(conversationId: string): AssistantMessageDto[] {
    this.get(conversationId);
    const rows = this.db
      .prepare(
        `SELECT id, conversation_id, role, kind, content_json, created_at, rowid AS row_id
           FROM assistant_messages
          WHERE conversation_id = ?
          ORDER BY created_at, row_id`,
      )
      .all(conversationId) as MessageRow[];
    return rows.map(toMessage);
  }

  context(conversationId: string): AssistantContextMessage[] {
    const all = this.messages(conversationId);
    return all.slice(-MAX_CONTEXT_MESSAGES).map(contextMessage);
  }

  createPendingAction(input: CreatePendingActionInput): AssistantPendingActionDto {
    this.get(input.conversationId);
    if (input.fingerprint.trim() === '') throw new AssistantValidationError('助手操作缺少指纹。');
    const id = randomUUID();
    const at = this.now();
    this.db
      .prepare(
        `INSERT INTO assistant_pending_actions
           (id, conversation_id, source_message_id, tool_name, arguments_json, preview_json,
            fingerprint, attachment_sha256, attachment_name, attachment_size, status, result_json,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?)`,
      )
      .run(
        id,
        input.conversationId,
        input.sourceMessageId,
        input.toolName,
        JSON.stringify(assistantJsonObject(input.arguments, '操作参数')),
        JSON.stringify(assistantJsonObject(input.preview, '操作预览')),
        input.fingerprint,
        input.attachment?.sha256 ?? null,
        input.attachment?.fileName ?? null,
        input.attachment?.sizeBytes ?? null,
        at,
        at,
      );
    return this.pending(id);
  }

  pending(id: string): AssistantPendingActionDto {
    const row = this.db
      .prepare('SELECT * FROM assistant_pending_actions WHERE id = ?')
      .get(id) as PendingRow | undefined;
    if (row === undefined) throw new AssistantNotFoundError('助手操作不存在。');
    return toPending(row);
  }

  setPendingStatus(
    id: string,
    status: Exclude<AssistantActionStatus, 'pending'>,
    result: AssistantJsonObject | null,
  ): AssistantPendingActionDto {
    const current = this.pending(id);
    if (current.status === status) return current;
    if (current.status !== 'pending') return current;
    const at = this.now();
    this.db
      .prepare(
        `UPDATE assistant_pending_actions
            SET status = ?, result_json = ?, updated_at = ?
          WHERE id = ? AND status = 'pending'`,
      )
      .run(status, result === null ? null : JSON.stringify(assistantJsonObject(result, '操作结果')), at, id);
    return this.pending(id);
  }

  updateCardStatus(messageId: string, status: AssistantActionStatus): AssistantMessageDto {
    const message = this.getMessage(messageId);
    if (message.content.card === undefined) throw new AssistantValidationError('助手消息不是确认卡。');
    const content: AssistantMessageContent = {
      ...message.content,
      card: { ...message.content.card, status },
    };
    this.db
      .prepare('UPDATE assistant_messages SET content_json = ? WHERE id = ?')
      .run(JSON.stringify(normalizeAssistantContent(message.kind, content)), messageId);
    return this.getMessage(messageId);
  }

  updateProgressStatus(messageId: string, state: 'running' | 'complete'): AssistantMessageDto {
    const message = this.getMessage(messageId);
    if (message.content.progress === undefined) throw new AssistantValidationError('助手消息不是进度状态。');
    const content: AssistantMessageContent = {
      ...message.content,
      progress: { ...message.content.progress, state },
    };
    this.db
      .prepare('UPDATE assistant_messages SET content_json = ? WHERE id = ?')
      .run(JSON.stringify(normalizeAssistantContent(message.kind, content)), messageId);
    return this.getMessage(messageId);
  }
}
