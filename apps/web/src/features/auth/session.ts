const SESSION_KEY = "song-world-cup-auth-session-v1";

export type AuthProviderName = "wechat" | "qq";

export interface AccountProfile {
  id: string;
  provider: AuthProviderName;
  displayName: string;
}

export interface StoredAuthSession {
  sessionToken: string;
  expiresAt: string;
  account: AccountProfile;
}

let cachedSession: StoredAuthSession | null | undefined;

export function getStoredSession(): StoredAuthSession | null {
  if (cachedSession !== undefined) return cachedSession;
  if (typeof localStorage === "undefined") return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null") as StoredAuthSession | null;
    cachedSession = parsed && Date.parse(parsed.expiresAt) > Date.now() ? parsed : null;
  } catch {
    cachedSession = null;
  }
  return cachedSession;
}

export function storeSession(session: StoredAuthSession): void {
  cachedSession = session;
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearStoredSession(): void {
  cachedSession = null;
  localStorage.removeItem(SESSION_KEY);
}

export function sessionHeaders(): Record<string, string> {
  const session = getStoredSession();
  return session ? { "X-Session-Token": session.sessionToken } : {};
}
