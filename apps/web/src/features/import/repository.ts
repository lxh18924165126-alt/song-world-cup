import type { PlaylistSnapshot, TournamentDraft } from "@song-world-cup/domain";
import { createUuid } from "../../app/id";
import { database } from "../../storage/database";

const CURRENT_DRAFT_KEY = "song-world-cup:current-draft-id:v1";

export async function createImportDraft(snapshot: PlaylistSnapshot): Promise<TournamentDraft> {
  const draft: TournamentDraft = {
    id: createUuid(),
    snapshotId: snapshot.id,
    name: `${snapshot.title} · 歌曲世界杯`.slice(0, 20),
    selectedSongIds: snapshot.songs.map((song) => song.id),
    scale: "all",
    cloudDraftId: null,
    cloudDraftToken: null,
    cloudDraftVersion: null,
    updatedAt: new Date().toISOString(),
  };
  const db = await database();
  const transaction = db.transaction(["snapshots", "drafts"], "readwrite");
  await Promise.all([
    transaction.objectStore("snapshots").add(snapshot),
    transaction.objectStore("drafts").add(draft),
    transaction.done,
  ]);
  localStorage.setItem(CURRENT_DRAFT_KEY, draft.id);
  return draft;
}

export async function getCurrentImport(): Promise<{ snapshot: PlaylistSnapshot; draft: TournamentDraft } | null> {
  const draftId = localStorage.getItem(CURRENT_DRAFT_KEY);
  if (!draftId) {
    return null;
  }
  const db = await database();
  const draft = await db.get("drafts", draftId);
  if (!draft) {
    return null;
  }
  const snapshot = await db.get("snapshots", draft.snapshotId);
  return snapshot ? {
    snapshot,
    draft: {
      ...draft,
      cloudDraftId: draft.cloudDraftId ?? null,
      cloudDraftToken: draft.cloudDraftToken ?? null,
      cloudDraftVersion: draft.cloudDraftVersion ?? null,
    },
  } : null;
}

export async function saveImportDraft(draft: TournamentDraft): Promise<void> {
  const db = await database();
  await db.put("drafts", { ...draft, updatedAt: new Date().toISOString() });
}

export async function promoteCurrentImport(snapshot: PlaylistSnapshot, draft: TournamentDraft): Promise<void> {
  const db = await database();
  const transaction = db.transaction(["snapshots", "drafts"], "readwrite");
  await Promise.all([
    transaction.objectStore("snapshots").put(snapshot),
    transaction.objectStore("drafts").put({ ...draft, updatedAt: new Date().toISOString() }),
    transaction.done,
  ]);
}
