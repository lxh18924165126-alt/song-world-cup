import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PUBLIC_ACCESS_LAUNCH_AGENT_LABEL = "com.baituola.song-world-cup-public-access";

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function renderLaunchAgentPlist({
  projectRoot,
  nodeBin,
  label = PUBLIC_ACCESS_LAUNCH_AGENT_LABEL,
}) {
  const stateDirectory = path.join(projectRoot, ".public-access");
  const startScript = path.join(projectRoot, "scripts", "start-public.sh");
  const launchLog = path.join(stateDirectory, "launch-agent.log");
  const values = {
    label: escapeXml(label),
    projectRoot: escapeXml(projectRoot),
    startScript: escapeXml(startScript),
    launchLog: escapeXml(launchLog),
    nodeBin: escapeXml(nodeBin),
  };
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${values.label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${values.startScript}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${values.projectRoot}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>CODEX_NODE_BIN</key>
    <string>${values.nodeBin}</string>
    <key>PATH</key>
    <string>/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin</string>
  </dict>
  <key>RunAtLoad</key>
  <false/>
  <key>KeepAlive</key>
  <false/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${values.launchLog}</string>
  <key>StandardErrorPath</key>
  <string>${values.launchLog}</string>
</dict>
</plist>
`;
}

function run(command, args, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (!allowFailure && result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`${command} ${args.join(" ")} 执行失败${details ? `：${details}` : ""}`);
  }
  return result;
}

function blockingSleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

export function waitForLaunchAgentRemoval({
  isLoaded,
  sleep = blockingSleep,
  attempts = 50,
  delayMs = 100,
}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (!isLoaded()) return;
    if (attempt < attempts - 1) sleep(delayMs);
  }
  throw new Error("旧公网 LaunchAgent 未能在重新安装前完全退出");
}

function install() {
  if (process.platform !== "darwin") throw new Error("公网后台服务安装仅支持 macOS");
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.dirname(scriptDirectory);
  const stateDirectory = path.join(projectRoot, ".public-access");
  const launchAgentsDirectory = path.join(os.homedir(), "Library", "LaunchAgents");
  const plistPath = path.join(launchAgentsDirectory, `${PUBLIC_ACCESS_LAUNCH_AGENT_LABEL}.plist`);
  const domain = `gui/${process.getuid()}`;
  const target = `${domain}/${PUBLIC_ACCESS_LAUNCH_AGENT_LABEL}`;

  fs.mkdirSync(stateDirectory, { recursive: true });
  fs.mkdirSync(launchAgentsDirectory, { recursive: true });
  run("launchctl", ["bootout", target], { allowFailure: true });
  waitForLaunchAgentRemoval({
    isLoaded: () => spawnSync("launchctl", ["print", target]).status === 0,
  });
  fs.writeFileSync(plistPath, renderLaunchAgentPlist({
    projectRoot,
    nodeBin: process.execPath,
  }), { mode: 0o644 });
  run("plutil", ["-lint", plistPath]);
  run("launchctl", ["bootstrap", domain, plistPath]);
  run("launchctl", ["enable", target]);

  process.stdout.write(`PUBLIC_ACCESS_SERVICE_LABEL=${PUBLIC_ACCESS_LAUNCH_AGENT_LABEL}\n`);
  process.stdout.write(`PUBLIC_ACCESS_SERVICE_PLIST=${plistPath}\n`);
  process.stdout.write(`PUBLIC_ACCESS_SERVICE_TARGET=${target}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    install();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  }
}
