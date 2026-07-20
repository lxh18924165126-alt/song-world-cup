import type { CloudTournament, SnapshotSong } from "@song-world-cup/domain";
import { getTournament } from "./tournaments";

export interface ShareStatusPayload {
  open: boolean;
  sharePath: string | null;
}

export interface PublicSharePayload {
  tournament: CloudTournament;
  songs: SnapshotSong[];
  playlist: {
    title: string;
    coverUrl: string | null;
  };
}

interface ShareRow {
  share_token: string;
  is_open: number;
}

interface PublicShareRow {
  id: string;
  draft_id: string;
  snapshot_id: string;
  name: string;
  progress_json: string;
  version: number;
  last_event_sequence: number | null;
  started_at: string;
  updated_at: string;
  completed_at: string | null;
  playlist_title: string;
  cover_url: string | null;
}

interface SongRow {
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

export class ShareValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShareValidationError";
  }
}

export class ShareAccessError extends Error {
  constructor() {
    super("分享链接不存在或已关闭");
    this.name = "ShareAccessError";
  }
}

export async function getShareStatus(
  db: D1Database,
  tournamentId: string,
  token: string,
): Promise<ShareStatusPayload> {
  await requireFinishedTournament(db, tournamentId, token);
  const row = await loadShareRow(db, tournamentId);
  return statusForRow(row);
}

export async function openTournamentShare(
  db: D1Database,
  tournamentId: string,
  token: string,
): Promise<ShareStatusPayload> {
  await requireFinishedTournament(db, tournamentId, token);
  const existing = await loadShareRow(db, tournamentId);
  const shareToken = existing?.share_token ?? createShareToken();
  const timestamp = new Date().toISOString();
  await db.prepare(`
    INSERT INTO tournament_shares (tournament_id, share_token, is_open, created_at, updated_at)
    VALUES (?, ?, 1, ?, ?)
    ON CONFLICT(tournament_id) DO UPDATE SET is_open = 1, updated_at = excluded.updated_at
  `).bind(tournamentId, shareToken, timestamp, timestamp).run();
  return { open: true, sharePath: `/share/${encodeURIComponent(shareToken)}` };
}

export async function closeTournamentShare(
  db: D1Database,
  tournamentId: string,
  token: string,
): Promise<ShareStatusPayload> {
  await requireFinishedTournament(db, tournamentId, token);
  await db.prepare(`
    UPDATE tournament_shares SET is_open = 0, updated_at = ? WHERE tournament_id = ?
  `).bind(new Date().toISOString(), tournamentId).run();
  return { open: false, sharePath: null };
}

export async function resetTournamentShare(
  db: D1Database,
  tournamentId: string,
  token: string,
): Promise<ShareStatusPayload> {
  await requireFinishedTournament(db, tournamentId, token);
  const shareToken = createShareToken();
  const timestamp = new Date().toISOString();
  await db.prepare(`
    INSERT INTO tournament_shares (tournament_id, share_token, is_open, created_at, updated_at)
    VALUES (?, ?, 1, ?, ?)
    ON CONFLICT(tournament_id) DO UPDATE SET
      share_token = excluded.share_token, is_open = 1, updated_at = excluded.updated_at
  `).bind(tournamentId, shareToken, timestamp, timestamp).run();
  return { open: true, sharePath: `/share/${encodeURIComponent(shareToken)}` };
}

export async function getPublicShare(db: D1Database, shareToken: string): Promise<PublicSharePayload> {
  if (shareToken.length < 32 || shareToken.length > 100) throw new ShareAccessError();
  const row = await db.prepare(`
    SELECT t.id, t.draft_id, t.snapshot_id, t.name, t.progress_json, t.version,
           t.last_event_sequence, t.started_at, t.updated_at, t.completed_at,
           p.title AS playlist_title, p.cover_url
    FROM tournament_shares s
    JOIN tournaments t ON t.id = s.tournament_id
    JOIN playlist_snapshots p ON p.id = t.snapshot_id
    WHERE s.share_token = ? AND s.is_open = 1 AND t.status = 'finished'
  `).bind(shareToken).first<PublicShareRow>();
  if (!row) throw new ShareAccessError();
  const songs = await loadSongs(db, row.snapshot_id);
  return {
    tournament: {
      id: row.id,
      draftId: row.draft_id,
      snapshotId: row.snapshot_id,
      name: row.name,
      progress: JSON.parse(row.progress_json) as CloudTournament["progress"],
      version: row.version,
      lastEventSequence: row.last_event_sequence ?? 0,
      startedAt: row.started_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
    },
    songs: songs.map((song) => ({
      ...song,
      sourceSongId: null,
      sourceSongMid: null,
      mediaUrl: null,
      previewUrl: null,
    })),
    playlist: { title: row.playlist_title, coverUrl: row.cover_url },
  };
}

async function requireFinishedTournament(db: D1Database, tournamentId: string, token: string) {
  const payload = await getTournament(db, tournamentId, token);
  if (payload.tournament.progress.status !== "finished") {
    throw new ShareValidationError("赛事完成后才能开放分享");
  }
  return payload;
}

async function loadShareRow(db: D1Database, tournamentId: string): Promise<ShareRow | null> {
  return db.prepare(`
    SELECT share_token, is_open FROM tournament_shares WHERE tournament_id = ?
  `).bind(tournamentId).first<ShareRow>();
}

function statusForRow(row: ShareRow | null): ShareStatusPayload {
  return row?.is_open === 1
    ? { open: true, sharePath: `/share/${encodeURIComponent(row.share_token)}` }
    : { open: false, sharePath: null };
}

async function loadSongs(db: D1Database, snapshotId: string): Promise<SnapshotSong[]> {
  const result = await db.prepare(`
    SELECT id, source_position, source_song_id, source_song_mid, title, artists_json,
           album, duration_seconds, media_url, preview_url
    FROM snapshot_songs WHERE snapshot_id = ? ORDER BY source_position
  `).bind(snapshotId).all<SongRow>();
  return result.results.map((song) => ({
    id: song.id,
    sourcePosition: song.source_position,
    sourceSongId: song.source_song_id,
    sourceSongMid: song.source_song_mid,
    title: song.title,
    artists: JSON.parse(song.artists_json) as string[],
    album: song.album,
    durationSeconds: song.duration_seconds,
    mediaUrl: song.media_url,
    previewUrl: song.preview_url,
  }));
}

function createShareToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
