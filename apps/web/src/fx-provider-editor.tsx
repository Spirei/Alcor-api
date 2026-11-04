import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { SelectMenu } from "./select-menu";
export type CustomProvider =
  | { type: "builtin" }
  | {
      url: string;
      bearer?: string;
      declared_base?: string;
      approval: {
        target: [string, string, number, string];
        addresses: string[];
        allow_plaintext: boolean;
      };
      time_field?: string;
      time_precision?: string;
      schedule?: { pattern: string; timezone: string };
    };
export function FxProviderEditor({
  active,
  currentUrl = "",
  disabled,
  onChange,
}: {
  active: boolean;
  currentUrl?: string;
  disabled: boolean;
  onChange: (value: CustomProvider | undefined) => void;
}) {
  const [builtin, setBuiltin] = useState(false);
  const [replace, setReplace] = useState(false);
  const [url, setUrl] = useState(currentUrl);
  const [bearer, setBearer] = useState("");
  const [addresses, setAddresses] = useState("");
  const [base, setBase] = useState("");
  const [field, setField] = useState("");
  const [precision, setPrecision] = useState("date");
  const [pattern, setPattern] = useState("");
  const [timezone, setTimezone] = useState("");
  const [approved, setApproved] = useState(false);
  const [show, setShow] = useState(false);
  const [showBearer, setShowBearer] = useState(false);
  useEffect(() => {
    if (!active) {
      setShow(false);
      setShowBearer(false);
      setApproved(false);
      setUrl("");
      setBearer("");
      setReplace(false);
      setBuiltin(false);
      setAddresses("");
      setBase("");
      setField("");
      setPrecision("date");
      setPattern("");
      setTimezone("");
    }
  }, [active]);
  useEffect(() => {
    if (!active) {
      onChange(undefined);
      return;
    }
    if (builtin) {
      onChange({ type: "builtin" });
      return;
    }
    if (!replace) {
      onChange(undefined);
      return;
    }
    let target: [string, string, number, string] = ["", "", 0, ""];
    try {
      const parsed = new URL(url);
      target = [
        parsed.protocol.slice(0, -1),
        parsed.hostname,
        Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80)),
        parsed.pathname || "/",
      ];
    } catch {
      /* Server rejects incomplete target. */
    }
    onChange({
      url,
      bearer: bearer || undefined,
      declared_base: base || undefined,
      approval: {
        target,
        addresses: approved ? addresses.split(/[\s,]+/).filter(Boolean) : [],
        allow_plaintext: approved && target[0] === "http",
      },
      time_field: field || undefined,
      time_precision: field ? precision : undefined,
      schedule: pattern ? { pattern, timezone } : undefined,
    });
  }, [
    active,
    builtin,
    replace,
    url,
    bearer,
    addresses,
    base,
    field,
    precision,
    pattern,
    timezone,
    approved,
    onChange,
  ]);
  useEffect(() => {
    if (active) setUrl(currentUrl);
  }, [active, currentUrl]);
  function edit() {
    setBuiltin(false);
    setReplace(true);
  }
  return (
    <div className="fx-provider-editor">
      <div className="workspace-form-grid">
        <label className="workspace-form-field fx-field-wide">
          接口地址
          <span className="workspace-secret-field">
            <input
              type={show ? "text" : "password"}
              autoComplete="off"
              maxLength={2048}
              disabled={disabled}
              value={url}
              placeholder={currentUrl ? "已配置接口地址" : "填写自定义接口地址"}
              onChange={(e) => {
                edit();
                setUrl(e.target.value);
                setApproved(false);
              }}
            />
            <button
              type="button"
              className="icon-button"
              aria-label={show ? "隐藏来源地址" : "显示来源地址"}
              aria-pressed={show}
              onClick={() => setShow(!show)}
            >
              {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </span>
        </label>
        <label className="workspace-form-field fx-field-wide">
          接口凭据 <small>Bearer，可选</small>
          <span className="workspace-secret-field">
            <input
              type={showBearer ? "text" : "password"}
              autoComplete="off"
              maxLength={4096}
              disabled={disabled}
              value={bearer}
              placeholder="未填写新凭据"
              onChange={(e) => {
                edit();
                setBearer(e.target.value);
              }}
            />
            <button
              type="button"
              className="icon-button"
              aria-label={showBearer ? "隐藏 Bearer 凭据" : "显示 Bearer 凭据"}
              aria-pressed={showBearer}
              onClick={() => setShowBearer(!showBearer)}
            >
              {showBearer ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </span>
        </label>
        <label className="workspace-form-field fx-field-wide">
          接口服务器 IP
          <input
            disabled={disabled}
            value={addresses}
            placeholder="多个地址用空格或逗号分隔"
            onChange={(e) => {
              edit();
              setAddresses(e.target.value);
              setApproved(false);
            }}
          />
        </label>
        {replace && !builtin && (
          <label className="workspace-confirmation fx-field-wide">
            <input
              type="checkbox"
              disabled={disabled}
              checked={approved}
              onChange={(e) => setApproved(e.target.checked)}
            />
            确认使用此接口地址、协议、端口及服务器 IP
          </label>
        )}
      </div>
      <section className="fx-format-settings" aria-label="响应与定时设置">
        <h3>响应与定时设置</h3>
        <div className="workspace-form-grid">
          <label className="workspace-form-field">
            响应缺省基准币种
            <input
              disabled={disabled}
              value={base}
              maxLength={3}
              placeholder="如 USD"
              onChange={(e) => {
                edit();
                setBase(e.target.value.toUpperCase());
              }}
            />
          </label>
          <label className="workspace-form-field">
            来源时间字段
            <input
              disabled={disabled}
              value={field}
              placeholder="如 date"
              onChange={(e) => {
                edit();
                setField(e.target.value);
              }}
            />
          </label>
          <label className="workspace-form-field">
            时间精度
            <SelectMenu
              label="时间精度"
              variant="field"
              value={precision}
              onChange={(v) => {
                edit();
                setPrecision(v);
              }}
              disabled={disabled}
              options={[
                { value: "date", label: "日期" },
                { value: "instant", label: "含时区时间" },
                { value: "epoch_seconds", label: "Unix 秒" },
                { value: "epoch_millis", label: "Unix 毫秒" },
              ]}
            />
          </label>
          <label className="workspace-form-field">
            定时表达式
            <input
              disabled={disabled}
              value={pattern}
              placeholder="可选"
              onChange={(e) => {
                edit();
                setPattern(e.target.value);
              }}
            />
          </label>
          <label className="workspace-form-field">
            时区
            <input
              disabled={disabled}
              value={timezone}
              placeholder="如 Asia/Shanghai"
              onChange={(e) => {
                edit();
                setTimezone(e.target.value);
              }}
            />
          </label>
        </div>
      </section>
      <div className="fx-provider-footer">
        <span className="fx-default-state" role="status">
          {builtin
            ? "保存后将恢复默认接口"
            : replace
              ? "接口变更待保存"
              : currentUrl
                ? "当前使用自定义接口"
                : "当前使用默认接口"}
        </span>
        <button
          type="button"
          className="text-button"
          disabled={disabled}
          onClick={() => {
            setBuiltin(true);
            setReplace(false);
            setBearer("");
            setUrl("");
            setApproved(false);
          }}
        >
          恢复默认接口
        </button>
      </div>
    </div>
  );
}
