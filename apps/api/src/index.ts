import { PlaylistUrlError, parsePlaylistReference } from "@song-world-cup/domain";
import { resolveNeteasePlaylist, resolveNeteaseShortPlaylistId } from "./netease-cloud-music";
import { resolveQqPlaylist } from "./qq-music";
import { BrowserSnapshotValidationError, promoteBrowserSnapshot, savePlaylistSnapshot } from "./snapshots";
import {
  DraftAccessError,
  DraftConflictError,
  DraftStartedError,
  DraftValidationError,
  createCloudDraft,
  getCloudDraft,
  redrawCloudDraft,
  type CreateDraftInput,
  type RedrawDraftInput,
} from "./drafts";
import {
  TournamentAccessError,
  TournamentConflictError,
  TournamentValidationError,
  branchTournament,
  getTournament,
  startTournament,
  type LockRoundInput,
  type PickTournamentInput,
  type BranchTournamentInput,
  type SyncTournamentEventsInput,
} from "./tournaments";
import {
  TournamentCoordinator,
  type CoordinatorLeaseResult,
  type CoordinatorMutationResult,
} from "./coordinator";
import {
  ShareAccessError,
  ShareValidationError,
  closeTournamentShare,
  getPublicShare,
  getShareStatus,
  openTournamentShare,
  resetTournamentShare,
} from "./shares";
import {
  AuthError,
  createOauthStart,
  logout,
  mockLogin,
  oauthCallback,
  sessionAccount,
  type AuthProviderName,
} from "./auth";
import {
  claimAnonymousTournaments,
  listAccountTournaments,
  type ClaimTournamentInput,
} from "./ownership";
import {
  AdminAccessError,
  assertAdmin,
  featureEnabled,
  getAdminOverview,
  updateFeatureFlag,
} from "./admin";
import { appEvent, consumeAppEvents, type AppEvent } from "./events";

interface Env {
  DB: D1Database;
  TOURNAMENT_COORDINATOR: DurableObjectNamespace;
  AUTH_MODE?: string;
  WECHAT_CLIENT_ID?: string;
  WECHAT_CLIENT_SECRET?: string;
  WECHAT_REDIRECT_URI?: string;
  QQ_CLIENT_ID?: string;
  QQ_CLIENT_SECRET?: string;
  QQ_REDIRECT_URI?: string;
  ADMIN_TOKEN?: string;
  EVENT_QUEUE: Queue<AppEvent>;
}

interface ResolveBody {
  url?: unknown;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/api/health") {
      return json({ status: "ok" });
    }

    if (url.pathname === "/api/admin/overview" && request.method === "GET") {
      try {
        assertAdmin(env, request);
        return json(await getAdminOverview(env.DB));
      } catch (error) {
        return adminErrorResponse(error);
      }
    }

    if (url.pathname === "/api/admin/feature-flags" && request.method === "PATCH") {
      try {
        assertAdmin(env, request);
        return json(await updateFeatureFlag(env.DB, await request.json()));
      } catch (error) {
        return adminErrorResponse(error);
      }
    }

    if (request.method === "POST" && url.pathname === "/api/auth/mock") {
      try {
        const body = await request.json<{ provider?: unknown; displayName?: unknown }>();
        const provider = readProvider(body.provider);
        if (!await featureEnabled(env.DB, `${provider}_login`)) return featureDisabled();
        return json(await mockLogin(env, provider, body.displayName), 201);
      } catch (error) {
        return authErrorResponse(error);
      }
    }

    if (url.pathname === "/api/auth/session") {
      try {
        if (request.method === "GET") return json({ account: await sessionAccount(env.DB, readSessionToken(request)) });
        if (request.method === "DELETE") {
          await logout(env.DB, readSessionToken(request));
          return json({ ok: true });
        }
      } catch (error) {
        return authErrorResponse(error);
      }
    }

    const authStartRoute = url.pathname.match(/^\/api\/auth\/(wechat|qq)\/start$/);
    if (request.method === "GET" && authStartRoute) {
      try {
        const provider = readProvider(authStartRoute[1]);
        if (!await featureEnabled(env.DB, `${provider}_login`)) return featureDisabled();
        return json(await createOauthStart(env, provider));
      } catch (error) {
        return authErrorResponse(error);
      }
    }

    const authCallbackRoute = url.pathname.match(/^\/api\/auth\/(wechat|qq)\/callback$/);
    if (request.method === "POST" && authCallbackRoute) {
      try {
        const body = await request.json<{ code?: unknown; state?: unknown }>();
        return json(await oauthCallback(env, readProvider(authCallbackRoute[1]), body.code, body.state), 201);
      } catch (error) {
        return authErrorResponse(error);
      }
    }

    if (request.method === "POST" && url.pathname === "/api/migration/claim") {
      try {
        return json(await claimAnonymousTournaments(
          env.DB,
          readSessionToken(request),
          await request.json<ClaimTournamentInput>(),
        ));
      } catch (error) {
        return authErrorResponse(error);
      }
    }

    if (request.method === "GET" && url.pathname === "/api/account/tournaments") {
      try {
        return json(await listAccountTournaments(env.DB, readSessionToken(request)));
      } catch (error) {
        return authErrorResponse(error);
      }
    }

    if (request.method === "POST" && url.pathname === "/api/playlists/resolve") {
      return handleResolvePlaylist(request, env, ctx);
    }

    if (request.method === "POST" && url.pathname === "/api/playlists/browser-snapshot") {
      if (!await featureEnabled(env.DB, "qq_import") || !await featureEnabled(env.DB, "browser_import_fallback")) return featureDisabled();
      return handlePromoteBrowserSnapshot(request, env, ctx);
    }

    if (request.method === "POST" && url.pathname === "/api/drafts") {
      return handleCreateDraft(request, env);
    }

    const draftRoute = url.pathname.match(/^\/api\/drafts\/([^/]+)(?:\/(redraw|start))?$/);
    if (draftRoute) {
      const draftId = decodeURIComponent(draftRoute[1] ?? "");
      if (request.method === "GET" && !draftRoute[2]) {
        return handleGetDraft(request, env, draftId);
      }
      if (request.method === "POST" && draftRoute[2] === "redraw") {
        return handleRedrawDraft(request, env, draftId);
      }
      if (request.method === "POST" && draftRoute[2] === "start") {
        return handleStartTournament(request, env, draftId);
      }
    }

    const tournamentRoute = url.pathname.match(/^\/api\/tournaments\/([^/]+)(?:\/(picks|events|lock-round|heartbeat|takeover|branch|share|open-share|close-share|reset-share-link))?$/);
    if (tournamentRoute) {
      const tournamentId = decodeURIComponent(tournamentRoute[1] ?? "");
      if (request.method === "GET" && !tournamentRoute[2]) {
        return handleGetTournament(request, env, tournamentId);
      }
      if (request.method === "POST" && tournamentRoute[2] === "picks") {
        return handlePickTournament(request, env, tournamentId);
      }
      if (request.method === "POST" && tournamentRoute[2] === "events") {
        return handleTournamentEvents(request, env, tournamentId);
      }
      if (request.method === "POST" && tournamentRoute[2] === "lock-round") {
        return handleLockRound(request, env, tournamentId);
      }
      if (request.method === "POST" && tournamentRoute[2] === "heartbeat") {
        return handleLease(request, env, tournamentId, false);
      }
      if (request.method === "POST" && tournamentRoute[2] === "takeover") {
        return handleLease(request, env, tournamentId, true);
      }
      if (request.method === "POST" && tournamentRoute[2] === "branch") {
        return handleBranchTournament(request, env, tournamentId);
      }
      if (request.method === "GET" && tournamentRoute[2] === "share") {
        return handleCreatorShare(request, env, tournamentId, "status");
      }
      if (request.method === "POST" && tournamentRoute[2] === "open-share") {
        return handleCreatorShare(request, env, tournamentId, "open");
      }
      if (request.method === "POST" && tournamentRoute[2] === "close-share") {
        return handleCreatorShare(request, env, tournamentId, "close");
      }
      if (request.method === "POST" && tournamentRoute[2] === "reset-share-link") {
        return handleCreatorShare(request, env, tournamentId, "reset");
      }
    }

    const publicShareRoute = url.pathname.match(/^\/api\/share\/([^/]+)$/);
    if (request.method === "GET" && publicShareRoute) {
      try {
        return json(await getPublicShare(env.DB, decodeURIComponent(publicShareRoute[1] ?? "")));
      } catch (error) {
        return shareErrorResponse(error);
      }
    }

    return json({ error: { code: "not_found", message: "接口不存在" } }, 404);
  },
  async queue(batch: MessageBatch<AppEvent>, env: Env): Promise<void> {
    await consumeAppEvents(env.DB, batch);
  },
} satisfies ExportedHandler<Env, AppEvent>;

async function handleResolvePlaylist(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  try {
    const body = await request.json<ResolveBody>();
    if (typeof body.url !== "string") {
      throw new PlaylistUrlError();
    }

    const parsed = parsePlaylistReference(body.url);
    const featureFlag = parsed.platform === "qq_music" ? "qq_import" : "netease_import";
    if (!await featureEnabled(env.DB, featureFlag)) return featureDisabled();
    const snapshotId = crypto.randomUUID();
    const importedAt = new Date().toISOString();
    const playlistId = parsed.playlistId ?? await resolveNeteaseShortPlaylistId(parsed.shortUrl);
    const snapshot = parsed.platform === "qq_music"
      ? await resolveQqPlaylist(parsed.playlistId, snapshotId, importedAt)
      : await resolveNeteasePlaylist(playlistId, snapshotId, importedAt);
    await savePlaylistSnapshot(env.DB, snapshot);
    ctx.waitUntil(env.EVENT_QUEUE.send(appEvent("playlist_imported", snapshot.id, {
      songCount: snapshot.songs.length,
      platform: snapshot.platform,
    })));

    return json({ snapshot }, 201);
  } catch (error) {
    if (error instanceof PlaylistUrlError) {
      return json({ error: { code: "invalid_playlist_url", message: error.message } }, 400);
    }

    const message = error instanceof Error ? error.message : "歌单解析失败";
    return json({ error: { code: "playlist_resolve_failed", message } }, 502);
  }
}

async function handlePromoteBrowserSnapshot(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  try {
    const body = await request.json<{ snapshot?: unknown }>();
    const snapshot = await promoteBrowserSnapshot(env.DB, body.snapshot);
    ctx.waitUntil(env.EVENT_QUEUE.send(appEvent("playlist_imported", snapshot.id, {
      songCount: snapshot.songs.length,
      platform: snapshot.platform,
      source: "browser_fallback",
    })));
    return json({ snapshot }, 201);
  } catch (error) {
    if (error instanceof BrowserSnapshotValidationError) {
      return json({ error: { code: "invalid_browser_snapshot", message: error.message } }, 400);
    }
    return json({ error: { code: "browser_snapshot_failed", message: error instanceof Error ? error.message : "浏览器快照保存失败" } }, 500);
  }
}

async function handleCreateDraft(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json<CreateDraftInput>();
    return json(await createCloudDraft(env.DB, body), 201);
  } catch (error) {
    return draftErrorResponse(error);
  }
}

async function handleGetDraft(request: Request, env: Env, draftId: string): Promise<Response> {
  try {
    return json(await getCloudDraft(env.DB, draftId, readDraftToken(request)));
  } catch (error) {
    return draftErrorResponse(error);
  }
}

async function handleRedrawDraft(request: Request, env: Env, draftId: string): Promise<Response> {
  try {
    const body = await request.json<RedrawDraftInput>();
    return json(await redrawCloudDraft(env.DB, draftId, readDraftToken(request), body));
  } catch (error) {
    return draftErrorResponse(error);
  }
}

async function handleStartTournament(request: Request, env: Env, draftId: string): Promise<Response> {
  try {
    return json(await startTournament(env.DB, draftId, readDraftToken(request)), 201);
  } catch (error) {
    return tournamentErrorResponse(error);
  }
}

async function handleGetTournament(request: Request, env: Env, tournamentId: string): Promise<Response> {
  try {
    return json(await getTournament(env.DB, tournamentId, readTournamentToken(request)));
  } catch (error) {
    return tournamentErrorResponse(error);
  }
}

async function handlePickTournament(request: Request, env: Env, tournamentId: string): Promise<Response> {
  try {
    const body = await request.json<PickTournamentInput>();
    const result = await callCoordinator<CoordinatorMutationResult>(env, tournamentId, {
      action: "pick",
      deviceId: readDeviceId(request),
      tournamentId,
      token: readTournamentToken(request),
      input: body,
    });
    return coordinatorMutationResponse(result);
  } catch (error) {
    return tournamentErrorResponse(error);
  }
}

async function handleTournamentEvents(request: Request, env: Env, tournamentId: string): Promise<Response> {
  try {
    const body = await request.json<SyncTournamentEventsInput>();
    const result = await callCoordinator<CoordinatorMutationResult>(env, tournamentId, {
      action: "events",
      deviceId: readDeviceId(request),
      tournamentId,
      token: readTournamentToken(request),
      input: body,
    });
    return coordinatorMutationResponse(result);
  } catch (error) {
    return tournamentErrorResponse(error);
  }
}

async function handleLockRound(request: Request, env: Env, tournamentId: string): Promise<Response> {
  try {
    const body = await request.json<LockRoundInput>();
    const result = await callCoordinator<CoordinatorMutationResult>(env, tournamentId, {
      action: "lockRound",
      deviceId: readDeviceId(request),
      tournamentId,
      token: readTournamentToken(request),
      input: body,
    });
    return coordinatorMutationResponse(result);
  } catch (error) {
    return tournamentErrorResponse(error);
  }
}

async function handleLease(
  request: Request,
  env: Env,
  tournamentId: string,
  takeover: boolean,
): Promise<Response> {
  try {
    const token = readTournamentToken(request);
    await getTournament(env.DB, tournamentId, token);
    const result = await callCoordinator<CoordinatorLeaseResult>(env, tournamentId, {
      action: takeover ? "takeover" : "acquire",
      deviceId: readDeviceId(request),
    });
    if (!result.ok) {
      return json({ error: { code: result.code, message: result.message } }, result.status);
    }
    const { lease } = result;
    return lease.editable
      ? json({ lease })
      : json({ error: { code: "edit_lease_required", message: "另一台设备持有赛事编辑权", lease } }, 409);
  } catch (error) {
    return tournamentErrorResponse(error);
  }
}

async function handleBranchTournament(
  request: Request,
  env: Env,
  tournamentId: string,
): Promise<Response> {
  try {
    const body = await request.json<BranchTournamentInput>();
    return json(await branchTournament(
      env.DB,
      tournamentId,
      readTournamentToken(request),
      body,
    ), 201);
  } catch (error) {
    return tournamentErrorResponse(error);
  }
}

async function handleCreatorShare(
  request: Request,
  env: Env,
  tournamentId: string,
  action: "status" | "open" | "close" | "reset",
): Promise<Response> {
  try {
    if ((action === "open" || action === "reset") && !await featureEnabled(env.DB, "post_match_share")) {
      return featureDisabled();
    }
    const token = readTournamentToken(request);
    const payload = action === "open"
      ? await openTournamentShare(env.DB, tournamentId, token)
      : action === "close"
        ? await closeTournamentShare(env.DB, tournamentId, token)
        : action === "reset"
          ? await resetTournamentShare(env.DB, tournamentId, token)
          : await getShareStatus(env.DB, tournamentId, token);
    return json(payload);
  } catch (error) {
    return shareErrorResponse(error);
  }
}

function readDraftToken(request: Request): string {
  return request.headers.get("X-Draft-Token") ?? "";
}

function readTournamentToken(request: Request): string {
  const sessionToken = request.headers.get("X-Session-Token");
  return sessionToken ? `session:${sessionToken}` : request.headers.get("X-Tournament-Token") ?? "";
}

function readSessionToken(request: Request): string {
  return request.headers.get("X-Session-Token") ?? "";
}

function readProvider(value: unknown): AuthProviderName {
  if (value !== "wechat" && value !== "qq") throw new AuthError("登录 Provider 无效", 400);
  return value;
}

function readDeviceId(request: Request): string {
  const deviceId = request.headers.get("X-Device-ID") ?? "";
  if (deviceId.length < 8 || deviceId.length > 100) {
    throw new TournamentValidationError("设备标识无效");
  }
  return deviceId;
}

function coordinator(env: Env, tournamentId: string) {
  return env.TOURNAMENT_COORDINATOR.getByName(tournamentId);
}

async function callCoordinator<T>(
  env: Env,
  tournamentId: string,
  body: unknown,
): Promise<T> {
  const response = await coordinator(env, tournamentId).fetch("https://coordinator.internal/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return response.json<T>();
}

function coordinatorMutationResponse(result: CoordinatorMutationResult): Response {
  return result.ok
    ? json({ ...result.payload, lease: result.lease })
    : json({ error: { code: result.code, message: result.message, lease: result.lease } }, result.status);
}

function draftErrorResponse(error: unknown): Response {
  if (error instanceof DraftValidationError || error instanceof RangeError) {
    return json({ error: { code: "invalid_draft", message: error.message } }, 400);
  }
  if (error instanceof DraftAccessError) {
    return json({ error: { code: "draft_not_found", message: error.message } }, 404);
  }
  if (error instanceof DraftConflictError || error instanceof DraftStartedError) {
    return json({ error: { code: "draft_conflict", message: error.message } }, 409);
  }
  const message = error instanceof Error ? error.message : "云端草稿操作失败";
  return json({ error: { code: "draft_operation_failed", message } }, 500);
}

function tournamentErrorResponse(error: unknown): Response {
  if (error instanceof DraftAccessError || error instanceof TournamentAccessError) {
    return json({ error: { code: "tournament_not_found", message: error.message } }, 404);
  }
  if (error instanceof TournamentValidationError || error instanceof RangeError) {
    return json({ error: { code: "invalid_tournament_operation", message: error.message } }, 400);
  }
  if (error instanceof TournamentConflictError) {
    return json({ error: { code: "tournament_conflict", message: error.message } }, 409);
  }
  const message = error instanceof Error ? error.message : "赛事操作失败";
  return json({ error: { code: "tournament_operation_failed", message } }, 500);
}

function shareErrorResponse(error: unknown): Response {
  if (error instanceof ShareAccessError) {
    return json({ error: { code: "share_not_found", message: error.message } }, 404);
  }
  if (error instanceof ShareValidationError) {
    return json({ error: { code: "invalid_share_operation", message: error.message } }, 400);
  }
  return tournamentErrorResponse(error);
}

function authErrorResponse(error: unknown): Response {
  if (error instanceof AuthError) {
    return json({ error: { code: "auth_error", message: error.message } }, error.status);
  }
  return tournamentErrorResponse(error);
}

function adminErrorResponse(error: unknown): Response {
  if (error instanceof AdminAccessError) {
    return json({ error: { code: "admin_error", message: error.message } }, error.status);
  }
  return json({ error: { code: "admin_operation_failed", message: error instanceof Error ? error.message : "后台操作失败" } }, 500);
}

function featureDisabled(): Response {
  return json({ error: { code: "feature_disabled", message: "该功能已由运营后台暂时关闭" } }, 503);
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

export { TournamentCoordinator };
