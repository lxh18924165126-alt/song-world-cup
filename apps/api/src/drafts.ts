import {
  FIXED_TOURNAMENT_SCALES,
  createTournamentDraw,
  type CloudTournamentDraft,
  type FixedTournamentScale,
  type SnapshotSong,
  type TournamentDraw,
  type TournamentScale,
} from "@song-world-cup/domain";

export interface CreateDraftInput {
  snapshotId?: unknown;
  name?: unknown;
  selectedSongIds?: unknown;
  scale?: unknown;
}

export interface RedrawDraftInput {
  version?: unknown;
}

export interface DraftPayload {
  draft: CloudTournamentDraft;
  songs: SnapshotSong[];
}

export interface CreatedDraftPayload extends DraftPayload {
  restoreToken: string;
  recoveryPath: string;
}

interface DraftRow {
  id: string;
  snapshot_id: string;
  name: string;
  scale_mode: "fixed" | "all";
  fixed_scale: number | null;
  eligible_song_ids_json: string;
  draw_json: string;
  restore_token_hash: string;
  version: number;
  created_at: string;
  updated_at: string;
}

interface SnapshotSongRow {
  id: string;
  source_position: number;
  source_song_id: string | null;
  source_song_mid: string | null;
  title: string;
  artists_json: string;
  album: string | null;
  duration_seconds: number | null;
  media_url: string | null;
  preview_url: string | null;
}

export class DraftValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DraftValidationError";
  }
}

export class DraftAccessError extends Error {
  constructor() {
    super("云端草稿不存在或恢复链接已失效");
    this.name = "DraftAccessError";
  }
}

export class DraftConflictError extends Error {
  constructor() {
    super("云端草稿已在其他页面更新，请刷新后重试");
    this.name = "DraftConflictError";
  }
}

export class DraftStartedError extends Error {
  constructor() {
    super("赛事已正式开始，不能重新抽签");
    this.name = "DraftStartedError";
  }
}

export async function createCloudDraft(db: D1Database, input: CreateDraftInput): Promise<CreatedDraftPayload> {
  const parsed = parseCreateInput(input);
  const songs = await loadSnapshotSongs(db, parsed.snapshotId);
  assertSelectedSongs(songs, parsed.selectedSongIds);

  const id = crypto.randomUUID();
  const restoreToken = createRestoreToken();
  const restoreTokenHash = await hashRestoreToken(restoreToken);
  const timestamp = new Date().toISOString();
  const draw = createTournamentDraw({
    eligibleEntrantIds: parsed.selectedSongIds,
    scale: parsed.scale,
    random: secureRandom,
  });

  await db.prepare(`
    INSERT INTO tournament_drafts (
      id, snapshot_id, name, scale_mode, fixed_scale, eligible_song_ids_json,
      draw_json, restore_token_hash, version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).bind(
    id,
    parsed.snapshotId,
    parsed.name,
    parsed.scale === "all" ? "all" : "fixed",
    parsed.scale === "all" ? null : parsed.scale,
    JSON.stringify(parsed.selectedSongIds),
    JSON.stringify(draw),
    restoreTokenHash,
    timestamp,
    timestamp,
  ).run();

  const draft: CloudTournamentDraft = {
    id,
    snapshotId: parsed.snapshotId,
    name: parsed.name,
    scale: parsed.scale,
    eligibleSongIds: parsed.selectedSongIds,
    draw,
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  return {
    draft,
    songs,
    restoreToken,
    recoveryPath: `/draw-preview/${id}#token=${encodeURIComponent(restoreToken)}`,
  };
}

export async function getCloudDraft(
  db: D1Database,
  draftId: string,
  restoreToken: string,
): Promise<DraftPayload> {
  const row = await loadAuthorizedDraftRow(db, draftId, restoreToken);
  return {
    draft: deserializeDraft(row),
    songs: await loadSnapshotSongs(db, row.snapshot_id),
  };
}

export async function getDraftByIdInternal(db: D1Database, draftId: string): Promise<DraftPayload> {
  const row = await db.prepare("SELECT * FROM tournament_drafts WHERE id = ?")
    .bind(draftId).first<DraftRow>();
  if (!row) throw new DraftAccessError();
  return { draft: deserializeDraft(row), songs: await loadSnapshotSongs(db, row.snapshot_id) };
}

export async function redrawCloudDraft(
  db: D1Database,
  draftId: string,
  restoreToken: string,
  input: RedrawDraftInput,
): Promise<DraftPayload> {
  const version = parseVersion(input.version);
  const row = await loadAuthorizedDraftRow(db, draftId, restoreToken);
  const started = await db.prepare(`
    SELECT id FROM tournaments WHERE draft_id = ? LIMIT 1
  `).bind(draftId).first<{ id: string }>();
  if (started) {
    throw new DraftStartedError();
  }
  if (row.version !== version) {
    throw new DraftConflictError();
  }

  const eligibleSongIds = parseStringArray(row.eligible_song_ids_json, "云端草稿歌曲集合损坏");
  const scale = deserializeScale(row);
  const draw = createTournamentDraw({
    eligibleEntrantIds: eligibleSongIds,
    scale,
    random: secureRandom,
  });
  const updatedAt = new Date().toISOString();
  const nextVersion = version + 1;
  const result = await db.prepare(`
    UPDATE tournament_drafts
    SET draw_json = ?, version = ?, updated_at = ?
    WHERE id = ? AND restore_token_hash = ? AND version = ?
      AND NOT EXISTS (SELECT 1 FROM tournaments WHERE draft_id = ?)
  `).bind(
    JSON.stringify(draw),
    nextVersion,
    updatedAt,
    draftId,
    row.restore_token_hash,
    version,
    draftId,
  ).run();

  if (result.meta.changes !== 1) {
    const startedAfterCheck = await db.prepare(`
      SELECT id FROM tournaments WHERE draft_id = ? LIMIT 1
    `).bind(draftId).first<{ id: string }>();
    if (startedAfterCheck) {
      throw new DraftStartedError();
    }
    throw new DraftConflictError();
  }

  return {
    draft: {
      ...deserializeDraft(row),
      draw,
      version: nextVersion,
      updatedAt,
    },
    songs: await loadSnapshotSongs(db, row.snapshot_id),
  };
}

function parseCreateInput(input: CreateDraftInput): {
  snapshotId: string;
  name: string;
  selectedSongIds: string[];
  scale: TournamentScale;
} {
  if (typeof input.snapshotId !== "string" || input.snapshotId.length === 0) {
    throw new DraftValidationError("缺少歌单快照 ID");
  }
  if (typeof input.name !== "string" || input.name.trim().length < 1 || input.name.trim().length > 20) {
    throw new DraftValidationError("赛事名称需为 1 至 20 个字符");
  }
  if (!Array.isArray(input.selectedSongIds) || !input.selectedSongIds.every((id) => typeof id === "string")) {
    throw new DraftValidationError("参赛歌曲集合无效");
  }

  const selectedSongIds = [...new Set(input.selectedSongIds)];
  if (selectedSongIds.length !== input.selectedSongIds.length) {
    throw new DraftValidationError("参赛歌曲集合包含重复条目 ID");
  }

  return {
    snapshotId: input.snapshotId,
    name: input.name.trim(),
    selectedSongIds,
    scale: parseScale(input.scale),
  };
}

function parseScale(value: unknown): TournamentScale {
  if (value === "all") {
    return "all";
  }
  if (typeof value === "number" && FIXED_TOURNAMENT_SCALES.includes(value as FixedTournamentScale)) {
    return value as FixedTournamentScale;
  }
  throw new DraftValidationError("赛事规模无效");
}

function parseVersion(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new DraftValidationError("云端草稿版本无效");
  }
  return value;
}

async function loadAuthorizedDraftRow(
  db: D1Database,
  draftId: string,
  restoreToken: string,
): Promise<DraftRow> {
  if (!restoreToken) {
    throw new DraftAccessError();
  }
  const restoreTokenHash = await hashRestoreToken(restoreToken);
  const row = await db.prepare(`
    SELECT * FROM tournament_drafts WHERE id = ? AND restore_token_hash = ?
  `).bind(draftId, restoreTokenHash).first<DraftRow>();
  if (!row) {
    throw new DraftAccessError();
  }
  return row;
}

export async function loadSnapshotSongs(db: D1Database, snapshotId: string): Promise<SnapshotSong[]> {
  const result = await db.prepare(`
    SELECT id, source_position, source_song_id, source_song_mid, title, artists_json,
           album, duration_seconds, media_url, preview_url
    FROM snapshot_songs
    WHERE snapshot_id = ?
    ORDER BY source_position
  `).bind(snapshotId).all<SnapshotSongRow>();

  if (result.results.length === 0) {
    throw new DraftValidationError("歌单快照不存在或没有可用歌曲");
  }

  return result.results.map((row) => ({
    id: row.id,
    sourcePosition: row.source_position,
    sourceSongId: row.source_song_id,
    sourceSongMid: row.source_song_mid,
    title: row.title,
    artists: parseStringArray(row.artists_json, "歌手数据损坏"),
    album: row.album,
    durationSeconds: row.duration_seconds,
    mediaUrl: row.media_url,
    previewUrl: row.preview_url,
  }));
}

function assertSelectedSongs(songs: SnapshotSong[], selectedSongIds: string[]): void {
  const snapshotSongIds = new Set(songs.map((song) => song.id));
  if (selectedSongIds.some((id) => !snapshotSongIds.has(id))) {
    throw new DraftValidationError("参赛歌曲必须全部来自同一个歌单快照");
  }
  if (selectedSongIds.length < 2) {
    throw new DraftValidationError("至少选择 2 首歌曲");
  }
}

function deserializeDraft(row: DraftRow): CloudTournamentDraft {
  return {
    id: row.id,
    snapshotId: row.snapshot_id,
    name: row.name,
    scale: deserializeScale(row),
    eligibleSongIds: parseStringArray(row.eligible_song_ids_json, "云端草稿歌曲集合损坏"),
    draw: JSON.parse(row.draw_json) as TournamentDraw,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function deserializeScale(row: DraftRow): TournamentScale {
  if (row.scale_mode === "all") {
    return "all";
  }
  return parseScale(row.fixed_scale);
}

function parseStringArray(value: string, errorMessage: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
      return parsed;
    }
  } catch {
    // 统一映射为可诊断的数据损坏错误。
  }
  throw new Error(errorMessage);
}

function createRestoreToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hashRestoreToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function secureRandom(): number {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return (value[0] ?? 0) / 0x1_0000_0000;
}
