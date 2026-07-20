import { normalizeNeteasePlaylist, parseNeteasePlaylistId, type PlaylistSnapshot } from "@song-world-cup/domain";

const NETEASE_PLAYLIST_ENDPOINT = "https://music.163.com/api/v6/playlist/detail";
const NETEASE_SONG_DETAIL_ENDPOINT = "https://music.163.com/api/v3/song/detail";
const MAX_PLAYLIST_SONGS = 4096;
const SONG_DETAIL_BATCH_SIZE = 100;
const SONG_DETAIL_CONCURRENCY = 4;

export async function resolveNeteaseShortPlaylistId(
  shortUrl: string,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const response = await fetcher(shortUrl, {
    redirect: "manual",
    headers: { "User-Agent": "Mozilla/5.0 (compatible; SongWorldCup/1.0)" },
    signal: AbortSignal.timeout(10_000),
  });
  const location = response.headers.get("Location");
  if (response.status < 300 || response.status >= 400 || !location) {
    throw new Error("网易云音乐短链接无法展开为公开歌单链接");
  }
  return parseNeteasePlaylistId(new URL(location, shortUrl).toString());
}

export async function resolveNeteasePlaylist(
  playlistId: string,
  snapshotId: string,
  importedAt: string,
  fetcher: typeof fetch = fetch,
): Promise<PlaylistSnapshot> {
  const endpoint = new URL(NETEASE_PLAYLIST_ENDPOINT);
  endpoint.searchParams.set("id", playlistId);
  endpoint.searchParams.set("n", String(MAX_PLAYLIST_SONGS));
  endpoint.searchParams.set("s", "0");

  const root = asRecord(await fetchNeteaseJson(fetcher, endpoint, "歌单"));
  const playlist = asRecord(root.playlist);
  const rawTrackIds = Array.isArray(playlist.trackIds) ? playlist.trackIds : [];
  const embeddedTracks = Array.isArray(playlist.tracks) ? playlist.tracks : [];
  const orderedTracks = rawTrackIds.length > 0 ? rawTrackIds : embeddedTracks;
  if (orderedTracks.length > MAX_PLAYLIST_SONGS) {
    throw new Error(`网易云音乐歌单超过 ${MAX_PLAYLIST_SONGS} 首歌曲，暂不支持导入`);
  }

  const orderedSongIds = orderedTracks
    .map((track) => idString(asRecord(track).id))
    .filter((id): id is string => id !== null);
  const embeddedIds = new Set(embeddedTracks
    .map((track) => idString(asRecord(track).id))
    .filter((id): id is string => id !== null));
  const missingSongIds = [...new Set(orderedSongIds)].filter((id) => !embeddedIds.has(id));
  const songs = await fetchSongDetails(fetcher, missingSongIds);

  return normalizeNeteasePlaylist({ ...root, playlist, songs }, {
    snapshotId,
    importedAt,
    storage: "cloud",
  });
}

async function fetchSongDetails(fetcher: typeof fetch, songIds: string[]): Promise<unknown[]> {
  const batches: string[][] = [];
  for (let index = 0; index < songIds.length; index += SONG_DETAIL_BATCH_SIZE) {
    batches.push(songIds.slice(index, index + SONG_DETAIL_BATCH_SIZE));
  }

  const songs: unknown[] = [];
  for (let index = 0; index < batches.length; index += SONG_DETAIL_CONCURRENCY) {
    const group = batches.slice(index, index + SONG_DETAIL_CONCURRENCY);
    const responses = await Promise.all(group.map(async (batch) => {
      const endpoint = new URL(NETEASE_SONG_DETAIL_ENDPOINT);
      endpoint.searchParams.set("c", JSON.stringify(batch.map((id) => ({ id: Number(id), v: 0 }))));
      const payload = asRecord(await fetchNeteaseJson(fetcher, endpoint, "歌曲详情"));
      if (payload.code !== 200 || !Array.isArray(payload.songs)) {
        throw new Error("网易云音乐未返回可用的歌曲详情");
      }
      return payload.songs;
    }));
    songs.push(...responses.flat());
  }
  return songs;
}

async function fetchNeteaseJson(fetcher: typeof fetch, endpoint: URL, label: string): Promise<unknown> {
  const response = await fetcher(endpoint.toString(), {
    headers: {
      Accept: "application/json,text/plain,*/*",
      Referer: "https://music.163.com/",
      "User-Agent": "Mozilla/5.0 (compatible; SongWorldCup/1.0)",
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) throw new Error(`网易云音乐${label}响应异常（${response.status}）`);
  return response.json();
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function idString(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value === "string" && /^\d{1,20}$/.test(value)) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 ? value : null;
  }
  return null;
}
