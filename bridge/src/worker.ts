import { createInterface } from "node:readline";
import { gatewayControl } from "./gateway-control.js";
import { callGatewayTool, connectProfile, disconnectProfile, drainGatewayEvents, listProfiles } from "./mcp-client.js";
import { BRIDGE_ACTIONS, BRIDGE_PROTOCOL_VERSION, parseRequest, sanitizeError, type BridgeRequest, type BridgeResponse } from "./protocol.js";

const inflight = new Map<string, AbortController>();

export async function dispatch(request: BridgeRequest, signal?: AbortSignal): Promise<unknown> {
  if (request.action === "handshake") return {
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    bridgeVersion: "0.1.0",
    nodeVersion: process.versions.node,
    readiness: "ready",
    capabilities: [...BRIDGE_ACTIONS],
  };
  if (request.action === "gateway.control") {
    const action = request.payload?.controlAction;
    if (typeof action !== "string") throw Object.assign(new Error("controlAction is required"), { code: "invalid_request" });
    return gatewayControl(action, request.payload ?? {}, signal);
  }
  if (request.action === "gateway.connect") return connectProfile(request.payload ?? {});
  if (request.action === "gateway.disconnect") return disconnectProfile(request.payload ?? {});
  if (request.action === "gateway.call") return callGatewayTool(request.payload ?? {});
  if (request.action === "gateway.events") return drainGatewayEvents(request.payload ?? {});
  if (request.action === "gateway.profiles") return listProfiles();
  const targetId = request.payload?.operationId;
  if (typeof targetId !== "string") throw Object.assign(new Error("operationId is required"), { code: "invalid_request" });
  const controller = inflight.get(targetId);
  controller?.abort();
  return { cancelled: controller !== undefined };
}

async function handle(value: unknown): Promise<BridgeResponse> {
  let id = "unknown";
  try {
    const request = parseRequest(value);
    id = request.id;
    const controller = new AbortController();
    inflight.set(id, controller);
    try { return { id, ok: true, result: await dispatch(request, controller.signal) }; }
    finally { inflight.delete(id); }
  } catch (error) { return { id, ok: false, error: sanitizeError(error) }; }
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replaceAll("\\", "/")}`).href) {
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  input.on("line", (line) => { void Promise.resolve().then(() => JSON.parse(line)).then(handle).then((result) => process.stdout.write(`${JSON.stringify(result)}\n`)).catch((error) => process.stdout.write(`${JSON.stringify({ id: "unknown", ok: false, error: sanitizeError(error) })}\n`)); });
}
