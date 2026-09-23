import { invoke } from "@tauri-apps/api/core";
import type { DesktopState } from "../models/desktop";
import type { GatewayRuntimeConfig, GatewayRuntimeState } from "../models/gateway";

type DesktopBridgeAction = "gateway.control" | "gateway.connect" | "gateway.disconnect" | "gateway.call" | "gateway.events" | "gateway.profiles";

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function invokeDesktop<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauriRuntime()) {
    return Promise.reject(new Error("Maestro Gateway Console must be opened from the Tauri desktop app, not a browser tab."));
  }
  return invoke<T>(command, args);
}

function bridgeAction<T>(action: DesktopBridgeAction, payload: Record<string, unknown>, deadlineMs = 30_000) {
  return invokeDesktop<T>("bridge_action", { request: { action, payload, deadlineMs } });
}

export const desktopApi = {
  getState: () => invokeDesktop<DesktopState>("get_desktop_state"),
  handshake: (deadlineMs = 5_000) => invokeDesktop<DesktopState>("bridge_handshake", { request: { deadlineMs } }),
  gatewayControl: <T>(controlAction: string, payload: Record<string, unknown> = {}, deadlineMs = 30_000) => bridgeAction<T>("gateway.control", { ...payload, controlAction }, deadlineMs),
  getGatewayRuntimeConfig: () => invokeDesktop<GatewayRuntimeConfig>("get_gateway_runtime_config"),
  saveGatewayRuntimeConfig: (request: GatewayRuntimeConfig) => invokeDesktop<GatewayRuntimeState>("save_gateway_runtime_config", { request }),
  getGatewayRuntimeState: () => invokeDesktop<GatewayRuntimeState>("get_gateway_runtime_state"),
  startGatewayRuntime: () => invokeDesktop<GatewayRuntimeState>("start_gateway_runtime"),
  stopGatewayRuntime: () => invokeDesktop<GatewayRuntimeState>("stop_gateway_runtime"),
  restartGatewayRuntime: () => invokeDesktop<GatewayRuntimeState>("restart_gateway_runtime"),
  importGatewayCredentials: (request: { path: string; tunnelIdCredentialRef: string; runtimeKeyCredentialRef: string; deleteAfterImport: boolean }) => invokeDesktop<void>("import_gateway_credentials", { request }),
  deleteGatewayCredential: (reference: string) => invokeDesktop<void>("delete_gateway_credential", { request: { reference } }),
  connectGateway: <T>(profileId: string, url: string, generation: number, credentialRef?: string, kind: "local" | "remote-http" = "remote-http") => bridgeAction<T>("gateway.connect", { profileId, url, generation, kind, ...(credentialRef ? { credentialRef } : {}) }),
  disconnectGateway: <T>(profileId: string) => bridgeAction<T>("gateway.disconnect", { profileId }),
  callGateway: <T>(profileId: string, tool: string, args: Record<string, unknown>) => bridgeAction<T>("gateway.call", { profileId, tool, arguments: args }),
  drainGatewayEvents: <T>(profileId: string, limit = 100) => bridgeAction<T>("gateway.events", { profileId, limit }),
  listGatewayProfiles: <T>() => bridgeAction<T>("gateway.profiles", {}),
};
