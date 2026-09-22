export const BRIDGE_PROTOCOL_VERSION = 1 as const;
export const BRIDGE_ACTIONS = [
  "handshake",
  "cancel",
  "gateway.control",
  "gateway.connect",
  "gateway.disconnect",
  "gateway.call",
  "gateway.events",
  "gateway.profiles",
] as const;
export type BridgeAction = (typeof BRIDGE_ACTIONS)[number];

export interface BridgeRequest {
  id: string;
  action: BridgeAction;
  deadlineAt: number;
  payload?: Readonly<Record<string, unknown>>;
}
export interface BridgeError { code: string; message: string; retryable: boolean; }
export interface BridgeResponse { id: string; ok: boolean; result?: unknown; error?: BridgeError; }

export function parseRequest(value: unknown, now = Date.now()): BridgeRequest {
  if (!value || typeof value !== "object") throw bridgeError("invalid_request", "Bridge request must be an object");
  const item = value as Record<string, unknown>;
  if (typeof item.id !== "string" || item.id.length < 1 || item.id.length > 128) throw bridgeError("invalid_request", "Request id is invalid");
  if (typeof item.action !== "string" || !(BRIDGE_ACTIONS as readonly string[]).includes(item.action)) throw bridgeError("unsupported_action", "Bridge action is not allowed");
  if (typeof item.deadlineAt !== "number" || !Number.isSafeInteger(item.deadlineAt)) throw bridgeError("invalid_request", "Request deadline is invalid");
  if (item.deadlineAt <= now) throw bridgeError("deadline_exceeded", "Request deadline has expired", true);
  if (item.payload !== undefined && (!item.payload || typeof item.payload !== "object" || Array.isArray(item.payload))) throw bridgeError("invalid_request", "Request payload is invalid");
  return { id: item.id, action: item.action as BridgeAction, deadlineAt: item.deadlineAt, ...(item.payload === undefined ? {} : { payload: item.payload as Record<string, unknown> }) };
}

export function bridgeError(code: string, message: string, retryable = false): Error & BridgeError {
  return Object.assign(new Error(message), { code, retryable });
}
export function sanitizeError(error: unknown): BridgeError {
  const value = error as Partial<BridgeError> | undefined;
  const code = typeof value?.code === "string" && /^[a-z0-9_]+$/.test(value.code) ? value.code : "bridge_error";
  const raw = error instanceof Error ? error.message : "Bridge request failed";
  return { code, message: raw.replace(/Bearer\s+\S+|token[=:]\s*\S+/gi, "[redacted]"), retryable: value?.retryable === true };
}
