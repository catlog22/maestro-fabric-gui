import { createInterface } from "node:readline";
import { gatewayControl, probeGatewayCompatibility } from "./gateway-control.js";
import { callGatewayTool, connectProfile, disconnectProfile, drainGatewayEvents, listProfiles } from "./mcp-client.js";
import { BRIDGE_ACTIONS, BRIDGE_PROTOCOL_VERSION, bridgeError, parseRequest, sanitizeError, type BridgeRequest, type BridgeResponse } from "./protocol.js";

export type BridgeDispatcher = (request: BridgeRequest, signal?: AbortSignal) => Promise<unknown>;

export async function dispatch(request: BridgeRequest, signal?: AbortSignal): Promise<unknown> {
  if (request.action === "handshake") return {
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    bridgeVersion: "0.1.0",
    nodeVersion: process.versions.node,
    readiness: "ready",
    capabilities: BRIDGE_ACTIONS.filter((action) => action !== "cancel"),
    gatewayCompatibility: await probeGatewayCompatibility(signal),
  };
  if (request.action === "gateway.control") {
    const action = request.payload?.controlAction;
    if (typeof action !== "string") throw bridgeError("invalid_request", "controlAction is required");
    return gatewayControl(action, request.payload ?? {}, signal);
  }
  if (request.action === "gateway.connect") return connectProfile(request.payload ?? {});
  if (request.action === "gateway.disconnect") return disconnectProfile(request.payload ?? {});
  if (request.action === "gateway.call") return callGatewayTool(request.payload ?? {});
  if (request.action === "gateway.events") return drainGatewayEvents(request.payload ?? {});
  if (request.action === "gateway.profiles") return listProfiles();
  throw bridgeError("unsupported_action", "Cancel requests are handled by the bridge request handler");
}

/**
 * Each worker request gets its own AbortController. Cancel frames are handled
 * outside the normal dispatcher so they can arrive while another request is
 * pending and abort that exact operation.
 */
export function createBridgeRequestHandler(execute: BridgeDispatcher = dispatch): (value: unknown) => Promise<BridgeResponse> {
  const inflight = new Map<string, AbortController>();
  return async (value: unknown): Promise<BridgeResponse> => {
    let id = "unknown";
    try {
      const request = parseRequest(value);
      id = request.id;
      if (request.action === "cancel") {
        const targetId = request.payload?.operationId;
        if (typeof targetId !== "string" || targetId.length < 1 || targetId.length > 128) throw bridgeError("invalid_request", "operationId is required");
        const controller = inflight.get(targetId);
        controller?.abort();
        return { id, ok: true, result: { operationId: targetId, cancelled: controller !== undefined } };
      }
      if (inflight.has(id)) throw bridgeError("duplicate_request", "Request id is already in flight");
      const controller = new AbortController();
      inflight.set(id, controller);
      try { return { id, ok: true, result: await execute(request, controller.signal) }; }
      finally { inflight.delete(id); }
    } catch (error) { return { id, ok: false, error: sanitizeError(error) }; }
  };
}

export const handleBridgeRequest = createBridgeRequestHandler();

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replaceAll("\\", "/")}`).href) {
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  input.on("line", (line) => {
    void Promise.resolve()
      .then(() => JSON.parse(line))
      .then(handleBridgeRequest)
      .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
      .catch((error) => process.stdout.write(`${JSON.stringify({ id: "unknown", ok: false, error: sanitizeError(error) })}\n`));
  });
}
