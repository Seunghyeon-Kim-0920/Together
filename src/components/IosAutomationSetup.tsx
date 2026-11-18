import { useRef, useState } from "react";
import { iosAutomationText as i } from "../lib/iosAutomationI18n";
import { cardAutomationPlugin, type CardAutomationStatus } from "../lib/nativeCardAutomation";
import type { Locale } from "../lib/types";

export function IosAutomationSetup({ locale, status, busy, onRefresh }: { locale: Locale; status: CardAutomationStatus; busy: boolean; onRefresh: () => void }) {
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const savingRef = useRef(false);
  const action = async (operation: () => Promise<void>) => {
    if (savingRef.current) return;
    savingRef.current = true; setSaving(true); setFailed(false);
    try { await operation(); onRefresh(); } catch { setFailed(true); }
    finally { savingRef.current = false; setSaving(false); }
  };
  return <section className="automation-connection-panel" aria-label={i(locale, "title")}>
    <h3>{i(locale, "title")}</h3>
    <p>{i(locale, "disclosure")}</p><p className="reversal-help">{i(locale, "background")}</p>
    {!status.supported ? <p>{i(locale, "unsupported")}</p> : <>
      <label className="all-apps-toggle"><span><b>{i(locale, "enable")}</b><small>{i(locale, "stopHelp")}</small></span><input type="checkbox" role="switch" checked={status.captureEnabled === true} disabled={busy || saving} onChange={(event) => { const enabled = event.target.checked; void action(() => cardAutomationPlugin.setCaptureEnabled(enabled)); }} /></label>
      <p role="status">{i(locale, status.captureEnabled ? "enabled" : "disabled")}</p><small>{i(locale, "configured")}</small>
      <p>{status.lastShortcutReceivedAt ? `${i(locale, "lastReceived")}: ${new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(status.lastShortcutReceivedAt)}` : i(locale, "noReceived")}</p>
      <p>{i(locale, "queued")}: {(status.queuedInputs ?? 0).toLocaleString(locale)}</p>
      <details><summary>{i(locale, "guide")}</summary><ol>{(["step1", "step2", "step3", "step4", "step5"] as const).map((key) => <li key={key}>{i(locale, key)}</li>)}</ol></details>
      <div className="sheet-actions"><button type="button" disabled={busy || saving} onClick={() => void action(() => cardAutomationPlugin.openAccessSettings())}>{i(locale, "open")}</button><button type="button" disabled={busy || saving} onClick={onRefresh}>{i(locale, "refresh")}</button></div>
      {failed ? <p className="exchange-error" role="alert">{i(locale, "failed")}</p> : null}
    </>}
  </section>;
}
