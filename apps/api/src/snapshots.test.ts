import { describe, expect, it } from "vitest";
import { BrowserSnapshotValidationError, normalizeBrowserSnapshotInput } from "./snapshots";

describe("浏览器备用快照提升", () => {
  it("重建服务端 ID 并只保留可信字段", () => {
    const snapshot = normalizeBrowserSnapshotInput({
      platform: "qq_music",
      externalPlaylistId: "7052783065",
      title: "备用歌单",
      coverUrl: "https://y.gtimg.cn/music/photo.jpg",
      songs: [
        { title: "歌曲一", artists: ["歌手 A"], sourceSongId: "101", sourceSongMid: "mid001", durationSeconds: 200, mediaUrl: "https://evil.test" },
        { title: "歌曲二", artists: ["歌手 B"], sourceSongId: "102", sourceSongMid: null, durationSeconds: 201 },
      ],
    });

    expect(snapshot.storage).toBe("cloud");
    expect(snapshot.songs[0]?.id).toBe(`${snapshot.id}:0`);
    expect(snapshot.songs[0]?.mediaUrl).toBe("https://y.qq.com/n/ryqq/songDetail/mid001");
    expect(snapshot.songs[1]?.previewUrl).toBeNull();
  });

  it("拒绝非 QQ 封面和不足两首歌曲", () => {
    expect(() => normalizeBrowserSnapshotInput({
      platform: "qq_music",
      externalPlaylistId: "7052783065",
      title: "备用歌单",
      coverUrl: "https://evil.test/cover.jpg",
      songs: [{ title: "歌曲一", artists: ["歌手 A"] }],
    })).toThrow(BrowserSnapshotValidationError);
  });
});
