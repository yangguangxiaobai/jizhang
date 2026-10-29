/**
 * Pure identity, merge and ordering logic for the merged platform-bill import.
 *
 * No database, no provider, no clock: everything here is a function of the parsed rows plus the
 * caller-supplied digest and comparison-account inputs, so it is unit-testable and cannot drift
 * from the contract by accident.
 *
 * Contract (`research/merged-import-protocol-v1.md` §4):
 *   canonicalOrigin = (fullFileSha256, sourceRow)              — server only, never a client field
 *   strong (order id): groupKey = `po:{platform}:{full order id}`
 *                      itemId   = `po:{platform}:{sha256(canonicalJson([groupKey, ...facts]))[0:32]}`
 *                      ledgerId = `{wx|ali}-{externalId}`.slice(0,64)
 *   weak   (no order): rowSha   = sha256(canonicalJson([source, fileSha, sourceRow, day, type, amount, note, rawStatus, '']))
 *                      itemId   = `ch:{fileSha[0:32]}:{sourceRow}`
 *                      ledgerId = `pb-{source}-{rowSha[0:32]}`
 *
 * `financialEqual` deliberately ignores the note, the display `rawStatus` wording, the source
 * category, the counterparty and the goods: two exports of the same order may reword those.
 * It does include the full `sourceTimestamp`, because two rows with the same order id at
 * different minutes are not the same movement.
 */
import { createHash } from 'node:crypto';
import type { PlatformBillRow, PlatformBillSource } from '@jizhang/shared';
import type { ImportConflictKind, ImportIdentityKind } from './import-batch-types.js';

export function sha256Hex(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Deterministic JSON: object keys sorted, array order preserved. Used for every digest in this
 * feature so a reordered key can never look like a content change.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
}

export function digestOf(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

/** The parser's historical non-cryptographic id, kept only for advisory legacy matching. */
export function simpleHash(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i += 1) {
    const c = input.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= c + i;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
}

/**
 * The legacy `platform-bills.ts` ledger id, reproduced exactly (including `amountCents ?? 0`)
 * so a previously imported weak row is *recognised* — as an advisory notice, never as a lock.
 */
export function legacyLedgerId(source: PlatformBillSource, row: PlatformBillRow): string {
  const amount = row.amountCents ?? 0;
  return `pb-${source}-${simpleHash(`${row.dateLabel}|${row.type}|${amount}|${row.note}`)}`;
}

export function canonicalOrigin(fileSha256: string, sourceRow: number): string {
  return `${fileSha256}:${sourceRow}`;
}

/**
 * Semantic ledger status. Only "the platform did not complete this movement" counts as blocked;
 * the bookkeeping-rule ignores (中性交易 / 分类:X / 资金划转) describe a completed movement the
 * import rules do not book by default, and the user may still select such a row explicitly.
 */
export function ledgerStatusOf(ignoreReason: string | null): 'ok' | 'blocked' {
  if (ignoreReason === null) return 'ok';
  if (ignoreReason === '金额无效' || ignoreReason === '状态非成功' || ignoreReason.startsWith('状态:')) {
    return 'blocked';
  }
  return 'ok';
}

export interface IdentityInput {
  readonly fileIndex: number;
  readonly fileName: string;
  readonly fileSha256: string;
  readonly source: PlatformBillSource;
  readonly sourceRow: number;
  readonly comparisonAccountId: string | null;
  readonly fullExternalId: string | null;
  readonly row: PlatformBillRow;
}

/** Ledger id under the legacy `wx-`/`ali-` scheme: never truncated for comparison. */
export function strongLedgerId(source: PlatformBillSource, fullExternalId: string): string {
  return `${source === 'wechat' ? 'wx' : 'ali'}-${fullExternalId}`.slice(0, 64);
}

export function strongGroupKey(source: PlatformBillSource, fullExternalId: string): string {
  return `po:${source}:${fullExternalId}`;
}

export interface StrongIdentity {
  readonly kind: 'strong';
  readonly groupKey: string;
  readonly itemId: string;
  readonly ledgerId: string;
  readonly semanticKey: string;
}

export interface WeakIdentity {
  readonly kind: 'weak';
  readonly itemId: string;
  readonly ledgerId: string;
  readonly semanticKey: string;
}

export type RowIdentity = StrongIdentity | WeakIdentity;

/**
 * `financialEqual` — the ordered fact vector that decides whether two rows with the same order
 * id are the same movement. `itemId` digests this vector together with the group key, so a row
 * that is dropped from a conflict group does not change the ids of its surviving siblings.
 */
function strongFacts(input: IdentityInput): readonly (string | number | boolean | null)[] {
  const row = input.row;
  return [
    input.source,
    input.comparisonAccountId,
    row.type,
    row.sourceTimestamp ?? null,
    row.amountCents,
    row.isRefund ? 1 : 0,
    ledgerStatusOf(row.ignoreReason),
    input.fullExternalId,
  ];
}

export function identifyRow(input: IdentityInput): RowIdentity {
  const row = input.row;
  if (input.fullExternalId !== null && input.fullExternalId !== '') {
    const groupKey = strongGroupKey(input.source, input.fullExternalId);
    const facts = strongFacts(input);
    return {
      kind: 'strong',
      groupKey,
      // Shape is the frozen contract: `po:{platform}:{32 hex}`. The full order id and every
      // financial fact participate in the digest, so two different orders can never share an id.
      itemId: `po:${input.source}:${digestOf([groupKey, ...facts]).slice(0, 32)}`,
      ledgerId: strongLedgerId(input.source, input.fullExternalId),
      semanticKey: canonicalJson(['strong', groupKey, ...facts]),
    };
  }
  const rowSha = digestOf([
    input.source,
    input.fileSha256,
    input.sourceRow,
    row.dateLabel,
    row.type,
    row.amountCents,
    row.note,
    row.rawStatus,
    '',
  ]);
  return {
    kind: 'weak',
    itemId: `ch:${input.fileSha256.slice(0, 32)}:${input.sourceRow}`,
    ledgerId: `pb-${input.source}-${rowSha.slice(0, 32)}`,
    semanticKey: canonicalJson(['weak', input.fileSha256, input.sourceRow]),
  };
}

export interface MergedSourceRef {
  readonly fileName: string;
  readonly fileIndex: number;
  readonly sourceRow: number;
  readonly source: PlatformBillSource;
  /** `sha256:sourceRow` of this specific row — the canonical origin used for draft migration. */
  readonly origin: string;
  readonly note: string;
  readonly rawStatus: string;
  readonly ignoreReason: string | null;
}

export interface MergedItem {
  itemId: string;
  ledgerId: string;
  identityKind: ImportIdentityKind;
  canonicalOrigin: string;
  semanticKey: string;
  groupKey: string | null;
  comparisonAccountId: string | null;
  dateLabel: string;
  type: number;
  amountCents: number;
  sourceTimestamp: string | null;
  note: string;
  /** Parser source category: display/analysis only, excluded from financial equality. */
  sourceCategory: string;
  isRefund: boolean;
  refundWarning: string | null;
  rawStatus: string;
  ignored: boolean;
  ignoreReason: string | null;
  existing: boolean;
  possibleDuplicate: boolean;
  duplicateOfNote: string | null;
  legacyLedgerId: string;
  legacyLedgerMatch: boolean;
  sources: MergedSourceRef[];
  noteAlternatives: { fileName: string; note: string }[];
  fileIndex: number;
  sourceRow: number;
  conflictGroup: string | null;
  conflictKind: ImportConflictKind | null;
  weakDuplicateGroup: string | null;
  ordinal: number;
}

export interface MergeInputs {
  /** Every existing `transactions.id`; decides hard `alreadyExists`. */
  readonly existingIds: ReadonlySet<string>;
  /** Note of an existing legacy `pb-…` row, by id (advisory hint only). */
  readonly ledgerNotesById: Readonly<Record<string, string>>;
}

export interface MergeResult {
  readonly items: MergedItem[];
  readonly mergedGroups: number;
  readonly conflictGroups: number;
  readonly weakDuplicateGroups: number;
  readonly legacyLedgerMatches: number;
}

/**
 * Merges parsed rows into the review list: strong identities with identical facts collapse into
 * one item that keeps every source, everything else stays its own item. Conflicts are marked
 * (`fact_conflict`, `ledger_collision`, `weak_collision`) rather than resolved.
 */
export function mergeRows(inputs: readonly IdentityInput[], merge: MergeInputs): MergeResult {
  const groups = new Map<string, { identity: RowIdentity; members: IdentityInput[] }>();
  const order: string[] = [];
  for (const input of inputs) {
    const identity = identifyRow(input);
    const key = identity.kind === 'strong' ? `${identity.groupKey}\u0000${identity.semanticKey}` : identity.itemId;
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, { identity, members: [input] });
      order.push(key);
    } else {
      existing.members.push(input);
    }
  }

  const items: MergedItem[] = [];
  let mergedGroups = 0;
  for (const key of order) {
    const group = groups.get(key)!;
    const identity = group.identity;
    const first = group.members[0]!;
    const row = first.row;
    if (group.members.length > 1) mergedGroups += 1;

    const legacyId = legacyLedgerId(first.source, row);
    const legacyHit = merge.existingIds.has(legacyId);
    const item: MergedItem = {
      itemId: identity.itemId,
      ledgerId: identity.ledgerId,
      identityKind: identity.kind === 'strong' ? 'platform_order' : 'occurrence',
      canonicalOrigin: canonicalOrigin(first.fileSha256, first.sourceRow),
      semanticKey: identity.semanticKey,
      groupKey: identity.kind === 'strong' ? identity.groupKey : null,
      comparisonAccountId: first.comparisonAccountId,
      dateLabel: row.dateLabel,
      type: row.type,
      amountCents: row.amountCents,
      sourceTimestamp: row.sourceTimestamp ?? null,
      note: row.note,
      sourceCategory: row.sourceCategory,
      isRefund: row.isRefund,
      refundWarning: row.refundWarning,
      rawStatus: row.rawStatus,
      ignored: row.ignored,
      ignoreReason: row.ignoreReason,
      existing: merge.existingIds.has(identity.ledgerId),
      possibleDuplicate: false,
      duplicateOfNote: null,
      legacyLedgerId: legacyId,
      legacyLedgerMatch: legacyHit,
      sources: group.members.map((member) => ({
        fileName: member.fileName,
        fileIndex: member.fileIndex,
        sourceRow: member.sourceRow,
        source: member.source,
        origin: canonicalOrigin(member.fileSha256, member.sourceRow),
        note: member.row.note,
        rawStatus: member.row.rawStatus,
        ignoreReason: member.row.ignoreReason,
      })),
      noteAlternatives: group.members
        .filter((member, index) => index > 0 && member.row.note !== row.note)
        .map((member) => ({ fileName: member.fileName, note: member.row.note })),
      fileIndex: first.fileIndex,
      sourceRow: first.sourceRow,
      conflictGroup: null,
      conflictKind: null,
      weakDuplicateGroup: null,
      ordinal: 0,
    };
    if (legacyHit) {
      item.possibleDuplicate = true;
      item.duplicateOfNote = merge.ledgerNotesById[legacyId] ?? null;
    }
    items.push(item);
  }

  markLedgerCollisions(items);
  const weakDuplicateGroups = markWeakCollisions(items);
  const conflictGroups = markFactConflicts(items);

  items.sort(compareItems);
  items.forEach((item, index) => {
    item.ordinal = index;
  });

  return {
    items,
    mergedGroups,
    conflictGroups,
    weakDuplicateGroups,
    legacyLedgerMatches: items.filter((item) => item.legacyLedgerMatch).length,
  };
}

/**
 * `ledger_collision`: two *different* full semantic keys landing on one ledger id. Distinct
 * sources of the same strong facts are a normal merge, never a collision.
 */
function markLedgerCollisions(items: MergedItem[]): void {
  const byLedgerId = new Map<string, MergedItem[]>();
  for (const item of items) {
    // Only a platform order id can collide by truncation; an occurrence ledger id is a digest
    // and its own duplicate case (`weak_collision`) is handled separately below.
    if (item.groupKey === null) continue;
    const bucket = byLedgerId.get(item.ledgerId);
    if (bucket === undefined) byLedgerId.set(item.ledgerId, [item]);
    else bucket.push(item);
  }
  for (const [, bucket] of byLedgerId) {
    // Same order id with different facts is a *fact conflict*, not a ledger collision, and it is
    // decided (0 or 1) by the user rather than rejected outright.
    const groups = new Set(bucket.map((item) => item.groupKey));
    if (groups.size < 2) continue;
    for (const item of bucket) {
      item.conflictKind = 'ledger_collision';
      item.conflictGroup = `lc:${item.ledgerId}`;
    }
  }
}

/** `weak_collision`: one occurrence ledger id mapping to more than one item id. */
function markWeakCollisions(items: MergedItem[]): number {
  const byLedgerId = new Map<string, Set<string>>();
  for (const item of items) {
    if (item.identityKind !== 'occurrence' || item.conflictKind !== null) continue;
    const bucket = byLedgerId.get(item.ledgerId);
    if (bucket === undefined) byLedgerId.set(item.ledgerId, new Set([item.itemId]));
    else bucket.add(item.itemId);
  }
  let groups = 0;
  for (const [ledgerId, itemIds] of byLedgerId) {
    if (itemIds.size < 2) continue;
    groups += 1;
    for (const item of items) {
      if (item.ledgerId !== ledgerId || item.identityKind !== 'occurrence' || item.conflictKind !== null) continue;
      item.conflictKind = 'weak_collision';
      item.conflictGroup = `wc:${ledgerId}`;
    }
  }
  return groups;
}

/**
 * `fact_conflict`: one strong group whose members disagree on the financial facts. Every member
 * of the group is marked, so the decision is "choose at most one, or exclude the whole group".
 */
function markFactConflicts(items: MergedItem[]): number {
  const byGroup = new Map<string, MergedItem[]>();
  for (const item of items) {
    if (item.groupKey === null) continue;
    const bucket = byGroup.get(item.groupKey);
    if (bucket === undefined) byGroup.set(item.groupKey, [item]);
    else bucket.push(item);
  }
  let groups = 0;
  for (const [groupKey, bucket] of byGroup) {
    if (bucket.length < 2) continue;
    groups += 1;
    const group = `fc:${groupKey}`;
    for (const item of bucket) {
      if (item.conflictKind === 'ledger_collision') continue;
      item.conflictKind = 'fact_conflict';
      item.conflictGroup = group;
    }
  }
  return groups;
}

/** `dateLabel` desc → `fileIndex` asc → `sourceRow` asc → `itemId` asc. */
export function compareItems(a: MergedItem, b: MergedItem): number {
  if (a.dateLabel !== b.dateLabel) return a.dateLabel < b.dateLabel ? 1 : -1;
  if (a.fileIndex !== b.fileIndex) return a.fileIndex - b.fileIndex;
  if (a.sourceRow !== b.sourceRow) return a.sourceRow - b.sourceRow;
  return a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0;
}

/** True when the two items are provably the same movement (same strong facts, same origin). */
export function financialEqual(a: MergedItem, b: MergedItem): boolean {
  return a.semanticKey === b.semanticKey;
}

/**
 * Collision guard: two items sharing an item id must share the same full semantic key. Callers
 * reject the whole batch when this fails rather than assuming a truncated digest cannot collide.
 */
export function itemIdCollisions(items: readonly MergedItem[]): string[] {
  const byId = new Map<string, Set<string>>();
  for (const item of items) {
    const bucket = byId.get(item.itemId);
    if (bucket === undefined) byId.set(item.itemId, new Set([item.semanticKey]));
    else bucket.add(item.semanticKey);
  }
  return [...byId.entries()].filter(([, keys]) => keys.size > 1).map(([itemId]) => itemId);
}
