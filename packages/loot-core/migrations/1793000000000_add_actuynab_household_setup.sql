-- Synced ActuYNAB household configuration. This records account roles and
-- template state only; financial amounts stay in Actual's existing ledgers.
CREATE TABLE IF NOT EXISTS actuynab_household_profiles (
  id TEXT PRIMARY KEY,
  category_template_applied INTEGER DEFAULT 0,
  updated_at TEXT,
  tombstone INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS actuynab_household_account_roles (
  id TEXT PRIMARY KEY,
  profile_id TEXT,
  account_id TEXT,
  role_key TEXT,
  role TEXT,
  transfer_description_tokens TEXT,
  tombstone INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_actuynab_household_account_roles_profile
  ON actuynab_household_account_roles(profile_id, role_key);
