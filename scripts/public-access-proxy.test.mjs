import assert from "node:assert/strict";
import http from "node:http";
import { after, before, test } from "node:test";
import * as publicAccessProxy from "./public-access-proxy.mjs";

const { createPublicAccessProxy, createRecoveringFetch } = publicAccessProxy;

let upstreamServer;
let proxyServer;
let upstreamOrigin;
let proxyOrigin;

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test("安全请求在网络错误后重建连接池并重试", async () => {
  assert.equal(typeof createRecoveringFetch, "function");

  const closedDispatchers = [];
  const dispatchers = [
    { id: "first", close: async () => closedDispatchers.push("first") },
    { id: "second", close: async () => closedDispatchers.push("second") },
  ];
  const usedDispatchers = [];
  let nextDispatcher = 0;
  const recoveringFetch = createRecoveringFetch({
    createDispatcher: () => dispatchers[nextDispatcher++],
    fetchImpl: async (_input, init) => {
      usedDispatchers.push(init.dispatcher.id);
      if (usedDispatchers.length === 1) throw new TypeError("fetch failed");
      return new Response("ok", { status: 200 });
    },
  });

  const response = await recoveringFetch("https://upstream.example.test/health", { method: "GET" });

  assert.equal(response.status, 200);
  assert.deepEqual(usedDispatchers, ["first", "second"]);
  assert.deepEqual(closedDispatchers, ["first"]);
  await recoveringFetch.close();
  assert.deepEqual(closedDispatchers, ["first", "second"]);
});

test("写请求失败时重建连接池但不自动重放请求体", async () => {
  assert.equal(typeof createRecoveringFetch, "function");

  const closedDispatchers = [];
  const dispatchers = [
    { id: "first", close: async () => closedDispatchers.push("first") },
    { id: "second", close: async () => closedDispatchers.push("second") },
  ];
  const usedDispatchers = [];
  let nextDispatcher = 0;
  const recoveringFetch = createRecoveringFetch({
    createDispatcher: () => dispatchers[nextDispatcher++],
    fetchImpl: async (_input, init) => {
      usedDispatchers.push(init.dispatcher.id);
      throw new TypeError("fetch failed");
    },
  });

  await assert.rejects(
    recoveringFetch("https://upstream.example.test/tournaments", {
      method: "POST",
      body: JSON.stringify({ name: "test" }),
    }),
    /fetch failed/,
  );

  assert.deepEqual(usedDispatchers, ["first"]);
  assert.deepEqual(closedDispatchers, ["first"]);
  await recoveringFetch.close();
  assert.deepEqual(closedDispatchers, ["first", "second"]);
});

before(async () => {
  upstreamServer = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://upstream.internal");
    if (url.pathname === "/api/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (url.pathname === "/redirect") {
      response.writeHead(302, { location: `${upstreamOrigin}/destination?from=upstream` });
      response.end();
      return;
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      method: request.method,
      path: url.pathname,
      query: url.search,
      body: Buffer.concat(chunks).toString("utf8"),
      customHeader: request.headers["x-custom-header"],
      host: request.headers.host,
    }));
  });
  upstreamOrigin = await listen(upstreamServer);
  proxyServer = createPublicAccessProxy({ upstreamOrigin, bootId: "test-boot-id" });
  proxyOrigin = await listen(proxyServer);
});

after(async () => {
  await Promise.all([close(proxyServer), close(upstreamServer)]);
});

test("健康检查同时确认代理实例和生产上游", async () => {
  const response = await fetch(`${proxyOrigin}/__public-access/health`);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.bootId, "test-boot-id");
  assert.equal(payload.upstream.ok, true);
  assert.equal(payload.upstream.status, 200);
  assert.equal(Number.isInteger(payload.upstream.latencyMs), true);
  assert.equal(payload.upstream.latencyMs >= 0, true);
});

test("透明转发方法、查询参数、请求头和请求体", async () => {
  const response = await fetch(`${proxyOrigin}/api/echo?round=16`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-custom-header": "preserved",
    },
    body: JSON.stringify({ winner: "song-a" }),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-song-world-cup-relay"), "public-access");
  assert.deepEqual(await response.json(), {
    method: "POST",
    path: "/api/echo",
    query: "?round=16",
    body: JSON.stringify({ winner: "song-a" }),
    customHeader: "preserved",
    host: new URL(upstreamOrigin).host,
  });
});

test("把生产站绝对重定向改写到公网中转 origin", async () => {
  const response = await fetch(`${proxyOrigin}/redirect`, {
    headers: {
      host: "relay.example.test",
      "x-forwarded-host": "relay.example.test",
      "x-forwarded-proto": "https",
    },
    redirect: "manual",
  });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "https://relay.example.test/destination?from=upstream");
});
