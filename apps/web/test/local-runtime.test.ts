import assert from "node:assert/strict";
import test from "node:test";
import {
  localOptions,
  ownedRuntimeCommand,
  launcherTitle,
  ownedLauncherCommand,
} from "../../../tools/local-options.mjs";

const interfaces = {
  en1: [{ address: "10.23.45.67", internal: false }],
  lo0: [{ address: "127.0.0.1", internal: true }],
};

test("long PM2 project paths have a short exact title without accepting another project", () => {
  const root = "/project/" + "long-directory/".repeat(12);
  const title = launcherTitle(root);
  assert.ok(title.length < 40);
  assert.equal(ownedLauncherCommand(title + " name=alcor-api", root), true);
  assert.equal(
    ownedLauncherCommand(launcherTitle(root + "other"), root),
    false,
  );
  assert.equal(
    ownedLauncherCommand("node " + root + "tools/start-local.m", root),
    false,
  );
});

test("default local startup stays on loopback", () => {
  assert.deepEqual(localOptions([], interfaces), {
    host: "127.0.0.1",
    port: 8088,
    origin: "http://127.0.0.1:8088",
    runtimeArgs: [],
  });
});

test("explicit LAN startup binds its exact assigned address and origin", () => {
  assert.deepEqual(
    localOptions(["--lan", "10.23.45.67", "--port", "8098"], interfaces),
    {
      host: "10.23.45.67",
      port: 8098,
      origin: "http://10.23.45.67:8098",
      runtimeArgs: ["--lan", "10.23.45.67", "--port", "8098"],
    },
  );
});

test("startup rejects unassigned, public, wildcard, duplicate and malformed targets", () => {
  for (const args of [
    ["--lan", "10.23.45.68"],
    ["--lan", "8.8.8.8"],
    ["--lan", "0.0.0.0"],
    ["--lan", "127.0.0.1"],
    ["--lan", "10.23.45.67:8088"],
    ["--lan", "10.23.45.67", "--lan", "10.23.45.67"],
    ["--port", "80"],
    ["--port", "65536"],
    ["--port", "NaN"],
    ["--lan"],
    ["--unknown", "1"],
  ])
    assert.throws(() => localOptions(args, interfaces));
});

test("owned runtime matching accepts old LAN args without claiming another command", () => {
  const expected = "/project/.venv/bin/python tools/local-runtime.py";
  assert.equal(ownedRuntimeCommand(expected, expected), true);
  assert.equal(ownedRuntimeCommand(expected + " --vite", expected), true);
  assert.equal(
    ownedRuntimeCommand(
      expected + " --lan 10.23.45.67 --port 8098",
      expected,
    ),
    true,
  );
  for (const tail of [
    " --lan 8.8.8.8",
    " --lan 10.23.45.67 --unknown",
    " --port 80",
    "x",
  ])
    assert.equal(ownedRuntimeCommand(expected + tail, expected), false);
});
