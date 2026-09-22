import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { bridgeError } from "./protocol.js";
import { describeGatewayAction, gatewayToolNames, GATEWAY_ACTION_REGISTRY, schemaAdvertisesAction, type GatewayToolManifestEntry } from "./gateway-manifest.js";

export interface BufferedGatewayEvent { method: string; params: Readonly<Record<string, unknown>>; receivedAt: number; }
interface Session { client: Client; transport: StreamableHTTPClientTransport; url: string; generation: number; events: BufferedGatewayEvent[]; dropped: number; manifest: ReadonlyMap<string, GatewayToolManifestEntry>; }
const sessions = new Map<string, Session>();
const profiles = new Map<string, { profileId: string; kind: "local" | "remote-http" | "stdio"; url: string; generation: number; status: "connected" | "disconnected" | "revoked" | "protocol-mismatch" }>();
const MAX_BUFFERED_EVENTS = 512;

export function validateGatewayUrl(value: unknown): URL {
  if (typeof value !== "string") throw bridgeError("invalid_request", "Gateway URL is required");
  let url: URL; try { url = new URL(value); } catch { throw bridgeError("invalid_request", "Gateway URL is invalid"); }
  const local = url.hostname === "localhost" || url.hostname.endsWith(".localhost") || url.hostname === "127.0.0.1" || url.hostname === "[::1]" || url.hostname === "::1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) throw bridgeError("insecure_gateway_url", "Remote Gateway connections require HTTPS");
  if (url.username || url.password || url.hash) throw bridgeError("invalid_request", "Gateway URL must not contain credentials or fragments");
  return url;
}
function profileId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) throw bridgeError("invalid_request", "profileId is invalid");
  return value;
}
export async function connectProfile(payload: Readonly<Record<string, unknown>>): Promise<unknown> {
  const id = profileId(payload.profileId); const url = validateGatewayUrl(payload.url);
  const credentialEnv = payload.credentialEnv;
  const credentialRef = payload.credentialRef;
  if (credentialEnv !== undefined && (typeof credentialEnv !== "string" || !/^[A-Z][A-Z0-9_]{0,127}$/.test(credentialEnv))) throw bridgeError("invalid_request", "Credential reference is invalid");
  if (credentialRef !== undefined && (typeof credentialRef !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(credentialRef))) throw bridgeError("invalid_request", "Credential reference is invalid");
  const token = typeof payload.token === "string" ? payload.token : typeof credentialEnv === "string" ? process.env[credentialEnv] : undefined;
  if (payload.token !== undefined && (typeof payload.token !== "string" || payload.token.length > 8192)) throw bridgeError("invalid_request", "Credential is invalid");
  if (credentialEnv !== undefined && !token) throw bridgeError("credential_unavailable", "The referenced Gateway credential is unavailable", true);
  await disconnectProfile({ profileId: id });
  const client = new Client({ name: "maestro-fabric-gui", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(url, { requestInit: token ? { headers: { authorization: `Bearer ${token}` } } : undefined });
  const events: BufferedGatewayEvent[] = [];
  const session: Session = { client, transport, url: url.href, generation: Number(payload.generation ?? 1), events, dropped: 0, manifest: new Map() };
  client.fallbackNotificationHandler = async (notification) => {
    if (notification.method !== "notifications/gateway/event") return;
    const params = notification.params;
    if (!params || typeof params !== "object" || Array.isArray(params)) return;
    if (events.length >= MAX_BUFFERED_EVENTS) { events.shift(); session.dropped += 1; }
    events.push({ method: notification.method, params: params as Record<string, unknown>, receivedAt: Date.now() });
  };
  await client.connect(transport);
  const tools = await client.listTools();
  const manifest = new Map<string, GatewayToolManifestEntry>();
  for (const tool of tools.tools) {
    const actions = Object.fromEntries(Object.entries(GATEWAY_ACTION_REGISTRY[tool.name] ?? {}).filter(([action]) => schemaAdvertisesAction(tool.inputSchema, action)));
    if (Object.keys(actions).length > 0) manifest.set(tool.name, { name: tool.name, ...(tool.description ? { description: tool.description } : {}), inputSchema: tool.inputSchema as Record<string, unknown>, ...(tool.annotations ? { annotations: tool.annotations as Record<string, unknown> } : {}), requiredCapabilities: [], actions });
  }
  const generation = session.generation; session.manifest = manifest; sessions.set(id, session);
  const kind = payload.kind === "stdio" ? "stdio" : payload.kind === "local" ? "local" : "remote-http";
  profiles.set(id, { profileId: id, kind, url: url.href, generation, status: "connected" });
  return { profileId: id, url: url.href, generation, protocolVersion: 1, tools: [...manifest.keys()], missingTools: gatewayToolNames().filter((name) => !manifest.has(name)), manifest: [...manifest.values()], connected: true, monitorStream: Boolean(client.getServerCapabilities()?.experimental?.["monitor-stream-v1"]) };
}
export async function disconnectProfile(payload: Readonly<Record<string, unknown>>): Promise<unknown> {
  const id = profileId(payload.profileId); const session = sessions.get(id); sessions.delete(id); if (session) await session.client.close(); const profile = profiles.get(id); if (profile) profiles.set(id, { ...profile, status: "disconnected", generation: profile.generation + 1 }); return { profileId: id, connected: false };
}
export function listProfiles(): unknown { return { profiles: [...profiles.values()].map((profile) => ({ ...profile, connected: sessions.has(profile.profileId) })) }; }
export function drainGatewayEvents(payload: Readonly<Record<string, unknown>>): unknown {
  const id = profileId(payload.profileId); const session = sessions.get(id); if (!session) throw bridgeError("profile_disconnected", "Gateway profile is not connected", true);
  const limit = Number(payload.limit ?? 100); if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw bridgeError("invalid_request", "Event drain limit is invalid");
  const events = session.events.splice(0, limit); const dropped = session.dropped; session.dropped = 0;
  return { profileId: id, generation: session.generation, events, dropped, remaining: session.events.length };
}
export async function callGatewayTool(payload: Readonly<Record<string, unknown>>): Promise<unknown> {
  const id = profileId(payload.profileId); const session = sessions.get(id); if (!session) throw bridgeError("profile_disconnected", "Gateway profile is not connected", true);
  const tool = payload.tool; if (typeof tool !== "string" || !gatewayToolNames().includes(tool)) throw bridgeError("unsupported_action", "Gateway tool is not allowed");
  const args = payload.arguments; if (!args || typeof args !== "object" || Array.isArray(args)) throw bridgeError("invalid_request", "Tool arguments are invalid");
  const action = (args as Record<string, unknown>).action;
  if (typeof action !== "string") throw bridgeError("invalid_request", "Gateway action is required");
  const descriptor = describeGatewayAction(tool, action);
  const advertised = session.manifest.get(tool);
  if (!descriptor || !advertised || !advertised.actions[action] || !schemaAdvertisesAction(advertised.inputSchema, action)) throw bridgeError("unsupported_action", "Gateway tool action is not available or schema-compatible");
  const result = await session.client.callTool({ name: tool, arguments: args as Record<string, unknown> });
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) throw bridgeError("invalid_gateway_response", "Gateway returned no content");
  const block = content[0] as { type?: unknown; text?: unknown } | undefined;
  if (!block || block.type !== "text" || typeof block.text !== "string") throw bridgeError("invalid_gateway_response", "Gateway returned no JSON result");
  try { return JSON.parse(block.text); } catch { throw bridgeError("invalid_gateway_response", "Gateway returned invalid JSON"); }
}
