import { createContext, useContext } from "react";
import type { AppearanceController } from "./use-appearance";
import type { AvatarStatus } from "./preference-draft";

export const AccountPreferenceContext = createContext<{
  appearance: AppearanceController;
  ready: boolean;
  status: AvatarStatus;
  select: (value: AvatarStatus) => void;
} | null>(null);

export function useAccountStatus() {
  return useContext(AccountPreferenceContext);
}
export function useAccountAppearance() {
  const context = useContext(AccountPreferenceContext);
  return context ? { ready: context.ready, ...context.appearance } : null;
}
