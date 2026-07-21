import { expect, test, type Page, type Route } from "@playwright/test";

const seededSnapshot = {
  id: "e2e-snapshot",
  platform: "qq_music" as const,
  externalPlaylistId: "7052783065",
  title: "E2E 验收歌单",
  coverUrl: null,
  importedAt: "2026-07-20T00:00:00.000Z",
  storage: "cloud" as const,
  songs: Array.from({ length: 16 }, (_, index) => {
    const sequence = String(index + 1).padStart(2, "0");
    return {
      id: `e2e-song-${sequence}`,
      sourcePosition: index,
      sourceSongId: String(101 + index),
      sourceSongMid: `mid${sequence}`,
      title: `${index + 1} 号种子`,
      artists: [`测试歌手 ${String.fromCharCode(65 + index)}`],
      album: "验收专辑",
      durationSeconds: 201 + index,
      mediaUrl: `https://y.qq.com/n/ryqq/songDetail/mid${sequence}`,
      previewUrl: null,
    };
  }),
};

test("移动端从导入完成赛事，并验证离线、编辑权、分享与 PNG 导出", async ({ page, browser, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const tournamentName = `移动端验收-${Date.now().toString(36)}`;
  let blockResultSync = false;
  let failResultSync = false;
  let blockedResultSyncStarted = false;
  let releaseBlockedResultSync = () => {};
  let blockedResultSyncGate = Promise.resolve();

  await page.route("**/api/playlists/resolve", async (route) => {
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ snapshot: seededSnapshot }) });
  });
  const handleResultSync = async (route: Route) => {
    if (blockResultSync) {
      blockedResultSyncStarted = true;
      await blockedResultSyncGate;
    }
    if (failResultSync) {
      await route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "public_access_upstream_failed", message: "公网中转暂时无法连接生产服务" } }),
      });
      return;
    }
    await route.continue();
  };
  await page.route("**/api/tournaments/*/picks", handleResultSync);
  await page.route("**/api/tournaments/*/events", handleResultSync);

  await page.goto("/");
  await page.getByRole("textbox", { name: "QQ 音乐或网易云音乐公开歌单链接" }).fill("https://y.qq.com/n/ryqq/playlist/7052783065");
  await page.getByRole("button", { name: "解析歌单" }).click();
  await expect(page).toHaveURL(/\/import\/check$/);
  await expect(page.getByRole("heading", { name: "E2E 验收歌单" })).toBeVisible();
  await expect(page.getByText("已选择 16 / 16")).toBeVisible();

  await page.getByRole("button", { name: /进入赛事设置/ }).click();
  await expect(page).toHaveURL(/\/setup$/);
  await page.getByRole("textbox", { name: "赛事名称" }).fill(tournamentName);
  await page.getByRole("button", { name: /16 强/ }).click();
  await page.getByRole("button", { name: "进入抽签预览" }).click();
  await expect(page).toHaveURL(/\/draw-preview\//);
  await expect(page.getByText("16 强随机")).toBeVisible();

  await page.getByRole("button", { name: "正式开始" }).click();
  await expect(page).toHaveURL(/\/t\/[^/]+\/play#token=/);
  await expect(page.getByRole("link", { name: "返回歌曲世界杯首页" })).toBeVisible();
  await expect(page.getByText("当前设备拥有编辑权")).toBeVisible();
  await expect(page.locator('.canvas-match-node[data-active="true"]')).toHaveCount(4);
  await expect.poll(() => page.evaluate(() => {
    const viewport = document.querySelector(".tournament-canvas-viewport")!.getBoundingClientRect();
    const matches = [...document.querySelectorAll<HTMLElement>('.canvas-match-node[data-active="true"]')]
      .map((match) => match.getBoundingClientRect());
    const gap = Math.min(...matches.map((match) => match.top)) - viewport.top;
    return gap >= 16 && gap <= 24;
  })).toBe(true);
  const mobileCanvasLayout = await page.evaluate(() => {
    const viewport = document.querySelector(".tournament-canvas-viewport")!.getBoundingClientRect();
    const matches = [...document.querySelectorAll<HTMLElement>('.canvas-match-node[data-active="true"]')];
    const matchBounds = matches.map((match) => match.getBoundingClientRect());
    const songBounds = [...document.querySelectorAll<HTMLElement>('.canvas-match-node[data-active="true"] .play-song-card')]
      .map((card) => card.getBoundingClientRect());
    const promotionBounds = [...document.querySelectorAll<HTMLElement>(".promotion-node.highlighted")]
      .map((node) => node.getBoundingClientRect());
    return {
      topGap: Math.min(...matchBounds.map((match) => match.top)) - viewport.top,
      matchWidths: matchBounds.map((match) => match.width),
      songHeights: songBounds.map((song) => song.height),
      promotionCount: promotionBounds.length,
      clipped: [...matchBounds, ...promotionBounds].some((bounds) => bounds.left < 0 || bounds.right > innerWidth),
      outerBorder: getComputedStyle(matches[0]!).borderTopWidth,
    };
  });
  expect(mobileCanvasLayout.topGap).toBeGreaterThanOrEqual(16);
  expect(mobileCanvasLayout.topGap).toBeLessThanOrEqual(24);
  expect(Math.min(...mobileCanvasLayout.matchWidths)).toBeGreaterThanOrEqual(220);
  expect(Math.min(...mobileCanvasLayout.songHeights)).toBeGreaterThanOrEqual(44);
  expect(mobileCanvasLayout.promotionCount).toBe(2);
  expect(mobileCanvasLayout.clipped).toBe(false);
  expect(mobileCanvasLayout.outerBorder).toBe("0px");
  await expect(page.locator(".canvas-heading")).toContainText("左赛区");
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: tournamentName })).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  const recoveryUrl = page.url();
  const readonlyContext = await browser.newContext({ ...contextOptionsForMobile() });
  const readonlyPage = await readonlyContext.newPage();
  await readonlyPage.goto(recoveryUrl);
  await expect(readonlyPage.getByText("另一台设备正在编辑，本设备暂为只读")).toBeVisible();
  await readonlyContext.close();

  await context.setOffline(true);
  await chooseFirstSong(page, 0);
  await expect(page.getByText(/离线可继续比赛/)).toBeVisible();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: tournamentName })).toBeVisible();
  await expect(page.getByText(/离线可继续比赛/)).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText("云端进度已同步")).toBeVisible({ timeout: 15_000 });

  const leftCameraTransform = await page.locator(".bracket-camera").evaluate((element) => getComputedStyle(element).transform);
  await chooseFirstSong(page, 1);
  await chooseFirstSong(page, 2);
  await chooseFirstSong(page, 3);
  await expect(page.locator(".canvas-heading")).toContainText("右赛区");
  await expect.poll(() => page.locator(".bracket-camera").evaluate((element) => getComputedStyle(element).transform))
    .not.toBe(leftCameraTransform);
  await page.getByRole("button", { name: "上一组" }).click();
  await expect(page.locator(".canvas-heading")).toContainText("左赛区");
  const reviewButtons = page.locator('.canvas-match-node[data-active="true"]').first().locator("button.song-choice");
  const selectedReviewIndex = await reviewButtons.evaluateAll((buttons) => buttons.findIndex((button) => button.getAttribute("aria-pressed") === "true"));
  const reviewChoice = reviewButtons.nth(selectedReviewIndex);
  await reviewChoice.click();
  await expect(reviewChoice).toHaveAttribute("aria-pressed", "false");
  await reviewChoice.click();
  await expect(reviewChoice).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: /下一未完成/ }).click();
  await expect(page.locator(".canvas-heading")).toContainText("右赛区");
  await chooseAllVisibleMatches(page);
  await expect(page.getByRole("heading", { name: "本轮晋级席位已就绪" })).toBeVisible();
  await page.getByRole("button", { name: "锁定本轮并晋级" }).click();

  await expect(page.locator(".canvas-heading")).toContainText("第 2 轮");
  await expect(page.locator('.canvas-match-node[data-active="true"]')).toHaveCount(2);
  await chooseAllVisibleMatches(page);
  await expect(page.locator(".canvas-heading")).toContainText("右赛区");
  await chooseAllVisibleMatches(page);
  await expect(page.getByRole("heading", { name: "本轮晋级席位已就绪" })).toBeVisible();
  await page.getByRole("button", { name: "锁定本轮并晋级" }).click();

  await expect(page).toHaveURL(/\/t\/[^/]+\/play#token=/);
  await expect(page.locator(".canvas-heading")).toContainText("半决赛");
  await expect(page.locator(".canvas-heading")).toContainText("左赛区");
  await chooseAllVisibleMatches(page);
  await expect(page.locator(".canvas-heading")).toContainText("右赛区");
  await chooseAllVisibleMatches(page);
  await expect(page.getByRole("heading", { name: "本轮晋级席位已就绪" })).toBeVisible();
  await page.getByRole("button", { name: "锁定半决赛并进入冠军之夜" }).click();

  await expect(page.locator(".canvas-heading")).toContainText("冠军之夜");
  await expect(page.locator('.canvas-match-node[data-active="true"]')).toHaveCount(1);
  blockResultSync = true;
  failResultSync = true;
  blockedResultSyncGate = new Promise<void>((resolve) => {
    releaseBlockedResultSync = resolve;
  });
  await page.locator('.canvas-match-node[data-active="true"] button.song-choice').first().click();
  await expect(page).toHaveURL(/\/t\/[^/]+\/result#token=/);
  await expect.poll(() => blockedResultSyncStarted).toBe(true);
  try {
    await expect(page.getByText("比赛已结束")).toBeVisible();
  } finally {
    blockResultSync = false;
    releaseBlockedResultSync();
  }
  await expect(page.getByText("赛果已保存在本机，云端同步失败")).toBeVisible();
  failResultSync = false;
  await page.getByRole("button", { name: "重试云端同步" }).click();
  await expect(page.getByRole("button", { name: "开放分享", exact: true })).toBeEnabled();

  await page.waitForTimeout(1_000);
  const bracketDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载对阵图" }).click();
  await expect((await bracketDownload).suggestedFilename()).toMatch(/\.png$/);
  await expect(page.getByRole("button", { name: "关闭分享" })).toBeVisible();

  await expect(page.getByRole("button", { name: "下载结果海报" })).toHaveCount(0);

  await page.goto("/mine");
  await page.getByRole("textbox", { name: "输入演示昵称" }).fill("E2E 迁移用户");
  await page.getByRole("button", { name: "QQ 登录" }).click();
  await expect(page).toHaveURL(/\/mine\/migrate$/);
  await expect(page.getByRole("button", { name: new RegExp(tournamentName) })).toBeVisible();
  await page.getByRole("button", { name: "确认迁移" }).click();
  await expect(page).toHaveURL(/\/mine$/);
  await expect(page.getByRole("article").filter({ hasText: tournamentName }).getByText("已绑定账号")).toBeVisible();

  const revokedContext = await browser.newContext({ ...contextOptionsForMobile() });
  const revokedPage = await revokedContext.newPage();
  await revokedPage.goto(recoveryUrl);
  await expect(revokedPage.getByText(/失效|不可用/)).toBeVisible();
  await revokedContext.close();
});

test("4096 强画布保持虚拟渲染与即时选择反馈", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const payload = createLargeTournamentPayload();
  await page.addInitScript(() => {
    const metrics = globalThis as typeof globalThis & {
      __canvasLongTasks?: number[];
      __canvasFrameGaps?: number[];
    };
    metrics.__canvasLongTasks = [];
    metrics.__canvasFrameGaps = [];
    new PerformanceObserver((list) => {
      metrics.__canvasLongTasks?.push(...list.getEntries().map((entry) => entry.duration));
    }).observe({ type: "longtask", buffered: true });
  });
  await page.route("**/api/tournaments/perf-4096", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
  });
  await page.route("**/api/tournaments/perf-4096/heartbeat", async (route) => {
    const now = Date.now();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        lease: {
          editable: true,
          generation: 1,
          activeUntil: new Date(now + 30_000).toISOString(),
          protectUntil: new Date(now + 30_000).toISOString(),
          takeoverAllowedAt: null,
        },
      }),
    });
  });

  const navigationStartedAt = Date.now();
  await page.goto("/t/perf-4096/play#token=perf-token");
  await expect(page.locator('.canvas-match-node[data-active="true"]')).toHaveCount(4);
  expect(Date.now() - navigationStartedAt).toBeLessThan(5_000);
  expect(await page.locator(".canvas-match-node").count()).toBeLessThanOrEqual(12);
  expect(await page.locator("[data-world-node]").count()).toBeLessThanOrEqual(18);

  await page.setViewportSize({ width: 1329, height: 912 });
  await expect(page.locator('.canvas-match-node[data-active="true"]')).toHaveCount(8);
  await expect.poll(() => page.evaluate(() => {
    const viewport = document.querySelector(".tournament-canvas-viewport")!.getBoundingClientRect();
    const matches = [...document.querySelectorAll('.canvas-match-node[data-active="true"]')]
      .map((node) => node.getBoundingClientRect());
    return Math.min(...matches.map((match) => match.top)) >= viewport.top
      && Math.max(...matches.map((match) => match.bottom)) <= viewport.bottom;
  })).toBe(true);
  const wideBounds = await page.evaluate(() => {
    const viewport = document.querySelector(".tournament-canvas-viewport")!.getBoundingClientRect();
    const matches = [...document.querySelectorAll('.canvas-match-node[data-active="true"]')]
      .map((node) => node.getBoundingClientRect());
    return {
      viewportTop: viewport.top,
      viewportBottom: viewport.bottom,
      firstTop: Math.min(...matches.map((match) => match.top)),
      lastBottom: Math.max(...matches.map((match) => match.bottom)),
    };
  });
  expect(wideBounds.firstTop).toBeGreaterThanOrEqual(wideBounds.viewportTop);
  expect(wideBounds.lastBottom).toBeLessThanOrEqual(wideBounds.viewportBottom);
  const syncedIndicator = page.getByRole("status", { name: "云端进度已同步" });
  await expect(syncedIndicator).toBeVisible();
  const syncedSize = await syncedIndicator.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return { width: bounds.width, height: bounds.height };
  });
  expect(syncedSize.width).toBeLessThanOrEqual(26);
  expect(syncedSize.height).toBeLessThanOrEqual(26);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.canvas-match-node[data-active="true"]')).toHaveCount(4);

  await context.setOffline(true);
  await expect(page.getByText(/离线可继续比赛/)).toBeVisible();
  await page.evaluate(() => {
    const metrics = globalThis as typeof globalThis & {
      __canvasLongTasks?: number[];
      __canvasFrameGaps?: number[];
    };
    metrics.__canvasLongTasks = [];
    metrics.__canvasFrameGaps = [];
    let previous = performance.now();
    const collect = (time: number) => {
      metrics.__canvasFrameGaps?.push(time - previous);
      previous = time;
      if (metrics.__canvasFrameGaps && metrics.__canvasFrameGaps.length < 180) requestAnimationFrame(collect);
    };
    requestAnimationFrame(collect);
  });

  const firstChoice = page.locator('.canvas-match-node[data-active="true"] button.song-choice').first();
  const selectionLatency = await firstChoice.evaluate((button) => new Promise<number>((resolve, reject) => {
    const startedAt = performance.now();
    const timeout = window.setTimeout(() => reject(new Error("选择反馈超时")), 1_000);
    const observer = new MutationObserver(() => {
      if (button.getAttribute("aria-pressed") !== "true") return;
      window.clearTimeout(timeout);
      observer.disconnect();
      resolve(performance.now() - startedAt);
    });
    observer.observe(button, { attributes: true, attributeFilter: ["aria-pressed"] });
    (button as HTMLElement).click();
  }));
  expect(selectionLatency).toBeLessThan(100);

  for (let index = 1; index < 4; index += 1) await chooseFirstSong(page, index);
  await expect(page.locator(".canvas-heading")).toContainText("第 2 组");
  await expect(page.locator(".tournament-canvas-viewport")).not.toHaveClass(/camera-moving/);
  const runtimeMetrics = await page.evaluate(() => {
    const metrics = globalThis as typeof globalThis & {
      __canvasLongTasks?: number[];
      __canvasFrameGaps?: number[];
    };
    const frameGaps = [...(metrics.__canvasFrameGaps ?? [])].sort((first, second) => first - second);
    return {
      maxLongTask: Math.max(0, ...(metrics.__canvasLongTasks ?? [])),
      frameGapP95: frameGaps[Math.floor(frameGaps.length * 0.95)] ?? 0,
    };
  });
  expect(runtimeMetrics.maxLongTask).toBeLessThan(100);
  expect(runtimeMetrics.frameGapP95).toBeLessThan(35);
  await context.setOffline(false);
});

test("移动端大签表第二轮保持四场可操作并自动前往下一组", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const tournamentId = `mobile-round-two-${Date.now().toString(36)}`;
  const payload = createTournamentAtRoundPayload(tournamentId, 64, 1);
  await page.route(`**/api/tournaments/${tournamentId}`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
  });
  await page.route(`**/api/tournaments/${tournamentId}/heartbeat`, async (route) => {
    const now = Date.now();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        lease: {
          editable: true,
          generation: 1,
          activeUntil: new Date(now + 30_000).toISOString(),
          protectUntil: new Date(now + 30_000).toISOString(),
          takeoverAllowedAt: null,
        },
      }),
    });
  });

  await page.goto(`/t/${tournamentId}/play#token=mobile-round-two-token`);
  await expect(page.locator(".canvas-heading")).toContainText("第 1 组");
  await expect(page.locator('.canvas-match-node[data-active="true"]')).toHaveCount(4);
  await expect.poll(() => page.evaluate(() => {
    const viewport = document.querySelector(".tournament-canvas-viewport")!.getBoundingClientRect();
    const matches = [...document.querySelectorAll<HTMLElement>('.canvas-match-node[data-active="true"]')]
      .map((match) => match.getBoundingClientRect());
    return matches.length === 4
      && Math.min(...matches.map((match) => match.top)) - viewport.top >= 16
      && Math.max(...matches.map((match) => match.bottom)) <= viewport.bottom;
  })).toBe(true);
  await context.setOffline(true);
  await expect(page.getByText(/离线可继续比赛/)).toBeVisible();
  await chooseAllVisibleMatches(page);
  await expect(page.locator(".canvas-heading")).toContainText("第 2 组");
  await expect(page.locator(".tournament-canvas-viewport")).not.toHaveClass(/camera-moving/);
  await expect(page.locator('.canvas-match-node[data-active="true"]').first()).toHaveAttribute("data-world-node", "r2-m5");
  await context.setOffline(false);
});

test("移动端 64 强逐轮保持节点完整可见", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const expectedMatchCounts = [4, 4, 4, 2, 1, 1];
  const expectedLabels = ["64 进 32", "32 进 16", "16 进 8", "八强", "半决赛", "总决赛"];

  for (let roundIndex = 0; roundIndex < expectedMatchCounts.length; roundIndex += 1) {
    const tournamentId = `mobile-round-matrix-${roundIndex}-${Date.now().toString(36)}`;
    const payload = createTournamentAtRoundPayload(tournamentId, 64, roundIndex);
    await page.route(`**/api/tournaments/${tournamentId}`, async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
    });
    await page.route(`**/api/tournaments/${tournamentId}/heartbeat`, async (route) => {
      const now = Date.now();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          lease: {
            editable: true,
            generation: 1,
            activeUntil: new Date(now + 30_000).toISOString(),
            protectUntil: new Date(now + 30_000).toISOString(),
            takeoverAllowedAt: null,
          },
        }),
      });
    });

    await page.goto(`/t/${tournamentId}/play#token=mobile-round-matrix-token`);
    await expect(page.locator(".canvas-heading")).toContainText(expectedLabels[roundIndex]!);
    await expect(page.locator('.canvas-match-node[data-active="true"]')).toHaveCount(expectedMatchCounts[roundIndex]!);
    await expect.poll(() => page.evaluate(() => {
      const viewport = document.querySelector(".tournament-canvas-viewport")!.getBoundingClientRect();
      const nodes = [
        ...document.querySelectorAll<HTMLElement>('.canvas-match-node[data-active="true"]'),
        ...document.querySelectorAll<HTMLElement>(".promotion-node.highlighted"),
      ].map((node) => node.getBoundingClientRect());
      return nodes.length > 0 && nodes.every((node) => (
        node.left >= viewport.left - 1
        && node.right <= viewport.right + 1
        && node.top >= viewport.top - 1
        && node.bottom <= viewport.bottom + 1
      ));
    })).toBe(true);

    const matchTops = await page.locator('.canvas-match-node[data-active="true"]').evaluateAll((matches) => (
      matches.map((match) => match.getBoundingClientRect().top).sort((first, second) => first - second)
    ));
    if (matchTops.length > 1) {
      expect(Math.max(...matchTops.slice(1).map((top, index) => top - matchTops[index]!))).toBeLessThanOrEqual(128.5);
    }
  }
});

test("模拟登录、迁移页与最小运营后台可用", async ({ page }) => {
  await page.goto("/mine");
  await page.getByRole("textbox", { name: "输入演示昵称" }).fill("E2E 登录用户");
  await page.getByRole("button", { name: "QQ 登录" }).click();
  await expect(page).toHaveURL(/\/mine\/migrate$/);
  await expect(page.getByRole("heading", { name: "迁移摘要" })).toBeVisible();

  await page.goto("/admin");
  await page.getByRole("textbox", { name: "X-Admin-Token" }).fill("local-admin-token");
  await page.getByRole("button", { name: "进入后台" }).click();
  await expect(page.getByRole("heading", { name: "歌曲世界杯 · 运营后台" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "功能开关" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "最近审计日志" })).toBeVisible();
});

async function chooseFirstSong(page: Page, matchIndex: number) {
  const choice = page.locator('.canvas-match-node[data-active="true"]').nth(matchIndex).locator("button.song-choice").first();
  await choice.click();
  await expect(choice).toHaveAttribute("aria-pressed", "true");
}

async function chooseAllVisibleMatches(page: Page) {
  const matches = page.locator('.canvas-match-node[data-active="true"]');
  const count = await matches.count();
  for (let index = 0; index < count; index += 1) {
    const choice = matches.nth(index).locator("button.song-choice").first();
    await choice.click();
    await expect(choice).toHaveAttribute("aria-pressed", "true");
  }
}

function contextOptionsForMobile() {
  return {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  };
}

function createLargeTournamentPayload() {
  const songs = Array.from({ length: 4096 }, (_, index) => ({
    id: `perf-song-${index + 1}`,
    sourcePosition: index,
    sourceSongId: String(index + 1),
    sourceSongMid: `perf-mid-${index + 1}`,
    title: `性能歌曲 ${index + 1}`,
    artists: ["性能测试歌手"],
    album: "4096 强性能签表",
    durationSeconds: 180,
    mediaUrl: `https://y.qq.com/n/ryqq/songDetail/perf-mid-${index + 1}`,
    previewUrl: null,
  }));
  const matches = Array.from({ length: 2048 }, (_, index) => ({
    id: `r1-m${index + 1}`,
    roundIndex: 0,
    index,
    side: index < 1024 ? "left" as const : "right" as const,
    entrantAId: songs[index * 2]!.id,
    entrantBId: songs[index * 2 + 1]!.id,
    winnerId: null,
    status: "pending" as const,
  }));
  const timestamp = "2026-07-21T00:00:00.000Z";
  return {
    tournament: {
      id: "perf-4096",
      draftId: "perf-draft",
      snapshotId: "perf-snapshot",
      name: "4096 强画布性能验收",
      progress: {
        bracketSize: 4096,
        currentRoundIndex: 0,
        rounds: [{ index: 0, matches, locked: false }],
        status: "in_progress" as const,
        championId: null,
      },
      version: 1,
      lastEventSequence: 0,
      startedAt: timestamp,
      updatedAt: timestamp,
      completedAt: null,
    },
    songs,
  };
}

function createTournamentAtRoundPayload(tournamentId: string, bracketSize: number, currentRoundIndex: number) {
  const songs = Array.from({ length: bracketSize }, (_, index) => ({
    id: `${tournamentId}-song-${index + 1}`,
    sourcePosition: index,
    sourceSongId: String(index + 1),
    sourceSongMid: `${tournamentId}-mid-${index + 1}`,
    title: `第 ${currentRoundIndex + 1} 轮测试歌曲 ${index + 1}`,
    artists: ["移动端回归歌手"],
    album: "移动端全轮次回归",
    durationSeconds: 180,
    mediaUrl: `https://y.qq.com/n/ryqq/songDetail/${tournamentId}-mid-${index + 1}`,
    previewUrl: null,
  }));
  const rounds = [];
  let entrants = songs.map((song) => song.id);
  for (let roundIndex = 0; roundIndex <= currentRoundIndex; roundIndex += 1) {
    const matchCount = entrants.length / 2;
    const isCurrentRound = roundIndex === currentRoundIndex;
    const matches = Array.from({ length: matchCount }, (_, index) => ({
      id: `r${roundIndex + 1}-m${index + 1}`,
      roundIndex,
      index,
      side: matchCount === 1 ? "final" as const : index < matchCount / 2 ? "left" as const : "right" as const,
      entrantAId: entrants[index * 2]!,
      entrantBId: entrants[index * 2 + 1]!,
      winnerId: isCurrentRound ? null : entrants[index * 2]!,
      status: isCurrentRound ? "pending" as const : "completed" as const,
    }));
    rounds.push({ index: roundIndex, matches, locked: !isCurrentRound });
    entrants = matches.map((match) => match.entrantAId);
  }
  const timestamp = "2026-07-21T00:00:00.000Z";
  return {
    tournament: {
      id: tournamentId,
      draftId: `${tournamentId}-draft`,
      snapshotId: `${tournamentId}-snapshot`,
      name: `移动端第 ${currentRoundIndex + 1} 轮回归`,
      progress: {
        bracketSize,
        currentRoundIndex,
        rounds,
        status: "in_progress" as const,
        championId: null,
      },
      version: 1,
      lastEventSequence: 0,
      startedAt: timestamp,
      updatedAt: timestamp,
      completedAt: null,
    },
    songs,
  };
}
