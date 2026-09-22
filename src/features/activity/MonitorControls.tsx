import { useEffect, useState } from "react";
import { desktopApi } from "../../lib/desktop-api";
import { useI18n } from "../../i18n";
import type { MonitorEvent } from "../../state/monitor-state";

interface Props { profileId: string; cursor: number; onEvents(events: readonly MonitorEvent[], dropped: number): void; onSnapshot(value: unknown): void; }
export function MonitorControls({ profileId, cursor, onEvents, onSnapshot }: Props) {
 const { t } = useI18n();
 const [sessionId,setSessionId]=useState(""); const [memberId,setMemberId]=useState(""); const [handle,setHandle]=useState("fabric:event"); const [subscriptionId,setSubscriptionId]=useState<string>(); const [error,setError]=useState<string>();
 useEffect(()=>{ if(!subscriptionId) return; const timer=window.setInterval(()=>{ void desktopApi.drainGatewayEvents<{events:MonitorEvent[];dropped:number}>(profileId,100).then((value)=>onEvents(value.events,value.dropped)).catch(()=>undefined); },750); return()=>window.clearInterval(timer); },[profileId,subscriptionId,onEvents]);
 async function subscribe(){ setError(undefined); try { const value=await desktopApi.callGateway<{ok:boolean;data?:{subscriptionId?:string}}>(profileId,"monitor",{action:"subscribe",sessionId,memberId,handle,cursor}); if(!value.ok||!value.data?.subscriptionId) throw new Error("Gateway rejected the monitor subscription"); setSubscriptionId(value.data.subscriptionId); } catch(value){setError(value instanceof Error?value.message:String(value));} }
 async function resync(){ setError(undefined); try { const value=await desktopApi.callGateway(profileId,"monitor",{action:"observe",sessionId,memberId,handle,cursor,limit:100}); onSnapshot(value); } catch(value){setError(value instanceof Error?value.message:String(value));} }
 async function unsubscribe(){ if(!subscriptionId)return; try { await desktopApi.callGateway(profileId,"monitor",{action:"unsubscribe",sessionId,memberId,subscriptionId}); } catch(value){setError(value instanceof Error?value.message:String(value));} finally { setSubscriptionId(undefined); } }
 const idsMissing=!sessionId||!memberId;
 function onEnterSubscribe(event:React.KeyboardEvent){ if(event.key==="Enter"&&!idsMissing&&!subscriptionId)void subscribe(); }
 return <section className="monitor-controls"><details><summary>{subscriptionId ? t("monitoringRunning") : t("monitoringStopped")}</summary><div className="resource-form"><label>{t("sessionId")}<input value={sessionId} onChange={e=>setSessionId(e.target.value)} onKeyDown={onEnterSubscribe}/></label><label>{t("memberId")}<input value={memberId} onChange={e=>setMemberId(e.target.value)} onKeyDown={onEnterSubscribe}/></label><label>{t("eventHandle")}<input value={handle} onChange={e=>setHandle(e.target.value)} onKeyDown={onEnterSubscribe}/></label></div></details><div className="action-row"><button className="primary-action" disabled={idsMissing||Boolean(subscriptionId)} title={idsMissing?t("monitorIdsRequired"):undefined} onClick={()=>void subscribe()}>{t("startMonitoring")}</button><button disabled={!subscriptionId} onClick={()=>void unsubscribe()}>{t("stopMonitoring")}</button><button disabled={idsMissing} title={idsMissing?t("monitorIdsRequired"):undefined} onClick={()=>void resync()}>{t("resync")}</button></div>{error&&<div className="error-box" role="alert">{error}</div>}</section>;
}
