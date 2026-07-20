PRAGMA foreign_keys = ON;

CREATE TABLE playlist_snapshots (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL CHECK (platform = 'qq_music'),
  external_playlist_id TEXT NOT NULL,
  title TEXT NOT NULL,
  cover_url TEXT,
  imported_at TEXT NOT NULL,
  song_count INTEGER NOT NULL CHECK (song_count > 0)
);

CREATE TABLE snapshot_songs (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL REFERENCES playlist_snapshots(id) ON DELETE RESTRICT,
  source_position INTEGER NOT NULL CHECK (source_position >= 0),
  source_song_id TEXT,
  source_song_mid TEXT,
  title TEXT NOT NULL,
  artists_json TEXT NOT NULL,
  album TEXT,
  duration_seconds INTEGER,
  media_url TEXT,
  preview_url TEXT,
  UNIQUE (snapshot_id, source_position)
);

CREATE INDEX idx_snapshot_songs_snapshot_position
  ON snapshot_songs(snapshot_id, source_position);

