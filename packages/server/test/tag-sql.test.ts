import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { rawTagTokensSql } from '../src/services/tag-sql.js';

describe('raw tag JSON token scanner', () => {
  it('extracts only top-level array strings and preserves escaped UTF-16 source tokens on bundled SQLite', () => {
    const db = new Database(':memory:');
    try {
      expect((db.prepare('SELECT sqlite_version() AS version').get() as { version: string }).version).toBe('3.53.2');
      const query = `WITH RECURSIVE ${rawTagTokensSql('?')} SELECT position, raw FROM tag_tokens ORDER BY position`;
      const cases = [
        '["a",3,{"nested":"ignored"},["ignored"],"\\ud83d"]',
        JSON.stringify(['x"y', '\\', '/', '\b\f\n\r\t', '\u0000', '😀']),
        '["astral 😀", "é", "\u00a0trim\u3000"]',
        '[]',
        '[true,false,null,0,{},[]]',
      ];
      for (const rawJson of cases) {
        const decoded: unknown = JSON.parse(rawJson);
        const expected = Array.isArray(decoded)
          ? decoded.filter((value): value is string => typeof value === 'string')
          : [];
        const actual = db.prepare(query).all(rawJson) as { position: number; raw: string }[];
        const recovered = actual.map(({ raw }) => JSON.parse(`"${raw}"`) as string);
        expect(recovered).toEqual(expected);
        expect(actual.map(({ position }) => position)).toEqual(expected.map((_, index) => index));
      }
      expect(db.prepare(query).all('{"not":"array"}')).toEqual([]);
      expect(db.prepare(query).all('["unterminated')).toEqual([]);
      expect(db.prepare(query).all('"root string"')).toEqual([]);
    } finally {
      db.close();
    }
  });
});
