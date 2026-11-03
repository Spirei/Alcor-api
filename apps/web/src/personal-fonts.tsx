import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { api, ApiError, type Session } from "./api";
import { apiSessionSnapshot } from "./api-session";
import { requestId } from "./request-id";
import { SelectMenu } from "./select-menu";
import { resourceSize } from "./resource-state";
import { personalFontBytes, preparePersonalFont } from "./personal-font-media";
import {
  clearFontRequests,
  readFontRequest,
  retainFontRequest,
  releaseFontRequest,
  fontListing,
  fontReceipt,
  fontForm,
  fontOperationId,
  type PersonalFont,
  type FontListing,
  type FontReceipt,
} from "./personal-font-state";
import { announceFontDenied } from "./personal-font-runtime";
import "./personal-fonts.css";
import { PersonalFontSourcePanel } from "./font-source";
type Props = {
  session: Session;
  active: boolean;
  onFonts: (fonts: PersonalFont[]) => void;
};
export function PersonalFontsPanel(props: Props) {
  const [refreshKey, setRefreshKey] = useState(0);
  const changed = useCallback(() => setRefreshKey((value) => value + 1), []);
  return (
    <>
      <FontSession
        key={JSON.stringify([
          props.session.instance_id,
          props.session.user.id,
          props.session.user.role,
          props.session.receipt_scope,
          props.session.csrf,
          props.session.expires_at,
        ])}
        {...props}
        refreshKey={refreshKey}
      />
      <PersonalFontSourcePanel
        session={props.session}
        active={props.active}
        onChanged={changed}
      />
    </>
  );
}
function FontSession({
  session,
  active,
  onFonts,
  refreshKey,
}: Props & { refreshKey: number }) {
  const scope = JSON.stringify([
    session.instance_id,
    session.user.id,
    session.user.role,
    session.receipt_scope,
  ]);
  const [visible, setVisible] = useState(
      typeof document === "undefined" || !document.hidden,
    ),
    [listing, setListing] = useState<FontListing | null>(null),
    [selected, setSelected] = useState(""),
    [filename, setFilename] = useState(""),
    [pending, setPending] = useState<string | null>(null),
    [lookup, setLookup] = useState(""),
    [receipt, setReceipt] = useState<FontReceipt | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false),
    [locked, setLocked] = useState(false),
    [journalReady, setJournalReady] = useState(false),
    [loaded, setLoaded] = useState<string | null>(null);
  const live = useRef(false),
    epoch = useRef(0),
    read = useRef(0),
    binding = useRef(apiSessionSnapshot()),
    file = useRef<File | null>(null),
    input = useRef<HTMLInputElement>(null),
    sample = useRef<HTMLDivElement>(null),
    face = useRef<FontFace | null>(null),
    original = useRef<string | null>(null),
    work = useRef<AbortController | null>(null),
    reading = useRef<AbortController | null>(null);
  const displayed = useCallback(
    () =>
      apiSessionSnapshot().csrf === session.csrf &&
      apiSessionSnapshot().epoch === binding.current.epoch,
    [session.csrf],
  );
  const clearFile = useCallback(() => {
    file.current = null;
    if (input.current) input.current.value = "";
    setFilename("");
  }, []);
  const clearPreview = useCallback(() => {
    if (face.current) document.fonts.delete(face.current);
    face.current = null;
    sample.current?.style.removeProperty("font-family");
    setLoaded(null);
  }, []);
  const pause = useCallback(() => {
    live.current = false;
    ++epoch.current;
    ++read.current;
    work.current?.abort();
    work.current = null;
    reading.current?.abort();
    reading.current = null;
    clearFile();
    clearPreview();
    setReceipt(null);
    setListing(null);
    onFonts([]);
    setReady(false);
    setBusy(false);
  }, [clearFile, clearPreview, onFonts]);
  const fail = useCallback(
    (reason: unknown) => {
      if (
        !displayed() ||
        (reason instanceof ApiError &&
          ([401, 403].includes(reason.status) ||
            reason.code === "session_changed"))
      ) {
        pause();
        setLocked(true);
        setSelected("");
        setLookup("");
        setNotice("");
        original.current = null;
        setPending(null);
        try {
          clearFontRequests(sessionStorage);
        } catch {}
        announceFontDenied(binding.current.epoch);
      }
      setError(reason instanceof Error ? reason.message : "本人字体读取失败");
    },
    [displayed, pause],
  );
  useLayoutEffect(() => {
    live.current = active && visible && !locked && displayed();
    return pause;
  }, [active, visible, locked, displayed, pause]);
  useEffect(() => {
    const sync = () => {
      if (document.hidden) pause();
      setVisible(!document.hidden);
    };
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, [pause]);
  useEffect(() => {
    if (!live.current || !displayed()) return;
    try {
      const id = readFontRequest(sessionStorage, scope);
      original.current = id;
      setPending(id);
      setJournalReady(true);
    } catch (reason) {
      setJournalReady(false);
      setLocked(true);
      fail(reason);
    }
  }, [active, visible, locked, scope, displayed, fail]);
  const load = useCallback(async () => {
    if (!live.current || !displayed()) return;
    const generation = epoch.current,
      sequence = ++read.current,
      controller = new AbortController();
    reading.current?.abort();
    reading.current = controller;
    setReady(false);
    try {
      const rows = fontListing(
        await api<unknown>("/personal-fonts", { signal: controller.signal }),
      );
      if (
        live.current &&
        displayed() &&
        generation === epoch.current &&
        sequence === read.current &&
        !controller.signal.aborted
      ) {
        setListing(rows);
        onFonts(rows.fonts);
        setReady(true);
        setError("");
      }
    } catch (reason) {
      if (
        live.current &&
        generation === epoch.current &&
        !controller.signal.aborted
      ) {
        setListing(null);
        onFonts([]);
        fail(reason);
      }
    } finally {
      if (reading.current === controller) reading.current = null;
    }
  }, [displayed, fail, onFonts]);
  useEffect(() => {
    if (active && visible && !locked) void load();
  }, [active, visible, locked, load, refreshKey]);
  function known(raw: unknown, id: string) {
    const value = fontReceipt(raw, id);
    if (original.current === id) {
      releaseFontRequest(sessionStorage, scope, id);
      original.current = null;
      setPending(null);
    }
    setReceipt(value);
    setLookup(id);
    setError("");
    setNotice("");
    if (value.font) setSelected(value.font.id);
    void load();
  }
  async function query(id = original.current ?? lookup.trim()) {
    if (!live.current || !displayed() || work.current) return;
    if (!fontOperationId(id)) {
      setError("请输入有效操作编号");
      return;
    }
    const generation = epoch.current,
      controller = new AbortController();
    work.current = controller;
    setBusy(true);
    try {
      const value = await api<unknown>("/personal-fonts/operations/" + id, {
        signal: controller.signal,
      });
      if (live.current && displayed() && generation === epoch.current)
        known(value, id);
    } catch (reason) {
      if (
        live.current &&
        generation === epoch.current &&
        !controller.signal.aborted
      ) {
        fail(reason);
        if (
          reason instanceof ApiError &&
          reason.status === 404 &&
          original.current === id
        )
          setNotice("尚未查到原回执，请核对或显式关闭原编号");
      }
    } finally {
      if (work.current === controller) {
        work.current = null;
        if (generation === epoch.current) setBusy(false);
      }
    }
  }
  async function submit() {
    if (
      !live.current ||
      !displayed() ||
      work.current ||
      original.current ||
      !listing ||
      !ready ||
      !journalReady ||
      !file.current
    )
      return;
    const id = requestId(),
      generation = epoch.current,
      controller = new AbortController();
    let body: FormData;
    try {
      body = fontForm(file.current, id, listing.revision);
      retainFontRequest(sessionStorage, scope, id);
    } catch (reason) {
      fail(reason);
      return;
    }
    original.current = id;
    setPending(id);
    setReceipt(null);
    setError("");
    setNotice("");
    clearFile();
    clearPreview();
    work.current = controller;
    setBusy(true);
    try {
      const raw = await api<unknown>(
        "/personal-fonts",
        { method: "POST", body, signal: controller.signal },
        session.csrf,
        60000,
      );
      if (live.current && displayed() && generation === epoch.current)
        known(raw, id);
    } catch (reason) {
      if (
        live.current &&
        generation === epoch.current &&
        !controller.signal.aborted
      ) {
        fail(reason);
        if (
          !(reason instanceof ApiError && [401, 403].includes(reason.status)) &&
          displayed()
        ) {
          try {
            const value = await api<unknown>(
              "/personal-fonts/operations/" + id,
              { signal: controller.signal },
            );
            if (live.current && displayed() && generation === epoch.current)
              known(value, id);
          } catch (lookupError) {
            if (
              live.current &&
              generation === epoch.current &&
              !controller.signal.aborted
            ) {
              if (
                lookupError instanceof ApiError &&
                [401, 403].includes(lookupError.status)
              )
                fail(lookupError);
              else setNotice("字体上传结果尚待核对，请查询原编号");
            }
          }
        }
      }
    } finally {
      if (work.current === controller) {
        work.current = null;
        if (generation === epoch.current) setBusy(false);
      }
    }
  }
  async function close() {
    const id = original.current;
    if (!id || !live.current || !displayed() || work.current) return;
    const generation = epoch.current,
      controller = new AbortController();
    work.current = controller;
    setBusy(true);
    try {
      const raw = await api<unknown>(
        "/personal-fonts/operations/" + id + "/close",
        {
          method: "POST",
          body: JSON.stringify({ expectedKind: "upload" }),
          signal: controller.signal,
        },
        session.csrf,
      );
      if (live.current && displayed() && generation === epoch.current)
        known(raw, id);
    } catch (reason) {
      if (
        live.current &&
        generation === epoch.current &&
        !controller.signal.aborted
      )
        fail(reason);
    } finally {
      if (work.current === controller) {
        work.current = null;
        if (generation === epoch.current) setBusy(false);
      }
    }
  }
  const chosen = listing?.fonts.find((font) => font.id === selected);
  async function readFont(originalDownload = false) {
    if (!chosen || !live.current || !displayed() || work.current) return;
    const generation = epoch.current,
      controller = new AbortController(),
      font = chosen,
      current = () =>
        live.current && displayed() && generation === epoch.current;
    work.current = controller;
    setBusy(true);
    setError("");
    clearPreview();
    try {
      if (originalDownload) {
        const raw = await personalFontBytes(
          font,
          { csrf: session.csrf, current },
          controller.signal,
        );
        if (!current()) return;
        const url = URL.createObjectURL(
            new Blob([raw], { type: "application/octet-stream" }),
          ),
          anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = font.id;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 0);
      } else {
        const loadedFace = await preparePersonalFont(
          font,
          { csrf: session.csrf, current },
          controller.signal,
          true,
        );
        if (!current()) return;
        document.fonts.add(loadedFace);
        face.current = loadedFace;
        if (sample.current)
          sample.current.style.fontFamily = '"' + loadedFace.family + '"';
        setLoaded(font.id);
      }
    } catch (reason) {
      if (current() && !controller.signal.aborted) fail(reason);
    } finally {
      if (work.current === controller) {
        work.current = null;
        if (generation === epoch.current) setBusy(false);
      }
    }
  }
  const recovering = !active || !visible || locked || busy || !journalReady,
    disabled = recovering || !ready;
  const options = [
    { value: "", label: "选择本人字体" },
    ...(listing?.fonts ?? []).map((font) => ({
      value: font.id,
      label: font.name,
    })),
  ];
  if (selected && !options.some((o) => o.value === selected))
    options.push({ value: selected, label: "字体待核对" });
  return (
    <section className="personal-fonts-panel" aria-label="本人自定义字体">
      <div className="personal-fonts-head">
        <h3>自定义字体</h3>
        {listing && <span>{listing.fonts.length} / 20</span>}
        <button
          type="button"
          disabled={!active || !visible || busy}
          onClick={() => {
            if (locked) {
              setLocked(false);
              setJournalReady(false);
            } else void load();
          }}
        >
          重新读取
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <form
        className="personal-fonts-upload"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label>
          字体文件
          <input
            ref={input}
            type="file"
            accept=".woff,.woff2,.ttf,.otf"
            disabled={disabled || !!pending}
            onChange={(event) => {
              clearPreview();
              file.current = event.target.files?.[0] ?? null;
              setFilename(file.current?.name ?? "");
              setError("");
            }}
          />
        </label>
        <button
          type="submit"
          className="primary"
          disabled={disabled || !!pending || !filename}
        >
          上传字体
        </button>
      </form>
      {listing?.fonts.length === 0 && <p>暂无本人字体</p>}
      <div className="personal-fonts-read">
        <SelectMenu
          label="本人字体"
          value={selected}
          options={options}
          disabled={disabled}
          variant="field"
          onChange={(value) => {
            clearPreview();
            setSelected(value);
          }}
        />
        <button
          type="button"
          disabled={disabled || !chosen}
          onClick={() => void readFont()}
        >
          预览字体
        </button>
        <button
          type="button"
          disabled={disabled || !chosen}
          onClick={() => void readFont(true)}
        >
          下载原件
        </button>
      </div>
      {chosen && (
        <div className="personal-fonts-metadata">
          <span>{resourceSize(chosen.size)}</span>
          <details>
            <summary>原件详情</summary>
            <dl>
              <dt>字体编号</dt>
              <dd>{chosen.id}</dd>
              <dt>SHA256</dt>
              <dd>{chosen.sha256}</dd>
            </dl>
          </details>
        </div>
      )}
      {loaded && <p role="status">预览已加载</p>}
      <div
        ref={sample}
        hidden={!loaded || loaded !== selected}
        style={{
          fontFamily:
            loaded && face.current
              ? '"' + face.current.family + '"'
              : undefined,
        }}
        className="personal-fonts-sample"
        aria-label="字体预览"
      >
        Aa 字体预览 0123456789
      </div>
      <div className="personal-fonts-lookup">
        <label>
          字体操作编号
          <input
            value={pending ?? lookup}
            readOnly={!!pending}
            disabled={locked}
            onChange={(event) => setLookup(event.target.value)}
            spellCheck={false}
          />
        </label>
        <button
          type="button"
          disabled={recovering || !fontOperationId(pending ?? lookup.trim())}
          onClick={() => void query()}
        >
          查询字体回执
        </button>
        {pending && (
          <button
            type="button"
            disabled={recovering}
            onClick={() => void close()}
          >
            关闭原操作
          </button>
        )}
      </div>
      {pending && <p role="status">原操作待核对 · {pending}</p>}
      {receipt && (
        <p role={receipt.state === "failed" ? "alert" : "status"}>
          {receipt.state === "failed"
            ? receipt.message
            : receipt.deduplicated
              ? "字体已存在，保留原名称"
              : "字体上传完成"}
        </p>
      )}
    </section>
  );
}
