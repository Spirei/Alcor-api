import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { fontDigest } from "../src/personal-font-digest.ts";
import {
  fontFamily,
  parseAppearance,
  defaultAppearance,
} from "../src/appearance-preferences.ts";
import {
  isPersonalFontId,
  personalFontFamily,
} from "../src/personal-font-id.ts";
import {
  clearFontRequests,
  readFontRequest,
  retainFontRequest,
  releaseFontRequest,
  fontListing,
  fontReceipt,
  fontForm,
  personalFont,
} from "../src/personal-font-state.ts";
const request = "448fca63-e431-4968-86c0-d701c60046bf",
  other = "558fca63-e431-4968-86c0-d701c60046bf",
  sha = "a".repeat(64),
  id = `custom-1-${sha}.ttf` as const;
const font = {
  id,
  name: "Synthetic",
  sha256: sha,
  size: 48,
  mediaType: "font/ttf",
  contentPath: "/api/personal-fonts/" + id + "/content",
  originalPath: "/api/personal-fonts/" + id + "/original",
};
function storage() {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
}
test("font journal retains only original UUID and never overwrites unknown upload; account changes clear only its namespace", () => {
  const s = storage();
  s.setItem("other:scope", "keep");
  retainFontRequest(s, "owner", request);
  assert.equal(s.getItem("alcor.personal-font-request:owner"), request);
  assert.throws(() => retainFontRequest(s, "owner", other), /核对原/);
  releaseFontRequest(s, "owner", other);
  assert.equal(readFontRequest(s, "owner"), request);
  assert.equal(readFontRequest(s, "next"), null);
  assert.equal(s.length, 1);
  retainFontRequest(s, "next", other);
  clearFontRequests(s);
  assert.equal(s.getItem("other:scope"), "keep");
});
test("font byte metadata cannot inject paths, mismatch SHA/MIME or turn missing listing into known zero", () => {
  assert.equal(personalFont(font), font);
  for (const change of [
    { originalPath: "https://unapproved.example.invalid/font.ttf" },
    { sha256: "b".repeat(64) },
    { mediaType: "text/html" },
    { size: 0 },
    { id: id + ";color:red" },
  ])
    assert.throws(() => personalFont({ ...font, ...change }));
  const rows = {
    fonts: [font],
    revision: 1,
    maxBytes: 10485760,
    maxFonts: 20,
    formats: ["woff", "woff2", "ttf", "otf"],
  };
  assert.equal(fontListing(rows).fonts.length, 1);
  assert.throws(() => fontListing({ ...rows, fonts: null }));
  assert.throws(() => fontListing({ ...rows, fonts: [font, font] }));
  assert.throws(() =>
    fontListing({ ...rows, formats: ["ttf", "ttf", "otf", "woff"] }),
  );
});
test("upload form preserves original UUID/current revision/file exactly and refuses invalid type or size before POST", () => {
  const file = new File([new Uint8Array(48)], "fixture.TTF"),
    body = fontForm(file, request, 3);
  assert.equal(body.get("file"), file);
  assert.equal(body.get("requestId"), request);
  assert.equal(body.get("expectedRevision"), "3");
  assert.deepEqual([...body.keys()], ["file", "requestId", "expectedRevision"]);
  assert.throws(
    () => fontForm(new File(["short"], "short.ttf"), request, 0),
    /10 MB/,
  );
  assert.throws(
    () => fontForm(new File([new Uint8Array(48)], "font.html"), request, 0),
    /WOFF/,
  );
  assert.throws(() => fontForm(file, request, -1), /修订/);
});
test("completed and explicit closed receipts are terminal but another UUID or fake completed font is rejected", () => {
  const value = {
    requestId: request,
    kind: "upload",
    state: "completed",
    httpStatus: 200,
    revision: 1,
    message: "ok",
    font,
    deduplicated: false,
  };
  assert.equal(fontReceipt(value, request).font?.id, id);
  assert.throws(() => fontReceipt(value, other));
  assert.throws(() => fontReceipt({ ...value, font: undefined }, request));
  assert.throws(() => fontReceipt({ ...value, canceled: true }, request));
  assert.equal(
    fontReceipt(
      {
        requestId: request,
        kind: "upload",
        state: "failed",
        httpStatus: 409,
        revision: 0,
        message: "closed",
        canceled: true,
      },
      request,
    ).canceled,
    true,
  );
});
test("controlled custom IDs roundtrip in existing per-mode appearance; arbitrary CSS/URL stays rejected and builtins remain available", () => {
  const prefs = defaultAppearance();
  prefs.separateModes = true;
  prefs.light.font = id;
  prefs.dark.font = "serif";
  prefs.contentFont = id;
  assert.deepEqual(parseAppearance(JSON.parse(JSON.stringify(prefs))), prefs);
  assert.ok(fontFamily(id).startsWith('"alcor-personal-font-' + sha + '"'));
  assert.ok(fontFamily("system").includes("sans-serif"));
  assert.equal(personalFontFamily(id, true), "alcor-personal-preview-" + sha);
  for (const bad of [
    "custom-0-" + sha + ".ttf",
    id + ";color:red",
    "url(https://unapproved.example.invalid/font.woff2)",
    id + "?token=secret",
  ])
    assert.equal(isPersonalFontId(bad), false);
  const wrong = parseAppearance({
    version: 1,
    shared: { font: "url(x)" },
    contentFont: "url(y)",
  });
  assert.equal(wrong.shared.font, "system");
  assert.equal(wrong.contentFont, "same");
});
test("portable SHA256 matches Node for padding boundaries, 1MiB and actual 10MiB; canceled integrity work cannot finish as success", async () => {
  for (const size of [0, 1, 55, 56, 63, 64, 65, 1024, 1048576, 10485760]) {
    const bytes = Uint8Array.from(
      { length: size },
      (_, i) => (i * 17 + 3) % 256,
    );
    assert.equal(
      await fontDigest(bytes),
      createHash("sha256").update(bytes).digest("hex"),
    );
  }
  let calls = 0;
  await assert.rejects(
    fontDigest(new Uint8Array(2097152), () => ++calls < 3),
    /停止/,
  );
  await assert.rejects(fontDigest(new Uint8Array(10485761)), /预算/);
});
