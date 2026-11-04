import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

test("selection controls keep missing choices explicit without inventing a selected value", async (t) => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  await mkdir(join(root, ".local"), { recursive: true });
  const tmp = await mkdtemp(join(root, ".local/select-menu-"));
  try {
    const output = join(tmp, "select.cjs");
    await build({
      entryPoints: [join(root, "apps/web/src/select-menu.tsx")],
      outfile: output,
      bundle: true,
      platform: "node",
      format: "cjs",
      jsx: "automatic",
      external: ["react", "react/jsx-runtime"],
      logLevel: "silent",
    });
    const { SelectMenu } = createRequire(import.meta.url)(output);
    const render = (
      value: string,
      options: { value: string; label: string }[],
    ) =>
      renderToStaticMarkup(
        React.createElement(SelectMenu, {
          label: "来源",
          value,
          options,
          onChange() {},
        }),
      );
    await t.test(
      "an empty option list renders a disabled control instead of crashing",
      () => {
        const html = render("", []);
        assert.match(html, /aria-label="来源：暂无可选项"/);
        assert.match(html, /disabled=""/);
      },
    );
    await t.test(
      "a missing saved choice never masquerades as the first available option",
      () => {
        const html = render("retired", [{ value: "new", label: "新来源" }]);
        assert.match(html, /aria-label="来源：当前选项不可用"/);
        assert.doesNotMatch(html, /aria-selected="true"/);
      },
    );
    await t.test(
      "an unset value asks for a choice and a valid saved value stays selected",
      () => {
        const options = [
          { value: "a", label: "来源甲" },
          { value: "b", label: "来源乙" },
        ];
        assert.match(render("", options), /aria-label="来源：请选择"/);
        const valid = render("b", options);
        assert.match(valid, /aria-label="来源：来源乙"/);
        assert.equal((valid.match(/aria-selected="true"/g) || []).length, 1);
      },
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
