import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { api, ApiError, type Session } from "./api";
import { apiSessionSnapshot } from "./api-session";
import { SelectMenu } from "./select-menu";
import {
  sourceUuid,
  type SourceManifest,
  type SourcePending,
  type SourceReceipt,
} from "./watch-group-source-state";
import {
  sourceIconCanCapture,
  sourceIconLabel,
  sourceIconProof,
  sourceIconReason,
  sourceIconReceipt,
  type SourceIconCapture,
  type SourceIconProof,
} from "./watch-group-source-icon-state";
import { sourceIconOriginal } from "./watch-group-source-icon-media";
const base = "/watch-group-import";
type Props = {
  session: Session;
  active: boolean;
  blocked: boolean;
  revision: number | null;
  manifest: SourceManifest | null;
  receipt: SourceReceipt | null;
  onBusy: (value: boolean) => void;
  onCommand: (
    kind: SourcePending["kind"],
    path: string,
    data: Record<string, unknown>,
  ) => Promise<void>;
  onDenied: (reason: unknown) => void;
};
export function WatchGroupSourceIcons({
  session,
  active,
  blocked,
  revision,
  manifest,
  receipt,
  onBusy,
  onCommand,
  onDenied,
}: Props) {
  const [open, setOpen] = useState(false),
    [group, setGroup] = useState(""),
    [captureId, setCaptureId] = useState(""),
    [captured, setCaptured] = useState<SourceIconCapture | null>(null),
    [proof, setProof] = useState<SourceIconProof | null>(null),
    [replace, setReplace] = useState(false),
    [beforeIcon, setBeforeIcon] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const work = useRef<AbortController | null>(null),
    generation = useRef(0),
    live = useRef(false);
  const displayed = useCallback(
    () => apiSessionSnapshot().csrf === session.csrf,
    [session.csrf],
  );
  const pause = useCallback(() => {
    live.current = false;
    ++generation.current;
    work.current?.abort();
    work.current = null;
    setProof(null);
    setBusy(false);
  }, []);
  useLayoutEffect(() => {
    live.current = active && open && displayed() && !document.hidden;
    ++generation.current;
    return pause;
  }, [active, open, displayed, pause]);
  useEffect(() => {
    onBusy(busy);
    return () => onBusy(false);
  }, [busy, onBusy]);
  useEffect(() => {
    setGroup("");
    setProof(null);
  }, [manifest?.id]);
  useEffect(() => {
    if (blocked) setProof(null);
  }, [blocked]);
  useEffect(() => {
    if (proof && revision !== null && proof.groupRevision !== revision)
      setProof(null);
  }, [revision, proof]);
  useEffect(() => {
    if (receipt?.domain !== "source_icon") return;
    try {
      const value = sourceIconReceipt(receipt, receipt.requestId);
      setProof(null);
      setError("");
      if (value.kind === "capture") {
        setCaptured(value);
        setCaptureId(value.requestId);
        setReplace(false);
        setBeforeIcon(null);
      } else setCaptureId(value.captureRequestId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "原图回执待核对");
    }
  }, [receipt]);
  const current = (at: number) =>
    live.current && displayed() && generation.current === at;
  function fail(reason: unknown) {
    setError(reason instanceof Error ? reason.message : "图标操作待核对");
    if (
      !displayed() ||
      (reason instanceof ApiError &&
        ([401, 403].includes(reason.status) ||
          reason.code === "session_changed"))
    ) {
      pause();
      setCaptured(null);
      setCaptureId("");
      setBeforeIcon(null);
      setReplace(false);
      onDenied(reason);
    }
  }
  async function request(operation: "read" | "preview" | "download") {
    if (!live.current || work.current || blocked) return;
    const id = captureId.trim();
    if (!sourceUuid(id)) {
      setError("请输入有效原图操作编号");
      return;
    }
    const at = generation.current,
      controller = new AbortController();
    work.current = controller;
    setBusy(true);
    setError("");
    try {
      if (operation === "read") {
        const value = sourceIconReceipt(
          await api<unknown>(base + "/operations/" + id, {
            signal: controller.signal,
          }),
          id,
        );
        if (value.kind !== "capture") throw Error("请填写原图读取操作编号");
        if (current(at)) {
          setCaptured(value);
          setProof(null);
          setBeforeIcon(null);
          setReplace(false);
        }
      } else if (operation === "preview") {
        const value = sourceIconProof(
          await api<unknown>(
            base + "/operations/" + id + "/icon-preview",
            {
              method: "POST",
              body: JSON.stringify({ replaceCurrent: replace }),
              signal: controller.signal,
            },
            session.csrf,
          ),
          id,
          replace,
        );
        if (current(at)) {
          setBeforeIcon(value.beforeIcon);
          setProof(value);
        }
      } else {
        if (!captured || captured.requestId !== id)
          throw Error("请先读取原图回执");
        const blob = await sourceIconOriginal(
          captured,
          { csrf: session.csrf, current: () => current(at) },
          controller.signal,
        );
        if (current(at)) {
          const url = URL.createObjectURL(blob),
            anchor = document.createElement("a");
          try {
            anchor.href = url;
            anchor.download = "source-group-icon-" + id + ".original";
            anchor.click();
          } finally {
            URL.revokeObjectURL(url);
          }
        }
      }
    } catch (reason) {
      if (current(at) && !controller.signal.aborted) fail(reason);
    } finally {
      if (work.current === controller) {
        work.current = null;
        if (current(at)) setBusy(false);
      }
    }
  }
  const disabled = !active || !open || blocked || busy,
    selected = manifest?.groups.find((r) => r.originalId === group),
    icon =
      receipt?.domain === "source_icon"
        ? sourceIconReceipt(receipt, receipt.requestId)
        : null;
  return (
    <details
      className="watch-group-source-icons"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>来源图标</summary>
      {open && (
        <div className="watch-group-source-icon-body">
          {error && <p role="alert">{error}</p>}
          {manifest && (
            <div className="watch-group-source-controls">
              <SelectMenu
                value={group}
                disabled={disabled}
                options={[
                  { value: "", label: "选择原分组" },
                  ...manifest.groups
                    .filter((r) => r.originalId && !r.blocker)
                    .map((r) => ({
                      value: r.originalId!,
                      label:
                        (r.name ?? r.originalId!) +
                        (r.kind === "market" ? " · 市场默认" : ""),
                    })),
                ]}
                onChange={(value) => {
                  setGroup(value);
                  setProof(null);
                }}
                label="原图来源分组"
              />
              <button
                className="button secondary"
                type="button"
                disabled={
                  disabled || !selected || !sourceIconCanCapture(manifest)
                }
                onClick={() => {
                  if (
                    !selected?.originalId ||
                    !sourceIconCanCapture(manifest)
                  ) {
                    setError("来源读取窗口已到期或无法核验，请刷新清单");
                    return;
                  }
                  void onCommand(
                    "capture",
                    base + "/manifests/" + manifest.id + "/icons/captures",
                    { originalGroupId: selected.originalId },
                  );
                }}
              >
                读取该组原图
              </button>
            </div>
          )}
          <div className="watch-group-source-controls">
            <label>
              原图读取操作编号
              <input
                value={captureId}
                disabled={disabled}
                spellCheck={false}
                onChange={(e) => {
                  setCaptureId(e.target.value);
                  setCaptured(null);
                  setProof(null);
                  setBeforeIcon(null);
                  setReplace(false);
                }}
              />
            </label>
            <button
              className="button secondary"
              type="button"
              disabled={disabled || !sourceUuid(captureId.trim())}
              onClick={() => void request("read")}
            >
              查看原图回执
            </button>
          </div>
          {captured && (
            <SourceOriginalDetails
              captured={captured}
              showState={receipt?.requestId !== captured.requestId}
            />
          )}
          <div className="watch-group-source-controls">
            <button
              className="button secondary"
              type="button"
              disabled={
                disabled ||
                captured?.captureState !== "captured" ||
                captured.requestId !== captureId.trim()
              }
              onClick={() => void request("download")}
            >
              下载已归档原图
            </button>
            <button
              className="button secondary"
              type="button"
              disabled={disabled || !sourceUuid(captureId.trim())}
              onClick={() => void request("preview")}
            >
              预览图标应用
            </button>
          </div>
          {!!beforeIcon && (
            <label className="watch-group-source-replace">
              <input
                type="checkbox"
                checked={replace}
                disabled={disabled}
                onChange={(e) => {
                  setReplace(e.target.checked);
                  setProof(null);
                }}
              />
              替换当前图标
            </label>
          )}
          {proof && (
            <>
              <dl>
                <dt>原分组</dt>
                <dd>{proof.originalGroupId}</dd>
                <dt>目标分组</dt>
                <dd>{proof.targetGroupId ?? "尚未映射"}</dd>
                <dt>原图摘要</dt>
                <dd>{proof.originalSha256 ?? "未知"}</dd>
                <dt>当前图标</dt>
                <dd>
                  {proof.beforeIcon === null
                    ? "未知"
                    : proof.beforeIcon
                      ? "已设置"
                      : "未设置"}
                </dd>
              </dl>
              {proof.blocker && (
                <p role="status">{sourceIconReason(proof.blocker)}</p>
              )}
              <button
                className="button primary"
                type="button"
                disabled={
                  disabled || !proof.ready || proof.replaceCurrent !== replace
                }
                onClick={() => {
                  if (proof.ready && proof.replaceCurrent === replace)
                    void onCommand(
                      "apply",
                      base +
                        "/operations/" +
                        proof.captureRequestId +
                        "/icon-operations",
                      {
                        preview: proof.preview,
                        expectedRevision: proof.groupRevision,
                        replaceCurrent: proof.replaceCurrent,
                      },
                    );
                }}
              >
                应用已核对原图
              </button>
            </>
          )}
          {icon?.kind === "apply" &&
            icon.state === "failed" &&
            icon.message && <p role="alert">{icon.message}</p>}
        </div>
      )}
    </details>
  );
}
export function SourceOriginalDetails({
  captured,
  showState = true,
}: {
  captured: SourceIconCapture;
  showState?: boolean;
}) {
  return (
    <div>
      {showState && <p role="status">{sourceIconLabel(captured)}</p>}
      {captured.reason && <p>{sourceIconReason(captured.reason)}</p>}
      <details>
        <summary>原图证据</summary>
        <dl>
          <dt>原分组</dt>
          <dd>{captured.originalGroupId}</dd>
          <dt>原引用</dt>
          <dd>
            {captured.sourceReferenceKnown === false
              ? "未知"
              : captured.sourceReference === ""
                ? "空"
                : (captured.sourceReference ?? "未知")}
          </dd>
          <dt>原图摘要</dt>
          <dd>{captured.originalSha256 ?? "未知"}</dd>
          <dt>原图字节</dt>
          <dd>{captured.originalSize ?? "未知"}</dd>
          <dt>显示安全校验</dt>
          <dd>尚未完成</dd>
        </dl>
      </details>
    </div>
  );
}
