import assert from "node:assert/strict";
import test from "node:test";
import {
  legacyImportLabel,
  requestSnapshot,
} from "../src/request-observation-state.ts";

const legacy = {
  detailRows: 0,
  dailyCells: 0,
  hourCells: 0,
  historicalCoverageKnown: false as const,
  hourDurationKnown: false as const,
};

test("empty request history stays unimported and coverage stays unknown", () => {
  assert.equal(legacyImportLabel(legacy), "旧请求历史尚未导入");
  assert.equal(
    legacyImportLabel({ ...legacy, detailRows: 500, hourCells: 4 }),
    "已单独导入明细 500 条、小时汇总 4 格，不含时长，未计入本次汇总；历史是否完整尚未核对",
  );
  assert.throws(
    () => legacyImportLabel({ ...legacy, historicalCoverageKnown: true }),
    /完整范围|导入状态/,
  );
});

test("request snapshot rejects a claim that imported history is complete", () => {
  const value = {
    localCollector: {
      running: false,
      buffered: 0,
      storageAvailable: true,
      scope: "this_process",
    },
    revision: 1,
    aggregateRevision: 1,
    summary: {
      total: 0,
      errors: 0,
      serverErrors: 0,
      averageMs: 0,
      sources: {},
    },
    logs: [],
    pagination: { page: 1, pageSize: 20, total: 0, anchor: 1 },
    detailGap: false,
    rollupPending: false,
    observedOnly: true,
    lostBuffered: 0,
    crashLossKnown: false,
    chart: [],
    chartUnit: "day",
    endpoints: [],
    heatmap: {},
    legacyImport: legacy,
  };
  assert.equal(
    requestSnapshot(value).legacyImport.historicalCoverageKnown,
    false,
  );
  assert.throws(() =>
    requestSnapshot({
      ...value,
      legacyImport: { ...legacy, hourDurationKnown: true },
    }),
  );
  assert.throws(() => requestSnapshot({ ...value, legacyImport: undefined }));
});
