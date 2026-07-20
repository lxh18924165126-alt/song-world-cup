import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import type { PlaylistSnapshot, SnapshotSong } from "@song-world-cup/domain";

// D1 本地与远端都使用保守的 SQLite 绑定参数上限；每首歌占 11 个参数。
const SONG_BATCH_SIZE = 8;

export class BrowserSnapshotValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowserSnapshotValidationError";
  }
}

export function normalizeBrowserSnapshotInput(input: unknown): PlaylistSnapshot {
  const root = asRecord(input);
  const externalPlaylistId = requiredString(root.externalPlaylistId, "浏览器快照缺少歌单 ID", 20);
  const title = requiredString(root.title, "浏览器快照缺少歌单名称", 200);
  const rawSongs = Array.isArray(root.songs) ? root.songs : [];
  if (!/^\d{5,20}$/.test(externalPlaylistId)) throw new BrowserSnapshotValidationError("浏览器快照歌单 ID 无效");
  if (root.platform !== "qq_music") throw new BrowserSnapshotValidationError("浏览器快照平台无效");
  if (rawSongs.length < 2 || rawSongs.length > 4096) throw new BrowserSnapshotValidationError("浏览器快照歌曲数需为 2 至 4096 首");

  const snapshotId = crypto.randomUUID();
  const songs = rawSongs.map((rawSong, sourcePosition) => normalizeBrowserSong(rawSong, snapshotId, sourcePosition));
  return {
    id: snapshotId,
    platform: "qq_music",
    externalPlaylistId,
    title,
    coverUrl: qqImageUrl(root.coverUrl),
    importedAt: new Date().toISOString(),
    storage: "cloud",
    songs,
  };
}

export async function promoteBrowserSnapshot(db: D1Database, input: unknown): Promise<PlaylistSnapshot> {
  const snapshot = normalizeBrowserSnapshotInput(input);
  await savePlaylistSnapshot(db, snapshot);
  return snapshot;
}

export async function savePlaylistSnapshot(db: D1Database, snapshot: PlaylistSnapshot): Promise<void> {
  const statements: D1PreparedStatement[] = [
    db.prepare(`
      INSERT INTO playlist_snapshots (
        id, platform, external_playlist_id, title, cover_url, imported_at, song_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      snapshot.id,
      snapshot.platform,
      snapshot.externalPlaylistId,
      snapshot.title,
      snapshot.coverUrl,
      snapshot.importedAt,
      snapshot.songs.length,
    ),
  ];

  for (let index = 0; index < snapshot.songs.length; index += SONG_BATCH_SIZE) {
    statements.push(buildSongInsert(db, snapshot.id, snapshot.songs.slice(index, index + SONG_BATCH_SIZE)));
  }

  await db.batch(statements);
}

function buildSongInsert(
  db: D1Database,
  snapshotId: string,
  songs: SnapshotSong[],
): D1PreparedStatement {
  const values = songs.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
  const bindings = songs.flatMap((song) => [
    song.id,
    snapshotId,
    song.sourcePosition,
    song.sourceSongId,
    song.sourceSongMid,
    song.title,
    JSON.stringify(song.artists),
    song.album,
    song.durationSeconds,
    song.mediaUrl,
    song.previewUrl,
  ]);

  return db.prepare(`
    INSERT INTO snapshot_songs (
      id, snapshot_id, source_position, source_song_id, source_song_mid,
      title, artists_json, album, duration_seconds, media_url, preview_url
    ) VALUES ${values}
  `).bind(...bindings);
}

function normalizeBrowserSong(input: unknown, snapshotId: string, sourcePosition: number): SnapshotSong {
  const song = asRecord(input);
  const title = requiredString(song.title, `第 ${sourcePosition + 1} 首歌曲缺少歌名`, 300);
  const artists = Array.isArray(song.artists)
    ? song.artists.map((artist) => requiredString(artist, `第 ${sourcePosition + 1} 首歌曲歌手无效`, 100))
    : [];
  if (artists.length < 1 || artists.length > 20) throw new BrowserSnapshotValidationError(`第 ${sourcePosition + 1} 首歌曲歌手数量无效`);
  const sourceSongMid = optionalIdentifier(song.sourceSongMid, 40);
  const durationSeconds = song.durationSeconds === null || song.durationSeconds === undefined
    ? null
    : Number.isInteger(song.durationSeconds) && Number(song.durationSeconds) >= 0 && Number(song.durationSeconds) <= 36_000
      ? Number(song.durationSeconds)
      : null;
  return {
    id: `${snapshotId}:${sourcePosition}`,
    sourcePosition,
    sourceSongId: optionalIdentifier(song.sourceSongId, 40),
    sourceSongMid,
    title,
    artists,
    album: optionalString(song.album, 300),
    durationSeconds,
    mediaUrl: sourceSongMid ? `https://y.qq.com/n/ryqq/songDetail/${encodeURIComponent(sourceSongMid)}` : null,
    previewUrl: null,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function requiredString(value: unknown, message: string, maxLength: number): string {
  const parsed = optionalString(value, maxLength);
  if (!parsed) throw new BrowserSnapshotValidationError(message);
  return parsed;
}

function optionalString(value: unknown, maxLength: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new BrowserSnapshotValidationError("浏览器快照文本字段无效");
  const parsed = value.trim();
  if (!parsed || parsed.length > maxLength) throw new BrowserSnapshotValidationError("浏览器快照文本字段长度无效");
  return parsed;
}

function optionalIdentifier(value: unknown, maxLength: number): string | null {
  const parsed = optionalString(value, maxLength);
  if (parsed && !/^[A-Za-z0-9_-]+$/.test(parsed)) throw new BrowserSnapshotValidationError("浏览器快照来源标识无效");
  return parsed;
}

function qqImageUrl(value: unknown): string | null {
  const parsed = optionalString(value, 1000);
  if (!parsed) return null;
  try {
    const url = new URL(parsed);
    const allowedHost = url.hostname === "qq.com" || url.hostname.endsWith(".qq.com") || url.hostname === "gtimg.cn" || url.hostname.endsWith(".gtimg.cn");
    if (url.protocol !== "https:" || !allowedHost) throw new Error();
    return url.toString();
  } catch {
    throw new BrowserSnapshotValidationError("浏览器快照封面地址无效");
  }
}
