import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

test("cash presentation keeps registered, verified and unavailable amounts distinct", async (t) => {
  const local = fileURLToPath(new URL("../../../.local/", import.meta.url));
  await mkdir(local, { recursive: true });
  const dir = await mkdtemp(join(local, "cash-overview-dom-"));
  try {
    const output = join(dir, "ui.cjs");
    await build({
      stdin: {
        contents: 'export {CashCurrencyCard} from "./src/cash-overview";',
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
      base = {
        currency: "USD",
        ownerBalance: null,
        registeredOwnerBalance: "1000",
        unallocatedBalance: null,
        registeredUnallocatedBalance: "70",
        reservedBuyCash: null,
        availableOwnerBalance: null,
        ledgerAsOf: null,
        complete: false,
        reservationsComplete: false,
      };
    const render = (extra = {}) =>
      renderToStaticMarkup(
        React.createElement(ui.CashCurrencyCard, {
          row: { ...base, ...extra },
        }),
      )
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ");
    await t.test(
      "registered cash does not fill an unknown verified balance",
      () => {
        const html = render();
        assert.match(html, /未知 内部账本余额/);
        assert.match(html, /登记资金 1000/);
        assert.match(html, /未分配 未知 登记值 70/);
        assert.match(html, /内部可用 未知/);
        assert.match(html, /待核对/);
        assert.doesNotMatch(html, /已核对|购买力/);
      },
    );
    await t.test(
      "known zero remains zero and missing reservation cannot become available cash",
      () => {
        const html = render({
          ownerBalance: "0",
          complete: true,
          registeredOwnerBalance: "0",
        });
        assert.match(html, /0 内部账本余额/);
        assert.match(html, /账本资料完整/);
        assert.match(html, /买单预留 未知/);
        assert.match(html, /买单预留尚未核实/);
        assert.match(html, /内部可用 未知/);
      },
    );
    await t.test(
      "exact amounts and original ledger timestamp survive presentation",
      () => {
        const exact = "9007199254740993.000000000000000001",
          html = render({
            ownerBalance: exact,
            complete: true,
            ledgerAsOf: "2026-11-01T01:02:03+00:00",
          });
        assert.ok(html.includes(exact));
        assert.ok(html.includes("2026-11-01T01:02:03+00:00"));
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
