import {
  createTournamentProgress,
  lockTournamentRound,
  setTournamentMatchWinner,
  type CloudTournament,
  type SnapshotSong,
  type TournamentProgress,
} from "@song-world-cup/domain";
import { getCloudDraft, getDraftByIdInternal, loadSnapshotSongs } from "./drafts";
import { sessionTokenHash } from "./auth";

export interface PickTournamentInput {
  version?: unknown;
  matchId?: unknown;
  winnerId?: unknown;
  eventId?: unknown;
  sequence?: unknown;
}

export interface LockRoundInput {
  version?: unknown;
  eventId?: unknown;
  sequence?: unknown;
}

export interface SyncTournamentEventsInput {
  version?: unknown;
  events?: unknown;
}

export interface BranchTournamentInput {
  progress?: unknown;
}

export interface TournamentPayload {
  tournament: CloudTournament;
  songs: SnapshotSong[];
}

export interface StartedTournamentPayload extends TournamentPayload {
  recoveryPath: string;
}

export interface BranchedTournamentPayload extends StartedTournamentPayload {
  restoreToken: string;
}

interface TournamentRow {
  id: string;
  draft_id: string;
  snapshot_id: string;
  name: string;
  status: "in_progress" | "finished";
  progress_json: string;
  access_token_hash: string;
  version: number;
  started_at: string;
  updated_at: string;
  completed_at: string | null;
  last_event_id: string | null;
  last_event_sequence: number | null;
}

interface MutationIdentity {
  eventId: string;
  sequence: number;
}

type TournamentSyncEvent =
  | (MutationIdentity & { kind: "pick"; matchId: string; winnerId: string | null })
  | (MutationIdentity & { kind: "lock_round" });

export interface TournamentEventReplayState {
  progress: TournamentProgress;
  version: number;
  lastEventId: string | null;
  lastEventSequence: number;
}

export interface TournamentEventReplayResult extends TournamentEventReplayState {
  appliedCount: number;
}

const MAX_EVENT_BATCH_SIZE = 256;

export class TournamentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TournamentValidationError";
  }
}

export class TournamentAccessError extends Error {
  constructor() {
    super("赛事不存在或恢复链接已失效");
    this.name = "TournamentAccessError";
  }
}

export class TournamentConflictError extends Error {
  constructor() {
    super("赛事已在其他页面更新，请刷新后重试");
    this.name = "TournamentConflictError";
  }
}

export async function startTournament(
  db: D1Database,
  draftId: string,
  token: string,
): Promise<StartedTournamentPayload> {
  const draftPayload = await getCloudDraft(db, draftId, token);
  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const progress = createTournamentProgress(draftPayload.draft.draw);
  const tokenHash = await hashToken(token);

  await db.prepare(`
    INSERT OR IGNORE INTO tournaments (
      id, draft_id, snapshot_id, name, status, progress_json, access_token_hash,
      version, started_at, updated_at, completed_at
    )
    SELECT ?, id, snapshot_id, name, 'in_progress', ?, ?, 1, ?, ?, NULL
    FROM tournament_drafts
    WHERE id = ? AND restore_token_hash = ? AND version = ?
      AND NOT EXISTS (SELECT 1 FROM tournaments WHERE draft_id = ?)
  `).bind(
    id,
    JSON.stringify(progress),
    tokenHash,
    timestamp,
    timestamp,
    draftId,
    tokenHash,
    draftPayload.draft.version,
    draftId,
  ).run();

  const row = await db.prepare(`
    SELECT * FROM tournaments WHERE draft_id = ? AND access_token_hash = ?
  `).bind(draftId, tokenHash).first<TournamentRow>();
  if (!row) {
    throw new TournamentConflictError();
  }

  return {
    tournament: deserializeTournament(row),
    songs: draftPayload.songs,
    recoveryPath: `/t/${row.id}/play#token=${encodeURIComponent(token)}`,
  };
}

export async function getTournament(
  db: D1Database,
  tournamentId: string,
  token: string,
): Promise<TournamentPayload> {
  const row = await loadAuthorizedTournament(db, tournamentId, token);
  return { tournament: deserializeTournament(row), songs: await loadSnapshotSongs(db, row.snapshot_id) };
}

export async function branchTournament(
  db: D1Database,
  tournamentId: string,
  token: string,
  input: BranchTournamentInput,
): Promise<BranchedTournamentPayload> {
  const source = await loadAuthorizedTournament(db, tournamentId, token);
  const draftPayload = await getDraftByIdInternal(db, source.draft_id);
  const progress = validateBranchProgress(draftPayload.draft.draw, input.progress);
  const draftId = crypto.randomUUID();
  const id = crypto.randomUUID();
  const restoreToken = createRestoreToken();
  const tokenHash = await hashToken(restoreToken);
  const timestamp = new Date().toISOString();
  const name = branchName(source.name);
  const completedAt = progress.status === "finished" ? timestamp : null;

  await db.batch([
    db.prepare(`
      INSERT INTO tournament_drafts (
        id, snapshot_id, name, scale_mode, fixed_scale, eligible_song_ids_json,
        draw_json, restore_token_hash, version, created_at, updated_at
      )
      SELECT ?, snapshot_id, ?, scale_mode, fixed_scale, eligible_song_ids_json,
             draw_json, ?, 1, ?, ?
      FROM tournament_drafts
      WHERE id = ?
    `).bind(draftId, name, tokenHash, timestamp, timestamp, source.draft_id),
    db.prepare(`
      INSERT INTO tournaments (
        id, draft_id, snapshot_id, name, status, progress_json, access_token_hash,
        version, started_at, updated_at, completed_at, last_event_id, last_event_sequence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, NULL, NULL)
    `).bind(
      id,
      draftId,
      source.snapshot_id,
      name,
      progress.status,
      JSON.stringify(progress),
      tokenHash,
      timestamp,
      timestamp,
      completedAt,
    ),
  ]);

  return {
    tournament: {
      id,
      draftId,
      snapshotId: source.snapshot_id,
      name,
      progress,
      version: 1,
      lastEventSequence: 0,
      startedAt: timestamp,
      updatedAt: timestamp,
      completedAt,
    },
    songs: draftPayload.songs,
    restoreToken,
    recoveryPath: `/t/${id}/play#token=${encodeURIComponent(restoreToken)}`,
  };
}

export function validateBranchProgress(draw: Parameters<typeof createTournamentProgress>[0], value: unknown): TournamentProgress {
  try {
    const candidate = value as TournamentProgress;
    let rebuilt = createTournamentProgress(draw);
    for (const submittedRound of candidate.rounds) {
      const currentRound = rebuilt.rounds[rebuilt.currentRoundIndex];
      if (!currentRound || submittedRound.index !== currentRound.index) {
        throw new RangeError("本地分支轮次与原签表不一致");
      }
      for (const submittedMatch of submittedRound.matches) {
        if (submittedMatch.status !== "auto_bye" && submittedMatch.winnerId) {
          rebuilt = setTournamentMatchWinner(rebuilt, submittedMatch.id, submittedMatch.winnerId);
        }
      }
      if (submittedRound.locked) rebuilt = lockTournamentRound(rebuilt);
    }
    if (JSON.stringify(rebuilt) !== JSON.stringify(candidate)) {
      throw new RangeError("本地分支进度与原签表不一致");
    }
    return candidate;
  } catch (error) {
    if (error instanceof TournamentValidationError) throw error;
    throw new TournamentValidationError(
      error instanceof Error ? error.message : "本地分支进度无效",
    );
  }
}

export async function pickTournamentMatch(
  db: D1Database,
  tournamentId: string,
  token: string,
  input: PickTournamentInput,
): Promise<TournamentPayload> {
  const parsed = parsePickInput(input);
  const row = await loadAuthorizedTournament(db, tournamentId, token);
  if (parsed.identity && row.last_event_id === parsed.identity.eventId) {
    return payloadForRow(db, row, token);
  }
  assertEventSequence(row, parsed.identity);
  assertVersion(row.version, parsed.version);
  const progress = setTournamentMatchWinner(
    deserializeProgress(row.progress_json),
    parsed.matchId,
    parsed.winnerId,
  );
  return updateTournament(db, row, token, progress, parsed.version, parsed.identity);
}

export async function lockCurrentTournamentRound(
  db: D1Database,
  tournamentId: string,
  token: string,
  input: LockRoundInput,
): Promise<TournamentPayload> {
  const version = parseVersion(input.version);
  const identity = parseMutationIdentity(input.eventId, input.sequence);
  const row = await loadAuthorizedTournament(db, tournamentId, token);
  if (identity && row.last_event_id === identity.eventId) {
    return payloadForRow(db, row, token);
  }
  assertEventSequence(row, identity);
  assertVersion(row.version, version);
  const progress = lockTournamentRound(deserializeProgress(row.progress_json));
  return updateTournament(db, row, token, progress, version, identity);
}

export async function syncTournamentEvents(
  db: D1Database,
  tournamentId: string,
  token: string,
  input: SyncTournamentEventsInput,
): Promise<TournamentPayload> {
  const row = await loadAuthorizedTournament(db, tournamentId, token);
  const replay = replayTournamentEventBatch({
    progress: deserializeProgress(row.progress_json),
    version: row.version,
    lastEventId: row.last_event_id,
    lastEventSequence: row.last_event_sequence ?? 0,
  }, input);
  if (replay.appliedCount === 0) {
    return payloadForRow(db, row, token);
  }

  const updatedAt = new Date().toISOString();
  const completedAt = replay.progress.status === "finished" ? updatedAt : null;
  const result = await db.prepare(`
    UPDATE tournaments
    SET status = ?, progress_json = ?, version = ?, updated_at = ?, completed_at = ?,
        last_event_id = ?, last_event_sequence = ?
    WHERE id = ? AND access_token_hash = ? AND version = ?
      AND COALESCE(last_event_sequence, 0) = ?
  `).bind(
    replay.progress.status,
    JSON.stringify(replay.progress),
    replay.version,
    updatedAt,
    completedAt,
    replay.lastEventId,
    replay.lastEventSequence,
    row.id,
    row.access_token_hash,
    row.version,
    row.last_event_sequence ?? 0,
  ).run();
  if (result.meta.changes !== 1) {
    const latest = await loadAuthorizedTournament(db, row.id, token);
    if (
      latest.last_event_id === replay.lastEventId
      && (latest.last_event_sequence ?? 0) === replay.lastEventSequence
    ) {
      return payloadForRow(db, latest, token);
    }
    throw new TournamentConflictError();
  }

  return {
    tournament: {
      ...deserializeTournament(row),
      progress: replay.progress,
      version: replay.version,
      lastEventSequence: replay.lastEventSequence,
      updatedAt,
      completedAt,
    },
    songs: await loadSnapshotSongs(db, row.snapshot_id),
  };
}

export function replayTournamentEventBatch(
  state: TournamentEventReplayState,
  input: SyncTournamentEventsInput,
): TournamentEventReplayResult {
  const requestedVersion = parseVersion(input.version);
  const events = parseTournamentSyncEvents(input.events);
  const firstSequence = events[0]!.sequence;
  const lastSequence = events[events.length - 1]!.sequence;

  if (
    state.lastEventSequence < firstSequence - 1
    || state.lastEventSequence > lastSequence
  ) {
    throw new TournamentConflictError();
  }

  const overlapCount = state.lastEventSequence >= firstSequence
    ? state.lastEventSequence - firstSequence + 1
    : 0;
  if (state.version !== requestedVersion + overlapCount) {
    throw new TournamentConflictError();
  }
  if (overlapCount > 0 && state.lastEventId !== events[overlapCount - 1]!.eventId) {
    throw new TournamentConflictError();
  }

  const pendingEvents = events.slice(overlapCount);
  let progress = state.progress;
  for (const event of pendingEvents) {
    progress = event.kind === "pick"
      ? setTournamentMatchWinner(progress, event.matchId, event.winnerId)
      : lockTournamentRound(progress);
  }
  const lastEvent = pendingEvents[pendingEvents.length - 1];
  return {
    progress,
    version: state.version + pendingEvents.length,
    lastEventId: lastEvent?.eventId ?? state.lastEventId,
    lastEventSequence: lastEvent?.sequence ?? state.lastEventSequence,
    appliedCount: pendingEvents.length,
  };
}

async function updateTournament(
  db: D1Database,
  row: TournamentRow,
  token: string,
  progress: TournamentProgress,
  version: number,
  identity: MutationIdentity | undefined,
): Promise<TournamentPayload> {
  const updatedAt = new Date().toISOString();
  const completedAt = progress.status === "finished" ? updatedAt : null;
  const nextVersion = version + 1;
  const result = await db.prepare(`
    UPDATE tournaments
    SET status = ?, progress_json = ?, version = ?, updated_at = ?, completed_at = ?,
        last_event_id = COALESCE(?, last_event_id),
        last_event_sequence = COALESCE(?, last_event_sequence)
    WHERE id = ? AND access_token_hash = ? AND version = ?
      AND (? IS NULL OR last_event_sequence IS NULL OR last_event_sequence < ?)
  `).bind(
    progress.status,
    JSON.stringify(progress),
    nextVersion,
    updatedAt,
    completedAt,
    identity?.eventId ?? null,
    identity?.sequence ?? null,
    row.id,
    row.access_token_hash,
    version,
    identity?.sequence ?? null,
    identity?.sequence ?? null,
  ).run();
  if (result.meta.changes !== 1) {
    const latest = await loadAuthorizedTournament(db, row.id, token);
    if (identity && latest.last_event_id === identity.eventId) {
      return payloadForRow(db, latest, token);
    }
    throw new TournamentConflictError();
  }

  return {
    tournament: {
      ...deserializeTournament(row),
      progress,
      version: nextVersion,
      lastEventSequence: identity?.sequence ?? row.last_event_sequence ?? 0,
      updatedAt,
      completedAt,
    },
    songs: await loadSnapshotSongs(db, row.snapshot_id),
  };
}

async function loadAuthorizedTournament(
  db: D1Database,
  tournamentId: string,
  token: string,
): Promise<TournamentRow> {
  if (!token) {
    throw new TournamentAccessError();
  }
  if (token.startsWith("session:")) {
    const rawSession = token.slice("session:".length);
    const row = await db.prepare(`
      SELECT t.* FROM tournaments t
      JOIN auth_sessions s ON s.account_id = t.owner_account_id
      WHERE t.id = ? AND s.token_hash = ? AND s.expires_at > ?
    `).bind(tournamentId, await sessionTokenHash(rawSession), new Date().toISOString()).first<TournamentRow>();
    if (!row) throw new TournamentAccessError();
    return row;
  }
  const tokenHash = await hashToken(token);
  const row = await db.prepare(`
    SELECT * FROM tournaments WHERE id = ? AND access_token_hash = ?
  `).bind(tournamentId, tokenHash).first<TournamentRow>();
  if (!row) {
    throw new TournamentAccessError();
  }
  return row;
}

function parsePickInput(input: PickTournamentInput): {
  version: number;
  matchId: string;
  winnerId: string | null;
  identity: MutationIdentity | undefined;
} {
  if (typeof input.matchId !== "string" || input.matchId.length === 0) {
    throw new TournamentValidationError("缺少比赛 ID");
  }
  if (input.winnerId !== null && typeof input.winnerId !== "string") {
    throw new TournamentValidationError("胜者 ID 无效");
  }
  return {
    version: parseVersion(input.version),
    matchId: input.matchId,
    winnerId: input.winnerId,
    identity: parseMutationIdentity(input.eventId, input.sequence),
  };
}

function parseMutationIdentity(eventId: unknown, sequence: unknown): MutationIdentity | undefined {
  if (eventId === undefined && sequence === undefined) {
    return undefined;
  }
  if (typeof eventId !== "string" || eventId.length < 8 || eventId.length > 100) {
    throw new TournamentValidationError("赛事事件 ID 无效");
  }
  if (typeof sequence !== "number" || !Number.isInteger(sequence) || sequence < 1) {
    throw new TournamentValidationError("赛事事件顺序号无效");
  }
  return { eventId, sequence };
}

function parseTournamentSyncEvents(value: unknown): TournamentSyncEvent[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_EVENT_BATCH_SIZE) {
    throw new TournamentValidationError(`赛事事件批次须包含 1–${MAX_EVENT_BATCH_SIZE} 项`);
  }
  const events = value.map((candidate): TournamentSyncEvent => {
    if (!candidate || typeof candidate !== "object") {
      throw new TournamentValidationError("赛事事件无效");
    }
    const record = candidate as Record<string, unknown>;
    const identity = parseMutationIdentity(record.eventId, record.sequence);
    if (!identity) throw new TournamentValidationError("赛事事件缺少标识");
    if (record.kind === "lock_round") {
      return { ...identity, kind: "lock_round" };
    }
    if (record.kind !== "pick") {
      throw new TournamentValidationError("赛事事件类型无效");
    }
    if (typeof record.matchId !== "string" || record.matchId.length === 0) {
      throw new TournamentValidationError("缺少比赛 ID");
    }
    if (record.winnerId !== null && typeof record.winnerId !== "string") {
      throw new TournamentValidationError("胜者 ID 无效");
    }
    return {
      ...identity,
      kind: "pick",
      matchId: record.matchId,
      winnerId: record.winnerId,
    };
  });
  for (let index = 1; index < events.length; index += 1) {
    if (events[index]!.sequence !== events[index - 1]!.sequence + 1) {
      throw new TournamentValidationError("赛事事件顺序号必须连续");
    }
  }
  return events;
}

function parseVersion(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new TournamentValidationError("赛事版本无效");
  }
  return value;
}

function assertVersion(currentVersion: number, requestedVersion: number): void {
  if (currentVersion !== requestedVersion) {
    throw new TournamentConflictError();
  }
}

function assertEventSequence(row: TournamentRow, identity: MutationIdentity | undefined): void {
  if (identity && row.last_event_sequence !== null && identity.sequence <= row.last_event_sequence) {
    throw new TournamentConflictError();
  }
}

async function payloadForRow(db: D1Database, row: TournamentRow, token: string): Promise<TournamentPayload> {
  return { tournament: deserializeTournament(row), songs: await loadSnapshotSongs(db, row.snapshot_id) };
}

function deserializeTournament(row: TournamentRow): CloudTournament {
  return {
    id: row.id,
    draftId: row.draft_id,
    snapshotId: row.snapshot_id,
    name: row.name,
    progress: deserializeProgress(row.progress_json),
    version: row.version,
    lastEventSequence: row.last_event_sequence ?? 0,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

function deserializeProgress(value: string): TournamentProgress {
  try {
    return JSON.parse(value) as TournamentProgress;
  } catch {
    throw new Error("赛事进度数据损坏");
  }
}

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function createRestoreToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function branchName(name: string): string {
  const suffix = " · 分支";
  return `${Array.from(name).slice(0, 20 - Array.from(suffix).length).join("")}${suffix}`;
}
