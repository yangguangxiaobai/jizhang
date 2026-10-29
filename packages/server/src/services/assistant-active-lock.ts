/**
 * Conversation-scoped exclusion for *actual AI work*.
 *
 * Three callers share one conversation: v1 streamed generations, legacy assistant turns
 * (message send / legacy import analyse) and merged-batch analysis. Provider work must not run
 * twice in one conversation, so all three take this lock; pure reads, review and confirmation
 * never do (they perform no provider work).
 *
 * The live-generation check reads `assistant_generations` rather than the in-memory service so
 * a lock shared by two route modules observes exactly the same state.
 */
import type { Db } from '../db/index.js';

export type ActiveTurnKind = 'legacy' | 'batch';

export class ConversationActiveLock {
  private readonly turns = new Map<string, Map<ActiveTurnKind, number>>();

  constructor(private readonly db: Db) {}

  private generationActive(conversationId: string): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 AS x FROM assistant_generations
          WHERE conversation_id = ? AND status IN ('accepted', 'running')
          LIMIT 1`,
      )
      .get(conversationId) as { x: number } | undefined;
    return row !== undefined;
  }

  private count(conversationId: string): number {
    let total = 0;
    for (const value of this.turns.get(conversationId)?.values() ?? []) total += value;
    return total;
  }

  /** True when any provider work (generation or locked turn) is live for this conversation. */
  active(conversationId: string): boolean {
    return this.generationActive(conversationId) || this.count(conversationId) > 0;
  }

  hasGeneration(conversationId: string): boolean {
    return this.generationActive(conversationId);
  }

  /** True when merged-batch analysis currently holds the lock for this conversation. */
  batchActive(conversationId: string): boolean {
    return (this.turns.get(conversationId)?.get('batch') ?? 0) > 0;
  }

  /** True when a legacy assistant turn currently holds the lock for this conversation. */
  legacyActive(conversationId: string): boolean {
    return (this.turns.get(conversationId)?.get('legacy') ?? 0) > 0;
  }

  /**
   * Claims the conversation for one kind of provider work. Returns false when anything is
   * already live, so the caller answers `ASSISTANT_GENERATION_ACTIVE`.
   */
  begin(conversationId: string, kind: ActiveTurnKind): boolean {
    if (this.active(conversationId)) return false;
    const map = this.turns.get(conversationId) ?? new Map<ActiveTurnKind, number>();
    map.set(kind, (map.get(kind) ?? 0) + 1);
    this.turns.set(conversationId, map);
    return true;
  }

  /** Releases one claim; safe to call more times than `begin` succeeded. */
  end(conversationId: string, kind: ActiveTurnKind): void {
    const map = this.turns.get(conversationId);
    if (map === undefined) return;
    const next = (map.get(kind) ?? 1) - 1;
    if (next <= 0) map.delete(kind);
    else map.set(kind, next);
    if (map.size === 0) this.turns.delete(conversationId);
  }
}
