export type SnapshotStorage = "cloud" | "local";
export type PlaylistPlatform = "qq_music" | "netease_cloud_music";

export interface ParsedPlaylistUrl {
  platform: PlaylistPlatform;
  playlistId: string;
}

export type ParsedPlaylistReference = ParsedPlaylistUrl | {
  platform: "netease_cloud_music";
  playlistId: null;
  shortUrl: string;
};

export interface SnapshotSong {
  id: string;
  sourcePosition: number;
  sourceSongId: string | null;
  sourceSongMid: string | null;
  title: string;
  artists: string[];
  album: string | null;
  durationSeconds: number | null;
  mediaUrl: string | null;
  previewUrl: string | null;
}

export interface PlaylistSnapshot {
  id: string;
  platform: PlaylistPlatform;
  externalPlaylistId: string;
  title: string;
  coverUrl: string | null;
  importedAt: string;
  storage: SnapshotStorage;
  songs: SnapshotSong[];
}

export class PlaylistUrlError extends Error {
  constructor(message = "请输入有效的 QQ 音乐或网易云音乐公开歌单链接") {
    super(message);
    this.name = "PlaylistUrlError";
  }
}

const PLAYLIST_PATH_PATTERN = /\/n\/(?:ryqq(?:_v2)?|yqq)\/playlist\/(\d+)(?:\.html)?\/?$/;
const NETEASE_PLAYLIST_PATH_PATTERN = /^\/(?:(?:m|share)\/)?playlist\/?$/;
const NETEASE_LEGACY_PLAYLIST_PATH_PATTERN = /^\/playlist\/(\d+)(?:\/\d+)?\/?$/;

export function parsePlaylistReference(input: string): ParsedPlaylistReference {
  let url: URL;

  try {
    url = new URL(input.trim());
  } catch {
    throw new PlaylistUrlError();
  }

  if (url.protocol !== "https:") {
    throw new PlaylistUrlError();
  }

  if (isQqMusicHost(url.hostname)) {
    return { platform: "qq_music", playlistId: qqPlaylistId(url) };
  }

  if (isNeteaseMusicHost(url.hostname)) {
    return { platform: "netease_cloud_music", playlistId: neteasePlaylistId(url) };
  }

  if (url.hostname === "163cn.tv" && /^\/[A-Za-z0-9_-]{4,64}\/?$/.test(url.pathname)) {
    return { platform: "netease_cloud_music", playlistId: null, shortUrl: url.toString() };
  }

  throw new PlaylistUrlError();
}

export function parsePlaylistUrl(input: string): ParsedPlaylistUrl {
  const parsed = parsePlaylistReference(input);
  if (parsed.playlistId === null) throw new PlaylistUrlError("网易云音乐短链接需要联网解析");
  return parsed;
}

export function parseQqPlaylistId(input: string): string {
  const parsed = parsePlaylistUrl(input);
  if (parsed.platform !== "qq_music") throw new PlaylistUrlError("请输入有效的 QQ 音乐公开歌单链接");
  return parsed.playlistId;
}

export function parseNeteasePlaylistId(input: string): string {
  const parsed = parsePlaylistUrl(input);
  if (parsed.platform !== "netease_cloud_music") throw new PlaylistUrlError("请输入有效的网易云音乐公开歌单链接");
  return parsed.playlistId;
}

function isQqMusicHost(hostname: string): boolean {
  return hostname === "y.qq.com" || hostname.endsWith(".y.qq.com");
}

function qqPlaylistId(url: URL): string {
  const pathMatch = url.pathname.match(PLAYLIST_PATH_PATTERN);
  const queryId = url.searchParams.get("id") ?? url.searchParams.get("disstid");
  const playlistId = pathMatch?.[1] ?? queryId;
  if (!playlistId || !/^\d{5,20}$/.test(playlistId)) throw new PlaylistUrlError();
  return playlistId;
}

function isNeteaseMusicHost(hostname: string): boolean {
  return hostname === "music.163.com" || hostname.endsWith(".music.163.com");
}

function neteasePlaylistId(url: URL): string {
  const legacyPathId = url.pathname.match(NETEASE_LEGACY_PLAYLIST_PATH_PATTERN)?.[1];
  const queryId = NETEASE_PLAYLIST_PATH_PATTERN.test(url.pathname) ? url.searchParams.get("id") : null;
  const hashId = neteaseHashPlaylistId(url.hash);
  const playlistId = legacyPathId ?? queryId ?? hashId;
  if (!playlistId || !/^\d{1,20}$/.test(playlistId)) throw new PlaylistUrlError();
  return playlistId;
}

function neteaseHashPlaylistId(hash: string): string | null {
  if (!hash.startsWith("#/")) return null;
  try {
    const route = new URL(hash.slice(1), "https://music.163.com");
    return NETEASE_PLAYLIST_PATH_PATTERN.test(route.pathname) ? route.searchParams.get("id") : null;
  } catch {
    return null;
  }
}

export interface QqPlaylistPayload {
  code?: unknown;
  subcode?: unknown;
  cdlist?: unknown;
}

export function normalizeQqPlaylist(
  payload: unknown,
  options: { snapshotId: string; importedAt: string; storage: SnapshotStorage },
): PlaylistSnapshot {
  const root = asRecord(payload);
  const playlists = Array.isArray(root.cdlist) ? root.cdlist : [];
  const musicuData = asRecord(asRecord(root.req_0).data);
  const musicuInfo = asRecord(musicuData.dirinfo);
  const playlist = playlists.length > 0 ? asRecord(playlists[0]) : {
    disstid: asIdString(musicuInfo.id),
    dissname: musicuInfo.title,
    logo: musicuInfo.picurl,
    songlist: musicuData.songlist,
  };
  const externalPlaylistId = asNonEmptyString(playlist.disstid);
  const title = asNonEmptyString(playlist.dissname);
  const rawSongs = Array.isArray(playlist.songlist) ? playlist.songlist : [];

  if (!externalPlaylistId || !title || rawSongs.length === 0) {
    throw new Error("QQ 音乐未返回可用的公开歌单内容");
  }

  const songs = rawSongs.flatMap((rawSong, sourcePosition) => {
    const song = asRecord(rawSong);
    const songTitle = asNonEmptyString(song.songname) ?? asNonEmptyString(song.title);
    const rawSingers = Array.isArray(song.singer) ? song.singer : [];
    const artists = rawSingers
      .map((singer) => asNonEmptyString(asRecord(singer).name))
      .filter((name): name is string => name !== null);

    if (!songTitle || artists.length === 0) {
      return [];
    }

    const songMid = asNonEmptyString(song.songmid) ?? asNonEmptyString(song.mid);
    const duration = asFiniteNumber(song.interval);

    return [{
      id: `${options.snapshotId}:${sourcePosition}`,
      sourcePosition,
      sourceSongId: asIdString(song.songid) ?? asIdString(song.id),
      sourceSongMid: songMid,
      title: songTitle,
      artists,
      album: asNonEmptyString(song.albumname) ?? asNonEmptyString(asRecord(song.album).name),
      durationSeconds: duration,
      mediaUrl: songMid ? `https://y.qq.com/n/ryqq/songDetail/${songMid}` : null,
      previewUrl: null,
    } satisfies SnapshotSong];
  });

  if (songs.length === 0) {
    throw new Error("歌单中没有可识别歌名与歌手的歌曲");
  }

  return {
    id: options.snapshotId,
    platform: "qq_music",
    externalPlaylistId,
    title,
    coverUrl: asNonEmptyString(playlist.logo),
    importedAt: options.importedAt,
    storage: options.storage,
    songs,
  };
}

export interface NeteasePlaylistPayload {
  code?: unknown;
  playlist?: unknown;
  songs?: unknown;
}

export function normalizeNeteasePlaylist(
  payload: unknown,
  options: { snapshotId: string; importedAt: string; storage: SnapshotStorage },
): PlaylistSnapshot {
  const root = asRecord(payload);
  const playlist = asRecord(root.playlist);
  const externalPlaylistId = asIdString(playlist.id);
  const title = asNonEmptyString(playlist.name);
  const playlistTracks = Array.isArray(playlist.tracks) ? playlist.tracks : [];
  const extraSongs = Array.isArray(root.songs) ? root.songs : [];
  const detailsById = new Map<string, Record<string, unknown>>();

  for (const rawSong of [...playlistTracks, ...extraSongs]) {
    const song = asRecord(rawSong);
    const songId = asIdString(song.id);
    if (songId) detailsById.set(songId, song);
  }

  const rawTrackIds = Array.isArray(playlist.trackIds) ? playlist.trackIds : [];
  const orderedTracks = rawTrackIds.length > 0 ? rawTrackIds : playlistTracks;
  if (!externalPlaylistId || !title || orderedTracks.length === 0) {
    throw new Error("网易云音乐未返回可用的公开歌单内容");
  }

  const songs = orderedTracks.flatMap((rawTrack, sourcePosition) => {
    const track = asRecord(rawTrack);
    const songId = asIdString(track.id);
    const song = songId ? detailsById.get(songId) ?? track : track;
    const songTitle = asNonEmptyString(song.name);
    const rawArtists = Array.isArray(song.ar)
      ? song.ar
      : Array.isArray(song.artists) ? song.artists : [];
    const artists = rawArtists
      .map((artist) => asNonEmptyString(asRecord(artist).name))
      .filter((name): name is string => name !== null);

    if (!songTitle || artists.length === 0) return [];

    const durationMilliseconds = asFiniteNumber(song.dt) ?? asFiniteNumber(song.duration);
    const album = asRecord(song.al);
    const legacyAlbum = asRecord(song.album);
    return [{
      id: `${options.snapshotId}:${sourcePosition}`,
      sourcePosition,
      sourceSongId: songId,
      sourceSongMid: null,
      title: songTitle,
      artists,
      album: asNonEmptyString(album.name) ?? asNonEmptyString(legacyAlbum.name),
      durationSeconds: durationMilliseconds === null ? null : Math.round(durationMilliseconds / 1000),
      mediaUrl: songId ? `https://music.163.com/song?id=${encodeURIComponent(songId)}` : null,
      previewUrl: null,
    } satisfies SnapshotSong];
  });

  if (songs.length === 0) {
    throw new Error("歌单中没有可识别歌名与歌手的歌曲");
  }

  return {
    id: options.snapshotId,
    platform: "netease_cloud_music",
    externalPlaylistId,
    title,
    coverUrl: asNonEmptyString(playlist.coverImgUrl),
    importedAt: options.importedAt,
    storage: options.storage,
    songs,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asIdString(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return asNonEmptyString(value);
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
