import { BedDouble, Download, Bus, FileDown, Landmark, Pencil, Plus, ReceiptText, Share2, ShoppingBag, Trash2, Utensils, UserPlus, WalletCards } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { availableCurrencies, currencyDigits, currencyName, formatMoney, parseMinorUnits } from "../lib/currency";
import { t, travelCategoryLabel } from "../lib/i18n";
import { exchangeText as x } from "../lib/exchangeI18n";
import { documentText as d } from "../lib/documentI18n";
import { saveLedgerPdf, shareLedgerPdf } from "../lib/ledgerPdf";
import type { Locale, Participant, TravelCategory, TravelExpense, TravelLedger } from "../lib/types";
import { TRAVEL_CATEGORIES } from "../lib/types";
import { createTravelExpense, defaultDate, newestExpensesFirst, replaceExpenseById, settleTravelExpenses } from "../lib/wallet";
import { SheetFrame } from "./Sheets";

type Notify = (message: string, tone?: "success" | "error" | "info") => void;

function CategoryIcon({ category }: { category: TravelCategory }) {
  const Icon = category === "accommodation" ? BedDouble : category === "transport" ? Bus : category === "food" ? Utensils : category === "activities" ? Landmark : category === "shopping" ? ShoppingBag : ReceiptText;
  return <Icon aria-hidden="true" />;
}

export function TravelLedgerView({ ledger, locale, onImport, onChange, onNotify }: { ledger: TravelLedger; locale: Locale; onImport: () => void; onChange: (ledger: TravelLedger) => void; onNotify: Notify }) {
  const [formOpen, setFormOpen] = useState(false); const [expenseToEdit, setExpenseToEdit] = useState<TravelExpense | null>(null); const [participantName, setParticipantName] = useState(""); const [filter, setFilter] = useState<TravelCategory | "all">("all"); const [currencyToAdd, setCurrencyToAdd] = useState("USD"); const [currencyEditorOpen, setCurrencyEditorOpen] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false); const pdfLock = useRef(false);
  const participantNames = useMemo(() => new Map(ledger.participants.map((person) => [person.id, person.name])), [ledger.participants]);
  const settlements = useMemo(() => settleTravelExpenses(ledger), [ledger]);
  const totals = useMemo(() => ledger.currencies.map((currency) => ({ currency, total: ledger.expenses.filter((expense) => expense.currency === currency).reduce((sum, expense) => sum + expense.minorUnits, 0) })), [ledger]);
  const visibleExpenses = filter === "all" ? ledger.expenses : ledger.expenses.filter((expense) => expense.category === filter);

  const update = (changes: Partial<TravelLedger>) => onChange(Object.freeze({ ...ledger, ...changes, updatedAt: new Date().toISOString() }));
  const addParticipant = () => {
    const name = participantName.trim(); if (!name) return;
    if (ledger.participants.some((person) => person.name.localeCompare(name, locale, { sensitivity: "accent" }) === 0)) return onNotify(t(locale, "duplicateName"), "error");
    const participant: Participant = Object.freeze({ id: crypto.randomUUID(), name });
    update({ participants: Object.freeze([...ledger.participants, participant]), selfParticipantId: ledger.selfParticipantId ?? participant.id }); setParticipantName(""); onNotify(t(locale, "participantAdded"), "success");
  };
  const removeParticipant = (id: string) => {
    if (ledger.expenses.some((expense) => expense.paidBy === id || expense.shares.some((share) => share.participantId === id))) return onNotify(t(locale, "participantInUse"), "error");
    update({ participants: Object.freeze(ledger.participants.filter((person) => person.id !== id)), selfParticipantId: ledger.selfParticipantId === id ? null : ledger.selfParticipantId });
  };
  const removeExpense = (id: string) => { update({ expenses: Object.freeze(ledger.expenses.filter((expense) => expense.id !== id)) }); onNotify(t(locale, "expenseDeleted"), "success"); };
  const addCurrency = () => { if (ledger.currencies.includes(currencyToAdd)) return; update({ currencies: Object.freeze([...ledger.currencies, currencyToAdd]) }); };
  const removeCurrency = (currency: string) => {
    if (currency === ledger.defaultCurrency || ledger.currencies.length === 1 || ledger.expenses.some((expense) => expense.currency === currency)) return;
    update({ currencies: Object.freeze(ledger.currencies.filter((code) => code !== currency)) });
  };
  const exportPdf = async (mode: "save" | "share") => {
    if (pdfLock.current) return;
    pdfLock.current = true; setPdfBusy(true);
    try {
      if (mode === "share") {
        const shared = await shareLedgerPdf(ledger, locale);
        onNotify(d(locale, shared ? "shared" : "downloaded"), "success");
      } else if (await saveLedgerPdf(ledger, locale)) onNotify(t(locale, "pdfReady"), "success");
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) onNotify(t(locale, mode === "share" ? "shareFailed" : "pdfFailed"), "error");
    } finally { pdfLock.current = false; setPdfBusy(false); }
  };

  return (
    <section className="ledger-screen">
      <div className="ledger-screen-heading"><div><span>{t(locale, "travelLedger")}</span><h2>{ledger.title}</h2></div><div className="heading-actions"><button type="button" disabled={pdfBusy} onClick={() => void exportPdf("save")} title={d(locale, "saveHelp")}><FileDown />{t(locale, "exportPdf")}</button></div></div>
      <section className="mobile-panel travel-exchange-panel"><div className="exchange-buttons"><button className="primary-button" type="button" disabled={pdfBusy} onClick={() => void exportPdf("share")}><Share2 />{d(locale, "sharePdf")}</button><button className="wide-secondary" type="button" onClick={onImport}><Download />{x(locale, "receive")}</button></div><p>{d(locale, "shareHelp")}</p>{pdfBusy ? <p role="status">{d(locale, "saving")}</p> : null}</section>
      <div className="money-summary">{totals.map(({ currency, total }) => <article key={currency}><small>{t(locale, "totalSpent")} · {currency}</small><strong>{formatMoney(total, currency, locale)}</strong></article>)}</div>
      <section className="mobile-panel participant-panel"><div className="section-heading"><h3>{t(locale, "participants")}</h3><button type="button" onClick={() => setCurrencyEditorOpen(true)}><WalletCards />{t(locale, "manageCurrencies")}</button></div>
        <div className="add-participant-row"><input value={participantName} maxLength={80} placeholder={t(locale, "participantName")} onChange={(event) => setParticipantName(event.target.value)} /><button type="button" onClick={addParticipant} disabled={!participantName.trim()}><UserPlus />{t(locale, "add")}</button></div>
        {ledger.participants.length ? <div className="participant-list">{ledger.participants.map((person) => <div key={person.id}><span className="avatar">{person.name.slice(0, 1).toUpperCase()}</span><strong>{person.name}</strong><label><input type="radio" name={`self-${ledger.id}`} checked={ledger.selfParticipantId === person.id} onChange={() => update({ selfParticipantId: person.id })} />{t(locale, "chooseYourself")}</label><button type="button" aria-label={`${person.name} ${t(locale, "delete")}`} onClick={() => removeParticipant(person.id)}><Trash2 /></button></div>)}</div> : <p className="empty-inline">{t(locale, "atLeastOneParticipant")}</p>}
      </section>
      <section className="mobile-panel settlement-panel"><div className="section-heading"><h3>{t(locale, "settlement")}</h3></div>{settlements.every((item) => item.transfers.length === 0) ? <p className="empty-inline">{t(locale, "settlementEmpty")}</p> : settlements.map((settlement) => <div className="currency-settlement" key={settlement.currency}><strong>{settlement.currency}</strong>{settlement.transfers.map((transfer, index) => <p key={`${transfer.from}-${transfer.to}-${index}`}><span>{participantNames.get(transfer.from)}</span><i>→</i><span>{participantNames.get(transfer.to)}</span><b>{formatMoney(transfer.minorUnits, transfer.currency, locale)}</b></p>)}</div>)}</section>
      <section className="mobile-panel expense-history"><div className="section-heading"><h3>{t(locale, "recentExpenses")}</h3><button className="primary-compact" type="button" onClick={() => { setExpenseToEdit(null); setFormOpen(true); }} disabled={ledger.participants.length === 0}><Plus />{t(locale, "addExpense")}</button></div>
        <div className="category-rail"><button className={filter === "all" ? "active" : ""} type="button" onClick={() => setFilter("all")}>{t(locale, "allCategories")}</button>{TRAVEL_CATEGORIES.map((category) => <button className={filter === category ? "active" : ""} type="button" key={category} onClick={() => setFilter(category)}>{travelCategoryLabel(locale, category)}</button>)}</div>
        {visibleExpenses.length ? <div className="expense-list">{newestExpensesFirst(visibleExpenses).map((expense) => <article key={expense.id}><span className="category-icon"><CategoryIcon category={expense.category} /></span><div><strong>{expense.description}</strong><small>{travelCategoryLabel(locale, expense.category)} · {participantNames.get(expense.paidBy)} · {expense.occurredOn}</small></div><b>{formatMoney(expense.minorUnits, expense.currency, locale)}</b><span className="expense-actions"><button type="button" aria-label={t(locale, "edit")} onClick={() => { setExpenseToEdit(expense); setFormOpen(true); }}><Pencil /></button><button type="button" aria-label={t(locale, "delete")} onClick={() => removeExpense(expense.id)}><Trash2 /></button></span></article>)}</div> : <p className="ledger-empty">{t(locale, "noExpenses")}</p>}
      </section>
      <button className="floating-add" type="button" onClick={() => { setExpenseToEdit(null); setFormOpen(true); }} disabled={ledger.participants.length === 0}><Plus />{t(locale, "addExpense")}</button>
      {formOpen ? <TravelExpenseSheet ledger={ledger} locale={locale} expense={expenseToEdit} onClose={() => { setFormOpen(false); setExpenseToEdit(null); }} onSave={(expense) => { update({ expenses: expenseToEdit ? replaceExpenseById(ledger.expenses, expense) : Object.freeze([...ledger.expenses, expense]) }); setFormOpen(false); setExpenseToEdit(null); onNotify(t(locale, expenseToEdit ? "expenseUpdated" : "expenseAdded"), "success"); }} onNotify={onNotify} /> : null}
      {currencyEditorOpen ? <SheetFrame title={t(locale, "manageCurrencies")} locale={locale} onClose={() => setCurrencyEditorOpen(false)}><div className="currency-list">{ledger.currencies.map((currency) => <div key={currency}><span>{currencyName(currency, locale)}</span>{currency !== ledger.defaultCurrency ? <button type="button" onClick={() => removeCurrency(currency)}>{t(locale, "removeCurrency")}</button> : null}</div>)}</div><div className="currency-add-row"><select value={currencyToAdd} onChange={(event) => setCurrencyToAdd(event.target.value)}>{availableCurrencies().map((code) => <option value={code} key={code}>{currencyName(code, locale)}</option>)}</select><button type="button" onClick={addCurrency}>{t(locale, "addCurrency")}</button></div></SheetFrame> : null}
    </section>
  );
}

function TravelExpenseSheet({ ledger, locale, expense, onClose, onSave, onNotify }: { ledger: TravelLedger; locale: Locale; expense: TravelExpense | null; onClose: () => void; onSave: (expense: TravelExpense) => void; onNotify: Notify }) {
  const [description, setDescription] = useState(expense?.description ?? ""); const [amount, setAmount] = useState(expense ? minorUnitsInput(expense.minorUnits, expense.currency) : ""); const [category, setCategory] = useState<TravelCategory>(expense?.category ?? "food"); const [currency, setCurrency] = useState(expense?.currency ?? ledger.defaultCurrency); const [paidBy, setPaidBy] = useState(expense?.paidBy ?? ledger.selfParticipantId ?? ledger.participants[0]?.id ?? ""); const [selected, setSelected] = useState<string[]>(expense ? expense.shares.map((share) => share.participantId) : ledger.participants.map((person) => person.id)); const [occurredOn, setOccurredOn] = useState(expense?.occurredOn ?? defaultDate());
  const submit = () => { const minorUnits = parseMinorUnits(amount, currency); if (!description.trim() || !paidBy || selected.length === 0 || !occurredOn) return onNotify(t(locale, "requiredFields"), "error"); if (!minorUnits) return onNotify(t(locale, "amountInvalid"), "error"); const saved = createTravelExpense({ description: description.trim(), category, currency, minorUnits, paidBy, participantIds: selected, occurredOn }); onSave(expense ? Object.freeze({ ...saved, id: expense.id }) : saved); };
  return <SheetFrame title={t(locale, expense ? "editExpense" : "addExpense")} locale={locale} onClose={onClose}><div className="expense-form-grid"><label>{t(locale, "description")}<input value={description} maxLength={500} onChange={(event) => setDescription(event.target.value)} autoFocus /></label><div className="two-fields"><label>{t(locale, "amount")}<input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></label><label>{t(locale, "currency")}<select value={currency} onChange={(event) => setCurrency(event.target.value)}>{ledger.currencies.map((code) => <option value={code} key={code}>{code}</option>)}</select></label></div><div className="two-fields"><label>{t(locale, "category")}<select value={category} onChange={(event) => setCategory(event.target.value as TravelCategory)}>{TRAVEL_CATEGORIES.map((code) => <option value={code} key={code}>{travelCategoryLabel(locale, code)}</option>)}</select></label><label>{t(locale, "date")}<input type="date" value={occurredOn} onChange={(event) => setOccurredOn(event.target.value)} /></label></div><label>{t(locale, "payer")}<select value={paidBy} onChange={(event) => setPaidBy(event.target.value)}>{ledger.participants.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label><fieldset><legend>{t(locale, "splitWith")}</legend><div className="split-grid">{ledger.participants.map((person) => <label key={person.id}><input type="checkbox" checked={selected.includes(person.id)} onChange={() => setSelected((current) => current.includes(person.id) ? current.filter((id) => id !== person.id) : [...current, person.id])} />{person.name}</label>)}</div><small>{t(locale, "equalSplit")}</small></fieldset><button className="primary-button wide" type="button" onClick={submit}>{t(locale, expense ? "saveChanges" : "addExpense")}</button></div></SheetFrame>;
}

function minorUnitsInput(minorUnits: number, currency: string): string { const digits = currencyDigits(currency); return (minorUnits / 10 ** digits).toFixed(digits); }
