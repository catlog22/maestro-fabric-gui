import { desktopApi } from "./desktop-api";
import { FABRIC_ACTIONS, type FabricTool } from "../models/fabric";

const MUTATION_FENCES: Readonly<Record<string, readonly string[]>> = {
  "device.pair": ["connectorId", "pairingRef"],
  "device.connect": ["connectorId", "expectedCredentialGeneration"],
  "device.disconnect": ["connectionId", "expectedConnectionGeneration"],
  "workspace.bind": ["connectionId", "expectedConnectionGeneration", "workspaceId", "expectedWorkspaceGeneration", "requestedTtlMs"],
  "workspace.renew": ["workspaceBindingId", "expectedRevision", "requestedTtlMs"],
  "workspace.unbind": ["workspaceBindingId", "expectedRevision"],
  "endpoint.select": ["endpointId"],
  "route.open": ["connectionId", "expectedConnectionGeneration", "endpointId", "expectedEndpointGeneration", "operationClass", "pathCandidates", "requestedTtlMs"],
  "route.renew": ["routeId", "expectedRevision", "requestedTtlMs"],
  "route.close": ["routeId", "expectedRevision"],
};

export function prepareFabricArguments(tool: FabricTool, action: string, input: Record<string, unknown>, now = Date.now(), requestId: string = crypto.randomUUID()) {
  const actions = FABRIC_ACTIONS[tool] as readonly string[];
  if (!actions.includes(action)) throw new Error(`Unsupported Fabric action: ${tool}.${action}`);
  const key = `${tool}.${action}`;
  for (const field of MUTATION_FENCES[key] ?? []) {
    const value = input[field];
    if (value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0)) throw new Error(`${key} requires ${field}`);
  }
  return { action, requestId, deadlineAt: now + 30_000, ...input };
}

export async function callFabric<T>(profileId: string, tool: FabricTool, action: string, input: Record<string, unknown> = {}): Promise<T> {
  return desktopApi.callGateway<T>(profileId, tool, prepareFabricArguments(tool, action, input));
}

export function isRevisionConflict(error: unknown): boolean {
  const text = typeof error === "string" ? error : error instanceof Error ? error.message : "";
  return /revision|generation|conflict|stale/i.test(text);
}
