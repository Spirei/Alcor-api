export type PasswordChangePhase = "idle" | "sending" | "unknown" | "done";
export function passwordChangeGate() {
  let phase: PasswordChangePhase = "idle",
    sequence = 0;
  return {
    phase: () => phase,
    begin() {
      if (phase !== "idle") return null;
      phase = "sending";
      return ++sequence;
    },
    settle(
      ticket: number,
      success: boolean,
      failure?: { status: number; code?: string },
    ) {
      if (ticket !== sequence || phase !== "sending") return false;
      const rejected =
        failure &&
        [400, 401, 403, 404, 409, 413, 422, 429].includes(failure.status) &&
        failure.code !== "session_changed";
      phase = success ? "done" : rejected ? "idle" : "unknown";
      return true;
    },
    interrupt() {
      if (phase === "sending") {
        ++sequence;
        phase = "unknown";
      }
    },
  };
}
