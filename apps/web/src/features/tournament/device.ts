import { createUuid } from "../../app/id";

const DEVICE_ID_KEY = "song-world-cup-device-id";
let memoryDeviceId: string | undefined;

export function getTournamentDeviceId(): string {
  if (memoryDeviceId) return memoryDeviceId;
  const stored = typeof localStorage === "undefined" ? null : localStorage.getItem(DEVICE_ID_KEY);
  if (stored && stored.length >= 8) {
    memoryDeviceId = stored;
    return stored;
  }
  memoryDeviceId = createUuid();
  if (typeof localStorage !== "undefined") localStorage.setItem(DEVICE_ID_KEY, memoryDeviceId);
  return memoryDeviceId;
}
