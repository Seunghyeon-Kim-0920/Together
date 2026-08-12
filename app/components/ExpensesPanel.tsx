"use client";

import { BedDouble, Bus, HardDrive, Landmark, Plus, ReceiptText, Save, ShoppingBag, Trash2, Utensils, WalletCards, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { DEVICE_EXPENSES_KEY, MAX_DEVICE_EXPENSES, MAX_DEVICE_PARTICIPANTS, parseDeviceExpenseLedger, readDeviceValue, writeDeviceValue, type DeviceParticipant } from "../../lib/device-storage";
import type { Expense, ExpenseCategory, SupportedLocale } from "../../lib/domain";
import { createEqualSplitExpense, settleExpensesByCurrency } from "../../lib/expenses";
import { translate, translateWith } from "../../lib/i18n";

type VisibleCategory = Exclude<ExpenseCategory, "insurance">;
const categoryOrder: VisibleCategory[] = ["accommodation", "transport", "food", "activities", "shopping", "other"];

function visibleCategory(category: ExpenseCategory): VisibleCategory {
  return category === "insurance" ? "other" : category;
}

function categoryIcon(category: ExpenseCategory) {
  if (category === "accommodation") return BedDouble;
  if (category === "transport") return Bus;
  if (category === "food") return Utensils;
  if (category === "activities") return Landmark;
  if (category === "shopping") return ShoppingBag;
  return ReceiptText;
}

function formatMoney(minorUnits: number, locale: SupportedLocale) {
  return new Intl.NumberFormat(locale === "zh" ? "zh-CN" : locale, { style: "currency", currency: "EUR" }).format(minorUnits / 100);
}

export function ExpensesPanel({ locale, onNotify }: {
  locale: SupportedLocale;
  onNotify: (message: string, tone?: "success" | "error" | "info") => void;
}) {
  const [participants, setParticipants] = useState<readonly DeviceParticipant[]>([]);
  const [selfParticipantId, setSelfParticipantId] = useState<string | null>(null);
  const [expenses, setExpenses] = useState<readonly Expense[]>([]);
  const [filter, setFilter] = useState<"all" | VisibleCategory>("all");
  const [formOpen, setFormOpen] = useState(true);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<VisibleCategory>("food");
  const [paidBy, setPaidBy] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [personName, setPersonName] = useState("");
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const load = () => {
      const ledger = readDeviceValue(DEVICE_EXPENSES_KEY, parseDeviceExpenseLedger, parseDeviceExpenseLedger(null));
      setParticipants(ledger.participants);
      setSelfParticipantId(ledger.selfParticipantId);
      setExpenses(ledger.expenses);
      setPaidBy((current) => ledger.participants.some((person) => person.id === current)
        ? current
        : ledger.selfParticipantId ?? ledger.participants[0]?.id ?? "");
      setSelected((current) => {
        const retained = current.filter((id) => ledger.participants.some((person) => person.id === id));
        return retained.length > 0 ? retained : ledger.participants.map((person) => person.id);
      });
      setLoaded(true);
    };
    load();
    window.addEventListener("storage", load);
    return () => window.removeEventListener("storage", load);
  }, []);

  const names = useMemo(() => new Map(participants.map((person) => [person.id, person.name])), [participants]);
  const participantName = (id: string) => names.get(id) ?? id;
  const settlement = useMemo(() => settleExpensesByCurrency(expenses)[0], [expenses]);
  const total = expenses.reduce((sum, expense) => sum + expense.amount.minorUnits, 0);
  const myPaid = selfParticipantId ? expenses.filter((expense) => expense.paidBy === selfParticipantId).reduce((sum, expense) => sum + expense.amount.minorUnits, 0) : 0;
  const myBalance = selfParticipantId ? settlement?.balances.find((balance) => balance.participantId === selfParticipantId)?.amount.minorUnits ?? 0 : 0;
  const visibleExpenses = filter === "all" ? expenses : expenses.filter((expense) => visibleCategory(expense.category) === filter);

  const persist = (nextParticipants: readonly DeviceParticipant[], nextSelf: string | null, nextExpenses: readonly Expense[]) => {
    setSaving(true);
    const saved = writeDeviceValue(DEVICE_EXPENSES_KEY, { version: 1, participants: nextParticipants, selfParticipantId: nextSelf, expenses: nextExpenses });
    setSaving(false);
    if (!saved) onNotify(translate(locale, "deviceSaveError"), "error");
    return saved;
  };

  const addParticipant = () => {
    const name = personName.trim();
    if (!name) return;
    if (participants.length >= MAX_DEVICE_PARTICIPANTS) return onNotify(translate(locale, "storageLimit"), "error");
    if (participants.some((person) => person.name.localeCompare(name, undefined, { sensitivity: "accent" }) === 0)) {
      onNotify(translate(locale, "duplicatePerson"), "error");
      return;
    }
    const person = Object.freeze({ id: crypto.randomUUID(), name });
    const nextParticipants = [...participants, person];
    const nextSelf = selfParticipantId ?? person.id;
    if (!persist(nextParticipants, nextSelf, expenses)) return;
    setParticipants(nextParticipants);
    setSelfParticipantId(nextSelf);
    setPaidBy((current) => current || person.id);
    setSelected((current) => [...current, person.id]);
    setPersonName("");
  };

  const removeParticipant = (participantId: string) => {
    if (expenses.some((expense) => expense.paidBy === participantId || expense.shares.some((share) => share.participantId === participantId))) {
      onNotify(translate(locale, "personInUse"), "error");
      return;
    }
    const nextParticipants = participants.filter((person) => person.id !== participantId);
    const nextSelf = selfParticipantId === participantId ? nextParticipants[0]?.id ?? null : selfParticipantId;
    if (!persist(nextParticipants, nextSelf, expenses)) return;
    setParticipants(nextParticipants);
    setSelfParticipantId(nextSelf);
    setPaidBy((current) => current === participantId ? nextSelf ?? nextParticipants[0]?.id ?? "" : current);
    setSelected((current) => current.filter((id) => id !== participantId));
  };

  const addExpense = () => {
    if (expenses.length >= MAX_DEVICE_EXPENSES) return onNotify(translate(locale, "storageLimit"), "error");
    const totalMinorUnits = Math.round(Number(amount.replace(",", ".")) * 100);
    if (!description.trim() || !Number.isSafeInteger(totalMinorUnits) || totalMinorUnits <= 0 || !paidBy || selected.length === 0) {
      onNotify(translate(locale, participants.length === 0 ? "addPeopleFirst" : "retry"), "error");
      return;
    }
    const expense = createEqualSplitExpense({
      id: crypto.randomUUID(), tripId: "device-ledger", paidBy, category, description: description.trim(), currency: "EUR",
      totalMinorUnits, participantIds: selected, occurredAt: new Date().toISOString(),
    });
    const next = [expense, ...expenses];
    if (!persist(participants, selfParticipantId, next)) return;
    setExpenses(next);
    setDescription("");
    setAmount("");
    onNotify(translate(locale, "expenseSaved"), "success");
  };

  const removeExpense = (expenseId: string) => {
    const next = expenses.filter((expense) => expense.id !== expenseId);
    if (!persist(participants, selfParticipantId, next)) return;
    setExpenses(next);
  };

  return (
    <main className="content-page expenses-page">
      <section className="page-title-row expense-title-row">
        <div><h1>{translate(locale, "expenseTitle")}</h1><p>{translate(locale, "expenseDescription")}</p></div>
        <button className="primary-action compact" type="button" onClick={() => setFormOpen(true)}><Plus size={18} />{translate(locale, "addExpense")}</button>
      </section>
      <div className="trip-context"><span><WalletCards size={17} />{translateWith(locale, "membersCount", { count: participants.length })}</span><strong>{translate(locale, "currency")}</strong><span className="privacy-indicator"><HardDrive size={14} />{translate(locale, "deviceOnly")}</span></div>
      <section className="expense-overview">
        <div><span>{translate(locale, "totalExpense")}</span><strong>{formatMoney(total, locale)}</strong></div>
        <div><span>{translate(locale, "myExpense")}</span><strong>{formatMoney(myPaid, locale)}</strong></div>
        <div className="receive"><span>{translate(locale, "receiveAfter")}</span><strong>{formatMoney(Math.max(0, myBalance), locale)}</strong></div>
      </section>
      {settlement?.balances.length ? (
        <section className="participant-balances" aria-label={translate(locale, "settlement")}>
          {settlement.balances.map((balance, index) => (
            <div key={balance.participantId}>
              <span className={`avatar avatar-${index + 1}`}>{participantName(balance.participantId).slice(0, 1)}</span>
              <strong>{participantName(balance.participantId)}</strong>
              <small>{balance.amount.minorUnits >= 0 ? "+" : ""}{formatMoney(balance.amount.minorUnits, locale)}</small>
            </div>
          ))}
        </section>
      ) : null}

      <div className="expense-workspace">
        <section className="ledger-section">
          <div className="category-tabs" role="tablist" aria-label={translate(locale, "category")}>
            <button type="button" role="tab" aria-selected={filter === "all"} onClick={() => setFilter("all")}>{translate(locale, "all")}</button>
            {categoryOrder.map((item) => <button type="button" role="tab" aria-selected={filter === item} key={item} onClick={() => setFilter(item)}>{translate(locale, item)}</button>)}
          </div>
          <div className="expense-table" role="table" aria-busy={!loaded}>
            <div className="expense-table-head" role="row"><span role="columnheader">{translate(locale, "category")}</span><span role="columnheader">{translate(locale, "description")}</span><span role="columnheader">{translate(locale, "paidBy")}</span><span role="columnheader">{translate(locale, "amount")}</span></div>
            {visibleExpenses.length === 0 ? <p className="ledger-empty">{translate(locale, "noExpenses")}</p> : visibleExpenses.map((expense) => {
              const Icon = categoryIcon(expense.category);
              return (
                <div className="expense-row" role="row" key={expense.id}>
                  <span className="expense-category" role="cell"><i><Icon size={17} /></i>{translate(locale, visibleCategory(expense.category))}</span>
                  <span className="expense-description" role="cell"><strong>{expense.description}</strong><small>{new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : locale).format(new Date(expense.occurredAt))}</small></span>
                  <span className="payer" role="cell"><i className="mini-avatar">{participantName(expense.paidBy).slice(0, 1)}</i>{participantName(expense.paidBy)}</span>
                  <strong className="expense-amount" role="cell">{formatMoney(expense.amount.minorUnits, locale)}<button type="button" className="delete-expense" onClick={() => removeExpense(expense.id)} aria-label={translate(locale, "remove")}><Trash2 size={15} /></button></strong>
                </div>
              );
            })}
          </div>
        </section>

        <aside className="settlement-panel">
          <h2>{translate(locale, "settlement")}</h2>
          <div className="settlement-list">
            {settlement?.transfers.length ? settlement.transfers.map((transfer) => (
              <div key={`${transfer.fromParticipantId}-${transfer.toParticipantId}`}>
                <span>{participantName(transfer.fromParticipantId)}</span><i>→</i><span>{participantName(transfer.toParticipantId)}</span><strong>{formatMoney(transfer.amount.minorUnits, locale)}</strong>
              </div>
            )) : <p>{translate(locale, "noSettlement")}</p>}
          </div>
        </aside>

        {formOpen ? (
          <aside className="expense-form-panel">
            <div className="panel-heading"><h2>{translate(locale, "addExpense")}</h2><button type="button" onClick={() => setFormOpen(false)} aria-label={translate(locale, "close")}><X size={19} /></button></div>
            <section className="participant-editor">
              <h3>{translate(locale, "people")}</h3>
              <div className="add-person-row"><input value={personName} onChange={(event) => setPersonName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addParticipant(); } }} maxLength={80} placeholder={translate(locale, "personName")} /><button type="button" onClick={addParticipant} disabled={!personName.trim()}><Plus size={16} />{translate(locale, "addPerson")}</button></div>
              {participants.length ? <div className="participant-chips">{participants.map((person) => <span key={person.id}><i>{person.name.slice(0, 1)}</i>{person.name}<button type="button" onClick={() => removeParticipant(person.id)} aria-label={`${translate(locale, "remove")} ${person.name}`}><X size={14} /></button></span>)}</div> : <p className="participant-empty">{translate(locale, "addPeopleFirst")}</p>}
              {participants.length ? <label><span>{translate(locale, "chooseYourself")}</span><select value={selfParticipantId ?? ""} onChange={(event) => { const next = event.target.value || null; if (persist(participants, next, expenses)) setSelfParticipantId(next); }}><option value="">{translate(locale, "unspecified")}</option>{participants.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label> : null}
            </section>
            <fieldset disabled={participants.length === 0 || saving} className="expense-fields">
              <div className="two-column-fields">
                <label><span>{translate(locale, "category")}</span><select value={category} onChange={(event) => setCategory(event.target.value as VisibleCategory)}>{categoryOrder.map((item) => <option key={item} value={item}>{translate(locale, item)}</option>)}</select></label>
                <label><span>{translate(locale, "amount")}</span><div className="amount-input"><input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder={locale === "fr" ? "0,00" : "0.00"} /><i>€</i></div></label>
              </div>
              <label><span>{translate(locale, "description")}</span><input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={80} /></label>
              <label><span>{translate(locale, "paidBy")}</span><select value={paidBy} onChange={(event) => setPaidBy(event.target.value)}>{participants.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label>
              <div className="split-field"><span>{translate(locale, "splitWith")}</span><div className="participant-checks">{participants.map((person) => <label key={person.id}><input type="checkbox" checked={selected.includes(person.id)} onChange={() => setSelected((items) => items.includes(person.id) ? items.filter((item) => item !== person.id) : [...items, person.id])} /><span className="mini-avatar">{person.name.slice(0, 1)}</span>{person.name}</label>)}</div></div>
              <div className="split-method"><span>{translate(locale, "splitMethod")}</span><strong>{translateWith(locale, "selectedPeople", { count: selected.length })}</strong></div>
            </fieldset>
            <button className="primary-action full" type="button" onClick={addExpense} disabled={saving || participants.length === 0}><Save size={18} />{translate(locale, "saveExpense")}</button>
          </aside>
        ) : null}
      </div>
    </main>
  );
}
