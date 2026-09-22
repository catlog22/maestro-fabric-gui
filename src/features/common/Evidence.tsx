import { useState } from "react";
import { useI18n } from "../../i18n";

export function Evidence({ result, summary, open }: { result: unknown; summary: string; open?: boolean }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  if (result === undefined) return null;
  const text = JSON.stringify(result, null, 2);
  return <details className="evidence" open={open}>
    <summary>{summary}</summary>
    <pre>{text}</pre>
    <button className="copy-btn" onClick={() => void navigator.clipboard.writeText(text).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); })}>{copied ? t("copied") : t("copy")}</button>
  </details>;
}
