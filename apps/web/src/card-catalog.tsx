import { WorkspaceTabs, WorkspaceView } from "./workspace-ui";
import { useState as useWorkspaceState } from "react";
import { CardRecognition } from "./card-recognition";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, type Session } from "./api";
import { requestId } from "./request-id";
import { SelectMenu } from "./select-menu";
import {
  readCardOperation,
  releaseCardOperation,
  retainCardOperation,
  type CardOperation,
} from "./card-catalog-state";
import "./card-catalog.css";
import { CardPreferenceSettings } from "./card-preference-settings";
import { CardWalletPanel } from "./card-wallet";
import { preferenceCards } from "./card-preference-state";

type CustomCard = {
  id: string;
  name: string;
  bank: string;
  region: string;
  type: string;
  image: string;
  createdAt: string;
  materialState: string;
};
type Snapshot = {
  sourceRevision: number;
  source: null | {
    sourceLabel: string | null;
    sha256: string;
    id: string;
    cardCount: number;
    importedAt: string;
    manifest: unknown;
  };
  customCards: CustomCard[];
  preferenceRevision: number;
  publishedAssetsPartial: boolean;
  publishedAssets: {
    id: string;
    name: string;
    market: string;
    materialState: string;
  }[];
  availableImages: { path: string; sha256: string; version: string }[];
  availableImagesPartial: boolean;
};
type Preview = {
  sourceRevision: number;
  sha256: string;
  sourceLabel: string;
  cardCount: number;
  regionCount: number;
};
type Receipt = {
  requestId: string;
  kind: CardOperation["kind"];
  state: "completed" | "closed";
  cardCount?: number;
};
const empty = {
  name: "",
  bank: "",
  region: "",
  type: "其他",
  brand: "",
  level: "",
  image: "",
  currencyScope: "",
};
const types = [
  "借记卡",
  "信用卡",
  "预付卡",
  "签账卡",
  "取现卡",
  "交通卡",
  "礼品卡",
  "虚拟卡",
  "其他",
].map((value) => ({ value, label: value }));
const currencies = [
  { value: "", label: "自动" },
  { value: "single", label: "单币" },
  { value: "dual", label: "双币" },
  { value: "multi", label: "多币" },
  { value: "unknown", label: "未知" },
];

export function CardCatalogPage(props: { session: Session; active?: boolean }) {
  const session = props.session;
  return (
    <CardCatalogContent
      key={JSON.stringify([
        session.instance_id,
        session.user.id,
        session.user.role,
        session.receipt_scope,
        session.csrf,
        session.expires_at,
      ])}
      {...props}
    />
  );
}

function CardCatalogContent({
  session,
  active = true,
}: {
  session: Session;
  active?: boolean;
}) {
  const [workspaceSection, setWorkspaceSection] =
    useWorkspaceState("preferences");

  const scope = JSON.stringify([
    session.instance_id,
    session.user.id,
    session.user.role,
    session.receipt_scope,
  ]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [sourceText, setSourceText] = useState("");
  const [sourceLabel, setSourceLabel] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [form, setForm] = useState(empty);
  const [pending, setPending] = useState<CardOperation | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [stateScope, setStateScope] = useState(scope);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const sourceGeneration = useRef(0);
  const visible = useRef(active);
  const readEpoch = useRef(0);
  if (visible.current !== active) {
    visible.current = active;
    readEpoch.current += 1;
    if (!active) sourceGeneration.current += 1;
  }
  useEffect(() => {
    currentScope.current = scope;
    return () => {
      currentScope.current = "";
      sourceGeneration.current += 1;
      readEpoch.current += 1;
    };
  }, [scope]);
  const cardChoices = useMemo(
    () =>
      preferenceCards(snapshot?.source?.manifest, snapshot?.customCards ?? []),
    [snapshot],
  );
  const report = useCallback((failure: unknown) => {
    if (
      !currentScope.current ||
      (!visible.current &&
        !(failure instanceof ApiError && [401, 403].includes(failure.status)))
    )
      return;
    setError(failure instanceof Error ? failure.message : "卡面操作未完成");
    if (failure instanceof ApiError && [401, 403].includes(failure.status)) {
      setSnapshot(null);
      setSourceText("");
      setSourceLabel("");
      setPreview(null);
      setForm(empty);
      setReceipt(null);
    }
  }, []);
  const refresh = useCallback(async () => {
    if (!visible.current || !currentScope.current) return;
    const mine = currentScope.current,
      epoch = ++readEpoch.current;
    const data = await api<Snapshot>("/account/card-catalog");
    if (
      mine === currentScope.current &&
      epoch === readEpoch.current &&
      visible.current
    )
      setSnapshot(data);
  }, []);
  useEffect(() => {
    sourceGeneration.current += 1;
    setSnapshot(null);
    setSourceText("");
    setSourceLabel("");
    setPreview(null);
    setForm(empty);
    setPending(null);
    setReceipt(null);
    setBusy(false);
    setStateScope(scope);
    setError("");
    try {
      setPending(readCardOperation(sessionStorage, scope));
    } catch (failure) {
      report(failure);
    }
  }, [scope, report]);
  useEffect(() => {
    if (!active) return;
    let valid = true;
    void refresh().catch((failure) => {
      if (valid) report(failure);
    });
    return () => {
      valid = false;
      readEpoch.current += 1;
    };
  }, [active, scope, refresh, report]);

  async function write(
    kind: CardOperation["kind"],
    path: string,
    method: string,
    body?: unknown,
  ) {
    if (pending || busy || !snapshot) return;
    const mine = scope;
    const operation = { requestId: requestId(), kind };
    setBusy(true);
    setError("");
    setReceipt(null);
    try {
      retainCardOperation(sessionStorage, scope, operation);
      setPending(operation);
      const result = await api<Receipt>(
        path,
        {
          method,
          headers: {
            "X-Alcor-Request-Id": operation.requestId,
            "X-Alcor-Cards-Revision": String(snapshot.preferenceRevision),
          },
          ...(body !== undefined
            ? {
                body: JSON.stringify(
                  kind === "source_import"
                    ? { ...(body as object), requestId: operation.requestId }
                    : body,
                ),
              }
            : {}),
        },
        session.csrf,
        30000,
      );
      if (mine !== currentScope.current) return;
      if (
        result.requestId !== operation.requestId ||
        result.kind !== operation.kind ||
        !(["completed", "closed"] as const).includes(result.state)
      )
        throw new Error("原卡面回执不匹配，请核对原请求");
      releaseCardOperation(sessionStorage, scope, operation.requestId);
      setPending(null);
      setReceipt(result);
      if (kind === "custom_create") setForm(empty);
      if (kind === "source_import") {
        setPreview(null);
        setSourceText("");
      }
      await refresh();
    } catch (failure) {
      if (mine !== currentScope.current) return;
      if (
        failure instanceof ApiError &&
        [400, 401, 403, 404, 405, 413, 415, 422, 429].includes(failure.status)
      ) {
        try {
          releaseCardOperation(sessionStorage, scope, operation.requestId);
          setPending(null);
        } catch {
          /* Preserve a mismatching original UUID for manual lookup. */
        }
      }
      report(failure);
    } finally {
      if (mine === currentScope.current) setBusy(false);
    }
  }
  async function lookup() {
    if (!pending || busy) return;
    const operation = pending,
      mine = scope;
    setBusy(true);
    setError("");
    try {
      const result = await api<Receipt>(
        "/account/card-catalog/operations/" + operation.requestId,
      );
      if (mine !== currentScope.current) return;
      if (
        result.requestId !== operation.requestId ||
        result.kind !== operation.kind ||
        !(["completed", "closed"] as const).includes(result.state)
      )
        throw new Error("原卡面回执不匹配");
      releaseCardOperation(sessionStorage, scope, operation.requestId);
      setPending(null);
      setReceipt(result);
      await refresh();
    } catch (failure) {
      if (mine !== currentScope.current) return;
      report(failure);
    } finally {
      if (mine === currentScope.current) setBusy(false);
    }
  }
  async function closeOriginal() {
    if (!pending || busy) return;
    const operation = pending,
      mine = scope;
    setBusy(true);
    setError("");
    try {
      const result = await api<Receipt>(
        "/account/card-catalog/operations/" + operation.requestId + "/close",
        { method: "POST", body: JSON.stringify({ kind: operation.kind }) },
        session.csrf,
      );
      if (mine !== currentScope.current) return;
      if (
        result.requestId !== operation.requestId ||
        result.kind !== operation.kind ||
        !["completed", "closed"].includes(result.state)
      )
        throw new Error("原卡面回执不匹配");
      releaseCardOperation(sessionStorage, scope, operation.requestId);
      setPending(null);
      setReceipt(result);
      await refresh();
    } catch (failure) {
      if (mine === currentScope.current) report(failure);
    } finally {
      if (mine === currentScope.current) setBusy(false);
    }
  }
  async function loadFile(file: File | undefined) {
    const mine = ++sourceGeneration.current;
    setSourceText("");
    setPreview(null);
    setError("");
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setError("清单超过2MB上限");
      return;
    }
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        await file.arrayBuffer(),
      );
    } catch {
      if (mine === sourceGeneration.current) setError("清单必须是UTF-8文本");
      return;
    }
    if (mine !== sourceGeneration.current) return;
    setSourceText(text);
    setSourceLabel(file.name);
  }
  async function previewSource() {
    const mine = sourceGeneration.current,
      context = scope;
    setBusy(true);
    setError("");
    try {
      const result = await api<Preview>(
        "/admin/card-catalog/preview",
        {
          method: "POST",
          body: JSON.stringify({ manifestText: sourceText, sourceLabel }),
        },
        session.csrf,
      );
      if (mine === sourceGeneration.current && context === currentScope.current)
        setPreview(result);
    } catch (failure) {
      if (context === currentScope.current) report(failure);
    } finally {
      if (context === currentScope.current) setBusy(false);
    }
  }
  if (stateScope !== scope)
    return (
      <section className="card-catalog" aria-label="卡面目录">
        <h1>卡面</h1>
      </section>
    );
  const disabled = busy || pending !== null;
  return (
    <section className="card-catalog" aria-label="卡面目录">
      <header className="card-catalog-heading">
        <h1>卡面</h1>
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => void refresh().catch(report)}
        >
          刷新
        </button>
      </header>
      {error && (
        <p role="alert" className="card-catalog-error">
          {error}
        </p>
      )}
      {pending && (
        <div className="card-catalog-pending">
          <code>{pending.requestId}</code>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => void lookup()}
          >
            核对原请求
          </button>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => void closeOriginal()}
          >
            关闭原请求
          </button>
        </div>
      )}
      {receipt && (
        <p role="status">
          {receipt.state === "closed"
            ? "已关闭原请求"
            : receipt.kind === "source_import"
              ? `已保存清单 · ${receipt.cardCount ?? "—"} 张`
              : receipt.kind === "custom_create"
                ? "已添加卡面"
                : "已删除自建卡"}
        </p>
      )}
      <WorkspaceTabs
        label="卡面视图"
        value={workspaceSection}
        onChange={setWorkspaceSection}
        items={[
          { value: "preferences", label: "卡面图库" },
          { value: "wallet", label: "我的卡包" },
          { value: "custom", label: "自建卡与识别" },
          { value: "sources", label: "来源清单" },
        ]}
      />

      <WorkspaceView active={workspaceSection === "sources"} label="来源清单">
        <article className="card-catalog-panel">
          <h2>来源</h2>
          {snapshot?.source ? (
            <>
              <div>{snapshot.source.sourceLabel}</div>
              <span>{snapshot.source.cardCount} 张</span>
              <details>
                <summary>详情</summary>
                <dl>
                  <dt>SHA-256</dt>
                  <dd>
                    <code>{snapshot.source.sha256}</code>
                  </dd>
                  <dt>导入时间</dt>
                  <dd>
                    {new Date(snapshot.source.importedAt).toLocaleString()}
                  </dd>
                  {session.user.role === "admin" && (
                    <>
                      <dt>已发布卡面关联</dt>
                      <dd>
                        {snapshot.publishedAssets.length}
                        {snapshot.publishedAssetsPartial ? "+" : ""}
                      </dd>
                    </>
                  )}
                  <dt>原件</dt>
                  <dd>清单快照不包含素材原件</dd>
                  {session.user.role === "admin" && (
                    <>
                      <dt>原清单</dt>
                      <dd>
                        <a
                          href={`/api/admin/card-catalog/sources/${snapshot.source.id}/original`}
                        >
                          下载
                        </a>
                      </dd>
                    </>
                  )}
                </dl>
              </details>
            </>
          ) : (
            <p>{snapshot ? "来源未核对" : "正在读取"}</p>
          )}
          {session.user.role === "admin" && (
            <div className="card-catalog-source">
              <label>
                清单
                <input
                  type="file"
                  accept="application/json,.json"
                  disabled={disabled}
                  onChange={(event) =>
                    void loadFile(event.target.files?.[0]).catch(report)
                  }
                />
              </label>
              <label>
                来源名称
                <input
                  value={sourceLabel}
                  maxLength={120}
                  disabled={disabled}
                  onChange={(event) => {
                    sourceGeneration.current += 1;
                    setSourceLabel(event.target.value);
                    setPreview(null);
                  }}
                />
              </label>
              <div className="card-catalog-actions">
                <button
                  className="button secondary"
                  disabled={disabled || !sourceText || !sourceLabel}
                  onClick={() => void previewSource()}
                >
                  核对清单
                </button>
                {preview && (
                  <>
                    <span>
                      {preview.regionCount} 个地区 · {preview.cardCount} 张
                    </span>
                    <button
                      className="button primary"
                      disabled={disabled}
                      onClick={() =>
                        void write(
                          "source_import",
                          "/admin/card-catalog/imports",
                          "POST",
                          {
                            manifestText: sourceText,
                            sourceLabel,
                            expectedRevision: preview.sourceRevision,
                            expectedDigest: preview.sha256,
                          },
                        )
                      }
                    >
                      确认导入
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </article>
      </WorkspaceView>

      <WorkspaceView
        active={workspaceSection === "custom"}
        label="自建卡与识别"
      >
        <CardRecognition
          session={session}
          active={active}
          blocked={busy || !!pending}
          images={snapshot?.availableImages || []}
          onDenied={report}
          onApply={(candidate) =>
            setForm((previous) => ({
              ...previous,
              ...Object.fromEntries(
                Object.entries(candidate).filter(
                  ([key, value]) =>
                    [
                      "name",
                      "bank",
                      "region",
                      "type",
                      "brand",
                      "level",
                    ].includes(key) &&
                    typeof value === "string" &&
                    value.trim(),
                ),
              ),
            }))
          }
        />
      </WorkspaceView>

      <WorkspaceView
        active={workspaceSection === "preferences"}
        label="卡面图库"
      >
        <CardPreferenceSettings
          images={snapshot?.availableImages || []}
          session={session}
          active={active}
          cards={cardChoices.cards}
          invalid={cardChoices.invalid}
          revisionHint={snapshot?.preferenceRevision ?? 0}
          onChanged={() => void refresh().catch(report)}
          onPermissionError={report}
        />
      </WorkspaceView>

      <WorkspaceView active={workspaceSection === "wallet"} label="我的卡包">
        <CardWalletPanel
          session={session}
          active={active}
          cards={cardChoices.cards}
          revisionHint={snapshot?.preferenceRevision ?? 0}
          onChanged={() => void refresh().catch(report)}
          onPermissionError={report}
        />
      </WorkspaceView>

      <WorkspaceView
        active={workspaceSection === "custom"}
        label="自建卡与识别"
      >
        <article className="card-catalog-panel">
          <h2>自建卡</h2>
          <form
            className="card-catalog-form"
            onSubmit={(event) => {
              event.preventDefault();
              void write(
                "custom_create",
                "/account/card-catalog/custom",
                "POST",
                form,
              );
            }}
          >
            {(
              [
                ["name", "卡名", 60],
                ["bank", "银行", 60],
                ["region", "地区", 24],
                ["brand", "卡组织", 24],
                ["level", "等级", 24],
                ["image", "卡面图片地址", 300],
              ] as const
            ).map(([key, label, maxLength]) => (
              <label key={key}>
                {label}
                <input
                  value={form[key]}
                  maxLength={maxLength}
                  required={["name", "bank", "image"].includes(key)}
                  disabled={disabled}
                  list={key === "image" ? "card-catalog-images" : undefined}
                  onChange={(event) =>
                    setForm((value) => ({
                      ...value,
                      [key]: event.target.value,
                    }))
                  }
                />
              </label>
            ))}
            <label>
              类型
              <SelectMenu
                label="卡片类型"
                value={form.type}
                options={types}
                disabled={disabled}
                onChange={(value) =>
                  setForm((previous) => ({ ...previous, type: value }))
                }
                variant="field"
              />
            </label>
            <label>
              币种范围
              <SelectMenu
                label="币种范围"
                value={form.currencyScope}
                options={currencies}
                disabled={disabled}
                onChange={(value) =>
                  setForm((previous) => ({ ...previous, currencyScope: value }))
                }
                variant="field"
              />
            </label>
            <div className="card-catalog-actions">
              <button
                className="button primary"
                disabled={disabled || !snapshot?.source}
                type="submit"
              >
                添加
              </button>
            </div>
          </form>
          <datalist id="card-catalog-images">
            {snapshot?.availableImages.map((image) => (
              <option key={image.path} value={image.path} />
            ))}
          </datalist>
          {snapshot?.availableImagesPartial && <p>图片候选仅显示前1000项</p>}
          <div className="card-catalog-list">
            {snapshot?.customCards.map((card) => (
              <div key={card.id} className="card-catalog-row">
                <div>
                  <strong>{card.name}</strong>
                  <div>
                    {card.bank}
                    {card.region ? ` · ${card.region}` : ""}
                  </div>
                  {card.materialState === "unverified-reference" && (
                    <span>图片来源未核对</span>
                  )}
                </div>
                <button
                  className="button secondary"
                  disabled={disabled}
                  onClick={() => {
                    if (window.confirm(`删除自建卡“${card.name}”？`))
                      void write(
                        "custom_delete",
                        "/account/card-catalog/custom?id=" +
                          encodeURIComponent(card.id),
                        "DELETE",
                      );
                  }}
                >
                  删除
                </button>
              </div>
            ))}
          </div>
        </article>
      </WorkspaceView>
    </section>
  );
}
