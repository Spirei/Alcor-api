import { useEffect, useState } from "react";
import { api } from "./api";
import { Dialog } from "./dialog";
import {
  accountActionHistory,
  accountOutcome,
  type AccountActionHistory,
} from "./account-action-state";

export function AccountActionRecords({
  disabled,
  onSelect,
}: {
  disabled: boolean;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [after, setAfter] = useState<string | null>(null),
    [previous, setPrevious] = useState<(string | null)[]>([]);
  const [data, setData] = useState<AccountActionHistory | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open || document.hidden) return;
    const controller = new AbortController();
    let current = true;
    setBusy(true);
    setError("");
    setData(null);
    void api<unknown>(
      "/users/receipts?limit=20" +
        (after ? "&after=" + encodeURIComponent(after) : ""),
      { signal: controller.signal },
    )
      .then((raw) => {
        if (current && !document.hidden) setData(accountActionHistory(raw));
      })
      .catch((reason) => {
        if (current && !controller.signal.aborted) {
          setData(null);
          setError(
            reason instanceof Error ? reason.message : "账号操作记录读取失败",
          );
        }
      })
      .finally(() => {
        if (current) setBusy(false);
      });
    const hide = () => {
      if (document.hidden) {
        current = false;
        controller.abort();
        setData(null);
        setOpen(false);
      }
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      current = false;
      controller.abort();
      document.removeEventListener("visibilitychange", hide);
    };
  }, [open, after]);
  return (
    <>
      <button
        className="text-button"
        disabled={disabled}
        onClick={() => {
          setAfter(null);
          setPrevious([]);
          setOpen(true);
        }}
      >
        操作记录
      </button>
      {open && (
        <Dialog title="操作记录" onClose={() => setOpen(false)}>
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
          {busy && <p role="status">读取中…</p>}
          {data && (
            <>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>时间</th>
                      <th>结果</th>
                      <th>编号</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((item) => (
                      <tr key={item.request_id}>
                        <td>
                          {new Date(item.created_at).toLocaleString("zh-CN")}
                        </td>
                        <td>{accountOutcome(item.result, item.request_id)}</td>
                        <td>{item.request_id}</td>
                        <td>
                          <button
                            className="text-button"
                            disabled={disabled}
                            onClick={() => {
                              setOpen(false);
                              onSelect(item.request_id);
                            }}
                          >
                            核对原请求
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!data.items.length && <p>暂无操作记录</p>}
              <div className="pagination">
                <button
                  className="text-button"
                  disabled={!previous.length || busy}
                  onClick={() => {
                    setAfter(previous.at(-1) ?? null);
                    setPrevious(previous.slice(0, -1));
                  }}
                >
                  上一页
                </button>
                <button
                  className="text-button"
                  disabled={!data.next_after || busy}
                  onClick={() => {
                    setPrevious([...previous, after]);
                    setAfter(data.next_after);
                  }}
                >
                  下一页
                </button>
              </div>
            </>
          )}
        </Dialog>
      )}
    </>
  );
}
