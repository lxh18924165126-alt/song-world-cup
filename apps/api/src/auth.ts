export type AuthProviderName = "wechat" | "qq";

export interface AuthEnv {
  DB: D1Database;
  AUTH_MODE?: string;
  WECHAT_CLIENT_ID?: string;
  WECHAT_CLIENT_SECRET?: string;
  WECHAT_REDIRECT_URI?: string;
  QQ_CLIENT_ID?: string;
  QQ_CLIENT_SECRET?: string;
  QQ_REDIRECT_URI?: string;
}

export interface AccountProfile {
  id: string;
  provider: AuthProviderName;
  displayName: string;
}

export interface AuthSessionPayload {
  sessionToken: string;
  expiresAt: string;
  account: AccountProfile;
}

interface AccountRow {
  id: string;
  provider: AuthProviderName;
  display_name: string;
}

interface SessionRow extends AccountRow {
  expires_at: string;
}

export class AuthError extends Error {
  constructor(message: string, readonly status = 401) {
    super(message);
    this.name = "AuthError";
  }
}

export async function mockLogin(
  env: AuthEnv,
  provider: AuthProviderName,
  displayNameValue: unknown,
): Promise<AuthSessionPayload> {
  if ((env.AUTH_MODE ?? "mock") !== "mock") throw new AuthError("模拟登录仅在本地演示模式开放", 404);
  if (typeof displayNameValue !== "string" || displayNameValue.trim().length < 1 || displayNameValue.trim().length > 40) {
    throw new AuthError("昵称需为 1 至 40 个字符", 400);
  }
  const displayName = displayNameValue.trim();
  const subject = `mock:${await hash(`${provider}:${displayName.toLocaleLowerCase()}`)}`;
  return createSession(env.DB, provider, subject, displayName);
}

export async function createOauthStart(env: AuthEnv, provider: AuthProviderName): Promise<{ authorizeUrl: string; state: string }> {
  const state = randomToken();
  const authorizeUrl = oauthStartUrl(env, provider, state);
  const now = new Date();
  await env.DB.prepare(`
    INSERT INTO oauth_states (state_hash, provider, created_at, expires_at) VALUES (?, ?, ?, ?)
  `).bind(await hash(state), provider, now.toISOString(), new Date(now.getTime() + 10 * 60_000).toISOString()).run();
  return { authorizeUrl, state };
}

export function oauthStartUrl(env: AuthEnv, provider: AuthProviderName, state: string): string {
  if ((env.AUTH_MODE ?? "mock") === "mock") throw new AuthError("当前为模拟 Provider 模式", 400);
  const config = providerConfig(env, provider);
  const url = new URL(config.authorizeUrl);
  url.searchParams.set(provider === "wechat" ? "appid" : "client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", config.scope);
  url.searchParams.set("state", state);
  if (provider === "wechat") url.hash = "wechat_redirect";
  return url.toString();
}

export async function oauthCallback(
  env: AuthEnv,
  provider: AuthProviderName,
  codeValue: unknown,
  stateValue: unknown,
): Promise<AuthSessionPayload> {
  if ((env.AUTH_MODE ?? "mock") === "mock") throw new AuthError("当前为模拟 Provider 模式", 400);
  if (typeof codeValue !== "string" || codeValue.length < 4 || typeof stateValue !== "string" || stateValue.length < 32) {
    throw new AuthError("OAuth 回调参数无效", 400);
  }
  const deleted = await env.DB.prepare(`
    DELETE FROM oauth_states WHERE state_hash = ? AND provider = ? AND expires_at > ?
  `).bind(await hash(stateValue), provider, new Date().toISOString()).run();
  if (deleted.meta.changes !== 1) throw new AuthError("OAuth state 已失效或被使用", 400);
  const config = providerConfig(env, provider);
  const profile = provider === "wechat"
    ? await exchangeWechat(config, codeValue)
    : await exchangeQq(config, codeValue);
  return createSession(env.DB, provider, profile.subject, profile.displayName);
}

export async function sessionAccount(db: D1Database, sessionToken: string): Promise<AccountProfile> {
  if (!sessionToken) throw new AuthError("请先登录");
  const tokenHash = await hash(sessionToken);
  const row = await db.prepare(`
    SELECT a.id, a.provider, a.display_name, s.expires_at
    FROM auth_sessions s JOIN accounts a ON a.id = s.account_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `).bind(tokenHash, new Date().toISOString()).first<SessionRow>();
  if (!row) throw new AuthError("登录状态已失效，请重新登录");
  return { id: row.id, provider: row.provider, displayName: row.display_name };
}

export async function logout(db: D1Database, sessionToken: string): Promise<void> {
  if (!sessionToken) return;
  await db.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").bind(await hash(sessionToken)).run();
}

export async function sessionTokenHash(sessionToken: string): Promise<string> {
  return hash(sessionToken);
}

export async function createSession(
  db: D1Database,
  provider: AuthProviderName,
  subject: string,
  displayName: string,
): Promise<AuthSessionPayload> {
  const existing = await db.prepare(`
    SELECT id, provider, display_name FROM accounts WHERE provider = ? AND provider_subject = ?
  `).bind(provider, subject).first<AccountRow>();
  const accountId = existing?.id ?? crypto.randomUUID();
  const now = new Date();
  const createdAt = now.toISOString();
  await db.prepare(`
    INSERT INTO accounts (id, provider, provider_subject, display_name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider, provider_subject) DO UPDATE SET
      display_name = excluded.display_name, updated_at = excluded.updated_at
  `).bind(accountId, provider, subject, displayName, createdAt, createdAt).run();
  const sessionToken = randomToken();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000).toISOString();
  await db.prepare(`
    INSERT INTO auth_sessions (token_hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)
  `).bind(await hash(sessionToken), accountId, createdAt, expiresAt).run();
  return {
    sessionToken,
    expiresAt,
    account: { id: accountId, provider, displayName },
  };
}

async function exchangeWechat(
  config: ReturnType<typeof providerConfig>,
  code: string,
): Promise<{ subject: string; displayName: string }> {
  const tokenUrl = new URL("https://api.weixin.qq.com/sns/oauth2/access_token");
  tokenUrl.search = new URLSearchParams({
    appid: config.clientId,
    secret: config.clientSecret,
    code,
    grant_type: "authorization_code",
  }).toString();
  const token = await providerJson(tokenUrl) as Record<string, unknown>;
  const accessToken = stringField(token, "access_token", "微信授权失败");
  const openid = stringField(token, "openid", "微信授权缺少 openid");
  const profileUrl = new URL("https://api.weixin.qq.com/sns/userinfo");
  profileUrl.search = new URLSearchParams({ access_token: accessToken, openid, lang: "zh_CN" }).toString();
  const profile = await providerJson(profileUrl) as Record<string, unknown>;
  return {
    subject: typeof profile.unionid === "string" ? profile.unionid : openid,
    displayName: stringField(profile, "nickname", "微信用户信息缺少昵称"),
  };
}

async function exchangeQq(
  config: ReturnType<typeof providerConfig>,
  code: string,
): Promise<{ subject: string; displayName: string }> {
  const tokenUrl = new URL("https://graph.qq.com/oauth2.0/token");
  tokenUrl.search = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: config.redirectUri,
    fmt: "json",
  }).toString();
  const token = await providerJson(tokenUrl) as Record<string, unknown>;
  const accessToken = stringField(token, "access_token", "QQ 授权失败");
  const identityUrl = new URL("https://graph.qq.com/oauth2.0/me");
  identityUrl.search = new URLSearchParams({ access_token: accessToken, fmt: "json" }).toString();
  const identity = await providerJson(identityUrl) as Record<string, unknown>;
  const openid = stringField(identity, "openid", "QQ 授权缺少 openid");
  const profileUrl = new URL("https://graph.qq.com/user/get_user_info");
  profileUrl.search = new URLSearchParams({
    access_token: accessToken,
    oauth_consumer_key: config.clientId,
    openid,
    fmt: "json",
  }).toString();
  const profile = await providerJson(profileUrl) as Record<string, unknown>;
  return { subject: openid, displayName: stringField(profile, "nickname", "QQ 用户信息缺少昵称") };
}

async function providerJson(url: URL): Promise<unknown> {
  const response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new AuthError("第三方登录服务暂不可用", 502);
  const body = await response.json().catch(() => null);
  if (!body || typeof body !== "object") throw new AuthError("第三方登录响应无效", 502);
  const errorCode = (body as Record<string, unknown>).errcode
    ?? (body as Record<string, unknown>).error
    ?? (body as Record<string, unknown>).ret;
  if (errorCode && errorCode !== 0) throw new AuthError("第三方登录授权失败", 502);
  return body;
}

function stringField(value: Record<string, unknown>, key: string, message: string): string {
  const field = value[key];
  if (typeof field !== "string" || field.length === 0) throw new AuthError(message, 502);
  return field;
}

function providerConfig(env: AuthEnv, provider: AuthProviderName) {
  const values = provider === "wechat"
    ? {
      clientId: env.WECHAT_CLIENT_ID,
      clientSecret: env.WECHAT_CLIENT_SECRET,
      redirectUri: env.WECHAT_REDIRECT_URI,
      authorizeUrl: "https://open.weixin.qq.com/connect/qrconnect",
      scope: "snsapi_login",
    }
    : {
      clientId: env.QQ_CLIENT_ID,
      clientSecret: env.QQ_CLIENT_SECRET,
      redirectUri: env.QQ_REDIRECT_URI,
      authorizeUrl: "https://graph.qq.com/oauth2.0/authorize",
      scope: "get_user_info",
    };
  if (!values.clientId || !values.clientSecret || !values.redirectUri) {
    throw new AuthError(`${provider === "wechat" ? "微信" : "QQ"} OAuth 凭证未配置`, 503);
  }
  return values as typeof values & { clientId: string; clientSecret: string; redirectUri: string };
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
