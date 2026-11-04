import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup as render } from "react-dom/server";

test("migrated presentation keeps source gaps, exact amounts and bounded media explicit", async (t) => {
  const root = fileURLToPath(new URL("../../../", import.meta.url)),
    tmp = join(root, ".local");
  await mkdir(tmp, { recursive: true });
  const dir = await mkdtemp(join(tmp, "workspace-ui-dom-"));
  try {
    const output = join(dir, "ui.cjs");
    await build({
      stdin: {
        contents:
          'export {WorkspaceTabs,WorkspaceView} from "./src/workspace-ui";export {WorkspaceRoutes} from "./src/workspace-routes";export {MemoryRouter,Route,useLocation} from "react-router-dom";export {FireProgress} from "./src/fire-progress";export {FxConverter} from "./src/fx-converter";export {TradingMonth} from "./src/trading-month";export {ActivityTimeline} from "./src/activity-timeline";export {CardGallery} from "./src/card-gallery";',
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
      "FIRE unknown and explicit zero are distinct; progress is not inferred from balances",
      () => {
        const unknown = render(
          element(ui.FireProgress, {
            progress: null,
            current: "0",
            target: "1000000.123456789",
            currency: "",
          }),
        );
        assert.match(unknown, /进度待填写/);
        assert.match(unknown, />0</);
        assert.match(unknown, /1000000\.123456789/);
        assert.match(unknown, /币种未知/);
        assert.doesNotMatch(unknown, />0%</);
        const zero = render(
          element(ui.FireProgress, {
            progress: "0",
            current: "900000",
            target: "1000000",
            currency: "USD",
          }),
        );
        assert.match(zero, />0%</);
        assert.doesNotMatch(zero, />90%</);
        for (const progress of ["Infinity", "NaN", "1e9999", {}, "<script>"]) {
          assert.match(
            render(
              element(ui.FireProgress, {
                progress,
                current: "",
                target: "",
                currency: "USD",
              }),
            ),
            /进度待填写/,
          );
        }
      },
    );
    await t.test(
      "calendar generates dates but never infers market availability from weekday",
      () => {
        const html = render(
          element(ui.TradingMonth, {
            month: "11",
            calendar: {
              year: 2026,
              days: [
                { date: "2026-11-02", status: "trading", name: null },
                { date: "2026-11-03", status: "holiday", name: "来源休市安排" },
              ],
            },
          }),
        );
        assert.match(html, /2026\/11\/1 · 未确认/);
        assert.match(html, /2026\/11\/2 · 交易日/);
        assert.match(html, /2026\/11\/3 · 休市 · 来源休市安排/);
        assert.equal(
          (html.match(/class="trading-month-day"/g) || []).length,
          30,
        );
        const leap = render(
          element(ui.TradingMonth, {
            month: "02",
            calendar: { year: 2024, days: [] },
          }),
        );
        assert.match(leap, /dateTime="2024-02-29"/);
        assert.equal(
          render(
            element(ui.TradingMonth, {
              month: "13",
              calendar: { year: 2024, days: [] },
            }),
          ),
          "",
        );
      },
    );
    await t.test(
      "first hidden view has no children; shared operation journals have explicit retained effects",
      () => {
        assert.equal(
          render(
            element(
              ui.WorkspaceView,
              { active: false, label: "deferred" },
              element("input", { value: "private", readOnly: true }),
            ),
          ),
          "",
        );
        const journal = render(
          element(
            ui.WorkspaceView,
            { active: false, label: "journals", keepEffects: true },
            element("span", null, "journal"),
          ),
        );
        assert.match(journal, /hidden=""/);
        assert.match(journal, /journal/);
      },
    );
    await t.test("retained routing preserves the complete active URL without borrowing another panel's query", () => {
      function Probe() { const value=ui.useLocation(); return element("output", null, value.search+value.hash); }
      const page=(url) => render(element(ui.MemoryRouter, {initialEntries:[url]}, element(ui.WorkspaceRoutes,{path:"/reference"},element(ui.Route,{path:"/reference",element:element(Probe)}))));
      assert.equal(page("/reference?from=CNY&amount=73#rates"),"<output>?from=CNY&amp;amount=73#rates</output>");
      assert.equal(page("/settings?unrelated=private#other"),"<output></output>");
    });
    await t.test(
      "timeline preserves raw details and invalid timestamps while bounding each page",
      () => {
        const rows = Array.from({ length: 25 }, (_, i) => ({
          id: String(i),
          event: "custom.unknown",
          detail: '{"original":"kept"}',
          createdAt: i === 0 ? "bad-source-time" : "2026-11-04T00:00:00Z",
          userName: "示例",
        }));
        const html = render(
          element(ui.ActivityTimeline, { rows, page: 0, onPage() {} }),
        );
        assert.match(html, /时间待核对/);
        assert.doesNotMatch(html, /Invalid Date/);
        assert.match(html, /custom\.unknown/);
        assert.match(html, /original/);
        assert.equal((html.match(/class="activity-event"/g) || []).length, 20);
      },
    );
    await t.test(
      "card gallery renders only a bounded page and only registered local images",
      () => {
        const cards = Array.from({ length: 40 }, (_, i) => ({
          key:
            i === 0
              ? "https://tracker.invalid/image.svg"
              : `/uploads/card/${i}.svg`,
          label: `Card ${i}`,
        }));
        const html = render(
          element(ui.CardGallery, {
            cards,
            images: cards.map((c) => ({ path: c.key })),
            selected: cards[1].key,
            onSelect() {},
            disabled: false,
          }),
        );
        assert.equal(
          (html.match(/class="card-gallery-item"/g) || []).length,
          24,
        );
        assert.doesNotMatch(html, /<img[^>]+https:/);
        assert.match(html, /图片待登记/);
        assert.match(html, /loading="lazy"/);
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
