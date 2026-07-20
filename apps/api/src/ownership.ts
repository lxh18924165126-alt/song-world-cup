import type { CloudTournament } from "@song-world-cup/domain";
import { sessionAccount, type AccountProfile } from "./auth";
import { TournamentAccessError, TournamentValidationError } from "./tournaments";

export interface ClaimTournamentInput {
  tournaments?: unknown;
}

export interface AccountTournamentSummary {
  tournament: CloudTournament;
}

interface ClaimItem { id: string; token: string }

interface OwnershipRow {
  id: string;
  access_token_hash: string;
  owner_account_id: string | null;
}

interface AccountTournamentRow {
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
}

export async function claimAnonymousTournaments(
  db: D1Database,
  sessionToken: string,
  input: ClaimTournamentInput,
): Promise<{ account: AccountProfile; claimedTournamentIds: string[] }> {
  const account = await sessionAccount(db, sessionToken);
  const items = parseClaimItems(input.tournaments);
  const statements: D1PreparedStatement[] = [];
  const claimedTournamentIds: string[] = [];

  for (const item of items) {
    const row = await db.prepare(`
      SELECT id, access_token_hash, owner_account_id FROM tournaments WHERE id = ?
    `).bind(item.id).first<OwnershipRow>();
    if (!row) throw new TournamentAccessError();
    if (row.owner_account_id === account.id) {
      claimedTournamentIds.push(row.id);
      continue;
    }
    if (row.owner_account_id || row.access_token_hash !== await hash(item.token)) {
      throw new TournamentAccessError();
    }
    const revokedTournamentHash = await hash(crypto.randomUUID());
    const revokedDraftHash = await hash(crypto.randomUUID());
    const operationId = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    statements.push(
      db.prepare(`
        INSERT INTO ownership_claim_operations (
          id, tournament_id, account_id, expected_access_token_hash,
          replacement_access_token_hash, replacement_draft_token_hash, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(operationId, row.id, account.id, row.access_token_hash, revokedTournamentHash, revokedDraftHash, timestamp),
      db.prepare("DELETE FROM ownership_claim_operations WHERE id = ?").bind(operationId),
    );
    claimedTournamentIds.push(row.id);
  }
  if (statements.length > 0) {
    try {
      const results = await db.batch(statements);
      if (results.some((result) => !result.success)) throw new TournamentAccessError();
    } catch {
      throw new TournamentAccessError();
    }
  }
  return { account, claimedTournamentIds };
}

export async function listAccountTournaments(
  db: D1Database,
  sessionToken: string,
): Promise<{ account: AccountProfile; tournaments: AccountTournamentSummary[] }> {
  const account = await sessionAccount(db, sessionToken);
  const result = await db.prepare(`
    SELECT id, draft_id, snapshot_id, name, progress_json, version, last_event_sequence,
           started_at, updated_at, completed_at
    FROM tournaments WHERE owner_account_id = ? ORDER BY updated_at DESC
  `).bind(account.id).all<AccountTournamentRow>();
  return {
    account,
    tournaments: result.results.map((row) => ({
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
    })),
  };
}

function parseClaimItems(value: unknown): ClaimItem[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw new TournamentValidationError("请选择 1 至 100 场可迁移赛事");
  }
  const items = value.map((item) => {
    const record = typeof item === "object" && item !== null ? item as Record<string, unknown> : {};
    if (typeof record.id !== "string" || typeof record.token !== "string" || record.token.length < 32) {
      throw new TournamentValidationError("赛事迁移凭证无效");
    }
    return { id: record.id, token: record.token };
  });
  if (new Set(items.map((item) => item.id)).size !== items.length) {
    throw new TournamentValidationError("迁移列表包含重复赛事");
  }
  return items;
}

async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
