export type WorkspaceLayer = "authorized" | "registry" | "binding";
export type WorkspaceHealth = "authorized" | "active" | "expired" | "orphaned" | "unauthorized" | "unknown";
export interface AuthorizedWorkspace { layer: "authorized"; id: string; path: string; authorized: true; status: WorkspaceHealth; }
export interface RegistryWorkspace { layer: "registry"; id: string; path: string; mode: "lease" | "permanent"; generation: number; expiresAt?: number; status: WorkspaceHealth; }
export interface FabricBinding { layer: "binding"; id: string; workspaceId: string; localWorkspaceId?: string; deviceId: string; connectionId: string; revision: number; generation: number; expiresAt?: number; status: WorkspaceHealth; }
export type WorkspaceRecord = AuthorizedWorkspace | RegistryWorkspace | FabricBinding;
export interface WorkspaceTopology { profileId: string; selectedId?: string; records: readonly WorkspaceRecord[]; cursor: number; hasMore: boolean; revision: number; }
export const emptyWorkspaceTopology = (profileId: string): WorkspaceTopology => ({ profileId, records: [], cursor: 0, hasMore: false, revision: 0 });
export function workspaceHealth(record: WorkspaceRecord, now = Date.now()): WorkspaceHealth {
  if (record.layer === "authorized") return record.authorized ? "authorized" : "unauthorized";
  if (record.expiresAt !== undefined && record.expiresAt <= now) return "expired";
  return record.status;
}
export function selectWorkspace(state: WorkspaceTopology, id: string): WorkspaceTopology {
  const exists = state.records.some((record) => record.id === id);
  return exists ? { ...state, selectedId: id } : state;
}
export function replaceWorkspacePage(state: WorkspaceTopology, page: { records: readonly WorkspaceRecord[]; nextCursor: number; hasMore: boolean }): WorkspaceTopology {
  return { ...state, records: page.records, cursor: page.nextCursor, hasMore: page.hasMore, revision: state.revision + 1 };
}
