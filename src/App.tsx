import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityPanel } from "./features/activity/ActivityPanel";
import { MonitorControls } from "./features/activity/MonitorControls";
import { Dashboard } from "./features/dashboard/Dashboard";
import { FabricPanel } from "./features/fabric/FabricPanel";
import { GatewayPanel } from "./features/gateway/GatewayPanel";
import { GatewayToolsPanel } from "./features/gateway/GatewayToolsPanel";
import { WorkspaceTopologyPanel } from "./features/workspace/WorkspaceTopologyPanel";
import { desktopApi } from "./lib/desktop-api";
import { LocaleProvider, type Locale, useI18n } from "./i18n";
import { acceptNewerState, initialDesktopState } from "./state/desktop-state";
import type { DesktopState } from "./models/desktop";
import { projectDesktop, type DesktopProjection } from "./models/projection";
import { initialMonitorState, markResynchronized, reduceMonitor, type MonitorEvent } from "./state/monitor-state";
import "./styles/app.css";

const advancedSections = ["Connectors", "Board", "Host", "Exec", "Jobs", "Files", "Sessions", "Todos", "Teammates", "Handoffs", "Skills", "Knowledge", "Browser", "Devices", "Endpoints", "Routes", "Settings"];

export function App() {
  const [state, setState] = useState<DesktopState>(initialDesktopState);
  const [section, setSection] = useState("Overview");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [selectedProfileId, setSelectedProfileId] = useState("remote");
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>();
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
    setProjection(projectDesktop(selectedProfileId, { fabric, workspaces: data.workspaces }));
    setMonitor((value) => markResynchronized(value));
  }, [selectedProfileId]);

  async function connect() {
    setState((value) => ({ ...value, readiness: "starting", error: undefined }));
    try {
      const next = await desktopApi.handshake();
      setState((value) => acceptNewerState(value, next));
    } catch (error) {
      setState((value) => ({ ...value, revision: value.revision + 1, readiness: "unavailable", error: { code: "desktop_unavailable", message: error instanceof Error ? error.message : "Desktop bridge is unavailable", retryable: true } }));
    }
  }

  async function gatewayAction(action: string) {
    setGatewayBusy(action);
    setGatewayError(undefined);
    try {
      await desktopApi.gatewayControl(action, {}, 120_000);
      setProjection((value) => ({ ...value, gateway: action === "stop" ? "offline" : "ready" }));
    } catch (error) {
      setGatewayError(error instanceof Error ? error.message : String(error));
    } finally {
      setGatewayBusy(undefined);
    }
  }

  useEffect(() => { void connect(); }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; document.documentElement.lang = locale === "zh" ? "zh-CN" : "en"; }, [locale, theme]);

  const label = useMemo(() => ({ Overview: t("overview"), Gateway: t("gateway"), Activity: t("activity"), Workspaces: t("workspaces") }), [t]);
  const pageTitle = label[section as keyof typeof label] ?? section;

  return <LocaleProvider locale={locale}>
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">M</span><div><strong>{t("product")}</strong><span>{t("productSubtitle")}</span></div></div>
        <nav aria-label={t("productSubtitle")}>
          {(["Overview", "Gateway", "Activity", "Workspaces"] as const).map((item) => <button key={item} className={section === item ? "nav-item active" : "nav-item"} aria-current={section === item ? "page" : undefined} onClick={() => setSection(item)}>{label[item]}</button>)}
          <button className={advancedOpen ? "nav-group expanded" : "nav-group"} aria-expanded={advancedOpen} onClick={() => setAdvancedOpen((value) => !value)}><span>{t("advanced")}</span><span aria-hidden="true">{advancedOpen ? "−" : "+"}</span></button>
          {advancedOpen && <div className="advanced-list">{advancedSections.map((item) => <button key={item} className={section === item ? "nav-item active" : "nav-item"} onClick={() => setSection(item)}>{item}</button>)}</div>}
        </nav>
        <div className="sidebar-settings"><button aria-label="Language" onClick={() => setLocale((value) => value === "en" ? "zh" : "en")}>{t("language")}</button><button aria-label="Theme" onClick={() => setTheme((value) => value === "system" ? "light" : value === "light" ? "dark" : "system")}>{theme}</button></div>
        <div className={`connection ${state.readiness}`}><span className="status-dot" />{state.readiness}</div>
      </aside>
      <main>
        <header><div><p className="eyebrow">{t("eyebrow")}</p><h1>{pageTitle}</h1></div><button className="secondary" onClick={() => void connect()}>{t("refresh")}</button></header>
        <section className={`readiness ${state.readiness}`} role="status" aria-live="polite">
          <div><span className="status-dot" /><strong>{state.readiness === "ready" ? t("desktopReady") : state.readiness === "starting" ? t("desktopStarting") : t("desktopUnavailable")}</strong></div>
          <p>{state.bridge ? `Protocol v${state.bridge.protocolVersion} · Node ${state.bridge.nodeVersion}` : state.error?.message ?? t("establishChannel")}</p>
          {state.error?.retryable && <button onClick={() => void connect()}>{t("tryAgain")}</button>}
        </section>
        {section === "Overview" ? <Dashboard state={state} projection={projection} gatewayBusy={gatewayBusy} gatewayError={gatewayError} onGatewayAction={gatewayAction} onNavigate={setSection} />
          : section === "Activity" ? <ActivityPanel items={monitor.activity} degraded={monitor.degraded} gap={monitor.gap} controls={<MonitorControls profileId={selectedProfileId} cursor={monitor.cursor} onEvents={acceptEvents} onSnapshot={acceptSnapshot} />} />
          : ["Devices", "Endpoints", "Routes"].includes(section) ? <FabricPanel section={section} profileId={selectedProfileId} workspaceId={selectedWorkspaceId} />
          : section === "Workspaces" ? <WorkspaceTopologyPanel profileId={selectedProfileId} selectedId={selectedWorkspaceId} onSelect={setSelectedWorkspaceId} />
          : ["Board", "Host", "Exec", "Jobs", "Files", "Sessions", "Todos", "Teammates", "Handoffs", "Skills", "Knowledge", "Browser"].includes(section) ? <GatewayToolsPanel section={section} profileId={selectedProfileId} workspaceId={selectedWorkspaceId} />
          : <GatewayPanel section={section} profileId={selectedProfileId} onProfileSelect={setSelectedProfileId} />}
      </main>
    </div>
  </LocaleProvider>;
}

function useI18nSafe(locale: Locale) {
  // The App renders the provider below its own shell, so use a tiny local dictionary for the shell.
  const dictionaries = { en: { overview: "Overview", gateway: "Gateway", activity: "Logs & monitoring", workspaces: "Registered workspaces", advanced: "Advanced tools", product: "Maestro Gateway Console", productSubtitle: "Gateway operations", eyebrow: "GATEWAY OPERATIONS CONSOLE", language: "中文", refresh: "Refresh", tryAgain: "Try again", desktopReady: "Desktop bridge ready", desktopStarting: "Connecting to desktop bridge", desktopUnavailable: "Desktop bridge unavailable", establishChannel: "Establishing the local control channel." }, zh: { overview: "总览", gateway: "网关控制", activity: "日志与监控", workspaces: "注册空间", advanced: "高级工具", product: "Maestro 网关控制台", productSubtitle: "网关运维", eyebrow: "网关运维控制台", language: "English", refresh: "刷新", tryAgain: "重试", desktopReady: "桌面桥接已就绪", desktopStarting: "正在连接桌面桥接", desktopUnavailable: "桌面桥接不可用", establishChannel: "正在建立本地控制通道。" } } as const;
  const dictionary = dictionaries[locale];
  return { t: <K extends keyof typeof dictionary>(key: K) => dictionary[key] };
}
