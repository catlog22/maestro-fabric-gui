import { describe, expect, it } from "vitest";
import { parseFabricSnapshot, projectDesktop } from "./projection";
const snapshot={version:1,sourceId:"s",revision:2,capturedAt:10,truncated:false,itemCount:2,cursors:[{handle:"fabric:event",cursor:1}],connectors:[{connectorId:"c"}],devices:[{deviceId:"d"}],endpoints:[],routes:[]};
describe("projection",()=>{
  it("strictly parses bounded snapshots",()=>expect(parseFabricSnapshot(snapshot)?.devices).toHaveLength(1));
  it("rejects wrong version",()=>expect(parseFabricSnapshot({...snapshot,version:2})).toBeUndefined());
  it("does not invent online health",()=>expect(projectDesktop("p",{}).gateway).toBe("unknown"));
  it("projects supervised runtime state",()=>{
    expect(projectDesktop("local",{gateway:{status:"running"}}).gateway).toBe("ready");
    expect(projectDesktop("local",{gateway:{status:"stopped"}}).gateway).toBe("offline");
    expect(projectDesktop("local",{gateway:{status:"failed"}}).gateway).toBe("degraded");
  });
  it("counts only configured optional tunnels",()=>{
    expect(projectDesktop("local",{tunnel:{kind:"none"}}).tunnelCount).toBe(0);
    expect(projectDesktop("local",{tunnel:{kind:"openai-managed"}}).tunnelCount).toBe(1);
  });
});
