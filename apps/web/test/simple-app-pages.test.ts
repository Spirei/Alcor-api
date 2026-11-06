import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

test("all sixteen legacy routes expose real typed controls and preserve independent declaration wording", async (t) => {
  const root = fileURLToPath(new URL("../../../", import.meta.url)),
    dir = await mkdtemp(join(root, ".local/simple-pages-"));
  try {
    const output = join(dir, "pages.cjs");
    await build({
      stdin: {
        contents:
          'export {SimplePages} from "./src/simple-app-pages";export {pages,decode,encode} from "./src/simple-app-model";export {budgetSummary,declaredInvestmentPnl,displayDecimal,displayRatio,ledgerSection,ledgerMonthCells,shiftLedgerMonth} from "./src/simple-app-view-model";',
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
        htmls[page].includes("<input") ||
          htmls[page].includes('aria-haspopup="listbox"'),
        page,
      );
    assert.ok(
      htmls.account.includes("真实") || htmls.account.includes("原始观察"),
    );
    assert.ok(htmls.account.includes("券商"));
    assert.ok(htmls.account.includes("更新收益"));
    assert.doesNotMatch(htmls.account, /观察日期（明确填写）/);
    assert.ok(htmls.family.includes("已登记家庭资产快照"));
    assert.ok(htmls.calendar.includes("没有已登记观察"));
    assert.ok(htmls.invest.includes("归档"));
    assert.match(htmls.invest, /全部账本/);
    assert.match(htmls.invest, /全部分类/);
    assert.ok(htmls.summary.includes("不从当前估值合成"));
    const cashflow = {
      incomeItems: [{ id: "i", name: "收入", amount: "1000", freq: "month" }],
      expenseItems: [{ id: "e", name: "支出", amount: "300", freq: "month" }],
    };
    const renderBudget = (value: any) =>
      renderToStaticMarkup(
        React.createElement(module.SimplePages, {
          ledger: { ...ledger, cashflow: { ...value, completed: true } },
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
    assert.match(renderBudget(cashflow), /预估收入 未知 币种未登记/);
    const declaredBudget = renderBudget({ ...cashflow, currency: "CNY" });
    assert.match(declaredBudget, /预估收入 12,000 CNY/);
    assert.match(declaredBudget, /预估支出 3,600 CNY/);
    assert.match(declaredBudget, /预估年度结余 8,400 CNY/);
    await t.test(
      "cashflow tracking separates its single hero from editable planning steps and preserves missing data",
      () => {
        const renderCashflow = (value: any, hide = false) =>
          renderToStaticMarkup(
            React.createElement(module.SimplePages, {
              ledger: { ...ledger, hide, cashflow: value },
              page: "cashflow",
              context: {},
              patch: () => {
                throw Error("render cannot mutate");
              },
              go: () => {},
            }),
          );
        const known = { ...cashflow, currency: "CNY", completed: true },
          overview = renderCashflow(known);
        assert.doesNotMatch(
          overview,
          /现金流规划步骤|simple-budget-flow-labels|simple-budget-summary/,
        );
        assert.match(overview, /储蓄率/);
        assert.match(overview, /70%/);
        assert.equal((overview.match(/预估年度结余/g) || []).length, 1);
        assert.match(overview, /simple-budget-track/);
        assert.doesNotMatch(overview, /本月支出.*0|月度剩余/);
        const edit = renderCashflow({
          ...known,
          completed: false,
          started: true,
        });
        assert.match(edit, /现金流规划步骤/);
        assert.match(edit, /simple-budget-row-main/);
        assert.match(edit, /\/月/);
        assert.doesNotMatch(edit, /\/ ?month|simple-budget-summary|删除草稿项/);
        assert.match(edit, /aria-label="收入操作"/);
        assert.match(edit, /popover="auto"/);
        assert.doesNotMatch(
          renderCashflow(known, true),
          /12,000|3,600|8,400|70%|<svg[^>]+role="img"/,
        );
        assert.match(
          renderCashflow({ ...known, currency: "" }),
          /尚未完善收支预算/,
        );
        assert.doesNotMatch(
          renderCashflow({ ...known, currency: "" }),
          /70%|<svg[^>]+role="img"/,
        );
      },
    );
    await t.test(
      "overview keeps exact amounts and never invents a cross-account return",
      () => {
        assert.match(htmls.home, /家庭总资产/);
        assert.match(htmls.home, /123,456,789,012,345,678,901,344/);
        assert.match(htmls.home, /暂无<small>年化/);
        assert.doesNotMatch(htmls.home, /资产没有变化|负债没有变化/);
        assert.equal(
          module.displayDecimal("9007199254740993.000000000000000001"),
          "9,007,199,254,740,993.000000000000000001",
        );
        const hidden = renderToStaticMarkup(
          React.createElement(module.SimplePages, {
            ledger: { ...ledger, hide: true },
            page: "home",
            context: {},
            patch: () => {},
            go: () => {},
          }),
        );
        assert.doesNotMatch(hidden, /123,456,789|110|12000|8400/);
        assert.match(hidden, /显示独立账本金额/);
      },
    );
    await t.test(
      "shared budget summary preserves unknown currency, malformed rows and source tokens",
      () => {
        const value = { ...ledger, cashflow: { ...cashflow, currency: "CNY" } },
          before = module.encode(value);
        assert.deepEqual(module.budgetSummary(value), {
          currency: "CNY",
          income: "12000",
          expense: "3600",
          surplus: "8400",
        });
        assert.equal(module.encode(value), before);
        assert.equal(module.budgetSummary({ ...value, cashflow }).income, null);
        assert.equal(
          module.budgetSummary({
            ...value,
            cashflow: {
              ...value.cashflow,
              incomeItems: [...cashflow.incomeItems, null],
            },
          }).income,
          null,
        );
        assert.equal(
          module.budgetSummary({
            ...value,
            cashflow: { ...value.cashflow, incomeItems: [] },
          }).income,
          null,
        );
        assert.equal(
          module.budgetSummary({
            ...value,
            cashflow: {
              ...value.cashflow,
              expenseItems: [{ amount: "10", freq: "unknown" }],
            },
          }).surplus,
          null,
        );
      },
    );
    await t.test(
      "legacy summary layout keeps unsupported combined returns unknown and hides proportional amounts",
      () => {
        const renderHome = (value: any) =>
          renderToStaticMarkup(
            React.createElement(module.SimplePages, {
              ledger: value,
              page: "home",
              context: {},
              patch: () => {},
              go: () => {},
            }),
          );
        const one = {
          ...ledger,
          invest: [{ ...ledger.invest[0], historyComplete: true }],
        };
        assert.match(renderHome(one), /10%<small>年化/);
        assert.match(
          renderHome({
            ...one,
            invest: [...one.invest, { ...one.invest[0], id: "other" }],
          }),
          /暂无<small>年化/,
        );
        assert.match(
          renderHome({ ...one, invest: [...one.invest, null] }),
          /暂无<small>年化/,
        );
        const known = {
          ...ledger,
          cashflow: {
            currency: "CNY",
            incomeItems: [{ name: "收入", amount: "1000", freq: "year" }],
            expenseItems: [
              { name: "支出", amount: "250", freq: "year", type: "stable" },
            ],
          },
        };
        assert.match(renderHome(known), /75%<small>储蓄率/);
        assert.match(
          renderHome(known),
          /simple-cashflow-part stable[^>]+width:25%/,
        );
        assert.doesNotMatch(
          renderHome({ ...known, hide: true }),
          /width:25%|75%/,
        );
        assert.doesNotMatch(
          renderHome({
            ...known,
            cashflow: { ...known.cashflow, currency: "" },
          }),
          /width:25%/,
        );
        assert.doesNotMatch(
          renderHome({
            ...known,
            cashflow: {
              ...known.cashflow,
              expenseItems: [{ amount: "2000", freq: "year", type: "stable" }],
            },
          }),
          /simple-cashflow-part stable/,
        );
      },
    );
    await t.test(
      "observation calendar keeps leap days, empty dates and UTC month boundaries",
      () => {
        const feb = module.ledgerMonthCells("2024-02");
        assert.equal(feb.length, 42);
        assert.equal(feb.filter(Boolean).length, 29);
        assert.equal(feb[3], "2024-02-01");
        assert.equal(module.ledgerMonthCells("2026-11")[6], "2026-11-01");
        assert.deepEqual(module.ledgerMonthCells("2026-13"), []);
        assert.equal(module.shiftLedgerMonth("2026-12", 1), "2027-01");
        assert.equal(module.shiftLedgerMonth("2026-01", -1), "2025-12");
        assert.match(htmls.calendar, /本人登记观察月历/);
      },
    );
    await t.test(
      "investment summary needs declared flows and parent routes keep account settings in investment",
      () => {
        assert.equal(module.declaredInvestmentPnl(ledger, "CNY"), "10");
        assert.equal(
          module.declaredInvestmentPnl(
            { ...ledger, invest: [{ ...ledger.invest[0], inAmt: null }] },
            "CNY",
          ),
          null,
        );
        assert.equal(
          module.declaredInvestmentPnl({ ...ledger, invest: [] }, "CNY"),
          null,
        );
        assert.equal(module.declaredInvestmentPnl(ledger, "USD"), null);
        assert.equal(module.ledgerSection("settings", "invest-1"), "invest");
        assert.equal(module.ledgerSection("settings"), "home");
        assert.equal(module.ledgerSection("editItem"), "family");
        assert.equal(module.ledgerSection("summary"), "invest");
        assert.equal(module.displayRatio("4.25531914893617021"), "约 4.26");
        assert.equal(module.displayRatio("9.999"), "约 10");
        assert.equal(module.displayRatio(null), "未知");
        assert.equal(module.displayRatio("-0.001"), "约 0");
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
