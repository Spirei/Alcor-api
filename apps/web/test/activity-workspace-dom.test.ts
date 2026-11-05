import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
test("activity rows and daily price effects keep original scope, exact values and bounded pages", async (t) => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  await mkdir(join(root, ".local"), { recursive: true });
  const dir = await mkdtemp(join(root, ".local/activity-dom-"));
  try {
    const output = join(dir, "ui.cjs");
    await build({
      stdin: {
        contents:
          'export {ActivityTimeline} from "./src/activity-timeline";export {DailySummaryBook} from "./src/daily-activity-summary";export {RequestObservationMetrics} from "./src/request-observations";',
        resolveDir: fileURLToPath(new URL("../", import.meta.url)),
        loader: "tsx",
      },
      outfile: output,
      bundle: true,
      platform: "node",
      format: "cjs",
      jsx: "automatic",
      external: ["react", "react/jsx-runtime"],
      loader: { ".css": "empty" },
      logLevel: "silent",
    });
    const ui = createRequire(import.meta.url)(output),
      element = React.createElement;
    await t.test(
      "log rows are twenty per page with fixed-zone dates, original details deferred and names scoped",
      () => {
        const rows = Array.from({ length: 21 }, (_, i) => ({
          id: String(i),
          event: "session.created",
          detail: "a251edb7-4180-424d-af6f-c90a169fbcf7",
          createdAt: "2026-11-04T16:00:00Z",
          userName: "SyntheticPerson",
        }));
        const first = render(
          element(ui.ActivityTimeline, { rows, page: 0, onPage() {} }),
        );
        assert.equal((first.match(/class="activity-event"/g) || []).length, 20);
        assert.match(first, /2026\/11\/5/);
        assert.match(first, />00:00</);
        assert.match(first, /创建登录会话/);
        assert.doesNotMatch(first, /SyntheticPerson|a251edb7/);
        const last = render(
          element(ui.ActivityTimeline, {
            rows,
            page: 1,
            onPage() {},
            showUser: true,
          }),
        );
        assert.equal((last.match(/class="activity-event"/g) || []).length, 1);
        assert.match(last, /SyntheticPerson/);
      },
    );
    await t.test(
      "price effects preserve exact zero, unknowns and original currency without claiming whole-account profit",
      () => {
        const position = {
          recordId: "private-record",
          accountId: "private-account",
          market: "US",
          code: "SYNTH",
          quantity: "0",
          actualPnl: "0",
          currentExposurePriceMoveEstimate: "0.000000000000000001",
          previousDate: null,
          date: null,
          previousClose: null,
          close: null,
          priceDifference: null,
          currency: "USD",
          quantityProof: null,
          source: null,
          reasons: ["two_observed_completed_daily_bars_missing"],
        };
        const html = render(
          element(ui.DailySummaryBook, {
            book: {
              accountKind: "real",
              currency: "USD",
              actualPnl: null,
              currentExposurePriceMoveEstimate: "0.000000000000000001",
              complete: false,
              reasons: position.reasons,
              positions: [position],
            },
          }),
        );
        assert.match(html, /真实账户/);
        assert.match(html, /证据待补齐/);
        assert.match(html, /未知/);
        assert.match(html, />0</);
        assert.match(html, /0\.000000000000000001/);
        assert.match(html, /缺少两根已结束的日线观察/);
        assert.doesNotMatch(
          html,
          /private-record|private-account|实际当日盈亏|合计利润/,
        );
        const bounded = render(
          element(ui.DailySummaryBook, {
            book: {
              accountKind: "real",
              currency: "USD",
              actualPnl: null,
              currentExposurePriceMoveEstimate: null,
              complete: false,
              reasons: [],
              positions: Array.from({ length: 101 }, (_, i) => ({
                ...position,
                recordId: String(i),
              })),
            },
          }),
        );
        assert.equal((bounded.match(/<tr>/g) || []).length, 21);
        assert.match(bounded, /101/);
      },
    );
    await t.test(
      "pending request rollups do not masquerade as known zero traffic",
      () => {
        const summary = {
          total: 0,
          errors: 0,
          serverErrors: 0,
          averageMs: 0,
          sources: {},
        };
        const pending = render(
          element(ui.RequestObservationMetrics, {
            data: { summary, rollupPending: true },
          }),
        );
        assert.equal((pending.match(/待汇总/g) || []).length, 4);
        assert.doesNotMatch(pending, />0</);
        const empty = render(
          element(ui.RequestObservationMetrics, {
            data: { summary, rollupPending: false },
          }),
        );
        assert.match(empty, />0</);
        assert.match(empty, /0\.0 ms/);
        assert.doesNotMatch(empty, /待汇总/);
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
