/** Resolve only displayed, server-owned import facts; comparison never runs a tool or writes. */
import type { Db } from '../db/index.js';
import { AssistantConversationService } from './assistant-conversation-service.js';
import { AssistantActionStaleError, AssistantValidationError } from './assistant-types.js';
import { PortabilityService } from './portability-service.js';

export class AssistantImportComparisonService {
  constructor(private readonly db: Db, private readonly dataDir: string, private readonly now: () => number) {}

  read(conversationId: string, actionId: string, rowId: string, limit: unknown, cursor: unknown) {
    const conversations = new AssistantConversationService(this.db, this.now);
    conversations.get(conversationId);
    const pending = conversations.pending(actionId);
    if (pending.conversationId !== conversationId || pending.status !== 'pending' || pending.toolName !== 'platform-import.prepare') throw new AssistantActionStaleError();
    const rows = pending.preview['rows'];
    const source = Array.isArray(rows) ? rows.slice(0, 200).find((row) => typeof row === 'object' && row !== null && !Array.isArray(row) && row['id'] === rowId) : undefined;
    if (source === undefined || typeof source !== 'object' || source === null || Array.isArray(source)) throw new AssistantValidationError('账单不在当前预览中，请重新上传并预览。');
    return new PortabilityService(this.db, { dataDir: this.dataDir }).duplicateCandidates(source, limit, cursor, this.now());
  }
}
