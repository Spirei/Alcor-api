import assert from "node:assert/strict";
import test from "node:test";
import {
  currentNavigationSection,
  mobileNavigation,
  workspaceNavigation,
} from "../src/site-navigation.ts";

test("workspace sections preserve every supplied route and never restore a filtered administrator entry", () => {
  const items = [
    "/settings",
    "/shared-assets",
    "/portfolio",
    "/account",
    "/feed",
    "/resources",
    "/future",
  ].map((path) => ({ path }));
  const sections = workspaceNavigation(items);
  assert.deepEqual(
    sections.map((s) => s.label),
    ["资产", "管理", "系统", "其他"],
  );
  assert.deepEqual(
    sections[0].items.map((i) => i.path),
    ["/portfolio", "/feed"],
  );
  assert.deepEqual(
    sections[1].items.map((i) => i.path),
    ["/shared-assets", "/resources"],
  );
  assert.deepEqual(
    sections
      .flatMap((s) => s.items)
      .map((i) => i.path)
      .sort(),
    items.map((i) => i.path).sort(),
  );
  const member = workspaceNavigation(
    items.filter((i) => i.path !== "/shared-assets"),
  );
  assert.ok(
    !member.flatMap((s) => s.items).some((i) => i.path === "/shared-assets"),
  );
  assert.deepEqual(workspaceNavigation([]), []);
  assert.deepEqual(
    workspaceNavigation([{ path: "/account" }]).map((s) => s.label),
    ["系统"],
  );
  assert.equal(items[0].path, "/settings");
});

test("mobile preferences order whole sections and entries without interleaving or duplicating them", () => {
  const items = [
    "/settings",
    "/shared-assets",
    "/portfolio",
    "/feed",
    "/market",
    "/activity",
  ].map((path) => ({ path }));
  const ordered = mobileNavigation(
    items,
    ["library", "trading", "holdings", "global"],
    true,
  );
  const groups = workspaceNavigation(ordered, true);
  assert.deepEqual(
    groups.map((s) => s.label),
    ["管理", "资产", "系统"],
  );
  assert.deepEqual(
    groups[1].items.map((i) => i.path),
    ["/feed", "/portfolio", "/market"],
  );
  assert.equal(
    new Set(groups.flatMap((s) => s.items).map((i) => i.path)).size,
    items.length,
  );
  assert.deepEqual(
    workspaceNavigation(ordered).map((s) => s.label),
    ["资产", "管理", "系统"],
  );
});

test("child pages reveal their authorized parent category without fabricating entries", () => {
  const sections = workspaceNavigation(["/", "/portfolio", "/shared-assets"].map(path => ({ path })));
  assert.equal(currentNavigationSection(sections, "/connections/postgresql/explorer"), "system");
  assert.equal(currentNavigationSection(sections, "/deploy-status"), "system");
  assert.equal(currentNavigationSection(sections, "/shared-assets"), "management");
  assert.equal(currentNavigationSection(sections, "/portfolio"), "assets");
  assert.equal(currentNavigationSection(sections, "/not-registered"), undefined);
  assert.equal(currentNavigationSection(workspaceNavigation([{ path: "/portfolio" }]), "/connections/redis"), undefined);
});
