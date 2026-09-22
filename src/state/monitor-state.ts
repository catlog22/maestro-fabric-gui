import type { ActivityItem } from "../features/activity/ActivityPanel";
export type GapReason = "retention" | "slow-consumer" | "revoked" | "connection-closed" | "local-overflow";
export interface MonitorEvent { method: string; params: Readonly<Record<string, unknown>>; receivedAt: number; }
export interface MonitorState { cursor: number; degraded: boolean; gap?: GapReason; activity: readonly ActivityItem[]; }
export const initialMonitorState: MonitorState = { cursor: 0, degraded: false, activity: [] };
const SECRET = /bearer\s+\S+|token[=:]\s*\S+|proof[=:]\s*\S+/gi;
export function sanitizeActivity(value: unknown): string { const text = typeof value === "string" ? value : JSON.stringify(value ?? ""); return text.replace(SECRET,"[redacted]").slice(0,2048); }
export function reduceMonitor(state: MonitorState, events: readonly MonitorEvent[], dropped = 0): MonitorState {
  let cursor = state.cursor; let degraded = state.degraded || dropped > 0; let gap = dropped > 0 ? "local-overflow" as const : state.gap; const additions: ActivityItem[] = [];
  for (const event of events) {
    const next = Number(event.params.cursor); if (!Number.isSafeInteger(next) || next <= cursor) continue;
    cursor = next; const kind = String(event.params.kind ?? "state");
    if (kind === "gap") { const payload = event.params.payload as Record<string, unknown> | undefined; const reason = payload?.reason; gap = (["retention","slow-consumer","revoked","connection-closed"].includes(String(reason)) ? reason : "retention") as GapReason; degraded = true; }
    additions.push({ id:String(event.params.eventId ?? `${next}`), time:event.receivedAt, level:kind === "error" || kind === "gap" ? "error" : "info", subject:kind, detail:sanitizeActivity(event.params.payload) });
  }
  return { cursor, degraded, ...(gap ? { gap } : {}), activity:[...additions.reverse(),...state.activity].slice(0,200) };
}
export function markResynchronized(state: MonitorState): MonitorState { return { ...state, degraded:false, gap:undefined }; }
