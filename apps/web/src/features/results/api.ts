import type { CloudTournament, SnapshotSong } from "@song-world-cup/domain";
import { TournamentRequestError } from "../tournament/api";
import { sessionHeaders } from "../auth/session";

export interface ShareStatus {
  open: boolean;
  sharePath: string | null;
}

export interface PublicSharePayload {
  tournament: CloudTournament;
  songs: SnapshotSong[];
  playlist: { title: string; coverUrl: string | null };
}

export function getShareStatus(tournamentId: string, token: string): Promise<ShareStatus> {
  return request(`/api/tournaments/${encodeURIComponent(tournamentId)}/share`, token);
}

export function openShare(tournamentId: string, token: string): Promise<ShareStatus> {
  return request(`/api/tournaments/${encodeURIComponent(tournamentId)}/open-share`, token, "POST");
}

export function closeShare(tournamentId: string, token: string): Promise<ShareStatus> {
  return request(`/api/tournaments/${encodeURIComponent(tournamentId)}/close-share`, token, "POST");
}

export function resetShare(tournamentId: string, token: string): Promise<ShareStatus> {
  return request(`/api/tournaments/${encodeURIComponent(tournamentId)}/reset-share-link`, token, "POST");
}

export async function getPublicShare(shareToken: string): Promise<PublicSharePayload> {
  const response = await fetch(`/api/share/${encodeURIComponent(shareToken)}`);
  const body = await response.json().catch(() => ({})) as PublicSharePayload | { error?: { code?: string; message?: string } };
  if (!response.ok) {
    const error = (body as { error?: { code?: string; message?: string } }).error;
    throw new TournamentRequestError(error?.message ?? "分享链接不可用", response.status, error?.code);
  }
  return body as PublicSharePayload;
}

async function request(url: string, token: string, method = "GET"): Promise<ShareStatus> {
  const response = await fetch(url, { method, headers: { "X-Tournament-Token": token, ...sessionHeaders() } });
  const body = await response.json().catch(() => ({})) as ShareStatus | { error?: { code?: string; message?: string } };
  if (!response.ok) {
    const error = (body as { error?: { code?: string; message?: string } }).error;
    throw new TournamentRequestError(error?.message ?? "分享设置失败", response.status, error?.code);
  }
  return body as ShareStatus;
}
