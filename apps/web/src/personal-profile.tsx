import { useEffect, useRef, useState } from "react";
import { api, ApiError, type Session } from "./api";
import { SelectMenu } from "./select-menu";
import { requestId } from "./request-id";
import { restorePersonalProfileRequest } from "./personal-profile-state";

type Personal = {
  userId: string;
  revision: number;
  bio: string;
  gender: string;
  background: { path: string; sha256: string } | null;
};
type Receipt = {
  requestId: string;
  userId: string;
  state: "completed" | "failed";
  kind: "update_profile" | "upload_background";
  message: string;
  data: Personal | null;
};
const path = "/account/personal-profile";

export function PersonalProfile({
  session,
  onValue,
}: {
  session: Session;
  onValue?: (value: Personal | null) => void;
}) {
  const key = `alcor.personal-profile.${JSON.stringify([session.instance_id, session.user.id, session.user.role, session.receipt_scope])}`;
  const [value, setValue] = useState<Personal | null>(null);
  const baseline = useRef<Personal | null>(null);
  const [conflict, setConflict] = useState<Personal | null>(null);
  const [bio, setBio] = useState("");
  const [gender, setGender] = useState("unspecified");
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [journalReady, setJournalReady] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const alive = useRef(false),
    epoch = useRef(0),
    latestRead = useRef(0),
    dirty = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (value) onValue?.(value);
  }, [value, onValue]);

  function accept(next: Personal, replaceDraft = false) {
    if (next.userId !== session.user.id || !Number.isSafeInteger(next.revision))
      throw new Error("资料身份或版本无效");
    const prior = baseline.current;
    if (
      !replaceDraft &&
      dirty.current &&
      prior &&
      next.revision !== prior.revision &&
      (next.bio !== prior.bio || next.gender !== prior.gender)
    ) {
      setConflict(next);
      setError("资料已在其他设备修改，当前草稿已保留");
      return false;
    }
    baseline.current = next;
    setConflict(null);
    setValue(next);
    if (replaceDraft || !dirty.current) {
      setBio(next.bio);
      setGender(next.gender);
      dirty.current = false;
    }
    return true;
  }
  async function read() {
    if (!alive.current || document.hidden) return;
    const current = epoch.current;
    const readId = ++latestRead.current;
    try {
      const next = await api<Personal>(path);
      if (
        alive.current &&
        current === epoch.current &&
        readId === latestRead.current
      )
        if (accept(next)) setError("");
    } catch (reason) {
      if (
        alive.current &&
        current === epoch.current &&
        (readId === latestRead.current ||
          (reason instanceof ApiError && [401, 403].includes(reason.status)))
      )
        fail(reason);
    }
  }
  function fail(reason: unknown) {
    if (reason instanceof ApiError && [401, 403].includes(reason.status)) {
      epoch.current++;
      latestRead.current++;
      dirty.current = false;
      baseline.current = null;
      setConflict(null);
      setBusy(false);
      setSaved("");
      setValue(null);
      setBio("");
      setGender("unspecified");
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      sessionStorage.removeItem(key);
      sessionStorage.removeItem(key + ".replace");
      setPending(null);
    }
    setError(reason instanceof Error ? reason.message : "保存失败");
  }
  useEffect(() => {
    alive.current = true;
    setBusy(false);
    try {
      const original = restorePersonalProfileRequest(sessionStorage, key);
      setJournalReady(true);
      if (original) setPending(original);
    } catch {
      setJournalReady(false);
      setError("无法恢复操作编号，请检查浏览器存储权限");
    }
    void read();
    const visibility = () => {
      if (document.hidden) {
        epoch.current++;
        latestRead.current++;
        setFile(null);
        setBusy(false);
        if (fileInput.current) fileInput.current.value = "";
      } else void read();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      alive.current = false;
      epoch.current++;
      latestRead.current++;
      document.removeEventListener("visibilitychange", visibility);
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
    };
  }, [key]);

  async function query(original: string) {
    if (!alive.current || document.hidden) return;
    const current = epoch.current;
    setBusy(true);
    try {
      const receipt = await api<Receipt>(`${path}/operations/${original}`);
      if (!alive.current || current !== epoch.current) return;
      if (receipt.userId !== session.user.id || receipt.requestId !== original)
        throw new Error("回执身份或编号无效");
      if (!["completed", "failed"].includes(receipt.state))
        throw new Error("操作结果待核对");
      const replaceDraft = sessionStorage.getItem(key + ".replace") === "true";
      let accepted = true;
      if (receipt.state === "completed") {
        if (!receipt.data) throw new Error("回执缺少资料版本");
        latestRead.current++;
        const fresh = await api<Personal>(path);
        if (!alive.current || current !== epoch.current) return;
        accepted = accept(
          fresh,
          replaceDraft && fresh.revision === receipt.data.revision,
        );
      }
      sessionStorage.removeItem(key);
      sessionStorage.removeItem(key + ".replace");
      setPending(null);
      if (receipt.state === "failed") throw new Error(receipt.message);
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      setSaved(
        !accepted
          ? "原请求已完成"
          : receipt.kind === "upload_background"
            ? "背景已上传"
            : replaceDraft
              ? "资料已保存"
              : "背景已移除",
      );
      if (accepted) setError("");
    } catch (reason) {
      if (alive.current && current === epoch.current) fail(reason);
    } finally {
      if (alive.current && current === epoch.current) setBusy(false);
    }
  }
  async function save(background: boolean, remove = false) {
    if (
      !alive.current ||
      document.hidden ||
      !value ||
      !journalReady ||
      busy ||
      pending ||
      conflict
    )
      return;
    if (
      background &&
      !remove &&
      (!file || file.type !== "image/jpeg" || file.size > 8 * 1024 * 1024)
    ) {
      setError("请选择不超过 8 MB 的 JPEG 图片");
      return;
    }
    const original = requestId(),
      current = epoch.current;
    try {
      sessionStorage.setItem(key, original);
      sessionStorage.setItem(key + ".replace", String(!background && !remove));
    } catch {
      setError("无法保存操作编号，请检查浏览器存储权限");
      return;
    }
    setPending(original);
    setBusy(true);
    setSaved("");
    setError("");
    try {
      let body: BodyInit,
        method: string,
        endpoint = path;
      if (background && !remove) {
        if (!file) throw new Error("请选择 JPEG 图片");
        if (file.type !== "image/jpeg" || file.size > 8 * 1024 * 1024)
          throw new Error("请选择不超过 8 MB 的 JPEG 图片");
        const form = new FormData();
        form.set("requestId", original);
        form.set("revision", String(value.revision));
        form.set("file", file);
        body = form;
        method = "POST";
        endpoint += "/background";
      } else {
        body = JSON.stringify({
          requestId: original,
          revision: value.revision,
          changes: remove ? { background: null } : { bio, gender },
        });
        method = "PATCH";
      }
      await api<Receipt>(endpoint, { method, body }, session.csrf);
      if (alive.current && current === epoch.current) await query(original);
    } catch (reason) {
      if (!alive.current || current !== epoch.current) return;
      if (
        reason instanceof ApiError &&
        reason.status >= 400 &&
        reason.status < 500 &&
        ![408, 409].includes(reason.status)
      ) {
        // A definite rejection cannot have committed this operation.
        sessionStorage.removeItem(key);
        sessionStorage.removeItem(key + ".replace");
        setPending(null);
      }
      fail(reason);
    } finally {
      if (alive.current && current === epoch.current) setBusy(false);
    }
  }
  return (
    <section className="personal-profile">
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {conflict && (
        <div className="reference-actions">
          <button
            className="button secondary"
            onClick={() => {
              accept(conflict, true);
              setError("");
            }}
          >
            使用远端资料
          </button>
          <button
            className="button secondary"
            onClick={() => {
              baseline.current = conflict;
              setValue(conflict);
              setConflict(null);
              setError("");
            }}
          >
            保留草稿并采用新版本
          </button>
        </div>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save(false);
        }}
      >
        <label>
          简介
          <textarea
            value={bio}
            disabled={
              !value || !journalReady || busy || !!pending || !!conflict
            }
            onChange={(event) => {
              dirty.current = true;
              setSaved("");
              setBio(event.target.value);
            }}
          />
        </label>
        <div className="personal-profile-field">
          <span>性别</span>
          <SelectMenu
            label="性别"
            value={gender}
            variant="field"
            disabled={
              !value || !journalReady || busy || !!pending || !!conflict
            }
            onChange={(next) => {
              dirty.current = true;
              setSaved("");
              setGender(next);
            }}
            options={[
              { value: "unspecified", label: "未设置" },
              { value: "male", label: "男" },
              { value: "female", label: "女" },
            ]}
          />
        </div>
        <button
          className="button"
          disabled={!value || !journalReady || busy || !!pending || !!conflict}
        >
          保存资料
        </button>
      </form>
      {value?.background && (
        <img
          className="profile-background"
          key={value.background.sha256}
          src={value.background.path}
          alt="个人背景"
        />
      )}
      <label>
        背景图片
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg"
          disabled={!value || !journalReady || busy || !!pending || !!conflict}
          onChange={(event) => setFile(event.target.files?.[0] || null)}
        />
      </label>
      <div className="reference-actions">
        <button
          className="button secondary"
          disabled={!file || !journalReady || busy || !!pending || !!conflict}
          onClick={() => void save(true)}
        >
          上传背景
        </button>
        {value?.background && (
          <button
            className="button secondary"
            disabled={!journalReady || busy || !!pending || !!conflict}
            onClick={() => void save(false, true)}
          >
            移除背景
          </button>
        )}
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => void read()}
        >
          重新读取
        </button>
        {pending && (
          <button
            className="button"
            disabled={busy}
            onClick={() => void query(pending)}
          >
            查询原请求
          </button>
        )}
        {saved && <span role="status">{saved}</span>}
      </div>
    </section>
  );
}
