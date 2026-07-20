PRAGMA defer_foreign_keys = ON;

CREATE TABLE playlist_snapshots_next (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL CHECK (platform IN ('qq_music', 'netease_cloud_music')),
  external_playlist_id TEXT NOT NULL,
  title TEXT NOT NULL,
  cover_url TEXT,
  imported_at TEXT NOT NULL,
  song_count INTEGER NOT NULL CHECK (song_count > 0)
);

INSERT INTO playlist_snapshots_next (
  id, platform, external_playlist_id, title, cover_url, imported_at, song_count
)
SELECT id, platform, external_playlist_id, title, cover_url, imported_at, song_count
FROM playlist_snapshots;

DROP TABLE playlist_snapshots;
ALTER TABLE playlist_snapshots_next RENAME TO playlist_snapshots;

PRAGMA defer_foreign_keys = OFF;

INSERT INTO feature_flags (key, enabled, updated_at)
VALUES ('netease_import', 1, CURRENT_TIMESTAMP)
ON CONFLICT(key) DO NOTHING;
