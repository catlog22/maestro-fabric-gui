export const FABRIC_ACTIONS = {
  device: ["list", "get", "pair", "connect", "disconnect", "status", "workspaces"],
  workspace: ["list", "bind", "renew", "unbind"],
  endpoint: ["list", "describe", "select"],
  route: ["open", "renew", "close"],
} as const;
export type FabricTool = keyof typeof FABRIC_ACTIONS;
export type FabricOperationClass = "agent-placement" | "mcp-read" | "mcp-mutation" | "artifact-read";
export type FabricPath = "hub" | "lan-direct" | "edge-relay" | "vps-relay";
export interface FabricResource { id: string; label: string; status: string; revision?: number; generation?: number; detail: Readonly<Record<string, unknown>>; }
export interface FabricInventory { devices: readonly FabricResource[]; workspaces: readonly FabricResource[]; endpoints: readonly FabricResource[]; routes: readonly FabricResource[]; revision: number; }
export const emptyFabricInventory: FabricInventory = { devices: [], workspaces: [], endpoints: [], routes: [], revision: 0 };
