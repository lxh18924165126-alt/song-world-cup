CREATE TABLE oauth_states (
  state_hash TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('wechat', 'qq')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX idx_oauth_states_expiry ON oauth_states(expires_at);
