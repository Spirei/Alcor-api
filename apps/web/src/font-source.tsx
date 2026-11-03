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
import { PasswordField } from "./password-fields";
import { SelectMenu } from "./select-menu";
import { resourceSize } from "./resource-state";
import { sourceReadFailure, sourceWindowLabel } from "./source-window-view";
import { fontOperationId } from "./personal-font-state";
import {
  clearFontSourceRequest,
  readFontSourceRequest,
  retainFontSourceRequest,
  releaseFontSourceRequest,
  fontSourceListing,
  fontSourceOptions,
  fontSourceAvailability,
  fontSourceProof,
  fontSourceReceipt,
  type FontSourceListing,
  type FontGrantOption,
  type FontSourceKind,
  type FontSourceReceipt,
} from "./font-source-state";
import "./font-source.css";
import { FontCatalogPanel } from "./font-catalog";
const base = "/personal-font-import";
type Props = { session: Session; active: boolean; onChanged: () => void };
export function PersonalFontSourcePanel(props: Props) {
  return (
    <FontSourceSession
      key={JSON.stringify([
        props.session.instance_id,
        props.session.user.id,
        props.session.user.role,
        props.session.receipt_scope,
        props.session.csrf,
        props.session.expires_at,
      ])}
      {...props}
    />
  );
}
function FontSourceSession({ session, active, onChanged }: Props) {
  const scope = JSON.stringify([
    session.instance_id,
    session.user.id,
    session.user.role,
    session.receipt_scope,
  ]);
  const [open, setOpen] = useState(false),
    [visible, setVisible] = useState(
      typeof document === "undefined" || !document.hidden,
    ),
    [locked, setLocked] = useState(false),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [journalReady, setJournalReady] = useState(false);
  const [listing, setListing] = useState<FontSourceListing | null>(null),
    [options, setOptions] = useState<FontGrantOption[]>([]),
    [availability, setAvailability] = useState(""),
    [grant, setGrant] = useState(""),
    [oldId, setOldId] = useState(""),
    [evidence, setEvidence] = useState("");
  const [selected, setSelected] = useState(""),
    [name, setName] = useState(""),
    [ack, setAck] = useState(false),
    [password, setPassword] = useState(""),
    [code, setCode] = useState(""),
    [secretKey, setSecretKey] = useState(0);
  const [capture, setCapture] = useState(""),
    [proof, setProof] = useState<ReturnType<typeof fontSourceProof> | null>(
      null,
    ),
    [pending, setPending] = useState<string | null>(null),
    [lookup, setLookup] = useState(""),
    [closeKind, setCloseKind] = useState<FontSourceKind | "">(""),
    [receipt, setReceipt] = useState<FontSourceReceipt | null>(null),
    [error, setError] = useState("");
  const binding = useRef(apiSessionSnapshot()),
    live = useRef(false),
    epoch = useRef(0),
    reading = useRef<AbortController | null>(null),
    work = useRef<AbortController | null>(null),
    original = useRef<string | null>(null),
    secrets = useRef<HTMLDivElement>(null),
    proofRef = useRef<typeof proof>(null);
  const displayed = useCallback(
    () =>
      apiSessionSnapshot().epoch === binding.current.epoch &&
      apiSessionSnapshot().csrf === session.csrf,
    [session.csrf],
  );
  const clearSecrets = useCallback(() => {
    for (const input of secrets.current?.querySelectorAll("input") ?? []) {
      input.value = "";
      input.type = "password";
    }
    setPassword("");
    setCode("");
    setAck(false);
    setSecretKey((n) => n + 1);
  }, []);
  const pause = useCallback(() => {
    live.current = false;
    ++epoch.current;
    reading.current?.abort();
    reading.current = null;
    work.current?.abort();
    work.current = null;
    proofRef.current = null;
    setProof(null);
    clearSecrets();
    setListing(null);
    setOptions([]);
    setAvailability("");
    setReceipt(null);
    setReady(false);
    setBusy(false);
    if (!displayed()) {
      try {
        clearFontSourceRequest(sessionStorage);
      } catch {}
      original.current = null;
      setPending(null);
      setLookup("");
    }
  }, [clearSecrets, displayed]);
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
      }
      setError(reason instanceof Error ? reason.message : "字体来源读取失败");
    },
    [displayed, pause],
  );
  useLayoutEffect(() => {
    live.current = active && open && visible && !locked && displayed();
    return pause;
  }, [active, open, visible, locked, displayed, pause]);
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
      const id = readFontSourceRequest(sessionStorage, scope);
      original.current = id;
      setPending(id);
      if (id) setLookup(id);
      setJournalReady(true);
    } catch (reason) {
      setJournalReady(false);
      setLocked(true);
      fail(reason);
    }
  }, [active, open, visible, locked, displayed, scope, fail]);
  const load = useCallback(async () => {
    if (!live.current || !displayed()) return;
    const controller = new AbortController(),
      generation = epoch.current;
    reading.current?.abort();
    reading.current = controller;
    setReady(false);
    try {
      const values = await Promise.allSettled([
        api<unknown>(base + "/permissions", { signal: controller.signal }),
        session.user.role === "admin"
          ? api<unknown>(base + "/registration-options", {
              signal: controller.signal,
            })
          : Promise.resolve({ items: [] }),
      ]);
      if (
        !live.current ||
        !displayed() ||
        generation !== epoch.current ||
        controller.signal.aborted
      )
        return;
      for (const value of values)
        if (value.status === "rejected") throw value.reason;
      const rows = fontSourceListing(
          (values[0] as PromiseFulfilledResult<unknown>).value,
        ),
        available = fontSourceOptions(
          (values[1] as PromiseFulfilledResult<unknown>).value,
        );
      setListing(rows);
      setOptions(available);
      setAvailability(
        fontSourceAvailability(
          (values[1] as PromiseFulfilledResult<unknown>).value,
        ),
      );
      setReady(true);
      setError("");
    } catch (reason) {
      if (
        live.current &&
        generation === epoch.current &&
        !controller.signal.aborted
      )
        fail(reason);
    } finally {
      if (reading.current === controller) reading.current = null;
    }
  }, [displayed, fail, session.user.role]);
  useEffect(() => {
    if (active && open && visible && !locked) void load();
  }, [active, open, visible, locked, load]);
  function known(raw: unknown, id: string) {
    const value = fontSourceReceipt(raw, id);
    setReceipt(value);
    setLookup(id);
    setCloseKind(value.kind);
    setError("");
    if (value.state !== "reading" && original.current === id) {
      releaseFontSourceRequest(sessionStorage, scope, id);
      original.current = null;
      setPending(null);
    }
    proofRef.current = null;
    setProof(null);
    if (value.state === "completed") {
      if (value.permission) {
        setSelected(value.permission.id);
        if (value.permission.name) setName(value.permission.name);
      }
      if (value.capture) setCapture(value.capture.id);
      if (value.font) onChanged();
      void load();
    }
  }
  async function send(
    kind: FontSourceKind,
    path: string,
    data: Record<string, unknown>,
  ) {
    if (
      !live.current ||
      !displayed() ||
      !journalReady ||
      original.current ||
      work.current ||
      !ready
    )
      return;
    const id = requestId();
    try {
      retainFontSourceRequest(sessionStorage, scope, id);
    } catch (reason) {
      fail(reason);
      return;
    }
    original.current = id;
    setPending(id);
    setLookup(id);
    setCloseKind(kind);
    setReceipt(null);
    setError("");
    proofRef.current = null;
    setProof(null);
    clearSecrets();
    const generation = epoch.current,
      controller = new AbortController();
    work.current = controller;
    setBusy(true);
    try {
      const raw = await api<unknown>(
        base + path,
        {
          method: "POST",
          body: JSON.stringify({ ...data, requestId: id }),
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
  async function query(close = false) {
    const id = original.current ?? lookup.trim();
    if (
      !fontOperationId(id) ||
      !live.current ||
      !displayed() ||
      work.current ||
      (close && !closeKind)
    )
      return;
    const generation = epoch.current,
      controller = new AbortController();
    work.current = controller;
    setBusy(true);
    setError("");
    try {
      const raw = await api<unknown>(
        base + "/operations/" + id + (close ? "/close" : ""),
        {
          ...(close
            ? {
                method: "POST",
                body: JSON.stringify({ expectedKind: closeKind }),
              }
            : {}),
          signal: controller.signal,
        },
        close ? session.csrf : undefined,
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
        if (reason instanceof ApiError && reason.status === 404)
          setError("尚未查到原操作，可继续核对或显式关闭原编号");
      }
    } finally {
      if (work.current === controller) {
        work.current = null;
        if (generation === epoch.current) setBusy(false);
      }
    }
  }
  const chosen = listing?.items.find(
      (p) => p.id === selected && p.ownerId === session.user.id,
    ),
    captured = listing?.captures.find((c) => c.id === capture),
    disabled =
      !active ||
      !open ||
      !visible ||
      locked ||
      !ready ||
      busy ||
      !journalReady ||
      !!pending;
  async function preview() {
    if (disabled || !captured || !live.current || !displayed() || work.current)
      return;
    const generation = epoch.current,
      controller = new AbortController();
    work.current = controller;
    setBusy(true);
    proofRef.current = null;
    setProof(null);
    setError("");
    try {
      const raw = await api<unknown>(
        base + "/preview",
        {
          method: "POST",
          body: JSON.stringify({ captureId: captured.id }),
          signal: controller.signal,
        },
        session.csrf,
      );
      if (live.current && displayed() && generation === epoch.current) {
        const value = fontSourceProof(raw, captured);
        proofRef.current = value;
        setProof(value);
      }
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
  return (
    <details
      className="font-source-panel"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>旧字体导入</summary>
      {open && (
        <div className="font-source-body">
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
          {error && <p role="alert">{error}</p>}
          {ready && session.user.role === "admin" && availability && (
            <p role="status">{availability}</p>
          )}
          {session.user.role === "admin" && (
            <FontCatalogPanel
              session={session}
              active={active && open && visible && !locked}
              blocked={disabled}
              options={options}
              onDenied={fail}
              onRegister={(path, data) => void send("register", path, data)}
            />
          )}
          {session.user.role === "admin" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const value = options.find((g) => g.grantId === grant);
                if (value)
                  void send("register", "/permissions", {
                    grantId: value.grantId,
                    grantRevision: value.grantRevision,
                    originalId: oldId.trim(),
                    evidenceRef: evidence.trim(),
                  });
              }}
            >
              <SelectMenu
                label="来源与目标账号"
                value={grant}
                options={[
                  { value: "", label: "选择已授权来源" },
                  ...options.map((g) => ({
                    value: g.grantId,
                    label:
                      g.username +
                      " · " +
                      g.sourceAlias +
                      " · " +
                      g.sourceOwner,
                  })),
                ]}
                variant="field"
                disabled={disabled}
                onChange={setGrant}
              />
              {options.find((g) => g.grantId === grant) && (
                <p>
                  {sourceWindowLabel(
                    options.find((g) => g.grantId === grant)!.window,
                  )}
                </p>
              )}
              <label>
                旧字体编号
                <input
                  value={oldId}
                  onChange={(e) => setOldId(e.target.value)}
                  disabled={disabled}
                  spellCheck={false}
                />
              </label>
              <label>
                归属凭据
                <input
                  value={evidence}
                  onChange={(e) => setEvidence(e.target.value)}
                  disabled={disabled}
                  maxLength={200}
                />
              </label>
              <button
                type="submit"
                disabled={
                  disabled || !grant || !oldId.trim() || !evidence.trim()
                }
              >
                登记待确认文件
              </button>
            </form>
          )}
          {listing && (
            <>
              <p>
                已登记 {listing.items.length} · 本人已归档{" "}
                {listing.captures.length}
              </p>
              {listing.items.length === 0 && <p>暂无已登记文件</p>}
              <SelectMenu
                label="本人来源文件"
                value={selected}
                options={[
                  { value: "", label: "选择本人文件" },
                  ...listing.items
                    .filter((p) => p.ownerId === session.user.id)
                    .map((p) => ({
                      value: p.id,
                      label:
                        (p.name ?? p.originalId) +
                        " · " +
                        {
                          pending_owner: "待本人确认",
                          active: "已授权",
                          revoked: "已撤销",
                        }[p.state],
                    })),
                ]}
                variant="field"
                disabled={disabled}
                onChange={(v) => {
                  clearSecrets();
                  setSelected(v);
                  setName(listing.items.find((p) => p.id === v)?.name ?? "");
                  proofRef.current = null;
                  setProof(null);
                }}
              />
              {chosen && (
                <>
                  <p>{sourceWindowLabel(chosen.window)}</p>
                  <p className="font-source-id">{chosen.originalId}</p>
                  <p>归属凭据：{chosen.evidenceRef}</p>
                  {chosen.state !== "revoked" && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void send(
                          "consent",
                          "/permissions/" + chosen.id + "/consent",
                          {
                            revision: chosen.revision,
                            approve: chosen.state === "pending_owner",
                            acknowledgeUnverifiedUploader:
                              chosen.state === "pending_owner" && ack,
                            name: chosen.name ?? name,
                            password,
                            code,
                          },
                        );
                      }}
                    >
                      <label>
                        字体名称
                        <input
                          value={name}
                          maxLength={60}
                          disabled={disabled || chosen.state === "active"}
                          onChange={(e) => setName(e.target.value)}
                        />
                      </label>
                      {chosen.state === "pending_owner" && (
                        <label className="font-source-ack">
                          <input
                            type="checkbox"
                            checked={ack}
                            disabled={disabled}
                            onChange={(e) => setAck(e.target.checked)}
                          />
                          确认将此文件迁入本人账户，旧文件名不能证明上传者
                        </label>
                      )}
                      <div
                        ref={secrets}
                        key={secretKey}
                        className="font-source-secrets"
                      >
                        <label htmlFor="font-source-password">当前密码</label>
                        <PasswordField
                          id="font-source-password"
                          value={password}
                          disabled={disabled}
                          autoComplete="current-password"
                          onChange={(e) => setPassword(e.target.value)}
                        />
                        <label>
                          验证码
                          <input
                            value={code}
                            disabled={disabled}
                            autoComplete="one-time-code"
                            onChange={(e) => setCode(e.target.value)}
                            maxLength={32}
                          />
                        </label>
                      </div>
                      <button
                        type="submit"
                        disabled={
                          disabled ||
                          !password ||
                          (chosen.state === "pending_owner" &&
                            (!ack || !name.trim()))
                        }
                      >
                        {chosen.state === "pending_owner"
                          ? "确认授权"
                          : "撤销授权"}
                      </button>
                    </form>
                  )}
                  {chosen.state === "active" && (
                    <button
                      type="button"
                      disabled={
                        disabled ||
                        listing.captures.some(
                          (c) => c.permissionId === chosen.id,
                        )
                      }
                      onClick={() =>
                        void send("capture", "/captures", {
                          permissionId: chosen.id,
                          permissionRevision: chosen.revision,
                        })
                      }
                    >
                      捕获原件
                    </button>
                  )}
                </>
              )}
              <SelectMenu
                label="已归档原件"
                value={capture}
                options={[
                  { value: "", label: "选择已归档字体" },
                  ...listing.captures.map((c) => ({
                    value: c.id,
                    label:
                      (listing.items.find((p) => p.id === c.permissionId)
                        ?.name ?? c.id) +
                      " · " +
                      resourceSize(c.size),
                  })),
                ]}
                variant="field"
                disabled={disabled}
                onChange={(v) => {
                  setCapture(v);
                  proofRef.current = null;
                  setProof(null);
                }}
              />
              {captured && (
                <div className="font-source-id">
                  <p>{resourceSize(captured.size)}</p>
                  <details>
                    <summary>原件详情</summary>
                    <p>SHA256：{captured.sha256}</p>
                    <p>捕获操作：{captured.requestId}</p>
                  </details>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => void preview()}
                  >
                    预览导入
                  </button>
                </div>
              )}
              {proof && (
                <div>
                  <p>
                    {proof.plan.name} · {resourceSize(proof.plan.size)} ·{" "}
                    {proof.plan.action === "already_mapped"
                      ? "已映射本人字体"
                      : "待导入本人字体"}
                  </p>
                  <button
                    type="button"
                    className="primary"
                    disabled={disabled || proof.plan.captureId !== capture}
                    onClick={() => {
                      const value = proofRef.current;
                      if (value && value.plan.captureId === capture)
                        void send("apply", "/operations", {
                          captureId: value.plan.captureId,
                          permissionRevision: value.plan.permissionRevision,
                          expectedRevision: value.plan.expectedRevision,
                          preview: value.preview,
                        });
                    }}
                  >
                    确认导入
                  </button>
                </div>
              )}
            </>
          )}
          {receipt && (
            <p role="status">
              {receipt.state === "reading"
                ? "原操作处理中"
                : receipt.state === "completed"
                  ? {
                      register: "文件登记完成，待本人确认",
                      consent: "本人授权已保存",
                      capture: "单个原件已归档",
                      apply: "单个字体已导入",
                    }[receipt.kind]
                  : receipt.canceled
                    ? "原操作已关闭"
                    : sourceReadFailure(receipt.message ?? receipt.reason)}
            </p>
          )}
          <div className="font-source-recovery">
            <label>
              原操作编号
              <input
                value={pending ?? lookup}
                disabled={busy || !!pending}
                spellCheck={false}
                onChange={(e) => setLookup(e.target.value)}
              />
            </label>
            <button
              type="button"
              disabled={
                !active ||
                !open ||
                !visible ||
                locked ||
                busy ||
                !fontOperationId(pending ?? lookup.trim())
              }
              onClick={() => void query()}
            >
              查询原操作
            </button>
            <SelectMenu
              label="待关闭操作类型"
              value={closeKind}
              options={[
                { value: "", label: "选择原操作类型" },
                ...(
                  [
                    ["register", "登记"],
                    ["consent", "本人确认"],
                    ["capture", "捕获"],
                    ["apply", "导入"],
                  ] as const
                ).map(([value, label]) => ({ value, label })),
              ]}
              variant="field"
              disabled={busy || locked}
              onChange={(v) => setCloseKind(v as FontSourceKind | "")}
            />
            <button
              type="button"
              disabled={
                !active ||
                !open ||
                !visible ||
                locked ||
                busy ||
                !closeKind ||
                !fontOperationId(pending ?? lookup.trim())
              }
              onClick={() => void query(true)}
            >
              关闭原操作
            </button>
          </div>
        </div>
      )}
    </details>
  );
}
