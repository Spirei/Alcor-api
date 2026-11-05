import { useState } from "react";
import { SelectMenu } from "./select-menu";
import {
  PrivateSettingFields,
  type PrivateField,
  type SecretChange,
} from "./private-setting-fields";
const channels = [
  { value: "wechat", label: "企业微信" },
  { value: "telegram", label: "Telegram" },
  { value: "feishu", label: "飞书" },
  { value: "qq", label: "QQ" },
  { value: "discord", label: "Discord" },
  { value: "webPush", label: "WebPush" },
];
const fields: Record<
  string,
  [string, string, "string" | "boolean" | "secret"][]
> = {
  wechat: [
    ["Enabled", "启用企业微信", "boolean"],
    ["Name", "渠道名称", "string"],
    ["SmartRobot", "智能机器人", "boolean"],
    ["CorpId", "企业编号", "string"],
    ["AgentId", "应用编号", "string"],
    ["Secret", "应用密钥", "secret"],
    ["ProxyUrl", "代理地址", "string"],
    ["Token", "回调令牌", "secret"],
    ["AesKey", "回调加密密钥", "secret"],
    ["AdminIds", "管理员标识", "string"],
    ["Webhook", "机器人地址", "secret"],
  ],
  telegram: [
    ["Enabled", "启用 Telegram", "boolean"],
    ["Name", "渠道名称", "string"],
    ["Types", "通知类型", "string"],
    ["BotUsername", "机器人用户名", "string"],
    ["BotToken", "机器人令牌", "secret"],
    ["ChatId", "会话编号", "string"],
    ["UserIds", "用户白名单", "string"],
    ["AdminIds", "管理员白名单", "string"],
    ["ApiBase", "接口地址", "string"],
  ],
  feishu: [
    ["Enabled", "启用飞书", "boolean"],
    ["Name", "渠道名称", "string"],
    ["Types", "通知类型", "string"],
    ["AppId", "应用编号", "string"],
    ["AppSecret", "应用密钥", "secret"],
    ["OpenId", "用户 Open ID", "string"],
    ["ChatId", "群聊编号", "string"],
    ["AdminIds", "管理员标识", "string"],
    ["VerificationToken", "事件验证令牌", "secret"],
    ["EncryptKey", "事件加密密钥", "secret"],
    ["Webhook", "机器人地址", "secret"],
  ],
  qq: [
    ["Enabled", "启用 QQ", "boolean"],
    ["Name", "渠道名称", "string"],
    ["Types", "通知类型", "string"],
    ["AppId", "应用编号", "string"],
    ["AppSecret", "应用密钥", "secret"],
    ["UserOpenId", "用户 Open ID", "string"],
    ["GroupOpenId", "群聊 Open ID", "string"],
    ["AdminIds", "管理员标识", "string"],
  ],
  discord: [
    ["Enabled", "启用 Discord", "boolean"],
    ["Name", "渠道名称", "string"],
    ["Types", "通知类型", "string"],
    ["BotToken", "机器人令牌", "secret"],
    ["GuildId", "服务器编号", "string"],
    ["ChannelId", "频道编号", "string"],
    ["AdminIds", "管理员标识", "string"],
  ],
  webPush: [
    ["Enabled", "启用 WebPush", "boolean"],
    ["Name", "渠道名称", "string"],
    ["Types", "通知类型", "string"],
    ["Username", "显示用户名", "string"],
  ],
};
export function NotificationServiceFields({
  value,
  states,
  secrets,
  disabled,
  onChange,
  onSecret,
}: {
  value: Record<string, unknown>;
  states: Record<string, string>;
  secrets: Record<string, SecretChange>;
  disabled: boolean;
  onChange: (value: Record<string, unknown>) => void;
  onSecret: (key: string, value: SecretChange) => void;
}) {
  const [channel, setChannel] = useState("wechat");
  const metadata =
    value.legacyChannelSettings &&
    typeof value.legacyChannelSettings === "object"
      ? (value.legacyChannelSettings as Record<string, unknown>)
      : {};
  const definitions: PrivateField[] = fields[channel].map(
    ([suffix, label, type]) => ({
      key:
        type === "secret"
          ? `legacyChannelSettings.${channel}${suffix}`
          : channel + suffix,
      label,
      type,
      configured:
        states[`legacyChannelSettings.${channel}${suffix}`] === "configured",
    }),
  );
  return (
    <section className="private-notification-editor" aria-label="通知渠道设置">
      <div className="private-settings-toolbar">
        <h3>通知渠道</h3>
        <SelectMenu
          label="通知渠道"
          value={channel}
          options={channels}
          disabled={disabled}
          onChange={setChannel}
        />
      </div>
      <div className="form-grid">
        <PrivateSettingFields
          fields={definitions}
          value={metadata}
          secrets={secrets}
          disabled={disabled}
          onChange={(key, next) =>
            onChange({
              ...value,
              legacyChannelSettings: { ...metadata, [key]: next },
            })
          }
          onSecret={onSecret}
        />
      </div>
    </section>
  );
}
