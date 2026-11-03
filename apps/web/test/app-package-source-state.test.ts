import assert from "node:assert/strict";
import test from "node:test";
import {
  sourceCatalog,
  sourceCatalogLabel,
  sourceIndex,
  sourceIndexLabel,
  sourcePreview,
  sourceRowLabel,
} from "../src/app-package-source-state.ts";

const ready = {
  originalId: "1".repeat(32),
  name: "Historical.ipa",
  platform: "iOS",
  size: 28,
  createdAt: "2026-01-02T03:04:05.000Z",
  revision: "a".repeat(64),
  state: "ready_for_capture",
  contentVerified: false,
  historicalUploaderVerified: false,
};

test("an unconfigured package source stays unregistered", () => {
  const index = sourceIndex({
    configuration: { state: "not_configured" },
    sources: [],
  });
  assert.equal(sourceIndexLabel(index), "尚未登记安装包来源");
  assert.equal(
    sourceIndexLabel(
      sourceIndex({
        configuration: { state: "configured" },
        sources: [{ sourceAlias: "synthetic-ops" }],
      }),
    ),
    "已登记 1 个来源",
  );
});

test("a package source page never treats capture or a finished scan as a verified uploader", () => {
  const catalog = sourceCatalog({
    sourceAlias: "synthetic-ops",
    revision: "b".repeat(64),
    truncated: false,
    scanComplete: true,
    captured: false,
    ignoredEntries: 2,
    rows: [
      ready,
      {
        ...ready,
        originalId: "2".repeat(32),
        state: "captured",
        contentVerified: true,
      },
      {
        originalId: "3".repeat(32),
        state: "blocked",
        reason: "source_metadata_or_original_invalid",
        contentVerified: false,
        historicalUploaderVerified: false,
      },
    ],
  });
  assert.equal(
    sourceCatalogLabel(catalog),
    "已保存 1 个原件，可预览 1 个，1 个未能核对，另有 2 项未识别。历史上传人尚未核验",
  );
  assert.equal(
    sourceRowLabel(catalog.rows[0]),
    "可预览原件，历史上传人尚未核验",
  );
  assert.equal(
    sourceRowLabel(catalog.rows[1]),
    "已保存原件，历史上传人尚未核验",
  );
  assert.equal(sourceRowLabel(catalog.rows[2]), "原件未能核对");
  assert.throws(
    () => sourceCatalog({ ...catalog, captured: true }),
    /安装包来源无效/,
  );
  assert.throws(
    () =>
      sourceCatalog({
        ...catalog,
        rows: [{ ...ready, historicalUploaderVerified: true }],
      }),
    /安装包来源无效/,
  );
  assert.equal(
    sourceCatalogLabel(
      sourceCatalog({
        ...catalog,
        rows: [],
        truncated: true,
        scanComplete: false,
        ignoredEntries: 0,
      }),
    ),
    "此页没有可捕获的原件。历史上传人尚未核验，目录尚未读完",
  );
});

test("preview and saved receipts keep the original request and reject a verified uploader", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const preview = sourcePreview(
    {
      requestId: id,
      originalId: ready.originalId,
      sourceAlias: "synthetic-ops",
      name: ready.name,
      platform: "iOS",
      size: 28,
      sha256: "c".repeat(64),
      sourceCreatedAt: ready.createdAt,
      contentVerified: true,
      historicalUploaderVerified: false,
      state: "preview",
    },
    id,
    ready.originalId,
  );
  assert.equal(preview.state, "preview");
  assert.equal(
    sourcePreview({ ...preview, state: "captured" }, id, ready.originalId)
      .state,
    "captured",
  );
  assert.throws(
    () =>
      sourcePreview(
        { ...preview, historicalUploaderVerified: true },
        id,
        ready.originalId,
      ),
    /安装包来源无效/,
  );
  assert.throws(
    () => sourcePreview(preview, id, "4".repeat(32)),
    /安装包来源无效/,
  );
});
