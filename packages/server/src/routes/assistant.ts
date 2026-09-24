/** Authenticated conversation API. File bodies are request-local and never persisted. */
import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config.js';
import type { Db } from '../db/index.js';
import { AssistantConversationService } from '../services/assistant-conversation-service.js';
import { AssistantActionStaleError, AssistantError, AssistantValidationError, type AssistantAttachmentMetadata } from '../services/assistant-types.js';
import { AssistantOrchestrator } from '../services/assistant-orchestrator.js';

const MAX_TEXT_LENGTH = 2_000;
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

export interface AssistantRoutesOptions {
  readonly db: Db;
  readonly config: AppConfig;
  readonly now?: (() => number) | undefined;
  readonly fetchImpl?: typeof fetch;
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new AssistantValidationError(`${field} 必须是对象。`);
  return value as Record<string, unknown>;
}

function b64Bytes(value: unknown): Uint8Array {
  if (typeof value !== 'string' || value.length === 0 || value.length > Math.ceil(MAX_ATTACHMENT_BYTES * 4 / 3) + 8) {
    throw new AssistantValidationError('附件内容为空或超出大小限制。');
  }
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new AssistantValidationError('附件编码无效。');
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new AssistantValidationError('附件超出 5 MB 大小限制。');
  return new Uint8Array(bytes);
}

function parseAttachment(value: unknown): { metadata: AssistantAttachmentMetadata; bytes: Uint8Array } {
  const input = record(value, 'attachment');
  const fileName = typeof input['fileName'] === 'string' ? input['fileName'].trim().slice(0, 200) : '';
  if (fileName === '' || /[\\/\0]/.test(fileName)) throw new AssistantValidationError('附件名称无效。');
  const source = input['source'] ?? 'auto';
  if (source !== 'auto' && source !== 'wechat' && source !== 'alipay') throw new AssistantValidationError('附件来源无效。');
  const extension = fileName.toLowerCase().split('.').pop();
  if (extension !== 'xlsx' && extension !== 'csv') throw new AssistantValidationError('仅支持微信 XLSX 或支付宝 CSV 账单。');
  if ((source === 'wechat' && extension !== 'xlsx') || (source === 'alipay' && extension !== 'csv')) throw new AssistantValidationError('文件格式与账单来源不匹配。');
  const bytes = b64Bytes(input['fileBase64']);
  const metadata: AssistantAttachmentMetadata = {
    source,
    fileName,
    sizeBytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  return { metadata, bytes };
}

function safeError(error: unknown): { code: string; message: string } {
  if (error instanceof AssistantError || (typeof error === 'object' && error !== null && 'statusCode' in error && typeof (error as { statusCode: unknown }).statusCode === 'number')) {
    const value = error as { code?: unknown; message?: unknown; statusCode: number };
    return {
      code: typeof value.code === 'string' ? value.code : 'ASSISTANT_ERROR',
      message: value.statusCode >= 500 ? '助手暂时无法处理请求，请稍后重试。' : typeof value.message === 'string' ? value.message : '请求无效。',
    };
  }
  return { code: 'INTERNAL_ERROR', message: '助手暂时无法处理请求，请稍后重试。' };
}

export async function registerAssistantRoutes(app: FastifyInstance, options: AssistantRoutesOptions): Promise<void> {
  const now = options.now ?? (() => Date.now());
  const conversations = new AssistantConversationService(options.db, now);
  const orchestrator = new AssistantOrchestrator({
    db: options.db,
    config: options.config,
    conversations,
    now,
    fetchImpl: options.fetchImpl,
  });
  const confirmingActions = new Map<string, Promise<unknown>>();

  app.get('/api/v1/assistant/tools', async () => ({ items: orchestrator.catalog() }));
  app.get('/api/v1/assistant/conversations', async () => ({ items: conversations.list() }));
  app.post('/api/v1/assistant/conversations', async (request: FastifyRequest) => {
    const body = request.body === undefined ? {} : record(request.body, 'body');
    const title = typeof body['title'] === 'string' ? body['title'].slice(0, 120) : '';
    return conversations.create(title);
  });

  app.get<{ Params: { id: string } }>('/api/v1/assistant/conversations/:id/messages', async (request) => ({
    items: conversations.messages(request.params.id),
  }));

  app.post<{ Params: { id: string } }>('/api/v1/assistant/conversations/:id/messages', async (request) => {
    const body = record(request.body, 'body');
    const text = typeof body['text'] === 'string' ? body['text'].trim() : '';
    const clientRequestId = typeof body['clientRequestId'] === 'string' ? body['clientRequestId'].trim().slice(0, 120) : undefined;
    if (text.length > MAX_TEXT_LENGTH) throw new AssistantValidationError('消息不能超过 2,000 个字符。');
    if (text === '' && body['attachment'] === undefined) throw new AssistantValidationError('请输入内容或附加账单文件。');
    if (clientRequestId !== undefined && clientRequestId !== '') {
      const existing = conversations.findByClientRequestId(request.params.id, clientRequestId);
      if (existing !== undefined) return { items: conversations.messages(request.params.id) };
    }
    const attachment = body['attachment'] === undefined ? undefined : parseAttachment(body['attachment']);
    const metadata = attachment?.metadata;
    const user = conversations.appendMessage({
      conversationId: request.params.id,
      role: 'user',
      kind: metadata === undefined ? 'text' : 'attachment',
      content: { version: 1, ...(text === '' ? {} : { text }), ...(metadata === undefined ? {} : { attachment: metadata }) },
      clientRequestId,
    });
    try {
      await orchestrator.handleMessage(request.params.id, text, user.id, attachment);
    } catch (error) {
      const running = [...conversations.messages(request.params.id)].reverse().find((message) => message.content.progress?.state === 'running');
      if (running !== undefined) conversations.updateProgressStatus(running.id, 'complete');
      const safe = safeError(error);
      conversations.appendMessage({ conversationId: request.params.id, role: 'assistant', kind: 'error', content: { version: 1, text: safe.message, error: safe } });
    }
    return { items: conversations.messages(request.params.id) };
  });

  app.post<{ Params: { id: string } }>('/api/v1/assistant/actions/:id/confirm', async (request) => {
    const alreadyConfirming = confirmingActions.get(request.params.id);
    if (alreadyConfirming !== undefined) return alreadyConfirming;
    const operation = (async () => {
    const body = request.body === undefined ? {} : record(request.body, 'body');
    const pending = conversations.pending(request.params.id);
    if (pending.status === 'confirmed') return { action: pending, message: conversations.messages(pending.conversationId).at(-1) ?? null };
    const attachedBytes = body['fileBase64'] === undefined ? undefined : b64Bytes(body['fileBase64']);
    let selectedIds: readonly string[] | null | undefined;
    if (body['selectedIds'] !== undefined) {
      if (body['selectedIds'] !== null && (!Array.isArray(body['selectedIds']) || body['selectedIds'].length > 200 || body['selectedIds'].some((id) => typeof id !== 'string' || id.length > 100))) throw new AssistantValidationError('selectedIds 必须是最多 200 个有效行编号的数组或 null。');
      selectedIds = body['selectedIds'] as string[] | null;
    }
    let categoryOverrides: Readonly<Record<string, string>> | undefined;
    if (body['categoryOverrides'] !== undefined) {
      const raw = record(body['categoryOverrides'], 'categoryOverrides');
      if (Object.keys(raw).length > 200 || Object.keys(raw).some((id) => id.length > 100)) throw new AssistantValidationError('分类覆盖行数超出限制。');
      if (Object.values(raw).some((name) => typeof name !== 'string')) throw new AssistantValidationError('分类覆盖值必须是文本。');
      categoryOverrides = raw as Record<string, string>;
    }
    try {
      return await orchestrator.confirmAction(pending.conversationId, pending.id, attachedBytes, {
        ...(selectedIds === undefined ? {} : { selectedIds }),
        ...(categoryOverrides === undefined ? {} : { categoryOverrides }),
      });
    } catch (error) {
      if (error instanceof AssistantActionStaleError) conversations.setPendingStatus(pending.id, 'expired', null);
      throw error;
    }
    })();
    confirmingActions.set(request.params.id, operation);
    try {
      return await operation;
    } finally {
      confirmingActions.delete(request.params.id);
    }
  });

  app.post<{ Params: { id: string } }>('/api/v1/assistant/actions/:id/cancel', async (request) => {
    const pending = conversations.pending(request.params.id);
    const action = conversations.setPendingStatus(pending.id, 'cancelled', null);
    const cardMessage = conversations.messages(pending.conversationId).find((message) => message.content.card?.actionId === pending.id);
    if (cardMessage !== undefined) conversations.updateCardStatus(cardMessage.id, action.status);
    return { action };
  });

  app.delete<{ Params: { id: string } }>('/api/v1/assistant/conversations/:id', async (request) => {
    conversations.archive(request.params.id);
    return { ok: true };
  });
}
