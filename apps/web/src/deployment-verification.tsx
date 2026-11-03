import { useEffect, useRef, useState } from "react";
import { ApiError, type Session } from "./api";
import { ConnectionVerification } from "./connection-verification";

export function requiresDeploymentVerification(error: unknown) {
  return (
    error instanceof ApiError &&
    (error.code === "reauth_required" ||
      (error.status === 403 && error.message === "请重新登录后执行此操作"))
  );
}

type Action = () => void | Promise<void>;

export function useDeploymentVerification(
  session: Session,
  onDenied?: () => void,
) {
  const [required, setRequired] = useState(false);
  const continuation = useRef<Action | null>(null);
  useEffect(
    () => () => {
      continuation.current = null;
    },
    [],
  );
  function cancel() {
    continuation.current = null;
    setRequired(false);
  }
  return {
    required,
    request(action: Action) {
      continuation.current = action;
      setRequired(true);
    },
    dialog: required ? (
      <ConnectionVerification
        session={session}
        scope="deployment"
        onClose={cancel}
        onDenied={() => {
          cancel();
          onDenied?.();
        }}
        onVerified={() => {
          const action = continuation.current;
          continuation.current = null;
          setRequired(false);
          void action?.();
        }}
      />
    ) : null,
  };
}
