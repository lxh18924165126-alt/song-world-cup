import http from "node:http";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";

const DEFAULT_UPSTREAM_ORIGIN = "https://song-world-cup.baituola-song-world-cup.workers.dev";
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function jsonResponse(response, body, status = 200) {
  const payload = Buffer.from(JSON.stringify(body));
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-length": String(payload.length),
    "content-type": "application/json; charset=utf-8",
  });
  response.end(payload);
}

function requestHeaders(request) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined || HOP_BY_HOP_HEADERS.has(name.toLowerCase())) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else {
      headers.set(name, value);
    }
  }

  // Node fetch transparently decompresses upstream responses. Asking for identity
  // keeps the response headers and streamed body consistent for the downstream client.
  headers.set("accept-encoding", "identity");
  return headers;
}

function publicOrigin(request) {
  const forwardedProto = request.headers["x-forwarded-proto"]?.split(",", 1)[0]?.trim();
  const forwardedHost = request.headers["x-forwarded-host"]?.split(",", 1)[0]?.trim();
  const protocol = forwardedProto || (request.socket.encrypted ? "https" : "http");
  const host = forwardedHost || request.headers.host;
  return host ? `${protocol}://${host}` : null;
}

function responseHeaders(upstreamResponse, request, upstreamOrigin) {
  const headers = new Headers();
  for (const [name, value] of upstreamResponse.headers) {
    const lowerName = name.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lowerName) || lowerName === "content-encoding") continue;
    headers.append(name, value);
  }

  const location = upstreamResponse.headers.get("location");
  const downstreamOrigin = publicOrigin(request);
  if (location && downstreamOrigin) {
    try {
      const absoluteLocation = new URL(location, upstreamOrigin);
      if (absoluteLocation.origin === upstreamOrigin) {
        headers.set("location", `${downstreamOrigin}${absoluteLocation.pathname}${absoluteLocation.search}${absoluteLocation.hash}`);
      }
    } catch {
      // Preserve an invalid/opaque Location exactly as returned by the upstream.
    }
  }

  headers.set("x-song-world-cup-relay", "public-access");
  return Object.fromEntries(headers.entries());
}

async function upstreamHealth(fetchImpl, upstreamOrigin) {
  const startedAt = performance.now();
  const response = await fetchImpl(new URL("/api/health", upstreamOrigin), {
    headers: { accept: "application/json" },
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  });
  const payload = await response.json().catch(() => null);
  return {
    ok: response.ok && payload?.status === "ok",
    status: response.status,
    latencyMs: Math.round(performance.now() - startedAt),
  };
}

export function createPublicAccessProxy({
  upstreamOrigin = DEFAULT_UPSTREAM_ORIGIN,
  bootId,
  fetchImpl = fetch,
  logger = console,
} = {}) {
  if (!bootId) throw new Error("PUBLIC_BOOT_ID 不能为空");
  const upstream = new URL(upstreamOrigin);
  if (!/^https?:$/.test(upstream.protocol)) throw new Error("UPSTREAM_ORIGIN 必须是 HTTP(S) 地址");
  upstream.pathname = "/";
  upstream.search = "";
  upstream.hash = "";
  const normalizedUpstreamOrigin = upstream.origin;

  const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://relay.internal");

    if (request.method === "GET" && requestUrl.pathname === "/__public-access/health") {
      try {
        const upstreamResult = await upstreamHealth(fetchImpl, normalizedUpstreamOrigin);
        jsonResponse(response, {
          ok: upstreamResult.ok,
          bootId,
          upstream: upstreamResult,
        }, upstreamResult.ok ? 200 : 502);
      } catch (error) {
        jsonResponse(response, {
          ok: false,
          bootId,
          upstream: {
            ok: false,
            error: error instanceof Error ? error.message : "上游健康检查失败",
          },
        }, 502);
      }
      return;
    }

    const target = new URL(`${requestUrl.pathname}${requestUrl.search}`, normalizedUpstreamOrigin);
    const abortController = new AbortController();
    response.on("close", () => {
      if (!response.writableEnded) abortController.abort();
    });

    try {
      const hasBody = request.method !== "GET" && request.method !== "HEAD";
      const upstreamResponse = await fetchImpl(target, {
        method: request.method,
        headers: requestHeaders(request),
        body: hasBody ? request : undefined,
        duplex: hasBody ? "half" : undefined,
        redirect: "manual",
        signal: abortController.signal,
      });

      response.writeHead(
        upstreamResponse.status,
        upstreamResponse.statusText,
        responseHeaders(upstreamResponse, request, normalizedUpstreamOrigin),
      );

      if (request.method === "HEAD" || !upstreamResponse.body) {
        response.end();
        return;
      }

      Readable.fromWeb(upstreamResponse.body).pipe(response);
    } catch (error) {
      if (response.destroyed || abortController.signal.aborted) return;
      logger.error("[public-access] 上游代理失败", {
        method: request.method,
        path: requestUrl.pathname,
        error: error instanceof Error ? error.message : String(error),
      });
      jsonResponse(response, {
        error: {
          code: "public_access_upstream_failed",
          message: "公网中转暂时无法连接生产服务",
        },
      }, 502);
    }
  });

  server.headersTimeout = 65_000;
  server.requestTimeout = 120_000;
  server.keepAliveTimeout = 10_000;
  return server;
}

async function main() {
  const host = process.env.PUBLIC_PROXY_HOST ?? "127.0.0.1";
  const port = Number.parseInt(process.env.PUBLIC_PROXY_PORT ?? "8790", 10);
  const bootId = process.env.PUBLIC_BOOT_ID;
  const upstreamOrigin = process.env.UPSTREAM_ORIGIN ?? DEFAULT_UPSTREAM_ORIGIN;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("PUBLIC_PROXY_PORT 无效");

  const server = createPublicAccessProxy({ upstreamOrigin, bootId });
  const shutdown = () => server.close(() => process.exit(0));
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  server.listen(port, host, () => {
    process.stdout.write(`PUBLIC_PROXY_READY ${JSON.stringify({ host, port, bootId, upstreamOrigin })}\n`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  });
}
