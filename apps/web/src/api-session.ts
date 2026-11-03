// Memory only: bind reads and late responses to the session displayed by this tab.
let csrf: string | null = null;
let epoch = 0;
export function bindApiSession(value: string | null) {
  if (csrf !== value) {
    csrf = value;
    epoch++;
  }
}
export function apiSessionSnapshot() {
  return { csrf, epoch };
}
export function isCurrentApiSession(
  snapshot: ReturnType<typeof apiSessionSnapshot>,
) {
  return snapshot.epoch === epoch;
}
