import { ArrowRight, Share2 } from "lucide-react";
import { formatMoney } from "../lib/currency";
import { fxText as f } from "../lib/fxI18n";
import { convertedShareText } from "../lib/fxSummary";
import { t } from "../lib/i18n";
import type { Locale, TravelLedger } from "../lib/types";
import type { TravelFxState } from "./useTravelFx";
import { CompactFxSettings } from "./CompactFxSettings";

type Notify = (message: string, tone?: "success" | "error" | "info") => void;

/** Keep transfers visible in the settlement tab, but always start settings collapsed. */
export function ConvertedSettlement({ ledger, locale, onNotify, fx, showSettlement }: { ledger: TravelLedger; locale: Locale; onNotify: Notify; fx: TravelFxState; showSettlement: boolean }) {
  const { settings, ready, settlement, summaries } = fx;
  const share = async () => {
    if (!settlement?.complete) return;
    const text = convertedShareText(locale, ledger, settlement, summaries, t(locale, "settlementEmpty"));
    try { const { Share } = await import("@capacitor/share"); await Share.share({ title: ledger.title, text }); }
    catch (error) {
      if (error instanceof Error && /abort|cancel/i.test(`${error.name} ${error.message}`)) return;
      try { await navigator.clipboard.writeText(text); onNotify(f(locale, "copied"), "success"); }
      catch { onNotify(f(locale, "shareFailed"), "error"); }
    }
  };

  const names = new Map(ledger.participants.map((person) => [person.id, person.name]));
  const missing = settlement && !settlement.complete ? [...new Set(settlement.missing.map(item => item.currency))] : [];
  return <>
    <CompactFxSettings locale={locale} fx={fx} missingCurrencies={missing} onNotify={onNotify} />
    {showSettlement && settings.enabled && ready && settlement?.complete && ledger.expenses.length > 0 ? <section className="mobile-panel fx-settlement-results" aria-label={f(locale, "settlementIn").replace("{currency}", settings.target)}>
      <div className="section-heading"><h3>{f(locale, "settlementIn").replace("{currency}", settings.target)}</h3><button className="icon-button" type="button" title={f(locale, "share")} aria-label={f(locale, "share")} onClick={() => void share()}><Share2 aria-hidden="true" /></button></div>
      {settlement.convertedCurrencies.length === 0 ? null : settlement.transfers.length ? <div className="currency-settlement">{settlement.transfers.map(transfer => <p key={`${transfer.from}-${transfer.to}`}><span>{names.get(transfer.from)}</span><ArrowRight role="img" aria-label={t(locale, "pays")} /><span>{names.get(transfer.to)}</span><b>≈ {formatMoney(transfer.minorUnits, transfer.currency, locale)}</b></p>)}</div> : <p className="empty-inline">{t(locale, "settlementEmpty")}</p>}
    </section> : null}
  </>;
}
