import { describe, expect, it } from "vitest";
import {
  ACTIVE_LEASE_MS,
  OFFLINE_PROTECTION_MS,
  acquireEditLease,
  takeoverEditLease,
} from "./lease";

describe("单设备编辑租约", () => {
  it("首次设备获得租约，心跳同时延长活跃期和离线保护期", () => {
    const first = acquireEditLease(undefined, "device-a", 1_000);
    const renewed = acquireEditLease(first.record, "device-a", 20_000);

    expect(first.status.editable).toBe(true);
    expect(first.record.activeUntil).toBe(1_000 + ACTIVE_LEASE_MS);
    expect(renewed.record.activeUntil).toBe(20_000 + ACTIVE_LEASE_MS);
    expect(renewed.record.protectUntil).toBe(20_000 + OFFLINE_PROTECTION_MS);
    expect(renewed.record.generation).toBe(1);
  });

  it("保护期内拒绝其他设备接管", () => {
    const current = acquireEditLease(undefined, "device-a", 1_000).record;
    const denied = takeoverEditLease(current, "device-b", current.protectUntil - 1);

    expect(denied.changed).toBe(false);
    expect(denied.status.editable).toBe(false);
    expect(denied.status.takeoverAllowedAt).toBe(new Date(current.protectUntil).toISOString());
  });

  it("保护期结束后允许接管并提升代次", () => {
    const current = acquireEditLease(undefined, "device-a", 1_000).record;
    const taken = takeoverEditLease(current, "device-b", current.protectUntil);

    expect(taken.changed).toBe(true);
    expect(taken.status.editable).toBe(true);
    expect(taken.record.deviceId).toBe("device-b");
    expect(taken.record.generation).toBe(2);
  });
});
