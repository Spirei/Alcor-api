export type RecoveryStage =
  "request" | "verify" | "confirm" | "done" | "unknown";

export function interruptedRecovery(
  stage: RecoveryStage,
  pending: boolean,
): RecoveryStage {
  if (stage === "done" || stage === "unknown") return stage;
  return stage === "confirm" && pending ? "unknown" : "request";
}

export function observeRecoveryPrivacy(
  page: Pick<Document, "hidden" | "addEventListener" | "removeEventListener">,
  session: Pick<Window, "addEventListener" | "removeEventListener">,
  clear: () => void,
): () => void {
  const hidden = () => {
    if (page.hidden) clear();
  };
  page.addEventListener("visibilitychange", hidden);
  session.addEventListener("alcor:session-expired", clear);
  return () => {
    page.removeEventListener("visibilitychange", hidden);
    session.removeEventListener("alcor:session-expired", clear);
  };
}
