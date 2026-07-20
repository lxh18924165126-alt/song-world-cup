import {
  lockTournamentRound as applyRoundLock,
  setTournamentMatchWinner,
  type CloudTournament,
  type SnapshotSong,
} from "@song-world-cup/domain";
import {
  database,
  type CachedTournamentRecord,
  type TournamentQueueEvent,
} from "../../storage/database";
import {
  branchTournament,
  getTournament,
  syncTournamentEvents,
  TournamentRequestError,
  type EditLeaseStatus,
  type TournamentPayload,
  type TournamentSyncEvent,
} from "./api";

export type TournamentSyncState = "synced" | "pending" | "offline" | "conflict";

export interface LocalTournamentPayload {
  tournament: CloudTournament;
  songs: SnapshotSong[];
  pendingCount: number;
  syncState: TournamentSyncState;
}

export interface LocalTournamentBranch extends LocalTournamentPayload {
  recoveryPath: string;
}

const EVENT_BATCH_SIZE = 256;
const EVENT_BATCH_ATTEMPTS = 2;
const activeFlushes = new Map<string, Promise<LocalTournamentPayload>>();

export class TournamentQueueConflictError extends Error {
  constructor() {
    super("云端赛事已有更新，本地离线分支需要处理冲突");
    this.name = "TournamentQueueConflictError";
  }
}

export class TournamentLeaseConflictError extends Error {
  constructor(readonly lease: EditLeaseStatus | undefined) {
    super("另一台设备持有赛事编辑权，本地变更已暂停同步");
    this.name = "TournamentLeaseConflictError";
  }
}

export async function loadTournamentForPlay(
  tournamentId: string,
  token: string,
): Promise<LocalTournamentPayload> {
  const cached = await loadCachedRecord(tournamentId);
  const pendingEvents = await listPendingEvents(tournamentId);

  if (pendingEvents.length > 0 && cached) {
    return localPayload(cached, pendingEvents.length, navigator.onLine ? "pending" : "offline");
  }

  if (navigator.onLine) {
    try {
      const remote = await getTournament(tournamentId, token);
      await cacheRemoteTournament(remote, token);
      return { ...remote, pendingCount: 0, syncState: "synced" };
    } catch (error) {
      if (!cached) throw error;
    }
  }

  if (!cached) {
    throw new Error("此设备尚未缓存该赛事，请先联网打开一次");
  }
  return localPayload(cached, 0, "offline");
}

export async function loadCachedTournamentForPlay(
  tournamentId: string,
): Promise<LocalTournamentPayload | undefined> {
  const cached = await loadCachedRecord(tournamentId);
  if (!cached) return undefined;
  const pendingCount = await pendingTournamentEventCount(tournamentId);
  return localPayload(
    cached,
    pendingCount,
    navigator.onLine ? (pendingCount > 0 ? "pending" : "synced") : "offline",
  );
}

export async function reloadTournamentFromCloud(tournamentId: string): Promise<LocalTournamentPayload> {
  const record = await requireCachedRecord(tournamentId);
  const pendingCount = await pendingTournamentEventCount(tournamentId);
  if (pendingCount > 0) throw new TournamentQueueConflictError();
  const remote = await getTournament(tournamentId, record.token);
  await cacheRemoteTournament(remote, record.token);
  return { ...remote, pendingCount: 0, syncState: "synced" };
}

export async function discardLocalBranchAndReload(tournamentId: string): Promise<LocalTournamentPayload> {
  const record = await requireCachedRecord(tournamentId);
  const remote = await getTournament(tournamentId, record.token);
  const db = await database();
  const transaction = db.transaction(["tournaments", "tournamentEvents"], "readwrite");
  const eventStore = transaction.objectStore("tournamentEvents");
  const range = IDBKeyRange.bound([tournamentId, 0], [tournamentId, Number.MAX_SAFE_INTEGER]);
  const eventKeys = await eventStore.index("by-tournament-sequence").getAllKeys(range);
  await Promise.all([
    transaction.objectStore("tournaments").put({
      id: tournamentId,
      tournament: remote.tournament,
      songs: remote.songs,
      token: record.token,
      nextSequence: remote.tournament.lastEventSequence + 1,
      lastSyncedAt: new Date().toISOString(),
    }),
    ...eventKeys.map((key) => eventStore.delete(key)),
    transaction.done,
  ]);
  return { ...remote, pendingCount: 0, syncState: "synced" };
}

export async function saveLocalTournamentAsBranch(tournamentId: string): Promise<LocalTournamentBranch> {
  const record = await requireCachedRecord(tournamentId);
  const branch = await branchTournament(tournamentId, record.token, record.tournament.progress);
  await cacheRemoteTournament(branch, branch.restoreToken);
  return {
    tournament: branch.tournament,
    songs: branch.songs,
    pendingCount: 0,
    syncState: "synced",
    recoveryPath: branch.recoveryPath,
  };
}

export async function enqueueTournamentPick(
  tournamentId: string,
  matchId: string,
  winnerId: string | null,
): Promise<LocalTournamentPayload> {
  return enqueueEvent(tournamentId, (record, eventBase) => ({
    event: { ...eventBase, kind: "pick", matchId, winnerId },
    tournament: {
      ...record.tournament,
      progress: setTournamentMatchWinner(record.tournament.progress, matchId, winnerId),
    },
  }));
}

export async function enqueueTournamentRoundLock(tournamentId: string): Promise<LocalTournamentPayload> {
  return enqueueEvent(tournamentId, (record, eventBase) => ({
    event: { ...eventBase, kind: "lock_round" },
    tournament: {
      ...record.tournament,
      progress: applyRoundLock(record.tournament.progress),
    },
  }));
}

export function flushTournamentEvents(tournamentId: string): Promise<LocalTournamentPayload> {
  const active = activeFlushes.get(tournamentId);
  if (active) return active;
  const task = performTournamentEventFlush(tournamentId)
    .finally(() => activeFlushes.delete(tournamentId));
  activeFlushes.set(tournamentId, task);
  return task;
}

async function performTournamentEventFlush(tournamentId: string): Promise<LocalTournamentPayload> {
  while (true) {
    const record = await requireCachedRecord(tournamentId);
    const events = await listPendingEvents(tournamentId);
    if (events.length === 0) {
      return localPayload(record, 0, "synced");
    }

    try {
      const batch = events.slice(0, EVENT_BATCH_SIZE);
      const remote = await sendEventBatchWithRetry(
        tournamentId,
        record.token,
        record.tournament.version,
        batch.map(toSyncEvent),
      );
      await acknowledgeEvents(record, remote, batch.map((event) => event.id));
    } catch (error) {
      if (error instanceof TournamentRequestError && error.status === 409) {
        if (error.code === "edit_lease_required") {
          throw new TournamentLeaseConflictError(error.lease);
        }
        throw new TournamentQueueConflictError();
      }
      throw error;
    }
  }
}

async function sendEventBatchWithRetry(
  tournamentId: string,
  token: string,
  version: number,
  events: TournamentSyncEvent[],
): Promise<TournamentPayload> {
  for (let attempt = 1; attempt <= EVENT_BATCH_ATTEMPTS; attempt += 1) {
    try {
      return await syncTournamentEvents(tournamentId, token, version, events);
    } catch (error) {
      if (attempt === EVENT_BATCH_ATTEMPTS || !isTransientSyncError(error)) throw error;
    }
  }
  throw new Error("赛事事件批量同步失败");
}

function isTransientSyncError(error: unknown): boolean {
  if (error instanceof TournamentRequestError) {
    return error.status === 408 || error.status === 429 || error.status >= 500;
  }
  return error instanceof TypeError;
}

export async function pendingTournamentEventCount(tournamentId: string): Promise<number> {
  return (await listPendingEvents(tournamentId)).length;
}

export async function listCachedTournaments(): Promise<CachedTournamentRecord[]> {
  const db = await database();
  const records = await db.getAll("tournaments");
  return records.sort((left, right) => right.tournament.updatedAt.localeCompare(left.tournament.updatedAt));
}

async function cacheRemoteTournament(payload: TournamentPayload, token: string): Promise<void> {
  const db = await database();
  const existing = await db.get("tournaments", payload.tournament.id);
  const record: CachedTournamentRecord = {
    id: payload.tournament.id,
    tournament: payload.tournament,
    songs: payload.songs,
    token,
    nextSequence: Math.max(
      existing?.nextSequence ?? 1,
      payload.tournament.lastEventSequence + 1,
    ),
    lastSyncedAt: new Date().toISOString(),
  };
  await db.put("tournaments", record);
}

async function enqueueEvent(
  tournamentId: string,
  create: (
    record: CachedTournamentRecord,
    base: Pick<TournamentQueueEvent, "id" | "tournamentId" | "sequence" | "createdAt">,
  ) => { event: TournamentQueueEvent; tournament: CloudTournament },
): Promise<LocalTournamentPayload> {
  const db = await database();
  const transaction = db.transaction(["tournaments", "tournamentEvents"], "readwrite");
  const tournamentStore = transaction.objectStore("tournaments");
  const record = await tournamentStore.get(tournamentId);
  if (!record) {
    transaction.abort();
    throw new Error("此设备没有可编辑的赛事缓存");
  }
  const sequence = record.nextSequence;
  const base = {
    id: crypto.randomUUID(),
    tournamentId,
    sequence,
    createdAt: new Date().toISOString(),
  };
  const created = create(record, base);
  const nextRecord: CachedTournamentRecord = {
    ...record,
    tournament: created.tournament,
    nextSequence: sequence + 1,
  };
  await Promise.all([
    tournamentStore.put(nextRecord),
    transaction.objectStore("tournamentEvents").add(created.event),
    transaction.done,
  ]);
  const pendingCount = await pendingTournamentEventCount(tournamentId);
  return localPayload(nextRecord, pendingCount, navigator.onLine ? "pending" : "offline");
}

async function acknowledgeEvents(
  previous: CachedTournamentRecord,
  remote: TournamentPayload,
  eventIds: string[],
): Promise<void> {
  const db = await database();
  const transaction = db.transaction(["tournaments", "tournamentEvents"], "readwrite");
  const tournamentStore = transaction.objectStore("tournaments");
  const eventStore = transaction.objectStore("tournamentEvents");
  const current = await tournamentStore.get(previous.id) ?? previous;
  const range = IDBKeyRange.bound(
    [previous.id, 0],
    [previous.id, Number.MAX_SAFE_INTEGER],
  );
  const acknowledged = new Set(eventIds);
  const remainingEvents = (await eventStore.index("by-tournament-sequence").getAll(range))
    .filter((event) => !acknowledged.has(event.id));
  const optimisticTournament = remainingEvents.reduce(
    (tournament, event) => applyQueuedEvent(tournament, event),
    remote.tournament,
  );
  await Promise.all([
    tournamentStore.put({
      ...current,
      tournament: optimisticTournament,
      songs: remote.songs,
      lastSyncedAt: new Date().toISOString(),
    }),
    ...eventIds.map((eventId) => eventStore.delete(eventId)),
    transaction.done,
  ]);
}

async function loadCachedRecord(tournamentId: string): Promise<CachedTournamentRecord | undefined> {
  const db = await database();
  return db.get("tournaments", tournamentId);
}

async function requireCachedRecord(tournamentId: string): Promise<CachedTournamentRecord> {
  const record = await loadCachedRecord(tournamentId);
  if (!record) throw new Error("此设备没有可同步的赛事缓存");
  return record;
}

async function listPendingEvents(tournamentId: string): Promise<TournamentQueueEvent[]> {
  const db = await database();
  const range = IDBKeyRange.bound(
    [tournamentId, 0],
    [tournamentId, Number.MAX_SAFE_INTEGER],
  );
  return db.getAllFromIndex("tournamentEvents", "by-tournament-sequence", range);
}

function localPayload(
  record: CachedTournamentRecord,
  pendingCount: number,
  syncState: TournamentSyncState,
): LocalTournamentPayload {
  return {
    tournament: record.tournament,
    songs: record.songs,
    pendingCount,
    syncState,
  };
}

function applyQueuedEvent(tournament: CloudTournament, event: TournamentQueueEvent): CloudTournament {
  const progress = event.kind === "pick"
    ? setTournamentMatchWinner(tournament.progress, event.matchId, event.winnerId)
    : applyRoundLock(tournament.progress);
  return { ...tournament, progress };
}

function toSyncEvent(event: TournamentQueueEvent): TournamentSyncEvent {
  const identity = { eventId: event.id, sequence: event.sequence };
  return event.kind === "pick"
    ? { ...identity, kind: "pick", matchId: event.matchId, winnerId: event.winnerId }
    : { ...identity, kind: "lock_round" };
}
