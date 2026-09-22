import { useI18n } from "../../i18n";

export interface ActivityItem { id: string; time: number; level: "info" | "warning" | "error"; subject: string; detail: string; }
export function ActivityPanel({ items, controls, degraded, gap }: { items: readonly ActivityItem[]; controls?: React.ReactNode; degraded?: boolean; gap?: string }) {
  const { t, locale } = useI18n();
  const timeLocale = locale === "zh" ? "zh-CN" : "en-US";
  return <section className="panel log-panel"><div className="panel-heading"><div><h2>{t("liveLogs")}</h2><p>{t("logHint")}</p></div><span className={degraded ? "log-status degraded" : "log-status"}>{degraded ? t("gatewayDegraded") : t("monitoringRunning")}</span></div>{degraded && <div className="error-box" role="status">{t("gatewayDegraded")} ({gap}). {t("resync")}</div>}{controls}{items.length === 0 ? <div className="compact-empty">{t("noLogs")}</div> : <ol className="activity-list">{items.map((item) => <li key={item.id} className={item.level}><time dateTime={new Date(item.time).toISOString()}>{new Date(item.time).toLocaleTimeString(timeLocale)}</time><strong title={item.subject}>{item.subject}</strong><span title={item.detail}>{item.detail}</span></li>)}</ol>}</section>;
}
