import assert from "node:assert/strict";
import test from "node:test";
import { feedTimestamp, feedDateTime } from "../src/feed-display.ts";

test("feed publication gaps never borrow collection dates", () => {
  const unknown = feedTimestamp(null, "2026-11-04T16:00:00Z", 0);
  assert.equal(unknown.text, "发布时间未知");
  assert.equal(unknown.dateTime, undefined);
  assert.equal(feedDateTime("2026-11-04T16:00:00Z"), "2026/11/5 00:00");
  assert.equal(feedDateTime(null), "时间未知");
  assert.equal(feedDateTime(0), "1970/1/1 08:00");
  for (const invalid of [Infinity, NaN, 1e20])
    assert.equal(feedDateTime(invalid), "时间未知");
  assert.match(unknown.title, /2026\/11\/5 00:00/);
  for (const bad of ["invalid", "2026-11-05T12:00:00", "", null]) {
    assert.equal(feedTimestamp(bad, "invalid").text, "发布时间未知");
  }
});
test("feed time labels use observed publication, fixed zone and finite relative age", () => {
  const raw = "2026-11-04T16:00:00Z",
    start = Date.parse(raw);
  assert.equal(feedTimestamp(raw, "invalid", start).text, "刚刚");
  assert.equal(feedTimestamp(raw, "invalid", start + 120000).text, "2分钟前");
  assert.equal(feedTimestamp(raw, "invalid", start + 7200000).text, "2小时前");
  assert.equal(feedTimestamp(raw, "invalid", start + 86400000).text, "1天前");
  for (const now of [0, Infinity, start + 8 * 86400000]) {
    const result = feedTimestamp(raw, "invalid", now);
    assert.equal(result.text, "2026/11/5 00:00");
    assert.equal(result.dateTime, raw);
    assert.equal(result.title, result.text);
  }
});
