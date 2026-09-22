export type GatewayProfileKind = "local" | "remote";
export interface GatewayProfile {
  id: string;
  name: string;
  kind: GatewayProfileKind;
  url?: string;
  connectionGeneration: number;
  connected: boolean;
  protocolVersion?: number;
  tools: readonly string[];
  error?: string;
}
export interface GatewaySnapshot {
  profileId: string;
  connectionGeneration: number;
  snapshotRevision: number;
  gateway?: unknown;
  connector?: unknown;
  tunnel?: unknown;
  workspaces: readonly unknown[];
}
export function acceptGatewaySnapshot(current: GatewaySnapshot | undefined, next: GatewaySnapshot): GatewaySnapshot | undefined {
  if (!current) return next;
  if (next.profileId !== current.profileId || next.connectionGeneration !== current.connectionGeneration) return current;
  return next.snapshotRevision >= current.snapshotRevision ? next : current;
}
