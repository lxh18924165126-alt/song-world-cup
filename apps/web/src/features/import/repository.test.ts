import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaylistPlatform, PlaylistSnapshot } from "@song-world-cup/domain";
import { database } from "../../storage/database";
import { createImportDraft, getCurrentImport } from "./repository";

describe("HTTP 环境的双平台本地草稿", () => {
  beforeEach(async () => {
    const values = new Map<string, string>();
    vi.stubGlobal("crypto", {
      getRandomValues(bytes: Uint8Array) {
        bytes.fill(0);
        return bytes;
      },
    });
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    const db = await database();
    const transaction = db.transaction(["snapshots", "drafts"], "readwrite");
    await Promise.all([
      transaction.objectStore("snapshots").clear(),
      transaction.objectStore("drafts").clear(),
      transaction.done,
    ]);
  });

  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["qq_music", "QQ 测试歌单"],
    ["netease_cloud_music", "网易云测试歌单"],
  ] satisfies Array<[PlaylistPlatform, string]>)("缺少 randomUUID 时仍能保存 %s 服务端快照", async (platform, title) => {
    const snapshot = createSnapshot(platform, title);

    const draft = await createImportDraft(snapshot);
    const current = await getCurrentImport();

    expect(draft.id).toBe("00000000-0000-4000-8000-000000000000");
    expect(current).toEqual({ snapshot, draft });
  });
});

function createSnapshot(platform: PlaylistPlatform, title: string): PlaylistSnapshot {
  return {
    id: `snapshot-${platform}`,
    platform,
    externalPlaylistId: "7052783065",
    title,
    coverUrl: null,
    importedAt: "2026-07-20T00:00:00.000Z",
    storage: "cloud",
    songs: [{
      id: `snapshot-${platform}:0`,
      sourcePosition: 0,
      sourceSongId: "1",
      sourceSongMid: null,
      title: "测试歌曲",
      artists: ["测试歌手"],
      album: null,
      durationSeconds: null,
      mediaUrl: null,
      previewUrl: null,
    }],
  };
}
