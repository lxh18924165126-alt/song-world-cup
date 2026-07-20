INSERT OR IGNORE INTO playlist_snapshots (
  id, platform, external_playlist_id, title, cover_url, imported_at, song_count
) VALUES (
  'e2e-snapshot', 'qq_music', '7052783065', 'E2E 验收歌单', NULL, '2026-07-20T00:00:00.000Z', 16
);

INSERT OR IGNORE INTO snapshot_songs (
  id, snapshot_id, source_position, source_song_id, source_song_mid,
  title, artists_json, album, duration_seconds, media_url, preview_url
) VALUES
  ('e2e-song-01', 'e2e-snapshot', 0, '101', 'mid01', '一号种子', '["测试歌手 A"]', '验收专辑', 201, 'https://y.qq.com/n/ryqq/songDetail/mid01', NULL),
  ('e2e-song-02', 'e2e-snapshot', 1, '102', 'mid02', '二号种子', '["测试歌手 B"]', '验收专辑', 202, 'https://y.qq.com/n/ryqq/songDetail/mid02', NULL),
  ('e2e-song-03', 'e2e-snapshot', 2, '103', 'mid03', '三号种子', '["测试歌手 C"]', '验收专辑', 203, 'https://y.qq.com/n/ryqq/songDetail/mid03', NULL),
  ('e2e-song-04', 'e2e-snapshot', 3, '104', 'mid04', '四号种子', '["测试歌手 D"]', '验收专辑', 204, 'https://y.qq.com/n/ryqq/songDetail/mid04', NULL),
  ('e2e-song-05', 'e2e-snapshot', 4, '105', 'mid05', '五号种子', '["测试歌手 E"]', '验收专辑', 205, 'https://y.qq.com/n/ryqq/songDetail/mid05', NULL),
  ('e2e-song-06', 'e2e-snapshot', 5, '106', 'mid06', '六号种子', '["测试歌手 F"]', '验收专辑', 206, 'https://y.qq.com/n/ryqq/songDetail/mid06', NULL),
  ('e2e-song-07', 'e2e-snapshot', 6, '107', 'mid07', '七号种子', '["测试歌手 G"]', '验收专辑', 207, 'https://y.qq.com/n/ryqq/songDetail/mid07', NULL),
  ('e2e-song-08', 'e2e-snapshot', 7, '108', 'mid08', '八号种子', '["测试歌手 H"]', '验收专辑', 208, 'https://y.qq.com/n/ryqq/songDetail/mid08', NULL),
  ('e2e-song-09', 'e2e-snapshot', 8, '109', 'mid09', '九号种子', '["测试歌手 I"]', '验收专辑', 209, 'https://y.qq.com/n/ryqq/songDetail/mid09', NULL),
  ('e2e-song-10', 'e2e-snapshot', 9, '110', 'mid10', '十号种子', '["测试歌手 J"]', '验收专辑', 210, 'https://y.qq.com/n/ryqq/songDetail/mid10', NULL),
  ('e2e-song-11', 'e2e-snapshot', 10, '111', 'mid11', '十一号种子', '["测试歌手 K"]', '验收专辑', 211, 'https://y.qq.com/n/ryqq/songDetail/mid11', NULL),
  ('e2e-song-12', 'e2e-snapshot', 11, '112', 'mid12', '十二号种子', '["测试歌手 L"]', '验收专辑', 212, 'https://y.qq.com/n/ryqq/songDetail/mid12', NULL),
  ('e2e-song-13', 'e2e-snapshot', 12, '113', 'mid13', '十三号种子', '["测试歌手 M"]', '验收专辑', 213, 'https://y.qq.com/n/ryqq/songDetail/mid13', NULL),
  ('e2e-song-14', 'e2e-snapshot', 13, '114', 'mid14', '十四号种子', '["测试歌手 N"]', '验收专辑', 214, 'https://y.qq.com/n/ryqq/songDetail/mid14', NULL),
  ('e2e-song-15', 'e2e-snapshot', 14, '115', 'mid15', '十五号种子', '["测试歌手 O"]', '验收专辑', 215, 'https://y.qq.com/n/ryqq/songDetail/mid15', NULL),
  ('e2e-song-16', 'e2e-snapshot', 15, '116', 'mid16', '十六号种子', '["测试歌手 P"]', '验收专辑', 216, 'https://y.qq.com/n/ryqq/songDetail/mid16', NULL);
