import { Dialog } from "./dialog";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, type Session } from "./api";
import { apiSessionSnapshot } from "./api-session";
import { PersonalFontsPanel } from "./personal-fonts";
import { usePersonalFontsRuntime } from "./personal-font-runtime";
import { isPersonalFontId } from "./personal-font-id";
import { fontListing, type PersonalFont } from "./personal-font-state";
import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import {
  ACCENTS,
  presetPalette,
  resolvedAccent,
} from "./appearance-preferences";
import type { Accent, Appearance, Font, Mode } from "./appearance-preferences";
import type { AppearanceController } from "./use-appearance";
import { usePanelReady } from "./transition-qa";
import { SelectMenu } from "./select-menu";
import "./appearance.css";

const fonts: { value: Font; label: string }[] = [
  { value: "system", label: "系统" },
  { value: "sans", label: "无衬线" },
  { value: "serif", label: "衬线" },
  { value: "mono", label: "等宽" },
];
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="appearance-row">
      <span className="appearance-label">{label}</span>
      <div className="appearance-control">{children}</div>
    </div>
  );
}
function Select<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <SelectMenu
      label={label}
      value={value}
      options={options}
      onChange={onChange}
      variant="compact"
    />
  );
}
function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      className="appearance-switch"
      role="switch"
      aria-label={label}
      aria-checked={value}
      onClick={() => onChange(!value)}
    >
      <span className="appearance-switch-track" aria-hidden="true">
        <span />
      </span>
    </button>
  );
}
function Color({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="appearance-color">
      <span className="color-dot" style={{ background: value }} />
      <span>{value.toUpperCase()}</span>
      <input
        aria-label={label}
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
function NumberSetting({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <input
      aria-label={label}
      type="number"
      min={min}
      max={max}
      value={draft}
      onChange={(e) => {
        const next = e.target.value;
        setDraft(next);
        const number = Number(next);
        if (
          next !== "" &&
          Number.isInteger(number) &&
          number >= min &&
          number <= max
        )
          onChange(number);
      }}
      onBlur={() => {
        const number =
          draft === ""
            ? value
            : Math.min(max, Math.max(min, Math.round(Number(draft))));
        const next = Number.isFinite(number) ? number : value;
        setDraft(String(next));
        onChange(next);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}
function AccentMenu({
  value,
  custom,
  defaultColor,
  onChange,
}: {
  value: Accent;
  custom: string;
  defaultColor: string;
  onChange: (value: Accent) => void;
}) {
  return (
    <SelectMenu
      label="强调色"
      value={value}
      onChange={onChange}
      variant="compact"
      options={[
        ...ACCENTS.map((accent) => ({
          ...accent,
          color: accent.value === "default" ? defaultColor : accent.color,
        })),
        { value: "custom" as const, label: "自定义", color: custom },
      ]}
    />
  );
}

function ModePreview({ mode }: { mode: Mode }) {
  return (
    <span className={`mode-preview preview-${mode}`} aria-hidden="true">
      <span className="mini-window">
        <span className="mini-sidebar">
          <i />
          <i />
          <i />
        </span>
        <span className="mini-content">
          <i />
          <i />
          <i />
          <b />
          <b />
          <em />
        </span>
      </span>
      {mode === "system" && (
        <span className="mini-dark-half">
          <span className="mini-window">
            <span className="mini-sidebar">
              <i />
              <i />
              <i />
            </span>
            <span className="mini-content">
              <i />
              <i />
              <i />
              <b />
              <b />
              <em />
            </span>
          </span>
        </span>
      )}
    </span>
  );
}
export function PageLayoutSettings({
  appearance: a,
}: {
  appearance: AppearanceController;
}) {
  const { settings: s } = a;
  return (
    <div className="appearance-group">
      <Row label="内容宽度">
        <Select
          label="内容宽度"
          value={s.fullWidth ? "full" : s.contentWidth}
          options={[
            { value: "compact", label: "紧凑 · 960 px" },
            { value: "standard", label: "标准 · 1080 px" },
            { value: "wide", label: "宽松 · 1200 px" },
            { value: "full", label: "全宽" },
          ]}
          onChange={(value) =>
            a.update(
              value === "full"
                ? { fullWidth: true }
                : { fullWidth: false, contentWidth: value },
            )
          }
        />
      </Row>
      <Row label="内容对齐">
        <div className="appearance-segment" role="group" aria-label="内容对齐">
          {[
            { value: "left", label: "靠左" },
            { value: "center", label: "居中" },
          ].map((option) => (
            <button
              type="button"
              key={option.value}
              aria-pressed={s.contentAlign === option.value}
              onClick={() =>
                a.update({
                  contentAlign: option.value as Appearance["contentAlign"],
                })
              }
            >
              {option.label}
            </button>
          ))}
        </div>
      </Row>
    </div>
  );
}
export function AppearancePage({
  appearance: a,
  session,
  active = true,
}: {
  appearance: AppearanceController;
  session: Session;
  active?: boolean;
}) {
  const { settings: s, palette: p } = a;
  const [fontsOpen, setFontsOpen] = useState(false);
  const [personalRows, setPersonalRows] = useState<PersonalFont[]>([]),
    [fontError, setFontError] = useState("");
  useEffect(() => {
    if (!active || document.hidden) return;
    const controller = new AbortController();
    setPersonalRows([]);
    api<unknown>("/personal-fonts", { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted)
          setPersonalRows(fontListing(value).fonts);
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setFontError(
            reason instanceof Error ? reason.message : "字体列表读取失败",
          );
      });
    return () => controller.abort();
  }, [active, session.instance_id, session.user.id, session.csrf]);
  const runtime = usePersonalFontsRuntime(),
    fontWork = useRef(new Set<AbortController>()),
    fontEpoch = useRef(0),
    fontLive = useRef(false),
    fontMode = useRef(a.mode),
    fontAppearance = useRef(a);
  fontMode.current = a.mode;
  fontAppearance.current = a;
  useLayoutEffect(() => {
    fontLive.current = active;
    return () => {
      fontLive.current = false;
      ++fontEpoch.current;
      for (const controller of fontWork.current) controller.abort();
      fontWork.current.clear();
      setFontError("");
    };
  }, [
    active,
    session.csrf,
    session.user.id,
    session.user.role,
    session.receipt_scope,
    a.mode,
    s.separateModes,
  ]);
  useEffect(() => {
    const hidden = () => {
      if (document.hidden) {
        ++fontEpoch.current;
        for (const task of fontWork.current) task.abort();
        fontWork.current.clear();
        setFontError("");
      }
    };
    document.addEventListener("visibilitychange", hidden);
    return () => document.removeEventListener("visibilitychange", hidden);
  }, []);
  const fontOptions = [
    ...fonts,
    ...personalRows.map((f) => ({ value: f.id, label: f.name })),
  ];
  for (const value of [p.font, s.contentFont])
    if (
      isPersonalFontId(value) &&
      !fontOptions.some((option) => option.value === value)
    )
      fontOptions.push({ value, label: "字体待核对" });
  async function chooseFont(value: Font | "same", content = false) {
    if (
      !fontLive.current ||
      document.hidden ||
      apiSessionSnapshot().csrf !== session.csrf
    )
      return;
    ++fontEpoch.current;
    for (const task of fontWork.current) task.abort();
    fontWork.current.clear();
    setFontError("");
    if (!isPersonalFontId(value)) {
      if (content) a.update({ contentFont: value });
      else if (value !== "same") a.updatePalette({ font: value });
      return;
    }
    const font = personalRows.find((f) => f.id === value),
      version = fontEpoch.current,
      mode = a.mode,
      controller = new AbortController(),
      binding = apiSessionSnapshot();
    const current = () =>
      fontLive.current &&
      fontEpoch.current === version &&
      fontMode.current === mode &&
      apiSessionSnapshot().epoch === binding.epoch &&
      apiSessionSnapshot().csrf === session.csrf;
    if (!font || !runtime?.ready || !current()) {
      setFontError("本人字体或外观状态待核对");
      return;
    }
    fontWork.current.add(controller);
    setFontError("");
    try {
      await runtime.ensure(font, current, controller.signal);
      if (current()) {
        if (content) fontAppearance.current.update({ contentFont: value });
        else fontAppearance.current.updatePalette({ font: value });
      }
    } catch (reason) {
      if (current() && !controller.signal.aborted)
        setFontError(reason instanceof Error ? reason.message : "字体应用失败");
    } finally {
      fontWork.current.delete(controller);
    }
  }
  const [advanced, setAdvanced] = useState(false);
  usePanelReady("/appearance", true);
  function styleSelect(
    key: "uiStyle" | "contentStyle" | "codeStyle",
    label: string,
  ) {
    return (
      <Select
        label={label}
        value={s[key]}
        options={[
          { value: "regular", label: "常规" },
          { value: "medium", label: "中等" },
        ]}
        onChange={(value) => a.update({ [key]: value })}
      />
    );
  }
  function numberRow(
    label: string,
    key: "uiSize" | "contentSize" | "codeSize",
    min: number,
    max: number,
  ) {
    return (
      <Row label={label}>
        <NumberSetting
          label={label}
          value={s[key]}
          min={min}
          max={max}
          onChange={(value) => a.update({ [key]: value })}
        />
        <span className="appearance-unit">px</span>
      </Row>
    );
  }
  return (
    <div className="appearance-page">
      <div className="page-heading">
        <h1>外观</h1>
      </div>
      <h2 className="appearance-section-title">视觉风格</h2>
      <div className="appearance-group appearance-mode-group">
        <Row label="模式">
          <div className="appearance-modes" role="group" aria-label="模式">
            {[
              { value: "system", label: "跟随系统" },
              { value: "light", label: "浅色" },
              { value: "dark", label: "深色" },
            ].map((m) => (
              <button
                type="button"
                key={m.value}
                className="mode-option"
                aria-label={m.label}
                aria-pressed={s.mode === m.value}
                onClick={() => a.update({ mode: m.value as Mode })}
              >
                <ModePreview mode={m.value as Mode} />
                <span>{m.label}</span>
              </button>
            ))}
          </div>
        </Row>
      </div>
      <div className="appearance-group">
        <Row label="主题">
          <Select
            label="主题"
            value={p.theme}
            options={[
              { value: "alcor", label: "Alcor" },
              { value: "neutral-gray", label: "中性灰" },
              { value: "muse", label: "Muse" },
              { value: "meta", label: "Meta" },
              { value: "soft", label: "柔和" },
              { value: "contrast", label: "高对比" },
              ...(p.theme === "custom"
                ? [{ value: "custom" as const, label: "自定义" }]
                : []),
            ]}
            onChange={(value) => a.updatePalette(presetPalette(value, a.mode))}
          />
        </Row>
        <Row label="强调色">
          <AccentMenu
            value={p.accent}
            custom={p.customAccent}
            defaultColor={resolvedAccent({ ...p, accent: "default" }, a.mode)}
            onChange={(value) => a.updatePalette({ accent: value })}
          />
          {p.accent === "custom" && (
            <Color
              label="自定义强调色"
              value={p.customAccent}
              onChange={(value) => a.updatePalette({ customAccent: value })}
            />
          )}
        </Row>
        <Row label="背景">
          <Color
            label="背景颜色"
            value={a.colors.background}
            onChange={(value) =>
              a.updatePalette({
                theme: "custom",
                background: value,
                foreground: a.colors.foreground,
              })
            }
          />
        </Row>
        <Row label="前景">
          <Color
            label="前景颜色"
            value={a.colors.foreground}
            onChange={(value) =>
              a.updatePalette({
                theme: "custom",
                foreground: value,
                background: a.colors.background,
              })
            }
          />
        </Row>
        <Row label="字体">
          <Select
            label="界面字体"
            value={p.font}
            options={fontOptions}
            onChange={(value) => void chooseFont(value)}
          />
        </Row>
      </div>
      {(fontError || runtime?.error) && (
        <p role="alert">
          {fontError || runtime?.error}
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setFontError("");
              runtime?.refresh();
            }}
          >
            重新读取字体
          </button>
        </p>
      )}
      <div className="appearance-font-manager">
        <span>自定义字体</span>
        <button className="text-button" onClick={() => setFontsOpen(true)}>
          管理字体
        </button>
      </div>
      {fontsOpen && (
        <Dialog title="字体管理" onClose={() => setFontsOpen(false)}>
          <PersonalFontsPanel
            session={session}
            active={active && fontsOpen}
            onFonts={setPersonalRows}
          />
        </Dialog>
      )}
      <h2 className="appearance-section-title">页面布局</h2>
      <PageLayoutSettings appearance={a} />
      <div className="appearance-advanced-head">
        <button
          type="button"
          aria-expanded={advanced}
          aria-controls="appearance-advanced"
          onClick={() => setAdvanced(!advanced)}
        >
          高级
          <ChevronDown size={16} className={advanced ? "expanded" : ""} />
        </button>
        <button type="button" onClick={a.reset}>
          重置为默认设置
        </button>
      </div>
      <div id="appearance-advanced" hidden={!advanced}>
        <div className="appearance-group">
          {numberRow("界面字号", "uiSize", 12, 20)}
          {numberRow("内容字体大小", "contentSize", 12, 24)}
        </div>
        <div className="appearance-group">
          <Row label="减少动态效果">
            <Toggle
              label="减少动态效果"
              value={a.reducedMotion}
              onChange={(value) => a.update({ motion: value ? "on" : "off" })}
            />
          </Row>
          <Row label="分别设置浅色和深色模式">
            <Toggle
              label="分别设置浅色和深色模式"
              value={s.separateModes}
              onChange={a.separate}
            />
          </Row>
        </div>
        <div className="appearance-group">
          <Row label="界面字体样式">
            {styleSelect("uiStyle", "界面字体样式")}
          </Row>
          <Row label="内容字体">
            <Select
              label="内容字体"
              value={s.contentFont}
              options={[
                { value: "same", label: "与界面字体相同" },
                ...fontOptions,
              ]}
              onChange={(value) => void chooseFont(value, true)}
            />
            {styleSelect("contentStyle", "内容字体样式")}
          </Row>
          <Row label="半透明侧边栏">
            <Toggle
              label="半透明侧边栏"
              value={s.translucent}
              onChange={(value) => a.update({ translucent: value })}
            />
          </Row>
          <Row label="对比度">
            <input
              type="range"
              min="0"
              max="100"
              aria-label="对比度"
              value={s.contrast}
              onChange={(e) => a.update({ contrast: Number(e.target.value) })}
            />
            <output>{s.contrast}</output>
          </Row>
        </div>
        <div className="appearance-group">
          <Row label="使用指针光标">
            <Toggle
              label="使用指针光标"
              value={s.pointer}
              onChange={(value) => a.update({ pointer: value })}
            />
          </Row>
        </div>
      </div>
    </div>
  );
}
