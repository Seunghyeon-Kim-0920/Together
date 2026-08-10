"use client";

import { BedDouble, Bus, Landmark, LockKeyhole, Plus, ReceiptText, Save, ShoppingBag, Utensils, WalletCards, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Expense, ExpenseCategory, SupportedLocale } from "../../lib/domain";
import { createEqualSplitExpense, parseExpenseLedger, settleExpensesByCurrency } from "../../lib/expenses";
import { translate, translateWith, type MessageKey } from "../../lib/i18n";

const participants = ["minji", "junho", "sora", "me"] as const;
type VisibleCategory = Exclude<ExpenseCategory, "insurance">;
const categoryOrder: VisibleCategory[] = ["accommodation", "transport", "food", "activities", "shopping", "other"];

function visibleCategory(category: ExpenseCategory): VisibleCategory {
  return category === "insurance" ? "other" : category;
}

function participantName(id: string, locale: SupportedLocale) {
  const names: Record<string, Record<SupportedLocale, string>> = {
    minji: { ko: "민지", en: "Mina", fr: "Mina", ja: "ミナ", zh: "敏智" },
    junho: { ko: "준호", en: "Jun", fr: "Jun", ja: "ジュン", zh: "俊昊" },
    sora: { ko: "소라", en: "Sora", fr: "Sora", ja: "ソラ", zh: "素拉" },
    me: { ko: "나", en: "Me", fr: "Moi", ja: "自分", zh: "我" },
  };
  return names[id]?.[locale] ?? id;
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

function seedExpenses(): readonly Expense[] {
  const items: Array<[ExpenseCategory, MessageKey, number, string, string]> = [
    ["accommodation", "sampleStay", 64000, "junho", "2026-06-15"],
    ["transport", "sampleRail", 22800, "minji", "2026-06-16"],
    ["food", "sampleDinner", 15640, "me", "2026-06-16"],
    ["activities", "sampleMuseum", 8800, "junho", "2026-06-17"],
    ["shopping", "sampleGroceries", 7220, "sora", "2026-06-18"],
  ];
  return items.map(([category, description, totalMinorUnits, paidBy, date], index) => createEqualSplitExpense({
    id: `seed-${index}`,
    tripId: "europe-summer",
    paidBy,
    category,
    description,
    currency: "EUR",
    totalMinorUnits,
    participantIds: participants,
    occurredAt: `${date}T12:00:00.000Z`,
  }));
}

export function initialExpensesForAccount(signedIn: boolean): readonly Expense[] {
  return signedIn ? [] : seedExpenses();
}

function localizedDescription(expense: Expense, locale: SupportedLocale): string {
  if (expense.id.startsWith("seed-") && ["sampleStay", "sampleRail", "sampleDinner", "sampleMuseum", "sampleGroceries"].includes(expense.description)) {
    return translate(locale, expense.description as MessageKey);
  }
  return expense.description;
}

export function ExpensesPanel({ locale, user, signInUrl, onNotify }: {
  locale: SupportedLocale;
  user: { displayName: string; email: string } | null;
  signInUrl: string;
  onNotify: (message: string, tone?: "success" | "error" | "info") => void;
}) {
  // Guests see a localized demonstration ledger; authenticated accounts always
  // start empty until their private data has been loaded.
  const [expenses, setExpenses] = useState<readonly Expense[]>(() => initialExpensesForAccount(Boolean(user)));
  const [filter, setFilter] = useState<"all" | VisibleCategory>("all");
  const [formOpen, setFormOpen] = useState(true);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<VisibleCategory>("food");
  const [paidBy, setPaidBy] = useState<string>("me");
  const [selected, setSelected] = useState<string[]>([...participants]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(Boolean(user));

  useEffect(() => {
    if (!user) return;
    let active = true;
    fetch("/api/expenses")
      .then(async (response) => {
        if (!response.ok) throw new Error("request failed");
        return await response.json() as { expenses: unknown };
      })
      .then((data) => {
        const ledger = parseExpenseLedger(data.expenses);
        if (active) setExpenses(ledger?.expenses ?? []);
      })
      .catch(() => {
        if (active) onNotify(translate(locale, "retry"), "error");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [locale, onNotify, user]);

  const settlement = useMemo(() => settleExpensesByCurrency(expenses)[0], [expenses]);
  const total = expenses.reduce((sum, expense) => sum + expense.amount.minorUnits, 0);
  const myPaid = expenses.filter((expense) => expense.paidBy === "me").reduce((sum, expense) => sum + expense.amount.minorUnits, 0);
  const myBalance = settlement?.balances.find((balance) => balance.participantId === "me")?.amount.minorUnits ?? 0;
  const visibleExpenses = filter === "all" ? expenses : expenses.filter((expense) => visibleCategory(expense.category) === filter);

  const persist = async (nextExpenses: readonly Expense[]) => {
    if (!user) return;
    setSaving(true);
    try {
      const response = await fetch("/api/expenses", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ version: 1, expenses: nextExpenses }) });
      if (!response.ok) throw new Error("save failed");
      onNotify(translate(locale, "expenseSaved"), "success");
    } catch {
      onNotify(translate(locale, "retry"), "error");
    } finally {
      setSaving(false);
    }
  };

  const addExpense = async () => {
    const totalMinorUnits = Math.round(Number(amount.replace(",", ".")) * 100);
    if (!description.trim() || !Number.isSafeInteger(totalMinorUnits) || totalMinorUnits <= 0 || selected.length === 0) {
      onNotify(translate(locale, "retry"), "error");
      return;
    }
    const expense = createEqualSplitExpense({
      id: crypto.randomUUID(), tripId: "europe-summer", paidBy, category, description: description.trim(), currency: "EUR",
      totalMinorUnits, participantIds: selected, occurredAt: new Date().toISOString(),
    });
    const next = [expense, ...expenses];
    setExpenses(next);
    setDescription("");
    setAmount("");
    await persist(next);
  };

  return (
    <main className="content-page expenses-page">
      <section className="page-title-row expense-title-row">
        <div><h1>{translate(locale, "expenseTitle")}</h1><p>{translate(locale, "expenseDescription")}</p></div>
        <button className="primary-action compact" type="button" onClick={() => setFormOpen(true)}><Plus size={18} />{translate(locale, "addExpense")}</button>
      </section>
      <div className="trip-context"><span><WalletCards size={17} />{translate(locale, "tripName")} · {translate(locale, "members")}</span><strong>{translate(locale, "currency")}</strong>{user ? <span className="privacy-indicator"><LockKeyhole size={14} />{translate(locale, "private")}</span> : <a href={signInUrl}>{translate(locale, "signInToSave")}</a>}</div>
      <section className="expense-overview">
        <div><span>{translate(locale, "totalExpense")}</span><strong>{formatMoney(total, locale)}</strong></div>
        <div><span>{translate(locale, "myExpense")}</span><strong>{formatMoney(myPaid, locale)}</strong></div>
        <div className="receive"><span>{translate(locale, "receiveAfter")}</span><strong>{formatMoney(Math.max(0, myBalance), locale)}</strong></div>
      </section>
      <section className="participant-balances" aria-label={translate(locale, "settlement")}>
        {settlement?.balances.map((balance, index) => (
          <div key={balance.participantId}>
            <span className={`avatar avatar-${index + 1}`}>{participantName(balance.participantId, locale).slice(0, 1)}</span>
            <strong>{participantName(balance.participantId, locale)}</strong>
            <small>{balance.amount.minorUnits >= 0 ? "+" : ""}{formatMoney(balance.amount.minorUnits, locale)}</small>
          </div>
        ))}
      </section>

      <div className="expense-workspace">
        <section className="ledger-section">
          <div className="category-tabs" role="tablist" aria-label={translate(locale, "category")}>
            <button type="button" role="tab" aria-selected={filter === "all"} onClick={() => setFilter("all")}>{translate(locale, "all")}</button>
            {categoryOrder.map((item) => <button type="button" role="tab" aria-selected={filter === item} key={item} onClick={() => setFilter(item)}>{translate(locale, item)}</button>)}
          </div>
          <div className="expense-table" role="table" aria-busy={loading}>
            <div className="expense-table-head" role="row"><span role="columnheader">{translate(locale, "category")}</span><span role="columnheader">{translate(locale, "description")}</span><span role="columnheader">{translate(locale, "paidBy")}</span><span role="columnheader">{translate(locale, "amount")}</span></div>
            {visibleExpenses.map((expense) => {
              const Icon = categoryIcon(expense.category);
              return (
                <div className="expense-row" role="row" key={expense.id}>
                  <span className="expense-category" role="cell"><i><Icon size={17} /></i>{translate(locale, visibleCategory(expense.category))}</span>
                  <span className="expense-description" role="cell"><strong>{localizedDescription(expense, locale)}</strong><small>{new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : locale).format(new Date(expense.occurredAt))}</small></span>
                  <span className="payer" role="cell"><i className="mini-avatar">{participantName(expense.paidBy, locale).slice(0, 1)}</i>{participantName(expense.paidBy, locale)}</span>
                  <strong className="expense-amount" role="cell">{formatMoney(expense.amount.minorUnits, locale)}</strong>
                </div>
              );
            })}
          </div>
        </section>

        <aside className="settlement-panel">
          <h2>{translate(locale, "settlement")}</h2>
          <div className="settlement-list">
            {settlement?.transfers.map((transfer) => (
              <div key={`${transfer.fromParticipantId}-${transfer.toParticipantId}`}>
                <span>{participantName(transfer.fromParticipantId, locale)}</span><i>→</i><span>{participantName(transfer.toParticipantId, locale)}</span><strong>{formatMoney(transfer.amount.minorUnits, locale)}</strong>
              </div>
            ))}
          </div>
        </aside>

        {formOpen ? (
          <aside className="expense-form-panel">
            <div className="panel-heading"><h2>{translate(locale, "addExpense")}</h2><button type="button" onClick={() => setFormOpen(false)} aria-label={translate(locale, "close")}><X size={19} /></button></div>
            <div className="two-column-fields">
              <label><span>{translate(locale, "category")}</span><select value={category} onChange={(event) => setCategory(event.target.value as VisibleCategory)}>{categoryOrder.map((item) => <option key={item} value={item}>{translate(locale, item)}</option>)}</select></label>
              <label><span>{translate(locale, "amount")}</span><div className="amount-input"><input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder={locale === "fr" ? "0,00" : "0.00"} /><i>€</i></div></label>
            </div>
            <label><span>{translate(locale, "description")}</span><input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={80} /></label>
            <label><span>{translate(locale, "paidBy")}</span><select value={paidBy} onChange={(event) => setPaidBy(event.target.value)}>{participants.map((person) => <option value={person} key={person}>{participantName(person, locale)}</option>)}</select></label>
            <fieldset><legend>{translate(locale, "splitWith")}</legend><div className="participant-checks">{participants.map((person) => <label key={person}><input type="checkbox" checked={selected.includes(person)} onChange={() => setSelected((items) => items.includes(person) ? items.filter((item) => item !== person) : [...items, person])} /><span className="mini-avatar">{participantName(person, locale).slice(0, 1)}</span>{participantName(person, locale)}</label>)}</div></fieldset>
            <div className="split-method"><span>{translate(locale, "splitMethod")}</span><strong>{translateWith(locale, "selectedPeople", { count: selected.length })}</strong></div>
            <button className="primary-action full" type="button" onClick={addExpense} disabled={saving}><Save size={18} />{translate(locale, "saveExpense")}</button>
          </aside>
        ) : null}
      </div>
    </main>
  );
}
