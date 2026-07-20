import { describe, expect, it } from "vitest";
import {
  createTournamentProgress,
  createTournamentDraw,
  deriveTournamentResult,
  getAvailableFixedScales,
  lockTournamentRound,
  nextPowerOfTwo,
  resolveBracketSize,
  setTournamentMatchWinner,
} from "../src/tournament";

describe("赛事规模", () => {
  it("只开放歌曲数量可承载的固定规模", () => {
    expect(getAvailableFixedScales(70)).toEqual([16, 32, 64]);
  });

  it("所有歌曲随机使用向上取整的 2 的幂签表", () => {
    expect(resolveBracketSize("all", 168)).toBe(256);
    expect(nextPowerOfTwo(256)).toBe(256);
  });

  it("固定规模歌曲不足时拒绝创建", () => {
    expect(() => resolveBracketSize(64, 32)).toThrow("无法创建 64 强赛事");
  });
});

describe("抽签", () => {
  it("固定规模同时随机选择歌曲与签位且没有轮空", () => {
    const draw = createTournamentDraw({
      eligibleEntrantIds: entrantIds(70),
      scale: 64,
      random: () => 0.25,
    });

    expect(draw.bracketSize).toBe(64);
    expect(draw.entrantIds).toHaveLength(64);
    expect(draw.firstRound).toHaveLength(32);
    expect(draw.byeCount).toBe(0);
    expect(draw.playableMatchCount).toBe(32);
    expect(draw.slots.every((slot) => slot !== null)).toBe(true);
  });

  it("所有歌曲随机将轮空均衡分布到左右赛区", () => {
    const draw = createTournamentDraw({
      eligibleEntrantIds: entrantIds(168),
      scale: "all",
      random: () => 0.42,
    });
    const leftByes = draw.firstRound.filter((match) => match.side === "left" && match.status === "auto_bye");
    const rightByes = draw.firstRound.filter((match) => match.side === "right" && match.status === "auto_bye");

    expect(draw.bracketSize).toBe(256);
    expect(draw.byeCount).toBe(88);
    expect(draw.playableMatchCount).toBe(40);
    expect(leftByes).toHaveLength(44);
    expect(rightByes).toHaveLength(44);
    expect(draw.firstRound.filter((match) => match.status === "pending")).toHaveLength(40);
  });

  it("奇数轮空时左右赛区数量最多相差一个", () => {
    const draw = createTournamentDraw({
      eligibleEntrantIds: entrantIds(169),
      scale: "all",
      random: () => 0.75,
    });
    const sideByeCounts = ["left", "right"].map((side) => (
      draw.firstRound.filter((match) => match.side === side && match.status === "auto_bye").length
    ));

    expect(draw.byeCount).toBe(87);
    expect(Math.abs((sideByeCounts[0] ?? 0) - (sideByeCounts[1] ?? 0))).toBe(1);
  });

  it("每个首轮位置都是有效对决或单曲轮空，不产生空对空", () => {
    const draw = createTournamentDraw({
      eligibleEntrantIds: entrantIds(17),
      scale: "all",
      random: () => 0.1,
    });

    for (const match of draw.firstRound) {
      const entrantCount = [match.entrantAId, match.entrantBId].filter(Boolean).length;
      expect(entrantCount).toBe(match.status === "auto_bye" ? 1 : 2);
    }
  });

  it("拒绝重复条目 ID，避免同一个快照位置重复入签", () => {
    expect(() => createTournamentDraw({
      eligibleEntrantIds: ["song-1", "song-1"],
      scale: "all",
    })).toThrow("参赛条目 ID 必须唯一");
  });
});

describe("比赛状态机", () => {
  it("开赛时保留首轮对阵并让轮空歌曲自动晋级", () => {
    const progress = createTournamentProgress(createTournamentDraw({
      eligibleEntrantIds: entrantIds(5),
      scale: "all",
      random: () => 0.2,
    }));

    expect(progress.status).toBe("in_progress");
    expect(progress.rounds[0]?.matches).toHaveLength(4);
    expect(progress.rounds[0]?.matches.filter((match) => match.status === "auto_bye")).toHaveLength(3);
    expect(progress.rounds[0]?.matches.filter((match) => match.winnerId)).toHaveLength(3);
  });

  it("支持选择、取消和直接改选胜者", () => {
    const progress = progressForFourSongs();
    const match = progress.rounds[0]?.matches[0];
    expect(match?.entrantBId).toBeTruthy();

    const selected = setTournamentMatchWinner(progress, match!.id, match!.entrantAId);
    expect(selected.rounds[0]?.matches[0]?.status).toBe("picked");
    const switched = setTournamentMatchWinner(selected, match!.id, match!.entrantBId);
    expect(switched.rounds[0]?.matches[0]?.winnerId).toBe(match!.entrantBId);
    const cancelled = setTournamentMatchWinner(switched, match!.id, null);
    expect(cancelled.rounds[0]?.matches[0]?.status).toBe("pending");
  });

  it("未完成全部对决时拒绝锁轮", () => {
    expect(() => lockTournamentRound(progressForFourSongs())).toThrow("请先完成当前轮次");
  });

  it("锁轮后固定胜者并生成下一轮", () => {
    const progress = progressForFourSongs();
    const completed = progress.rounds[0]!.matches.reduce(
      (current, match) => setTournamentMatchWinner(current, match.id, match.entrantAId),
      progress,
    );
    const next = lockTournamentRound(completed);

    expect(next.rounds[0]?.locked).toBe(true);
    expect(next.rounds[0]?.matches.every((match) => match.status === "locked")).toBe(true);
    expect(next.currentRoundIndex).toBe(1);
    expect(next.rounds[1]?.matches).toHaveLength(1);
    expect(next.rounds[1]?.matches[0]?.side).toBe("final");
  });

  it("锁定决赛后产生冠军并结束赛事", () => {
    const firstRound = progressForFourSongs();
    const firstCompleted = firstRound.rounds[0]!.matches.reduce(
      (current, match) => setTournamentMatchWinner(current, match.id, match.entrantAId),
      firstRound,
    );
    const finalRound = lockTournamentRound(firstCompleted);
    const finalMatch = finalRound.rounds[1]!.matches[0]!;
    const finished = lockTournamentRound(setTournamentMatchWinner(finalRound, finalMatch.id, finalMatch.entrantAId));

    expect(finished.status).toBe("finished");
    expect(finished.championId).toBe(finalMatch.entrantAId);
  });

  it("从锁定轮次计算冠军、亚军、四强和实际对决数", () => {
    let progress = progressForFourSongs();
    progress = progress.rounds[0]!.matches.reduce(
      (current, match) => setTournamentMatchWinner(current, match.id, match.entrantAId),
      progress,
    );
    progress = lockTournamentRound(progress);
    const final = progress.rounds[1]!.matches[0]!;
    progress = setTournamentMatchWinner(progress, final.id, final.entrantAId);
    progress = lockTournamentRound(progress);

    const result = deriveTournamentResult(progress);
    expect(result.championId).toBe(final.entrantAId);
    expect(result.runnerUpId).toBe(final.entrantBId);
    expect(result.semifinalistIds).toHaveLength(2);
    expect(result.playedMatchCount).toBe(3);
    expect(result.championWinCount).toBe(2);
  });
});

function entrantIds(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `song-${index + 1}`);
}

function progressForFourSongs() {
  return createTournamentProgress(createTournamentDraw({
    eligibleEntrantIds: entrantIds(4),
    scale: "all",
    random: () => 0.3,
  }));
}
