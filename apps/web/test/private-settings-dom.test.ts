import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

test("private settings expose direct inputs without revealing retained credentials", async (t) => {
  const local = fileURLToPath(new URL("../../../.local/", import.meta.url));
  await mkdir(local, { recursive: true });
  const dir = await mkdtemp(join(local, "private-settings-dom-"));
  try {
    const output = join(dir, "ui.cjs");
    await build({
      stdin: {
        contents:
          'export {PrivateSettingFields} from "./src/private-setting-fields";export {NotificationServiceFields} from "./src/notification-service-fields";',
        resolveDir: fileURLToPath(new URL("../", import.meta.url)),
        loader: "tsx",
      },
      outfile: output,
      bundle: true,
      platform: "node",
      format: "cjs",
      jsx: "automatic",
      external: ["react", "react/jsx-runtime"],
      loader: { ".css": "empty" },
      logLevel: "silent",
    });
    const ui = createRequire(import.meta.url)(output),
      noop = () => {};
    const field = {
      key: "smtpPassword",
      label: "SMTP 密码",
      type: "secret",
      configured: true,
    };
    const render = (secrets: unknown) =>
      renderToStaticMarkup(
        React.createElement(ui.PrivateSettingFields, {
          fields: [field],
          value: { smtpPassword: "NeverExpose9" },
          secrets,
          disabled: false,
          onChange: noop,
          onSecret: noop,
        }),
      );
    await t.test(
      "configured secret is directly editable, retained value never appears",
      () => {
        const html = render({});
        assert.match(html, /type="password"/);
        assert.match(html, /留空保留当前值/);
        assert.match(html, /value=""/);
        assert.doesNotMatch(
          html,
          /NeverExpose9|<select|选择替换|替换<\/option>/,
        );
      },
    );
    await t.test(
      "explicit clear disables entry and offers undo instead of a second mode selector",
      () => {
        const html = render({ smtpPassword: { mode: "clear", value: "" } });
        assert.match(html, /保存时清除/);
        assert.match(html, /撤销清除SMTP 密码/);
        assert.match(html, /<input[^>]*disabled=""/);
        assert.doesNotMatch(html, /NeverExpose9/);
      },
    );
    await t.test(
      "notification editor masks imported credential values and retains the channel name",
      () => {
        const html = renderToStaticMarkup(
          React.createElement(ui.NotificationServiceFields, {
            value: {
              legacyChannelSettings: {
                wechatName: "本人渠道",
                wechatSecret: "NeverExpose9",
                wechatAesKey: "NeverExposeAes",
              },
            },
            states: { "legacyChannelSettings.wechatSecret": "configured" },
            secrets: {},
            disabled: false,
            onChange: noop,
            onSecret: noop,
          }),
        );
        assert.match(html, /value="本人渠道"/);
        assert.match(html, /应用密钥/);
        assert.match(html, /回调加密密钥/);
        assert.doesNotMatch(html, /NeverExpose9|NeverExposeAes/);
        assert.equal((html.match(/type="password"/g) || []).length, 4);
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
