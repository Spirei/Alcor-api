import { useEffect, useState } from "react";
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
  disabled,
  onChange,
}: {
  active: boolean;
  disabled: boolean;
  onChange: (value: CustomProvider | undefined) => void;
}) {
  const [builtin, setBuiltin] = useState(false);
  const [replace, setReplace] = useState(false);
  const [url, setUrl] = useState("");
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
  return (
    <details className="fx-provider-editor">
      <summary>自定义来源</summary>
      <label>
        <input
          type="checkbox"
          checked={builtin}
          disabled={disabled}
          onChange={(e) => setBuiltin(e.target.checked)}
        />
        使用默认来源
      </label>
      <label>
        <input
          type="checkbox"
          checked={replace}
          disabled={disabled}
          onChange={(e) => setReplace(e.target.checked)}
        />
        更换来源
      </label>
      {replace && !builtin && (
        <fieldset disabled={disabled}>
          <label>
            来源地址
            <input
              type={show ? "text" : "password"}
              autoComplete="off"
              maxLength={2048}
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setApproved(false);
              }}
            />
          </label>
          <button
            className="button secondary small"
            type="button"
            aria-label={show ? "隐藏来源地址" : "显示来源地址"}
            aria-pressed={show}
            onClick={() => setShow(!show)}
          >
            {show ? "隐藏" : "显示"}
          </button>
          <label>
            Bearer 凭据
            <input
              type={showBearer ? "text" : "password"}
              autoComplete="off"
              maxLength={4096}
              value={bearer}
              onChange={(event) => setBearer(event.target.value)}
            />
          </label>
          <button
            className="button secondary small"
            type="button"
            aria-label={showBearer ? "隐藏 Bearer 凭据" : "显示 Bearer 凭据"}
            aria-pressed={showBearer}
            onClick={() => setShowBearer(!showBearer)}
          >
            {showBearer ? "隐藏" : "显示"}
          </button>
          <label>
            批准的 IP 地址
            <input
              value={addresses}
              onChange={(e) => {
                setAddresses(e.target.value);
                setApproved(false);
              }}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={approved}
              onChange={(e) => setApproved(e.target.checked)}
            />
            使用此地址、协议和端口
          </label>
          <label>
            响应缺失时的基准币种
            <input
              value={base}
              maxLength={3}
              onChange={(e) => setBase(e.target.value.toUpperCase())}
            />
          </label>
          <label>
            来源时间字段
            <input value={field} onChange={(e) => setField(e.target.value)} />
          </label>
          <SelectMenu
            label="时间精度"
            variant="field"
            value={precision}
            onChange={setPrecision}
            disabled={disabled}
            options={[
              { value: "date", label: "日期" },
              { value: "instant", label: "含时区时间" },
              { value: "epoch_seconds", label: "Unix 秒" },
              { value: "epoch_millis", label: "Unix 毫秒" },
            ]}
          />
          <label>
            定时表达式
            <input
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
            />
          </label>
          <label>
            时区
            <input
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
            />
          </label>
        </fieldset>
      )}
    </details>
  );
}
