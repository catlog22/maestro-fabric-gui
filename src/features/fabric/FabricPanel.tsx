import { useMemo, useState } from "react";
import { callFabric, isRevisionConflict } from "../../lib/fabric-client";
import type { FabricOperationClass, FabricPath, FabricTool } from "../../models/fabric";
import { useI18n } from "../../i18n";
import { Evidence } from "../common/Evidence";

type T = ReturnType<typeof useI18n>["t"];

export function FabricPanel({ section, title, profileId, workspaceId }: { section: string; title?: string; profileId: string; workspaceId?: string }) {
  const { t } = useI18n();
  const tool = section.toLowerCase().replace(/s$/, "") as FabricTool;
  const [ids, setIds] = useState<Record<string, string>>({ ttl: "60000", paths: "hub,lan-direct", operationClass: "mcp-read", ...(workspaceId ? { workspaceId } : {}) });
  const [result, setResult] = useState<unknown>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const fields = useMemo(() => fieldsFor(tool, t), [tool, t]);

  function value(name: string) { return ids[name] ?? ""; }
  function set(name: string, next: string) { setIds((current) => ({ ...current, [name]: next })); }
  function number(name: string) { const parsed = Number(value(name)); return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined; }
  async function run(action: string) {
    if (["disconnect", "unbind", "close"].includes(action) && !window.confirm(t("confirmFabricAction").replace("{action}", `${tool}.${action}`))) return;
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
      setError(isRevisionConflict(caught) ? t("fabricConflict") : caught instanceof Error ? caught.message : String(caught));
    } finally { setBusy(undefined); }
  }

  if (!fields) return null;
  return <section className="panel">
    <div className="panel-heading"><div><h2>{title ?? section}</h2><p>{fields.description}</p></div><button disabled={busy !== undefined} onClick={() => void run("list")}>{t("refreshInventory")}</button></div>
    <div className="resource-form">{fields.inputs.map((field) => <label key={field.name}>{field.label}<input type={field.secret ? "password" : "text"} value={value(field.name)} onChange={(event) => set(field.name, event.target.value)} autoComplete="off" placeholder={field.placeholder} /></label>)}</div>
    <div className="action-row">{fields.actions.map((action) => <button key={action} disabled={busy !== undefined} onClick={() => void run(action)}>{busy === action ? t("working") : action}</button>)}</div>
    {error && <div className="error-box" role="alert">{error}</div>}
    <Evidence result={result} summary={t("authoritativeResponse")} open />
  </section>;
}

interface Field { name: string; label: string; placeholder?: string; secret?: boolean; }
interface Definition { description: string; actions: readonly string[]; inputs: readonly Field[]; }
function fieldsFor(tool: FabricTool, t: T): Definition | undefined {
  const shared: Field[] = [{ name:"deviceId", label:t("deviceId") }, { name:"connectorId", label:t("connectorId") }, { name:"connectionId", label:t("connectionId") }];
  if (tool === "device") return { description:t("fabricDeviceDesc"), actions:["list","get","pair","connect","disconnect","status","workspaces"], inputs:[...shared,{name:"pairingRef",label:t("pairingRef"),secret:true},{name:"credentialGeneration",label:t("credentialGeneration")},{name:"connectionGeneration",label:t("connectionGeneration")}] };
  if (tool === "workspace") return { description:t("fabricWorkspaceDesc"), actions:["list","bind","renew","unbind"], inputs:[...shared,{name:"workspaceId",label:t("remoteWorkspaceId")},{name:"localWorkspaceId",label:t("localWorkspaceId")},{name:"workspaceBindingId",label:t("bindingId")},{name:"workspaceGeneration",label:t("workspaceGeneration")},{name:"connectionGeneration",label:t("connectionGeneration")},{name:"revision",label:t("bindingRevision")},{name:"ttl",label:t("ttlMs")}] };
  if (tool === "endpoint") return { description:t("fabricEndpointDesc"), actions:["list","describe","select"], inputs:[...shared,{name:"endpointId",label:t("endpointId")}] };
  if (tool === "route") return { description:t("fabricRouteDesc"), actions:["open","renew","close"], inputs:[...shared,{name:"workspaceBindingId",label:t("workspaceBindingId")},{name:"workspaceGeneration",label:t("workspaceGeneration")},{name:"endpointId",label:t("endpointId")},{name:"endpointGeneration",label:t("endpointGeneration")},{name:"connectionGeneration",label:t("connectionGeneration")},{name:"routeId",label:t("routeId")},{name:"revision",label:t("routeRevision")},{name:"operationClass",label:t("operationClass"),placeholder:"mcp-read"},{name:"paths",label:t("pathCandidates"),placeholder:"hub,lan-direct"},{name:"ttl",label:t("ttlMs")}] };
}
