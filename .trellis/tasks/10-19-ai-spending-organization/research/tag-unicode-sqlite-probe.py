"""Local SQLite-only probe for UTF-16 tag keys; no product dependencies."""
import json
import sqlite3

MAX_UNITS = 32
TRIM_SET = "char(32,9,10,11,12,13,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)"

# A bounded sequence of Unicode scalar positions is enough: 32 UTF-16 units
# can never need more than 32 Unicode scalar positions.
SQL = f"""
WITH RECURSIVE
seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < {MAX_UNITS}),
source AS (
  SELECT key AS item_index, trim(value, {TRIM_SET}) AS name
  FROM json_each(?) WHERE type = 'text'
),
chars AS (
  SELECT s.item_index, seq.n,
         hex(CAST(substr(s.name, seq.n, 1) AS BLOB)) AS char_hex,
         unicode(substr(s.name, seq.n, 1)) AS scalar
  FROM source s JOIN seq ON seq.n <= length(s.name)
),
units AS (
  SELECT item_index, n, char_hex, scalar,
         CASE WHEN substr(char_hex,1,2)='ED'
                   AND substr(char_hex,3,1) IN ('A','B')
                   AND substr(char_hex,5,1) IN ('8','9','A','B','C','D','E','F')
              THEN 1 ELSE 0 END AS is_lone_surrogate,
         CASE WHEN substr(char_hex,1,2)='ED'
                   AND substr(char_hex,3,1) IN ('A','B')
                   AND substr(char_hex,5,1) IN ('8','9','A','B','C','D','E','F')
              THEN 55296 +
                ((((instr('0123456789ABCDEF',substr(char_hex,3,1))-1)*16+
                    instr('0123456789ABCDEF',substr(char_hex,4,1))-1)-160)*64) +
                (((instr('0123456789ABCDEF',substr(char_hex,5,1))-1)*16+
                    instr('0123456789ABCDEF',substr(char_hex,6,1))-1)-128)
              ELSE scalar END AS effective_scalar
  FROM chars
),
counted AS (
  SELECT *,
         CASE WHEN is_lone_surrogate=1 THEN 1 WHEN effective_scalar>65535 THEN 2 ELSE 1 END AS width,
         COALESCE(SUM(CASE WHEN is_lone_surrogate=1 OR effective_scalar<=65535 THEN 1 ELSE 2 END)
           OVER (PARTITION BY item_index ORDER BY n ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS before_units
  FROM units
),
encoded AS (
  SELECT item_index, n, before_units, width,
    CASE
      WHEN is_lone_surrogate=1 THEN printf('%04x', effective_scalar)
      WHEN effective_scalar<=65535 THEN printf('%04x', effective_scalar)
      WHEN before_units < {MAX_UNITS}-1 THEN printf('%04x%04x',
        55296+((effective_scalar-65536)>>10), 56320+((effective_scalar-65536)&1023))
      ELSE printf('%04x', 55296+((effective_scalar-65536)>>10))
    END AS units_hex
  FROM counted
  WHERE before_units < {MAX_UNITS}
)
SELECT item_index, lower(group_concat(units_hex, '')) AS utf16_key
FROM (SELECT * FROM encoded ORDER BY item_index, n)
GROUP BY item_index
ORDER BY item_index
"""


def utf16_key(text: str) -> str:
    # JS String.slice(0, 32) cuts UTF-16 code units, not Python code points.
    return text.encode("utf-16-be", "surrogatepass")[: MAX_UNITS * 2].hex()


def main() -> None:
    con = sqlite3.connect(":memory:")
    con.text_factory = bytes
    print("SQLite", sqlite3.sqlite_version)
    cases = [
        ("31 BMP then astral", ["A" * 31 + "😀Z"]),
        ("16 astral then suffix", ["😀" * 16 + "X"]),
        ("20 astral then tail", ["😀" * 20 + "tail"]),
        ("escaped lone high surrogate", ["\ud83d"]),
        ("escaped lone low surrogate", ["\ude00"]),
        ("escaped valid pair", ["\ud83d\ude00"]),
        ("literal astral", ["😀"]),
        ("Unicode trim", ["\u00a0x\u3000"]),
        ("non-string members", ["x", 3, None, {}, ["y"]]),
        ("empty after trim", ["\u00a0\u3000"]),
    ]
    for label, arr in cases:
        # Keep JSON source ASCII so escaped surrogates are explicitly tested.
        raw = json.dumps(arr, ensure_ascii=True, separators=(",", ":")).encode("ascii")
        result = con.execute(SQL, (raw,)).fetchall()
        print(f"{label}: raw={raw!r}")
        for index, key in result:
            print(f"  item={index}, sqlite_utf16_key={key.decode('ascii')}")
        expected = []
        for item in arr:
            if isinstance(item, str):
                name = item.strip()
                if name:
                    expected.append(utf16_key(name[:MAX_UNITS]))
        print(f"  JS_utf16_keys={expected}")
        assert [k.decode("ascii") for _, k in result] == expected, label

    # Verify the distinction from code-point substr and exact output cap.
    value = "A" * 31 + "😀Z"
    cp_cap = con.execute(
        "SELECT hex(CAST(substr(value,1,32) AS BLOB)) FROM json_each(?) WHERE type='text'",
        (json.dumps([value], ensure_ascii=True),),
    ).fetchone()[0].decode("ascii")
    print("31-BMP + astral: substr(...,1,32) codepoint UTF-8 bytes =", cp_cap)
    print("31-BMP + astral: JS UTF-16 key =", utf16_key(value[:32]))


if __name__ == "__main__":
    main()
