import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityPanel } from "./features/activity/ActivityPanel";
import { MonitorControls } from "./features/activity/MonitorControls";
import { Dashboard } from "./features/dashboard/Dashboard";
import { FabricPanel } from "./features/fabric/FabricPanel";
import { GatewayPanel } from "./features/gateway/GatewayPanel";
import { GatewayToolsPanel } from "./features/gateway/GatewayToolsPanel";
import { WorkspaceTopologyPanel } from "./features/workspace/WorkspaceTopologyPanel";
import { desktopApi } from "./lib/desktop-api";
import { LocaleProvider, messages, type Locale } from "./i18n";
import { acceptNewerState, initialDesktopState } from "./state/desktop-state";
import type { DesktopState } from "./models/desktop";
import type { GatewayRuntimeState } from "./models/gateway";
import { projectDesktop, type DesktopProjection } from "./models/projection";
import { initialMonitorState, markResynchronized, reduceMonitor, type MonitorEvent } from "./state/monitor-state";
import "./styles/app.css";

const advancedSections = ["Board", "Host", "Exec", "Jobs", "Files", "Sessions", "Todos", "Teammates", "Handoffs", "Skills", "Knowledge", "Browser", "Devices", "Endpoints", "Routes", "Settings"];

export function App() {
  const [state, setState] = useState<DesktopState>(initialDesktopState);
  const [section, setSection] = useState("Overview");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [selectedProfileId, setSelectedProfileId] = useState("local");
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>();
  const [runtimeState, setRuntimeState] = useState<GatewayRuntimeState>();
  const [monitor, setMonitor] = useState(initialMonitorState);
  const [projection, setProjection] = useState<DesktopProjection>(() => projectDesktop(selectedProfileId, {}));
  const [locale, setLocale] = useState<Locale>(() => navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en");
  const [theme, setTheme] = useState<"system" | "light" | "dark">("system");
  const [gatewayBusy, setGatewayBusy] = useState<string>();
  const [gatewayError, setGatewayError] = useState<string>();
  const { t } = useI18nSafe(locale);

  const acceptEvents = useCallback((events: readonly MonitorEvent[], dropped: number) => setMonitor((value) => reduceMonitor(value, events, dropped)), []);
  const acceptSnapshot = useCallback((snapshot: unknown) => {
    const root = snapshot && typeof snapshot === "object" ? snapshot as Record<string, unknown> : {};
    const data = root.data && typeof root.data === "object" ? root.data as Record<string, unknown> : root;
    const fabric = data.fabric ?? data.snapshot;
    setProjection((value) => projectDesktop(selectedProfileId, { gateway: runtimeState, fabric, workspaces: data.workspaces }, value.revision + 1));
    setMonitor((value) => markResynchronized(value));
  }, [runtimeState, selectedProfileId]);

  async function connect() {
    setState((value) => ({ ...value, readiness: "starting", error: undefined }));
    try {
      const [next, gateway] = await Promise.all([desktopApi.handshake(), desktopApi.getGatewayRuntimeState()]);
      setState((value) => acceptNewerState(value, next));
      acceptRuntimeState(gateway);
    } catch (error) {
      setState((value) => ({ ...value, revision: value.revision + 1, readiness: "unavailable", error: { code: "desktop_unavailable", message: error instanceof Error ? error.message : "Desktop bridge is unavailable", retryable: true } }));
    }
  }

  function acceptRuntimeState(next: GatewayRuntimeState) {
    setRuntimeState(next);
    const gateway = next.status === "running" ? "ready" : next.status === "stopped" ? "offline" : next.status === "starting" || next.status === "failed" ? "degraded" : "unknown";
    setProjection((value) => ({ ...value, profileId: selectedProfileId, revision: value.revision + 1, gateway, tunnelCount: next.tunnelKind === "none" ? 0 : 1 }));
  }

  async function gatewayAction(action: string) {
    const activatesTunnel = (action === "start" || action === "restart") && runtimeState?.tunnelKind !== "none";
    const actionLabel = action === "restart" ? t("restartGateway") : t("startGateway");
    if (activatesTunnel && !window.confirm(t("confirmGatewayTunnelAction").replace("{action}", actionLabel))) return;
    setGatewayBusy(action);
    setGatewayError(undefined);
    try {
      const next = action === "start" ? await desktopApi.startGatewayRuntime()
        : action === "stop" ? await desktopApi.stopGatewayRuntime()
          : await desktopApi.restartGatewayRuntime();
      acceptRuntimeState(next);
    } catch (error) {
      setGatewayError(error instanceof Error ? error.message : String(error));
    } finally {
      setGatewayBusy(undefined);
    }
  }

  useEffect(() => { void connect(); }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; document.documentElement.lang = locale === "zh" ? "zh-CN" : "en"; }, [locale, theme]);

  const label = useMemo(() => ({ Overview: t("overview"), Gateway: t("gateway"), Activity: t("activity"), Workspaces: t("workspaces"), Board: t("secBoard"), Host: t("secHost"), Exec: t("secExec"), Jobs: t("secJobs"), Files: t("secFiles"), Sessions: t("secSessions"), Todos: t("secTodos"), Teammates: t("secTeammates"), Handoffs: t("secHandoffs"), Skills: t("secSkills"), Knowledge: t("secKnowledge"), Browser: t("secBrowser"), Devices: t("secDevices"), Endpoints: t("secEndpoints"), Routes: t("secRoutes"), Settings: t("secSettings") }), [t]);
  const pageTitle = label[section as keyof typeof label] ?? section;
  const readinessLabel = state.readiness === "ready" ? t("readinessReady") : state.readiness === "starting" ? t("readinessStarting") : t("readinessUnavailable");
  const gatewayCompatibility = state.bridge?.gatewayCompatibility;
  const gatewayCompatibilityLabel = gatewayCompatibility
    ? ` · Gateway ${gatewayCompatibility.version ?? t("gatewayVersionUnavailable")} (${gatewayCompatibility.compatible ? t("gatewayVersionCompatible") : t("gatewayVersionRequires").replace("{version}", gatewayCompatibility.minimumVersion)})`
    : "";

  return <LocaleProvider locale={locale}>
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">M</span><div><strong>{t("product")}</strong><span>{t("productSubtitle")}</span></div></div>
        <nav aria-label={t("productSubtitle")}>
          {(["Overview", "Gateway", "Activity", "Workspaces"] as const).map((item) => <button key={item} className={section === item ? "nav-item active" : "nav-item"} aria-current={section === item ? "page" : undefined} onClick={() => setSection(item)}>{label[item]}</button>)}
          <button className={advancedOpen ? "nav-group expanded" : "nav-group"} aria-expanded={advancedOpen} onClick={() => setAdvancedOpen((value) => !value)}><span>{t("advanced")}</span><span aria-hidden="true">{advancedOpen ? "−" : "+"}</span></button>
          {advancedOpen && <div className="advanced-list">{advancedSections.map((item) => <button key={item} className={section === item ? "nav-item active" : "nav-item"} onClick={() => setSection(item)}>{label[item as keyof typeof label] ?? item}</button>)}</div>}
        </nav>
        <div className="sidebar-settings"><button aria-label={t("languageLabel")} onClick={() => setLocale((value) => value === "en" ? "zh" : "en")}>{t("language")}</button><button aria-label={t("themeLabel")} onClick={() => setTheme((value) => value === "system" ? "light" : value === "light" ? "dark" : "system")}>{theme === "system" ? t("themeSystem") : theme === "light" ? t("themeLight") : t("themeDark")}</button></div>
        <div className={`connection ${state.readiness}`}><span className="status-dot" />{readinessLabel}</div>
      </aside>
      <main>
        <header><div><p className="eyebrow">{t("eyebrow")}</p><h1>{pageTitle}</h1></div><button className="secondary" onClick={() => void connect()}>{t("refresh")}</button></header>
        <section className={`readiness ${state.readiness}`} role="status" aria-live="polite">
          <div><span className="status-dot" /><strong>{state.readiness === "ready" ? t("desktopReady") : state.readiness === "starting" ? t("desktopStarting") : t("desktopUnavailable")}</strong></div>
          <p>{state.bridge ? `Protocol v${state.bridge.protocolVersion} · Node ${state.bridge.nodeVersion}${gatewayCompatibilityLabel}` : state.error?.message ?? t("establishChannel")}</p>
          {state.error?.retryable && <button onClick={() => void connect()}>{t("tryAgain")}</button>}
        </section>
        {section === "Overview" ? <Dashboard state={state} projection={projection} gatewayBusy={gatewayBusy} gatewayError={gatewayError} onGatewayAction={gatewayAction} onNavigate={setSection} />
          : section === "Activity" ? <ActivityPanel items={monitor.activity} degraded={monitor.degraded} gap={monitor.gap} controls={<MonitorControls profileId={selectedProfileId} cursor={monitor.cursor} onEvents={acceptEvents} onSnapshot={acceptSnapshot} />} />
          : ["Devices", "Endpoints", "Routes"].includes(section) ? selectedProfileId === "local" && runtimeState?.fabricEnabled === false
            ? <section className="panel"><div className="panel-heading"><div><h2>{pageTitle}</h2><p>{t("localFabricUnavailable")}</p></div></div></section>
            : <FabricPanel section={section} title={pageTitle} profileId={selectedProfileId} workspaceId={selectedWorkspaceId} />
          : section === "Workspaces" ? <WorkspaceTopologyPanel profileId={selectedProfileId} selectedId={selectedWorkspaceId} onSelect={setSelectedWorkspaceId} />
          : ["Board", "Host", "Exec", "Jobs", "Files", "Sessions", "Todos", "Teammates", "Handoffs", "Skills", "Knowledge", "Browser"].includes(section) ? <GatewayToolsPanel section={section} title={pageTitle} profileId={selectedProfileId} workspaceId={selectedWorkspaceId} />
          : <GatewayPanel section={section} profileId={selectedProfileId} onProfileSelect={setSelectedProfileId} onRuntimeState={acceptRuntimeState} />}
      </main>
    </div>
  </LocaleProvider>;
}

function useI18nSafe(locale: Locale) {
  // The App renders the provider below its own shell, so it reads the shared dictionary directly.
  const dictionary = messages[locale];
  return { t: <K extends keyof typeof dictionary>(key: K) => dictionary[key] };
}
