import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

test("任务卡片只采用已知阶段，未知回执不生成百分比或完整成功", async () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  await mkdir(join(root, ".local"), { recursive: true });
  const directory = await mkdtemp(join(root, ".local", "operation-card-dom-"));
  try {
    const output = join(directory, "operation.cjs");
    await build({
      entryPoints: [
        fileURLToPath(
          new URL("../src/operation-task-card.tsx", import.meta.url),
        ),
      ],
      outfile: output,
      bundle: true,
      platform: "node",
      format: "cjs",
      jsx: "automatic",
      external: ["react", "react/jsx-runtime"],
      loader: { ".css": "empty" },
      logLevel: "silent",
    });
    const { OperationTaskCard, OperationHistory } = createRequire(
      import.meta.url,
    )(output);
    const props = {
      title: "首次导入",
      source: "迁移文件",
      target: "App 对应账号",
      steps: ["读取文件", "核对差异", "导入数据", "核对结果"],
    };
    const unknown = renderToStaticMarkup(
      React.createElement(OperationTaskCard, {
        ...props,
        state: "unknown",
        requestId: "original-request",
        message: "最终回执待核对",
      }),
    );
    assert.ok(unknown.includes("最终回执待核对"));
    assert.ok(unknown.includes("original-request"));
    assert.ok(!unknown.includes("aria-valuenow="));
    assert.ok(!unknown.includes('class="is-done"'));
    assert.ok(!unknown.includes("100%"));
    assert.ok(!unknown.includes("演示"));
    const active = renderToStaticMarkup(
      React.createElement(OperationTaskCard, {
        ...props,
        state: "running",
        currentStep: 1,
      }),
    );
    assert.equal((active.match(/class="is-done"/g) || []).length, 1);
    assert.ok(active.includes('aria-current="step"'));
    const done = renderToStaticMarkup(
      React.createElement(OperationTaskCard, { ...props, state: "success" }),
    );
    assert.equal((done.match(/class="is-done"/g) || []).length, 4);
    const message = "远端存储拒绝写入。\n保留原文件，最终上传结果未知。";
    const history = renderToStaticMarkup(
      React.createElement(OperationHistory, {
        items: [
          {
            id: "one",
            title: "创建备份",
            status: "failed",
            createdAt: "invalid-date",
            startedAt: "2026-11-06T12:00:00Z",
            finishedAt: "2026-11-06T11:59:00Z",
            message,
            requestId: "original-backup-request",
            fields: [{ label: "文件", value: "backup.enc" }],
            events: [
              { label: "文件已生成", at: "2026-11-06T12:00:00Z" },
              { label: "上传结果待核对", at: "invalid-date" },
            ],
          },
        ],
      }),
    );
    assert.ok(history.includes("用时未知"));
    assert.ok(!history.includes("Invalid Date"));
    assert.ok(history.includes(message));
    assert.ok(history.includes("backup.enc"));
    assert.ok(history.includes("original-backup-request"));
    assert.ok(history.includes("<details"));
    assert.ok(history.includes("上传结果待核对"));
    const noData = renderToStaticMarkup(
      React.createElement(OperationHistory, { items: [], error: "读取失败" }),
    );
    assert.ok(noData.includes('role="alert"'));
    assert.ok(!noData.includes("暂无任务记录"));
    const pair = renderToStaticMarkup(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(OperationTaskCard, { ...props, state: "idle" }),
        React.createElement(OperationTaskCard, { ...props, state: "idle" }),
      ),
    );
    const ids = [...pair.matchAll(/<h2 id="([^"]+)"/g)].map(
      (match) => match[1],
    );
    assert.equal(ids.length, 2);
    assert.notEqual(ids[0], ids[1]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
