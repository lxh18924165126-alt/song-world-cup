import { describe, expect, it } from "vitest";
import { createTournamentDraw, createTournamentProgress } from "@song-world-cup/domain";
import { computeBracketCanvasSize } from "./export";

describe("对阵图导出布局", () => {
  it("通用高清版为大签表限制画布高度", () => {
    const progress = createTournamentProgress(createTournamentDraw({
      eligibleEntrantIds: Array.from({ length: 4096 }, (_, index) => `song-${index}`),
      scale: 4096,
      random: () => 0.2,
    }));

    expect(computeBracketCanvasSize(progress, "standard").height).toBe(8192);
    expect(computeBracketCanvasSize(progress, "original").height).toBe(32760);
  });

  it("小签表保持可读的最低画布尺寸", () => {
    const progress = createTournamentProgress(createTournamentDraw({
      eligibleEntrantIds: ["a", "b", "c", "d"],
      scale: "all",
      random: () => 0.2,
    }));

    expect(computeBracketCanvasSize(progress, "standard")).toEqual({ width: 1600, height: 1200 });
  });
});
