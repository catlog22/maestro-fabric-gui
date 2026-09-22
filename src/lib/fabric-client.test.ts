import { describe, expect, it } from "vitest";
import { FABRIC_ACTIONS, type FabricTool } from "../models/fabric";
import { isRevisionConflict, prepareFabricArguments } from "./fabric-client";

const examples: Record<string, Record<string, unknown>> = {
  "device.list": {}, "device.get": { deviceId:"d" }, "device.pair": { deviceId:"d", connectorId:"c", pairingRef:"ref" }, "device.connect": { deviceId:"d", connectorId:"c", expectedCredentialGeneration:1 }, "device.disconnect": { deviceId:"d", connectionId:"x", expectedConnectionGeneration:1 }, "device.status": { deviceId:"d" }, "device.workspaces": { deviceId:"d" },
  "workspace.list": {}, "workspace.bind": { connectionId:"x", expectedConnectionGeneration:1, workspaceId:"w", expectedWorkspaceGeneration:1, requestedTtlMs:60000 }, "workspace.renew": { workspaceBindingId:"b", expectedRevision:1, requestedTtlMs:60000 }, "workspace.unbind": { workspaceBindingId:"b", expectedRevision:1 },
  "endpoint.list": {}, "endpoint.describe": { endpointId:"e" }, "endpoint.select": { endpointId:"e" },
  "route.open": { connectionId:"x", expectedConnectionGeneration:1, endpointId:"e", expectedEndpointGeneration:1, operationClass:"mcp-read", pathCandidates:["hub"], requestedTtlMs:60000 }, "route.renew": { routeId:"r", expectedRevision:1, requestedTtlMs:60000 }, "route.close": { routeId:"r", expectedRevision:1 },
};
describe("Fabric control contracts", () => {
  for (const [tool, actions] of Object.entries(FABRIC_ACTIONS)) for (const action of actions) it(`maps ${tool}.${action}`, () => {
    const args = prepareFabricArguments(tool as FabricTool, action, examples[`${tool}.${action}`]!, 1000, "req");
    expect(args).toMatchObject({ action, requestId:"req", deadlineAt:31000 });
  });
  it("fails closed without a generation fence", () => expect(() => prepareFabricArguments("route", "close", { routeId:"r" })).toThrow(/expectedRevision/));
  it("classifies stale state without retrying", () => expect(isRevisionConflict(new Error("generation conflict"))).toBe(true));
});
