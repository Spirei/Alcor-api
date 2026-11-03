import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  historyRevision,
  historyCode,
  marketPendingKey,
  validMarketOperation,
  type Demand,
  type HistoryQuery,
} from "../src/market-history-model.ts";
import {
  ReportLifetime,
  reportScope,
} from "../src/financial-report-lifetime.ts";

test("history CAS and UUID journal never cross source, frame, session or role", () => {
  const query: HistoryQuery = {
    kind: "bars",
    market: "US",
    code: "DEMO",
    frame: "day",
    adjust: "qfq",
    session: "REGULAR",
    instrument: "equity",
    start: "2026-01-01",
    through: "2026-10-01",
  };
  const row: Demand = {
    streamId: "stream",
    sourceRevision: "source",
    revision: 7,
    query,
    origin: "client",
    active: false,
    cancellable: true,
    expiresAt: null,
  };
  assert.equal(historyCode(" demo.oq "), "DEMO.OQ");
  assert.equal(historyCode("ß"), null);
  assert.equal(historyCode("ＡＡＰＬ"), null);
  assert.equal(historyRevision([row], "source", query), 7);
  assert.equal(historyRevision([row], "other-source", query), 0);
  assert.equal(
    historyRevision([row], "source", { ...query, frame: "month" }),
    0,
  );
  assert.equal(
    historyRevision([{ ...row, cancellable: false }], "source", query),
    0,
  );
  const session = {
    instance_id: "instance",
    user: { id: "owner", role: "user" },
    receipt_scope: "session-one",
  };
  const key = marketPendingKey(reportScope(session));
  for (const changed of [
    { ...session, instance_id: "peer-instance" },
    { ...session, user: { id: "peer", role: "user" } },
    { ...session, user: { id: "owner", role: "admin" } },
    { ...session, receipt_scope: "session-two" },
  ])
    assert.notEqual(marketPendingKey(reportScope(changed)), key);
  assert.equal(
    validMarketOperation("438fca63-e431-4968-86c0-d701c60046bf"),
    true,
  );
  assert.equal(validMarketOperation('{"query":"private draft"}'), false);
});

test("hidden and changed sessions cannot display late market responses", async () => {
  let visible = true,
    current = true,
    shown = false;
  const life = new ReportLifetime(
    () => current,
    () => visible,
  );
  life.resume(true);
  const ticket = life.begin()!;
  visible = false;
  life.pause();
  await Promise.resolve();
  if (ticket.current()) shown = true;
  assert.equal(shown, false);
  assert.equal(ticket.signal.aborted, true);
  visible = true;
  life.resume(true);
  const second = life.begin()!;
  current = false;
  assert.equal(second.current(), false);
});

test("actual market page SSR has explicit empty source selection and makes no requests", async () => {
  const parent = process.env.ALCOR_TEST_ROOT || tmpdir();
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, "market-history-ui-"));
  const require = createRequire(import.meta.url),
    previous = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    throw Error("No SSR source IO");
  };
  try {
    const output = join(directory, "market.cjs");
    await build({
      stdin: {
        contents: 'export {MarketHistoryPage} from "./src/market-history";',
        resolveDir: fileURLToPath(new URL("../", import.meta.url)),
        loader: "tsx",
      },
      outfile: output,
      bundle: true,
      platform: "node",
      format: "cjs",
      jsx: "automatic",
      define: {
        "import.meta.env.VITE_UI_PERF": '"0"',
        "import.meta.env.VITE_UI_DELAY_MS": '""',
      },
      plugins: [
        {
          name: "current-react",
          setup(plugin) {
            plugin.onResolve({ filter: /^react(?:\/|$)/ }, (args) => ({
              path: require.resolve(args.path),
              external: true,
            }));
          },
        },
      ],
      logLevel: "silent",
    });
    const page = require(output);
    const session = {
      instance_id: "controlled-instance",
      csrf: "controlled-session",
      receipt_scope: "controlled-receipt",
      expires_at: "2099-01-01",
      user: { id: "controlled-owner", username: "MarketQA", role: "user" },
    };
    const html = renderToStaticMarkup(
      React.createElement(page.MarketHistoryPage, { session }),
    );
    assert.match(html, /选择已许可来源/);
    assert.match(html, /选择来源/);
    assert.match(html, /登记采集需求/);
    assert.match(html, /读取已采集/);
    assert.equal(requests, 0);
    const hidden = renderToStaticMarkup(
      React.createElement(page.MarketHistoryPage, { session, active: false }),
    );
    assert.match(hidden, /aria-hidden="true"/);
    assert.doesNotMatch(hidden, /登记采集需求/);
  } finally {
    globalThis.fetch = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
