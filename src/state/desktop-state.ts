import type { DesktopState } from "../models/desktop";

export const initialDesktopState: DesktopState = { revision: 0, readiness: "starting" };

export function acceptNewerState(current: DesktopState, next: DesktopState): DesktopState {
  return next.revision >= current.revision ? next : current;
}
