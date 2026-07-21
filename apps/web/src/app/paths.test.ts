import { describe, expect, it } from "vitest";
import { joinBasePath, normalizeBasePath, stripBasePath } from "./paths";

describe("应用公开基路径", () => {
  it("保持根路径部署兼容", () => {
    expect(normalizeBasePath("/")).toBe("");
    expect(joinBasePath("/api/health", "")).toBe("/api/health");
    expect(stripBasePath("/t/one/play", "")).toBe("/t/one/play");
  });

  it("为 /sowocu 下的页面、API 和根页补齐前缀", () => {
    const basePath = normalizeBasePath("/sowocu/");
    expect(basePath).toBe("/sowocu");
    expect(joinBasePath("/", basePath)).toBe("/sowocu/");
    expect(joinBasePath("/api/health", basePath)).toBe("/sowocu/api/health");
    expect(joinBasePath("/share/token", basePath)).toBe("/sowocu/share/token");
  });

  it("只接受当前部署前缀内的恢复路径", () => {
    expect(stripBasePath("/sowocu/t/one/play", "/sowocu")).toBe("/t/one/play");
    expect(stripBasePath("/t/one/play", "/sowocu")).toBeNull();
  });
});
