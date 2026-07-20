CREATE TABLE tournament_shares (
  tournament_id TEXT PRIMARY KEY REFERENCES tournaments(id) ON DELETE CASCADE,
  share_token TEXT NOT NULL UNIQUE,
  is_open INTEGER NOT NULL DEFAULT 1 CHECK (is_open IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_tournament_shares_open_updated
  ON tournament_shares(is_open, updated_at DESC);
