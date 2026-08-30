import { BellRing, Check, Gauge, Plus, RefreshCw, Settings, ShieldCheck, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { calculateMonthlyLimitStatus, type NativeCardCandidate } from "../lib/cardAutomation";
import { currencyDigits, formatMoney, parseMinorUnits } from "../lib/currency";
import { t } from "../lib/i18n";
import type { CardAutomationStatus } from "../lib/nativeCardAutomation";
import type { AutomationSource, GeneralLedger, Locale } from "../lib/types";
import { SheetFrame } from "./Sheets";

type Notify = (message: string, tone?: "success" | "error" | "info") => void;

const COMMON_CARD_APPS: readonly AutomationSource[] = Object.freeze([
  Object.freeze({ packageName: "com.revolut.revolut", displayName: "Revolut" }),
  Object.freeze({ packageName: "hr.lunc.client", displayName: "Swile" }),
  Object.freeze({ packageName: "com.mobiletoong.travelwallet", displayName: "Travel Wallet" }),
]);

export function GeneralLedgerAutomation({ ledger, locale, selectedMonth, status, pending, busy, onRefresh, onOpenAccessSettings, onRequestAlertPermission, onRegisterSource, onRemoveSource, onConfirm, onDismiss, onChange, onNotify }: { ledger: GeneralLedger; locale: Locale; selectedMonth: string; status: CardAutomationStatus; pending: readonly NativeCardCandidate[]; busy: boolean; onRefresh: () => void; onOpenAccessSettings: () => void; onRequestAlertPermission: () => void; onRegisterSource: (source: AutomationSource) => void; onRemoveSource: (packageName: string) => void; onConfirm: (candidate: NativeCardCandidate) => void; onDismiss: (candidate: NativeCardCandidate) => void; onChange: (ledger: GeneralLedger) => void; onNotify: Notify }) {
  const [limitOpen, setLimitOpen] = useState(false);
  const [automationOpen, setAutomationOpen] = useState(false);
  const limit = useMemo(() => calculateMonthlyLimitStatus(ledger, selectedMonth), [ledger, selectedMonth]);
  const progress = Math.min(limit.percent ?? 0, 100);

  const saveLimit = (monthlyLimitMinor: number | null) => {
    onChange(Object.freeze({ ...ledger, monthlyLimitMinor, updatedAt: new Date().toISOString() }));
    setLimitOpen(false);
    onNotify(t(locale, "limitSaved"), "success");
  };

  return <>
    <section className={`mobile-panel limit-card limit-${limit.state}`}>
      <div className="section-heading"><h3><Gauge aria-hidden="true" />{t(locale, "monthlyLimit")}</h3><button type="button" onClick={() => setLimitOpen(true)}><Settings />{t(locale, "setMonthlyLimit")}</button></div>
      {limit.limitMinor === null ? <p className="ledger-empty">{t(locale, "monthlyLimitUnset")}</p> : <div className="limit-card-body">
        <div><span>{t(locale, "monthlyLimitSpent")}</span><strong>{formatMoney(limit.spentMinor, ledger.currency, locale)}</strong><small>{Math.round(limit.percent ?? 0).toLocaleString(locale)}%</small></div>
        <div className="limit-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}><i style={{ width: `${progress}%` }} /></div>
        <p><span>{limit.remainingMinor !== null && limit.remainingMinor >= 0 ? t(locale, "monthlyLimitRemaining") : t(locale, "monthlyLimitExceeded")}</span><b>{formatMoney(Math.abs(limit.remainingMinor ?? 0), ledger.currency, locale)}</b></p>
        {limit.state === "near" ? <em>{t(locale, "monthlyLimitNear")}</em> : null}
      </div>}
    </section>
    <section className="mobile-panel automation-card">
      <div className="section-heading"><h3><BellRing aria-hidden="true" />{t(locale, "cardAutomation")}</h3><button type="button" onClick={() => setAutomationOpen(true)}><Settings />{t(locale, "edit")}</button></div>
      <div className="automation-card-body">
        <span className={status.accessGranted ? "status-chip granted" : "status-chip"}>{status.accessGranted ? <Check /> : <BellRing />}{t(locale, status.accessGranted ? "accessGranted" : "accessNotGranted")}</span>
        <span>{ledger.automationSources.length.toLocaleString(locale)} {t(locale, "registeredSources")}</span>
        {pending.length ? <b>{pending.length.toLocaleString(locale)} {t(locale, "pendingExpenses")}</b> : null}
      </div>
    </section>
    {limitOpen ? <MonthlyLimitSheet ledger={ledger} locale={locale} onClose={() => setLimitOpen(false)} onSave={saveLimit} onNotify={onNotify} /> : null}
    {automationOpen ? <CardAutomationSheet ledger={ledger} locale={locale} status={status} pending={pending} busy={busy} onRefresh={onRefresh} onOpenAccessSettings={onOpenAccessSettings} onRequestAlertPermission={onRequestAlertPermission} onRegisterSource={onRegisterSource} onRemoveSource={onRemoveSource} onConfirm={onConfirm} onDismiss={onDismiss} onClose={() => setAutomationOpen(false)} /> : null}
  </>;
}

function MonthlyLimitSheet({ ledger, locale, onClose, onSave, onNotify }: { ledger: GeneralLedger; locale: Locale; onClose: () => void; onSave: (minorUnits: number | null) => void; onNotify: Notify }) {
  const [amount, setAmount] = useState(ledger.monthlyLimitMinor === null ? "" : minorUnitsInput(ledger.monthlyLimitMinor, ledger.currency));
  const submit = () => {
    const minorUnits = parseMinorUnits(amount, ledger.currency);
    if (!minorUnits) return onNotify(t(locale, "amountInvalid"), "error");
    onSave(minorUnits);
  };
  return <SheetFrame title={t(locale, "setMonthlyLimit")} locale={locale} onClose={onClose}>
    <label className="field-label">{t(locale, "monthlyLimit")}<div className="amount-field"><input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} autoFocus /><span>{ledger.currency}</span></div></label>
    <div className="sheet-actions"><button type="button" onClick={() => onSave(null)}>{t(locale, "removeLimit")}</button><button className="primary-button" type="button" onClick={submit}>{t(locale, "save")}</button></div>
  </SheetFrame>;
}

function CardAutomationSheet({ ledger, locale, status, pending, busy, onRefresh, onOpenAccessSettings, onRequestAlertPermission, onRegisterSource, onRemoveSource, onConfirm, onDismiss, onClose }: { ledger: GeneralLedger; locale: Locale; status: CardAutomationStatus; pending: readonly NativeCardCandidate[]; busy: boolean; onRefresh: () => void; onOpenAccessSettings: () => void; onRequestAlertPermission: () => void; onRegisterSource: (source: AutomationSource) => void; onRemoveSource: (packageName: string) => void; onConfirm: (candidate: NativeCardCandidate) => void; onDismiss: (candidate: NativeCardCandidate) => void; onClose: () => void }) {
  const registeredPackages = useMemo(() => new Set(ledger.automationSources.map((source) => source.packageName)), [ledger.automationSources]);
  const availableApps = useMemo(() => COMMON_CARD_APPS.filter((source) => !registeredPackages.has(source.packageName)), [registeredPackages]);
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }), [locale]);

  return <SheetFrame title={t(locale, "cardAutomation")} locale={locale} onClose={onClose}>
    <div className="automation-disclosure"><ShieldCheck /><div><strong>{t(locale, "localProcessing")}</strong><p>{t(locale, "automationDisclosure")}</p></div></div>
    {!status.supported ? <p className="automation-unsupported">{t(locale, "automationUnsupported")}</p> : <>
      <div className="permission-grid">
        <article><span>{t(locale, "notificationAccess")}</span><b className={status.accessGranted ? "granted" : ""}>{t(locale, status.accessGranted ? "accessGranted" : "accessNotGranted")}</b><button type="button" disabled={busy} onClick={onOpenAccessSettings}>{t(locale, "openNotificationSettings")}</button></article>
        <article><span>{t(locale, "alertPermission")}</span><b className={status.alertPermissionGranted ? "granted" : ""}>{t(locale, status.alertPermissionGranted ? "permissionGranted" : "permissionNotGranted")}</b><button type="button" disabled={busy || status.alertPermissionGranted} onClick={onRequestAlertPermission}>{t(locale, "requestPermission")}</button></article>
      </div>
      <div className="automation-section-heading"><h3>{t(locale, "registeredSources")}</h3><button type="button" disabled={busy} onClick={onRefresh}><RefreshCw />{t(locale, "refresh")}</button></div>
      {ledger.automationSources.length ? <div className="automation-source-list">{ledger.automationSources.map((source) => <article key={source.packageName}><div><strong>{source.displayName}</strong><small>{source.packageName}</small></div><button type="button" disabled={busy} onClick={() => onRemoveSource(source.packageName)} aria-label={`${t(locale, "removeCardApp")}: ${source.displayName}`}><Trash2 /></button></article>)}</div> : <p className="automation-empty">{t(locale, "noRegisteredSources")}</p>}
      {availableApps.length ? <div className="automation-add-list"><h4>{t(locale, "addCardApp")}</h4>{availableApps.map((source) => <button type="button" key={source.packageName} disabled={busy} onClick={() => onRegisterSource(source)}><Plus /><span><strong>{source.displayName}</strong><small>{source.packageName}</small></span></button>)}</div> : null}
      <div className="automation-section-heading"><h3>{t(locale, "pendingExpenses")}</h3><span>{pending.length.toLocaleString(locale)}</span></div>
      {pending.length ? <div className="candidate-list">{pending.map((candidate) => <article key={`${candidate.packageName}:${candidate.id}`}>
        <div className="candidate-heading"><span><strong>{candidate.merchant}</strong><small>{candidate.sourceName} · {dateFormatter.format(new Date(candidate.occurredAt))}</small></span><b>{formatMoney(candidate.minorUnits, candidate.currency, locale)}</b></div>
        <span className={`confidence-chip ${candidate.confidence}`}>{t(locale, candidate.confidence === "high" ? "highConfidence" : "needsReview")}</span>
        {!registeredPackages.has(candidate.packageName) ? <button className="wide-secondary" type="button" disabled={busy} onClick={() => onRegisterSource(Object.freeze({ packageName: candidate.packageName, displayName: candidate.sourceName }))}>{t(locale, "registerSource")}</button> : null}
        <div className="candidate-actions"><button type="button" disabled={busy} onClick={() => onDismiss(candidate)}><Trash2 />{t(locale, "dismissCandidate")}</button><button className="primary-button" type="button" disabled={busy} onClick={() => onConfirm(candidate)}><Check />{t(locale, "confirmExpense")}</button></div>
      </article>)}</div> : <p className="automation-empty">{t(locale, "noPendingExpenses")}</p>}
    </>}
  </SheetFrame>;
}

function minorUnitsInput(minorUnits: number, currency: string): string {
  const digits = currencyDigits(currency);
  return (minorUnits / 10 ** digits).toFixed(digits);
}
