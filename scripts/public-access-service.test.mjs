import assert from "node:assert/strict";
import { test } from "node:test";
import * as publicAccessService from "./public-access-service.mjs";

const { renderLaunchAgentPlist } = publicAccessService;

test("LaunchAgent 固定项目入口、Node 路径且不在退出后自动换址", () => {
  const plist = renderLaunchAgentPlist({
    projectRoot: "/tmp/song & world-cup",
    nodeBin: "/tmp/node<24>",
  });
  assert.match(plist, /com\.baituola\.song-world-cup-public-access/);
  assert.match(plist, /\/tmp\/song &amp; world-cup\/scripts\/start-public\.sh/);
  assert.match(plist, /\/tmp\/node&lt;24&gt;/);
  assert.match(plist, /<key>RunAtLoad<\/key>\s*<false\/>/);
  assert.match(plist, /<key>KeepAlive<\/key>\s*<false\/>/);
});

test("卸载后等待 LaunchAgent 完全消失再继续安装", () => {
  assert.equal(typeof publicAccessService.waitForLaunchAgentRemoval, "function");
  const loadedStates = [true, true, false];
  const delays = [];
  publicAccessService.waitForLaunchAgentRemoval({
    isLoaded: () => loadedStates.shift() ?? false,
    sleep: (milliseconds) => delays.push(milliseconds),
    attempts: 3,
    delayMs: 25,
  });
  assert.deepEqual(delays, [25, 25]);
});
