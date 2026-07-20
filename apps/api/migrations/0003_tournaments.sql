CREATE TABLE tournaments (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL UNIQUE REFERENCES tournament_drafts(id) ON DELETE RESTRICT,
  snapshot_id TEXT NOT NULL REFERENCES playlist_snapshots(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 20),
  status TEXT NOT NULL CHECK (status IN ('in_progress', 'finished')),
  progress_json TEXT NOT NULL,
  access_token_hash TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX idx_tournaments_status_updated
  ON tournaments(status, updated_at DESC);
