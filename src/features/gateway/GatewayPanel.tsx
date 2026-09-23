import { useEffect, useState } from "react";
import { desktopApi } from "../../lib/desktop-api";
import { useI18n } from "../../i18n";
import { defaultGatewayRuntimeConfig, type GatewayRuntimeConfig, type GatewayRuntimeState, type GatewayTunnelConfig } from "../../models/gateway";
import { Evidence } from "../common/Evidence";

interface Props {
  section: string;
  profileId?: string;
  onProfileSelect?: (profileId: string) => void;
  onRuntimeState?: (state: GatewayRuntimeState) => void;
}

export function GatewayPanel({ section, profileId = "local", onProfileSelect, onRuntimeState }: Props) {
  const { t } = useI18n();
  const [busy, setBusy] = useState<string>();
  const [result, setResult] = useState<unknown>();
  const [error, setError] = useState<string>();
  const [draft, setDraft] = useState<GatewayRuntimeConfig>(defaultGatewayRuntimeConfig);
  const [runtime, setRuntime] = useState<GatewayRuntimeState>();
  const [profileInput, setProfileInput] = useState(profileId === "local" ? "remote" : profileId);
  const [remoteUrl, setRemoteUrl] = useState("https://");
  const [credentialRef, setCredentialRef] = useState("gateway.remote");
  const [credentialImportPath, setCredentialImportPath] = useState("");
  const [deleteCredentialFile, setDeleteCredentialFile] = useState(false);

  async function refreshRuntime() {
    const [config, state] = await Promise.all([desktopApi.getGatewayRuntimeConfig(), desktopApi.getGatewayRuntimeState()]);
    setDraft(config); setRuntime(state); onRuntimeState?.(state);
  }
  useEffect(() => { if (section === "Gateway" || section === "Settings") void refreshRuntime().catch((value) => setError(message(value, t("failed")))); }, [section]);

  async function runRuntime(action: "save" | "start" | "stop" | "restart") {
    const activatesTunnel = draft.tunnel.kind !== "none" && (action === "start" || action === "restart" || (action === "save" && draft.desiredRunning));
    const actionLabel = action === "restart" ? t("restartGateway") : action === "save" ? t("saveConfiguration") : t("startGateway");
    if (activatesTunnel && !window.confirm(t("confirmGatewayTunnelAction").replace("{action}", actionLabel))) return;
    setBusy(action); setError(undefined);
    try {
      const state = action === "save"
        ? await desktopApi.saveGatewayRuntimeConfig(draft)
        : action === "start"
          ? await desktopApi.startGatewayRuntime()
          : action === "stop"
            ? await desktopApi.stopGatewayRuntime()
            : await desktopApi.restartGatewayRuntime();
      setRuntime(state); onRuntimeState?.(state); setResult(state);
    } catch (value) { setError(message(value, t("failed"))); }
    finally { setBusy(undefined); }
  }

  async function saveAndStart() {
    if (draft.tunnel.kind !== "none" && !window.confirm(t("confirmGatewayTunnelAction").replace("{action}", t("saveAndStart")))) return;
    setBusy("save-start"); setError(undefined);
    try {
      await desktopApi.saveGatewayRuntimeConfig({ ...draft, desiredRunning: true });
      const state = await desktopApi.startGatewayRuntime();
      setDraft((value) => ({ ...value, desiredRunning: true }));
      setRuntime(state); onRuntimeState?.(state); setResult(state);
    } catch (value) { setError(message(value, t("failed"))); }
    finally { setBusy(undefined); }
  }

  async function control(action: string, payload: Record<string, unknown> = {}) {
    const tunnelAction = action.startsWith("tunnel.profile.") ? action.slice("tunnel.profile.".length) : undefined;
    if (tunnelAction && tunnelAction !== "status" && !window.confirm(t("confirmTunnelAction").replace("{action}", tunnelActionLabel(tunnelAction, t)))) return;
    setBusy(action); setError(undefined);
    try { setResult(await desktopApi.gatewayControl(action, { ...payload, ...(runtime?.configPath ? { configPath: runtime.configPath } : {}) }, 120_000)); }
    catch (value) { setError(message(value, t("failed"))); }
    finally { setBusy(undefined); }
  }

  async function connectLocal() {
    if (!runtime || runtime.status !== "running") return;
    setBusy("connect-local"); setError(undefined);
    try {
      setResult(await desktopApi.connectGateway("local", runtime.httpUrl, Date.now(), runtime.localCredentialRef, "local"));
      onProfileSelect?.("local");
    } catch (value) { setError(message(value, t("failed"))); }
    finally { setBusy(undefined); }
  }

  async function importOpenAiCredentials() {
    if (draft.tunnel.kind !== "openai-managed" || !credentialImportPath.trim()) return;
    if (deleteCredentialFile && !window.confirm(t("confirmDeleteCredentialFile"))) return;
    setBusy("import-credentials"); setError(undefined);
    try {
      await desktopApi.importGatewayCredentials({
        path: credentialImportPath.trim(),
        tunnelIdCredentialRef: draft.tunnel.tunnelIdCredentialRef,
        runtimeKeyCredentialRef: draft.tunnel.runtimeKeyCredentialRef,
        deleteAfterImport: deleteCredentialFile,
      });
      setCredentialImportPath("");
      setDeleteCredentialFile(false);
      setResult({ imported: true, credentialRefs: [draft.tunnel.tunnelIdCredentialRef, draft.tunnel.runtimeKeyCredentialRef] });
    } catch (value) { setError(message(value, t("failed"))); }
    finally { setBusy(undefined); }
  }

  async function connectRemote() {
    setBusy("connect-remote"); setError(undefined);
    try {
      setResult(await desktopApi.connectGateway(profileInput, remoteUrl, Date.now(), credentialRef || undefined, "remote-http"));
      onProfileSelect?.(profileInput);
    } catch (value) { setError(message(value, t("failed"))); }
    finally { setBusy(undefined); }
  }

  if (section === "Gateway") return <>
    <Panel title={t("gatewayControls")} subtitle={t("gatewayControlsHint")}>
      <div className="gateway-actions">
        <button disabled={busy !== undefined} onClick={() => void runRuntime("save")}>{busy === "save" ? t("working") : t("saveConfiguration")}</button>
        <button className="primary-action" disabled={busy !== undefined} onClick={() => void saveAndStart()}>{busy === "save-start" ? t("working") : t("saveAndStart")}</button>
        <button disabled={busy !== undefined || runtime?.status === "stopped"} onClick={() => void runRuntime("stop")}>{t("stopGateway")}</button>
        <button disabled={busy !== undefined || runtime?.status !== "running"} onClick={() => void runRuntime("restart")}>{t("restartGateway")}</button>
        <button disabled={busy !== undefined} onClick={() => void refreshRuntime()}>{t("refresh")}</button>
      </div>
      <p className="runtime-summary"><strong>{t("directGateway")}</strong> · {runtimeStatusLabel(runtime?.status, t)} · {runtime?.httpUrl ?? `http://${draft.server.host}:${draft.server.port}/mcp`}</p>
      <div className="resource-form">
        <div className="form-row">
          <label>{t("listenHost")}<input value={draft.server.host} onChange={(event) => setDraft({ ...draft, server: { ...draft.server, host: event.target.value } })} /></label>
          <label>{t("listenPort")}<input type="number" min={1} max={65535} value={draft.server.port} onChange={(event) => setDraft({ ...draft, server: { ...draft.server, port: Number(event.target.value) } })} /></label>
          <label>{t("externalAccess")}<select value={draft.tunnel.kind} onChange={(event) => setDraft({ ...draft, tunnel: tunnelDefaults(event.target.value) })}><option value="none">{t("directOnly")}</option><option value="openai-managed">{t("providerOpenAiManaged")}</option><option value="cloudflare-quick">{t("providerCloudflareQuick")}</option><option value="cloudflare-named">{t("providerCloudflareNamed")}</option><option value="ssh-reverse">{t("providerSshReverse")}</option></select></label>
        </div>
        <TunnelEditor value={draft.tunnel} onChange={(tunnel) => setDraft({ ...draft, tunnel })} />
        {draft.tunnel.kind === "openai-managed" && <div className="form-row">
          <label>{t("credentialImportPath")}<input value={credentialImportPath} onChange={(event) => setCredentialImportPath(event.target.value)} placeholder="C:/secure/openai-tunnel.env" /></label>
          <label><input type="checkbox" checked={deleteCredentialFile} onChange={(event) => setDeleteCredentialFile(event.target.checked)} /> {t("deleteCredentialFile")}</label>
          <span className="field-hint">{t("deleteCredentialFileHint")}</span>
          <button disabled={busy !== undefined || credentialImportPath.trim() === ""} onClick={() => void importOpenAiCredentials()}>{busy === "import-credentials" ? t("working") : t("importCredentials")}</button>
        </div>}
      </div>
      <div className="action-row">
        <button disabled={busy !== undefined || runtime?.status !== "running"} onClick={() => void connectLocal()}>{t("connectLocal")}</button>
        <button disabled={busy !== undefined} onClick={() => void control("status")}>{t("localStatus")}</button>
      </div>
      <Result result={result} error={error} />
    </Panel>
    <Panel title={t("remoteGateway")} subtitle={t("remoteGatewayHint")}>
      <div className="form-row">
        <label>{t("profileId")}<input value={profileInput} onChange={(event) => setProfileInput(event.target.value)} placeholder="remote-eu" /></label>
        <label>{t("gatewayUrl")}<input value={remoteUrl} onChange={(event) => setRemoteUrl(event.target.value)} placeholder="https://host/mcp" /></label>
        <label>{t("credentialRef")}<input value={credentialRef} onChange={(event) => setCredentialRef(event.target.value)} placeholder="gateway.remote.eu" /></label>
        <button disabled={busy !== undefined} onClick={() => void connectRemote()}>{busy === "connect-remote" ? t("working") : t("connect")}</button>
        <button disabled={busy !== undefined} onClick={() => void desktopApi.listGatewayProfiles<unknown>().then(setResult).catch((value) => setError(message(value, t("failed"))))}>{t("listProfiles")}</button>
        <button disabled={busy !== undefined} onClick={() => void desktopApi.disconnectGateway(profileInput).then(setResult).catch((value) => setError(message(value, t("failed"))))}>{t("disconnect")}</button>
      </div>
    </Panel>
  </>;

  if (section === "Settings") {
    const tunnelProfile = draft.tunnel.kind === "none" ? undefined : draft.tunnel.profileId;
    return <Panel title={t("tunnelDiagnostics")} subtitle={t("diagnosticsHint")}>
      <ActionRow actions={["tunnel.doctor"]} busy={busy} run={(action) => void control(action)} labels={{ "tunnel.doctor": t("inspect") }} />
      {tunnelProfile && <div className="action-row">
        {(["status", "start", "stop", "restart"] as const).map((action) => <button key={action} disabled={busy !== undefined} onClick={() => void control(`tunnel.profile.${action}`, { profile: tunnelProfile })}>{busy === `tunnel.profile.${action}` ? t("working") : tunnelActionLabel(action, t)}</button>)}
      </div>}
      <Result result={result} error={error} />
    </Panel>;
  }
  return null;
}

function TunnelEditor({ value, onChange }: { value: GatewayTunnelConfig; onChange(value: GatewayTunnelConfig): void }) {
  const { t } = useI18n();
  if (value.kind === "none") return <p>{t("directOnlyHint")}</p>;
  const text = (key: string, next: string) => onChange({ ...value, [key]: next } as GatewayTunnelConfig);
  const number = (key: string, next: string) => onChange({ ...value, [key]: Number(next) } as GatewayTunnelConfig);
  return <div className="form-row">
    <label>{t("profileId")}<input value={value.profileId} onChange={(event) => text("profileId", event.target.value)} /></label>
    {value.kind === "openai-managed" && <>
      <label>{t("tunnelIdCredentialRef")}<input value={value.tunnelIdCredentialRef} onChange={(event) => text("tunnelIdCredentialRef", event.target.value)} /></label>
      <label>{t("runtimeKeyCredentialRef")}<input value={value.runtimeKeyCredentialRef} onChange={(event) => text("runtimeKeyCredentialRef", event.target.value)} /></label>
      <label>{t("credentialTtlMs")}<input type="number" min={60_000} max={3_600_000} value={value.credentialTtlMs} onChange={(event) => number("credentialTtlMs", event.target.value)} /></label>
      <label><input type="checkbox" checked={value.autoInstall} onChange={(event) => onChange({ ...value, autoInstall: event.target.checked })} /> {t("autoInstallClient")}</label>
    </>}
    {value.kind === "cloudflare-quick" && <label>{t("binaryPath")}<input value={value.binaryPath ?? ""} onChange={(event) => text("binaryPath", event.target.value)} /></label>}
    {value.kind === "cloudflare-named" && <>
      <label>{t("publicUrl")}<input value={value.publicUrl} onChange={(event) => text("publicUrl", event.target.value)} /></label>
      <label>{t("tunnelId")}<input value={value.tunnelId} onChange={(event) => text("tunnelId", event.target.value)} /></label>
      <label>{t("credentialsFile")}<input value={value.credentialsFile ?? ""} onChange={(event) => text("credentialsFile", event.target.value)} /></label>
      <label>{t("tokenFile")}<input value={value.tokenFile ?? ""} onChange={(event) => text("tokenFile", event.target.value)} /></label>
    </>}
    {value.kind === "ssh-reverse" && <>
      <label>{t("publicUrl")}<input value={value.publicUrl} onChange={(event) => text("publicUrl", event.target.value)} /></label>
      <label>{t("sshHost")}<input value={value.host} onChange={(event) => text("host", event.target.value)} /></label>
      <label>{t("sshUser")}<input value={value.user ?? ""} onChange={(event) => text("user", event.target.value)} /></label>
      <label>{t("sshPort")}<input type="number" value={value.port} onChange={(event) => number("port", event.target.value)} /></label>
      <label>{t("remotePort")}<input type="number" value={value.remotePort} onChange={(event) => number("remotePort", event.target.value)} /></label>
      <label>{t("identityFile")}<input value={value.identityFile ?? ""} onChange={(event) => text("identityFile", event.target.value)} /></label>
    </>}
  </div>;
}

function tunnelDefaults(kind: string): GatewayTunnelConfig {
  if (kind === "openai-managed") return { kind, profileId: "openai-managed", tunnelIdCredentialRef: "gateway.openai.tunnel-id", runtimeKeyCredentialRef: "gateway.openai.runtime-key", autoInstall: false, credentialTtlMs: 300_000 };
  if (kind === "cloudflare-quick") return { kind, profileId: "cloudflare-quick" };
  if (kind === "cloudflare-named") return { kind, profileId: "cloudflare-named", publicUrl: "https://", tunnelId: "" };
  if (kind === "ssh-reverse") return { kind, profileId: "ssh-reverse", publicUrl: "https://", host: "", port: 22, remotePort: 443 };
  return { kind: "none" };
}

type Translate = ReturnType<typeof useI18n>["t"];
function tunnelActionLabel(action: string, t: Translate): string {
  if (action === "status") return t("tunnelActionStatus");
  if (action === "start") return t("tunnelActionStart");
  if (action === "stop") return t("tunnelActionStop");
  return t("tunnelActionRestart");
}
function runtimeStatusLabel(status: GatewayRuntimeState["status"] | undefined, t: Translate): string {
  if (status === "running") return t("runtimeStatusRunning");
  if (status === "starting") return t("runtimeStatusStarting");
  if (status === "stopped") return t("runtimeStatusStopped");
  if (status === "failed") return t("runtimeStatusFailed");
  return t("runtimeStatusUnknown");
}
function message(value: unknown, fallback: string): string { return typeof value === "string" ? value : value instanceof Error ? value.message : fallback; }
function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) { return <section className="panel"><div className="panel-heading"><div><h2>{title}</h2><p>{subtitle}</p></div></div>{children}</section>; }
function ActionRow({ actions, busy, run, labels }: { actions: readonly string[]; busy?: string; run(action: string): void; labels: Record<string, string> }) { const { t } = useI18n(); return <div className="action-row">{actions.map((action) => <button key={action} disabled={busy !== undefined} onClick={() => run(action)}>{busy === action ? t("working") : labels[action] ?? action.split(".").at(-1)}</button>)}</div>; }
function Result({ result, error }: { result: unknown; error?: string }) { const { t } = useI18n(); return error ? <div className="error-box" role="alert">{error}</div> : <Evidence result={result} summary={t("operationResult")} />; }
