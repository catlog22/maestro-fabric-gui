import { spawn } from "node:child_process";
import { bridgeError } from "./protocol.js";

export type GatewayCliRunner = (args: readonly string[], input?: string, signal?: AbortSignal) => Promise<unknown>;

function executable(): string {
  return process.env.PI_MAESTRO_GATEWAY_BIN?.trim() || "pi-maestro-gateway";
}

export const runGatewayCli: GatewayCliRunner = (args, input, signal) => new Promise((resolve, reject) => {
  const child = spawn(executable(), [...args], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"], signal });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; if (stdout.length > 4 * 1024 * 1024) child.kill(); });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; if (stderr.length > 64 * 1024) child.kill(); });
  child.once("error", (error) => reject(bridgeError("gateway_unavailable", error.message, true)));
  child.once("close", (code) => {
    if (code !== 0) return reject(bridgeError("gateway_control_failed", stderr.trim() || `Gateway exited with code ${code}`, true));
    try { resolve(stdout.trim() ? JSON.parse(stdout) : null); }
    catch { reject(bridgeError("invalid_gateway_response", "Gateway returned invalid JSON")); }
  });
  child.stdin.end(input);
});

function text(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 4096) throw bridgeError("invalid_request", `${name} is invalid`);
  return value;
}
function positive(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw bridgeError("invalid_request", `${name} is invalid`);
  return Number(value);
}

export async function gatewayControl(action: string, payload: Readonly<Record<string, unknown>>, signal?: AbortSignal, run: GatewayCliRunner = runGatewayCli): Promise<unknown> {
  if (["status", "start", "stop", "restart"].includes(action)) return run(["service", action, "--json"], undefined, signal);
  if (["pair.create", "pair.bootstrap", "pair.list"].includes(action)) {
    const op = action.split(".")[1]!; const args = ["pair", op, "--json"];
    if (payload.ttlSeconds !== undefined) args.push("--ttl", String(positive(payload.ttlSeconds, "ttlSeconds")));
    if (payload.label !== undefined) args.push("--label", text(payload.label, "label"));
    return run(args, undefined, signal);
  }
  if (action === "pair.revoke") return run(["pair", "revoke", text(payload.id, "id"), "--json"], undefined, signal);
  if (["connector.status", "connector.start", "connector.stop"].includes(action)) return run(["connector", action.split(".")[1]!, "--json"], undefined, signal);
  if (action === "connector.revoke") return run(["connector", "revoke", text(payload.connectorId, "connectorId"), "--expected-revision", String(positive(payload.expectedRevision, "expectedRevision")), "--request-id", text(payload.requestId, "requestId"), "--json"], undefined, signal);
  if (action === "connector.enroll") {
    const args = ["connector", "enroll", "--hub", text(payload.hub, "hub"), "--connector-id", text(payload.connectorId, "connectorId"), "--device-id", text(payload.deviceId, "deviceId"), "--token-stdin", "--json"];
    return run(args, `${text(payload.token, "token")}\n`, signal);
  }
  if (action === "connector.rotate") return run(["connector", "rotate", "--expected-revision", String(positive(payload.expectedRevision, "expectedRevision")), "--expected-generation", String(positive(payload.expectedGeneration, "expectedGeneration")), "--token-stdin", "--json"], `${text(payload.token, "token")}\n`, signal);
  if (action.startsWith("tunnel.profile.")) {
    const op = action.slice("tunnel.profile.".length);
    if (!["list", "status", "start", "stop", "restart", "enable", "disable"].includes(op)) throw bridgeError("unsupported_action", "Tunnel profile action is not allowed");
    const args = ["tunnel", "profile", op];
    if (op !== "list") args.push(text(payload.profile, "profile"));
    if (payload.expectedGeneration !== undefined) args.push("--generation", String(positive(payload.expectedGeneration, "expectedGeneration")));
    args.push("--json"); return run(args, undefined, signal);
  }
  if (action.startsWith("tunnel.")) {
    const op = action.slice(7);
    if (!["status", "start", "stop", "restart", "doctor"].includes(op)) throw bridgeError("unsupported_action", "Tunnel action is not allowed");
    const args = ["tunnel", op];
    if (op !== "doctor" && payload.provider !== undefined) args.push(text(payload.provider, "provider"));
    if (op !== "doctor" && payload.instance !== undefined) args.push(text(payload.instance, "instance"));
    if (payload.expectedGeneration !== undefined) args.push("--generation", String(positive(payload.expectedGeneration, "expectedGeneration")));
    args.push("--json"); return run(args, undefined, signal);
  }
  if (action.startsWith("workspace.")) {
    const op = action.slice(10);
    if (!["list", "register", "renew", "remove"].includes(op)) throw bridgeError("unsupported_action", "Workspace action is not allowed");
    const args = ["workspace", op];
    if (op !== "list") args.push(text(payload.target, "target"));
    if (payload.ttlSeconds !== undefined) args.push("--ttl", String(positive(payload.ttlSeconds, "ttlSeconds")));
    if ((op === "renew" || op === "remove") && payload.expectedGeneration === undefined) positive(payload.expectedGeneration, "expectedGeneration");
    if (payload.expectedGeneration !== undefined) args.push("--generation", String(positive(payload.expectedGeneration, "expectedGeneration")));
    args.push("--json"); return run(args, undefined, signal);
  }
  throw bridgeError("unsupported_action", "Gateway control action is not allowed");
}
