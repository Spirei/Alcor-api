import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mobileNavigation } from "../src/site-navigation.ts";

test("mobile ordering uses confirmed old keys without changing desktop or inventing routes", () => {
  const baseline = [
    "/settings",
    "/portfolio",
    "/market",
    "/feed",
    "/activity",
  ].map((path) => ({ path }));
  const order = [
    "trading",
    "unknown-custom-tab",
    "watchlist",
    "assets",
    "earnings",
  ];
  assert.deepEqual(mobileNavigation(baseline, order, false), baseline);
  assert.deepEqual(mobileNavigation(baseline, [], true), baseline);
  assert.deepEqual(
    mobileNavigation(baseline, order, true).map((item) => item.path),
    ["/feed", "/portfolio", "/market", "/settings", "/activity"],
  );
  assert.deepEqual(
    mobileNavigation(baseline, ["/feed", "assistant", "constructor"], true),
    baseline,
  );
  assert.deepEqual(
    baseline.map((item) => item.path),
    ["/settings", "/portfolio", "/market", "/feed", "/activity"],
  );
});

test("actual display components and raw JSON extraction retain F37/F38 boundaries", async (t) => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const tempRoot = process.env.ALCOR_TEST_ROOT || join(root, ".local");
  await mkdir(tempRoot, { recursive: true });
  const dir = await mkdtemp(join(tempRoot, "f37-f38-boundaries-"));
  const require = createRequire(import.meta.url);
  try {
    const output = join(dir, "components.cjs");
    await build({
      stdin: {
        contents: `export { PrivateAmount, MarketBadge, financialDisplayContext } from './financial-display';
export { publicSiteContext } from './public-site';
export { TradeAttachmentsSummary } from './trade-attachments';
export { rawSimpleLedgerField } from './simple-ledger';`,
        resolveDir: fileURLToPath(new URL("../src", import.meta.url)),
        loader: "tsx",
      },
      outfile: output,
      bundle: true,
      platform: "node",
      format: "cjs",
      jsx: "automatic",
      loader: { ".css": "empty" },
      define: {
        "import.meta.env.VITE_UI_PERF": '"0"',
        "import.meta.env.VITE_UI_DELAY_MS": '""',
      },
      plugins: [
        {
          name: "actual-private-boundaries",
          setup(builder) {
            // Export the existing private functions/contexts only in the test bundle.
            // Their production source and implementation are unchanged.
            builder.onLoad(
              {
                filter: /(?:financial-display|public-site|simple-ledger)\.tsx$/,
              },
              async (args) => {
                const additions = args.path.endsWith("financial-display.tsx")
                  ? "\nexport { Context as financialDisplayContext };"
                  : args.path.endsWith("public-site.tsx")
                    ? "\nexport { Context as publicSiteContext };"
                    : "\nexport { rawField as rawSimpleLedgerField };";
                return {
                  contents: (await readFile(args.path, "utf8")) + additions,
                  loader: "tsx",
                };
              },
            );
            // Keep one React instance, including when temporary output is on another volume.
            builder.onResolve(
              { filter: /^react(?:\/jsx-runtime)?$/ },
              (args) => ({ path: require.resolve(args.path), external: true }),
            );
          },
        },
      ],
      logLevel: "silent",
    });
    const m = require(output);
    const publicSite = (
      badges: Record<string, { label: string; bg: string; fg: string }>,
      visible = true,
    ) => ({
      title: "Synthetic",
      logoText: "Synthetic",
      siteLogo: "",
      ico: "",
      homeNav: [],
      mobileNavigationOrder: [],
      marketBadges: badges,
      marketBadgesVisible: visible,
    });
    const badge = (
      market: string,
      badges: Record<string, { label: string; bg: string; fg: string }>,
      visible = true,
    ) =>
      renderToStaticMarkup(
        React.createElement(
          m.publicSiteContext.Provider,
          { value: publicSite(badges, visible) },
          React.createElement(m.MarketBadge, { market }),
        ),
      );
    await t.test(
      "CN and ASSET require explicit colors; CRYPTO never aliases to ASSET",
      () => {
        const legacy = {
          CRYPTO: { label: "Legacy crypto", bg: "#112233", fg: "#FFFFFF" },
        };
        assert.equal(badge("ASSET", legacy), "<span>ASSET</span>");
        const market = badge("CN", legacy);
        assert.match(market, /🇨🇳/);
        assert.match(market, /A股/);
        assert.doesNotMatch(market, /background-color|#112233/);
        const explicit = {
          ...legacy,
          CN: { label: "CN explicit", bg: "#223344", fg: "#FFFFFF" },
          ASSET: { label: "Asset explicit", bg: "#334455", fg: "#FFFFFF" },
        };
        assert.match(badge("CN", explicit), /background-color:#223344/);
        assert.match(badge("ASSET", explicit), /Asset explicit/);
        assert.match(badge("CRYPTO", explicit), /Legacy crypto/);
        assert.equal(badge("ASSET", explicit, false), "<span>ASSET</span>");
      },
    );
    await t.test(
      "hidden read values leave financial confirmation details available for review",
      () => {
        const render = (visible: boolean) =>
          renderToStaticMarkup(
            React.createElement(
              m.financialDisplayContext.Provider,
              { value: { visible, setVisible() {} } },
              React.createElement(
                React.Fragment,
                null,
                React.createElement(m.PrivateAmount, null, "99123.456789"),
                React.createElement(m.PrivateAmount, null, "0"),
                React.createElement(m.TradeAttachmentsSummary, {
                  value: {
                    session: "REGULAR",
                    tif: "day",
                    takeProfit: {
                      percent: "5.000001",
                      orderType: "limit",
                      limitPrice: "101.123456",
                      fees: "0.000001",
                    },
                  },
                }),
              ),
            ),
          );
        const hidden = render(false),
          shown = render(true);
        assert.ok(!hidden.includes("99123.456789"));
        assert.ok(hidden.includes("******"));
        for (const exact of ["5.000001", "101.123456", "0.000001", "非实付"])
          assert.ok(hidden.includes(exact));
        assert.ok(shown.includes("99123.456789"));
        assert.ok(shown.includes("<span>0</span>"));
      },
    );
    await t.test(
      "SimpleLedger extracts original numeric lexemes rather than a Number round-trip",
      () => {
        const ledger = String.raw`{"cash":[{"amount":9007199254740993,"ratio":1.23000000000000000000000000001,"tiny":1e-999999}],"note":"brace } and \"quoted\"","fx":{"USD":"7.1800000001"}}`;
        const response =
          '{"other":{"ledger":"decoy"},"revision":12,"ledger":' +
          ledger +
          ',"state":"completed"}';
        assert.equal(m.rawSimpleLedgerField(response, "ledger"), ledger);
        assert.notEqual(JSON.stringify(JSON.parse(ledger)), ledger);
        assert.ok(
          m
            .rawSimpleLedgerField(response, "ledger")
            .includes("9007199254740993"),
        );
        assert.ok(
          m
            .rawSimpleLedgerField(response, "ledger")
            .includes("1.23000000000000000000000000001"),
        );
        assert.ok(
          m.rawSimpleLedgerField(response, "ledger").includes("1e-999999"),
        );
        assert.throws(
          () => m.rawSimpleLedgerField('{"revision":0}', "ledger"),
          /ledger/,
        );
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
