import type { CloudTournament, SnapshotSong } from "@song-world-cup/domain";
import { appPath } from "../../app/paths";
import { getTournamentDeviceId } from "./device";
import { sessionHeaders } from "../auth/session";

export interface EditLeaseStatus {
  editable: boolean;
  generation: number;
  activeUntil: string;
  protectUntil: string;
  takeoverAllowedAt: string | null;
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

interface ErrorPayload {
  error?: { code?: string; message?: string; lease?: EditLeaseStatus };
}

export interface TournamentEventIdentity {
  eventId: string;
  sequence: number;
}

export type TournamentSyncEvent =
  | (TournamentEventIdentity & { kind: "pick"; matchId: string; winnerId: string | null })
  | (TournamentEventIdentity & { kind: "lock_round" });

export class TournamentRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | undefined,
    readonly lease?: EditLeaseStatus,
  ) {
    super(message);
    this.name = "TournamentRequestError";
  }
}

export async function startTournament(draftId: string, token: string): Promise<StartedTournamentPayload> {
  return request<StartedTournamentPayload>(`/api/drafts/${encodeURIComponent(draftId)}/start`, {
    method: "POST",
    headers: { "X-Draft-Token": token, ...sessionHeaders() },
  });
}

export async function getTournament(tournamentId: string, token: string): Promise<TournamentPayload> {
  return request<TournamentPayload>(`/api/tournaments/${encodeURIComponent(tournamentId)}`, {
    headers: { "X-Tournament-Token": token, ...sessionHeaders() },
  });
}

export async function pickTournamentMatch(
  tournamentId: string,
  token: string,
  version: number,
  matchId: string,
  winnerId: string | null,
  identity?: TournamentEventIdentity,
): Promise<TournamentPayload> {
  return request<TournamentPayload>(`/api/tournaments/${encodeURIComponent(tournamentId)}/picks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Tournament-Token": token,
      "X-Device-ID": getTournamentDeviceId(),
      ...sessionHeaders(),
    },
    body: JSON.stringify({ version, matchId, winnerId, ...identity }),
  });
}

export async function lockTournamentRound(
  tournamentId: string,
  token: string,
  version: number,
  identity?: TournamentEventIdentity,
): Promise<TournamentPayload> {
  return request<TournamentPayload>(`/api/tournaments/${encodeURIComponent(tournamentId)}/lock-round`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Tournament-Token": token,
      "X-Device-ID": getTournamentDeviceId(),
      ...sessionHeaders(),
    },
    body: JSON.stringify({ version, ...identity }),
  });
}

export async function syncTournamentEvents(
  tournamentId: string,
  token: string,
  version: number,
  events: TournamentSyncEvent[],
): Promise<TournamentPayload> {
  return request<TournamentPayload>(`/api/tournaments/${encodeURIComponent(tournamentId)}/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Tournament-Token": token,
      "X-Device-ID": getTournamentDeviceId(),
      ...sessionHeaders(),
    },
    body: JSON.stringify({ version, events }),
  });
}

export async function heartbeatTournament(
  tournamentId: string,
  token: string,
): Promise<EditLeaseStatus> {
  const payload = await request<{ lease: EditLeaseStatus }>(
    `/api/tournaments/${encodeURIComponent(tournamentId)}/heartbeat`,
    {
      method: "POST",
      headers: {
        "X-Tournament-Token": token,
        "X-Device-ID": getTournamentDeviceId(),
        ...sessionHeaders(),
      },
    },
  );
  return payload.lease;
}

export async function takeoverTournament(
  tournamentId: string,
  token: string,
): Promise<EditLeaseStatus> {
  const payload = await request<{ lease: EditLeaseStatus }>(
    `/api/tournaments/${encodeURIComponent(tournamentId)}/takeover`,
    {
      method: "POST",
      headers: {
        "X-Tournament-Token": token,
        "X-Device-ID": getTournamentDeviceId(),
        ...sessionHeaders(),
      },
    },
  );
  return payload.lease;
}

export async function branchTournament(
  tournamentId: string,
  token: string,
  progress: CloudTournament["progress"],
): Promise<BranchedTournamentPayload> {
  return request<BranchedTournamentPayload>(
    `/api/tournaments/${encodeURIComponent(tournamentId)}/branch`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Tournament-Token": token,
        ...sessionHeaders(),
      },
      body: JSON.stringify({ progress }),
    },
  );
}

async function request<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(appPath(url), init);
  const body = await response.json().catch(() => ({})) as T | ErrorPayload;
  if (!response.ok) {
    const error = (body as ErrorPayload).error;
    throw new TournamentRequestError(
      error?.message ?? "赛事操作失败",
      response.status,
      error?.code,
      error?.lease,
    );
  }
  return body as T;
}
