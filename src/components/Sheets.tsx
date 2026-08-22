import { Home, Plane, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { availableCurrencies, currencyName } from "../lib/currency";
import { t } from "../lib/i18n";
import type { Ledger, LedgerKind, Locale } from "../lib/types";

export function SheetFrame({ title, locale, onClose, children }: { title: string; locale: Locale; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="sheet-backdrop" role="presentation" onClick={onClose}>
      <section className="bottom-sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <div className="sheet-handle" /><div className="sheet-title-row"><h2>{title}</h2><button className="icon-button" type="button" onClick={onClose} aria-label={t(locale, "close")}><X /></button></div>{children}
      </section>
    </div>
  );
}

export function NewLedgerSheet({ locale, onClose, onCreate }: { locale: Locale; onClose: () => void; onCreate: (kind: LedgerKind, title: string, currency: string) => void }) {
  const [kind, setKind] = useState<LedgerKind>("travel"); const [title, setTitle] = useState(""); const [currency, setCurrency] = useState(locale === "ko" ? "KRW" : "EUR");
  const currencies = useMemo(() => availableCurrencies(), []);
  return (
    <SheetFrame title={t(locale, "newLedger")} locale={locale} onClose={onClose}>
      <p className="sheet-intro">{t(locale, "chooseLedgerType")}</p>
      <div className="ledger-type-options">
        <button className={kind === "travel" ? "type-row selected" : "type-row"} type="button" onClick={() => setKind("travel")}><Plane /><strong>{t(locale, "travelLedger")}</strong><span className="radio-dot" /></button>
        <button className={kind === "general" ? "type-row selected" : "type-row"} type="button" onClick={() => setKind("general")}><Home /><strong>{t(locale, "generalLedger")}</strong><span className="radio-dot" /></button>
      </div>
      <label className="field-label">{t(locale, "ledgerName")}<input value={title} maxLength={80} placeholder={t(locale, "ledgerNamePlaceholder")} onChange={(event) => setTitle(event.target.value)} autoFocus /></label>
      <label className="field-label">{t(locale, kind === "travel" ? "localCurrency" : "baseCurrency")}
        <select value={currency} onChange={(event) => setCurrency(event.target.value)}>{currencies.map((code) => <option value={code} key={code}>{currencyName(code, locale)}</option>)}</select>
      </label>
      <div className="sheet-actions"><button type="button" onClick={onClose}>{t(locale, "cancel")}</button><button className="primary-button" type="button" disabled={!title.trim()} onClick={() => onCreate(kind, title, currency)}>{t(locale, "createLedger")}</button></div>
    </SheetFrame>
  );
}

export function LedgerMenuSheet({ ledger, locale, onClose, onRename, onDelete }: { ledger: Ledger; locale: Locale; onClose: () => void; onRename: (title: string) => void; onDelete: () => void }) {
  const [title, setTitle] = useState(ledger.title); const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <SheetFrame title={ledger.title} locale={locale} onClose={onClose}>
      <label className="field-label">{t(locale, "ledgerName")}<input value={title} maxLength={80} onChange={(event) => setTitle(event.target.value)} /></label>
      <button className="wide-secondary" type="button" disabled={!title.trim() || title.trim() === ledger.title} onClick={() => onRename(title)}>{t(locale, "renameLedger")}</button>
      {!confirmDelete ? <button className="wide-danger" type="button" onClick={() => setConfirmDelete(true)}><Trash2 />{t(locale, "deleteLedger")}</button> : <div className="delete-confirm"><p>{t(locale, "deleteLedgerConfirm")}</p><div><button type="button" onClick={() => setConfirmDelete(false)}>{t(locale, "cancel")}</button><button className="danger-button" type="button" onClick={onDelete}>{t(locale, "delete")}</button></div></div>}
    </SheetFrame>
  );
}
