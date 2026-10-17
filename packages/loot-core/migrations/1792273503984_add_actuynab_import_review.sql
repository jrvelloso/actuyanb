-- Synced ActuYNAB import-review metadata. These tables deliberately retain
-- identifiers, aggregate audit data, and classification decisions only: never
-- the source bank file or its raw rows.
CREATE TABLE IF NOT EXISTS actuynab_import_batches (
  id TEXT PRIMARY KEY,
  account_id TEXT,
  source_bank TEXT,
  source_format TEXT,
  created_at TEXT,
  source_fingerprint TEXT,
  parsed INTEGER DEFAULT 0,
  imported INTEGER DEFAULT 0,
  updated INTEGER DEFAULT 0,
  duplicate INTEGER DEFAULT 0,
  skipped INTEGER DEFAULT 0,
  failed INTEGER DEFAULT 0,
  warnings INTEGER DEFAULT 0,
  confirmed_count INTEGER DEFAULT 0,
  review_status TEXT,
  processing_errors TEXT,
  tombstone INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS actuynab_import_review_items (
  id TEXT PRIMARY KEY,
  batch_id TEXT,
  transaction_id TEXT,
  possible_duplicate INTEGER DEFAULT 0,
  tombstone INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS actuynab_review_decisions (
  id TEXT PRIMARY KEY,
  batch_id TEXT,
  transaction_id TEXT,
  normalized_payee TEXT,
  payee_id TEXT,
  category_id TEXT,
  decision TEXT,
  reason TEXT,
  confidence TEXT,
  applied INTEGER DEFAULT 0,
  requires_manual_review INTEGER DEFAULT 0,
  created_at TEXT,
  tombstone INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_actuynab_import_batches_account
  ON actuynab_import_batches(account_id, created_at);
CREATE INDEX IF NOT EXISTS idx_actuynab_import_review_items_batch
  ON actuynab_import_review_items(batch_id);
CREATE INDEX IF NOT EXISTS idx_actuynab_review_decisions_payee
  ON actuynab_review_decisions(normalized_payee);
