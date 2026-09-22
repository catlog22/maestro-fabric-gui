import { describe, expect, it } from "vitest";
import { initialMonitorState, markResynchronized, reduceMonitor, sanitizeActivity } from "./monitor-state";
const event=(cursor:number,kind="state",payload:unknown={ok:true})=>({method:"notifications/gateway/event",receivedAt:1000,params:{cursor,eventId:`e${cursor}`,kind,payload}});
describe("monitor reducer",()=>{
 it("keeps cursors monotonic",()=>expect(reduceMonitor({ ...initialMonitorState,cursor:2 },[event(1),event(3)]).cursor).toBe(3));
 it("marks a durable gap degraded",()=>expect(reduceMonitor(initialMonitorState,[event(1,"gap",{reason:"slow-consumer"})])).toMatchObject({degraded:true,gap:"slow-consumer"}));
 it("marks local overflow degraded",()=>expect(reduceMonitor(initialMonitorState,[],2)).toMatchObject({degraded:true,gap:"local-overflow"}));
 it("clears degraded only after explicit resync",()=>expect(markResynchronized({ ...initialMonitorState,degraded:true,gap:"revoked" })).toMatchObject({degraded:false,gap:undefined}));
 it("redacts secrets",()=>expect(sanitizeActivity("Bearer secret token=abc proof=xyz")).toBe("[redacted] [redacted] [redacted]"));
 it("bounds retained activity",()=>expect(reduceMonitor(initialMonitorState,Array.from({length:240},(_,i)=>event(i+1))).activity).toHaveLength(200));
});
