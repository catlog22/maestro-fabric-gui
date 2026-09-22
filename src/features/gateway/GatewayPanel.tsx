import { useState } from "react";
import { desktopApi } from "../../lib/desktop-api";
import { useI18n } from "../../i18n";
import { Evidence } from "../common/Evidence";

interface Props { section: string; profileId?: string; onProfileSelect?: (profileId: string) => void; }
const lifecycle = ["status", "start", "stop", "restart"] as const;
const connector = ["connector.status", "connector.start", "connector.stop"] as const;

export function GatewayPanel({ section, profileId = "remote", onProfileSelect }: Props) {
  const { t } = useI18n();
  const [busy, setBusy] = useState<string>();
  const [result, setResult] = useState<unknown>();
  const [error, setError] = useState<string>();
  const [profileInput, setProfileInput] = useState(profileId);
  const [remoteUrl, setRemoteUrl] = useState("https://");
  const [credentialEnv, setCredentialEnv] = useState("MAESTRO_GATEWAY_TOKEN");
  const [workspace, setWorkspace] = useState("");

  async function control(action: string, payload: Record<string, unknown> = {}) {
    setBusy(action); setError(undefined);
    try { setResult(await desktopApi.gatewayControl(action, payload, 120_000)); }
    catch (value) { setError(typeof value === "string" ? value : value instanceof Error ? value.message : t("failed")); }
    finally { setBusy(undefined); }
  }
  async function connectRemote() {
    setBusy("connect"); setError(undefined);
    try { setResult(await desktopApi.connectGateway(profileInput, remoteUrl, Date.now(), credentialEnv || undefined)); onProfileSelect?.(profileInput); }
    catch (value) { setError(typeof value === "string" ? value : value instanceof Error ? value.message : t("failed")); }
    finally { setBusy(undefined); }
  }
  function onEnterConnect(event: React.KeyboardEvent) { if (event.key === "Enter" && busy === undefined) void connectRemote(); }

  if (section === "Gateway") return <Panel title={t("gatewayControls")} subtitle={t("gatewayControlsHint")}>
    <ActionRow actions={lifecycle} busy={busy} run={(action) => void control(action)} labels={{ status: t("status"), start: t("startGateway"), stop: t("stopGateway"), restart: t("restartGateway") }} />
    <h3>{t("currentProfile")}</h3>
    <div className="form-row"><label>{t("profileId")}<input value={profileInput} onChange={(event) => setProfileInput(event.target.value)} onKeyDown={onEnterConnect} placeholder="remote-eu" /></label><label>{t("gatewayUrl")}<input value={remoteUrl} onChange={(event) => setRemoteUrl(event.target.value)} onKeyDown={onEnterConnect} placeholder="https://host/mcp" /></label><label>{t("credentialRef")}<input value={credentialEnv} onChange={(event) => setCredentialEnv(event.target.value.toUpperCase())} onKeyDown={onEnterConnect} placeholder="MAESTRO_GATEWAY_TOKEN" /></label><button disabled={busy !== undefined} onClick={() => void connectRemote()}>{busy === "connect" ? t("working") : t("connect")}</button><button disabled={busy !== undefined} onClick={() => void control("status")}>{t("localStatus")}</button><button disabled={busy !== undefined} onClick={() => void desktopApi.listGatewayProfiles<unknown>().then(setResult).catch((value) => setError(value instanceof Error ? value.message : String(value)))}>{t("listProfiles")}</button><button disabled={busy !== undefined} onClick={() => void desktopApi.disconnectGateway(profileInput).then(setResult).catch((value) => setError(value instanceof Error ? value.message : String(value)))}>{t("disconnect")}</button></div>
    <Result result={result} error={error} />
  </Panel>;

  if (section === "Connectors") return <Panel title={t("connectorTitle")} subtitle={t("connectorHint")}>
    <ActionRow actions={connector} busy={busy} run={(action) => void control(action)} labels={{ "connector.status": t("status"), "connector.start": t("startGateway"), "connector.stop": t("stopGateway") }} />
    <Result result={result} error={error} />
  </Panel>;

  if (section === "Settings") return <Panel title={t("tunnelDiagnostics")} subtitle={t("diagnosticsHint")}>
    <ActionRow actions={["tunnel.status", "tunnel.doctor"]} busy={busy} run={(action) => void control(action)} labels={{ "tunnel.status": t("status"), "tunnel.doctor": t("inspect") }} />
    <Result result={result} error={error} />
  </Panel>;
  return null;
}

function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) { return <section className="panel"><div className="panel-heading"><div><h2>{title}</h2><p>{subtitle}</p></div></div>{children}</section>; }
function ActionRow({ actions, busy, run, labels }: { actions: readonly string[]; busy?: string; run(action: string): void; labels: Record<string, string> }) { const { t } = useI18n(); return <div className="action-row">{actions.map((action) => <button key={action} disabled={busy !== undefined} onClick={() => run(action)}>{busy === action ? t("working") : labels[action] ?? action.split(".").at(-1)}</button>)}</div>; }
function Result({ result, error }: { result: unknown; error?: string }) { const { t } = useI18n(); return error ? <div className="error-box" role="alert">{error}</div> : <Evidence result={result} summary={t("operationResult")} />; }
