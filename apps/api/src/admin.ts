export interface AdminEnv {
  DB: D1Database;
  ADMIN_TOKEN?: string;
  AUTH_MODE?: string;
}

export interface FeatureFlag {
  key: string;
  enabled: boolean;
  updatedAt: string;
}

interface CountRow { count: number }
interface FlagRow { key: string; enabled: number; updated_at: string }
interface AuditRow { id: string; action: string; detail_json: string; created_at: string }

export class AdminAccessError extends Error {
  constructor(message = "管理员凭证无效", readonly status = 401) {
    super(message);
    this.name = "AdminAccessError";
  }
}

export function assertAdmin(env: AdminEnv, request: Request): void {
  const expected = env.ADMIN_TOKEN ?? "";
  if (!expected) throw new AdminAccessError("环境尚未配置 ADMIN_TOKEN", 503);
  if (request.headers.get("X-Admin-Token") !== expected) throw new AdminAccessError();
}

export async function getAdminOverview(db: D1Database) {
  const [snapshotsToday, inProgress, finished, openShares, accounts, flags, audits] = await Promise.all([
    count(db, "SELECT COUNT(*) AS count FROM playlist_snapshots WHERE imported_at >= datetime('now', '-1 day')"),
    count(db, "SELECT COUNT(*) AS count FROM tournaments WHERE status = 'in_progress'"),
    count(db, "SELECT COUNT(*) AS count FROM tournaments WHERE status = 'finished'"),
    count(db, "SELECT COUNT(*) AS count FROM tournament_shares WHERE is_open = 1"),
    count(db, "SELECT COUNT(*) AS count FROM accounts"),
    db.prepare("SELECT key, enabled, updated_at FROM feature_flags ORDER BY key").all<FlagRow>(),
    db.prepare("SELECT id, action, detail_json, created_at FROM admin_audit_logs ORDER BY created_at DESC LIMIT 20").all<AuditRow>(),
  ]);
  return {
    metrics: { snapshotsToday, inProgress, finished, openShares, accounts },
    flags: flags.results.map(toFlag),
    auditLogs: audits.results.map((row) => ({
      id: row.id,
      action: row.action,
      detail: JSON.parse(row.detail_json) as unknown,
      createdAt: row.created_at,
    })),
    limits: { anonymousImportsPerDay: 20, accountImportsPerDay: 40, editLeaseProtectionSeconds: 300 },
  };
}

export async function updateFeatureFlag(db: D1Database, input: unknown): Promise<FeatureFlag> {
  const body = typeof input === "object" && input !== null ? input as Record<string, unknown> : {};
  if (typeof body.key !== "string" || typeof body.enabled !== "boolean") {
    throw new AdminAccessError("功能开关参数无效", 400);
  }
  const existing = await db.prepare("SELECT key FROM feature_flags WHERE key = ?").bind(body.key).first();
  if (!existing) throw new AdminAccessError("未知功能开关", 400);
  const updatedAt = new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE feature_flags SET enabled = ?, updated_at = ? WHERE key = ?")
      .bind(body.enabled ? 1 : 0, updatedAt, body.key),
    db.prepare("INSERT INTO admin_audit_logs (id, action, detail_json, created_at) VALUES (?, ?, ?, ?)")
      .bind(crypto.randomUUID(), "feature_flag_updated", JSON.stringify({ key: body.key, enabled: body.enabled }), updatedAt),
  ]);
  return { key: body.key, enabled: body.enabled, updatedAt };
}

export async function featureEnabled(db: D1Database, key: string): Promise<boolean> {
  const row = await db.prepare("SELECT enabled FROM feature_flags WHERE key = ?").bind(key).first<{ enabled: number }>();
  return row?.enabled === 1;
}

async function count(db: D1Database, sql: string): Promise<number> {
  return (await db.prepare(sql).first<CountRow>())?.count ?? 0;
}

function toFlag(row: FlagRow): FeatureFlag {
  return { key: row.key, enabled: row.enabled === 1, updatedAt: row.updated_at };
}
