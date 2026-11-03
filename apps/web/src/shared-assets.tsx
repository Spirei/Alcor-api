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
import { sharedAssetOriginal } from "./shared-asset-original";
import { PngClipboardActions } from "./png-clipboard";
import { AssetLookupCatalogPanel } from "./asset-lookup-catalog";
import {
  assetKinds,
  assetFolders,
  clearSharedAssetRequests,
  readSharedAssetRequest,
  retainSharedAssetRequest,
  releaseSharedAssetRequest,
  sharedAssetConfig,
  sharedAssetReceipt,
  validAssetOperation,
  type AssetConfig,
  type AssetReceipt,
  type AssetKind,
} from "./shared-assets-state";
import "./shared-assets.css";
const base = "/admin/shared-assets";
export function SharedAssetsPage({
  session,
  active = true,
}: {
  session: Session;
  active?: boolean;
}) {
  if (session.user.role !== "admin")
    return (
      <section>
        <h1>共享素材</h1>
        <p role="alert">需要管理员权限</p>
      </section>
    );
  const scope = JSON.stringify([
    session.instance_id,
    session.user.id,
    session.user.role,
    session.receipt_scope,
  ]);
  return (
    <SharedAssetSession
      key={JSON.stringify([scope, session.csrf, session.expires_at])}
      {...{ session, active, scope }}
    />
  );
}
function SharedAssetSession({
  session,
  active,
  scope,
}: {
  session: Session;
  active: boolean;
  scope: string;
}) {
  const [visible, setVisible] = useState(
      typeof document === "undefined" || !document.hidden,
    ),
    [locked, setLocked] = useState(false),
    [ready, setReady] = useState(false),
    [journalReady, setJournalReady] = useState(false);
  const [config, setConfig] = useState<AssetConfig | null>(null),
    [kind, setKind] = useState<AssetKind>("ico"),
    [folder, setFolder] = useState(""),
    [market, setMarket] = useState(""),
    [code, setCode] = useState(""),
    [name, setName] = useState("");
  const [catalogOpened, setCatalogOpened] = useState(false);
  const [file, setFile] = useState<File | null>(null),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState<string | null>(null),
    [lookup, setLookup] = useState(""),
    [receipt, setReceipt] = useState<AssetReceipt | null>(null),
    [error, setError] = useState(""),
    [imageError, setImageError] = useState(false),
    [notice, setNotice] = useState("");
  const live = useRef(false),
    epoch = useRef(0),
    read = useRef(0),
    original = useRef<string | null>(null),
    expectedKind = useRef<AssetKind | null>(null),
    rejected = useRef<number | undefined>(undefined);
  const input = useRef<HTMLInputElement>(null),
    preview = useRef<HTMLImageElement>(null),
    work = useRef<AbortController | null>(null),
    reading = useRef<AbortController | null>(null),
    objectUrl = useRef<string | null>(null);
  const displayed = useCallback(
    () => apiSessionSnapshot().csrf === session.csrf,
    [session.csrf],
  );
  const clearFile = useCallback(() => {
    setFile(null);
    if (input.current) input.current.value = "";
  }, []);
  const pause = useCallback(() => {
    live.current = false;
    ++epoch.current;
    ++read.current;
    work.current?.abort();
    work.current = null;
    reading.current?.abort();
    reading.current = null;
    preview.current?.removeAttribute("src");
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;
    clearFile();
    setReceipt(null);
    setConfig(null);
    setReady(false);
    setBusy(false);
  }, [clearFile]);
  const fail = useCallback(
    (reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "读取失败");
      if (
        !displayed() ||
        (reason instanceof ApiError &&
          ([401, 403].includes(reason.status) ||
            reason.code === "session_changed"))
      ) {
        pause();
        setLocked(true);
        setFolder("");
        setMarket("");
        setCode("");
        setName("");
        setLookup("");
        setNotice("");
        original.current = null;
        setPending(null);
        expectedKind.current = null;
        rejected.current = undefined;
        try {
          clearSharedAssetRequests(sessionStorage);
        } catch {}
      }
    },
    [displayed, pause],
  );
  useLayoutEffect(() => {
    live.current = active && visible && !locked && displayed();
    ++epoch.current;
    setReady(false);
    return pause;
  }, [active, visible, locked, displayed, pause]);
  useEffect(() => {
    const change = () => {
      if (document.hidden) pause();
      setVisible(!document.hidden);
    };
    change();
    document.addEventListener("visibilitychange", change);
    return () => document.removeEventListener("visibilitychange", change);
  }, [pause]);
  useEffect(() => {
    if (!live.current || !displayed()) return;
    try {
      const id = readSharedAssetRequest(sessionStorage, scope);
      original.current = id;
      setPending(id);
      setJournalReady(true);
    } catch (reason) {
      setLocked(true);
      fail(reason);
    }
  }, [active, visible, scope, displayed, fail]);
  const load = useCallback(async () => {
    if (!live.current || !displayed()) return;
    const generation = epoch.current,
      sequence = ++read.current,
      controller = new AbortController();
    reading.current?.abort();
    reading.current = controller;
    setReady(false);
    try {
      const value = await api<unknown>(base, { signal: controller.signal });
      if (
        live.current &&
        displayed() &&
        generation === epoch.current &&
        sequence === read.current
      ) {
        setConfig(sharedAssetConfig(value));
        setReady(true);
        setError("");
      }
    } catch (reason) {
      if (
        live.current &&
        generation === epoch.current &&
        sequence === read.current &&
        !controller.signal.aborted
      )
        fail(reason);
    } finally {
      if (reading.current === controller) reading.current = null;
    }
  }, [displayed, fail]);
  useEffect(() => {
    if (active && visible && !locked) void load();
  }, [active, visible, locked, load]);
  function known(raw: unknown, id: string) {
    const value = sharedAssetReceipt(raw, id);
    if (
      original.current === id &&
      value.state === "completed" &&
      expectedKind.current &&
      value.kind !== expectedKind.current
    )
      throw new Error("原素材类型不符，请继续核对");
    if (original.current === id) {
      releaseSharedAssetRequest(sessionStorage, scope, id);
      original.current = null;
      setPending(null);
      expectedKind.current = null;
      rejected.current = undefined;
    }
    setNotice("");
    setReceipt(value);
    setLookup(id);
    setImageError(false);
    setError("");
    clearFile();
    void load();
  }
  function forgetRejected(id: string) {
    releaseSharedAssetRequest(sessionStorage, scope, id);
    original.current = null;
    setPending(null);
    expectedKind.current = null;
    rejected.current = undefined;
    setError("");
    setNotice("上次上传未受理，请重新核对素材");
    void load();
  }
  async function check(id = original.current ?? lookup.trim()) {
    if (
      !live.current ||
      !displayed() ||
      work.current ||
      !validAssetOperation(id)
    ) {
      if (!validAssetOperation(id)) setError("请输入有效操作编号");
      return;
    }
    const generation = epoch.current,
      controller = new AbortController();
    work.current = controller;
    setBusy(true);
    setError("");
    try {
      const value = await api<unknown>(base + "/operations/" + id, {
        signal: controller.signal,
      });
      if (live.current && displayed() && generation === epoch.current)
        known(value, id);
    } catch (reason) {
      if (live.current && generation === epoch.current) {
        if (
          reason instanceof ApiError &&
          reason.status === 404 &&
          original.current === id &&
          rejected.current !== undefined
        )
          forgetRejected(id);
        else fail(reason);
      }
    } finally {
      if (work.current === controller) {
        work.current = null;
        if (generation === epoch.current) setBusy(false);
      }
    }
  }
  async function upload() {
    if (
      !live.current ||
      !displayed() ||
      work.current ||
      original.current ||
      !ready ||
      !journalReady ||
      !file ||
      !config
    )
      return;
    const limit =
      kind === "asset" && folder === "card"
        ? config.cardMaxBytes
        : config.kinds[kind].maxBytes;
    if (file.size <= 0 || file.size > limit) {
      setError("文件为空或超过该类型大小上限");
      return;
    }
    if (
      !config.kinds[kind].extensions.includes(
        file.name.split(".").pop()?.toLowerCase() ?? "",
      )
    ) {
      setError("此类型不支持该文件格式");
      return;
    }
    const id = requestId(),
      generation = epoch.current,
      controller = new AbortController(),
      body = new FormData();
    body.set("file", file);
    body.set("kind", kind);
    body.set("requestId", id);
    body.set("expectedRevision", String(config.revision));
    if (kind === "asset") {
      body.set("folder", folder);
      body.set("market", market);
      body.set("code", code);
      body.set("name", name);
    }
    try {
      retainSharedAssetRequest(sessionStorage, scope, id);
    } catch (reason) {
      fail(reason);
      return;
    }
    original.current = id;
    expectedKind.current = kind;
    rejected.current = undefined;
    setPending(id);
    setReceipt(null);
    setNotice("");
    setError("");
    work.current = controller;
    setBusy(true);
    clearFile();
    try {
      const result = await api<unknown>(
        base + "/upload",
        { method: "POST", body, signal: controller.signal },
        session.csrf,
        300000,
      );
      if (live.current && displayed() && generation === epoch.current)
        known(result, id);
    } catch (reason) {
      if (live.current && generation === epoch.current) {
        fail(reason);
        if (reason instanceof ApiError && ![401, 403].includes(reason.status)) {
          if ([400, 404, 405, 413, 415, 422, 429].includes(reason.status))
            rejected.current = reason.status;
          try {
            const result = await api<unknown>(base + "/operations/" + id, {
              signal: controller.signal,
            });
            if (live.current && displayed() && generation === epoch.current)
              known(result, id);
          } catch (lookupError) {
            if (live.current && generation === epoch.current) {
              if (
                lookupError instanceof ApiError &&
                lookupError.status === 404 &&
                rejected.current !== undefined
              )
                forgetRejected(id);
              else fail(lookupError);
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
  async function download() {
    if (
      !live.current ||
      !displayed() ||
      work.current ||
      receipt?.state !== "completed"
    )
      return;
    const generation = epoch.current,
      controller = new AbortController();
    work.current = controller;
    setBusy(true);
    setError("");
    const current = () =>
      live.current && displayed() && generation === epoch.current;
    try {
      const blob = await sharedAssetOriginal(
        receipt,
        { csrf: session.csrf, current },
        controller.signal,
      );
      if (!current()) return;
      const url = URL.createObjectURL(blob);
      objectUrl.current = url;
      const link = document.createElement("a");
      link.href = url;
      link.download =
        "original-" +
        receipt.version +
        "." +
        receipt.legacyUrl!.split(".").pop();
      link.click();
      URL.revokeObjectURL(url);
      objectUrl.current = null;
    } catch (reason) {
      if (live.current && generation === epoch.current) fail(reason);
    } finally {
      if (work.current === controller) {
        work.current = null;
        if (generation === epoch.current) setBusy(false);
      }
    }
  }
  const blocked = busy || !!pending || !ready || !journalReady || locked;
  const limit = config
    ? kind === "asset" && folder === "card"
      ? config.cardMaxBytes
      : config.kinds[kind].maxBytes
    : null;
  return (
    <section className="shared-assets-page">
      <header className="page-heading">
        <h1>共享素材</h1>
        <button
          className="button"
          disabled={busy || locked}
          onClick={() => void load()}
        >
          重新读取
        </button>
      </header>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {pending && (
        <div className="shared-asset-result" role="status">
          <p>等待原操作结果</p>
          <p className="shared-asset-id">{pending}</p>
          <button
            className="button"
            disabled={busy || locked}
            onClick={() => void check()}
          >
            查询原回执
          </button>
        </div>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void upload();
        }}
      >
        <div className="shared-asset-fields">
          <label>
            类型
            <SelectMenu
              label="素材类型"
              value={kind}
              options={assetKinds}
              variant="field"
              disabled={blocked}
              onChange={(value) => {
                setKind(value as AssetKind);
                clearFile();
              }}
            />
          </label>
          {kind === "asset" && (
            <>
              <label>
                素材文件夹
                <SelectMenu
                  label="素材文件夹"
                  value={folder}
                  options={assetFolders}
                  variant="field"
                  disabled={blocked}
                  onChange={(value) => {
                    setFolder(value);
                    setMarket("");
                    clearFile();
                  }}
                />
              </label>
              {folder === "stock" && (
                <label>
                  股票市场
                  <SelectMenu
                    label="股票市场"
                    value={market}
                    variant="field"
                    disabled={blocked}
                    onChange={(value) => {
                      setMarket(value);
                      clearFile();
                    }}
                    options={[
                      { value: "", label: "不分市场" },
                      ...["US", "HK", "CN", "JP", "KR"].map((value) => ({
                        value,
                        label: value,
                      })),
                    ]}
                  />
                </label>
              )}
              {folder === "market" && (
                <label>
                  市场代码
                  <input
                    value={market}
                    disabled={blocked}
                    onChange={(event) => setMarket(event.target.value)}
                  />
                </label>
              )}
              <label>
                素材代码
                <input
                  value={code}
                  maxLength={40}
                  disabled={blocked}
                  onChange={(event) => setCode(event.target.value)}
                />
              </label>
              <label>
                显示名称
                <input
                  value={name}
                  maxLength={120}
                  disabled={blocked}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
            </>
          )}
        </div>
        <div className="shared-asset-upload">
          <label>
            文件
            <input
              ref={input}
              type="file"
              accept={config?.kinds[kind].extensions
                .map((ext) => "." + ext)
                .join(",")}
              disabled={blocked}
              onChange={(event) => {
                const next = event.target.files?.[0] ?? null;
                if (next && (!limit || next.size <= 0 || next.size > limit)) {
                  clearFile();
                  setError("文件为空或超过该类型大小上限");
                } else {
                  setFile(next);
                  setError("");
                }
              }}
            />
          </label>
          <button className="button" disabled={blocked || !file}>
            上传
          </button>
        </div>
        {limit !== null && (
          <p className="shared-asset-limit">最大 {resourceSize(limit)}</p>
        )}
      </form>
      {receipt && (
        <section className="shared-asset-result" aria-label="素材操作结果">
          <p role="status">
            {receipt.state === "completed" ? "素材已保存" : receipt.message}
          </p>
          <p className="shared-asset-id">{receipt.requestId}</p>
          {receipt.state === "completed" && (
            <>
              <div className="shared-asset-preview">
                {!imageError && (
                  <img
                    ref={preview}
                    src={receipt.url}
                    alt={
                      assetKinds.find((v) => v.value === receipt.kind)?.label ??
                      "共享素材"
                    }
                    onError={() => {
                      if (live.current) setImageError(true);
                    }}
                  />
                )}
                {imageError && <p>图片无法显示</p>}
              </div>
              <p>
                原件 {resourceSize(receipt.originalSize!)} · 展示{" "}
                {resourceSize(receipt.size!)}
              </p>
              <p>
                {receipt.originalSha256 === receipt.sha256
                  ? "原件与展示图一致"
                  : "SVG 安全展示版"}
              </p>
              <div className="shared-asset-actions">
                <a
                  className="button secondary"
                  href={receipt.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  打开固定展示图
                </a>
                <button
                  className="button secondary"
                  disabled={busy || locked}
                  onClick={() => void download()}
                >
                  下载原件
                </button>
              </div>
              <PngClipboardActions key={receipt.version} session={session} active={active && visible && !locked && !busy} image={preview} version={receipt.version!} onDenied={fail} />
              <details>
                <summary>文件详情</summary>
                <dl>
                  <dt>展示地址</dt>
                  <dd>{receipt.url}</dd>
                  <dt>原件摘要</dt>
                  <dd>{receipt.originalSha256}</dd>
                  <dt>展示摘要</dt>
                  <dd>{receipt.sha256}</dd>
                </dl>
              </details>
            </>
          )}
        </section>
      )}
      <form
        className="shared-asset-lookup"
        onSubmit={(event) => {
          event.preventDefault();
          void check(lookup.trim());
        }}
      >
        <label>
          操作编号
          <input
            value={lookup}
            disabled={locked}
            onChange={(event) => setLookup(event.target.value)}
          />
        </label>
        <button
          className="button secondary"
          disabled={busy || locked || !validAssetOperation(lookup.trim())}
        >
          查询回执
        </button>
      </form>
      <details onToggle={(event) => setCatalogOpened(event.currentTarget.open)}>
        <summary>素材目录</summary>
        <AssetLookupCatalogPanel
          session={session}
          active={active && visible && !locked && catalogOpened}
        />
      </details>
    </section>
  );
}
