/** Migration 010 — independent owned-item records and bounded item photos. */
export const MIGRATION_010_ITEM_ASSETS = `
CREATE TABLE asset_items (
  id                         TEXT    PRIMARY KEY,
  name                       TEXT    NOT NULL,
  category                   TEXT    NOT NULL DEFAULT '其他',
  brand                      TEXT    NOT NULL DEFAULT '',
  model                      TEXT    NOT NULL DEFAULT '',
  note                       TEXT    NOT NULL DEFAULT '',
  purchase_price_cents       INTEGER,
  purchase_date              INTEGER NOT NULL,
  status                     TEXT    NOT NULL DEFAULT 'active'
                                     CHECK (status IN ('active', 'idle', 'sold', 'retired')),
  closed_date                INTEGER,
  sale_price_cents           INTEGER,
  purchase_transaction_id    TEXT,
  sale_transaction_id        TEXT,
  deleted                    INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
  created_at                 INTEGER NOT NULL,
  updated_at                 INTEGER NOT NULL,
  CHECK (purchase_price_cents IS NULL OR purchase_price_cents >= 0),
  CHECK (sale_price_cents IS NULL OR sale_price_cents >= 0),
  CHECK (
    (status IN ('active', 'idle')
      AND closed_date IS NULL
      AND sale_price_cents IS NULL
      AND sale_transaction_id IS NULL)
    OR (status = 'sold' AND closed_date IS NOT NULL)
    OR (status = 'retired'
      AND closed_date IS NOT NULL
      AND sale_price_cents IS NULL
      AND sale_transaction_id IS NULL)
  )
);

CREATE INDEX idx_asset_items_live_status_date
  ON asset_items(deleted, status, purchase_date DESC, updated_at DESC);
CREATE INDEX idx_asset_items_live_category
  ON asset_items(deleted, category, purchase_date DESC);
CREATE INDEX idx_asset_items_purchase_transaction
  ON asset_items(purchase_transaction_id);
CREATE INDEX idx_asset_items_sale_transaction
  ON asset_items(sale_transaction_id);

CREATE TABLE asset_item_photos (
  item_id     TEXT    PRIMARY KEY,
  mime_type   TEXT    NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  image_bytes BLOB    NOT NULL CHECK (length(image_bytes) BETWEEN 1 AND 2097152),
  updated_at  INTEGER NOT NULL
);
`;
