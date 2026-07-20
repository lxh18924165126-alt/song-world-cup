import type { DBSchema, IDBPDatabase } from "idb";
import { openDB } from "idb";
import type {
  CloudTournament,
  PlaylistSnapshot,
  SnapshotSong,
  TournamentDraft,
} from "@song-world-cup/domain";

export interface CachedTournamentRecord {
  id: string;
  tournament: CloudTournament;
  songs: SnapshotSong[];
  token: string;
  nextSequence: number;
  lastSyncedAt: string | null;
}

interface TournamentEventBase {
  id: string;
  tournamentId: string;
  sequence: number;
  createdAt: string;
}

export interface TournamentPickEvent extends TournamentEventBase {
  kind: "pick";
  matchId: string;
  winnerId: string | null;
}

export interface TournamentLockRoundEvent extends TournamentEventBase {
  kind: "lock_round";
}

export type TournamentQueueEvent = TournamentPickEvent | TournamentLockRoundEvent;

export interface SongWorldCupDatabase extends DBSchema {
  snapshots: {
    key: string;
    value: PlaylistSnapshot;
  };
  drafts: {
    key: string;
    value: TournamentDraft;
    indexes: { "by-snapshot": string };
  };
  tournaments: {
    key: string;
    value: CachedTournamentRecord;
  };
  tournamentEvents: {
    key: string;
    value: TournamentQueueEvent;
    indexes: { "by-tournament-sequence": [string, number] };
  };
}

const DATABASE_NAME = "song-world-cup";
let databasePromise: Promise<IDBPDatabase<SongWorldCupDatabase>> | undefined;

export function database(): Promise<IDBPDatabase<SongWorldCupDatabase>> {
  databasePromise ??= openDB<SongWorldCupDatabase>(DATABASE_NAME, 2, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("snapshots")) {
        db.createObjectStore("snapshots", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("drafts")) {
        const drafts = db.createObjectStore("drafts", { keyPath: "id" });
        drafts.createIndex("by-snapshot", "snapshotId");
      }
      if (!db.objectStoreNames.contains("tournaments")) {
        db.createObjectStore("tournaments", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("tournamentEvents")) {
        const events = db.createObjectStore("tournamentEvents", { keyPath: "id" });
        events.createIndex("by-tournament-sequence", ["tournamentId", "sequence"]);
      }
    },
  });
  return databasePromise;
}
