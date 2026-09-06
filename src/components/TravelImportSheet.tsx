import { useMemo, useState } from "react";
import { formatMoney } from "../lib/currency";
import { exchangeText as x } from "../lib/exchangeI18n";
import { t } from "../lib/i18n";
import { previewTravelLedgerMerge, type ParticipantMapping, type TravelMergePreview } from "../lib/travelExchange";
import type { Locale, TravelLedger } from "../lib/types";
import { createLedger, settleTravelExpenses } from "../lib/wallet";
import { SheetFrame } from "./Sheets";

export interface TravelImportSelection { readonly targetId: string | null; readonly base: TravelLedger; readonly mapping: ParticipantMapping; readonly preview: TravelMergePreview; }

export function TravelImportSheet({ incoming, travels, preferredId, locale, busy, onClose, onConfirm }: { incoming: TravelLedger; travels: readonly TravelLedger[]; preferredId: string | null; locale: Locale; busy: boolean; onClose: () => void; onConfirm: (selection: TravelImportSelection) => void }) {
  const [newTarget] = useState(() => createLedger("travel", incoming.title, incoming.defaultCurrency));
  const [targetId, setTargetId] = useState(travels.find((ledger) => ledger.id === incoming.id)?.id ?? travels.find((ledger) => ledger.id === preferredId)?.id ?? "new");
  const target = travels.find((ledger) => ledger.id === targetId) ?? newTarget;
  return <SheetFrame title={x(locale, "importTitle")} locale={locale} onClose={() => { if (!busy) onClose(); }}>
    <div className="exchange-expense"><small>{x(locale, "incoming")}</small><strong>{incoming.title}</strong><span>{x(locale, "recordCount")}: {incoming.expenses.length.toLocaleString(locale)}</span></div>
    <label className="field-label">{x(locale, "target")}<select value={targetId} disabled={busy} onChange={(event) => setTargetId(event.target.value)}><option value="new">{x(locale, "newTab")}</option>{travels.map((ledger) => <option key={ledger.id} value={ledger.id}>{ledger.title}</option>)}</select></label>
    <ImportDetails key={target.id} target={target} incoming={incoming} locale={locale} busy={busy} isNew={targetId === "new"} onConfirm={onConfirm} />
  </SheetFrame>;
}

function ImportDetails({ target, incoming, locale, busy, isNew, onConfirm }: { target: TravelLedger; incoming: TravelLedger; locale: Locale; busy: boolean; isNew: boolean; onConfirm: (selection: TravelImportSelection) => void }) {
  const [mapping, setMapping] = useState<ParticipantMapping>(() => Object.fromEntries(incoming.participants.map((person) => [person.id, target.participants.some((existing) => existing.id === person.id) ? { kind: "existing", participantId: person.id } : { kind: "new" }])));
  const preview = useMemo(() => previewTravelLedgerMerge(target, incoming, mapping), [target, incoming, mapping]);
  const names = useMemo(() => new Map(preview.ledger?.participants.map((person) => [person.id, person.name]) ?? []), [preview.ledger]);
  const settlements = useMemo(() => preview.ledger ? settleTravelExpenses(preview.ledger).flatMap((settlement) => settlement.transfers) : [], [preview.ledger]);
  return <div className="exchange-form">
    <h3>{x(locale, "mapping")}</h3><p className="sheet-intro">{x(locale, "mappingHelp")}</p>
    <div className="participant-mapping">{incoming.participants.map((person) => {
      const choice = mapping[person.id];
      return <label key={person.id}><strong>{person.name}</strong><select aria-label={`${x(locale, "mapping")}: ${person.name}`} disabled={busy} value={choice?.kind === "existing" ? choice.participantId : "new"} onChange={(event) => setMapping((current) => ({ ...current, [person.id]: event.target.value === "new" ? { kind: "new" } : { kind: "existing", participantId: event.target.value } }))}><option value="new">{x(locale, "newPerson")}</option>{target.participants.map((existing) => <option key={existing.id} value={existing.id}>{existing.name}</option>)}</select></label>;
    })}</div>
    <h3>{x(locale, "preview")}</h3>
    {preview.ok ? <>
      <div className="exchange-counts"><span>{x(locale, "added")}<b>{preview.addedExpenseCount.toLocaleString(locale)}</b></span><span>{x(locale, "duplicates")}<b>{preview.duplicateExpenseCount.toLocaleString(locale)}</b></span><span>{x(locale, "conflicts")}<b>{preview.conflicts.length.toLocaleString(locale)}</b></span></div>
      <div className="exchange-totals"><h4>{x(locale, "addedTotal")}</h4>{preview.addedTotals.length ? preview.addedTotals.map((total) => <p key={total.currency}><span>{total.currency}</span><b>{formatMoney(total.minorUnits, total.currency, locale)}</b></p>) : <p>0</p>}<h4>{x(locale, "resultTotal")}</h4>{preview.resultTotals.map((total) => <p key={total.currency}><span>{total.currency}</span><b>{formatMoney(total.minorUnits, total.currency, locale)}</b></p>)}</div>
      {preview.conflicts.length ? <div className="exchange-conflicts"><p>{x(locale, "conflictHelp")}</p>{preview.conflicts.map((conflict) => <p key={conflict.expenseId}><strong>{conflict.existing.description}</strong><span>{conflict.existing.occurredOn} · {formatMoney(conflict.existing.minorUnits, conflict.existing.currency, locale)}</span></p>)}</div> : null}
      <div className="exchange-totals"><h4>{x(locale, "resultSettlement")}</h4>{settlements.length ? settlements.map((settlement, index) => <p key={index}><span>{names.get(settlement.from)} → {names.get(settlement.to)}</span><b>{formatMoney(settlement.minorUnits, settlement.currency, locale)}</b></p>) : <p>{t(locale, "settlementEmpty")}</p>}</div>
    </> : <p className="exchange-error" role="alert">{x(locale, "invalidPreview")}</p>}
    <button className="primary-button wide" type="button" disabled={busy || !preview.ok} onClick={() => onConfirm({ targetId: isNew ? null : target.id, base: target, mapping, preview })}>{x(locale, isNew ? "saveNew" : "merge")}</button>
  </div>;
}
