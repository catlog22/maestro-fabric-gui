import type { DesktopState } from "../../models/desktop";
import type { DesktopProjection } from "../../models/projection";
import { useI18n } from "../../i18n";

interface Props {
  state: DesktopState;
  projection: DesktopProjection;
  gatewayBusy?: string;
  gatewayError?: string;
  onGatewayAction(action: string): Promise<void>;
  onNavigate(section: string): void;
}

export function Dashboard({ state, projection, gatewayBusy, gatewayError, onGatewayAction, onNavigate }: Props) {
  const { t } = useI18n();
  const gatewayLabel = projection.gateway === "ready" ? t("gatewayOnline") : projection.gateway === "offline" ? t("gatewayOffline") : projection.gateway === "degraded" ? t("gatewayDegraded") : t("gatewayUnknown");
  const fabric = projection.fabric;
  return <>
    <section className="hero-panel">
      <div>
        <p className="eyebrow">{t("gatewayConsole")}</p>
        <h2>{gatewayLabel}</h2>
        <p>{t("currentProfile")}: <strong>{projection.profileId}</strong> · {projection.workspaceCount} {t("workspaceCount").toLowerCase()}</p>
      </div>
      <div className="gateway-actions" aria-label={t("gatewayControls")}>
        <button className="primary-action" disabled={gatewayBusy !== undefined} onClick={() => void onGatewayAction("start")}>{gatewayBusy === "start" ? t("working") : t("startGateway")}</button>
        <button disabled={gatewayBusy !== undefined} onClick={() => void onGatewayAction("stop")}>{gatewayBusy === "stop" ? t("working") : t("stopGateway")}</button>
        <button disabled={gatewayBusy !== undefined} onClick={() => void onGatewayAction("restart")}>{gatewayBusy === "restart" ? t("working") : t("restartGateway")}</button>
      </div>
      {gatewayError && <div className="error-box" role="alert">{gatewayError}</div>}
    </section>

    <section className="console-cards" aria-label={t("gatewayConsole")}>
      <button className="console-card" onClick={() => onNavigate("Gateway")}><span className="card-icon">↯</span><strong>{t("gatewayControls")}</strong><span>{t("gatewayControlsHint")}</span><b>→</b></button>
      <button className="console-card" onClick={() => onNavigate("Activity")}><span className="card-icon">≋</span><strong>{t("liveLogs")}</strong><span>{t("logHint")}</span><b>→</b></button>
      <button className="console-card" onClick={() => onNavigate("Workspaces")}><span className="card-icon">▦</span><strong>{t("workspaces")}</strong><span>{t("registeredWorkspaceHint")}</span><b>→</b></button>
    </section>

    <section className="dashboard-grid compact-metrics">
      <article className="metric primary"><span>{t("desktopReady")}</span><strong>{state.readiness}</strong><small>{state.bridge ? `Protocol v${state.bridge.protocolVersion}` : t("desktopUnavailable")}</small></article>
      <article className="metric"><span>{t("workspaceCount")}</span><strong>{projection.workspaceCount}</strong><small>{t("registered")}</small></article>
      <article className="metric"><span>{t("liveLogs")}</span><strong>{projection.gateway === "ready" ? t("gatewayOnline") : t("gatewayOffline")}</strong><small>{projection.profileId}</small></article>
      <article className="metric"><span>Fabric</span><strong>{fabric?.devices.length ?? "—"}</strong><small>{fabric ? `${fabric.endpoints.length} endpoints · ${fabric.routes.length} routes` : "No snapshot"}</small></article>
    </section>
  </>;
}
