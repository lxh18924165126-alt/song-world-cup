import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTournamentDraw,
  createTournamentProgress,
  lockTournamentRound as applyRoundLock,
  setTournamentMatchWinner,
  type CloudTournament,
  type SnapshotSong,
} from "@song-world-cup/domain";

const apiMocks = vi.hoisted(() => ({
  getTournament: vi.fn(),
  branchTournament: vi.fn(),
  pickTournamentMatch: vi.fn(),
  lockTournamentRound: vi.fn(),
  syncTournamentEvents: vi.fn(),
}));

vi.mock("./api", async () => ({
  ...await vi.importActual<typeof import("./api")>("./api"),
  getTournament: apiMocks.getTournament,
  branchTournament: apiMocks.branchTournament,
  pickTournamentMatch: apiMocks.pickTournamentMatch,
  lockTournamentRound: apiMocks.lockTournamentRound,
  syncTournamentEvents: apiMocks.syncTournamentEvents,
}));

import {
  enqueueTournamentPick,
  enqueueTournamentRoundLock,
  discardLocalBranchAndReload,
  flushTournamentEvents,
  loadTournamentForPlay,
  pendingTournamentEventCount,
  saveLocalTournamentAsBranch,
  TournamentLeaseConflictError,
  TournamentQueueConflictError,
} from "./repository";
import { TournamentRequestError, type TournamentSyncEvent } from "./api";
import { database } from "../../storage/database";

const tournamentId = "offline-queue-tournament";
const token = "local-restore-token";
const songs = createSongs(4);
let serverTournament: CloudTournament;
let onlineState = true;

describe("赛事离线队列", () => {
  beforeEach(async () => {
    const db = await database();
    const transaction = db.transaction(["tournaments", "tournamentEvents"], "readwrite");
    await Promise.all([
      transaction.objectStore("tournaments").clear(),
      transaction.objectStore("tournamentEvents").clear(),
      transaction.done,
    ]);
    onlineState = true;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { get onLine() { return onlineState; } },
    });
    serverTournament = createTournament();
    apiMocks.getTournament.mockReset().mockImplementation(async () => ({ tournament: serverTournament, songs }));
    apiMocks.branchTournament.mockReset();
    apiMocks.pickTournamentMatch.mockReset();
    apiMocks.lockTournamentRound.mockReset();
    apiMocks.syncTournamentEvents.mockReset().mockImplementation(async (
      _id: string,
      _token: string,
      version: number,
      events: TournamentSyncEvent[],
    ) => {
      expect(version).toBe(serverTournament.version);
      let progress = serverTournament.progress;
      for (const event of events) {
        progress = event.kind === "pick"
          ? setTournamentMatchWinner(progress, event.matchId, event.winnerId)
          : applyRoundLock(progress);
      }
      serverTournament = {
        ...serverTournament,
        progress,
        version: version + events.length,
        lastEventSequence: events[events.length - 1]!.sequence,
      };
      return { tournament: serverTournament, songs };
    });
  });

  it("离线选择和锁轮按顺序排队，联网后使用连续版本回放", async () => {
    const loaded = await loadTournamentForPlay(tournamentId, token);
    expect(loaded.syncState).toBe("synced");
    const matches = loaded.tournament.progress.rounds[0]!.matches;

    onlineState = false;
    await enqueueTournamentPick(tournamentId, matches[0]!.id, matches[0]!.entrantAId);
    await enqueueTournamentPick(tournamentId, matches[1]!.id, matches[1]!.entrantAId);
    const offlineLocked = await enqueueTournamentRoundLock(tournamentId);

    expect(offlineLocked.pendingCount).toBe(3);
    expect(offlineLocked.syncState).toBe("offline");
    expect(offlineLocked.tournament.progress.currentRoundIndex).toBe(1);
    expect(apiMocks.syncTournamentEvents).not.toHaveBeenCalled();

    onlineState = true;
    const synced = await flushTournamentEvents(tournamentId);

    expect(synced.pendingCount).toBe(0);
    expect(synced.syncState).toBe("synced");
    expect(synced.tournament.version).toBe(4);
    expect(synced.tournament.lastEventSequence).toBe(3);
    expect(synced.tournament.progress.currentRoundIndex).toBe(1);
    expect(apiMocks.syncTournamentEvents).toHaveBeenCalledTimes(1);
    expect(apiMocks.syncTournamentEvents.mock.calls[0]?.[2]).toBe(1);
    expect(apiMocks.syncTournamentEvents.mock.calls[0]?.[3].map((event: TournamentSyncEvent) => ({
      kind: event.kind,
      sequence: event.sequence,
    }))).toEqual([
      { kind: "pick", sequence: 1 },
      { kind: "pick", sequence: 2 },
      { kind: "lock_round", sequence: 3 },
    ]);
  });

  it("公网中转临时失败时幂等重试整批事件", async () => {
    const loaded = await loadTournamentForPlay(tournamentId, token);
    const match = loaded.tournament.progress.rounds[0]!.matches[0]!;
    onlineState = false;
    await enqueueTournamentPick(tournamentId, match.id, match.entrantAId);
    apiMocks.syncTournamentEvents.mockRejectedValueOnce(
      new TournamentRequestError("公网中转暂时无法连接生产服务", 502, "public_access_upstream_failed"),
    );

    onlineState = true;
    const synced = await flushTournamentEvents(tournamentId);

    expect(synced.pendingCount).toBe(0);
    expect(apiMocks.syncTournamentEvents).toHaveBeenCalledTimes(2);
  });

  it("云端版本冲突时保留本地事件，不静默覆盖离线分支", async () => {
    const loaded = await loadTournamentForPlay(tournamentId, token);
    const match = loaded.tournament.progress.rounds[0]!.matches[0]!;
    onlineState = false;
    await enqueueTournamentPick(tournamentId, match.id, match.entrantAId);
    apiMocks.syncTournamentEvents.mockRejectedValueOnce(
      new TournamentRequestError("赛事已在其他页面更新", 409, "tournament_conflict"),
    );

    onlineState = true;
    await expect(flushTournamentEvents(tournamentId)).rejects.toBeInstanceOf(TournamentQueueConflictError);
    expect(await pendingTournamentEventCount(tournamentId)).toBe(1);
  });

  it("编辑租约冲突时保留本地事件并停止回放", async () => {
    const loaded = await loadTournamentForPlay(tournamentId, token);
    const match = loaded.tournament.progress.rounds[0]!.matches[0]!;
    onlineState = false;
    await enqueueTournamentPick(tournamentId, match.id, match.entrantAId);
    apiMocks.syncTournamentEvents.mockRejectedValueOnce(
      new TournamentRequestError("另一台设备持有赛事编辑权", 409, "edit_lease_required", {
        editable: false,
        generation: 2,
        activeUntil: "2026-07-20T00:00:45.000Z",
        protectUntil: "2026-07-20T00:05:00.000Z",
        takeoverAllowedAt: "2026-07-20T00:05:00.000Z",
      }),
    );

    onlineState = true;
    await expect(flushTournamentEvents(tournamentId)).rejects.toBeInstanceOf(TournamentLeaseConflictError);
    expect(await pendingTournamentEventCount(tournamentId)).toBe(1);
  });

  it("选择云端进度时原子清空本地事件并替换缓存", async () => {
    const loaded = await loadTournamentForPlay(tournamentId, token);
    const match = loaded.tournament.progress.rounds[0]!.matches[0]!;
    onlineState = false;
    await enqueueTournamentPick(tournamentId, match.id, match.entrantAId);
    serverTournament = { ...serverTournament, version: 8 };

    onlineState = true;
    const resolved = await discardLocalBranchAndReload(tournamentId);

    expect(resolved.tournament.version).toBe(8);
    expect(resolved.pendingCount).toBe(0);
    expect(await pendingTournamentEventCount(tournamentId)).toBe(0);
  });

  it("将本地进度另存为带独立恢复链接的新赛事", async () => {
    const loaded = await loadTournamentForPlay(tournamentId, token);
    const match = loaded.tournament.progress.rounds[0]!.matches[0]!;
    onlineState = false;
    const local = await enqueueTournamentPick(tournamentId, match.id, match.entrantAId);
    const branchedTournament = { ...local.tournament, id: "branched-tournament", version: 1, lastEventSequence: 0 };
    apiMocks.branchTournament.mockResolvedValueOnce({
      tournament: branchedTournament,
      songs,
      restoreToken: "branched-restore-token",
      recoveryPath: "/t/branched-tournament/play#token=branched-restore-token",
    });

    onlineState = true;
    const branch = await saveLocalTournamentAsBranch(tournamentId);

    expect(branch.tournament.id).toBe("branched-tournament");
    expect(branch.recoveryPath).toContain("branched-tournament");
    expect(apiMocks.branchTournament).toHaveBeenCalledWith(tournamentId, token, local.tournament.progress);
  });
});

function createTournament(): CloudTournament {
  return {
    id: tournamentId,
    draftId: "draft-offline",
    snapshotId: "snapshot-offline",
    name: "离线测试世界杯",
    progress: createTournamentProgress(createTournamentDraw({
      eligibleEntrantIds: songs.map((song) => song.id),
      scale: "all",
      random: () => 0.25,
    })),
    version: 1,
    lastEventSequence: 0,
    startedAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
    completedAt: null,
  };
}

function createSongs(count: number): SnapshotSong[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `offline-song-${index + 1}`,
    sourcePosition: index,
    sourceSongId: String(index + 1),
    sourceSongMid: `mid-${index + 1}`,
    title: `离线歌曲 ${index + 1}`,
    artists: [`歌手 ${index + 1}`],
    album: null,
    durationSeconds: null,
    mediaUrl: null,
    previewUrl: null,
  }));
}
