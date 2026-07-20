import { normalizeQqPlaylist, type PlaylistSnapshot } from "@song-world-cup/domain";

const QQ_PLAYLIST_ENDPOINT = "https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg";

export async function resolveQqPlaylist(
  playlistId: string,
  snapshotId: string,
  importedAt: string,
): Promise<PlaylistSnapshot> {
  const query = new URLSearchParams({
    type: "1",
    json: "1",
    utf8: "1",
    onlysong: "0",
    disstid: playlistId,
    format: "json",
    g_tk: "5381",
    loginUin: "0",
    hostUin: "0",
    inCharset: "utf8",
    outCharset: "utf-8",
    notice: "0",
    platform: "yqq.json",
    needNewCode: "0",
  });

  const response = await fetch(`${QQ_PLAYLIST_ENDPOINT}?${query}`, {
    headers: {
      Accept: "application/json,text/plain,*/*",
      Referer: "https://y.qq.com/",
      "User-Agent": "Mozilla/5.0 (compatible; SongWorldCup/1.0)",
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`QQ 音乐响应异常（${response.status}）`);
  }

  return normalizeQqPlaylist(await response.json(), {
    snapshotId,
    importedAt,
    storage: "cloud",
  });
}

