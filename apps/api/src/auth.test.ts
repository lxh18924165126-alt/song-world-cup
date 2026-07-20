import { describe, expect, it } from "vitest";
import { AuthError, oauthStartUrl, type AuthEnv } from "./auth";

describe("OAuth Provider 配置", () => {
  it("生产模式生成带 state 的微信授权地址", () => {
    const url = new URL(oauthStartUrl({
      AUTH_MODE: "oauth",
      WECHAT_CLIENT_ID: "wechat-client",
      WECHAT_CLIENT_SECRET: "wechat-secret",
      WECHAT_REDIRECT_URI: "https://example.com/auth/callback?provider=wechat",
    } as AuthEnv, "wechat", "state-value"));

    expect(url.origin).toBe("https://open.weixin.qq.com");
    expect(url.searchParams.get("appid")).toBe("wechat-client");
    expect(url.searchParams.get("state")).toBe("state-value");
  });

  it("缺少正式凭证时拒绝启动 OAuth", () => {
    expect(() => oauthStartUrl({ AUTH_MODE: "oauth" } as AuthEnv, "qq", "state"))
      .toThrow(AuthError);
  });
});
