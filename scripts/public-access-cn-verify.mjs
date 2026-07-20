import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const GLOBALPING_API = "https://api.globalping.io/v1";

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function successfulResult(result, kind, expectedBootId) {
  if (result?.result?.status !== "finished" || result.result.statusCode !== 200) return false;
  if (kind === "page") return result.result.rawBody?.includes("<title>歌曲世界杯</title>") === true;
  try {
    const payload = JSON.parse(result.result.rawBody ?? "null");
    return payload?.ok === true && payload?.bootId === expectedBootId && payload?.upstream?.ok === true;
  } catch {
    return false;
  }
}

export function assessChinaMeasurement(measurement, kind, expectedBootId, minimumSuccessfulProbes = 2) {
  const results = measurement?.results ?? [];
  const probes = results.map((entry) => ({
    country: entry.probe?.country ?? null,
    city: entry.probe?.city ?? null,
    network: entry.probe?.network ?? null,
    asn: entry.probe?.asn ?? null,
    statusCode: entry.result?.statusCode ?? null,
    status: entry.result?.status ?? null,
    totalMs: entry.result?.timings?.total ?? null,
    rawOutput: entry.result?.status === "failed" ? entry.result?.rawOutput ?? null : null,
    verified: successfulResult(entry, kind, expectedBootId),
  }));
  const successful = probes.filter((probe) => probe.country === "CN" && probe.verified);
  const distinctCities = new Set(successful.map((probe) => probe.city).filter(Boolean));
  return {
    ok: measurement?.status === "finished"
      && successful.length >= minimumSuccessfulProbes
      && distinctCities.size >= 2,
    measurementId: measurement?.id ?? null,
    successfulProbes: successful.length,
    distinctCities: [...distinctCities],
    probes,
  };
}

async function createMeasurement(publicUrl, requestPath, limit) {
  const response = await fetch(`${GLOBALPING_API}/measurements`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      target: publicUrl.hostname,
      type: "http",
      locations: [{ country: "CN", limit }],
      measurementOptions: {
        protocol: "HTTPS",
        port: 443,
        request: {
          method: "GET",
          path: requestPath,
          headers: { "X-Pinggy-No-Screen": "1" },
        },
      },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json();
  if (!response.ok || typeof payload.id !== "string") {
    throw new Error(`Globalping 创建测量失败：${JSON.stringify(payload)}`);
  }
  return payload.id;
}

async function waitForMeasurement(measurementId) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await fetch(`${GLOBALPING_API}/measurements/${measurementId}`, {
      signal: AbortSignal.timeout(20_000),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(`Globalping 读取测量失败：${JSON.stringify(payload)}`);
    if (payload.status !== "in-progress") return payload;
    await sleep(2_000);
  }
  throw new Error(`Globalping 测量超时：${measurementId}`);
}

function readRequiredFile(filePath, label) {
  try {
    const value = fs.readFileSync(filePath, "utf8").trim();
    if (value) return value;
  } catch {
    // The actionable error below includes the exact missing state label.
  }
  throw new Error(`缺少${label}：${filePath}`);
}

async function main() {
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.dirname(scriptDirectory);
  const stateDirectory = process.env.PUBLIC_ACCESS_STATE_DIR ?? path.join(projectRoot, ".public-access");
  const publicUrl = new URL(process.env.PUBLIC_URL
    ?? readRequiredFile(path.join(stateDirectory, "public-url.txt"), "公网 URL"));
  const bootId = process.env.PUBLIC_BOOT_ID
    ?? readRequiredFile(path.join(stateDirectory, "boot-id.txt"), "启动标识");
  const probeLimit = Number.parseInt(process.env.CHINA_PROBE_LIMIT ?? "5", 10);
  const minimumSuccessfulProbes = Number.parseInt(process.env.CHINA_MIN_SUCCESS ?? "2", 10);
  if (!Number.isInteger(probeLimit) || probeLimit < 2 || probeLimit > 20) throw new Error("CHINA_PROBE_LIMIT 必须是 2～20");
  if (!Number.isInteger(minimumSuccessfulProbes) || minimumSuccessfulProbes < 2 || minimumSuccessfulProbes > probeLimit) {
    throw new Error("CHINA_MIN_SUCCESS 必须在 2 和 CHINA_PROBE_LIMIT 之间");
  }

  const healthMeasurementId = await createMeasurement(publicUrl, "/__public-access/health", probeLimit);
  const healthMeasurement = await waitForMeasurement(healthMeasurementId);
  const health = assessChinaMeasurement(healthMeasurement, "health", bootId, minimumSuccessfulProbes);

  const pageMeasurementId = await createMeasurement(publicUrl, "/", probeLimit);
  const pageMeasurement = await waitForMeasurement(pageMeasurementId);
  const page = assessChinaMeasurement(pageMeasurement, "page", bootId, minimumSuccessfulProbes);

  const report = {
    verifiedAt: new Date().toISOString(),
    publicUrl: publicUrl.origin,
    bootId,
    criteria: {
      country: "CN",
      probeLimit,
      minimumSuccessfulProbes,
      minimumDistinctCities: 2,
    },
    health,
    page,
    ok: health.ok && page.ok,
  };
  fs.writeFileSync(path.join(stateDirectory, "cn-verification.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });

  process.stdout.write(`中国大陆公网验证：${report.ok ? "通过" : "未通过"}\n`);
  process.stdout.write(`访问地址：${report.publicUrl}\n`);
  process.stdout.write(`健康检查：${health.successfulProbes} 个节点成功（${health.distinctCities.join("、") || "无"}）\n`);
  process.stdout.write(`页面检查：${page.successfulProbes} 个节点成功（${page.distinctCities.join("、") || "无"}）\n`);
  process.stdout.write(`健康测量：https://globalping.io?measurement=${health.measurementId}\n`);
  process.stdout.write(`页面测量：https://globalping.io?measurement=${page.measurementId}\n`);
  if (!report.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  });
}

