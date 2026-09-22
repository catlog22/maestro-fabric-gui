export type GatewayRisk = "read" | "write" | "destructive" | "privileged";
export interface GatewayActionDescriptor { readonly risk: GatewayRisk; readonly workspaceScoped: boolean; readonly sessionScoped: boolean; }
export interface GatewayToolManifestEntry { readonly name: string; readonly description?: string; readonly inputSchema: Readonly<Record<string, unknown>>; readonly annotations?: Readonly<Record<string, unknown>>; readonly requiredCapabilities: readonly string[]; readonly executionMode?: string; readonly actions: Readonly<Record<string, GatewayActionDescriptor>>; }

const read = (workspaceScoped = false, sessionScoped = false): GatewayActionDescriptor => ({ risk: "read", workspaceScoped, sessionScoped });
const write = (risk: GatewayRisk = "write", workspaceScoped = false, sessionScoped = false): GatewayActionDescriptor => ({ risk, workspaceScoped, sessionScoped });
const workspace = (risk: GatewayRisk = "read"): GatewayActionDescriptor => risk === "read" ? read(true) : write(risk, true);
const sessionRead = (): GatewayActionDescriptor => read(true, true);
const sessionWrite = (risk: GatewayRisk = "write"): GatewayActionDescriptor => write(risk, true, true);

export const GATEWAY_ACTION_REGISTRY: Readonly<Record<string, Readonly<Record<string, GatewayActionDescriptor>>>> = {
  workspace: { list: read(), get: read(), bind: workspace("write"), renew: workspace("write"), unbind: workspace("destructive") },
  board: { create: workspace("write"), list: workspace(), get: workspace(), update: workspace("write"), claim: workspace("write"), renew: workspace("write"), release: workspace("write"), takeover: workspace("destructive"), "attach-endpoint": workspace("write"), "detach-endpoint": workspace("write"), "bind-session": workspace("write"), "link-plan": workspace("write"), handoff: workspace("write"), transition: workspace("write"), search: workspace(), observe: workspace() },
  host: { describe: read(), status: read(), test: read() },
  exec: { run: workspace("privileged") },
  job: { start: workspace("privileged"), list: workspace(), status: workspace(), logs: workspace(), stdin: workspace("privileged"), cancel: workspace("destructive") },
  file: { list: workspace(), stat: workspace(), read: workspace(), write: workspace("destructive"), edit: workspace("destructive"), find: workspace(), grep: workspace(), transfer: workspace("destructive"), realpath: workspace() },
  teammate: { start: workspace("privileged"), list: read(), observe: read(), wait: read(), send: write("write", true), cancel: write("destructive", true), result: read() },
  session: { create: sessionWrite(), get: sessionRead(), list: read(), join: sessionWrite(), renew: sessionWrite(), leave: sessionWrite("destructive"), handoff: sessionWrite(), close: sessionWrite("destructive"), "start-pi": sessionWrite("privileged") },
  todo: { create: sessionWrite(), update: sessionWrite(), list: sessionRead(), get: sessionRead(), delete: sessionWrite("destructive"), claim: sessionWrite(), release: sessionWrite(), advance: sessionWrite() },
  monitor: { list: sessionRead(), observe: sessionRead(), wait: sessionRead(), message: sessionWrite(), cancel: sessionWrite("destructive"), result: sessionRead(), subscribe: sessionRead(), unsubscribe: sessionWrite() },
  handoff: { list: read(true), get: read(true), search: read(true) },
  skill: { list: read(), load: read() },
  maestro_cli: { search: read(), load: read(), stage: write("destructive", true) },
  browser: { guide: workspace(), status: workspace(), pair: workspace("write"), open: workspace("write"), run: workspace("privileged"), close: workspace("destructive") },
  device: { list: read(), get: read(), pair: write("write"), connect: write("write"), disconnect: write("destructive"), status: read(), workspaces: read() },
  endpoint: { list: read(), describe: read(), select: read() },
  route: { open: write("write"), renew: write("write"), close: write("destructive") },
};

export function describeGatewayAction(tool: string, action: string): GatewayActionDescriptor | undefined { return GATEWAY_ACTION_REGISTRY[tool]?.[action]; }
export function gatewayToolNames(): readonly string[] { return Object.keys(GATEWAY_ACTION_REGISTRY); }

export function schemaAdvertisesAction(schema: unknown, action: string): boolean {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return false;
  const oneOf = (schema as { oneOf?: unknown }).oneOf;
  if (!Array.isArray(oneOf)) return false;
  return oneOf.some((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
    const properties = (candidate as { properties?: unknown }).properties;
    const actionProperty = properties && typeof properties === "object" && !Array.isArray(properties) ? (properties as { action?: unknown }).action : undefined;
    return actionProperty && typeof actionProperty === "object" && (actionProperty as { const?: unknown }).const === action;
  });
}
