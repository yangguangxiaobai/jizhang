/** SQL-side canonicalization of legacy tag JSON without passing decoded strings through SQLite TEXT. */
export function rawTagTokensSql(jsonExpression: string, prefix = 'tag_tokens'): string {
  const input = `${prefix}_input`;
  const scan = `${prefix}_scan`;
  return `
    ${input}(source) AS (SELECT ${jsonExpression}),
    ${scan}(pos, depth, quoted, escaped, token_start, emitted_start, emitted_end) AS (
      SELECT 1, 0, 0, 0, 0, 0, 0
      UNION ALL
      SELECT pos + 1,
        CASE WHEN quoted = 1 THEN depth WHEN substr((SELECT source FROM ${input}),pos,1) IN ('[','{') THEN depth+1 WHEN substr((SELECT source FROM ${input}),pos,1) IN (']','}') THEN depth-1 ELSE depth END,
        CASE WHEN quoted=1 AND escaped=0 AND substr((SELECT source FROM ${input}),pos,1)='"' THEN 0 WHEN quoted=0 AND substr((SELECT source FROM ${input}),pos,1)='"' THEN 1 ELSE quoted END,
        CASE WHEN quoted=1 AND escaped=0 AND substr((SELECT source FROM ${input}),pos,1)=char(92) THEN 1 WHEN escaped=1 THEN 0 ELSE 0 END,
        CASE WHEN quoted=0 AND depth=1 AND substr((SELECT source FROM ${input}),pos,1)='"' THEN pos+1 WHEN quoted=1 AND escaped=0 AND substr((SELECT source FROM ${input}),pos,1)='"' AND token_start>0 THEN 0 ELSE token_start END,
        CASE WHEN quoted=1 AND escaped=0 AND substr((SELECT source FROM ${input}),pos,1)='"' AND token_start>0 THEN token_start ELSE 0 END,
        CASE WHEN quoted=1 AND escaped=0 AND substr((SELECT source FROM ${input}),pos,1)='"' AND token_start>0 THEN pos ELSE 0 END
      FROM ${scan} WHERE pos<=length((SELECT source FROM ${input}))
    ),
    ${prefix}(position, raw) AS (
      SELECT ROW_NUMBER() OVER (ORDER BY emitted_start)-1, substr((SELECT source FROM ${input}),emitted_start,emitted_end-emitted_start)
      FROM ${scan} WHERE emitted_end>0 AND json_valid((SELECT source FROM ${input})) AND json_type((SELECT source FROM ${input}))='array'
    )
  `;
}

/**
 * Adds canonical tag entries (position,key,encoded_name) to a WITH RECURSIVE chain.
 * Every decoded UTF-16 code unit is retained as ASCII hex/JSON escape data; no name
 * with a lone surrogate is ever bound to SQLite as TEXT.
 */
export function canonicalTagEntriesSql(jsonExpression: string, prefix = 'tag_canonical'): string {
  const tokens = `${prefix}_tokens`;
  const chars = `${prefix}_chars`;
  const units = `${prefix}_units`;
  const bounds = `${prefix}_bounds`;
  const canonical = `${prefix}_canonical`;
  const unique = `${prefix}_unique`;
  const limited = `${prefix}_limited`;
  return `
    ${rawTagTokensSql(jsonExpression, tokens)},
    ${chars}(token_pos, raw, pos, unit_cursor, unit_pos, unit, extra_unit) AS (
      SELECT position, raw, 1, 0, 0, 0, 0 FROM ${tokens}
      UNION ALL
      SELECT token_pos, raw,
        pos + CASE WHEN substr(raw,pos,1)=char(92) AND substr(raw,pos+1,1)='u' THEN 6 WHEN substr(raw,pos,1)=char(92) THEN 2 ELSE 1 END,
        unit_cursor + CASE WHEN substr(raw,pos,1)<>char(92) AND hex(CAST(substr(raw,pos,1) AS BLOB)) NOT IN ('EFBFBE','EFBFBF') AND unicode(substr(raw,pos,1))>65535 THEN 2 ELSE 1 END,
        unit_cursor + 1,
        CASE
          WHEN substr(raw,pos,1)=char(92) AND substr(raw,pos+1,1)='u' THEN
            (instr('0123456789abcdef',lower(substr(raw,pos+2,1)))-1)*4096 +
            (instr('0123456789abcdef',lower(substr(raw,pos+3,1)))-1)*256 +
            (instr('0123456789abcdef',lower(substr(raw,pos+4,1)))-1)*16 +
            (instr('0123456789abcdef',lower(substr(raw,pos+5,1)))-1)
          WHEN substr(raw,pos,1)=char(92) AND substr(raw,pos+1,1)='"' THEN 34
          WHEN substr(raw,pos,1)=char(92) AND substr(raw,pos+1,1)=char(92) THEN 92
          WHEN substr(raw,pos,1)=char(92) AND substr(raw,pos+1,1)='/' THEN 47
          WHEN substr(raw,pos,1)=char(92) AND substr(raw,pos+1,1)='b' THEN 8
          WHEN substr(raw,pos,1)=char(92) AND substr(raw,pos+1,1)='f' THEN 12
          WHEN substr(raw,pos,1)=char(92) AND substr(raw,pos+1,1)='n' THEN 10
          WHEN substr(raw,pos,1)=char(92) AND substr(raw,pos+1,1)='r' THEN 13
          WHEN substr(raw,pos,1)=char(92) AND substr(raw,pos+1,1)='t' THEN 9
          WHEN hex(CAST(substr(raw,pos,1) AS BLOB))='EFBFBE' THEN 65534
          WHEN hex(CAST(substr(raw,pos,1) AS BLOB))='EFBFBF' THEN 65535
          WHEN unicode(substr(raw,pos,1))>65535 THEN 55296 + ((unicode(substr(raw,pos,1))-65536) >> 10)
          ELSE unicode(substr(raw,pos,1)) END,
        CASE WHEN substr(raw,pos,1)=char(92) OR hex(CAST(substr(raw,pos,1) AS BLOB)) IN ('EFBFBE','EFBFBF') OR unicode(substr(raw,pos,1))<=65535 THEN 0 ELSE 56320 + ((unicode(substr(raw,pos,1))-65536) & 1023) END
      FROM ${chars} WHERE pos<=length(raw)
    ),
    ${units}(token_pos,unit_pos,unit) AS (
      SELECT token_pos,unit_pos,unit FROM ${chars} WHERE pos>1
      UNION ALL
      SELECT token_pos,unit_pos+1,extra_unit FROM ${chars} WHERE pos>1 AND extra_unit>0
    ),
    ${bounds}(token_pos, first_pos, last_pos) AS (
      SELECT token_pos,
        MIN(CASE WHEN unit NOT IN (9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279) THEN unit_pos END),
        MAX(CASE WHEN unit NOT IN (9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279) THEN unit_pos END)
      FROM ${units} GROUP BY token_pos
    ),
    ${canonical}(position,key,encoded_name) AS (
      SELECT token_pos,
        (SELECT group_concat(printf('%04x',unit),'') FROM (SELECT unit FROM ${units} u WHERE u.token_pos=b.token_pos AND u.unit_pos BETWEEN b.first_pos AND MIN(b.last_pos,b.first_pos+31) ORDER BY unit_pos)),
        '"' || (SELECT group_concat('\\u' || printf('%04x',unit),'') FROM (SELECT unit FROM ${units} u WHERE u.token_pos=b.token_pos AND u.unit_pos BETWEEN b.first_pos AND MIN(b.last_pos,b.first_pos+31) ORDER BY unit_pos)) || '"'
      FROM ${bounds} b WHERE first_pos IS NOT NULL
    ),
    ${unique}(position,key,encoded_name,ordinal) AS (
      SELECT position,key,encoded_name,ROW_NUMBER() OVER (ORDER BY position) FROM (
        SELECT position,key,encoded_name,ROW_NUMBER() OVER (PARTITION BY key ORDER BY position) AS duplicate_number FROM ${canonical}
      ) WHERE duplicate_number=1
    ),
    ${limited}(position,key,encoded_name) AS (
      SELECT ROW_NUMBER() OVER (ORDER BY position)-1,key,encoded_name FROM ${unique} WHERE ordinal<=20
    )
  `;
}
