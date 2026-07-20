export const ACTIVE_LEASE_MS = 45_000;
export const OFFLINE_PROTECTION_MS = 5 * 60_000;

export interface EditLeaseRecord {
  deviceId: string;
  generation: number;
  acquiredAt: number;
  heartbeatAt: number;
  activeUntil: number;
  protectUntil: number;
}

export interface EditLeaseStatus {
  editable: boolean;
  generation: number;
  activeUntil: string;
  protectUntil: string;
  takeoverAllowedAt: string | null;
}

export function acquireEditLease(
  current: EditLeaseRecord | undefined,
  deviceId: string,
  now: number,
): { record: EditLeaseRecord; status: EditLeaseStatus; changed: boolean } {
  if (!current) {
    const record = createLease(deviceId, 1, now);
    return { record, status: toStatus(record, deviceId), changed: true };
  }
  if (current.deviceId === deviceId) {
    const record = renewLease(current, now);
    return { record, status: toStatus(record, deviceId), changed: true };
  }
  return { record: current, status: toStatus(current, deviceId), changed: false };
}

export function takeoverEditLease(
  current: EditLeaseRecord | undefined,
  deviceId: string,
  now: number,
): { record: EditLeaseRecord; status: EditLeaseStatus; changed: boolean } {
  if (!current || current.deviceId === deviceId) {
    return acquireEditLease(current, deviceId, now);
  }
  if (now < current.protectUntil) {
    return { record: current, status: toStatus(current, deviceId), changed: false };
  }
  const record = createLease(deviceId, current.generation + 1, now);
  return { record, status: toStatus(record, deviceId), changed: true };
}

export function toStatus(current: EditLeaseRecord, deviceId: string): EditLeaseStatus {
  const editable = current.deviceId === deviceId;
  return {
    editable,
    generation: current.generation,
    activeUntil: new Date(current.activeUntil).toISOString(),
    protectUntil: new Date(current.protectUntil).toISOString(),
    takeoverAllowedAt: editable ? null : new Date(current.protectUntil).toISOString(),
  };
}

function createLease(deviceId: string, generation: number, now: number): EditLeaseRecord {
  return {
    deviceId,
    generation,
    acquiredAt: now,
    heartbeatAt: now,
    activeUntil: now + ACTIVE_LEASE_MS,
    protectUntil: now + OFFLINE_PROTECTION_MS,
  };
}

function renewLease(current: EditLeaseRecord, now: number): EditLeaseRecord {
  return {
    ...current,
    heartbeatAt: now,
    activeUntil: now + ACTIVE_LEASE_MS,
    protectUntil: now + OFFLINE_PROTECTION_MS,
  };
}
