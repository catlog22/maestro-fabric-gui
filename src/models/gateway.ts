export type GatewayProfileKind = "local" | "remote-http";
export interface GatewayProfile {
  profileId: string;
  kind: GatewayProfileKind;
  url: string;
  generation: number;
  connected: boolean;
  protocolVersion?: number;
  tools?: readonly string[];
  error?: string;
}

export interface GatewayServerConfig {
  host: string;
  port: number;
}

export type GatewayTunnelConfig =
  | { kind: "none" }
  | { kind: "openai-managed"; profileId: string; tunnelIdCredentialRef: string; runtimeKeyCredentialRef: string; autoInstall: boolean; credentialTtlMs: number }
  | { kind: "cloudflare-quick"; profileId: string; binaryPath?: string }
  | { kind: "cloudflare-named"; profileId: string; publicUrl: string; tunnelId: string; credentialsFile?: string; tokenFile?: string; binaryPath?: string }
  | { kind: "ssh-reverse"; profileId: string; publicUrl: string; host: string; user?: string; port: number; remotePort: number; identityFile?: string; binaryPath?: string };

export interface GatewayRuntimeConfig {
  version: 1;
  desiredRunning: boolean;
  server: GatewayServerConfig;
  tunnel: GatewayTunnelConfig;
}

export type GatewayRuntimeStatus = "stopped" | "starting" | "running" | "failed";
export interface GatewayRuntimeState {
  status: GatewayRuntimeStatus;
  desiredRunning: boolean;
  configPath: string;
  httpUrl: string;
  localCredentialRef: string;
  tunnelKind: GatewayTunnelConfig["kind"];
  fabricEnabled: boolean;
  pid?: number;
  error?: string;
}

export const defaultGatewayRuntimeConfig = (): GatewayRuntimeConfig => ({
  version: 1,
  desiredRunning: false,
  server: { host: "127.0.0.1", port: 9090 },
  tunnel: { kind: "none" },
});

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
