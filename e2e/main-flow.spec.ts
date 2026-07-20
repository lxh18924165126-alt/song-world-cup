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
  const tournamentName = `移动端验收-${Date.now().toString(36)}`;
  let delayNextHeartbeat = false;
  let delayedHeartbeatStarted = false;
  let releaseDelayedHeartbeat = () => {};
  let blockResultSync = false;
  let failResultSync = false;
  let blockedResultSyncStarted = false;
  let releaseBlockedResultSync = () => {};
  let blockedResultSyncGate = Promise.resolve();

  await page.route("**/api/playlists/resolve", async (route) => {
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ snapshot: seededSnapshot }) });
  });
  await page.route("**/api/tournaments/*/heartbeat", async (route) => {
    if (delayNextHeartbeat) {
      delayNextHeartbeat = false;
      await new Promise<void>((resolve) => {
        delayedHeartbeatStarted = true;
        releaseDelayedHeartbeat = resolve;
      });
    }
    await route.continue();
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
  await expect(page.getByText("当前设备拥有编辑权")).toBeVisible();
  await expect(page.locator(".play-match")).toHaveCount(4);
  await expect(page.locator(".play-heading")).toContainText("左赛区");
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

  await chooseFirstSong(page, 1);
  await chooseFirstSong(page, 2);
  await chooseFirstSong(page, 3);
  await expect(page.getByText("2 / 2 页")).toBeVisible();
  await expect(page.locator(".play-heading")).toContainText("右赛区");
  await chooseAllVisibleMatches(page);
  await page.getByRole("button", { name: "锁定本轮并晋级" }).click();

  await expect(page.locator(".play-heading")).toContainText("第 2 轮");
  await expect(page.locator(".play-match")).toHaveCount(2);
  await chooseAllVisibleMatches(page);
  await expect(page.getByText("2 / 2 页")).toBeVisible();
  await chooseAllVisibleMatches(page);
  delayNextHeartbeat = true;
  await page.getByRole("button", { name: "锁定本轮并晋级" }).click();

  await expect(page).toHaveURL(/\/t\/[^/]+\/final#token=/);
  await expect.poll(() => delayedHeartbeatStarted).toBe(true);
  try {
    await expect(page.getByRole("heading", { name: "左赛区 · 半决赛" })).toBeVisible();
    await expect(page.getByText("正在恢复赛事进度…")).toHaveCount(0);
  } finally {
    releaseDelayedHeartbeat();
  }
  await chooseAllVisibleMatches(page);
  await expect(page.getByText("2 / 2 页")).toBeVisible();
  await chooseAllVisibleMatches(page);
  await page.getByRole("button", { name: "锁定半决赛并进入冠军之夜" }).click();

  await expect(page.getByRole("heading", { name: "中心球场 · 冠军之夜" })).toBeVisible();
  blockResultSync = true;
  failResultSync = true;
  blockedResultSyncGate = new Promise<void>((resolve) => {
    releaseBlockedResultSync = resolve;
  });
  await chooseAllVisibleMatches(page);
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
  await expect(page.getByText("云端进度已同步")).toBeVisible();

  await page.waitForTimeout(1_000);
  await page.getByRole("button", { name: "开放分享", exact: true }).click();
  await expect(page.getByRole("button", { name: "关闭分享" })).toBeVisible();

  const bracketDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载对阵图" }).click();
  await expect((await bracketDownload).suggestedFilename()).toMatch(/\.png$/);

  const posterDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载结果海报" }).click();
  await expect((await posterDownload).suggestedFilename()).toMatch(/\.png$/);

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
  await page.locator(".play-match").nth(matchIndex).locator("button.song-choice").first().click();
}

async function chooseAllVisibleMatches(page: Page) {
  const matches = page.locator(".play-match");
  const count = await matches.count();
  for (let index = 0; index < count; index += 1) {
    await matches.nth(index).locator("button.song-choice").first().click();
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
