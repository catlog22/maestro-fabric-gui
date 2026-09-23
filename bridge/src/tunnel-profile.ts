import { bridgeError } from "./protocol.js";

export type TunnelEndpointKind = "managed" | "fixed" | "ephemeral";

export interface TunnelEndpointProjection {
  readonly kind: TunnelEndpointKind;
  readonly url?: string;
}

export interface TunnelProfileProjection {
  readonly profileId: string;
  readonly provider?: string;
  readonly mode?: string;
  readonly lifecycle?: "persistent" | "ephemeral";
  readonly enabled?: boolean;
  readonly generation?: number;
  readonly desiredState?: "stopped" | "running";
  readonly phase?: "stopped" | "starting" | "ready" | "degraded" | "quiescing" | "failed";
  readonly endpoint?: TunnelEndpointProjection;
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_MODE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const ENDPOINT_KINDS = new Set<TunnelEndpointKind>(["managed", "fixed", "ephemeral"]);
const PHASES = new Set<TunnelProfileProjection["phase"]>(["stopped", "starting", "ready", "degraded", "quiescing", "failed"]);

function record(value: unknown, name = "Tunnel profile result"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw bridgeError("invalid_gateway_response", `${name} is invalid`);
  return value as Record<string, unknown>;
}

function optionalId(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !SAFE_ID.test(value)) throw bridgeError("invalid_gateway_response", `${name} is invalid`);
  return value;
}

function requiredId(value: unknown, name: string): string {
  const result = optionalId(value, name);
  if (result === undefined) throw bridgeError("invalid_gateway_response", `${name} is missing`);
  return result;
}

function optionalMode(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !SAFE_MODE.test(value)) throw bridgeError("invalid_gateway_response", "Tunnel profile mode is invalid");
  return value;
}

function optionalGeneration(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw bridgeError("invalid_gateway_response", "Tunnel profile generation is invalid");
  return Number(value);
}

function safePublicUrl(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length < 1 || value.length > 2048) throw bridgeError("invalid_gateway_response", "Tunnel endpoint URL is invalid");
  let url: URL;
  try { url = new URL(value); }
  catch { throw bridgeError("invalid_gateway_response", "Tunnel endpoint URL is invalid"); }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw bridgeError("invalid_gateway_response", "Tunnel endpoint URL must be a credential-free HTTPS origin");
  }
  return url.origin;
}

function explicitEndpoint(value: Record<string, unknown>): { kind?: TunnelEndpointKind; url?: string } {
  const rawEndpoint = value.endpoint;
  const topLevelKind = typeof value.kind === "string" && ENDPOINT_KINDS.has(value.kind as TunnelEndpointKind) ? value.kind : undefined;
  let kindValue: unknown = value.endpointKind ?? value.endpointType ?? value.urlKind ?? topLevelKind;
  let urlValue: unknown = value.url ?? value.publicUrl;
  if (rawEndpoint && typeof rawEndpoint === "object" && !Array.isArray(rawEndpoint)) {
    const endpoint = rawEndpoint as Record<string, unknown>;
    kindValue ??= endpoint.kind ?? endpoint.type;
    urlValue ??= endpoint.url ?? endpoint.publicUrl;
  } else if (rawEndpoint !== undefined) {
    urlValue ??= rawEndpoint;
  }
  // Never project observed.endpoint. Provider runtime state may contain a
  // credential-bearing URL; only explicit sanitized config descriptors may
  // supply a public origin to the desktop UI.
  let kind: TunnelEndpointKind | undefined;
  if (kindValue !== undefined) {
    if (typeof kindValue !== "string" || !ENDPOINT_KINDS.has(kindValue as TunnelEndpointKind)) {
      throw bridgeError("invalid_gateway_response", "Tunnel endpoint kind is invalid");
    }
    kind = kindValue as TunnelEndpointKind;
  }
  return { ...(kind ? { kind } : {}), ...(urlValue === undefined ? {} : { url: safePublicUrl(urlValue)! }) };
}

function projectOne(value: unknown, fallbackProfileId?: string): TunnelProfileProjection {
  const item = record(value);
  const profileId = requiredId(item.profileId ?? item.profile ?? item.id ?? fallbackProfileId, "Tunnel profileId");
  const provider = optionalId(item.provider, "Tunnel provider");
  const mode = optionalMode(item.mode);
  const lifecycleValue = item.lifecycle;
  if (lifecycleValue !== undefined && lifecycleValue !== "persistent" && lifecycleValue !== "ephemeral") {
    throw bridgeError("invalid_gateway_response", "Tunnel profile lifecycle is invalid");
  }
  const lifecycle = lifecycleValue as TunnelProfileProjection["lifecycle"];
  if (item.enabled !== undefined && typeof item.enabled !== "boolean") throw bridgeError("invalid_gateway_response", "Tunnel profile enabled state is invalid");
  const enabled = item.enabled as boolean | undefined;
  const generation = optionalGeneration(item.generation);
  if (item.desiredState !== undefined && item.desiredState !== "stopped" && item.desiredState !== "running") {
    throw bridgeError("invalid_gateway_response", "Tunnel desired state is invalid");
  }
  const observed = item.observed && typeof item.observed === "object" && !Array.isArray(item.observed) ? item.observed as Record<string, unknown> : undefined;
  const phaseValue = item.phase ?? observed?.phase;
  if (phaseValue !== undefined && (typeof phaseValue !== "string" || !PHASES.has(phaseValue as TunnelProfileProjection["phase"]))) {
    throw bridgeError("invalid_gateway_response", "Tunnel phase is invalid");
  }
  const rawEndpoint = explicitEndpoint(item);
  const inferredKind: TunnelEndpointKind | undefined = rawEndpoint.kind
    ?? (lifecycle === "ephemeral" || mode === "quick" ? "ephemeral"
      : provider === "openai" || mode === "managed" || item.management === "managed" ? "managed"
        : rawEndpoint.url !== undefined || lifecycle === "persistent" ? "fixed" : undefined);
  const endpoint = inferredKind ? { kind: inferredKind, ...(rawEndpoint.url === undefined ? {} : { url: rawEndpoint.url }) } : undefined;
  return {
    profileId,
    ...(provider ? { provider } : {}),
    ...(mode ? { mode } : {}),
    ...(lifecycle ? { lifecycle } : {}),
    ...(enabled === undefined ? {} : { enabled }),
    ...(generation === undefined ? {} : { generation }),
    ...(item.desiredState === undefined ? {} : { desiredState: item.desiredState as "stopped" | "running" }),
    ...(phaseValue === undefined ? {} : { phase: phaseValue as NonNullable<TunnelProfileProjection["phase"]> }),
    ...(endpoint ? { endpoint } : {}),
  };
}

/**
 * Converts provider/CLI output to a small allowlisted DTO. No unrecognized
 * provider fields, process identity, argv, environment, or credential-bearing
 * endpoint can cross the bridge boundary.
 */
export function projectTunnelProfileResult(action: string, value: unknown, requestedProfileId?: string): unknown {
  if (action === "list") {
    const source = Array.isArray(value) ? value : record(value).profiles;
    if (!Array.isArray(source) || source.length > 64) throw bridgeError("invalid_gateway_response", "Tunnel profile list is invalid");
    return { profiles: source.map((item) => projectOne(item)) };
  }
  const item = record(value);
  if (action === "enable" || action === "disable") {
    if (item.enabled !== undefined && typeof item.enabled !== "boolean") throw bridgeError("invalid_gateway_response", "Tunnel profile enabled state is invalid");
    const profileId = requiredId(item.profileId ?? item.profile ?? requestedProfileId, "Tunnel profileId");
    const state = item.state === undefined ? undefined : projectOne(item.state, profileId);
    return { profileId, enabled: item.enabled ?? action === "enable", ...(state ? { state } : {}) };
  }
  return projectOne(item, requestedProfileId);
}
