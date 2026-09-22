import { useMemo, useState } from "react";
import { callFabric, isRevisionConflict } from "../../lib/fabric-client";
import type { FabricOperationClass, FabricPath, FabricTool } from "../../models/fabric";

export function FabricPanel({ section, profileId, workspaceId }: { section: string; profileId: string; workspaceId?: string }) {
  const tool = section.toLowerCase().replace(/s$/, "") as FabricTool;
  const [ids, setIds] = useState<Record<string, string>>({ ttl: "60000", paths: "hub,lan-direct", operationClass: "mcp-read", ...(workspaceId ? { workspaceId } : {}) });
  const [result, setResult] = useState<unknown>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const fields = useMemo(() => fieldsFor(tool), [tool]);

  function value(name: string) { return ids[name] ?? ""; }
  function set(name: string, next: string) { setIds((current) => ({ ...current, [name]: next })); }
  function number(name: string) { const parsed = Number(value(name)); return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined; }
  async function run(action: string) {
    if (["disconnect", "unbind", "close"].includes(action) && !window.confirm(`Confirm ${tool}.${action}? This changes active Fabric authority.`)) return;
    setBusy(action); setError(undefined);
    try {
      const common = { deviceId:value("deviceId")||undefined, connectorId:value("connectorId")||undefined, connectionId:value("connectionId")||undefined, workspaceId:value("workspaceId")||undefined, localWorkspaceId:value("localWorkspaceId")||undefined, workspaceBindingId:value("workspaceBindingId")||undefined, endpointId:value("endpointId")||undefined, routeId:value("routeId")||undefined };
      const payload: Record<string, unknown> = Object.fromEntries(Object.entries(common).filter(([, item]) => item !== undefined));
      if (action === "pair") payload.pairingRef = value("pairingRef");
      if (["connect"].includes(action)) payload.expectedCredentialGeneration = number("credentialGeneration");
      if (["disconnect", "bind", "open"].includes(action)) payload.expectedConnectionGeneration = number("connectionGeneration");
      if (action === "bind") payload.expectedWorkspaceGeneration = number("workspaceGeneration");
      if (["renew", "unbind", "close"].includes(action)) payload.expectedRevision = number("revision");
      if (["bind", "renew", "open"].includes(action)) payload.requestedTtlMs = number("ttl");
      if (action === "open") { payload.expectedEndpointGeneration = number("endpointGeneration"); payload.expectedWorkspaceGeneration = number("workspaceGeneration"); payload.operationClass = value("operationClass") as FabricOperationClass; payload.pathCandidates = value("paths").split(",").map((item) => item.trim()).filter(Boolean) as FabricPath[]; }
      setResult(await callFabric(profileId, tool, action, payload));
      if (action === "pair") set("pairingRef", "");
    } catch (caught) {
      setError(isRevisionConflict(caught) ? "State changed on the Gateway. Refresh the resource before trying again; the mutation was not replayed." : caught instanceof Error ? caught.message : String(caught));
    } finally { setBusy(undefined); }
  }

  if (!fields) return null;
  return <section className="panel">
    <div className="panel-heading"><div><h2>{section}</h2><p>{fields.description}</p></div><button disabled={busy !== undefined} onClick={() => void run("list")}>Refresh inventory</button></div>
    <div className="resource-form">{fields.inputs.map((field) => <label key={field.name}>{field.label}<input type={field.secret ? "password" : "text"} value={value(field.name)} onChange={(event) => set(field.name, event.target.value)} autoComplete="off" placeholder={field.placeholder} /></label>)}</div>
    <div className="action-row">{fields.actions.map((action) => <button key={action} disabled={busy !== undefined} onClick={() => void run(action)}>{busy === action ? "Working…" : action}</button>)}</div>
    {error && <div className="error-box" role="alert">{error}</div>}
    {result !== undefined && <details className="evidence" open><summary>Authoritative Gateway response</summary><pre>{JSON.stringify(result, null, 2)}</pre></details>}
  </section>;
}

interface Field { name: string; label: string; placeholder?: string; secret?: boolean; }
interface Definition { description: string; actions: readonly string[]; inputs: readonly Field[]; }
function fieldsFor(tool: FabricTool): Definition | undefined {
  const shared: Field[] = [{ name:"deviceId", label:"Device ID" }, { name:"connectorId", label:"Connector ID" }, { name:"connectionId", label:"Connection ID" }];
  if (tool === "device") return { description:"Discover, pair and generation-fence device connections.", actions:["list","get","pair","connect","disconnect","status","workspaces"], inputs:[...shared,{name:"pairingRef",label:"Pairing reference (shown only here)",secret:true},{name:"credentialGeneration",label:"Credential generation"},{name:"connectionGeneration",label:"Connection generation"}] };
  if (tool === "workspace") return { description:"Bind authorized local workspaces to a connected Fabric device with explicit TTL.", actions:["list","bind","renew","unbind"], inputs:[...shared,{name:"workspaceId",label:"Remote workspace ID"},{name:"localWorkspaceId",label:"Local workspace ID"},{name:"workspaceBindingId",label:"Binding ID"},{name:"workspaceGeneration",label:"Workspace generation"},{name:"connectionGeneration",label:"Connection generation"},{name:"revision",label:"Binding revision"},{name:"ttl",label:"TTL (ms)"}] };
  if (tool === "endpoint") return { description:"Inspect and select agent or MCP endpoints without opening a route.", actions:["list","describe","select"], inputs:[...shared,{name:"endpointId",label:"Endpoint ID"}] };
  if (tool === "route") return { description:"Open a generation-fenced route for one explicit operation class.", actions:["open","renew","close"], inputs:[...shared,{name:"workspaceBindingId",label:"Workspace binding ID"},{name:"workspaceGeneration",label:"Workspace generation"},{name:"endpointId",label:"Endpoint ID"},{name:"endpointGeneration",label:"Endpoint generation"},{name:"connectionGeneration",label:"Connection generation"},{name:"routeId",label:"Route ID"},{name:"revision",label:"Route revision"},{name:"operationClass",label:"Operation class",placeholder:"mcp-read"},{name:"paths",label:"Path candidates",placeholder:"hub,lan-direct"},{name:"ttl",label:"TTL (ms)"}] };
}
