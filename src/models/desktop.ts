export const DESKTOP_PROTOCOL_VERSION = 1 as const;

export type Readiness = "ready" | "starting" | "unavailable";

export interface GatewayCompatibility {
  available: boolean;
  minimumVersion: string;
  compatible: boolean;
  version?: string;
  protocolVersion?: number;
}

export interface BridgeHandshake {
  protocolVersion: typeof DESKTOP_PROTOCOL_VERSION;
  bridgeVersion: string;
  nodeVersion: string;
  readiness: Readiness;
  capabilities: readonly string[];
  gatewayCompatibility?: GatewayCompatibility;
}

export interface DesktopError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface DesktopState {
  revision: number;
  readiness: Readiness;
  bridge?: BridgeHandshake;
  error?: DesktopError;
}
