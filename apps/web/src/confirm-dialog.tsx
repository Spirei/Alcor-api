import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog } from "./dialog";
import { FormActions } from "./workspace-forms";
import {
  ConfirmationState,
  type ConfirmationFrame,
  type ConfirmationOptions,
} from "./confirmation-state";

/** Scoped app dialogs cancel stale work and do not block browser input. */
export function useConfirmationDialog(scope: string) {
  const state = useRef(new ConfirmationState());
  const [confirmation, setConfirmation] = useState<ConfirmationFrame | null>(
    null,
  );
  const finish = useCallback((frame: ConfirmationFrame, accepted: boolean) => {
    if (state.current.settle(frame, accepted))
      setConfirmation((current) => (current === frame ? null : current));
  }, []);
  useEffect(() => {
    const cancel = () => {
      state.current.cancel();
      setConfirmation(null);
    };
    cancel();
    const hidden = () => {
      if (document.hidden) cancel();
    };
    document.addEventListener("visibilitychange", hidden);
    const current = state.current;
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      current.cancel();
    };
  }, [scope]);
  const ask = useCallback(
    (message: string, options: ConfirmationOptions = {}) => {
      if (document.hidden) {
        state.current.cancel();
        setConfirmation(null);
        return Promise.resolve(false);
      }
      const next = state.current.begin(message, options);
      setConfirmation(next.frame);
      return next.promise;
    },
    [],
  );
  return {
    ask,
    dialog: confirmation ? (
      <Dialog
        title={confirmation.title || "确认操作"}
        className="confirmation-dialog"
        onClose={() => finish(confirmation, false)}
      >
        <p>{confirmation.message}</p>
        <FormActions>
          <button
            className="button secondary"
            data-dialog-autofocus
            onClick={() => finish(confirmation, false)}
          >
            取消
          </button>
          <button
            className="button secondary"
            onClick={() => finish(confirmation, true)}
          >
            {confirmation.confirmLabel || "继续"}
          </button>
        </FormActions>
      </Dialog>
    ) : null,
  };
}
