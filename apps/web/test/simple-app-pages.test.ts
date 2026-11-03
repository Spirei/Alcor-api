import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

test("all sixteen legacy routes expose real typed controls and preserve independent declaration wording", async () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url)),
    dir = await mkdtemp(join(root, ".local/simple-pages-"));
  try {
    const output = join(dir, "pages.cjs");
    await build({
      stdin: {
        contents:
          'export {SimplePages} from "./src/simple-app-pages";export {pages,decode} from "./src/simple-app-model";',
        resolveDir: fileURLToPath(new URL("../", import.meta.url)),
        loader: "tsx",
      },
      outfile: output,
      bundle: true,
      platform: "node",
      format: "cjs",
      jsx: "automatic",
      external: ["react", "react/jsx-runtime"],
      logLevel: "silent",
    });
    const module = createRequire(import.meta.url)(output);
    const ledger = module.decode(
      '{"cash":[{"id":"cash-1","name":"现金","amount":123456789012345678901234,"cur":"CNY","owner":"我"}],"fixed":[],"receivable":[],"debt":[],"invest":[{"id":"invest-1","name":"独立投资","amount":"110","cur":"CNY","bucket":"长期","market":"CN","inAmt":"100","outAmt":"0","hist":[{"d":"2025-01-01","v":"100","inn":"0","out":"0"},{"d":"2026-01-01","v":"110","inn":"0","out":"0"}]}],"members":[{"id":"me","name":"我"}],"snaps":[],"logs":[],"summaries":[],"cashflow":{"incomeItems":[],"expenseItems":[]},"fx":{"CNY":"1"},"displayCur":"CNY"}',
    );
    const htmls: Record<string, string> = {};
    for (const page of module.pages) {
      const context =
        page === "editItem"
          ? { cat: "cash", itemId: "cash-1" }
          : ["account", "settings"].includes(page)
            ? { account: "invest-1" }
            : {};
      htmls[page] = renderToStaticMarkup(
        React.createElement(module.SimplePages, {
          ledger,
          page,
          context,
          patch: () => {
            throw Error("render cannot mutate");
          },
          go: () => {},
        }),
      );
      assert.ok(htmls[page].length > 50, page);
      assert.ok(!htmls[page].includes("placeholder-only"), page);
    }
    assert.equal(Object.keys(htmls).length, 16);
    assert.ok(htmls.addItem.includes("登记金额"));
    assert.ok(htmls.editItem.includes("123456789012345678901234"));
    for (const page of [
      "addItem",
      "editItem",
      "addInvest",
      "manage",
      "settings",
      "cashflow",
      "addSummary",
    ])
      assert.ok(
        htmls[page].includes("<input") || htmls[page].includes("<select"),
        page,
      );
    assert.ok(
      htmls.account.includes("真实") || htmls.account.includes("原始观察"),
    );
    assert.ok(htmls.account.includes("券商"));
    assert.ok(htmls.account.includes("明确添加一次估值"));
    assert.ok(htmls.family.includes("已登记家庭资产快照"));
    assert.ok(htmls.calendar.includes("没有已登记观察"));
    assert.ok(htmls.invest.includes("归档"));
    assert.ok(htmls.summary.includes("不从当前估值合成"));
    const cashflow = {
      incomeItems: [{ id: "i", name: "收入", amount: "1000", freq: "month" }],
      expenseItems: [{ id: "e", name: "支出", amount: "300", freq: "month" }],
    };
    const renderBudget = (value: any) =>
      renderToStaticMarkup(
        React.createElement(module.SimplePages, {
          ledger: { ...ledger, cashflow: value },
          page: "cashflow",
          context: {},
          patch: () => {
            throw Error("render cannot mutate");
          },
          go: () => {},
        }),
      )
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ");
    assert.match(renderBudget(cashflow), /预估年度收入 未知 币种未登记/);
    const declaredBudget = renderBudget({ ...cashflow, currency: "CNY" });
    assert.match(declaredBudget, /预估年度收入 12000 CNY/);
    assert.match(declaredBudget, /预估年度支出 3600 CNY/);
    assert.match(declaredBudget, /预估年度结余 8400 CNY/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
