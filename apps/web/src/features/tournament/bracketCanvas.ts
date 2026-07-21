import type { TournamentMatch, TournamentRound, TournamentSide } from "@song-world-cup/domain";

export interface BracketWorldMetrics {
  columnGap: number;
  rowPitch: number;
}

export interface BracketWorldNode {
  id: string;
  roundIndex: number;
  index: number;
  side: TournamentSide;
  parentId: string | null;
  x: number;
  y: number;
}

export interface BracketWorld {
  bracketSize: number;
  roundCount: number;
  width: number;
  height: number;
  nodes: BracketWorldNode[];
  nodeById: Map<string, BracketWorldNode>;
}

export interface CanvasMatchStep {
  id: string;
  side: TournamentSide;
  matches: TournamentMatch[];
}

export interface CanvasViewportSize {
  width: number;
  height: number;
}

export interface BracketConnectorGeometry {
  left: number;
  top: number;
  width: number;
  height: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  middleX: number;
}

export interface CameraTargetOptions {
  viewport: CanvasViewportSize;
  mobileLayout: "top" | "center" | null;
  nodeOverrides?: ReadonlyMap<string, BracketWorldNode>;
}

export const MOBILE_STANDARD_LAYOUT = {
  matchWidth: 220,
  matchHeight: 112,
  promotionWidth: 120,
  sideInset: 12,
  topInset: 18,
} as const;

const DEFAULT_METRICS: BracketWorldMetrics = {
  columnGap: 320,
  rowPitch: 104,
};

export function createBracketWorld(
  bracketSize: number,
  metrics: BracketWorldMetrics = DEFAULT_METRICS,
): BracketWorld {
  if (!Number.isInteger(bracketSize) || bracketSize < 2 || (bracketSize & (bracketSize - 1)) !== 0) {
    throw new RangeError("签表规模必须是大于等于 2 的二次幂");
  }
  const roundCount = Math.log2(bracketSize);
  const firstRoundMatchesPerSide = Math.max(bracketSize / 4, 1);
  const height = firstRoundMatchesPerSide * metrics.rowPitch;
  const nodes: BracketWorldNode[] = [];

  for (let roundIndex = 0; roundIndex < roundCount; roundIndex += 1) {
    const matchCount = bracketSize / 2 ** (roundIndex + 1);
    const sideMatchCount = Math.max(matchCount / 2, 1);
    const pitch = metrics.rowPitch * 2 ** roundIndex;
    const distanceFromCenter = (roundCount - roundIndex - 1) * metrics.columnGap;

    for (let index = 0; index < matchCount; index += 1) {
      const side: TournamentSide = matchCount === 1
        ? "final"
        : index < matchCount / 2 ? "left" : "right";
      const sideIndex = side === "right" ? index - matchCount / 2 : index;
      const x = side === "left" ? -distanceFromCenter : side === "right" ? distanceFromCenter : 0;
      const y = side === "final" ? 0 : (sideIndex + 0.5) * pitch - sideMatchCount * pitch / 2;
      nodes.push({
        id: matchId(roundIndex, index),
        roundIndex,
        index,
        side,
        parentId: roundIndex === roundCount - 1 ? null : matchId(roundIndex + 1, Math.floor(index / 2)),
        x,
        y,
      });
    }
  }

  return {
    bracketSize,
    roundCount,
    width: (roundCount - 1) * metrics.columnGap * 2,
    height,
    nodes,
    nodeById: new Map(nodes.map((node) => [node.id, node])),
  };
}

export function canvasMetricsForWidth(width: number): BracketWorldMetrics {
  if (width < 600) return { columnGap: 196, rowPitch: 128 };
  if (width < 1180) return { columnGap: 280, rowPitch: 102 };
  return { columnGap: 340, rowPitch: 72 };
}

export function calculateMatchCapacity(
  viewport: CanvasViewportSize,
  entrantsThisRound: number,
): number {
  if (entrantsThisRound <= 4) return 1;
  if (entrantsThisRound <= 8) return 2;
  if (viewport.width <= 720 && viewport.height < 520) return 2;
  if (viewport.width >= 1180 && viewport.height >= 580) return 8;
  if (viewport.width >= 1180 && viewport.height >= 480) return 6;
  if (viewport.width >= 760 && viewport.height >= 620) return 6;
  if (viewport.height >= 360) return 4;
  return 2;
}

export function cameraTargetForStep(
  step: CanvasMatchStep,
  world: BracketWorld,
  options: CameraTargetOptions,
): { x: number; y: number } {
  const matchNodes = step.matches.flatMap((match) => {
    const node = options.nodeOverrides?.get(match.id) ?? world.nodeById.get(match.id);
    return node ? [node] : [];
  });
  const promotionNodes = parentNodeIds(step, world).flatMap((id) => {
    const node = options.nodeOverrides?.get(id) ?? world.nodeById.get(id);
    return node ? [node] : [];
  });
  const nodes = [...matchNodes, ...promotionNodes];
  if (nodes.length === 0) return { x: 0, y: 0 };

  if (options.mobileLayout && matchNodes.length > 0 && step.side !== "final") {
    const firstMatch = matchNodes[0]!;
    const desiredMatchCenterX = step.side === "left"
      ? MOBILE_STANDARD_LAYOUT.sideInset + MOBILE_STANDARD_LAYOUT.matchWidth / 2
      : options.viewport.width - MOBILE_STANDARD_LAYOUT.sideInset - MOBILE_STANDARD_LAYOUT.matchWidth / 2;
    const minMatchY = matchNodes.reduce((minimum, node) => Math.min(minimum, node.y), matchNodes[0]!.y);
    const x = firstMatch.x + options.viewport.width / 2 - desiredMatchCenterX;
    if (options.mobileLayout === "center") {
      const maxMatchY = matchNodes.reduce((maximum, node) => Math.max(maximum, node.y), matchNodes[0]!.y);
      return { x, y: (minMatchY + maxMatchY) / 2 };
    }
    return {
      x,
      y: minMatchY + options.viewport.height / 2
        - MOBILE_STANDARD_LAYOUT.topInset
        - MOBILE_STANDARD_LAYOUT.matchHeight / 2,
    };
  }

  let minX = nodes[0]!.x;
  let maxX = minX;
  let minY = nodes[0]!.y;
  let maxY = minY;
  for (const node of nodes.slice(1)) {
    minX = Math.min(minX, node.x);
    maxX = Math.max(maxX, node.x);
    minY = Math.min(minY, node.y);
    maxY = Math.max(maxY, node.y);
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

export function projectMobileCanvasStep(
  step: CanvasMatchStep,
  world: BracketWorld,
  rowPitch = MOBILE_STANDARD_LAYOUT.matchHeight + 16,
): Map<string, BracketWorldNode> {
  const projected = new Map<string, BracketWorldNode>();
  const sourceNodes = step.matches.flatMap((match) => {
    const node = world.nodeById.get(match.id);
    return node ? [node] : [];
  });
  if (sourceNodes.length === 0) return projected;

  const firstRowY = sourceNodes.reduce((minimum, node) => Math.min(minimum, node.y), sourceNodes[0]!.y);
  const childRowsByParent = new Map<string, number[]>();
  sourceNodes.forEach((node, index) => {
    const projectedNode = { ...node, y: firstRowY + index * rowPitch };
    projected.set(node.id, projectedNode);
    if (!node.parentId) return;
    const rows = childRowsByParent.get(node.parentId) ?? [];
    rows.push(projectedNode.y);
    childRowsByParent.set(node.parentId, rows);
  });

  for (const [parentId, childRows] of childRowsByParent) {
    const parent = world.nodeById.get(parentId);
    if (!parent) continue;
    projected.set(parentId, {
      ...parent,
      y: childRows.reduce((total, value) => total + value, 0) / childRows.length,
    });
  }
  return projected;
}

export function createRoundCanvasSteps(round: TournamentRound, capacity: number): CanvasMatchStep[] {
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new RangeError("每屏对阵数必须是正整数");
  }
  const actionable = round.matches.filter((match) => match.status !== "auto_bye");
  const sides: TournamentSide[] = ["left", "right", "final"];
  const steps: CanvasMatchStep[] = [];

  for (const side of sides) {
    const matches = actionable
      .filter((match) => match.side === side)
      .sort((first, second) => side === "right" ? second.index - first.index : first.index - second.index);
    for (let start = 0; start < matches.length; start += capacity) {
      const group = matches.slice(start, start + capacity);
      const first = group[0];
      if (!first) continue;
      steps.push({ id: `round-${round.index}-${side}-${first.id}`, side, matches: group });
    }
  }
  return steps;
}

export function initialCanvasStepIndex(steps: CanvasMatchStep[]): number {
  const incomplete = steps.findIndex((step) => step.matches.some((match) => !match.winnerId));
  return incomplete >= 0 ? incomplete : Math.max(steps.length - 1, 0);
}

export function findCanvasStepByMatchId(steps: CanvasMatchStep[], matchIdValue: string | null): number {
  if (!matchIdValue) return -1;
  return steps.findIndex((step) => step.matches.some((match) => match.id === matchIdValue));
}

export function visibleCanvasStepIndexes(currentIndex: number, stepCount: number): number[] {
  const indexes: number[] = [];
  for (let index = currentIndex - 1; index <= currentIndex + 1; index += 1) {
    if (index >= 0 && index < stepCount) indexes.push(index);
  }
  return indexes;
}

export function parentNodeIds(step: CanvasMatchStep, world: BracketWorld): string[] {
  return [...new Set(step.matches.flatMap((match) => {
    const parentId = world.nodeById.get(match.id)?.parentId;
    return parentId ? [parentId] : [];
  }))];
}

export function promotionFocusPointForStep(
  step: CanvasMatchStep,
  world: BracketWorld,
  nodeOverrides?: ReadonlyMap<string, BracketWorldNode>,
): { x: number; y: number } {
  const promotionNodes = parentNodeIds(step, world).flatMap((nodeId) => {
    const node = nodeOverrides?.get(nodeId) ?? world.nodeById.get(nodeId);
    return node ? [node] : [];
  });
  const nodes = promotionNodes.length > 0
    ? promotionNodes
    : step.matches.flatMap((match) => {
      const node = nodeOverrides?.get(match.id) ?? world.nodeById.get(match.id);
      return node ? [node] : [];
    });
  if (nodes.length === 0) return { x: 0, y: 0 };
  return {
    x: nodes.reduce((total, node) => total + node.x, 0) / nodes.length,
    y: nodes.reduce((total, node) => total + node.y, 0) / nodes.length,
  };
}

export function createBracketConnectorGeometry(
  from: Pick<BracketWorldNode, "x" | "y">,
  to: Pick<BracketWorldNode, "x" | "y">,
  fromWidth: number,
  toWidth: number,
  padding = 4,
): BracketConnectorGeometry {
  const direction = Math.sign(to.x - from.x);
  const startWorldX = from.x + direction * fromWidth / 2;
  const endWorldX = to.x - direction * toWidth / 2;
  const left = Math.min(startWorldX, endWorldX) - padding;
  const top = Math.min(from.y, to.y) - padding;
  const width = Math.max(Math.abs(endWorldX - startWorldX) + padding * 2, 1);
  const height = Math.max(Math.abs(to.y - from.y) + padding * 2, 1);
  const x1 = startWorldX - left;
  const y1 = from.y - top;
  const x2 = endWorldX - left;
  const y2 = to.y - top;
  return {
    left,
    top,
    width,
    height,
    x1,
    y1,
    x2,
    y2,
    middleX: (x1 + x2) / 2,
  };
}

function matchId(roundIndex: number, index: number): string {
  return `r${roundIndex + 1}-m${index + 1}`;
}
