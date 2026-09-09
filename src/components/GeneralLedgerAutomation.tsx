import { Check, ChevronRight, Gauge, Globe2, ReceiptText, RefreshCw, RotateCcw, ShieldCheck, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { automationExpenseId, automationReversalFingerprint, calculateMonthlyLimitStatus, completeCandidateMerchant, reversalMatchIndexes, type NativeCardCandidate } from "../lib/cardAutomation";
import { currencyDigits, formatMoney, parseMinorUnits } from "../lib/currency";
import { designText as ux } from "../lib/designI18n";
import { t } from "../lib/i18n";
import { cardAutomationConnectionState, cardAutomationPlugin, type CardAutomationStatus } from "../lib/nativeCardAutomation";
import { notificationText as n } from "../lib/notificationI18n";
import type { AutomationSource, GeneralLedger, Locale } from "../lib/types";
import { SheetFrame } from "./Sheets";

type Notify = (message: string, tone?: "success" | "error" | "info") => void;

export function GeneralLedgerAutomation({ ledger, locale, selectedMonth, status, pending, busy, onImportStatements, onRefresh, onOpenAccessSettings, onRequestAlertPermission, onToggleAllPaymentApps, onRegisterSource, onRemoveSource, onConfirm, onDismiss, onChange, onNotify }: { ledger: GeneralLedger; locale: Locale; selectedMonth: string; status: CardAutomationStatus; pending: readonly NativeCardCandidate[]; busy: boolean; onImportStatements: () => void; onRefresh: () => void; onOpenAccessSettings: () => void; onRequestAlertPermission: () => void; onToggleAllPaymentApps: (enabled: boolean) => void; onRegisterSource: (source: AutomationSource) => void; onRemoveSource: (packageName: string) => void; onConfirm: (candidate: NativeCardCandidate, asNewTransaction?: boolean) => void; onDismiss: (candidate: NativeCardCandidate) => void; onChange: (ledger: GeneralLedger) => void; onNotify: Notify }) {
  const [limitOpen, setLimitOpen] = useState(false);
  const [automationOpen, setAutomationOpen] = useState(false);
  const limit = useMemo(() => calculateMonthlyLimitStatus(ledger, selectedMonth), [ledger, selectedMonth]);
  const progress = Math.min(limit.percent ?? 0, 100);
  const connection = cardAutomationConnectionState(status);
  const captureConfigured = ledger.automationAllApps || ledger.automationSources.length > 0;

  const saveLimit = (monthlyLimitMinor: number | null) => {
    onChange(Object.freeze({ ...ledger, monthlyLimitMinor, updatedAt: new Date().toISOString() }));
    setLimitOpen(false);
    onNotify(t(locale, "limitSaved"), "success");
  };

  return <>
    <section className={`mobile-panel limit-card budget-summary limit-${limit.state}`}>
      <button className="summary-setting-row" type="button" onClick={() => setLimitOpen(true)} aria-label={t(locale, "setMonthlyLimit")}>
        <span className="summary-setting-icon"><Gauge aria-hidden="true" /></span>
        <span className="summary-setting-copy"><strong>{ux(locale, "selectedMonthBudget")}</strong>{limit.limitMinor === null ? <small>{ux(locale, "budgetNotSet")}</small> : null}</span>
        <ChevronRight className="summary-setting-arrow" aria-hidden="true" />
      </button>
      {limit.limitMinor !== null ? <div className="budget-summary-values">
        <p><strong>{formatMoney(Math.abs(limit.remainingMinor ?? 0), ledger.currency, locale)} <span>{t(locale, limit.remainingMinor !== null && limit.remainingMinor >= 0 ? "monthlyLimitRemaining" : "monthlyLimitExceeded")}</span></strong><small>{formatMoney(limit.limitMinor, ledger.currency, locale)}</small></p>
        <div className="limit-progress" role="progressbar" aria-label={t(locale, "monthlyLimitSpent")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)} aria-valuetext={`${formatMoney(limit.spentMinor, ledger.currency, locale)} · ${Math.round(limit.percent ?? 0).toLocaleString(locale)}%`}><i style={{ width: `${progress}%` }} /></div>
        <p><small>{t(locale, "monthlyLimitSpent")} {formatMoney(limit.spentMinor, ledger.currency, locale)}</small><small>{Math.round(limit.percent ?? 0).toLocaleString(locale)}%</small></p>
        {limit.state === "near" ? <em>{t(locale, "monthlyLimitNear")}</em> : null}
      </div> : null}
    </section>
    <section className="mobile-panel automation-card automation-summary">
      <button className="summary-setting-row" type="button" onClick={() => setAutomationOpen(true)}>
        <span className="summary-setting-icon"><ReceiptText aria-hidden="true" /></span>
        <span className="summary-setting-copy"><strong>{ux(locale, "automationTitle")}</strong>{connection === "disconnected" ? <small className="automation-connection-warning">{n(locale, "listenerDisconnected")}</small> : connection === "unknown" ? <small>{n(locale, "listenerUnknown")}</small> : connection === "connected" && !captureConfigured ? <small>{n(locale, "captureNotConfigured")}</small> : null}{pending.length ? <span className="pending-count">{ux(locale, "automationReview")}: {pending.length.toLocaleString(locale)}</span> : connection === "disconnected" || connection === "unknown" || connection === "connected" && !captureConfigured ? null : <small>{!status.supported ? t(locale, "automationUnsupported") : status.accessGranted ? t(locale, "noPendingExpenses") : `${t(locale, "notificationAccess")} · ${t(locale, "accessNotGranted")}`}</small>}</span>
        <ChevronRight className="summary-setting-arrow" aria-hidden="true" />
      </button>
    </section>
    {limitOpen ? <MonthlyLimitSheet ledger={ledger} locale={locale} onClose={() => setLimitOpen(false)} onSave={saveLimit} onNotify={onNotify} /> : null}
    {automationOpen ? <CardAutomationSheet ledger={ledger} locale={locale} status={status} pending={pending} busy={busy} onImportStatements={onImportStatements} onRefresh={onRefresh} onOpenAccessSettings={onOpenAccessSettings} onRequestAlertPermission={onRequestAlertPermission} onToggleAllPaymentApps={onToggleAllPaymentApps} onRegisterSource={onRegisterSource} onRemoveSource={onRemoveSource} onConfirm={onConfirm} onDismiss={onDismiss} onClose={() => setAutomationOpen(false)} /> : null}
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

function CardAutomationSheet({ ledger, locale, status, pending, busy, onImportStatements, onRefresh, onOpenAccessSettings, onRequestAlertPermission, onToggleAllPaymentApps, onRegisterSource, onRemoveSource, onConfirm, onDismiss, onClose }: { ledger: GeneralLedger; locale: Locale; status: CardAutomationStatus; pending: readonly NativeCardCandidate[]; busy: boolean; onImportStatements: () => void; onRefresh: () => void; onOpenAccessSettings: () => void; onRequestAlertPermission: () => void; onToggleAllPaymentApps: (enabled: boolean) => void; onRegisterSource: (source: AutomationSource) => void; onRemoveSource: (packageName: string) => void; onConfirm: (candidate: NativeCardCandidate, asNewTransaction?: boolean) => void; onDismiss: (candidate: NativeCardCandidate) => void; onClose: () => void }) {
  const registeredPackages = useMemo(() => new Set(ledger.automationSources.map((source) => source.packageName)), [ledger.automationSources]);
  const [directAppConfirmations, setDirectAppConfirmations] = useState<ReadonlySet<string>>(() => new Set());
  const [newTransactionConfirmations, setNewTransactionConfirmations] = useState<ReadonlySet<string>>(() => new Set());
  const [merchantDrafts, setMerchantDrafts] = useState<Readonly<Record<string, string>>>({});
  const [rechecking, setRechecking] = useState(false);
  const [recheckError, setRecheckError] = useState(false);
  const connection = cardAutomationConnectionState(status);
  const captureConfigured = ledger.automationAllApps || ledger.automationSources.length > 0;
  const recheck = async () => {
    if (rechecking) return;
    setRechecking(true); setRecheckError(false);
    try { await cardAutomationPlugin.recheckActiveNotifications(); }
    catch { setRecheckError(true); }
    finally { setRechecking(false); onRefresh(); }
  };
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }), [locale]);
  const reviewTravelLedgers = () => {
    onClose();
    requestAnimationFrame(() => {
      const tabs = document.getElementById("wallet-ledger-tabs");
      tabs?.scrollIntoView({ block: "center" });
      tabs?.focus({ preventScroll: true });
    });
  };

  return <SheetFrame title={notificationAutomationLabel(locale)} locale={locale} onClose={onClose}>
    {status.supported ? <section className={`automation-connection-panel connection-${connection}`} aria-label={n(locale, "listenerTitle")}>
      <strong>{n(locale, "listenerTitle")}</strong>
      <p className={connection === "connected" ? "granted" : "automation-connection-warning"} role="status">{connection === "access-required" ? `${t(locale, "notificationAccess")} · ${t(locale, "accessNotGranted")}` : n(locale, connection === "disconnected" ? "listenerDisconnected" : connection === "connected" ? "listenerConnected" : "listenerUnknown")}</p>
      {connection === "disconnected" ? <p>{n(locale, "disconnected")}</p> : null}
      {!captureConfigured ? <p className="automation-connection-warning">{n(locale, "captureSetupHelp")}</p> : null}
      {status.accessGranted ? <><button className={connection === "connected" ? "wide-secondary" : "primary-button"} type="button" disabled={busy || rechecking} onClick={() => void recheck()}><RefreshCw aria-hidden="true" />{n(locale, rechecking ? "reconnecting" : connection === "connected" ? "recheck" : "reconnect")}</button><p className="sheet-intro">{n(locale, "recheckHelp")}</p></> : <button className="primary-button" type="button" disabled={busy} onClick={onOpenAccessSettings}>{t(locale, "openNotificationSettings")}</button>}
      {recheckError ? <p className="exchange-error" role="alert">{n(locale, "recheckError")}</p> : null}
    </section> : null}
    <div className="automation-disclosure"><ShieldCheck /><div><strong>{t(locale, "localProcessing")}</strong><p>{t(locale, "automationDisclosure")}</p><p>{n(locale, "history")}</p></div></div>
    <div className="bank-connection-status"><strong>{n(locale, "bankNotConnected")}</strong><p>{n(locale, "bankConnectionHelp")}</p><button className="wide-secondary" type="button" onClick={() => { onClose(); onImportStatements(); }}>{n(locale, "importStatement")}</button></div>
    {!status.supported ? <p className="automation-unsupported">{t(locale, "automationUnsupported")}</p> : <>
      <div className="permission-grid">
        <article><span>{t(locale, "notificationAccess")}</span><b className={status.accessGranted ? "granted" : ""}>{t(locale, status.accessGranted ? "accessGranted" : "accessNotGranted")}</b><button type="button" disabled={busy} onClick={onOpenAccessSettings}>{t(locale, "openNotificationSettings")}</button></article>
        <article><span>{t(locale, "alertPermission")}</span><b className={status.alertPermissionGranted ? "granted" : ""}>{t(locale, status.alertPermissionGranted ? "permissionGranted" : "permissionNotGranted")}</b><button type="button" disabled={busy || status.alertPermissionGranted} onClick={onRequestAlertPermission}>{t(locale, "requestPermission")}</button></article>
      </div>
      <label className="all-apps-toggle"><span><Globe2 /><b>{t(locale, "allPaymentApps")}</b><small>{t(locale, "allPaymentAppsHelp")}</small></span><input type="checkbox" role="switch" checked={ledger.automationAllApps} disabled={busy} onChange={(event) => onToggleAllPaymentApps(event.target.checked)} /></label>
      {!ledger.automationAllApps ? <p className="reversal-help">{n(locale, "discoveryOff")}</p> : null}
      <details className="notification-diagnostics"><summary>{n(locale, "recentChecks")}</summary><p className="sheet-intro">{n(locale, "recentChecksHelp")}</p>{status.lastRecoveryError ? <p className="exchange-error">{n(locale, "recoveryFailed")}</p> : null}<ul>{([
        ["lastListenerConnectedAt", "lastConnected"], ["lastListenerDisconnectedAt", "lastDisconnected"], ["lastRecoveryRequestedAt", "lastRecovery"], ["lastProcessingFailureAt", "lastProcessingFailure"],
      ] as const).map(([field, label]) => status[field] ? <li key={field}><strong>{n(locale, label)}</strong><small>{dateFormatter.format(new Date(status[field]))}</small></li> : null)}</ul>{status.recentChecks?.length ? <ul>{status.recentChecks.map((check) => <li key={check.packageName}><strong>{check.sourceName}</strong><span>{n(locale, check.recognized ? "recognized" : "notRecognized")}</span><small>{dateFormatter.format(new Date(check.checkedAt))}</small></li>)}</ul> : <p className="automation-empty">{n(locale, "noChecks")}</p>}</details>
      <div className="automation-section-heading"><h3>{t(locale, "registeredSources")}</h3><button type="button" disabled={busy} onClick={onRefresh}><RefreshCw />{t(locale, "refresh")}</button></div>
      {ledger.automationSources.length ? <div className="automation-source-list">{ledger.automationSources.map((source) => <article key={source.packageName}><div><strong>{source.displayName}</strong><small>{source.packageName}</small></div><button type="button" disabled={busy} onClick={() => onRemoveSource(source.packageName)} aria-label={`${t(locale, "removeCardApp")}: ${source.displayName}`}><Trash2 /></button></article>)}</div> : <p className="automation-empty">{t(locale, "noRegisteredSources")}</p>}
      <div className="automation-section-heading"><h3>{t(locale, "pendingExpenses")}</h3><span>{pending.length.toLocaleString(locale)}</span></div>
      {pending.length ? <div className="candidate-list">{pending.map((nativeCandidate) => { const draftKey = `${nativeCandidate.packageName}:${nativeCandidate.id}:${nativeCandidate.queueToken ?? ""}`; const draft = merchantDrafts[draftKey]?.trim() ?? ""; const candidate = nativeCandidate.requiresMerchant && draft ? completeCandidateMerchant(nativeCandidate, draft) : nativeCandidate; const wrongCurrency = candidate.currency !== ledger.currency; const movedReversal = candidate.eventType === "reversal" && (ledger.movedExpenseIds.includes(automationExpenseId(candidate)) || ledger.movedExpenseIds.includes(automationReversalFingerprint(candidate))); const reversalHandled = candidate.eventType === "reversal" && ledger.automationReversalIds.includes(automationReversalFingerprint(candidate)); const reversalMatches = reversalHandled ? 0 : reversalMatchIndexes(ledger.expenses, candidate).length; const registered = registeredPackages.has(candidate.packageName); const directAppConfirmed = directAppConfirmations.has(candidate.packageName); return <article key={draftKey}>
        <div className="candidate-heading"><span><strong>{candidate.merchant || n(locale, "merchantUnknown")}</strong><small>{candidate.sourceName} · {dateFormatter.format(new Date(candidate.occurredAt))}</small></span><b>{formatMoney(candidate.minorUnits, candidate.currency, locale)}</b></div>
        {nativeCandidate.requiresMerchant ? <><p className="reversal-help">{n(locale, "merchantRequired")}</p><label className="field-label">{t(locale, "description")}<input aria-label={n(locale, "merchantUnknown")} value={merchantDrafts[draftKey] ?? ""} maxLength={100} disabled={busy} onChange={(event) => setMerchantDrafts((current) => ({ ...current, [draftKey]: event.target.value }))} /></label></> : null}
        {wrongCurrency ? <p className="reversal-help">{n(locale, "currencyMismatch").replace("{currency}", candidate.currency)}</p> : null}
        {candidate.identityConflict ? <><p className="reversal-help">{n(locale, "identityConflictHelp")}</p><label className="direct-source-confirm"><input type="checkbox" checked={newTransactionConfirmations.has(draftKey)} disabled={busy} onChange={(event) => setNewTransactionConfirmations((current) => { const next = new Set(current); if (event.target.checked) next.add(draftKey); else next.delete(draftKey); return next; })} /><span>{n(locale, "confirmNewTransaction")}</span></label></> : null}
        <span className={`confidence-chip ${candidate.confidence}`}>{candidate.eventType === "reversal" ? <><RotateCcw />{t(locale, "cancellationReview")}</> : <>{automationEventTypeLabel(locale, candidate.eventType)} · {candidate.confidence === "high" ? automationConfidenceLabel(locale) : t(locale, "needsReview")}</>}</span>
        {candidate.manualOnly ? <p className="reversal-help">{t(locale, "manualReviewSource")}</p> : null}
        {!registered && !candidate.manualOnly && !wrongCurrency ? <><label className="direct-source-confirm"><input type="checkbox" checked={directAppConfirmed} disabled={busy} onChange={(event) => setDirectAppConfirmations((current) => { const next = new Set(current); if (event.target.checked) next.add(candidate.packageName); else next.delete(candidate.packageName); return next; })} /><span>{t(locale, "confirmDirectPaymentApp")}</span></label><button className="wide-secondary" type="button" disabled={busy || !directAppConfirmed} onClick={() => onRegisterSource(Object.freeze({ packageName: candidate.packageName, displayName: candidate.sourceName, trustedDirectApp: true }))}>{t(locale, "registerSource")}</button></> : null}
        {candidate.eventType === "reversal" && !movedReversal && reversalMatches !== 1 ? <p className="reversal-help">{t(locale, reversalMatches > 1 ? "cancellationAmbiguous" : "cancellationNoMatch")}</p> : null}
        {movedReversal ? <><p className="reversal-help">{movedReversalNotice(locale)}</p><button className="wide-secondary" type="button" disabled={busy} onClick={reviewTravelLedgers}>{reviewTravelLedgersLabel(locale)}</button></> : null}
        <div className="candidate-actions"><button type="button" disabled={busy} onClick={() => onDismiss(candidate)}><Trash2 />{t(locale, "dismissCandidate")}</button><button className="primary-button" type="button" disabled={busy || (candidate.identityConflict && !newTransactionConfirmations.has(draftKey)) || wrongCurrency || candidate.requiresMerchant || movedReversal || (candidate.eventType === "reversal" && reversalMatches !== 1)} onClick={() => onConfirm(candidate, candidate.identityConflict && newTransactionConfirmations.has(draftKey))}><Check />{t(locale, candidate.eventType === "reversal" ? "applyCancellation" : "confirmExpense")}</button></div>
      </article>; })}</div> : <p className="automation-empty">{t(locale, "noPendingExpenses")}</p>}
    </>}
  </SheetFrame>;
}

function minorUnitsInput(minorUnits: number, currency: string): string {
  const digits = currencyDigits(currency);
  return (minorUnits / 10 ** digits).toFixed(digits);
}

function automationEventTypeLabel(locale: Locale, eventType: NativeCardCandidate["eventType"]): string {
  if (eventType === "outgoing_transfer") return t(locale, "outgoingTransferEvent");
  if (eventType === "direct_debit") return t(locale, "directDebitEvent");
  if (eventType === "standing_order") return t(locale, "standingOrderEvent");
  return t(locale, "paymentEvent");
}

function notificationAutomationLabel(locale: Locale): string {
  if (locale === "en") return "Notification-based payment & transfer records";
  if (locale === "fr") return "Paiements et virements à partir des notifications";
  return "알림 기반 결제·이체 자동기록";
}

function automationConfidenceLabel(locale: Locale): string {
  if (locale === "en") return "High-confidence match";
  if (locale === "fr") return "Détection à haute confiance";
  return "고신뢰 인식";
}

function movedReversalNotice(locale: Locale): string {
  if (locale === "en") return "This payment was moved to a travel ledger. Open that trip and review or delete the cancelled expense there; its settlement has not been changed automatically.";
  if (locale === "fr") return "Ce paiement a été déplacé dans un carnet de voyage. Ouvrez ce voyage pour vérifier ou supprimer la dépense annulée ; le règlement n’a pas été modifié automatiquement.";
  return "여행 가계부로 옮긴 결제의 취소입니다. 해당 여행을 열어 취소된 지출을 확인하거나 삭제해주세요. 여행 정산은 자동 변경되지 않았습니다.";
}

function reviewTravelLedgersLabel(locale: Locale): string {
  if (locale === "en") return "Review travel ledgers";
  if (locale === "fr") return "Vérifier les carnets de voyage";
  return "여행 가계부 확인";
}
