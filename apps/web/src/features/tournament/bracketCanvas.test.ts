import { describe, expect, it } from "vitest";
import type { TournamentRound } from "@song-world-cup/domain";
import {
  calculateMatchCapacity,
  cameraTargetForStep,
  canvasMetricsForWidth,
  createBracketConnectorGeometry,
  createBracketWorld,
  createRoundCanvasSteps,
  findCanvasStepByMatchId,
  parentNodeIds,
  projectMobileCanvasStep,
  promotionFocusPointForStep,
  visibleCanvasStepIndexes,
} from "./bracketCanvas";

describe("固定签表画布布局", () => {
  it.each([16, 32, 64, 4096])("为 %i 强签表生成稳定的完整拓扑", (bracketSize) => {
    const world = createBracketWorld(bracketSize);
    expect(world.nodes).toHaveLength(bracketSize - 1);
    expect(world.roundCount).toBe(Math.log2(bracketSize));
    expect(world.nodeById.get("r1-m1")?.parentId).toBe("r2-m1");
    expect(world.nodeById.get(`r${world.roundCount}-m1`)).toMatchObject({
      side: "final",
      parentId: null,
      x: 0,
      y: 0,
    });
  });

  it("让左右赛区从外侧向中心决赛汇聚", () => {
    const world = createBracketWorld(16);
    const left = world.nodeById.get("r1-m1");
    const right = world.nodeById.get("r1-m8");
    const leftNext = world.nodeById.get("r2-m1");
    const rightNext = world.nodeById.get("r2-m4");
    expect(left?.x).toBeLessThan(leftNext?.x ?? Number.NEGATIVE_INFINITY);
    expect(right?.x).toBeGreaterThan(rightNext?.x ?? Number.POSITIVE_INFINITY);
  });

  it("按视窗尺寸和关键轮次限制每组对阵数", () => {
    expect(calculateMatchCapacity({ width: 390, height: 844 }, 16)).toBe(4);
    expect(calculateMatchCapacity({ width: 1440, height: 900 }, 64)).toBe(8);
    expect(calculateMatchCapacity({ width: 1329, height: 610 }, 64)).toBe(8);
    expect(calculateMatchCapacity({ width: 1329, height: 560 }, 64)).toBe(6);
    expect(calculateMatchCapacity({ width: 1329, height: 470 }, 64)).toBe(4);
    expect(calculateMatchCapacity({ width: 1024, height: 720 }, 64)).toBe(6);
    expect(calculateMatchCapacity({ width: 1024, height: 560 }, 64)).toBe(4);
    expect(calculateMatchCapacity({ width: 390, height: 520 }, 64)).toBe(4);
    expect(calculateMatchCapacity({ width: 390, height: 519 }, 64)).toBe(2);
    expect(calculateMatchCapacity({ width: 390, height: 320 }, 64)).toBe(2);
    expect(calculateMatchCapacity({ width: 1440, height: 900 }, 8)).toBe(2);
    expect(calculateMatchCapacity({ width: 1440, height: 900 }, 4)).toBe(1);
  });

  it("为宽屏八场布局使用可完整容纳的紧凑行距", () => {
    expect(canvasMetricsForWidth(1329).rowPitch).toBe(72);
  });

  it("为移动端四场布局预留放大后的节点尺寸", () => {
    expect(canvasMetricsForWidth(390)).toEqual({ columnGap: 196, rowPitch: 128 });
  });

  it("让移动端普通轮次从画布顶部开始展示", () => {
    const world = createBracketWorld(32, canvasMetricsForWidth(390));
    const step = createRoundCanvasSteps(createRound(16), 4)[0]!;
    const target = cameraTargetForStep(step, world, {
      viewport: { width: 390, height: 656 },
      mobileLayout: "top",
    });
    const firstNode = world.nodeById.get(step.matches[0]!.id)!;
    const firstNodeTop = firstNode.y - target.y + 656 / 2 - 112 / 2;
    expect(firstNodeTop).toBe(18);
    expect(firstNode.x - target.x + 390 / 2).toBe(122);
  });

  it("让移动端右赛区保持向中心汇聚的镜像布局", () => {
    const world = createBracketWorld(32, canvasMetricsForWidth(390));
    const step = createRoundCanvasSteps(createRound(16), 4)[2]!;
    const target = cameraTargetForStep(step, world, {
      viewport: { width: 390, height: 656 },
      mobileLayout: "top",
    });
    const firstNode = world.nodeById.get(step.matches[0]!.id)!;
    expect(firstNode.x - target.x + 390 / 2).toBe(268);
  });

  it("将移动端后续普通轮次投影为四个完整可操作行", () => {
    const viewport = { width: 390, height: 656 };
    const world = createBracketWorld(64, canvasMetricsForWidth(viewport.width));
    const step = createRoundCanvasSteps(createRound(16, 1), 4)[0]!;
    const originalRows = step.matches.map((match) => world.nodeById.get(match.id)!.y);
    expect(originalRows[1]! - originalRows[0]!).toBe(256);

    const projected = projectMobileCanvasStep(step, world, 128);
    const projectedRows = step.matches.map((match) => projected.get(match.id)!.y);
    expect(projectedRows).toEqual([
      projectedRows[0],
      projectedRows[0]! + 128,
      projectedRows[0]! + 256,
      projectedRows[0]! + 384,
    ]);
    const target = cameraTargetForStep(step, world, {
      viewport,
      mobileLayout: "top",
      nodeOverrides: projected,
    });
    const tops = projectedRows.map((row) => row - target.y + viewport.height / 2 - 56);
    expect(tops[0]).toBe(18);
    expect(tops[3]! + 112).toBeLessThanOrEqual(viewport.height);

    const parentIds = parentNodeIds(step, world);
    expect(projected.get(parentIds[0]!)?.y).toBe(projectedRows[0]! + 64);
    expect(projected.get(parentIds[1]!)?.y).toBe(projectedRows[0]! + 320);
  });

  it("逐轮验证 4096 强到总决赛的移动端节点均处于安全视窗", () => {
    const viewport = { width: 390, height: 656 };
    const world = createBracketWorld(4096, canvasMetricsForWidth(viewport.width));
    const entrantCounts = [4096, 2048, 1024, 512, 256, 128, 64, 32, 16, 8, 4, 2];

    entrantCounts.forEach((entrants, roundIndex) => {
      const round = createRound(entrants / 2, roundIndex);
      const capacity = calculateMatchCapacity(viewport, entrants);
      const step = createRoundCanvasSteps(round, capacity)[0]!;
      const projected = entrants >= 8 ? projectMobileCanvasStep(step, world, 128) : new Map();
      const mobileLayout = entrants > 8 ? "top" as const : entrants === 8 ? "center" as const : null;
      const target = cameraTargetForStep(step, world, {
        viewport,
        mobileLayout,
        nodeOverrides: projected,
      });
      const matchHeight = entrants === 2 ? 165 : entrants === 4 ? 118 : 112;
      const matchWidth = entrants === 2 ? 310 : entrants === 4 ? 184 : 220;
      const screenMatches = step.matches.map((match) => {
        const node = projected.get(match.id) ?? world.nodeById.get(match.id)!;
        const centerX = node.x - target.x + viewport.width / 2;
        const centerY = node.y - target.y + viewport.height / 2;
        return {
          left: centerX - matchWidth / 2,
          right: centerX + matchWidth / 2,
          top: centerY - matchHeight / 2,
          bottom: centerY + matchHeight / 2,
        };
      });

      expect(Math.min(...screenMatches.map((match) => match.left))).toBeGreaterThanOrEqual(0);
      expect(Math.max(...screenMatches.map((match) => match.right))).toBeLessThanOrEqual(viewport.width);
      expect(Math.min(...screenMatches.map((match) => match.top))).toBeGreaterThanOrEqual(0);
      expect(Math.max(...screenMatches.map((match) => match.bottom))).toBeLessThanOrEqual(viewport.height);
      if (entrants > 8) expect(Math.min(...screenMatches.map((match) => match.top))).toBe(18);
      if (entrants === 8) {
        expect(screenMatches).toHaveLength(2);
        expect(screenMatches[1]!.top - screenMatches[0]!.top).toBe(128);
      }

      for (const parentId of parentNodeIds(step, world)) {
        const parent = projected.get(parentId) ?? world.nodeById.get(parentId)!;
        const centerX = parent.x - target.x + viewport.width / 2;
        const centerY = parent.y - target.y + viewport.height / 2;
        expect(centerX - 60).toBeGreaterThanOrEqual(0);
        expect(centerX + 60).toBeLessThanOrEqual(viewport.width);
        expect(centerY - 53).toBeGreaterThanOrEqual(0);
        expect(centerY + 53).toBeLessThanOrEqual(viewport.height);
      }
    });
  });

  it("让左右赛区晋级线只连接节点外框，不穿过卡片", () => {
    const left = createBracketConnectorGeometry({ x: -340, y: 0 }, { x: 0, y: 0 }, 320, 210);
    expect(left.left + left.x1).toBe(-180);
    expect(left.left + left.x2).toBe(-105);

    const right = createBracketConnectorGeometry({ x: 340, y: 0 }, { x: 0, y: 0 }, 320, 210);
    expect(right.left + right.x1).toBe(180);
    expect(right.left + right.x2).toBe(105);
  });

  it("让半决赛舞台装饰对齐总决赛晋级节点", () => {
    const world = createBracketWorld(4);
    const steps = createRoundCanvasSteps(createRound(2), 1);
    expect(promotionFocusPointForStep(steps[0]!, world)).toEqual({ x: 0, y: 0 });
    expect(promotionFocusPointForStep(steps[1]!, world)).toEqual({ x: 0, y: 0 });
  });

  it("固定先走左赛区，再从右赛区底部向顶部连续移动", () => {
    const round = createRound(8);
    const steps = createRoundCanvasSteps(round, 2);
    expect(steps.map((step) => step.matches.map((match) => match.id))).toEqual([
      ["r1-m1", "r1-m2"],
      ["r1-m3", "r1-m4"],
      ["r1-m8", "r1-m7"],
      ["r1-m6", "r1-m5"],
    ]);
    expect(findCanvasStepByMatchId(steps, "r1-m7")).toBe(2);
  });

  it("轮空不形成操作步骤，但仍保留其晋级父节点", () => {
    const round = createRound(8);
    round.matches[0] = { ...round.matches[0]!, status: "auto_bye", winnerId: "song-a" };
    const world = createBracketWorld(16);
    const steps = createRoundCanvasSteps(round, 4);
    expect(steps.flatMap((step) => step.matches).some((match) => match.id === "r1-m1")).toBe(false);
    expect(world.nodeById.get("r1-m1")?.parentId).toBe("r2-m1");
    expect(parentNodeIds(steps[0]!, world).length).toBeGreaterThan(0);
  });

  it("虚拟窗口最多包含当前及相邻三个步骤", () => {
    expect(visibleCanvasStepIndexes(5, 20)).toEqual([4, 5, 6]);
    expect(visibleCanvasStepIndexes(0, 20)).toEqual([0, 1]);
    expect(visibleCanvasStepIndexes(19, 20)).toEqual([18, 19]);
  });

  it("4096 强时渲染集合仍与视窗容量绑定", () => {
    const world = createBracketWorld(4096);
    const steps = createRoundCanvasSteps(createRound(2048), 8);
    const visibleSteps = visibleCanvasStepIndexes(100, steps.length).map((index) => steps[index]!);
    const matchIds = new Set(visibleSteps.flatMap((step) => step.matches.map((match) => match.id)));
    const promotionIds = new Set(visibleSteps.flatMap((step) => parentNodeIds(step, world)));
    expect(world.nodes).toHaveLength(4095);
    expect(matchIds.size).toBeLessThanOrEqual(24);
    expect(promotionIds.size).toBeLessThanOrEqual(12);
  });
});

function createRound(matchCount: number, roundIndex = 0): TournamentRound {
  return {
    index: roundIndex,
    locked: false,
    matches: Array.from({ length: matchCount }, (_, index) => ({
      id: `r${roundIndex + 1}-m${index + 1}`,
      roundIndex,
      index,
      side: matchCount === 1 ? "final" as const : index < matchCount / 2 ? "left" as const : "right" as const,
      entrantAId: `song-${index * 2 + 1}`,
      entrantBId: `song-${index * 2 + 2}`,
      winnerId: null,
      status: "pending" as const,
    })),
  };
}
