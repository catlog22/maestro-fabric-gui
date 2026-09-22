import test from "node:test";
import assert from "node:assert/strict";
import { gatewayControl } from "../dist/gateway-control.js";
import { validateGatewayUrl } from "../dist/mcp-client.js";

const calls=[]; const run=async(args,input)=>{calls.push({args,input}); return {ok:true};};
test("maps lifecycle to fixed service argv", async()=>{await gatewayControl("restart",{},undefined,run); assert.deepEqual(calls.pop().args,["service","restart","--json"]);});
test("keeps connector token out of argv", async()=>{await gatewayControl("connector.enroll",{hub:"https://hub.test",connectorId:"c1",deviceId:"d1",token:"secret"},undefined,run); const call=calls.pop(); assert.equal(call.args.includes("secret"),false); assert.equal(call.input,"secret\n");});
test("requires generations for destructive workspace actions", async()=>{await assert.rejects(()=>gatewayControl("workspace.remove",{target:"w"},undefined,run),/expectedGeneration/);});
test("maps pairing and tunnel profile actions to fixed argv", async()=>{await gatewayControl("pair.list",{},undefined,run); assert.deepEqual(calls.pop().args,["pair","list","--json"]); await gatewayControl("tunnel.profile.status",{profile:"cloudflare"},undefined,run); assert.deepEqual(calls.pop().args,["tunnel","profile","status","cloudflare","--json"]);});
test("rejects arbitrary local commands", async()=>{await assert.rejects(()=>gatewayControl("exec",{},undefined,run),/not allowed/);});
test("allows loopback HTTP and remote HTTPS",()=>{assert.equal(validateGatewayUrl("http://127.0.0.1:9090/mcp").protocol,"http:"); assert.equal(validateGatewayUrl("https://gateway.example/mcp").protocol,"https:");});
test("rejects insecure remote HTTP",()=>assert.throws(()=>validateGatewayUrl("http://gateway.example/mcp"),/require HTTPS/));
