export const FIXED_TOURNAMENT_SCALES = [16, 32, 64, 128, 256, 512, 1024, 2048, 4096] as const;

export type FixedTournamentScale = typeof FIXED_TOURNAMENT_SCALES[number];
export type TournamentScale = FixedTournamentScale | "all";

export interface TournamentDraft {
  id: string;
  snapshotId: string;
  name: string;
  selectedSongIds: string[];
  scale: TournamentScale;
  cloudDraftId: string | null;
  cloudDraftToken: string | null;
  cloudDraftVersion: number | null;
  updatedAt: string;
}

export type DrawSide = "left" | "right";

export interface DrawMatch {
  index: number;
  side: DrawSide;
  slotA: number;
  slotB: number;
  entrantAId: string | null;
  entrantBId: string | null;
  status: "pending" | "auto_bye";
  autoWinnerId: string | null;
}

export interface TournamentDraw {
  bracketSize: number;
  roundCount: number;
  entrantIds: string[];
  slots: Array<string | null>;
  firstRound: DrawMatch[];
  byeCount: number;
  playableMatchCount: number;
}

export interface CloudTournamentDraft {
  id: string;
  snapshotId: string;
  name: string;
  scale: TournamentScale;
  eligibleSongIds: string[];
  draw: TournamentDraw;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTournamentDrawInput {
  eligibleEntrantIds: string[];
  scale: TournamentScale;
  random?: () => number;
}

export type TournamentMatchStatus = "pending" | "picked" | "locked" | "auto_bye";
export type TournamentSide = DrawSide | "final";

export interface TournamentMatch {
  id: string;
  roundIndex: number;
  index: number;
  side: TournamentSide;
  entrantAId: string;
  entrantBId: string | null;
  winnerId: string | null;
  status: TournamentMatchStatus;
}

export interface TournamentRound {
  index: number;
  matches: TournamentMatch[];
  locked: boolean;
}

export interface TournamentProgress {
  bracketSize: number;
  currentRoundIndex: number;
  rounds: TournamentRound[];
  status: "in_progress" | "finished";
  championId: string | null;
}

export interface CloudTournament {
  id: string;
  draftId: string;
  snapshotId: string;
  name: string;
  progress: TournamentProgress;
  version: number;
  lastEventSequence: number;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface TournamentResultSummary {
  championId: string;
  runnerUpId: string;
  semifinalistIds: string[];
  playedMatchCount: number;
  championWinCount: number;
}

export function getAvailableFixedScales(songCount: number): FixedTournamentScale[] {
  return FIXED_TOURNAMENT_SCALES.filter((scale) => scale <= songCount);
}

export function resolveBracketSize(scale: TournamentScale, songCount: number): number {
  if (!Number.isInteger(songCount) || songCount < 2) {
    throw new RangeError("至少需要 2 首歌曲才能生成签表");
  }

  if (scale === "all") {
    return nextPowerOfTwo(songCount);
  }

  if (songCount < scale) {
    throw new RangeError(`当前仅有 ${songCount} 首歌曲，无法创建 ${scale} 强赛事`);
  }

  return scale;
}

export function nextPowerOfTwo(value: number): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError("歌曲数量必须是正整数");
  }

  return 2 ** Math.ceil(Math.log2(value));
}

export function createTournamentDraw({
  eligibleEntrantIds,
  scale,
  random = Math.random,
}: CreateTournamentDrawInput): TournamentDraw {
  assertUniqueEntrants(eligibleEntrantIds);
  const bracketSize = resolveBracketSize(scale, eligibleEntrantIds.length);
  const entrantIds = shuffle(eligibleEntrantIds, random).slice(
    0,
    scale === "all" ? eligibleEntrantIds.length : scale,
  );
  const pairCount = bracketSize / 2;
  const byeCount = bracketSize - entrantIds.length;
  const playableMatchCount = pairCount - byeCount;
  const byePairs = distributeByePairs(pairCount, byeCount, random);
  const shuffledEntrants = shuffle(entrantIds, random);
  const slots: Array<string | null> = Array.from({ length: bracketSize }, () => null);
  const firstRound: DrawMatch[] = [];
  let entrantCursor = 0;

  for (let pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {
    const slotA = pairIndex * 2;
    const slotB = slotA + 1;
    const isBye = byePairs.has(pairIndex);

    if (isBye) {
      const entrantId = shuffledEntrants[entrantCursor];
      if (!entrantId) {
        throw new Error("抽签时参赛歌曲数量不足");
      }
      entrantCursor += 1;
      const useFirstSlot = normalizeRandom(random()) < 0.5;
      slots[useFirstSlot ? slotA : slotB] = entrantId;
      firstRound.push({
        index: pairIndex,
        side: pairIndex < pairCount / 2 ? "left" : "right",
        slotA,
        slotB,
        entrantAId: slots[slotA] ?? null,
        entrantBId: slots[slotB] ?? null,
        status: "auto_bye",
        autoWinnerId: entrantId,
      });
      continue;
    }

    const entrantAId = shuffledEntrants[entrantCursor];
    const entrantBId = shuffledEntrants[entrantCursor + 1];
    if (!entrantAId || !entrantBId) {
      throw new Error("抽签时参赛歌曲数量不足");
    }
    entrantCursor += 2;
    slots[slotA] = entrantAId;
    slots[slotB] = entrantBId;
    firstRound.push({
      index: pairIndex,
      side: pairIndex < pairCount / 2 ? "left" : "right",
      slotA,
      slotB,
      entrantAId,
      entrantBId,
      status: "pending",
      autoWinnerId: null,
    });
  }

  if (entrantCursor !== entrantIds.length) {
    throw new Error("抽签结果未消费全部参赛歌曲");
  }

  return {
    bracketSize,
    roundCount: Math.log2(bracketSize),
    entrantIds,
    slots,
    firstRound,
    byeCount,
    playableMatchCount,
  };
}

export function createTournamentProgress(draw: TournamentDraw): TournamentProgress {
  const matches: TournamentMatch[] = draw.firstRound.map((match) => {
    const entrantAId = match.entrantAId ?? match.entrantBId;
    if (!entrantAId) {
      throw new Error("首轮对阵缺少参赛歌曲");
    }
    return {
      id: matchId(0, match.index),
      roundIndex: 0,
      index: match.index,
      side: match.side,
      entrantAId,
      entrantBId: match.status === "auto_bye" ? null : match.entrantBId,
      winnerId: match.status === "auto_bye" ? match.autoWinnerId : null,
      status: match.status,
    };
  });

  return {
    bracketSize: draw.bracketSize,
    currentRoundIndex: 0,
    rounds: [{ index: 0, matches, locked: false }],
    status: "in_progress",
    championId: null,
  };
}

export function setTournamentMatchWinner(
  progress: TournamentProgress,
  matchIdValue: string,
  winnerId: string | null,
): TournamentProgress {
  assertTournamentInProgress(progress);
  const currentRound = progress.rounds[progress.currentRoundIndex];
  if (!currentRound || currentRound.locked) {
    throw new RangeError("当前轮次已锁定");
  }
  const match = currentRound.matches.find((candidate) => candidate.id === matchIdValue);
  if (!match) {
    throw new RangeError("当前轮次不存在该场比赛");
  }
  if (match.status === "auto_bye") {
    throw new RangeError("轮空歌曲已自动晋级，不能修改");
  }
  if (winnerId !== null && winnerId !== match.entrantAId && winnerId !== match.entrantBId) {
    throw new RangeError("胜者必须来自当前对阵");
  }

  return replaceCurrentRoundMatch(progress, {
    ...match,
    winnerId,
    status: winnerId === null ? "pending" : "picked",
  });
}

export function lockTournamentRound(progress: TournamentProgress): TournamentProgress {
  assertTournamentInProgress(progress);
  const currentRound = progress.rounds[progress.currentRoundIndex];
  if (!currentRound || currentRound.locked) {
    throw new RangeError("当前轮次已锁定");
  }
  if (currentRound.matches.some((match) => !match.winnerId)) {
    throw new RangeError("请先完成当前轮次的全部对决");
  }

  const lockedRound: TournamentRound = {
    ...currentRound,
    locked: true,
    matches: currentRound.matches.map((match) => (
      match.status === "auto_bye" ? match : { ...match, status: "locked" }
    )),
  };
  const winners = lockedRound.matches.map((match) => match.winnerId).filter((id): id is string => Boolean(id));
  const rounds = progress.rounds.map((round) => round.index === lockedRound.index ? lockedRound : round);

  if (winners.length === 1) {
    return {
      ...progress,
      rounds,
      status: "finished",
      championId: winners[0] ?? null,
    };
  }

  const nextRoundIndex = progress.currentRoundIndex + 1;
  const nextMatches: TournamentMatch[] = [];
  for (let index = 0; index < winners.length; index += 2) {
    const entrantAId = winners[index];
    const entrantBId = winners[index + 1];
    if (!entrantAId || !entrantBId) {
      throw new Error("锁轮后晋级歌曲数量无效");
    }
    const matchCount = winners.length / 2;
    nextMatches.push({
      id: matchId(nextRoundIndex, index / 2),
      roundIndex: nextRoundIndex,
      index: index / 2,
      side: matchCount === 1 ? "final" : index / 2 < matchCount / 2 ? "left" : "right",
      entrantAId,
      entrantBId,
      winnerId: null,
      status: "pending",
    });
  }

  return {
    ...progress,
    currentRoundIndex: nextRoundIndex,
    rounds: [...rounds, { index: nextRoundIndex, matches: nextMatches, locked: false }],
  };
}

export function deriveTournamentResult(progress: TournamentProgress): TournamentResultSummary {
  if (progress.status !== "finished" || !progress.championId) {
    throw new RangeError("赛事尚未完成，不能生成赛果");
  }
  const finalRound = progress.rounds.at(-1);
  const finalMatch = finalRound?.matches[0];
  if (!finalMatch?.winnerId || !finalMatch.entrantBId) {
    throw new Error("决赛数据不完整");
  }
  const runnerUpId = finalMatch.entrantAId === progress.championId
    ? finalMatch.entrantBId
    : finalMatch.entrantAId;
  const semifinalRound = progress.rounds.at(-2);
  const semifinalistIds = semifinalRound?.matches.flatMap((match) => {
    if (!match.winnerId || !match.entrantBId) return [];
    return [match.entrantAId === match.winnerId ? match.entrantBId : match.entrantAId];
  }) ?? [];
  const playedMatches = progress.rounds.flatMap((round) => round.matches)
    .filter((match) => match.status !== "auto_bye");
  return {
    championId: progress.championId,
    runnerUpId,
    semifinalistIds,
    playedMatchCount: playedMatches.length,
    championWinCount: playedMatches.filter((match) => match.winnerId === progress.championId).length,
  };
}

function distributeByePairs(pairCount: number, byeCount: number, random: () => number): Set<number> {
  if (byeCount === 0) {
    return new Set();
  }

  const sidePairCount = pairCount / 2;
  const leftPairIndices = Array.from({ length: sidePairCount }, (_, index) => index);
  const rightPairIndices = Array.from({ length: sidePairCount }, (_, index) => index + sidePairCount);
  const sideWithExtraBye: DrawSide = normalizeRandom(random()) < 0.5 ? "left" : "right";
  const baseByeCount = Math.floor(byeCount / 2);
  const leftByeCount = baseByeCount + (byeCount % 2 === 1 && sideWithExtraBye === "left" ? 1 : 0);
  const rightByeCount = byeCount - leftByeCount;

  return new Set([
    ...shuffle(leftPairIndices, random).slice(0, leftByeCount),
    ...shuffle(rightPairIndices, random).slice(0, rightByeCount),
  ]);
}

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(normalizeRandom(random()) * (index + 1));
    const current = result[index];
    const target = result[swapIndex];
    if (current === undefined || target === undefined) {
      throw new Error("抽签随机序列无效");
    }
    result[index] = target;
    result[swapIndex] = current;
  }
  return result;
}

function normalizeRandom(value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError("随机数生成器必须返回有限数值");
  }
  return Math.min(Math.max(value, 0), 1 - Number.EPSILON);
}

function assertUniqueEntrants(entrantIds: string[]): void {
  if (entrantIds.length < 2) {
    throw new RangeError("至少需要 2 首歌曲才能生成签表");
  }
  if (new Set(entrantIds).size !== entrantIds.length) {
    throw new RangeError("参赛条目 ID 必须唯一，重复歌曲应使用不同快照位置 ID");
  }
}

function replaceCurrentRoundMatch(progress: TournamentProgress, nextMatch: TournamentMatch): TournamentProgress {
  return {
    ...progress,
    rounds: progress.rounds.map((round) => (
      round.index === progress.currentRoundIndex
        ? { ...round, matches: round.matches.map((match) => match.id === nextMatch.id ? nextMatch : match) }
        : round
    )),
  };
}

function assertTournamentInProgress(progress: TournamentProgress): void {
  if (progress.status !== "in_progress") {
    throw new RangeError("赛事已经结束");
  }
}

function matchId(roundIndex: number, index: number): string {
  return `r${roundIndex + 1}-m${index + 1}`;
}
