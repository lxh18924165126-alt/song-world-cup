import { describe, expect, it } from "vitest";
import { AdminAccessError, assertAdmin } from "./admin";

describe("运营后台鉴权", () => {
  it("只接受环境显式配置的管理员令牌", () => {
    expect(() => assertAdmin({ AUTH_MODE: "mock", ADMIN_TOKEN: "local-admin-token" } as never, new Request("https://example.com", {
      headers: { "X-Admin-Token": "local-admin-token" },
    }))).not.toThrow();
    expect(() => assertAdmin({ AUTH_MODE: "mock", ADMIN_TOKEN: "local-admin-token" } as never, new Request("https://example.com")))
      .toThrow(AdminAccessError);
  });

  it("任意环境未配置令牌时明确拒绝服务", () => {
    expect(() => assertAdmin({ AUTH_MODE: "oauth" } as never, new Request("https://example.com")))
      .toThrow("环境尚未配置 ADMIN_TOKEN");
  });
});
