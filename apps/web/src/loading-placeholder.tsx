import "./loading-placeholder.css";
/** Quiet first-read feedback. Existing data and actual errors remain the caller's responsibility. */
export function LoadingPlaceholder({
  label = "正在读取",
  compact = false,
}: {
  label?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={`loading-placeholder${compact ? " is-compact" : ""}`}
      role="status"
      aria-label={label}
      aria-busy="true"
    >
      <span aria-hidden="true" />
      <span aria-hidden="true" />
      <span aria-hidden="true" />
    </div>
  );
}
