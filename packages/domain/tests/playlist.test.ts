import { describe, expect, it } from "vitest";
import {
  PlaylistUrlError,
  normalizeNeteasePlaylist,
  normalizeQqPlaylist,
  parseNeteasePlaylistId,
  parsePlaylistReference,
  parsePlaylistUrl,
  parseQqPlaylistId,
} from "../src/playlist";

describe("parseQqPlaylistId", () => {
  it.each([
    ["https://y.qq.com/n/ryqq/playlist/7052783065", "7052783065"],
    ["https://y.qq.com/n/ryqq_v2/playlist/7052783065?ADTAG=h5_share_playlist&redirecttag=mn.redirect.custom&mnst=1.41", "7052783065"],
    ["https://y.qq.com/n/yqq/playlist/7052783065.html?ADTAG=share", "7052783065"],
    ["https://i.y.qq.com/n2/m/share/details/taoge.html?id=7052783065", "7052783065"],
  ])("从公开链接 %s 解析歌单 ID", (url, expected) => {
    expect(parseQqPlaylistId(url)).toBe(expected);
  });

  it("拒绝非 QQ 音乐链接", () => {
    expect(() => parseQqPlaylistId("https://example.com/playlist/7052783065"))
      .toThrow(PlaylistUrlError);
  });
});

describe("网易云音乐公开歌单链接", () => {
  it.each([
    ["https://music.163.com/playlist?id=6819106603", "6819106603"],
    ["https://music.163.com/#/playlist?id=6819106603", "6819106603"],
    ["https://y.music.163.com/m/playlist?app_version=9.0.0&id=6819106603&userid=123", "6819106603"],
    ["https://music.163.com/playlist/6819106603/123456/", "6819106603"],
  ])("从公开链接 %s 解析歌单 ID", (url, expected) => {
    expect(parseNeteasePlaylistId(url)).toBe(expected);
    expect(parsePlaylistUrl(url)).toEqual({ platform: "netease_cloud_music", playlistId: expected });
  });

  it("拒绝网易云单曲链接和 HTTP 链接", () => {
    expect(() => parseNeteasePlaylistId("https://music.163.com/song?id=1973665667")).toThrow(PlaylistUrlError);
    expect(() => parseNeteasePlaylistId("http://music.163.com/playlist?id=6819106603")).toThrow(PlaylistUrlError);
  });

  it("识别网易云官方短链接并留给服务端展开", () => {
    expect(parsePlaylistReference("https://163cn.tv/Kzh05tW")).toEqual({
      platform: "netease_cloud_music",
      playlistId: null,
      shortUrl: "https://163cn.tv/Kzh05tW",
    });
    expect(() => parsePlaylistUrl("https://163cn.tv/Kzh05tW")).toThrow("需要联网解析");
  });
});

describe("normalizeQqPlaylist", () => {
  it("保留重复歌曲为位置不同的独立条目", () => {
    const snapshot = normalizeQqPlaylist({
      cdlist: [{
        disstid: "7052783065",
        dissname: "测试歌单",
        logo: "https://example.com/cover.jpg",
        songlist: [
          { songid: 1, songmid: "same", songname: "晴天", singer: [{ name: "周杰伦" }] },
          { songid: 1, songmid: "same", songname: "晴天", singer: [{ name: "周杰伦" }] },
        ],
      }],
    }, { snapshotId: "snapshot-1", importedAt: "2026-07-20T00:00:00.000Z", storage: "cloud" });

    expect(snapshot.songs).toHaveLength(2);
    expect(snapshot.songs.map((song) => song.id)).toEqual(["snapshot-1:0", "snapshot-1:1"]);
  });

  it("跳过无法同时识别歌名与歌手的条目", () => {
    const snapshot = normalizeQqPlaylist({
      cdlist: [{
        disstid: "7052783065",
        dissname: "测试歌单",
        songlist: [
          { songname: "无歌手", singer: [] },
          { songname: "红豆", singer: [{ name: "王菲" }] },
        ],
      }],
    }, { snapshotId: "snapshot-1", importedAt: "2026-07-20T00:00:00.000Z", storage: "local" });

    expect(snapshot.songs.map((song) => song.title)).toEqual(["红豆"]);
  });

  it("兼容浏览器 JSONP 使用的 musicu 响应结构", () => {
    const snapshot = normalizeQqPlaylist({
      req_0: { data: {
        dirinfo: { id: "7052783065", title: "浏览器备用歌单", picurl: "https://example.com/cover.jpg" },
        songlist: [{ id: 1, mid: "song-mid", title: "歌曲甲", singer: [{ name: "歌手甲" }], album: { name: "专辑甲" }, interval: 180 }],
      } },
    }, { snapshotId: "snapshot-browser", importedAt: "2026-07-20T00:00:00.000Z", storage: "local" });

    expect(snapshot.title).toBe("浏览器备用歌单");
    expect(snapshot.storage).toBe("local");
    expect(snapshot.songs[0]?.sourceSongMid).toBe("song-mid");
    expect(snapshot.songs[0]?.album).toBe("专辑甲");
  });
});

describe("normalizeNeteasePlaylist", () => {
  it("按 trackIds 原顺序保留重复歌曲并规范化字段", () => {
    const snapshot = normalizeNeteasePlaylist({
      code: 200,
      playlist: {
        id: 6819106603,
        name: "网易云测试歌单",
        coverImgUrl: "https://p1.music.126.net/cover.jpg",
        trackIds: [{ id: 386538 }, { id: 385965 }, { id: 386538 }],
        tracks: [{ id: 386538, name: "温柔", ar: [{ name: "五月天" }], al: { name: "我们是五月天" }, dt: 269800 }],
      },
      songs: [{ id: 385965, name: "知足", ar: [{ name: "五月天" }], al: { name: "知足 最真杰作选" }, dt: 276000 }],
    }, { snapshotId: "snapshot-netease", importedAt: "2026-07-20T00:00:00.000Z", storage: "cloud" });

    expect(snapshot.platform).toBe("netease_cloud_music");
    expect(snapshot.songs.map((song) => song.title)).toEqual(["温柔", "知足", "温柔"]);
    expect(snapshot.songs.map((song) => song.id)).toEqual([
      "snapshot-netease:0",
      "snapshot-netease:1",
      "snapshot-netease:2",
    ]);
    expect(snapshot.songs[0]).toMatchObject({
      sourceSongId: "386538",
      sourceSongMid: null,
      durationSeconds: 270,
      mediaUrl: "https://music.163.com/song?id=386538",
    });
  });

  it("跳过详情缺失或无法识别歌手的条目", () => {
    const snapshot = normalizeNeteasePlaylist({
      playlist: {
        id: 2785615092,
        name: "不完整歌单",
        trackIds: [{ id: 1 }, { id: 2 }, { id: 3 }],
        tracks: [
          { id: 1, name: "可用歌曲", ar: [{ name: "歌手甲" }] },
          { id: 2, name: "无歌手", ar: [] },
        ],
      },
    }, { snapshotId: "snapshot-netease", importedAt: "2026-07-20T00:00:00.000Z", storage: "cloud" });

    expect(snapshot.songs).toHaveLength(1);
    expect(snapshot.songs[0]?.sourcePosition).toBe(0);
  });
});
