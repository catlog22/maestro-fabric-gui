import { useState } from "react";
import { desktopApi } from "../../lib/desktop-api";

const definitions = {
 Board:{actions:["list","get","search","create","update","claim","release","renew","takeover","handoff","transition","bind-session","link-plan"],fields:["taskId","query","title","sessionId"]},
 Host:{actions:["describe","status","test"],fields:[]},
 Exec:{actions:["run"],fields:["command"]},
 Jobs:{tool:"job",actions:["start","list","status","logs","stdin","cancel"],fields:["id","command","data"]},
 Files:{tool:"file",actions:["list","stat","read","write","edit","find","grep","transfer","realpath"],fields:["path","query","content"]},
 Sessions:{tool:"session",actions:["create","list","get","join","renew","leave","close","start-pi"],fields:["sessionId","memberId","ownerId","prompt"]},
 Todos:{tool:"todo",actions:["create","update","list","get","delete","claim","release","advance"],fields:["todoId","subject","description"]},
 Teammates:{tool:"teammate",actions:["start","list","observe","wait","send","cancel","result"],fields:["taskId","message","prompt"]},
 Handoffs:{tool:"handoff",actions:["list","get","search"],fields:["query"]},
 Skills:{tool:"skill",actions:["list","load"],fields:["query"]},
 Knowledge:{tool:"maestro_cli",actions:["search","load","stage"],fields:["query","content"]},
 Browser:{tool:"browser",actions:["guide","status","pair","open","run","close"],fields:["name","url","code"]},
} as const;
type Section=keyof typeof definitions;
const highRisk=new Set(["run","write","edit","transfer","start","stdin","cancel","delete","stage","open","close","takeover"]);
export function GatewayToolsPanel({ section, profileId, workspaceId }: { section: string; profileId: string; workspaceId?: string }) {
 const definition=definitions[section as Section]; const [values,setValues]=useState<Record<string,string>>({}); const [busy,setBusy]=useState<string>(); const [result,setResult]=useState<unknown>(); const [error,setError]=useState<string>(); if(!definition)return null; const tool="tool" in definition ? definition.tool : section.toLowerCase();
 const set=(key:string,value:string)=>setValues(current=>({...current,[key]:value}));
 async function run(action:string){if(highRisk.has(action)&&!window.confirm(`Confirm ${tool}.${action}?`))return;setBusy(action);setError(undefined);try{const args:Record<string,unknown>={action,...Object.fromEntries(Object.entries(values).filter(([,value])=>value.length>0)),...(workspaceId?{workspaceId}:{} )};setResult(await desktopApi.callGateway(profileId,tool,args));}catch(value){setError(value instanceof Error?value.message:String(value));}finally{setBusy(undefined);}}
 return <section className="panel"><div className="panel-heading"><div><h2>{section}</h2><p>Typed Gateway actions scoped to profile {profileId}{workspaceId?` and workspace ${workspaceId}`:""}.</p></div></div><div className="resource-form">{definition.fields.map(field=><label key={field}>{field}<input value={values[field]??""} onChange={event=>set(field,event.target.value)} autoComplete="off"/></label>)}</div><div className="action-row">{definition.actions.map(action=><button key={action} disabled={busy!==undefined} onClick={()=>void run(action)}>{busy===action?"Working…":action}</button>)}</div>{error&&<div className="error-box" role="alert">{error}</div>}{result!==undefined&&<details className="evidence" open><summary>Gateway response</summary><pre>{JSON.stringify(result,null,2)}</pre></details>}</section>;
}
