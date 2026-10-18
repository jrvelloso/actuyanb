-- Synced, user-verified financing allocation metadata. Actual transactions
-- remain the only records that move money or change account balances.
CREATE TABLE IF NOT EXISTS actuynab_financing_installments (
  id TEXT PRIMARY KEY,
  account_id TEXT,
  payment_transaction_id TEXT,
  principal_transaction_id TEXT,
  insurance_transaction_id TEXT,
  payment_amount INTEGER,
  principal_amount INTEGER,
  interest_amount INTEGER,
  insurance_amount INTEGER,
  payment_direction TEXT,
  insurance_is_separate INTEGER DEFAULT 0,
  payment_date TEXT,
  created_at TEXT,
  updated_at TEXT,
  tombstone INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_actuynab_financing_installments_account
  ON actuynab_financing_installments(account_id, payment_date);

CREATE INDEX IF NOT EXISTS idx_actuynab_financing_installments_payment
  ON actuynab_financing_installments(payment_transaction_id);
