import test from "node:test";
import assert from "node:assert/strict";
import { GATEWAY_ACTION_REGISTRY, gatewayToolNames, schemaAdvertisesAction } from "../dist/gateway-manifest.js";

test("contains every Gateway catalog tool", () => assert.deepEqual(gatewayToolNames().sort(), ["board","browser","device","endpoint","exec","file","handoff","host","job","maestro_cli","monitor","route","session","skill","teammate","todo","workspace"].sort()));
test("marks privileged operations", () => { assert.equal(GATEWAY_ACTION_REGISTRY.exec.run.risk, "privileged"); assert.equal(GATEWAY_ACTION_REGISTRY.browser.run.risk, "privileged"); assert.equal(GATEWAY_ACTION_REGISTRY.file.write.risk, "destructive"); });
test("requires advertised oneOf action schema", () => assert.equal(schemaAdvertisesAction({ oneOf: [{ properties: { action: { const: "list" } } }] }, "list"), true));
test("rejects an unadvertised action", () => assert.equal(schemaAdvertisesAction({ oneOf: [{ properties: { action: { const: "list" } } }] }, "write"), false));
