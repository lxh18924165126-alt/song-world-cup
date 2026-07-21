import { describe, expect, it, vi } from "vitest";
import { createUuid } from "./id";

describe("浏览器 UUID", () => {
  it("优先使用安全上下文提供的原生 randomUUID", () => {
    const randomUUID = vi.fn(() => "11111111-2222-4333-8444-555555555555");
    const getRandomValues = vi.fn(() => {
      throw new Error("不应调用备用随机源");
    });

    expect(createUuid({ randomUUID, getRandomValues })).toBe("11111111-2222-4333-8444-555555555555");
    expect(randomUUID).toHaveBeenCalledOnce();
    expect(getRandomValues).not.toHaveBeenCalled();
  });

  it("在 HTTP 非安全上下文缺少 randomUUID 时生成 RFC 4122 v4 UUID", () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.fill(0);
      return bytes;
    });

    expect(createUuid({ getRandomValues })).toBe("00000000-0000-4000-8000-000000000000");
    expect(getRandomValues).toHaveBeenCalledOnce();
  });
});
