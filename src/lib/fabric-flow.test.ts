import { describe, expect, it } from "vitest";
import { prepareFabricArguments } from "./fabric-client";

describe("Fabric route fixture flow", () => {
  it("preserves every authority fence through connect, bind, select and route lifecycle", () => {
    const connect = prepareFabricArguments("device","connect",{deviceId:"d",connectorId:"c",expectedCredentialGeneration:2},0,"1");
    const bind = prepareFabricArguments("workspace","bind",{connectionId:"cx",expectedConnectionGeneration:3,workspaceId:"w",expectedWorkspaceGeneration:4,requestedTtlMs:60000},0,"2");
    const select = prepareFabricArguments("endpoint","select",{endpointId:"e"},0,"3");
    const open = prepareFabricArguments("route","open",{connectionId:"cx",expectedConnectionGeneration:3,workspaceBindingId:"b",expectedWorkspaceGeneration:4,endpointId:"e",expectedEndpointGeneration:5,operationClass:"mcp-read",pathCandidates:["lan-direct","hub"],requestedTtlMs:60000},0,"4");
    const renew = prepareFabricArguments("route","renew",{routeId:"r",expectedRevision:6,requestedTtlMs:60000},0,"5");
    const close = prepareFabricArguments("route","close",{routeId:"r",expectedRevision:7},0,"6");
    expect([connect.requestId,bind.requestId,select.requestId,open.requestId,renew.requestId,close.requestId]).toEqual(["1","2","3","4","5","6"]);
    expect(open).toMatchObject({ expectedConnectionGeneration:3, expectedWorkspaceGeneration:4, expectedEndpointGeneration:5 });
  });
});
