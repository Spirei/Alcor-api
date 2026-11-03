import { estimateStrength } from "./password-strength-estimator";

const scope = self as unknown as {
  onmessage: (
    event: MessageEvent<{ id: number; password: string; username: string }>,
  ) => void;
  postMessage: (result: {
    id: number;
    score?: number;
    failed?: boolean;
  }) => void;
};
scope.onmessage = ({ data }) => {
  if (
    !Number.isSafeInteger(data.id) ||
    typeof data.password !== "string" ||
    typeof data.username !== "string"
  )
    return;
  try {
    scope.postMessage({
      id: data.id,
      score: estimateStrength(data.password, data.username),
    });
  } catch {
    scope.postMessage({ id: data.id, failed: true });
  }
};
