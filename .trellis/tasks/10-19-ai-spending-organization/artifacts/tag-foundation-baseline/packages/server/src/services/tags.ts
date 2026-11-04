/**
 * Tag parsing and serialisation.
 *
 * Transcribed from the reference implementation's `Transaction.parseTags`
 * (`lib/data/models/transaction.dart:108-126`): trim each entry, drop empties,
 * **de-duplicate while preserving first-seen order**, and treat malformed JSON as
 * "no tags" rather than throwing.
 *
 * Tags are stored as a JSON array of NAMES in `transactions.tags_json` — the name
 * is the identity, so there is no tags table (design.md §3). Every place that reads
 * or rewrites tags must go through this module, otherwise the de-duplication rule
 * drifts between call sites.
 */

/** Longest accepted tag, in characters. Guards against a pasted wall of text. */
export const MAX_TAG_LENGTH = 32;

/** Maximum number of tags on one transaction. */
export const MAX_TAGS = 20;

/**
 * Normalises a tag list: trim, drop empties, de-duplicate preserving order, and
 * cap the count and per-tag length.
 */
export function normaliseTags(input: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const item of input) {
    if (typeof item !== 'string') continue;
    const name = item.trim();
    if (name === '') continue;
    const capped = name.slice(0, MAX_TAG_LENGTH);
    if (seen.has(capped)) continue;

    seen.add(capped);
    out.push(capped);
    if (out.length >= MAX_TAGS) break;
  }

  return out;
}

/** Parses the stored `tags_json` column. Never throws. */
export function parseTagsJson(raw: unknown): string[] {
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  try {
    const decoded: unknown = JSON.parse(raw);
    if (!Array.isArray(decoded)) return [];
    return normaliseTags(decoded);
  } catch {
    return [];
  }
}

/** Serialises a tag list for `tags_json`. */
export function serialiseTags(tags: readonly string[]): string {
  return JSON.stringify(normaliseTags(tags));
}

/** Tag name plus how many transactions reference it (management view, T7). */
export interface TagCount {
  readonly name: string;
  readonly count: number;
}
