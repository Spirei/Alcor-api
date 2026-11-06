import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

test("实际页面按回执展示备份、授权与当前服务核对，不将初始化或未知结果冒充完成", async (t) => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const local = join(root, ".local");
  await mkdir(local, { recursive: true });
  const directory = await mkdtemp(join(local, "operation-integration-"));
  const requestId = "11111111-1111-4111-8111-111111111111";
  const session = {
    instance_id: "fixture-instance",
    csrf: "fixture-csrf",
    receipt_scope: "fixture-scope",
    expires_at: "2026-11-07T00:00:00Z",
    user: { id: "fixture-owner", username: "Fixture", role: "admin" },
  };
  const globals = globalThis as typeof globalThis & {
    __operationSnapshot?: (path: string) => unknown;
  };
  const previous = {
    document: Object.getOwnPropertyDescriptor(globalThis, "document"),
    sessionStorage: Object.getOwnPropertyDescriptor(
      globalThis,
      "sessionStorage",
    ),
    fetch: globalThis.fetch,
    snapshot: globals.__operationSnapshot,
  };
  let fetchCount = 0;
  try {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { hidden: false },
    });
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: {
        getItem: (key: string) =>
          key.startsWith("alcor.backup.") ? requestId : null,
      },
    });
    globalThis.fetch = async () => {
      fetchCount++;
      throw new Error("SSR must not perform a real read or write");
    };
    const output = join(directory, "pages.cjs");
    await build({
      stdin: {
        contents: [
          'export { BackupsPage } from "./src/backups";',
          'export { AuthorizePage } from "./src/client-access";',
          'export { NativeAppAuthorize } from "./src/native-app-authorize";',
          'export { AccountSyncStatus } from "./src/account-sync-status";',
          'export { PersonalDataTransfer } from "./src/personal-data-transfer";',
          'export { AccountOperationHistory } from "./src/account-operation-history";',
        ].join("\n"),
        resolveDir: fileURLToPath(new URL("../", import.meta.url)),
        loader: "tsx",
      },
      outfile: output,
      bundle: true,
      platform: "node",
      format: "cjs",
      jsx: "automatic",
      external: ["react", "react/jsx-runtime", "react-dom", "react-router-dom"],
      loader: { ".css": "empty" },
      define: {
        "import.meta.env.VITE_UI_PERF": '"0"',
        "import.meta.env.VITE_UI_DELAY_MS": '""',
      },
      plugins: [
        {
          name: "synthetic-read-snapshots",
          setup(builder) {
            builder.onResolve({ filter: /^\.\/hooks$/ }, () => ({
              path: "hooks",
              namespace: "synthetic-read-snapshots",
            }));
            builder.onLoad(
              { filter: /.*/, namespace: "synthetic-read-snapshots" },
              () => ({
                loader: "js",
                contents:
                  "export function useResource(path) { return globalThis.__operationSnapshot(path); } export function useTaskInvalidation() { return () => {}; }",
              }),
            );
          },
        },
      ],
      logLevel: "silent",
    });
    const module = createRequire(import.meta.url)(output);
    const render = (
      Component: React.ComponentType<any>,
      props: Record<string, unknown>,
      path = "/",
    ) =>
      renderToStaticMarkup(
        React.createElement(
          MemoryRouter,
          { initialEntries: [path] },
          React.createElement(Component, props),
        ),
      );
    const snapshot = (data: unknown, error = "") => ({
      data,
      error,
      refreshing: false,
      updatedAt: null,
      reload() {},
    });
    const task = (status: string) => ({
      id: "22222222-2222-4222-8222-222222222222",
      owner_id: session.user.id,
      request_id: requestId,
      kind: "backup.create",
      status,
      attempts: 1,
      result: null,
      error_code: null,
      created_at: "2026-11-06T10:00:00Z",
      started_at: status === "queued" ? null : "2026-11-06T10:00:01Z",
      finished_at: status === "succeeded" ? "2026-11-06T10:00:12Z" : null,
    });
    await t.test("备份只用实际任务状态；未知和取消不出现全部成功阶段", () => {
      for (const [status, expectedState, expectedDone] of [
        ["queued", "idle", 0],
        ["running", "running", 1],
        ["succeeded", "success", 4],
        ["failed", "failed", 0],
        ["cancelled", "idle", 0],
      ] as const) {
        globals.__operationSnapshot = (path) =>
          snapshot(
            path === "/backups"
              ? { items: [], targets: [], configured: true }
              : task(status),
          );
        const html = render(module.BackupsPage, { session }, "/backups");
        assert.ok(html.includes(`data-state="${expectedState}"`), status);
        assert.equal(
          (html.match(/class="is-done"/g) || []).length,
          expectedDone,
          status,
        );
        assert.ok(html.includes(requestId));
        assert.ok(!html.includes("100%"));
      }
      globals.__operationSnapshot = (path) =>
        path === "/backups"
          ? snapshot({ items: [], targets: [], configured: true })
          : snapshot(null, "结果读取失败");
      const unknown = render(module.BackupsPage, { session }, "/backups");
      assert.ok(unknown.includes('data-state="unknown"'));
      assert.ok(unknown.includes("结果待核对"));
      assert.ok(!unknown.includes('class="is-done"'));
    });
    await t.test("iOS 授权页保留请求与回调核对，不把待授权显示为已连接", () => {
      const params = new URLSearchParams({
        client_id: "fire-ios",
        redirect_uri: "com.fire.app:/oauth/callback",
        response_type: "code",
        scope: "portfolio.read",
        state: "A".repeat(32),
        code_challenge: "A".repeat(43),
        code_challenge_method: "S256",
      });
      const html = render(module.NativeAppAuthorize, {
        session,
        query: "?" + params,
      });
      assert.ok(html.includes("App 连接 API"));
      assert.ok(html.includes("等待本人授权"));
      assert.ok(!html.includes('data-state="success"'));
      assert.ok(html.includes("允许连接"));
    });
    await t.test(
      "授权预览只能确认服务发现，不能宣称 App 已连接或已同步",
      () => {
        globals.__operationSnapshot = () =>
          snapshot({
            name: "Synthetic App",
            redirect_uri: "https://client.example/callback",
            scopes: { "profile.read": "读取资料" },
          });
        const html = render(module.AuthorizePage, {
          session,
          query:
            "?client_id=synthetic&redirect_uri=https%3A%2F%2Fclient.example%2Fcallback",
        });
        assert.ok(html.includes("API 连接授权"));
        assert.ok(html.includes('data-state="confirm"'));
        assert.ok(html.includes("等待本人授权"));
        assert.equal((html.match(/class="is-done"/g) || []).length, 1);
        assert.ok(!html.includes('data-state="success"'));
        assert.ok(!html.includes("同步完成"));
      },
    );
    await t.test(
      "同步视图首次读取前不提供完成证明，隐藏模块不显示任务卡片",
      () => {
        const html = render(module.AccountSyncStatus, {
          session,
          active: true,
          onOpenDevices() {},
        });
        assert.ok(html.includes("同步状态核对"));
        assert.ok(html.includes("仅监测当前服务"));
        assert.ok(html.includes('data-state="idle"'));
        assert.ok(!html.includes('class="is-done"'));
        assert.ok(!html.includes("跨端同步完成"));
        const hidden = render(module.AccountSyncStatus, {
          session,
          active: false,
          onOpenDevices() {},
        });
        assert.ok(!hidden.includes('class="operation-task-card"'));
        assert.ok(!hidden.includes('class="operation-history"'));
      },
    );
    await t.test(
      "导入入口和四类历史只呈现真实初始态，没有示例交易或历史记录",
      () => {
        const html = render(module.PersonalDataTransfer, {
          session,
          active: true,
        });
        assert.ok(html.includes("个人 JSON"));
        assert.ok(html.includes("正在读取任务记录"));
        assert.ok(!html.includes('class="operation-task-card"'));
        assert.ok(!html.includes("新增 12"));
        for (const kind of ["import", "api", "sync", "backup"]) {
          const shown = render(module.AccountOperationHistory, {
            session,
            kind,
            active: true,
          });
          assert.ok(shown.includes("正在读取任务记录"));
          assert.ok(!shown.includes("暂无任务记录"));
          const hidden = render(module.AccountOperationHistory, {
            session,
            kind,
            active: false,
          });
          assert.equal(hidden, "");
        }
      },
    );
    assert.equal(fetchCount, 0);
  } finally {
    globalThis.fetch = previous.fetch;
    for (const name of ["document", "sessionStorage"] as const) {
      const descriptor = previous[name];
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
    if (previous.snapshot) globals.__operationSnapshot = previous.snapshot;
    else delete globals.__operationSnapshot;
    await rm(directory, { recursive: true, force: true });
  }
});
