import { useEffect, useRef, useState } from "react";
import type { InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";

export function PasswordField(
  props: InputHTMLAttributes<HTMLInputElement> & { id: string; value: string },
) {
  const [shown, setShown] = useState(false);
  const confirmation = props.id === "confirm-password";
  const label =
    (shown ? "隐藏" : "显示") + (confirmation ? "确认密码" : "密码");
  useEffect(() => {
    if (!props.value) setShown(false);
  }, [props.value]);
  useEffect(() => {
    const conceal = () => {
      if (document.hidden) setShown(false);
    };
    document.addEventListener("visibilitychange", conceal);
    return () => document.removeEventListener("visibilitychange", conceal);
  }, []);
  return (
    <div className="password-field">
      <input {...props} type={shown ? "text" : "password"} />
      <button
        type="button"
        aria-label={label}
        aria-controls={props.id}
        aria-pressed={shown}
        onPointerDown={(e) => e.preventDefault()}
        onClick={() => setShown((value) => !value)}
      >
        {shown ? (
          <EyeOff size={19} strokeWidth={1.7} />
        ) : (
          <Eye size={19} strokeWidth={1.7} />
        )}
      </button>
    </div>
  );
}

const labels = ["弱", "中等", "强"];
export function PasswordStrength({
  password,
  username,
}: {
  password: string;
  username: string;
}) {
  const worker = useRef<Worker | null>(null),
    sequence = useRef(0);
  const [visibility, setVisibility] = useState(0);
  const [result, setResult] = useState<{
    password: string;
    username: string;
    score: number | null;
    failed: boolean;
  } | null>(null);
  const current =
    result?.password === password && result.username === username
      ? result
      : null;
  const score = current?.score ?? null;
  useEffect(() => {
    const change = () => {
      if (document.hidden) {
        worker.current?.terminate();
        worker.current = null;
      }
      setResult(null);
      setVisibility((value) => value + 1);
    };
    document.addEventListener("visibilitychange", change);
    return () => {
      document.removeEventListener("visibilitychange", change);
      worker.current?.terminate();
      worker.current = null;
    };
  }, []);
  useEffect(() => {
    if (!password || document.hidden) return;
    const id = ++sequence.current;
    let active = true;
    let thread: Worker | null = null;
    const fail = () => {
      if (active) setResult({ password, username, score: null, failed: true });
      thread?.terminate();
      if (worker.current === thread) worker.current = null;
    };
    const receive = ({
      data,
    }: MessageEvent<{ id: number; score?: number; failed?: boolean }>) => {
      if (!active || data.id !== id) return;
      const valid =
        Number.isInteger(data.score) && data.score! >= 0 && data.score! <= 4;
      setResult({
        password,
        username,
        score: valid ? data.score! : null,
        failed: !valid,
      });
    };
    const timer = setTimeout(() => {
      try {
        worker.current ??= new Worker(
          new URL("./password-strength.worker.ts", import.meta.url),
          { type: "module" },
        );
        thread = worker.current;
        thread.addEventListener("message", receive);
        thread.addEventListener("error", fail);
        thread.postMessage({ id, password, username });
      } catch {
        fail();
      }
    }, 120);
    return () => {
      active = false;
      clearTimeout(timer);
      thread?.removeEventListener("message", receive);
      thread?.removeEventListener("error", fail);
    };
  }, [password, username, visibility]);
  if (!password) return null;
  const level = score === null ? null : score <= 1 ? 0 : score === 2 ? 1 : 2;
  const label =
    level === null ? (current?.failed ? "不可用" : "") : labels[level];
  const filled = level === null ? 0 : level + 1;
  return (
    <div className="password-strength" data-level={level ?? "pending"}>
      <div
        className="password-strength-track"
        role={level === null ? undefined : "meter"}
        aria-label="密码强度"
        aria-valuemin={0}
        aria-valuemax={2}
        aria-valuenow={level ?? undefined}
        aria-valuetext={label}
      >
        {Array.from({ length: 3 }, (_, i) => (
          <i key={i} data-filled={i < filled} />
        ))}
      </div>
      <span className="password-strength-label" aria-live="polite">
        {label}
      </span>
    </div>
  );
}
