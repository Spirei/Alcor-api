import assert from "node:assert/strict";
import test from "node:test";
import {
  activitySelection,
  activitySearch,
  activityMoment,
  activityLabel,
  activityLevel,
  dailyReasonLabel,
} from "../src/activity-presentation.ts";
test("activity links preserve permitted scope and search without granting system access", () => {
  for (const scope of ["system", "requests"])
    assert.equal(activitySelection(`?scope=${scope}`, false).view, "user");
  assert.equal(
    activitySelection("?scope=system&page=2&q=session.created", true).page,
    1,
  );
  assert.equal(activitySelection("?scope=unknown&page=1e9", true).page, 0);
  assert.equal(activitySelection("?scope=summary", false).view, "summary");
  const next = activitySearch(
    "?scope=requests&mod=market&op=read&rStatus=4xx",
    "system",
    2,
    "合成 请求",
  );
  assert.equal(new URLSearchParams(next).get("mod"), null);
  assert.equal(new URLSearchParams(next).get("rStatus"), "4xx");
  assert.deepEqual(activitySelection(next, true), {
    view: "system",
    query: "合成 请求",
    page: 2,
  });
  assert.equal(
    new URLSearchParams(activitySearch("?mod=market", "requests", 0, "")).get(
      "mod",
    ),
    "market",
  );
});
test("activity dates use Shanghai midnight and unknown events never imply success", () => {
  assert.deepEqual(activityMoment("2026-11-04T16:00:00Z"), {
    day: "2026/11/5",
    clock: "00:00",
    dateTime: "2026-11-04T16:00:00Z",
  });
  assert.equal(activityMoment("2026-11-05T00:00:00").day, "时间待核对");
  assert.equal(activityLabel("deployment.requested"), "请求更新容器");
  assert.equal(activityLabel("unknown.completed"), "平台事件");
  assert.equal(activityLevel("auth.login.rate_limited"), "warning");
  assert.equal(activityLevel("data_import_rejected"), "error");
  assert.equal(
    dailyReasonLabel("history_source_authorization_changed"),
    "行情来源授权已变化",
  );
});

import {
  requestObservationFilters,
  requestObservationSearch,
} from "../src/request-observation-state.ts";
test("request filter links preserve snapshot anchors and reject invalid query choices", () => {
  const read = requestObservationFilters(
    "?scope=requests&rPeriod=7d&rStatus=4xx&rSource=ios&rMethod=POST&rPage=2&rAnchor=123&rQ=source",
  );
  assert.equal(read.period, "7d");
  assert.equal(read.page, 2);
  assert.equal(read.anchor, 123);
  const next = requestObservationSearch("?scope=requests&rPage=2&rAnchor=123", {
    status: "5xx",
    page: 1,
    anchor: 0,
  });
  assert.equal(new URLSearchParams(next).get("scope"), "requests");
  assert.equal(new URLSearchParams(next).get("rPage"), null);
  assert.equal(requestObservationFilters(next).status, "5xx");
  const invalid = requestObservationFilters(
    "?rPeriod=forever&rPage=-1&rAnchor=9007199254740993&rMethod=BAD",
  );
  assert.equal(invalid.period, "today");
  assert.equal(invalid.page, 1);
  assert.equal(invalid.anchor, 0);
  assert.equal(invalid.method, "all");
});
