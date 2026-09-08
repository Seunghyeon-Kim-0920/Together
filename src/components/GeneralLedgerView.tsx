import { ArrowRightLeft, ChevronLeft, ChevronRight, FileDown, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { NativeCardCandidate } from "../lib/cardAutomation";
import { currencyDigits, formatMoney, parseMinorUnits } from "../lib/currency";
import { generalCategoryLabel, t } from "../lib/i18n";
import { exchangeText as x } from "../lib/exchangeI18n";
import { documentText as d } from "../lib/documentI18n";
import { saveLedgerPdf } from "../lib/ledgerPdf";
import { merchantDisplayName, preserveImportedMerchantDescription } from "../lib/merchant";
import type { CardAutomationStatus } from "../lib/nativeCardAutomation";
import { addMonths, annualAverageComparison, categoryTotals, monthKey, monthlyTotals, previousMonthComparison, yearlyTotals } from "../lib/statistics";
import { GENERAL_CATEGORIES, type AutomationSource, type GeneralCategory, type GeneralExpense, type GeneralLedger, type Locale } from "../lib/types";
import { defaultDate, newestExpensesFirst, replaceExpenseById } from "../lib/wallet";
import { GeneralLedgerAutomation } from "./GeneralLedgerAutomation";
import { SheetFrame } from "./Sheets";

type Notify = (message: string, tone?: "success" | "error" | "info") => void;

export function GeneralLedgerView({ ledger, locale, automationStatus, pendingAutomation, automationBusy, onImportStatements, onAutomationRefresh, onOpenAutomationSettings, onRequestAutomationAlertPermission, onToggleAllPaymentApps, onRegisterAutomationSource, onRemoveAutomationSource, onConfirmAutomationExpense, onDismissAutomationCandidate, onMove, onChange, onNotify }: { ledger: GeneralLedger; locale: Locale; automationStatus: CardAutomationStatus; pendingAutomation: readonly NativeCardCandidate[]; automationBusy: boolean; onImportStatements: () => void; onAutomationRefresh: () => void; onOpenAutomationSettings: () => void; onRequestAutomationAlertPermission: () => void; onToggleAllPaymentApps: (enabled: boolean) => void; onRegisterAutomationSource: (source: AutomationSource) => void; onRemoveAutomationSource: (packageName: string) => void; onConfirmAutomationExpense: (candidate: NativeCardCandidate, asNewTransaction?: boolean) => void; onDismissAutomationCandidate: (candidate: NativeCardCandidate) => void; onMove: (expense: GeneralExpense) => void; onChange: (ledger: GeneralLedger) => void; onNotify: Notify }) {
  const [selectedMonth, setSelectedMonth] = useState(monthKey(new Date()));
  const [category, setCategory] = useState<GeneralCategory | "all">("all");
  const [formOpen, setFormOpen] = useState(false);
  const [expenseToEdit, setExpenseToEdit] = useState<GeneralExpense | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false); const pdfLock = useRef(false);
  const year = Number(selectedMonth.slice(0, 4));
  const month = Number(selectedMonth.slice(5, 7));
  const comparison = useMemo(() => previousMonthComparison(ledger.expenses, selectedMonth, category), [ledger.expenses, selectedMonth, category]);
  const averageComparison = useMemo(() => annualAverageComparison(ledger.expenses, selectedMonth, category), [ledger.expenses, selectedMonth, category]);
  const monthCategories = useMemo(() => categoryTotals(ledger.expenses, selectedMonth), [ledger.expenses, selectedMonth]);
  const yearCategories = useMemo(() => categoryTotals(ledger.expenses, String(year)), [ledger.expenses, year]);
  const bars = useMemo(() => monthlyTotals(ledger.expenses, year, category), [ledger.expenses, year, category]);
  const years = useMemo(() => yearlyTotals(ledger.expenses, category), [ledger.expenses, category]);
  const allYears = useMemo(() => {
    const values = new Set(yearlyTotals(ledger.expenses).map((item) => item.year)); values.add(new Date().getFullYear()); values.add(year); return [...values].sort((a, b) => b - a);
  }, [ledger.expenses, year]);
  const monthExpenses = useMemo(() => newestExpensesFirst(ledger.expenses.filter((expense) => expense.occurredOn.startsWith(selectedMonth) && (category === "all" || expense.category === category))), [ledger.expenses, selectedMonth, category]);
  const maxMonthBar = Math.max(...bars, 1);
  const maxYearBar = Math.max(...years.map((item) => item.total), 1);
  const monthCategoryTotal = [...monthCategories.values()].reduce((sum, total) => sum + total, 0);
  const yearCategoryTotal = [...yearCategories.values()].reduce((sum, total) => sum + total, 0);
  const annualTotal = bars.reduce((sum, total) => sum + total, 0);
  const update = (expenses: readonly GeneralExpense[]) => onChange(Object.freeze({ ...ledger, expenses: Object.freeze(expenses), updatedAt: new Date().toISOString() }));
  const openNewExpense = () => { setExpenseToEdit(null); setFormOpen(true); };
  const exportPdf = async () => {
    if (pdfLock.current) return;
    pdfLock.current = true; setPdfBusy(true);
    try { if (await saveLedgerPdf(ledger, locale)) onNotify(t(locale, "pdfReady"), "success"); }
    catch (error) { if (!(error instanceof Error && error.name === "AbortError")) onNotify(t(locale, "pdfFailed"), "error"); }
    finally { pdfLock.current = false; setPdfBusy(false); }
  };
  const comparisonCopy = (percent: number | null) => percent === null ? t(locale, "newSpending") : percent === 0 ? t(locale, "noChange") : `${Math.abs(percent).toLocaleString(locale)}% ${percent > 0 ? t(locale, "moreSpent") : t(locale, "lessSpent")}`;

  return <section className="ledger-screen general-ledger">
    <div className="ledger-screen-heading"><div><span>{t(locale, "generalLedger")}</span><h2>{ledger.title}</h2></div><div className="heading-actions"><button type="button" disabled={pdfBusy} title={d(locale, "saveHelp")} onClick={() => void exportPdf()}><FileDown />{t(locale, "exportPdf")}</button><button className="primary-compact" type="button" onClick={openNewExpense}><Plus />{t(locale, "addExpense")}</button></div></div>
    {pdfBusy ? <p role="status">{d(locale, "saving")}</p> : null}
    <div className="month-navigation"><button type="button" aria-label={t(locale, "previousMonthButton")} onClick={() => setSelectedMonth(addMonths(selectedMonth, -1))}><ChevronLeft /></button><label><span className="sr-only">{t(locale, "selectMonth")}</span><input type="month" value={selectedMonth} onChange={(event) => { if (event.target.value) setSelectedMonth(event.target.value); }} /></label><button type="button" aria-label={t(locale, "nextMonthButton")} onClick={() => setSelectedMonth(addMonths(selectedMonth, 1))}><ChevronRight /></button></div>
    <section className="month-summary">
      <article><small>{t(locale, "selectedMonthSpending")}</small><strong>{formatMoney(comparison.current, ledger.currency, locale)}</strong></article>
      <ComparisonCard label={t(locale, "comparedToPrevious")} difference={comparison.difference} currency={ledger.currency} locale={locale} copy={comparisonCopy(comparison.percent)} />
      <ComparisonCard label={t(locale, "comparedToAnnualAverage")} difference={averageComparison.difference} currency={ledger.currency} locale={locale} copy={comparisonCopy(averageComparison.percent)} />
    </section>
    <GeneralLedgerAutomation ledger={ledger} locale={locale} selectedMonth={selectedMonth} status={automationStatus} pending={pendingAutomation} busy={automationBusy} onImportStatements={onImportStatements} onRefresh={onAutomationRefresh} onOpenAccessSettings={onOpenAutomationSettings} onRequestAlertPermission={onRequestAutomationAlertPermission} onToggleAllPaymentApps={onToggleAllPaymentApps} onRegisterSource={onRegisterAutomationSource} onRemoveSource={onRemoveAutomationSource} onConfirm={onConfirmAutomationExpense} onDismiss={onDismissAutomationCandidate} onChange={onChange} onNotify={onNotify} />
    <section className="mobile-panel category-breakdown"><div className="section-heading"><h3>{t(locale, "categorySpending")}</h3><label className="stats-filter"><span>{t(locale, "statsFilter")}</span><select value={category} onChange={(event) => setCategory(event.target.value as GeneralCategory | "all")}><option value="all">{t(locale, "allCategories")}</option>{GENERAL_CATEGORIES.map((code) => <option value={code} key={code}>{generalCategoryLabel(locale, code)}</option>)}</select></label></div>{monthCategories.size ? <CategoryBars totals={monthCategories} grandTotal={monthCategoryTotal} currency={ledger.currency} locale={locale} /> : <p className="ledger-empty">{t(locale, "noExpenses")}</p>}</section>
    <section className="mobile-panel annual-chart">
      <div className="section-heading"><h3>{t(locale, "monthlySpending")}</h3><label className="year-select"><span className="sr-only">{t(locale, "selectYear")}</span><select value={year} onChange={(event) => setSelectedMonth(`${event.target.value}-${String(month).padStart(2, "0")}`)}>{allYears.map((value) => <option value={value} key={value}>{value}</option>)}</select></label></div>
      <div className="bar-chart" role="img" aria-label={t(locale, "monthlySpending")}>{bars.map((total, index) => <button className={month === index + 1 ? "selected" : ""} type="button" key={index} onClick={() => setSelectedMonth(`${year}-${String(index + 1).padStart(2, "0")}`)} aria-label={`${new Intl.DateTimeFormat(locale, { month: "long" }).format(new Date(year, index, 1))}: ${formatMoney(total, ledger.currency, locale)}`}><span className="bar-value">{total ? compactMoney(total, ledger.currency, locale) : ""}</span><i><b style={{ height: `${Math.max(total ? 7 : 1, total / maxMonthBar * 100)}%` }} /></i><small>{new Intl.DateTimeFormat(locale, { month: "short" }).format(new Date(year, index, 1))}</small></button>)}</div>
      <div className="annual-footer"><span>{t(locale, "annualTotal")}<strong>{formatMoney(annualTotal, ledger.currency, locale)}</strong></span><span>{t(locale, "monthlyAverage")}<strong>{formatMoney(averageComparison.average, ledger.currency, locale)}</strong></span></div>
    </section>
    <section className="mobile-panel yearly-chart"><div className="section-heading"><h3>{t(locale, "yearlySpending")}</h3></div>{years.length ? <div className="year-bars">{years.map((item) => <button type="button" className={item.year === year ? "selected" : ""} key={item.year} onClick={() => setSelectedMonth(`${item.year}-${String(month).padStart(2, "0")}`)}><span>{item.year}</span><i><b style={{ width: `${Math.max(4, item.total / maxYearBar * 100)}%` }} /></i><strong>{formatMoney(item.total, ledger.currency, locale)}</strong></button>)}</div> : <p className="ledger-empty">{t(locale, "noExpenses")}</p>}</section>
    <section className="mobile-panel yearly-category-breakdown"><div className="section-heading"><h3>{t(locale, "yearlyCategorySpending")}</h3><strong>{year}</strong></div>{yearCategories.size ? <CategoryBars totals={yearCategories} grandTotal={yearCategoryTotal} currency={ledger.currency} locale={locale} /> : <p className="ledger-empty">{t(locale, "noExpenses")}</p>}</section>
    <section className="mobile-panel expense-history"><div className="section-heading"><h3>{t(locale, "history")}</h3></div>{monthExpenses.length ? <div className="expense-list">{monthExpenses.map((expense) => <article key={expense.id}><span className={`category-color category-${expense.category}`} /><div><strong>{merchantDisplayName(expense.description, expense.id)}</strong><small>{generalCategoryLabel(locale, expense.category)} · {expense.occurredOn}</small></div><b>{formatMoney(expense.minorUnits, expense.currency, locale)}</b><span className="expense-actions"><button type="button" aria-label={t(locale, "edit")} onClick={() => { setExpenseToEdit(expense); setFormOpen(true); }}><Pencil /></button><button type="button" aria-label={t(locale, "delete")} onClick={() => { update(ledger.expenses.filter((candidate) => candidate.id !== expense.id)); onNotify(t(locale, "expenseDeleted"), "success"); }}><Trash2 /></button></span><button className="move-expense-button" type="button" onClick={() => onMove(expense)}><ArrowRightLeft />{x(locale, "move")}</button></article>)}</div> : <p className="ledger-empty">{t(locale, "noExpenses")}</p>}</section>
    <button className="floating-add" type="button" onClick={openNewExpense}><Plus />{t(locale, "addExpense")}</button>
    {formOpen ? <GeneralExpenseSheet ledger={ledger} locale={locale} expense={expenseToEdit} onClose={() => { setFormOpen(false); setExpenseToEdit(null); }} onSave={(expense) => { update(expenseToEdit ? replaceExpenseById(ledger.expenses, expense) : [...ledger.expenses, expense]); setFormOpen(false); setExpenseToEdit(null); onNotify(t(locale, expenseToEdit ? "expenseUpdated" : "expenseAdded"), "success"); }} onNotify={onNotify} /> : null}
  </section>;
}

function ComparisonCard({ label, difference, currency, locale, copy }: { label: string; difference: number; currency: string; locale: Locale; copy: string }) {
  return <article className={difference > 0 ? "increase" : difference < 0 ? "decrease" : "neutral"}><small>{label}</small><strong>{copy}</strong><span>{difference === 0 ? formatMoney(0, currency, locale) : `${difference > 0 ? "+" : "−"}${formatMoney(Math.abs(difference), currency, locale)}`}</span></article>;
}

function CategoryBars({ totals, grandTotal, currency, locale }: { totals: ReadonlyMap<GeneralCategory, number>; grandTotal: number; currency: string; locale: Locale }) {
  return <div className="category-bars">{[...totals].sort(([, a], [, b]) => b - a).map(([code, total]) => <div key={code}><span>{generalCategoryLabel(locale, code)}</span><i><b style={{ width: `${grandTotal ? Math.max(3, total / grandTotal * 100) : 0}%` }} /></i><strong>{formatMoney(total, currency, locale)}</strong></div>)}</div>;
}

function GeneralExpenseSheet({ ledger, locale, expense, onClose, onSave, onNotify }: { ledger: GeneralLedger; locale: Locale; expense: GeneralExpense | null; onClose: () => void; onSave: (expense: GeneralExpense) => void; onNotify: Notify }) {
  const [description, setDescription] = useState(expense ? merchantDisplayName(expense.description, expense.id) : "");
  const [amount, setAmount] = useState(expense ? minorUnitsInput(expense.minorUnits, expense.currency) : "");
  const [category, setCategory] = useState<GeneralCategory>(expense?.category ?? "food");
  const [occurredOn, setOccurredOn] = useState(expense?.occurredOn ?? defaultDate());
  const submit = () => {
    const minorUnits = parseMinorUnits(amount, ledger.currency); const editedDescription = description.trim();
    if (!editedDescription || !occurredOn) return onNotify(t(locale, "requiredFields"), "error");
    if (!minorUnits) return onNotify(t(locale, "amountInvalid"), "error");
    onSave(Object.freeze({ id: expense?.id ?? crypto.randomUUID(), description: expense ? preserveImportedMerchantDescription(expense.description, editedDescription, expense.id) : editedDescription, category, currency: ledger.currency, minorUnits, occurredOn, ...(expense?.automationFingerprint ? { automationFingerprint: expense.automationFingerprint } : {}), ...(expense?.automationReversalFingerprint ? { automationReversalFingerprint: expense.automationReversalFingerprint } : {}) }));
  };
  return <SheetFrame title={t(locale, expense ? "editExpense" : "addExpense")} locale={locale} onClose={onClose}><div className="expense-form-grid"><label>{t(locale, "description")}<input value={description} maxLength={500} onChange={(event) => setDescription(event.target.value)} autoFocus /></label><label>{t(locale, "amount")}<div className="amount-field"><input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /><span>{ledger.currency}</span></div></label><label>{t(locale, "category")}<select value={category} onChange={(event) => setCategory(event.target.value as GeneralCategory)}>{GENERAL_CATEGORIES.map((code) => <option value={code} key={code}>{generalCategoryLabel(locale, code)}</option>)}</select></label><label>{t(locale, "date")}<input type="date" value={occurredOn} onChange={(event) => setOccurredOn(event.target.value)} /></label><button className="primary-button wide" type="button" onClick={submit}>{t(locale, expense ? "saveChanges" : "addExpense")}</button></div></SheetFrame>;
}

function compactMoney(minorUnits: number, currency: string, locale: Locale): string { return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(minorUnits / 10 ** currencyDigits(currency)); }
function minorUnitsInput(minorUnits: number, currency: string): string { const digits = currencyDigits(currency); return (minorUnits / 10 ** digits).toFixed(digits); }
