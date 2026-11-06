import { LoadingPlaceholder } from "./loading-placeholder";
import { MaterialAccessSettings } from "./asset-library-access";
import { Dialog } from "./dialog";
import { PageHeader } from "./workspace-ui";
import { Settings2 } from "lucide-react";
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
import { resourceSize } from "./resource-state";
import { sharedAssetOriginal } from "./shared-asset-original";
import { PngClipboardActions } from "./png-clipboard";
import {
  AssetLibraryBrowser,
  type AssetIconTarget,
} from "./asset-library-browser";
import {
  assetKinds,
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
    return <MaterialReader session={session} active={active} />;
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
  const [config, setConfig] = useState<AssetConfig | null>(null);
  const [assetPanel, setAssetPanel] = useState<"settings" | null>(null);
  const [catalogRefresh, setCatalogRefresh] = useState(0);
  const [accessBlocked, setAccessBlocked] = useState(false);
  const catalogChanged = useCallback(
    () => setCatalogRefresh((value) => value + 1),
    [],
  );
  const lastCatalogReceipt = useRef<string | null>(null);
  const readError = useRef(false);
  const expectedIcon = useRef<
    (AssetIconTarget & { catalogRevision: number }) | null
  >(null);
  const [busy, setBusy] = useState(false),
    [pending, setPending] = useState<string | null>(null),
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
  const preview = useRef<HTMLImageElement>(null),
    work = useRef<AbortController | null>(null),
    reading = useRef<AbortController | null>(null),
    objectUrl = useRef<string | null>(null);
  const displayed = useCallback(
    () => apiSessionSnapshot().csrf === session.csrf,
    [session.csrf],
  );
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
    setReceipt(null);
    setConfig(null);
    setReady(false);
    setBusy(false);
  }, []);
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
        setNotice("");
        original.current = null;
        setPending(null);
        expectedIcon.current = null;
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
        if (readError.current) {
          setError("");
          readError.current = false;
        }
      }
    } catch (reason) {
      if (
        live.current &&
        generation === epoch.current &&
        sequence === read.current &&
        !controller.signal.aborted
      ) {
        readError.current = true;
        fail(reason);
      }
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
    const targeted = !!expectedIcon.current;
    if (
      original.current === id &&
      expectedIcon.current &&
      value.state === "completed" &&
      (!value.binding ||
        value.binding.id !== expectedIcon.current.id ||
        value.binding.type !== expectedIcon.current.type ||
        value.binding.code !== expectedIcon.current.code ||
        value.binding.market !==
          (expectedIcon.current.type === "card"
            ? expectedIcon.current.market || ""
            : (expectedIcon.current.market || "OTHER").toUpperCase()) ||
        value.binding.revision !== expectedIcon.current.catalogRevision + 1)
    )
      throw new Error("对应图标的保存结果待核对");
    if (original.current === id) {
      releaseSharedAssetRequest(sessionStorage, scope, id);
      original.current = null;
      setPending(null);
      expectedKind.current = null;
      rejected.current = undefined;
    }
    setNotice(
      value.state === "completed" && value.binding
        ? value.binding.type === "card"
          ? "卡面已更新"
          : "图标已更新"
        : "",
    );
    expectedIcon.current = null;
    setReceipt(value);
    if (
      value.state === "completed" &&
      value.version &&
      lastCatalogReceipt.current !== value.version
    ) {
      lastCatalogReceipt.current = value.version;
      catalogChanged();
    }
    setImageError(false);
    setError(value.state === "failed" ? value.message : "");
    if (targeted && value.state === "failed") catalogChanged();
    void load();
  }
  function forgetRejected(id: string) {
    releaseSharedAssetRequest(sessionStorage, scope, id);
    original.current = null;
    setPending(null);
    expectedIcon.current = null;
    expectedKind.current = null;
    rejected.current = undefined;
    setError("");
    setNotice("上次操作未受理，请重新核对素材");
    void load();
  }
  async function check(id = original.current ?? "") {
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
  async function upload(
    chosenFile: File | null,
    target: AssetIconTarget & { catalogRevision: number },
    restore = false,
  ) {
    const chosenKind = "asset";
    const chosenFolder = target.type || "";
    if (
      !live.current ||
      !displayed() ||
      work.current ||
      original.current ||
      !ready ||
      !journalReady ||
      (!chosenFile && !restore) ||
      !config
    )
      return;
    const limit =
      chosenKind === "asset" && chosenFolder === "card"
        ? config.cardMaxBytes
        : config.kinds[chosenKind].maxBytes;
    if (
      !restore &&
      chosenFile &&
      (chosenFile.size <= 0 || chosenFile.size > limit)
    ) {
      setError("文件为空或超过该类型大小上限");
      return;
    }
    if (
      !restore &&
      chosenFile &&
      !config.kinds[chosenKind].extensions.includes(
        chosenFile.name.split(".").pop()?.toLowerCase() ?? "",
      )
    ) {
      setError("此类型不支持该文件格式");
      return;
    }
    const id = requestId(),
      generation = epoch.current,
      controller = new AbortController(),
      body = new FormData();
    if (chosenFile) body.set("file", chosenFile);
    body.set("kind", chosenKind);
    body.set("requestId", id);
    body.set("expectedRevision", String(config.revision));
    if (chosenKind === "asset") {
      body.set("folder", chosenFolder);
      body.set("market", target.market || "");
      body.set("code", target.code || "");
      body.set("name", target.name || "");
    }
    if (target) {
      body.set("assetId", target.id);
      body.set("catalogRevision", String(target.catalogRevision));
      body.set("publicMetadataConfirmed", "true");
    }
    try {
      retainSharedAssetRequest(sessionStorage, scope, id);
    } catch (reason) {
      fail(reason);
      return;
    }
    original.current = id;
    expectedKind.current = chosenKind;
    expectedIcon.current = target;
    rejected.current = undefined;
    setPending(id);
    setReceipt(null);
    setNotice(
      restore
        ? "正在恢复原图…"
        : target.type === "card"
          ? "正在更新卡面…"
          : "正在更新图标…",
    );
    setError("");
    work.current = controller;
    setBusy(true);
    try {
      const result = await api<unknown>(
        base + (restore ? "/restore-card" : "/upload"),
        {
          method: "POST",
          body: restore
            ? JSON.stringify({
                requestId: id,
                expectedRevision: config.revision,
                catalogRevision: target.catalogRevision,
                assetId: target.id,
                publicMetadataConfirmed: true,
              })
            : body,
          signal: controller.signal,
        },
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
  return (
    <section className="shared-assets-page">
      <PageHeader
        title="素材库"
        actions={
          <div className="page-toolbar-actions">
            <button
              type="button"
              className="icon-button"
              aria-label="素材库设置"
              onClick={() => setAssetPanel("settings")}
              disabled={busy || locked}
            >
              <Settings2 size={18} />
            </button>
          </div>
        }
      />
      <AssetLibraryBrowser
        session={session}
        active={active && visible && !locked}
        revision={catalogRefresh}
        onRefresh={() => {
          setError("");
          void load();
        }}
        onChanged={() => {
          void load();
          catalogChanged();
        }}
        uploadDisabled={busy || locked || !ready || !journalReady || !!pending}
        onRestore={(asset, revision) => {
          void upload(null, { ...asset, catalogRevision: revision }, true);
        }}
        onReplace={(asset, revision, chosen) => {
          void upload(chosen, { ...asset, catalogRevision: revision });
        }}
      />
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {pending && (
        <div className="notice">
          <span>素材操作结果待确认</span>
          <button
            type="button"
            disabled={busy || locked}
            onClick={() => void check()}
          >
            核对上传结果
          </button>
        </div>
      )}
      {receipt && (
        <details className="shared-asset-upload-details">
          <summary>查看本次上传详情</summary>
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
                        assetKinds.find((v) => v.value === receipt.kind)
                          ?.label ?? "素材库"
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
                <PngClipboardActions
                  key={receipt.version}
                  session={session}
                  active={active && visible && !locked && !busy}
                  image={preview}
                  version={receipt.version!}
                  onDenied={fail}
                />
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
        </details>
      )}
      {assetPanel === "settings" && (
        <Dialog
          title="素材库设置"
          className="asset-settings-dialog"
          onClose={() => {
            if (!busy && !accessBlocked) setAssetPanel(null);
          }}
        >
          <MaterialAccessSettings
            session={session}
            active={active && visible && !locked}
            onBlocked={setAccessBlocked}
            onCancel={() => setAssetPanel(null)}
          />
        </Dialog>
      )}
    </section>
  );
}

function MaterialReader({
  session,
  active,
}: {
  session: Session;
  active: boolean;
}) {
  const [allowed, setAllowed] = useState<boolean | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    if (!active) {
      setAllowed(null);
      return;
    }
    const abort = new AbortController();
    void api<{ registered: boolean }>("/asset-library/access", {
      signal: abort.signal,
    })
      .then((v) => {
        if (!abort.signal.aborted) {
          if (typeof v.registered !== "boolean")
            throw Error("素材权限响应无效");
          setAllowed(v.registered);
        }
      })
      .catch((e) => {
        if (!abort.signal.aborted)
          setError(e instanceof Error ? e.message : "素材权限读取失败");
      });
    return () => abort.abort();
  }, [active, session.csrf]);
  return (
    <section className="shared-assets-page">
      <PageHeader title="素材库" />
      {error ? (
        <p role="alert">{error}</p>
      ) : allowed === false ? (
        <p role="status">素材库暂未向注册用户开放</p>
      ) : allowed === null ? (
        <LoadingPlaceholder label="正在读取素材权限" compact />
      ) : (
        <AssetLibraryBrowser
          key={JSON.stringify([
            session.instance_id,
            session.user.id,
            session.receipt_scope,
          ])}
          session={session}
          active={active}
          uploadDisabled
          readOnly
        />
      )}
    </section>
  );
}
