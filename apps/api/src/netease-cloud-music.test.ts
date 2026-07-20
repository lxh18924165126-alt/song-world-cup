import { describe, expect, it, vi } from "vitest";
import { resolveNeteasePlaylist, resolveNeteaseShortPlaylistId } from "./netease-cloud-music";

describe("网易云音乐公开歌单解析", () => {
  it("只接受展开到网易云公开歌单的官方短链接", async () => {
    const fetcher = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { Location: "https://music.163.com/playlist?id=14339440319" },
    })) as unknown as typeof fetch;

    await expect(resolveNeteaseShortPlaylistId("https://163cn.tv/Kzh05tW", fetcher))
      .resolves.toBe("14339440319");
  });

  it("拒绝官方短链接重定向到非网易云域名", async () => {
    const fetcher = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { Location: "https://example.com/playlist?id=14339440319" },
    })) as unknown as typeof fetch;

    await expect(resolveNeteaseShortPlaylistId("https://163cn.tv/Kzh05tW", fetcher))
      .rejects.toThrow("QQ 音乐或网易云音乐");
  });

  it("分批补取普通用户歌单的完整歌曲详情", async () => {
    const trackIds = Array.from({ length: 101 }, (_, index) => ({ id: index + 1 }));
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/v6/playlist/detail") {
        return jsonResponse({
          code: 200,
          playlist: {
            id: 6819106603,
            name: "完整歌单",
            coverImgUrl: "https://p1.music.126.net/cover.jpg",
            trackIds,
            tracks: [],
          },
        });
      }

      const requested = JSON.parse(url.searchParams.get("c") ?? "[]") as Array<{ id: number }>;
      return jsonResponse({
        code: 200,
        songs: requested.map(({ id }) => ({
          id,
          name: `歌曲 ${id}`,
          ar: [{ name: `歌手 ${id}` }],
          al: { name: `专辑 ${id}` },
          dt: 180_000,
        })),
      });
    }) as unknown as typeof fetch;

    const snapshot = await resolveNeteasePlaylist(
      "6819106603",
      "snapshot-netease",
      "2026-07-20T00:00:00.000Z",
      fetcher,
    );

    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(snapshot.songs).toHaveLength(101);
    expect(snapshot.songs[0]?.title).toBe("歌曲 1");
    expect(snapshot.songs[100]?.title).toBe("歌曲 101");
  });

  it("拒绝超过赛事上限的歌单", async () => {
    const fetcher = vi.fn(async () => jsonResponse({
      code: 200,
      playlist: {
        id: 1,
        name: "超大歌单",
        trackIds: Array.from({ length: 4097 }, (_, index) => ({ id: index + 1 })),
        tracks: [],
      },
    })) as unknown as typeof fetch;

    await expect(resolveNeteasePlaylist("1", "snapshot", "2026-07-20T00:00:00.000Z", fetcher))
      .rejects.toThrow("超过 4096 首歌曲");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
