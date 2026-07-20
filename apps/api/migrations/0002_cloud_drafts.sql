CREATE TABLE tournament_drafts (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL REFERENCES playlist_snapshots(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 20),
  scale_mode TEXT NOT NULL CHECK (scale_mode IN ('fixed', 'all')),
  fixed_scale INTEGER,
  eligible_song_ids_json TEXT NOT NULL,
  draw_json TEXT NOT NULL,
  restore_token_hash TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (scale_mode = 'all' AND fixed_scale IS NULL) OR
    (scale_mode = 'fixed' AND fixed_scale IN (16, 32, 64, 128, 256, 512, 1024, 2048, 4096))
  )
);

CREATE UNIQUE INDEX idx_tournament_drafts_restore_token_hash
  ON tournament_drafts(restore_token_hash);

CREATE INDEX idx_tournament_drafts_snapshot_updated
  ON tournament_drafts(snapshot_id, updated_at DESC);

