import { describe, expect, it } from "vitest";
import {
  createTournamentDraw,
  createTournamentProgress,
  lockTournamentRound,
  setTournamentMatchWinner,
} from "@song-world-cup/domain";
import {
  TournamentConflictError,
  TournamentValidationError,
  replayTournamentEventBatch,
  validateBranchProgress,
} from "./tournaments";

describe("本地赛事分支校验", () => {
  it("接受由原签表状态机生成的跨轮进度", () => {
    const draw = createDraw();
    let progress = createTournamentProgress(draw);
    for (const match of progress.rounds[0]!.matches) {
      progress = setTournamentMatchWinner(progress, match.id, match.entrantAId);
    }
    progress = lockTournamentRound(progress);
    const semifinal = progress.rounds[1]!.matches[0]!;
    progress = setTournamentMatchWinner(progress, semifinal.id, semifinal.entrantBId);

    expect(validateBranchProgress(draw, progress)).toEqual(progress);
  });

  it("拒绝注入原签表外歌曲的进度", () => {
    const draw = createDraw();
    const progress = createTournamentProgress(draw);
    const tampered = structuredClone(progress);
    tampered.rounds[0]!.matches[0]!.entrantAId = "injected-song";

    expect(() => validateBranchProgress(draw, tampered)).toThrow(TournamentValidationError);
  });
});

describe("赛事事件批量回放", () => {
  it("一次连续回放整批事件，并允许同一批次幂等重试", () => {
    const progress = createTournamentProgress(createDraw());
    const matches = progress.rounds[0]!.matches;
    const input = {
      version: 1,
      events: [
        { kind: "pick", eventId: "event-0001", sequence: 1, matchId: matches[0]!.id, winnerId: matches[0]!.entrantAId },
        { kind: "pick", eventId: "event-0002", sequence: 2, matchId: matches[1]!.id, winnerId: matches[1]!.entrantAId },
        { kind: "lock_round", eventId: "event-0003", sequence: 3 },
      ],
    };

    const replayed = replayTournamentEventBatch({
      progress,
      version: 1,
      lastEventId: null,
      lastEventSequence: 0,
    }, input);

    expect(replayed.version).toBe(4);
    expect(replayed.lastEventSequence).toBe(3);
    expect(replayed.appliedCount).toBe(3);
    expect(replayed.progress.currentRoundIndex).toBe(1);

    const retried = replayTournamentEventBatch(replayed, input);
    expect(retried.appliedCount).toBe(0);
    expect(retried.progress).toEqual(replayed.progress);
  });

  it("拒绝不连续批次和无法验证的重叠事件", () => {
    const progress = createTournamentProgress(createDraw());
    const match = progress.rounds[0]!.matches[0]!;
    expect(() => replayTournamentEventBatch({
      progress,
      version: 1,
      lastEventId: null,
      lastEventSequence: 0,
    }, {
      version: 1,
      events: [
        { kind: "pick", eventId: "event-0001", sequence: 1, matchId: match.id, winnerId: match.entrantAId },
        { kind: "lock_round", eventId: "event-0003", sequence: 3 },
      ],
    })).toThrow(TournamentValidationError);

    expect(() => replayTournamentEventBatch({
      progress,
      version: 2,
      lastEventId: "another-event",
      lastEventSequence: 1,
    }, {
      version: 1,
      events: [{ kind: "pick", eventId: "event-0001", sequence: 1, matchId: match.id, winnerId: match.entrantAId }],
    })).toThrow(TournamentConflictError);
  });
});

function createDraw() {
  return createTournamentDraw({
    eligibleEntrantIds: ["song-1", "song-2", "song-3", "song-4"],
    scale: "all",
    random: () => 0.25,
  });
}
