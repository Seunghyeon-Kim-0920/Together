import { useMemo, useRef, useState } from "react";
import { formatMoney } from "../lib/currency";
import { designText } from "../lib/designI18n";
import { documentText } from "../lib/documentI18n";
import { t } from "../lib/i18n";
import { isValidPdfDateRange, type LedgerPdfDateRange } from "../lib/ledgerPdf";
import { pdfExportText as p } from "../lib/pdfExportI18n";
import type { GeneralLedger, Locale } from "../lib/types";
import { defaultDate } from "../lib/wallet";
import { SheetFrame } from "./Sheets";

export function GeneralPdfExportSheet({ ledger, locale, onClose, onSave }: {
  ledger: GeneralLedger; locale: Locale; onClose: () => void;
  onSave: (range: LedgerPdfDateRange | undefined) => Promise<boolean>;
}) {
  const [mode, setMode] = useState<"all" | "custom">("all");
  const [range, setRange] = useState<LedgerPdfDateRange>(() => {
    const dates = ledger.expenses.map((expense) => expense.occurredOn).sort();
    const today = defaultDate();
    return { from: dates[0] ?? today, to: dates.at(-1) ?? today };
  });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const lock = useRef(false);
  const valid = mode === "all" || isValidPdfDateRange(range);
  const selected = useMemo(() => mode === "all" ? ledger.expenses : ledger.expenses.filter((expense) => expense.occurredOn >= range.from && expense.occurredOn <= range.to), [ledger.expenses, mode, range.from, range.to]);
  const total = selected.reduce((sum, expense) => sum + expense.minorUnits, 0);
  const close = () => { if (!lock.current) onClose(); };
  const save = async () => {
    if (lock.current || !valid) return;
    lock.current = true; setBusy(true); setFailed(false);
    try { if (await onSave(mode === "all" ? undefined : range)) onClose(); }
    catch { setFailed(true); }
    finally { lock.current = false; setBusy(false); }
  };
  return <SheetFrame title={p(locale, "title")} locale={locale} onClose={close}>
    <p className="sheet-intro">{p(locale, "saveHelp")}</p>
    <label className="field-label">{p(locale, "period")}<select aria-label={p(locale, "period")} value={mode} disabled={busy} onChange={(event) => setMode(event.target.value as "all" | "custom")}><option value="all">{p(locale, "all")}</option><option value="custom">{p(locale, "custom")}</option></select></label>
    {mode === "custom" ? <>
      <label className="field-label">{p(locale, "from")}<input type="date" value={range.from} disabled={busy} aria-invalid={!valid} onChange={(event) => setRange((previous) => ({ ...previous, from: event.target.value }))} /></label>
      <label className="field-label">{p(locale, "to")}<input type="date" value={range.to} disabled={busy} aria-invalid={!valid} onChange={(event) => setRange((previous) => ({ ...previous, to: event.target.value }))} /></label>
      <p className="sheet-intro">{p(locale, "inclusive")}</p>
    </> : null}
    {!valid ? <p className="exchange-error" role="alert">{p(locale, "invalid")}</p> : <div className="exchange-conflicts" role="status"><p>{p(locale, "count")}: {selected.length.toLocaleString(locale)}</p><p>{t(locale, "totalSpent")}: {formatMoney(total, ledger.currency, locale)}</p>{!selected.length ? <p>{p(locale, "empty")}</p> : null}</div>}
    {failed ? <p className="exchange-error" role="alert">{t(locale, "pdfFailed")}</p> : null}
    <div className="sheet-actions"><button type="button" disabled={busy} onClick={close}>{t(locale, "cancel")}</button><button className="primary-button" type="button" disabled={busy || !valid} onClick={() => void save()}>{busy ? documentText(locale, "saving") : designText(locale, "savePdf")}</button></div>
  </SheetFrame>;
}
