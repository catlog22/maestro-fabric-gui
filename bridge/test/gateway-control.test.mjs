import test from "node:test";
import assert from "node:assert/strict";
import { gatewayControl, MINIMUM_GATEWAY_VERSION, probeGatewayCompatibility } from "../dist/gateway-control.js";
import { connectProfile, validateGatewayUrl } from "../dist/mcp-client.js";

function runner(result = { ok: true }) {
  const calls = [];
  return { calls, run: async (args, input) => { calls.push({ args: [...args], input }); return typeof result === "function" ? result(args) : result; } };
}

test("maps lifecycle and validated configPath to fixed service argv", async () => {
  const { calls, run } = runner();
  await gatewayControl("restart", { configPath: "/secure/gateway.yaml" }, undefined, run);
  assert.deepEqual(calls[0].args, ["service", "restart", "--config", "/secure/gateway.yaml", "--json"]);
  await assert.rejects(() => gatewayControl("status", { configPath: "relative.yaml" }, undefined, run), /absolute path/);
});

test("maps service persistence only to documented install and ensure flags", async () => {
  const { calls, run } = runner();
  await gatewayControl("install", { persistence: "windows-startup" }, undefined, run);
  await gatewayControl("ensure", { persistence: "detached-fallback" }, undefined, run);
  await gatewayControl("uninstall", {}, undefined, run);
  assert.deepEqual(calls.map((call) => call.args), [
    ["service", "install", "--windows-startup", "--json"],
    ["service", "ensure", "--detached-fallback", "--json"],
    ["service", "uninstall", "--json"],
  ]);
  await assert.rejects(() => gatewayControl("status", { persistence: "windows-startup" }, undefined, run), /only for service install or ensure/);
  await assert.rejects(() => gatewayControl("install", { persistence: "forever" }, undefined, run), /windows-startup or detached-fallback/);
});

test("does not expose connector lifecycle as a supported bridge path", async () => {
  const { calls, run } = runner();
  for (const action of ["connector.status", "connector.start", "connector.stop"]) {
    await assert.rejects(() => gatewayControl(action, { configPath: "/secure/gateway.yaml" }, undefined, run), /not allowed/);
  }
  assert.equal(calls.length, 0);
});

test("keeps pairing tokens out of the bridge and binds safe pair operations to config", async () => {
  const { calls, run } = runner();
  await assert.rejects(() => gatewayControl("pair.create", { configPath: "/secure/gateway.yaml" }, undefined, run), /cannot cross the desktop bridge boundary/);
  await assert.rejects(() => gatewayControl("pair.bootstrap", { configPath: "/secure/gateway.yaml" }, undefined, run), /cannot cross the desktop bridge boundary/);
  await gatewayControl("pair.list", { configPath: "/secure/gateway.yaml" }, undefined, run);
  assert.deepEqual(calls.pop().args, ["pair", "list", "--config", "/secure/gateway.yaml", "--json"]);
  await gatewayControl("pair.revoke", { id: "pair-1", configPath: "/secure/gateway.yaml" }, undefined, run);
  assert.deepEqual(calls.pop().args, ["pair", "revoke", "pair-1", "--config", "/secure/gateway.yaml", "--json"]);
});

test("requires generations for destructive workspace actions and appends config", async () => {
  const { calls, run } = runner();
  await assert.rejects(() => gatewayControl("workspace.remove", { target: "w" }, undefined, run), /expectedGeneration/);
  await gatewayControl("workspace.remove", { target: "w", expectedGeneration: 3, configPath: "/secure/gateway.yaml" }, undefined, run);
  assert.deepEqual(calls.pop().args, ["workspace", "remove", "w", "--generation", "3", "--config", "/secure/gateway.yaml", "--json"]);
});

test("maps tunnel profile actions and returns an allowlisted projection", async () => {
  const raw = [
    { id: "openai-prod", provider: "openai", mode: "secure", lifecycle: "persistent", enabled: true, tunnelIdEnv: "SECRET_REF" },
    { id: "fixed", provider: "cloudflare", mode: "named", lifecycle: "persistent", enabled: false, publicUrl: "https://fixed.example", tokenFile: "C:/secret" },
    { id: "quick", provider: "cloudflare", mode: "quick", lifecycle: "ephemeral", enabled: false },
  ];
  const { calls, run } = runner(raw);
  const result = await gatewayControl("tunnel.profile.list", { configPath: "/secure/gateway.yaml" }, undefined, run);
  assert.deepEqual(calls.pop().args, ["tunnel", "profile", "list", "--config", "/secure/gateway.yaml", "--json"]);
  assert.deepEqual(result, { profiles: [
    { profileId: "openai-prod", provider: "openai", mode: "secure", lifecycle: "persistent", enabled: true, endpoint: { kind: "managed" } },
    { profileId: "fixed", provider: "cloudflare", mode: "named", lifecycle: "persistent", enabled: false, endpoint: { kind: "fixed", url: "https://fixed.example" } },
    { profileId: "quick", provider: "cloudflare", mode: "quick", lifecycle: "ephemeral", enabled: false, endpoint: { kind: "ephemeral" } },
  ] });
  assert.doesNotMatch(JSON.stringify(result), /SECRET_REF|tokenFile|secret/);
});

test("drops observed provider endpoints instead of returning credential-bearing runtime data", async () => {
  for (const endpoint of ["https://user:secret@example.test", "https://example.test/secret-token", "https://example.test?token=secret"]) {
    const { run } = runner({ provider: "cloudflare", generation: 2, observed: { phase: "ready", endpoint } });
    const result = await gatewayControl("tunnel.profile.status", { profileId: "quick" }, undefined, run);
    assert.deepEqual(result, { profileId: "quick", provider: "cloudflare", generation: 2, phase: "ready" });
    assert.doesNotMatch(JSON.stringify(result), /secret|token|example\.test/);
  }
});

test("projects profile status with profileId and generation vocabulary", async () => {
  const { calls, run } = runner({ provider: "cloudflare", generation: 2, desiredState: "running", observed: { phase: "ready", endpoint: "https://quick.trycloudflare.com" }, pid: 123, ownerToken: "secret" });
  const result = await gatewayControl("tunnel.profile.status", { profileId: "quick", timeoutMs: 5000, configPath: "/secure/gateway.yaml" }, undefined, run);
  assert.deepEqual(calls.pop().args, ["tunnel", "profile", "status", "quick", "--timeout-ms", "5000", "--config", "/secure/gateway.yaml", "--json"]);
  assert.deepEqual(result, { profileId: "quick", provider: "cloudflare", generation: 2, desiredState: "running", phase: "ready" });
  assert.doesNotMatch(JSON.stringify(result), /ownerToken|pid|secret/);
});

test("uses the fixed version probe and reports minimum compatibility", async () => {
  const { calls, run } = runner({ name: "pi-maestro-gateway", version: MINIMUM_GATEWAY_VERSION, protocolVersion: 1 });
  assert.deepEqual(await probeGatewayCompatibility(undefined, run), { available: true, version: MINIMUM_GATEWAY_VERSION, minimumVersion: MINIMUM_GATEWAY_VERSION, compatible: true, protocolVersion: 1 });
  assert.deepEqual(calls[0].args, ["version", "--json"]);
  const older = await probeGatewayCompatibility(undefined, async () => ({ version: "0.30.9" }));
  assert.equal(older.compatible, false);
});

test("rejects arbitrary and legacy provider-level lifecycle commands", async () => {
  const { calls, run } = runner();
  await assert.rejects(() => gatewayControl("exec", {}, undefined, run), /not allowed/);
  for (const action of ["tunnel.status", "tunnel.start", "tunnel.stop", "tunnel.restart"]) {
    await assert.rejects(() => gatewayControl(action, {}, undefined, run), /configured tunnel\.profile/);
  }
  await gatewayControl("tunnel.doctor", { configPath: "/secure/gateway.yaml" }, undefined, run);
  assert.deepEqual(calls[0].args, ["tunnel", "doctor", "--config", "/secure/gateway.yaml", "--json"]);
});

test("enforces the local and remote Gateway URL matrix", () => {
  for (const value of ["http://127.0.0.1:9090/mcp", "http://127.2.3.4:9090/mcp", "http://localhost:9090/mcp", "http://[::1]:9090/mcp"]) {
    assert.equal(validateGatewayUrl(value).protocol, "http:");
  }
  assert.equal(validateGatewayUrl("https://gateway.example/mcp").protocol, "https:");
  for (const value of ["http://gateway.example/mcp", "http://192.168.1.2/mcp", "ftp://gateway.example/mcp"]) {
    assert.throws(() => validateGatewayUrl(value), /require HTTPS/);
  }
  assert.throws(() => validateGatewayUrl("https://user:secret@gateway.example/mcp"), /must not contain credentials/);
  assert.throws(() => validateGatewayUrl("https://gateway.example/mcp?token=secret"), /query parameters/);
});

test("rejects fake stdio and mismatched profile connection kinds before connecting", async () => {
  await assert.rejects(() => connectProfile({ profileId: "p", kind: "stdio", url: "https://gateway.example/mcp", generation: 1 }), /not implemented/);
  await assert.rejects(() => connectProfile({ profileId: "p", kind: "local", url: "https://gateway.example/mcp", generation: 1 }), /loopback/);
  await assert.rejects(() => connectProfile({ profileId: "p", kind: "remote-http", url: "http://127.0.0.1:9090/mcp", generation: 1 }), /non-loopback/);
});
