import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup as render } from "react-dom/server";

test("asset analysis keeps unknown authority and original precision in its dashboard", async (t) => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  await mkdir(join(root, ".local"), { recursive: true });
  const dir = await mkdtemp(join(root, ".local/analysis-dom-"));
  try {
    const output = join(dir, "analysis.cjs");
    await build({
      entryPoints: [
        fileURLToPath(
          new URL("../src/portfolio-analysis.tsx", import.meta.url),
        ),
      ],
      outfile: output,
      bundle: true,
      platform: "node",
      format: "cjs",
      jsx: "automatic",
      external: ["react", "react/jsx-runtime"],
      loader: { ".css": "empty" },
      define: {
        "import.meta.env.VITE_UI_PERF": '"0"',
        "import.meta.env.VITE_UI_DELAY_MS": '""',
      },
      logLevel: "silent",
    });
    const m = createRequire(import.meta.url)(output);
    const book = {
      totals: {
        cost: "0",
        marketValue: "1234.000000000000000001",
        unrealizedPnl: "0",
        unrealizedPnlPct: "0",
        realizedPnl: "0",
        cash: "0",
        totalAsset: "1234.000000000000000001",
      },
      completeness: {
        valuation: true,
        cost: true,
        cash: true,
        realized: true,
        missingRecordIds: [],
      },
    };
    await t.test(
      "confirmed zero and exact strings stay visible; incomplete cash cannot become a complete total",
      () => {
        const complete = render(
          React.createElement(m.AnalysisTotals, { book, currency: "USD" }),
        );
        assert.ok(complete.includes("1234.000000000000000001"));
        assert.ok(complete.includes("<span>0</span>"));
        const partial = render(
          React.createElement(m.AnalysisTotals, {
            book: {
              ...book,
              totals: { ...book.totals, totalAsset: "999999" },
              completeness: { ...book.completeness, cash: false },
            },
            currency: "USD",
          }),
        );
        assert.ok(!partial.includes("999999"));
        assert.ok(partial.includes("未知"));
      },
    );
    await t.test(
      "missing net-asset history never becomes an invented return or daily asset graph",
      () => {
        for (const type of ["return", "asset"]) {
          const html = render(
            React.createElement(m.AnalysisTrendState, {
              type,
              pending: false,
              series: null,
            }),
          );
          assert.ok(html.includes("待核对"));
          assert.ok(!html.includes("<svg"));
          assert.ok(!html.includes("0%"));
        }
        const series = {
          records: [],
          orders: [],
          periodAnalysis: {
            completePeriodReturn: {
              state: "observed",
              value: null,
              reasons: [],
            },
          },
        };
        const html = render(
          React.createElement(m.AnalysisTrendState, {
            type: "return",
            pending: false,
            series,
          }),
        );
        assert.ok(!html.includes("analysis-period-value"));
        series.periodAnalysis.completePeriodReturn.value = "0";
        const zero = render(
          React.createElement(m.AnalysisTrendState, {
            type: "return",
            pending: false,
            series,
          }),
        );
        assert.ok(zero.includes("analysis-period-value"));
        assert.ok(zero.includes("<span>0</span>"));
      },
    );
    await t.test(
      "observed price graph retains actual date endpoints and explicit scope",
      () => {
        const html = render(
          React.createElement(m.ObservedPrices, {
            points: [
              { d: "2026-11-01", c: "12.000000000000000001" },
              { d: "2026-11-05", c: "13" },
            ],
            start: "2026-01-01",
            through: "2026-11-05",
          }),
        );
        assert.ok(html.includes("2026/01/01"));
        assert.ok(html.includes("2026/11/05"));
        assert.ok(html.includes("12.000000000000000001"));
        assert.ok(html.includes("非资产净值或收益曲线"));
        assert.ok(html.includes("缺失日期不连线"));
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
