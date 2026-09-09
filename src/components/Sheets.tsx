import { Home, Plane, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { availableCurrencies, currencyName } from "../lib/currency";
import { designText } from "../lib/designI18n";
import { t } from "../lib/i18n";
import type { Ledger, LedgerKind, Locale } from "../lib/types";

const openSheets: HTMLElement[] = [];
let backgroundOverflow = "";
const focusableSelector = "a[href], button, input, select, textarea, [tabindex], [contenteditable='true']";

function focusableElements(sheet: HTMLElement): HTMLElement[] {
  return Array.from(sheet.querySelectorAll<HTMLElement>(focusableSelector)).filter((element) => element.tabIndex >= 0 && !element.matches(":disabled") && element.getClientRects().length > 0 && !element.closest("[inert]"));
}

export function SheetFrame({ title, locale, onClose, children }: { title: string; locale: Locale; onClose: () => void; children: React.ReactNode }) {
  const sheetRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  const [returnFocusTarget] = useState(() => typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null);

  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    if (openSheets.length === 0) {
      backgroundOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    openSheets.push(sheet);
    const focusFirst = () => (focusableElements(sheet)[0] ?? sheet).focus();
    if (!sheet.contains(document.activeElement)) {
      const initialInput = sheet.querySelector<HTMLInputElement>(".field-label input:not([type='file']):not([type='checkbox']), .expense-form-grid input:not([type='checkbox'])");
      if (initialInput && !initialInput.disabled) initialInput.focus(); else focusFirst();
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (openSheets.at(-1) !== sheet) return;
      if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation(); closeRef.current();
      } else if (event.key === "Tab") {
        const elements = focusableElements(sheet);
        const first = elements[0]; const last = elements.at(-1);
        if (!first || !last) { event.preventDefault(); sheet.focus(); return; }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === sheet || !sheet.contains(document.activeElement))) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !sheet.contains(document.activeElement))) {
          event.preventDefault(); first.focus();
        }
      }
    };
    const onFocusIn = (event: FocusEvent) => {
      if (openSheets.at(-1) === sheet && event.target instanceof Node && !sheet.contains(event.target)) focusFirst();
    };
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("focusin", onFocusIn);
      const index = openSheets.indexOf(sheet);
      if (index !== -1) openSheets.splice(index, 1);
      if (openSheets.length === 0) document.body.style.overflow = backgroundOverflow;
      const remainingSheet = openSheets.at(-1);
      if (returnFocusTarget?.isConnected && (!remainingSheet || remainingSheet.contains(returnFocusTarget))) returnFocusTarget.focus();
      else if (remainingSheet) (focusableElements(remainingSheet)[0] ?? remainingSheet).focus();
    };
  }, [returnFocusTarget]);

  return (
    <div className="sheet-backdrop" role="presentation" onClick={onClose}>
      <section ref={sheetRef} className="bottom-sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} onClick={(event) => event.stopPropagation()}>
        <div className="sheet-handle" /><div className="sheet-title-row"><h2>{title}</h2><button className="icon-button" type="button" onClick={onClose} aria-label={t(locale, "close")}><X /></button></div>{children}
      </section>
    </div>
  );
}

export function NewLedgerSheet({ locale, onClose, onCreate }: { locale: Locale; onClose: () => void; onCreate: (kind: LedgerKind, title: string, currency: string) => void }) {
  const [kind, setKind] = useState<LedgerKind>("general"); const [title, setTitle] = useState(""); const [currency, setCurrency] = useState(locale === "ko" ? "KRW" : "EUR");
  const currencies = useMemo(() => availableCurrencies(), []);
  return (
    <SheetFrame title={t(locale, "newLedger")} locale={locale} onClose={onClose}>
      <p className="sheet-intro">{t(locale, "chooseLedgerType")}</p>
      <div className="ledger-type-options" role="group" aria-label={t(locale, "chooseLedgerType")}>
        <button className={kind === "general" ? "type-row selected" : "type-row"} aria-pressed={kind === "general"} type="button" onClick={() => setKind("general")}><Home aria-hidden="true" /><span className="type-description"><strong>{t(locale, "generalLedger")}</strong><small>{designText(locale, "dailyPurpose")}</small></span><span className="radio-dot" aria-hidden="true" /></button>
        <button className={kind === "travel" ? "type-row selected" : "type-row"} aria-pressed={kind === "travel"} type="button" onClick={() => setKind("travel")}><Plane aria-hidden="true" /><span className="type-description"><strong>{t(locale, "travelLedger")}</strong><small>{designText(locale, "travelPurpose")}</small></span><span className="radio-dot" aria-hidden="true" /></button>
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
