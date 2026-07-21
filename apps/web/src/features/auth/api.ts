import type { CloudTournament } from "@song-world-cup/domain";
import { appPath } from "../../app/paths";
import {
  clearStoredSession,
  getStoredSession,
  sessionHeaders,
  storeSession,
  type AccountProfile,
  type AuthProviderName,
  type StoredAuthSession,
} from "./session";

export interface AccountTournamentSummary { tournament: CloudTournament }

export async function mockLogin(provider: AuthProviderName, displayName: string): Promise<StoredAuthSession> {
  const session = await request<StoredAuthSession>("/api/auth/mock", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, displayName }),
  });
  storeSession(session);
  return session;
}

export async function startOauthLogin(provider: AuthProviderName): Promise<void> {
  const payload = await request<{ authorizeUrl: string }>(`/api/auth/${provider}/start`, {});
  window.location.assign(payload.authorizeUrl);
}

export async function completeOauthLogin(
  provider: AuthProviderName,
  code: string,
  state: string,
): Promise<StoredAuthSession> {
  const session = await request<StoredAuthSession>(`/api/auth/${provider}/callback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, state }),
  });
  storeSession(session);
  return session;
}

export async function validateSession(): Promise<AccountProfile | null> {
  const stored = getStoredSession();
  if (!stored) return null;
  try {
    const payload = await request<{ account: AccountProfile }>("/api/auth/session", { headers: sessionHeaders() });
    return payload.account;
  } catch {
    clearStoredSession();
    return null;
  }
}

export async function logout(): Promise<void> {
  try {
    await request("/api/auth/session", { method: "DELETE", headers: sessionHeaders() });
  } finally {
    clearStoredSession();
  }
}

export async function claimTournaments(tournaments: Array<{ id: string; token: string }>) {
  return request<{ account: AccountProfile; claimedTournamentIds: string[] }>("/api/migration/claim", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...sessionHeaders() },
    body: JSON.stringify({ tournaments }),
  });
}

export async function getAccountTournaments() {
  return request<{ account: AccountProfile; tournaments: AccountTournamentSummary[] }>(
    "/api/account/tournaments",
    { headers: sessionHeaders() },
  );
}

async function request<T = unknown>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(appPath(url), init);
  const body = await response.json().catch(() => ({})) as T | { error?: { message?: string } };
  if (!response.ok) throw new Error((body as { error?: { message?: string } }).error?.message ?? "账户操作失败");
  return body as T;
}
