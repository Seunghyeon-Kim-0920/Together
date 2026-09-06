import { useState } from "react";
import { formatMoney } from "../lib/currency";
import { exchangeText as x } from "../lib/exchangeI18n";
import { t, travelCategoryLabel } from "../lib/i18n";
import { merchantDisplayName } from "../lib/merchant";
import { TRAVEL_CATEGORIES, type GeneralExpense, type Locale, type TravelCategory, type TravelLedger } from "../lib/types";
import { SheetFrame } from "./Sheets";

export interface MoveSelection { readonly targetLedgerId: string; readonly paidBy: string; readonly participantIds: readonly string[]; readonly category: TravelCategory; }

export function MoveExpenseSheet({ expense, travels, locale, busy, onClose, onMove }: { expense: GeneralExpense; travels: readonly TravelLedger[]; locale: Locale; busy: boolean; onClose: () => void; onMove: (selection: MoveSelection) => void }) {
  const [targetId, setTargetId] = useState(travels[0]?.id ?? "");
  const target = travels.find((ledger) => ledger.id === targetId);
  return <SheetFrame title={x(locale, "moveTitle")} locale={locale} onClose={() => { if (!busy) onClose(); }}>
    <div className="exchange-expense"><strong>{merchantDisplayName(expense.description, expense.id)}</strong><b>{formatMoney(expense.minorUnits, expense.currency, locale)}</b><small>{expense.occurredOn}</small></div>
    <p className="sheet-intro">{x(locale, "moveHelp")}</p>
    {travels.length ? <><label className="field-label">{x(locale, "destination")}<select value={targetId} disabled={busy} onChange={(event) => setTargetId(event.target.value)}>{travels.map((ledger) => <option key={ledger.id} value={ledger.id}>{ledger.title}</option>)}</select></label>
      {target ? <MoveDetails key={target.id} target={target} expense={expense} locale={locale} busy={busy} onMove={onMove} /> : null}</> : <p className="empty-inline">{x(locale, "noTravel")}</p>}
  </SheetFrame>;
}

function MoveDetails({ target, expense, locale, busy, onMove }: { target: TravelLedger; expense: GeneralExpense; locale: Locale; busy: boolean; onMove: (selection: MoveSelection) => void }) {
  const [paidBy, setPaidBy] = useState(target.selfParticipantId ?? "");
  const [selected, setSelected] = useState<readonly string[]>(target.participants.map((person) => person.id));
  const [category, setCategory] = useState<TravelCategory>(TRAVEL_CATEGORIES.includes(expense.category as TravelCategory) ? expense.category as TravelCategory : expense.category === "housing" ? "accommodation" : expense.category === "leisure" ? "activities" : "other");
  if (!target.participants.length) return <p className="empty-inline">{x(locale, "noPeople")}</p>;
  return <div className="expense-form-grid">
    <label>{t(locale, "payer")}<select value={paidBy} disabled={busy} onChange={(event) => setPaidBy(event.target.value)}><option value="" disabled>{t(locale, "payer")}</option>{target.participants.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
    <label>{t(locale, "category")}<select value={category} disabled={busy} onChange={(event) => setCategory(event.target.value as TravelCategory)}>{TRAVEL_CATEGORIES.map((value) => <option key={value} value={value}>{travelCategoryLabel(locale, value)}</option>)}</select></label>
    <fieldset><legend>{t(locale, "splitWith")}</legend><div className="split-grid">{target.participants.map((person) => <label key={person.id}><input type="checkbox" disabled={busy} checked={selected.includes(person.id)} onChange={() => setSelected((current) => current.includes(person.id) ? current.filter((id) => id !== person.id) : [...current, person.id])} />{person.name}</label>)}</div><small>{t(locale, "equalSplit")}</small></fieldset>
    <button className="primary-button wide" type="button" disabled={busy || !paidBy || selected.length === 0} onClick={() => onMove({ targetLedgerId: target.id, paidBy, participantIds: selected, category })}>{x(locale, "move")}</button>
  </div>;
}
