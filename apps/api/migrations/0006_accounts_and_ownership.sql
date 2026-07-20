CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('wechat', 'qq')),
  provider_subject TEXT NOT NULL,
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 40),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(provider, provider_subject)
);

CREATE TABLE auth_sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

ALTER TABLE tournaments ADD COLUMN owner_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL;

CREATE INDEX idx_tournaments_owner_updated
  ON tournaments(owner_account_id, updated_at DESC);

CREATE INDEX idx_auth_sessions_account_expiry
  ON auth_sessions(account_id, expires_at DESC);
