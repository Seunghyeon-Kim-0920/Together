"use client";

import { BedDouble, Bus, FileDown, HardDrive, Landmark, Plus, ReceiptText, Save, Share2, ShoppingBag, Trash2, Utensils, WalletCards, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { DEVICE_EXPENSES_KEY, MAX_DEVICE_EXPENSES, MAX_DEVICE_PARTICIPANTS, MAX_SHARED_LEDGER_ENCODED_LENGTH, parseDeviceExpenseLedger, readDeviceValue, writeDeviceValue, type DeviceParticipant, type SharedExpenseLedger } from "../../lib/device-storage";
import type { Expense, ExpenseCategory, SupportedLocale } from "../../lib/domain";
import { createEqualSplitExpense, settleExpensesByCurrency } from "../../lib/expenses";
import { translate, translateWith } from "../../lib/i18n";

type VisibleCategory = Exclude<ExpenseCategory, "insurance">;
const categoryOrder: VisibleCategory[] = ["accommodation", "transport", "food", "activities", "shopping", "other"];
const PDF_EXPENSES_PER_PAGE = 18;
const PDF_PARTICIPANTS_PER_PAGE = 36;
const PDF_SETTLEMENTS_PER_PAGE = 24;

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

export function parseEuroMinorUnits(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  const match = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) return null;
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));
  const minorUnits = whole * 100 + fraction;
  return Number.isSafeInteger(minorUnits) && minorUnits > 0 ? minorUnits : null;
}

async function encodeLedger(value: SharedExpenseLedger): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let encodedBytes = bytes;
  let codec = "j";
  if (typeof CompressionStream !== "undefined") {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
    encodedBytes = new Uint8Array(await new Response(stream).arrayBuffer());
    codec = "g";
  }
  let binary = "";
  encodedBytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return `${codec}.${btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")}`;
}

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const field = document.createElement("textarea");
    field.value = value;
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    const copied = document.execCommand("copy");
    field.remove();
    return copied;
  }
}

export function ExpensesPanel({ locale, onNotify, sharedLedger = null, onSharedLedgerSaved }: {
  locale: SupportedLocale;
  onNotify: (message: string, tone?: "success" | "error" | "info") => void;
  sharedLedger?: SharedExpenseLedger | null;
  onSharedLedgerSaved?: () => void;
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
  const [exporting, setExporting] = useState(false);

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

  const visibleParticipants = sharedLedger?.participants ?? participants;
  const visibleLedgerExpenses = sharedLedger?.expenses ?? expenses;
  const names = useMemo(() => new Map(visibleParticipants.map((person) => [person.id, person.name])), [visibleParticipants]);
  const participantName = (id: string) => names.get(id) ?? id;
  const settlement = useMemo(() => settleExpensesByCurrency(visibleLedgerExpenses)[0], [visibleLedgerExpenses]);
  const total = visibleLedgerExpenses.reduce((sum, expense) => sum + expense.amount.minorUnits, 0);
  const myPaid = !sharedLedger && selfParticipantId ? expenses.filter((expense) => expense.paidBy === selfParticipantId).reduce((sum, expense) => sum + expense.amount.minorUnits, 0) : 0;
  const myBalance = !sharedLedger && selfParticipantId ? settlement?.balances.find((balance) => balance.participantId === selfParticipantId)?.amount.minorUnits ?? 0 : 0;
  const visibleExpenses = filter === "all" ? visibleLedgerExpenses : visibleLedgerExpenses.filter((expense) => visibleCategory(expense.category) === filter);
  const pdfExpensePages = useMemo(() => {
    const pages: Expense[][] = [];
    for (let index = 0; index < visibleLedgerExpenses.length; index += PDF_EXPENSES_PER_PAGE) {
      pages.push(visibleLedgerExpenses.slice(index, index + PDF_EXPENSES_PER_PAGE) as Expense[]);
    }
    return pages.length > 0 ? pages : [[]];
  }, [visibleLedgerExpenses]);
  const pdfParticipantPages = useMemo(() => {
    const pages: DeviceParticipant[][] = [];
    for (let index = 0; index < visibleParticipants.length; index += PDF_PARTICIPANTS_PER_PAGE) {
      pages.push(visibleParticipants.slice(index, index + PDF_PARTICIPANTS_PER_PAGE) as DeviceParticipant[]);
    }
    return pages.length > 0 ? pages : [[]];
  }, [visibleParticipants]);
  const pdfSettlementPages = useMemo(() => {
    const transfers = settlement?.transfers ?? [];
    const pages: Array<typeof transfers> = [];
    for (let index = 0; index < transfers.length; index += PDF_SETTLEMENTS_PER_PAGE) {
      pages.push(transfers.slice(index, index + PDF_SETTLEMENTS_PER_PAGE));
    }
    return pages.length > 0 ? pages : [[]];
  }, [settlement]);
  const pdfPageCount = pdfParticipantPages.length + pdfExpensePages.length + pdfSettlementPages.length;

  const shareLedger = async () => {
    if (!sharedLedger && !loaded) return;
    const payload: SharedExpenseLedger = Object.freeze({
      version: 1,
      participants: Object.freeze([...visibleParticipants]),
      expenses: Object.freeze([...visibleLedgerExpenses]),
    });
    const encoded = await encodeLedger(payload);
    if (encoded.length > MAX_SHARED_LEDGER_ENCODED_LENGTH) {
      onNotify(translate(locale, "ledgerShareError"), "error");
      return;
    }
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = `ledger=${encoded}`;
    const copied = await copyText(url.toString());
    onNotify(copied ? translate(locale, "ledgerCopied") : translate(locale, "ledgerShareError"), copied ? "success" : "error");
  };

  const downloadLedgerPdf = async () => {
    if (!sharedLedger && !loaded) return;
    const pages = [...document.querySelectorAll<HTMLElement>("#expense-ledger-pdf-report .expense-pdf-page")];
    if (pages.length === 0) return;
    setExporting(true);
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      for (let index = 0; index < pages.length; index += 1) {
        const canvas = await html2canvas(pages[index], { scale: 1.5, backgroundColor: "#ffffff", useCORS: true });
        if (index > 0) pdf.addPage();
        const ratio = Math.min(pageWidth / canvas.width, pageHeight / canvas.height);
        const width = canvas.width * ratio;
        const height = canvas.height * ratio;
        pdf.addImage(canvas.toDataURL("image/jpeg", 0.9), "JPEG", (pageWidth - width) / 2, 0, width, height, undefined, "FAST");
      }
      pdf.save("Together-ledger.pdf");
      onNotify(translate(locale, "pdfReady"), "success");
    } catch {
      onNotify(translate(locale, "pdfError"), "error");
    } finally {
      setExporting(false);
    }
  };

  const saveSharedLedger = () => {
    if (!sharedLedger || !loaded) return;
    if (participants.length > 0 || expenses.length > 0) {
      onNotify(translate(locale, "sharedLedgerConflict"), "error");
      return;
    }
    const stored = { ...sharedLedger, selfParticipantId: null };
    if (!writeDeviceValue(DEVICE_EXPENSES_KEY, stored)) {
      onNotify(translate(locale, "deviceSaveError"), "error");
      return;
    }
    setParticipants(sharedLedger.participants);
    setExpenses(sharedLedger.expenses);
    setSelfParticipantId(null);
    onSharedLedgerSaved?.();
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    onNotify(translate(locale, "sharedLedgerSaved"), "success");
  };

  const persist = (nextParticipants: readonly DeviceParticipant[], nextSelf: string | null, nextExpenses: readonly Expense[]) => {
    setSaving(true);
    const candidate = { version: 1, participants: nextParticipants, selfParticipantId: nextSelf, expenses: nextExpenses };
    const parsed = parseDeviceExpenseLedger(candidate);
    const valid =
      parsed.participants.length === nextParticipants.length &&
      parsed.expenses.length === nextExpenses.length;
    const saved = valid && writeDeviceValue(DEVICE_EXPENSES_KEY, candidate);
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
    const totalMinorUnits = parseEuroMinorUnits(amount);
    if (!description.trim() || totalMinorUnits === null || !paidBy || selected.length === 0) {
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
    <main className="content-page expenses-page" id="expense-ledger-export">
      <section className="page-title-row expense-title-row">
        <div><h1>{translate(locale, sharedLedger ? "sharedLedgerPreview" : "expenseTitle")}</h1><p>{translate(locale, sharedLedger ? "sharedLedgerPreviewHelp" : "expenseDescription")}</p></div>
        {!sharedLedger ? <button className="primary-action compact" type="button" onClick={() => setFormOpen(true)}><Plus size={18} />{translate(locale, "addExpense")}</button> : null}
      </section>
      <div className="trip-context"><span><WalletCards size={17} />{translateWith(locale, "membersCount", { count: visibleParticipants.length })}</span><strong>{translate(locale, "currency")}</strong>{!sharedLedger ? <span className="privacy-indicator"><HardDrive size={14} />{translate(locale, "deviceOnly")}</span> : null}</div>
      <div className="ledger-export-actions">
        <button type="button" onClick={shareLedger} disabled={exporting || (!sharedLedger && !loaded)}><Share2 size={17} />{translate(locale, "shareLedger")}</button>
        <button type="button" onClick={downloadLedgerPdf} disabled={exporting || (!sharedLedger && !loaded)}><FileDown size={17} />{translate(locale, "ledgerPdf")}</button>
        {sharedLedger ? <button className="primary-action compact" type="button" onClick={saveSharedLedger} disabled={!loaded || saving}><Save size={17} />{translate(locale, "saveSharedLedger")}</button> : null}
      </div>
      <p className="ledger-share-privacy">{translate(locale, "ledgerSharePrivacy")}</p>
      <section className="expense-pdf-report" id="expense-ledger-pdf-report" aria-hidden="true">
        {pdfParticipantPages.map((pageParticipants, pageIndex) => (
          <article className="expense-pdf-page" key={pageIndex}>
            <h1>Together · {translate(locale, "expenses")}</h1>
            <small>{pageIndex + 1} / {pdfPageCount}</small>
            {pageIndex === 0 ? <>
              <p>{translateWith(locale, "membersCount", { count: visibleParticipants.length })}</p>
              <strong className="expense-pdf-total">{translate(locale, "totalExpense")}: {formatMoney(total, locale)}</strong>
            </> : null}
            <h2>{translate(locale, "people")}</h2>
            <div className="expense-pdf-people">{pageParticipants.map((person) => <span key={person.id}>{person.name}</span>)}</div>
          </article>
        ))}
        {pdfExpensePages.map((pageExpenses, pageIndex) => (
          <article className="expense-pdf-page" key={`expenses-${pageIndex}`}>
            <h1>Together · {translate(locale, "expenses")}</h1>
            <small>{pdfParticipantPages.length + pageIndex + 1} / {pdfPageCount}</small>
            <h2>{translate(locale, "expenses")}</h2>
            <div className="expense-pdf-table">
              {pageExpenses.length === 0 ? <p>{translate(locale, "noExpenses")}</p> : pageExpenses.map((expense) => (
                <article key={expense.id}>
                  <strong>{translate(locale, visibleCategory(expense.category))} · {expense.description}</strong>
                  <span>{translate(locale, "paidBy")}: {participantName(expense.paidBy)} · {formatMoney(expense.amount.minorUnits, locale)}</span>
                  <span>{translate(locale, "splitWith")}: {translateWith(locale, "selectedPeople", { count: expense.shares.length })}</span>
                  <small>{new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : locale).format(new Date(expense.occurredAt))}</small>
                </article>
              ))}
            </div>
          </article>
        ))}
        {pdfSettlementPages.map((pageTransfers, pageIndex) => <article className="expense-pdf-page" key={`settlement-${pageIndex}`}>
          <h1>Together · {translate(locale, "settlement")}</h1>
          <small>{pdfParticipantPages.length + pdfExpensePages.length + pageIndex + 1} / {pdfPageCount}</small>
          {pageTransfers.length ? pageTransfers.map((transfer) => (
            <p key={`${transfer.fromParticipantId}-${transfer.toParticipantId}`}>{participantName(transfer.fromParticipantId)} → {participantName(transfer.toParticipantId)} · {formatMoney(transfer.amount.minorUnits, locale)}</p>
          )) : <p>{translate(locale, "noSettlement")}</p>}
        </article>)}
      </section>
      <section className="expense-overview">
        <div><span>{translate(locale, "totalExpense")}</span><strong>{formatMoney(total, locale)}</strong></div>
        {!sharedLedger ? <div><span>{translate(locale, "myExpense")}</span><strong>{formatMoney(myPaid, locale)}</strong></div> : null}
        {!sharedLedger ? <div className="receive"><span>{translate(locale, "receiveAfter")}</span><strong>{formatMoney(Math.max(0, myBalance), locale)}</strong></div> : null}
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
                  <strong className="expense-amount" role="cell">{formatMoney(expense.amount.minorUnits, locale)}{!sharedLedger ? <button type="button" className="delete-expense" onClick={() => removeExpense(expense.id)} aria-label={translate(locale, "remove")}><Trash2 size={15} /></button> : null}</strong>
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

        {formOpen && !sharedLedger ? (
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
