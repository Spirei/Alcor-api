import { requestResponse } from "./api-response.ts";
import { LoadingPlaceholder } from "./loading-placeholder";
import { useEffect, useRef, useState } from "react";
import { api, ApiError, type Session } from "./api";

type Observation = {
  id: string;
  provider: string;
  providerRevision: string | null;
  observationDate: string | null;
  observationInstant: string | null;
  sourcePrecision: string;
  receivedAt: string;
  rawSha256: string;
};
export function FxObservations({
  session,
  disabled,
  onSelect,
  onDenied,
}: {
  session: Session;
  disabled: boolean;
  onSelect: (id: string) => void;
  onDenied: (failure: unknown) => void;
}) {
  const [value, setValue] = useState<{
      items: Observation[];
      nextBefore: string | null;
    } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const epoch = useRef(0),
    controllers = useRef(new Set<AbortController>()),
    denied = useRef(onDenied);
  denied.current = onDenied;
  async function load(before?: string) {
    const run = epoch.current,
      controller = new AbortController();
    controllers.current.add(controller);
    setBusy(true);
    setError("");
    try {
      const result = await api<{
        items: Observation[];
        nextBefore: string | null;
      }>(
        "/reference/rates/observations?limit=20" +
          (before ? "&before=" + encodeURIComponent(before) : ""),
        { signal: controller.signal },
      );
      if (run === epoch.current && !document.hidden)
        setValue((previous) =>
          before && previous
            ? {
                ...result,
                items: [
                  ...previous.items,
                  ...result.items.filter(
                    (row) => !previous.items.some((item) => item.id === row.id),
                  ),
                ],
              }
            : result,
        );
    } catch (failure) {
      if (!controller.signal.aborted && run === epoch.current) {
        setError(
          failure instanceof Error ? failure.message : "汇率观察读取失败",
        );
        if (
          failure instanceof ApiError &&
          [401, 403].includes(failure.status)
        ) {
          setValue(null);
          denied.current(failure);
        }
      }
    } finally {
      controllers.current.delete(controller);
      if (run === epoch.current) setBusy(false);
    }
  }
  useEffect(() => {
    void load();
    return () => {
      epoch.current++;
      for (const controller of controllers.current) controller.abort();
      controllers.current.clear();
    };
  }, []);
  async function original(id: string) {
    if (document.hidden || busy) return;
    const run = epoch.current,
      controller = new AbortController();
    controllers.current.add(controller);
    setBusy(true);
    setError("");
    try {
      const response = await requestResponse(
        "/api/reference/rates/observations/" +
          encodeURIComponent(id) +
          "/original",
        {
          credentials: "same-origin",
          headers: { "X-CSRF-Token": session.csrf },
          signal: controller.signal,
        },
      );
      if (!response.ok)
        throw new ApiError(response.status, "汇率来源原件暂不可读取");
      const blob = await response.blob();
      if (run !== epoch.current || document.hidden) return;
      const url = URL.createObjectURL(blob),
        anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `fx-observation-${id}.bin`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (failure) {
      if (!controller.signal.aborted && run === epoch.current) {
        setError(
          failure instanceof Error ? failure.message : "汇率原件读取失败",
        );
        if (
          failure instanceof ApiError &&
          [401, 403].includes(failure.status)
        ) {
          setValue(null);
          denied.current(failure);
        }
      }
    } finally {
      controllers.current.delete(controller);
      if (run === epoch.current) setBusy(false);
    }
  }
  return (
    <>
      {error && <p role="alert">{error}</p>}
      {busy && <LoadingPlaceholder label="正在读取" compact />}
      {value && value.items.length > 0 && (
        <div className="fx-observation-list">
          {value.items.map((row) => (
            <article key={row.id} className="fx-observation-item">
              <header>
                <strong>{row.provider}</strong>
                <span>
                  {row.observationInstant ??
                    row.observationDate ??
                    "来源时间未知"}
                </span>
              </header>
              <dl>
                <div>
                  <dt>接收时间</dt>
                  <dd>{row.receivedAt}</dd>
                </div>
                <div>
                  <dt>时间精度</dt>
                  <dd>
                    {row.sourcePrecision === "date"
                      ? "日期"
                      : row.sourcePrecision === "unknown"
                        ? "未知"
                        : row.sourcePrecision}
                  </dd>
                </div>
              </dl>
              <div className="fx-observation-actions">
                <button
                  className="text-button"
                  disabled={busy || disabled}
                  onClick={() => onSelect(row.id)}
                >
                  查看汇率
                </button>
                {session.user.role === "admin" && (
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => void original(row.id)}
                  >
                    下载原件
                  </button>
                )}
              </div>
              <details>
                <summary>完整性依据</summary>
                <p>{row.rawSha256}</p>
                <p>{row.providerRevision ?? "版本未知"}</p>
              </details>
            </article>
          ))}
        </div>
      )}
      {value?.nextBefore && (
        <button disabled={busy} onClick={() => void load(value.nextBefore!)}>
          更早观察
        </button>
      )}
      {value && !value.items.length && (
        <p className="fx-observations-empty">暂无来源记录</p>
      )}
    </>
  );
}
