import type {
  CloudTournamentDraft,
  SnapshotSong,
  TournamentScale,
} from "@song-world-cup/domain";
import { appPath } from "../../app/paths";

export interface DraftPayload {
  draft: CloudTournamentDraft;
  songs: SnapshotSong[];
}

export interface CreatedDraftPayload extends DraftPayload {
  restoreToken: string;
  recoveryPath: string;
}

interface ErrorPayload {
  error?: {
    code?: string;
    message?: string;
  };
}

export async function createCloudDraft(input: {
  snapshotId: string;
  name: string;
  selectedSongIds: string[];
  scale: TournamentScale;
}): Promise<CreatedDraftPayload> {
  return request<CreatedDraftPayload>("/api/drafts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function getCloudDraft(draftId: string, token: string): Promise<DraftPayload> {
  return request<DraftPayload>(`/api/drafts/${encodeURIComponent(draftId)}`, {
    headers: { "X-Draft-Token": token },
  });
}

export async function redrawCloudDraft(
  draftId: string,
  token: string,
  version: number,
): Promise<DraftPayload> {
  return request<DraftPayload>(`/api/drafts/${encodeURIComponent(draftId)}/redraw`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Draft-Token": token,
    },
    body: JSON.stringify({ version }),
  });
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(appPath(url), init);
  const body = await response.json().catch(() => ({})) as T | ErrorPayload;
  if (!response.ok) {
    const error = body as ErrorPayload;
    throw new Error(error.error?.message ?? "云端草稿操作失败");
  }
  return body as T;
}

