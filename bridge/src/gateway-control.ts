import { spawn } from "node:child_process";
import { isAbsolute } from "node:path";
import { bridgeError } from "./protocol.js";
import { projectTunnelProfileResult } from "./tunnel-profile.js";

export type GatewayCliRunner = (args: readonly string[], input?: string, signal?: AbortSignal) => Promise<unknown>;
export const MINIMUM_GATEWAY_VERSION = "0.31.3";

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
function optionalPositive(args: string[], value: unknown, name: string, flag: string): void {
  if (value !== undefined) args.push(flag, String(positive(value, name)));
}
function configPath(value: unknown): string {
  const path = text(value, "configPath");
  if (!isAbsolute(path) || path.includes("\0") || /[\r\n]/.test(path)) throw bridgeError("invalid_request", "configPath must be an absolute path");
  return path;
}
function appendConfig(args: string[], payload: Readonly<Record<string, unknown>>): void {
  if (payload.configPath !== undefined) args.push("--config", configPath(payload.configPath));
}
function rejectUnsupportedConfig(payload: Readonly<Record<string, unknown>>, action: string): void {
  if (payload.configPath !== undefined) throw bridgeError("invalid_request", `${action} does not support configPath`);
}
function appendJson(args: string[]): void { args.push("--json"); }

function parseSemver(value: unknown): readonly [number, number, number, string | undefined] {
  if (typeof value !== "string") throw bridgeError("invalid_gateway_response", "Gateway version is invalid");
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value);
  if (!match) throw bridgeError("invalid_gateway_response", "Gateway version is invalid");
  const parts = [Number(match[1]), Number(match[2]), Number(match[3])] as const;
  if (parts.some((part) => !Number.isSafeInteger(part))) throw bridgeError("invalid_gateway_response", "Gateway version is invalid");
  return [parts[0], parts[1], parts[2], match[4]];
}
function compatibleVersion(version: string, minimumVersion: string): boolean {
  const current = parseSemver(version);
  const minimum = parseSemver(minimumVersion);
  for (let index = 0; index < 3; index += 1) {
    if (current[index]! !== minimum[index]!) return current[index]! > minimum[index]!;
  }
  if (current[3] && !minimum[3]) return false;
  return true;
}

export interface GatewayCompatibility {
  readonly available: boolean;
  readonly minimumVersion: string;
  readonly compatible: boolean;
  readonly version?: string;
  readonly protocolVersion?: number;
}

/** Fixed, argument-free compatibility probe used by the bridge handshake. */
export async function probeGatewayCompatibility(signal?: AbortSignal, run: GatewayCliRunner = runGatewayCli): Promise<GatewayCompatibility> {
  try {
    const raw = await run(["version", "--json"], undefined, signal);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw bridgeError("invalid_gateway_response", "Gateway version response is invalid");
    const value = raw as Record<string, unknown>;
    const version = text(value.version, "Gateway version");
    parseSemver(version);
    if (value.name !== undefined && value.name !== "pi-maestro-gateway") throw bridgeError("invalid_gateway_response", "Gateway version response has an invalid name");
    if (value.protocolVersion !== undefined && (!Number.isSafeInteger(value.protocolVersion) || Number(value.protocolVersion) < 1)) throw bridgeError("invalid_gateway_response", "Gateway protocol version is invalid");
    return {
      available: true,
      version,
      minimumVersion: MINIMUM_GATEWAY_VERSION,
      compatible: compatibleVersion(version, MINIMUM_GATEWAY_VERSION),
      ...(value.protocolVersion === undefined ? {} : { protocolVersion: Number(value.protocolVersion) }),
    };
  } catch {
    return { available: false, minimumVersion: MINIMUM_GATEWAY_VERSION, compatible: false };
  }
}

export async function gatewayControl(action: string, payload: Readonly<Record<string, unknown>>, signal?: AbortSignal, run: GatewayCliRunner = runGatewayCli): Promise<unknown> {
  if (["install", "ensure", "start", "stop", "restart", "status", "uninstall"].includes(action)) {
    const args = ["service", action];
    const persistence = payload.persistence;
    if (persistence !== undefined) {
      if (action !== "install" && action !== "ensure") throw bridgeError("invalid_request", "persistence is supported only for service install or ensure");
      if (persistence === "windows-startup") args.push("--windows-startup");
      else if (persistence === "detached-fallback") args.push("--detached-fallback");
      else throw bridgeError("invalid_request", "persistence must be windows-startup or detached-fallback");
    }
    appendConfig(args, payload); appendJson(args);
    return run(args, undefined, signal);
  }
  if (action === "pair.create" || action === "pair.bootstrap") {
    throw bridgeError("unsupported_action", "Pairing credentials cannot cross the desktop bridge boundary");
  }
  if (action === "pair.list") {
    const args = ["pair", "list"];
    appendConfig(args, payload); appendJson(args);
    return run(args, undefined, signal);
  }
  if (action === "pair.revoke") {
    const args = ["pair", "revoke", text(payload.id, "id")];
    appendConfig(args, payload); appendJson(args);
    return run(args, undefined, signal);
  }
  if (action === "connector.revoke") {
    const args = ["connector", "revoke", text(payload.connectorId, "connectorId"), "--expected-revision", String(positive(payload.expectedRevision, "expectedRevision")), "--request-id", text(payload.requestId, "requestId")];
    appendConfig(args, payload); appendJson(args);
    return run(args, undefined, signal);
  }
  if (action === "connector.enroll") {
    rejectUnsupportedConfig(payload, action);
    const args = ["connector", "enroll", "--hub", text(payload.hub, "hub"), "--connector-id", text(payload.connectorId, "connectorId"), "--device-id", text(payload.deviceId, "deviceId"), "--token-stdin", "--json"];
    return run(args, `${text(payload.token, "token")}\n`, signal);
  }
  if (action === "connector.rotate") {
    rejectUnsupportedConfig(payload, action);
    return run(["connector", "rotate", "--expected-revision", String(positive(payload.expectedRevision, "expectedRevision")), "--expected-generation", String(positive(payload.expectedGeneration, "expectedGeneration")), "--token-stdin", "--json"], `${text(payload.token, "token")}\n`, signal);
  }
  if (action.startsWith("tunnel.profile.")) {
    const op = action.slice("tunnel.profile.".length);
    if (!["list", "status", "start", "stop", "restart"].includes(op)) throw bridgeError("unsupported_action", "Tunnel profile action is not allowed for the GUI-owned desired state");
    const args = ["tunnel", "profile", op];
    let requestedProfile: string | undefined;
    if (op !== "list") { requestedProfile = text(payload.profileId ?? payload.profile, "profileId"); args.push(requestedProfile); }
    if (op === "list" && (payload.expectedGeneration !== undefined || payload.timeoutMs !== undefined)) throw bridgeError("invalid_request", "Tunnel profile list does not accept generation or timeout");
    if (["status", "enable", "disable"].includes(op) && payload.expectedGeneration !== undefined) throw bridgeError("invalid_request", `Tunnel profile ${op} does not accept expectedGeneration`);
    optionalPositive(args, payload.timeoutMs, "timeoutMs", "--timeout-ms");
    optionalPositive(args, payload.expectedGeneration, "expectedGeneration", "--generation");
    appendConfig(args, payload); appendJson(args);
    const value = await run(args, undefined, signal);
    return projectTunnelProfileResult(op, value, requestedProfile);
  }
  if (action.startsWith("tunnel.")) {
    const op = action.slice(7);
    if (op !== "doctor") throw bridgeError("unsupported_action", "Tunnel lifecycle must use a configured tunnel.profile action");
    if (payload.provider !== undefined || payload.instance !== undefined || payload.expectedGeneration !== undefined) throw bridgeError("invalid_request", "Tunnel doctor accepts only configPath and timeoutMs");
    const args = ["tunnel", "doctor"];
    optionalPositive(args, payload.timeoutMs, "timeoutMs", "--timeout-ms");
    appendConfig(args, payload); appendJson(args);
    return run(args, undefined, signal);
  }
  if (action.startsWith("workspace.")) {
    const op = action.slice(10);
    if (!["list", "register", "renew", "remove"].includes(op)) throw bridgeError("unsupported_action", "Workspace action is not allowed");
    const args = ["workspace", op];
    if (op !== "list") args.push(text(payload.target, "target"));
    if (payload.permanent !== undefined) {
      if (op !== "register" || payload.permanent !== true) throw bridgeError("invalid_request", "permanent is supported only as true for workspace.register");
      if (payload.ttlSeconds !== undefined) throw bridgeError("invalid_request", "permanent and ttlSeconds are mutually exclusive");
      args.push("--permanent");
    }
    if (payload.ttlSeconds !== undefined) args.push("--ttl", String(positive(payload.ttlSeconds, "ttlSeconds")));
    if ((op === "renew" || op === "remove") && payload.expectedGeneration === undefined) positive(payload.expectedGeneration, "expectedGeneration");
    optionalPositive(args, payload.expectedGeneration, "expectedGeneration", "--generation");
    appendConfig(args, payload); appendJson(args);
    return run(args, undefined, signal);
  }
  throw bridgeError("unsupported_action", "Gateway control action is not allowed");
}
