import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
test("actual watch-group SSR exposes member preferences while preserving market/ownership/financial unknown boundaries", async (t) => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  await mkdir(join(root, ".local"), { recursive: true });
  const dir = await mkdtemp(join(root, ".local/watch-group-dom-"));
  try {
    const output = join(dir, "groups.cjs");
    await build({
      entryPoints: [
        fileURLToPath(new URL("../src/watch-groups.tsx", import.meta.url)),
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
    const m = createRequire(import.meta.url)(output),
      market = {
        id: "market-owned",
        name: "美股",
        kind: "market",
        market: "US",
        sort: 0,
        visible: -1,
        revision: 1,
      },
      custom = {
        id: "custom-owned",
        name: "观察",
        kind: "custom",
        market: "",
        sort: 1,
        visible: 0,
        revision: 2,
      };
    await t.test(
      "administrator and ordinary member have the same personal create/assignment/UUID entry without administrator assets",
      () => {
        for (const role of ["admin", "user"]) {
          const html = renderToStaticMarkup(
            React.createElement(m.WatchGroupsPage, {
              session: {
                instance_id: "synthetic",
                user: { id: "synthetic", role },
                receipt_scope: "scope",
                csrf: "synthetic",
              },
            }),
          );
          assert.equal((html.match(/<h1>/g) || []).length, 1);
          for (const label of ["自选分组", "创建分组", "记录归属", "查询回执"])
            assert.ok(html.includes(label));
          for (const prohibited of [
            "需要管理员",
            "共享素材",
              "已迁移",
            "初始化市场分组",
          ])
            assert.ok(!html.includes(prohibited));
        }
      },
    );
    await t.test(
      "real preference rows preserve auto/visible/hidden controls; market deletion and icons are absent",
      () => {
        const html = renderToStaticMarkup(
          React.createElement(m.WatchGroupRows, {
            groups: [market, custom],
            all: [market, custom],
            disabled: false,
            edits: {},
            onEdit() {},
            onSave() {},
            onDelete() {},
            onReorder() {},
          }),
        );
        for (const label of [
          "自动（空分组隐藏）",
          "显示",
          "隐藏",
          "保存",
          "自定义分组",
          "市场分组",
          "删除观察",
          "观察上移",
        ])
          assert.ok(html.includes(label));
        assert.ok(!html.includes('aria-label="删除美股"'));
        assert.ok(!html.includes("<img"));
        assert.ok(!html.includes('type="file"'));
      },
    );
    await t.test(
      "record membership shows unknown original group identity without invented holdings or totals",
      () => {
        const html = renderToStaticMarkup(
          React.createElement(m.WatchGroupRecords, {
            records: {
              records: [
                {
                  id: "mapped-platform-record",
                  name: "合成记录",
                  market: "US",
                  code: "SYN",
                  watchGroupId: "source-id-without-mapping",
                  qty: "99999",
                  price: "88888",
                },
              ],
              total: 1,
              page: 1,
              pageSize: 25,
              collectionRevision: 9,
            },
            groups: [custom],
            selected: [],
            disabled: false,
            onSelect() {},
          }),
        );
        assert.ok(html.includes("分组待核对 · source-id-without-mapping"));
        assert.ok(html.includes('type="checkbox"'));
        assert.ok(!html.includes("99999"));
        assert.ok(!html.includes("88888"));
        assert.ok(!html.includes("未分组"));
      },
    );
    await t.test("server watch page order and membership are not replaced by an older local display snapshot", () => {
      const html=renderToStaticMarkup(React.createElement(m.WatchGroupRecords,{
        records:{records:[{id:"first",name:"BackendFirst",market:"US",code:"AAA",watchGroupId:"custom-owned"},{id:"second",name:"BackendSecond",market:"US",code:"BBB",watchGroupId:"custom-owned"}],total:2,page:1,pageSize:25,collectionRevision:1,displayMode:"watch",displayRevision:"a".repeat(64)},
        display:{version:1,userId:"synthetic",namespace:"watch",fields:{'["hidden","first"]':{revision:1,value:true},'["pinned","second"]':{revision:1,value:true}}},
        groups:[custom],selected:[],disabled:false,onSelect(){},
      }));
      assert.ok(html.includes("BackendFirst"));
      assert.ok(html.indexOf("BackendFirst")<html.indexOf("BackendSecond"));
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
