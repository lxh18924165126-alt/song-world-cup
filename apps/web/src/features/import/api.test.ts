import { afterEach, describe, expect, it, vi } from "vitest";
import { resolvePlaylist } from "./api";

describe("网易云音乐导入客户端", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("接受服务端返回的网易云快照", async () => {
    const snapshot = {
      id: "snapshot-netease",
      platform: "netease_cloud_music",
      externalPlaylistId: "6819106603",
      title: "网易云歌单",
      coverUrl: null,
      importedAt: "2026-07-20T00:00:00.000Z",
      storage: "cloud",
      songs: [],
    };
    const fetcher = vi.fn(async () => jsonResponse({ snapshot }, 201));
    vi.stubGlobal("fetch", fetcher);

    await expect(resolvePlaylist("https://music.163.com/playlist?id=6819106603"))
      .resolves.toEqual(snapshot);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("服务端失败时不误用 QQ 浏览器备用解析", async () => {
    const fetcher = vi.fn(async () => jsonResponse({
      error: { code: "playlist_resolve_failed", message: "网易云音乐暂时不可用" },
    }, 502));
    vi.stubGlobal("fetch", fetcher);

    await expect(resolvePlaylist("https://163cn.tv/Kzh05tW"))
      .rejects.toThrow("网易云音乐暂时不可用");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

function jsonResponse(value: unknown, status: number): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
