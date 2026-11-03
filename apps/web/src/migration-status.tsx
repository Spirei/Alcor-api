import {
  Check,
  CheckCheck,
  Clock3,
  Minus,
  RefreshCw,
  Search,
} from "lucide-react";
import { migrationState } from "./migration-view";

const icons = {
  local_verified: Check,
  accepted: CheckCheck,
  in_progress: RefreshCw,
  pending: Clock3,
  pending_validation: Clock3,
  partial_pending_validation: RefreshCw,
  retired: Minus,
  review: Search,
};

export function MigrationStatus({
  status,
  label,
  domain = false,
}: {
  status: string;
  label?: string;
  domain?: boolean;
}) {
  const tone = Object.hasOwn(icons, status)
    ? (status as keyof typeof icons)
    : "review";
  const Icon = icons[tone];
  return (
    <span className="migration-status" data-state={tone}>
      <span className="migration-status-icon" aria-hidden="true">
        <Icon
          size={12}
          stroke="#FFFFFF"
          strokeWidth={tone === "local_verified" ? 3.2 : 2.5}
        />
      </span>
      <span>{label || migrationState(status, domain)}</span>
    </span>
  );
}
