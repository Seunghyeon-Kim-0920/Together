import { ArrowLeftRight, ChevronDown, RefreshCw } from "lucide-react";
import { useId, useState } from "react";
import { availableCurrencies, currencyName } from "../lib/currency";
import type { RatePoint } from "../lib/exchangeRates";
import { fxText as f } from "../lib/fxI18n";
import { normalizeManualRate, withFxTarget, type FxSettings } from "../lib/fxSettings";
import { formatRate, rateSummaryLine, type RateSummary } from "../lib/fxSummary";
import type { Locale } from "../lib/types";

export interface CompactFxState {
  settings: FxSettings;
  save: (settings: FxSettings) => void;
  online: boolean;
  ready: boolean;
  foreign: readonly string[];
  rates: ReadonlyMap<string, RatePoint>;
  summaries: readonly RateSummary[];
  retry: () => void;
}
interface Props {
  locale: Locale;
  fx: CompactFxState;
  missingCurrencies?: readonly string[];
  onNotify: (message: string, tone?: "success" | "error" | "info") => void;
}

/** Opening this row is not consent to a rate lookup. Only the Enable button
 * changes the stored preference; never mount the long options list when closed. */
export function CompactFxSettings({ locale, fx, missingCurrencies = [], onNotify }: Props) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  return <section className="mobile-panel fx-compact" aria-label={f(locale, "settings")}>
    <button type="button" className="fx-compact-toggle" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(!expanded)}>
      <ArrowLeftRight aria-hidden="true" /><span>{f(locale, "settings")}</span>
      <small>{fx.settings.enabled ? fx.settings.target : f(locale, "off")}</small><ChevronDown aria-hidden="true" />
    </button>
    <div id={id} hidden={!expanded}>{expanded ? <FxControls locale={locale} fx={fx} missingCurrencies={missingCurrencies} onNotify={onNotify} /> : null}</div>
  </section>;
}

function FxControls({ locale, fx, missingCurrencies = [], onNotify }: Props) {
  const { settings, save, online, ready, foreign, rates, summaries, retry } = fx;
  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({});
  const currencies = availableCurrencies();
  const targetOptions = currencies.includes(settings.target) ? currencies : [settings.target, ...currencies];
  const manualCurrencies = [...new Set([...foreign, ...Object.keys(settings.manualRates)])].sort();
  function saveManual(currency: string, clear = false) {
    const manualRates = { ...settings.manualRates };
    if (clear) delete manualRates[currency];
    else {
      const rate = normalizeManualRate(drafts[currency] ?? "");
      if (!rate) { onNotify(f(locale, "manualInvalid"), "error"); return; }
      manualRates[currency] = rate;
    }
    save({ ...settings, manualRates });
    setDrafts(current => Object.fromEntries(Object.entries(current).filter(([code]) => code !== currency)));
  }
  return <div className="converted-body">
    <label className="field-label">{f(locale, "target")}<select value={settings.target} onChange={event => { setDrafts({}); save(withFxTarget(settings, event.target.value)); }}>
      {targetOptions.map(code => <option key={code} value={code}>{currencyName(code, locale)}</option>)}
    </select></label>
    <p className="storage-note">{f(locale, "note")}</p>
    {!settings.enabled ? <>
      <p className="storage-note">{f(locale, "disclosure")}</p>
      <button className="wide-secondary" type="button" onClick={() => save({ ...settings, enabled: true })}>{f(locale, "enable")}</button>
    </> : <>
      {!online ? <p className="converted-status" role="status">{f(locale, "offline")}</p> : null}
      {!ready ? <p className="converted-status" role="status">{f(locale, "loading")}</p> : null}
      {ready && missingCurrencies.length > 0 ? <div className="converted-missing" role="status"><p>{f(locale, "missing").replace("{list}", missingCurrencies.join(", "))}</p><button type="button" onClick={retry}><RefreshCw aria-hidden="true" />{f(locale, "retry")}</button></div> : null}
      {ready && summaries.length > 0 ? <div className="converted-rates">
        <strong>{f(locale, "rates")}</strong>
        <ul>{summaries.map(summary => <li key={summary.currency}>{rateSummaryLine(summary, settings.target, locale)}</li>)}</ul>
        {[...rates.values()].some(point => point.source === "frankfurter") ? <p className="storage-note">{f(locale, "sourcePrimary")}</p> : null}
        {summaries.some(s => s.fallback) ? <p className="storage-note">{f(locale, "sourceFallback")}</p> : null}
        {summaries.some(s => s.provisional) ? <p className="storage-note">{f(locale, "provisional")}</p> : null}
        {summaries.some(s => s.manual) ? <p className="storage-note">{f(locale, "manualDevice")}</p> : null}
      </div> : null}
      {manualCurrencies.length > 0 ? <details className="converted-manual">
        <summary>{f(locale, "manualTitle")}</summary><p className="storage-note">{f(locale, "manualHelp")}</p>
        {manualCurrencies.map(currency => {
          const saved = settings.manualRates[currency];
          const draft = drafts[currency] ?? saved ?? "";
          const preview = normalizeManualRate(draft);
          return <div className="converted-manual-row" key={currency}>
            <label><span>1 {currency} =</span><input inputMode="decimal" autoComplete="off" aria-label={`1 ${currency} → ${settings.target}`} placeholder="0.00" value={draft} onChange={event => setDrafts(current => ({ ...current, [currency]: event.target.value }))} /><span>{settings.target}</span></label>
            <div><button type="button" disabled={!draft.trim() || draft === saved} onClick={() => saveManual(currency)}>{f(locale, "apply")}</button><button type="button" disabled={saved === undefined} onClick={() => saveManual(currency, true)}>{f(locale, "clear")}</button></div>
            {draft.trim() ? <small role="status">{preview ? `1 ${currency} = ${formatRate(Number(preview), settings.target, locale)}` : f(locale, "manualInvalid")}</small> : null}
          </div>;
        })}
      </details> : null}
      <button className="wide-secondary converted-off" type="button" onClick={() => save({ ...settings, enabled: false })}>{f(locale, "disable")}</button>
    </>}
  </div>;
}
