export type ProjectedHealth = "online" | "degraded" | "offline" | "disabled" | "unknown";
export interface FabricProjection { sourceId: string; revision: number; capturedAt: number; truncated: boolean; connectors: readonly Record<string, unknown>[]; devices: readonly Record<string, unknown>[]; endpoints: readonly Record<string, unknown>[]; routes: readonly Record<string, unknown>[]; }
export interface DesktopProjection { profileId: string; revision: number; gateway: "ready" | "degraded" | "offline" | "unknown"; workspaceCount: number; connectorCount: number; tunnelCount: number; fabric?: FabricProjection; }
const MAX_BYTES=64*1024; const kinds=["registry","lease","presence","invocation","event"];
function record(value:unknown):Record<string,unknown>|undefined{return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:undefined;}
function safe(value:unknown):number|undefined{return Number.isSafeInteger(value)&&Number(value)>=0?Number(value):undefined;}
export function parseFabricSnapshot(value:unknown):FabricProjection|undefined {
 const input=record(value); if(!input||input.version!==1)return undefined; let size=0; try{size=new TextEncoder().encode(JSON.stringify(value)).byteLength;}catch{return undefined;} if(size>MAX_BYTES)return undefined;
 const sourceId=input.sourceId; const revision=safe(input.revision); const capturedAt=safe(input.capturedAt); if(typeof sourceId!=="string"||revision===undefined||capturedAt===undefined||typeof input.truncated!=="boolean")return undefined;
 const rawArrays=[input.connectors,input.devices,input.endpoints,input.routes]; if(rawArrays.some(item=>!Array.isArray(item)))return undefined; const arrays=rawArrays as unknown[][];
 const cursors=input.cursors; if(!Array.isArray(cursors)||cursors.some(item=>{const cursor=record(item);return !cursor||typeof cursor.handle!=="string"||!kinds.some(kind=>cursor.handle===`fabric:${kind}`)||safe(cursor.cursor)===undefined;}))return undefined;
 const items=arrays.flat(); if(items.length>100||input.itemCount!==items.length)return undefined; const clean=arrays.map((items:unknown[])=>items.map((item:unknown)=>record(item)).filter((item):item is Record<string,unknown>=>item!==undefined));
 return{sourceId,revision,capturedAt,truncated:input.truncated,connectors:clean[0]!,devices:clean[1]!,endpoints:clean[2]!,routes:clean[3]!};
}
export function projectDesktop(profileId:string, input:{gateway?:unknown;workspaces?:unknown;fabric?:unknown}, revision=0):DesktopProjection{const fabric=parseFabricSnapshot(input.fabric);return{profileId,revision,gateway:input.gateway===undefined?"unknown":"ready",workspaceCount:Array.isArray(input.workspaces)?input.workspaces.length:0,connectorCount:fabric?.connectors.length??0,tunnelCount:0,fabric};}
