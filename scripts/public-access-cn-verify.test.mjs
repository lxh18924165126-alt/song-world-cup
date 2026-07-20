import assert from "node:assert/strict";
import { test } from "node:test";
import { assessChinaMeasurement } from "./public-access-cn-verify.mjs";

function result(city, rawBody, statusCode = 200) {
  return {
    probe: { country: "CN", city, network: "Test Network", asn: 64512 },
    result: {
      status: statusCode === 200 ? "finished" : "failed",
      statusCode: statusCode === 200 ? statusCode : null,
      rawBody: statusCode === 200 ? rawBody : null,
      rawOutput: statusCode === 200 ? null : "DNS failed",
      timings: { total: statusCode === 200 ? 800 : null },
    },
  };
}

test("至少两个不同大陆城市返回匹配 bootId 才通过健康验证", () => {
  const body = JSON.stringify({ ok: true, bootId: "boot-1", upstream: { ok: true } });
  const assessment = assessChinaMeasurement({
    id: "measurement-1",
    status: "finished",
    results: [result("天津", body), result("广州", body), result("深圳", "", 500)],
  }, "health", "boot-1", 2);
  assert.equal(assessment.ok, true);
  assert.equal(assessment.successfulProbes, 2);
  assert.deepEqual(assessment.distinctCities, ["天津", "广州"]);
});

test("错误 bootId 或只有一个城市不能误报通过", () => {
  const correct = JSON.stringify({ ok: true, bootId: "boot-1", upstream: { ok: true } });
  const wrong = JSON.stringify({ ok: true, bootId: "old-boot", upstream: { ok: true } });
  const assessment = assessChinaMeasurement({
    id: "measurement-2",
    status: "finished",
    results: [result("天津", correct), result("广州", wrong)],
  }, "health", "boot-1", 2);
  assert.equal(assessment.ok, false);
  assert.equal(assessment.successfulProbes, 1);
});

test("页面验证要求返回真实应用标题", () => {
  const html = "<!doctype html><html><head><title>歌曲世界杯</title></head></html>";
  const assessment = assessChinaMeasurement({
    id: "measurement-3",
    status: "finished",
    results: [result("北京", html), result("上海", html)],
  }, "page", "unused", 2);
  assert.equal(assessment.ok, true);
});

