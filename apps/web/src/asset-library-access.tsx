import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { api, ApiError, type Session } from "./api";
import { apiSessionSnapshot } from "./api-session";
import { requestId } from "./request-id";
type Access = { revision: number; registered: boolean; guest: boolean };
type Operation = {
  requestId: string;
  expectedRevision: number;
  registered: boolean;
  guest: boolean;
};
const valid = (v: unknown): v is Access =>
  !!v &&
  typeof v === "object" &&
  Number.isSafeInteger((v as Access).revision) &&
  (v as Access).revision >= 0 &&
  typeof (v as Access).registered === "boolean" &&
  typeof (v as Access).guest === "boolean" &&
  (!(v as Access).guest || (v as Access).registered);
export function MaterialAccessSettings({
  session,
  active,
  onBlocked,
}: {
  session: Session;
  active: boolean;
  onBlocked: (value: boolean) => void;
}) {
  const [value, setValue] = useState<Access | null>(null),
    [draft, setDraft] = useState({ registered: true, guest: true }),
    [job, setJob] = useState<Operation | null>(null),
    [busy, setBusy] = useState(false),
    [locked, setLocked] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [refresh, setRefresh] = useState(0);
  const abort = useRef<AbortController | null>(null),
    live = useRef(active),
    epoch = useRef(0);
  const storage =
    "alcor.material-access:" +
    JSON.stringify([
      session.instance_id,
      session.user.id,
      session.receipt_scope,
    ]);
  useEffect(() => {
    live.current = active;
    ++epoch.current;
    return () => {
      live.current = false;
      ++epoch.current;
      abort.current?.abort();
    };
  }, [active]);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(storage);
      if (raw) {
        const saved = JSON.parse(raw) as Operation;
        if (
          !valid({ ...saved, revision: saved.expectedRevision }) ||
          !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(saved.requestId)
        )
          throw Error("权限操作记录无法读取");
        setJob(saved);
        setDraft({ registered: saved.registered, guest: saved.guest });
      }
    } catch (e) {
      setLocked(true);
      setError(e instanceof Error ? e.message : "权限操作记录无法读取");
    }
  }, [storage]);
  useEffect(() => {
    onBlocked(busy || !!job || locked);
    return () => onBlocked(false);
  }, [busy, job, locked, onBlocked]);
  useEffect(() => {
    if (!active || job) return;
    const controller = new AbortController();
    void api<unknown>("/admin/asset-library/access", {
      signal: controller.signal,
    })
      .then((raw) => {
        if (controller.signal.aborted) return;
        if (!valid(raw)) throw Error("素材权限响应无效");
        setValue(raw);
        setDraft({ registered: raw.registered, guest: raw.guest });
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "权限读取失败");
      });
    return () => controller.abort();
  }, [active, session.csrf, refresh, job]);
  async function save(check = false) {
    if (
      !live.current ||
      apiSessionSnapshot().csrf !== session.csrf ||
      busy ||
      locked ||
      (!job && !value)
    )
      return;
    const expected = job || {
      requestId: requestId(),
      expectedRevision: value!.revision,
      registered: draft.registered,
      guest: draft.guest,
    };
    try {
      sessionStorage.setItem(storage, JSON.stringify(expected));
    } catch {
      setError("无法保存权限操作记录");
      return;
    }
    setJob(expected);
    setBusy(true);
    setError("");
    setNotice("");
    const controller = new AbortController(),
      sequence = epoch.current;
    abort.current = controller;
    const current = () =>
      live.current &&
      sequence === epoch.current &&
      apiSessionSnapshot().csrf === session.csrf;
    function finish(raw: unknown) {
      const v = raw as Access & { requestId?: string };
      if (
        !valid(v) ||
        v.requestId !== expected.requestId ||
        v.revision !== expected.expectedRevision + 1 ||
        v.registered !== expected.registered ||
        v.guest !== expected.guest
      )
        throw Error("权限保存结果待核对");
      sessionStorage.removeItem(storage);
      setJob(null);
      setValue(v);
      setDraft({ registered: v.registered, guest: v.guest });
      setNotice("权限已保存");
    }
    try {
      const result = await api<unknown>(
        "/admin/asset-library/access" +
          (check ? "/operations/" + expected.requestId : ""),
        {
          method: check ? "GET" : "POST",
          signal: controller.signal,
          ...(!check ? { body: JSON.stringify(expected) } : {}),
        },
        session.csrf,
      );
      if (current()) finish(result);
    } catch (e) {
      if (current()) {
        setError(e instanceof Error ? e.message : "权限结果待核对");
        if (e instanceof ApiError && [401, 403].includes(e.status))
          setLocked(true);
        if (
          !check &&
          e instanceof ApiError &&
          [400, 409, 422].includes(e.status)
        )
          try {
            const result = await api<unknown>(
              "/admin/asset-library/access/operations/" + expected.requestId,
              { signal: controller.signal },
            );
            if (current()) finish(result);
          } catch (lookup) {
            if (
              current() &&
              lookup instanceof ApiError &&
              lookup.status === 404
            ) {
              sessionStorage.removeItem(storage);
              setJob(null);
              setRefresh((v) => v + 1);
            }
          }
      }
    } finally {
      if (current()) setBusy(false);
    }
  }
  const disabled = busy || !!job || locked || !value;
  return (
    <section className="asset-access-settings" aria-label="权限开放">
      <div className="asset-access-table">
        <div className="asset-access-row heading">
          <span>身份</span>
          <span>公共素材浏览</span>
          <span>修改与管理</span>
        </div>
        <div className="asset-access-row">
          <strong>管理员</strong>
          <span>
            <Check size={17} />
            全部开放
          </span>
          <span>
            <Check size={17} />
            全部权限
          </span>
        </div>
        {(["registered", "guest"] as const).map((key) => (
          <div className="asset-access-row" key={key}>
            <strong>{key === "registered" ? "注册用户" : "游客"}</strong>
            <button
              type="button"
              role="switch"
              className="asset-access-switch"
              aria-label={
                key === "registered"
                  ? "允许注册用户浏览素材"
                  : "允许游客浏览素材"
              }
              aria-checked={draft[key]}
              disabled={disabled || (key === "guest" && !draft.registered)}
              onClick={() =>
                setDraft((v) =>
                  key === "registered"
                    ? {
                        registered: !v.registered,
                        guest: v.registered ? false : v.guest,
                      }
                    : { ...v, guest: !v.guest },
                )
              }
            >
              <span />
            </button>
            <span className="muted">仅管理员</span>
          </div>
        ))}
      </div>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <div className="asset-access-actions">
        <button
          type="button"
          className="button"
          disabled={
            busy ||
            locked ||
            (!job &&
              (!value ||
                (value.registered === draft.registered &&
                  value.guest === draft.guest)))
          }
          onClick={() => void save(!!job)}
        >
          {busy ? "处理中…" : job ? "核对原权限操作" : "保存权限"}
        </button>
      </div>
    </section>
  );
}
