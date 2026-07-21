import { afterEach, describe, expect, it, vi } from "vitest";
import { resolvePlaylist, resolvePlaylistInBrowser } from "./api";

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

describe("QQ 音乐浏览器备用导入", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("在 HTTP 环境缺少 randomUUID 时仍能创建本地快照和 JSONP 回调", async () => {
    const payload = {
      req_0: {
        data: {
          dirinfo: { id: "7052783065", title: "QQ 测试歌单", picurl: null },
          songlist: [{ id: 1, mid: "song-mid", title: "测试歌曲", singer: [{ name: "测试歌手" }] }],
        },
      },
    };
    const script = {
      async: false,
      onerror: null as (() => void) | null,
      referrerPolicy: "",
      remove: vi.fn(),
      src: "",
    };
    const browserWindow: Record<string, unknown> = {
      clearTimeout: vi.fn(),
      setTimeout: vi.fn(() => 1),
    };
    const append = vi.fn((node: typeof script) => {
      const callbackName = new URL(node.src).searchParams.get("callback")!;
      (browserWindow[callbackName] as (value: unknown) => void)(payload);
    });
    vi.stubGlobal("crypto", {
      getRandomValues(bytes: Uint8Array) {
        bytes.fill(0);
        return bytes;
      },
    });
    vi.stubGlobal("window", browserWindow);
    vi.stubGlobal("document", {
      createElement: vi.fn(() => script),
      head: { append },
    });

    const snapshot = await resolvePlaylistInBrowser("https://y.qq.com/n/ryqq/playlist/7052783065");

    expect(snapshot.id).toBe("00000000-0000-4000-8000-000000000000");
    expect(snapshot.title).toBe("QQ 测试歌单");
    expect(snapshot.songs).toHaveLength(1);
    expect(script.remove).toHaveBeenCalledOnce();
    expect(Object.keys(browserWindow)).not.toContain("songWorldCupJsonp_00000000000040008000000000000000");
  });
});

function jsonResponse(value: unknown, status: number): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
