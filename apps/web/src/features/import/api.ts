import { normalizeQqPlaylist, parsePlaylistReference, parseQqPlaylistId, type PlaylistSnapshot } from "@song-world-cup/domain";
import { createUuid } from "../../app/id";
import { appPath } from "../../app/paths";

interface ResolvePlaylistResponse {
  snapshot: PlaylistSnapshot;
}

interface ErrorResponse {
  error?: {
    code?: string;
    message?: string;
  };
}

class ImportWithoutFallbackError extends Error {}

export async function resolvePlaylist(url: string): Promise<PlaylistSnapshot> {
  const parsed = parsePlaylistReference(url);
  let serverMessage = "服务端解析不可用";
  try {
    const response = await fetch(appPath("/api/playlists/resolve"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    if (response.ok) {
      const body = await response.json() as ResolvePlaylistResponse;
      return body.snapshot;
    }
    const body = await response.json().catch(() => ({})) as ErrorResponse;
    serverMessage = body.error?.message ?? serverMessage;
    if (body.error?.code === "feature_disabled" || response.status === 400) throw new ImportWithoutFallbackError(serverMessage);
  } catch (error) {
    if (error instanceof ImportWithoutFallbackError) throw error;
  }
  if (parsed.platform !== "qq_music") throw new Error(serverMessage);
  try {
    return await resolvePlaylistInBrowser(url);
  } catch (error) {
    const fallbackMessage = error instanceof Error ? error.message : "浏览器备用解析失败";
    throw new Error(`${serverMessage}；${fallbackMessage}`);
  }
}

export async function resolvePlaylistInBrowser(url: string): Promise<PlaylistSnapshot> {
  const playlistId = parseQqPlaylistId(url);
  const payload = await musicuJsonp(playlistId);
  return normalizeQqPlaylist(payload, {
    snapshotId: createUuid(),
    importedAt: new Date().toISOString(),
    storage: "local",
  });
}

export async function promoteBrowserSnapshot(snapshot: PlaylistSnapshot): Promise<PlaylistSnapshot> {
  const response = await fetch(appPath("/api/playlists/browser-snapshot"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ snapshot }),
  });
  const body = await response.json().catch(() => ({})) as ResolvePlaylistResponse | ErrorResponse;
  if (!response.ok) {
    const error = body as ErrorResponse;
    throw new Error(error.error?.message ?? "浏览器备用快照保存失败，请恢复联网后重试");
  }
  return (body as ResolvePlaylistResponse).snapshot;
}

function musicuJsonp(playlistId: string): Promise<unknown> {
  const callbackName = `songWorldCupJsonp_${createUuid().replaceAll("-", "")}`;
  const data = {
    comm: { ct: 24, cv: 0 },
    req_0: {
      module: "music.srfDissInfo.aiDissInfo",
      method: "uniform_get_Dissinfo",
      param: { disstid: Number(playlistId), song_begin: 0, song_num: 4096 },
    },
  };
  const endpoint = new URL("https://u.y.qq.com/cgi-bin/musicu.fcg");
  endpoint.searchParams.set("callback", callbackName);
  endpoint.searchParams.set("format", "jsonp");
  endpoint.searchParams.set("data", JSON.stringify(data));

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const timeout = window.setTimeout(() => finish(() => reject(new Error("浏览器备用解析超时"))), 15_000);
    const scope = window as unknown as Record<string, unknown>;
    const finish = (complete: () => void) => {
      window.clearTimeout(timeout);
      script.remove();
      delete scope[callbackName];
      complete();
    };
    scope[callbackName] = (payload: unknown) => finish(() => resolve(payload));
    script.onerror = () => finish(() => reject(new Error("浏览器无法连接 QQ 音乐备用接口")));
    script.src = endpoint.toString();
    script.async = true;
    script.referrerPolicy = "no-referrer";
    document.head.append(script);
  });
}
