import { appPath } from "../../app/paths";

export interface AdminOverview {
  metrics: { snapshotsToday: number; inProgress: number; finished: number; openShares: number; accounts: number };
  flags: Array<{ key: string; enabled: boolean; updatedAt: string }>;
  auditLogs: Array<{ id: string; action: string; detail: unknown; createdAt: string }>;
  limits: { anonymousImportsPerDay: number; accountImportsPerDay: number; editLeaseProtectionSeconds: number };
}

export async function getAdminOverview(token: string): Promise<AdminOverview> {
  return request("/api/admin/overview", token);
}

export async function updateFeatureFlag(token: string, key: string, enabled: boolean) {
  return request<{ key: string; enabled: boolean; updatedAt: string }>("/api/admin/feature-flags", token, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, enabled }),
  });
}

async function request<T>(url: string, token: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(appPath(url), {
    ...init,
    headers: { ...init.headers, "X-Admin-Token": token },
  });
  const body = await response.json().catch(() => ({})) as T | { error?: { message?: string } };
  if (!response.ok) throw new Error((body as { error?: { message?: string } }).error?.message ?? "后台请求失败");
  return body as T;
}
