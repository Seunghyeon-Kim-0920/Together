import { ArrowRight, BedDouble, Download, Bus, FileDown, Landmark, Pencil, Plus, ReceiptText, Share2, ShoppingBag, Trash2, Users, Utensils, UserPlus, WalletCards } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { availableCurrencies, currencyDigits, currencyName, formatMoney, parseMinorUnits } from "../lib/currency";
import { t, travelCategoryLabel } from "../lib/i18n";
import { documentText as d } from "../lib/documentI18n";
import { designText as ui } from "../lib/designI18n";
import { saveLedgerPdf, shareLedgerPdf } from "../lib/ledgerPdf";
import type { Locale, TravelCategory, TravelExpense, TravelLedger } from "../lib/types";
import { TRAVEL_CATEGORIES } from "../lib/types";
import { createTravelExpense, defaultDate, newestExpensesFirst, preserveTravelShares, replaceExpenseById, settleTravelExpenses } from "../lib/wallet";
import { SheetFrame } from "./Sheets";
import { sharedText } from "../lib/sharedTravelI18n";
import { MAX_SHARED_DESCRIPTION_LENGTH } from "../lib/sharedTravel";
import { activeTravelParticipants, addTravelParticipant, participantIsReferenced, previewParticipantHistoryRemoval, removeTravelParticipant, restoreTravelParticipant, travelExpenseParticipants, TravelParticipantError } from "../lib/travelParticipants";
import { travelParticipantText as p } from "../lib/travelParticipantI18n";

type Notify = (message: string, tone?: "success" | "error" | "info") => void;

function CategoryIcon({ category }: { category: TravelCategory }) {
  const Icon = category === "accommodation" ? BedDouble : category === "transport" ? Bus : category === "food" ? Utensils : category === "activities" ? Landmark : category === "shopping" ? ShoppingBag : ReceiptText;
  return <Icon aria-hidden="true" />;
}

export function TravelLedgerView({ ledger, locale, onImport, onChange, onParticipantsChange, onRemoveParticipantHistory, onNotify }: { ledger: TravelLedger; locale: Locale; onImport: () => void; onChange: (ledger: TravelLedger) => Promise<boolean>; onParticipantsChange: (ledger: TravelLedger) => Promise<boolean>; onRemoveParticipantHistory: (ledger: TravelLedger, participantId: string) => Promise<boolean>; onNotify: Notify }) {
  const [formOpen, setFormOpen] = useState(false); const [expenseToEdit, setExpenseToEdit] = useState<TravelExpense | null>(null); const [participantName, setParticipantName] = useState(""); const [filter, setFilter] = useState<TravelCategory | "all">("all"); const [currencyToAdd, setCurrencyToAdd] = useState("USD"); const [currencyEditorOpen, setCurrencyEditorOpen] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false); const pdfLock = useRef(false);
  const canEditExpense = (id: string) => !ledger.sharedSync || ledger.sharedSync.trip.ownerUid === ledger.sharedSync.uid || !ledger.sharedSync.records.some((record) => record.id === id && record.authorUid !== ledger.sharedSync!.uid);
  const [section, setSection] = useState<"entries" | "settle" | "people">("entries");
  const participantInputRef = useRef<HTMLInputElement>(null);
  const participantSaveLock = useRef(false); const [participantSaving, setParticipantSaving] = useState(false);
  const [participantToRemove, setParticipantToRemove] = useState<string | null>(null);
  const [removalSnapshot, setRemovalSnapshot] = useState<TravelLedger | null>(null);
  const [removalMode, setRemovalMode] = useState<"preserve" | "erase">("preserve");
  const [eraseConsent, setEraseConsent] = useState(false);
  const historyOperation = ledger.sharedSync?.trip.participantHistoryRemoval;
  const canManageParticipants = !ledger.sharedSync || ledger.sharedSync.uid === ledger.sharedSync.trip.ownerUid && !ledger.sharedSync.trip.deleted;
  const activeParticipants = activeTravelParticipants(ledger);
  const archivedParticipants = ledger.participants.filter((person) => ledger.inactiveParticipantIds?.includes(person.id));
  const removing = ledger.participants.find((person) => person.id === participantToRemove);
  const archiveRemoval = Boolean(ledger.sharedSync || participantToRemove && participantIsReferenced(ledger, participantToRemove));
  const removalPreview = removing && removalSnapshot && canManageParticipants ? previewParticipantHistoryRemoval(removalSnapshot, removing.id) : null;
  const staleRemovalPreview = Boolean(removalSnapshot && JSON.stringify(removalSnapshot) !== JSON.stringify(ledger));
  const participantNames = useMemo(() => new Map(ledger.participants.map((person) => [person.id, person.name])), [ledger.participants]);
  const settlements = useMemo(() => settleTravelExpenses(ledger), [ledger]);
  const totals = useMemo(() => ledger.currencies.map((currency) => ({ currency, total: ledger.expenses.filter((expense) => expense.currency === currency).reduce((sum, expense) => sum + expense.minorUnits, 0) })), [ledger]);
  const visibleExpenses = filter === "all" ? ledger.expenses : ledger.expenses.filter((expense) => expense.category === filter);
  const showPeople = () => { setSection("people"); requestAnimationFrame(() => participantInputRef.current?.focus()); };
  const openExpenseForm = () => { setExpenseToEdit(null); setFormOpen(true); };
  const openParticipantRemoval = (id: string) => { setRemovalSnapshot(ledger); setRemovalMode("preserve"); setEraseConsent(false); setParticipantToRemove(id); };

  const update = (changes: Partial<TravelLedger>) => onChange(Object.freeze({ ...ledger, ...changes, updatedAt: new Date().toISOString() }));
  const saveParticipants = async (makeChange: () => TravelLedger, success: string): Promise<boolean> => {
    if (participantSaveLock.current || !canManageParticipants) return false;
    participantSaveLock.current = true; setParticipantSaving(true);
    try {
      const next = makeChange();
      const saved = await (ledger.sharedSync ? onParticipantsChange(next) : onChange(next));
      if (saved) onNotify(success, "success");
      return saved;
    } catch (error) {
      const code = error instanceof TravelParticipantError ? error.code : null;
      onNotify(code === "duplicate" ? t(locale, "duplicateName") : code === "required" ? t(locale, "requiredFields") : p(locale, code === "limit" ? "limit" : code === "invalid" ? "invalid" : code === "permission" ? "ownerOnly" : code === "not-found" ? "missing" : code === "history-removed" ? "noRestore" : "failed"), "error");
      return false;
    } finally { participantSaveLock.current = false; setParticipantSaving(false); }
  };
  const addParticipant = async () => {
    if (await saveParticipants(() => addTravelParticipant(ledger, participantName, locale), t(locale, "participantAdded"))) setParticipantName("");
  };
  const confirmRemoveParticipant = async () => {
    if (!participantToRemove) return;
    if (removalMode === "erase") {
      if (!eraseConsent || removalPreview?.orphanExpenseCount || staleRemovalPreview || !removalSnapshot) return;
      await eraseParticipantHistory(participantToRemove, removalSnapshot);
      return;
    }
    if (await saveParticipants(() => removeTravelParticipant(ledger, participantToRemove), p(locale, archiveRemoval ? "excluded" : "removed"))) setParticipantToRemove(null);
  };
  const eraseParticipantHistory = async (participantId: string, confirmed = ledger) => {
    if (participantSaveLock.current || !canManageParticipants) return;
    participantSaveLock.current = true; setParticipantSaving(true);
    try {
      if (await onRemoveParticipantHistory(confirmed, participantId)) { setParticipantToRemove(null); setEraseConsent(false); onNotify(p(locale, "erased"), "success"); }
    } finally { participantSaveLock.current = false; setParticipantSaving(false); }
  };
  const removeExpense = (id: string) => { void update({ expenses: Object.freeze(ledger.expenses.filter((expense) => expense.id !== id)) }).then((saved) => { if (saved) onNotify(t(locale, "expenseDeleted"), "success"); }); };
  const addCurrency = () => { if (ledger.sharedSync || ledger.currencies.includes(currencyToAdd)) return; update({ currencies: Object.freeze([...ledger.currencies, currencyToAdd]) }); };
  const removeCurrency = (currency: string) => {
    if (ledger.sharedSync || currency === ledger.defaultCurrency || ledger.currencies.length === 1 || ledger.expenses.some((expense) => expense.currency === currency)) return;
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

  // Do not display or export an intermediate multi-page settlement. The durable
  // server lock also protects other devices and survives app restarts.
  if (historyOperation || participantSaving && removalMode === "erase") return <section className="ledger-screen travel-ledger-screen"><h2>{ledger.title}</h2><section className="mobile-panel"><p role="status">{p(locale, "working")}</p>{historyOperation && !participantSaving ? canManageParticipants ? <button className="primary-button" type="button" onClick={() => void eraseParticipantHistory(historyOperation.participantId)}>{p(locale, "resume")}</button> : <p>{p(locale, "waitingOwner")}</p> : null}</section></section>;

  return (
    <section className="ledger-screen travel-ledger-screen">
      <div className="ledger-screen-heading"><div><span>{t(locale, "travelLedger")}</span><h2>{ledger.title}</h2></div><div className="heading-actions"><button type="button" disabled={pdfBusy} onClick={() => void exportPdf("save")} title={d(locale, "saveHelp")}><FileDown aria-hidden="true" />{ui(locale, "savePdf")}</button></div></div>
      <div className="travel-summary-card">
        <span className="travel-summary-label">{ui(locale, "travelTotal")}</span>
        <div className="travel-summary-amounts">{totals.map(({ currency, total }) => <div key={currency}><strong>{formatMoney(total, currency, locale)}</strong><small>{currency}</small></div>)}</div>
        <span className="travel-summary-people"><Users aria-hidden="true" />{ui(locale, "people")} <b>{activeParticipants.length}</b></span>
      </div>
      <div className="ledger-segments" role="group" aria-label={ledger.title}>
        {(["entries", "settle", "people"] as const).map((name) => <button type="button" key={name} className={section === name ? "active" : ""} aria-pressed={section === name} onClick={() => setSection(name)}>{ui(locale, name)}</button>)}
      </div>
      <section className="mobile-panel travel-sharing-toolbar">
        <div className="exchange-buttons"><button type="button" disabled={pdfBusy} onClick={() => void exportPdf("share")} title={d(locale, "shareHelp")}><Share2 aria-hidden="true" />{ui(locale, "sharePdf")}</button><button type="button" onClick={onImport}><Download aria-hidden="true" />{ui(locale, "mergeEntries")}</button></div>
        {pdfBusy ? <p role="status">{d(locale, "saving")}</p> : null}
      </section>
      <div className="travel-panel-content">
        {ledger.participants.length === 0 && section !== "people" ? <section className="mobile-panel people-empty-state"><span className="empty-state-icon"><Users aria-hidden="true" /></span><h3>{ui(locale, "peopleFirst")}</h3><p>{ui(locale, "peopleFirstHelp")}</p><button className="primary-button" type="button" onClick={showPeople}><UserPlus aria-hidden="true" />{t(locale, "addParticipant")}</button></section> : null}
        {section === "people" ? <section className="mobile-panel participant-panel">
          <div className="section-heading"><h3>{ui(locale, "people")}</h3><button type="button" disabled={Boolean(ledger.sharedSync)} onClick={() => setCurrencyEditorOpen(true)}><WalletCards aria-hidden="true" />{t(locale, "manageCurrencies")}</button></div>
          {ledger.sharedSync ? <p className="storage-note">{p(locale, canManageParticipants ? "sharedHelp" : "ownerOnly")}</p> : null}<form className="add-participant-row" onSubmit={(event) => { event.preventDefault(); void addParticipant(); }}><input ref={participantInputRef} disabled={participantSaving || !canManageParticipants} aria-label={t(locale, "participantName")} value={participantName} maxLength={80} placeholder={t(locale, "participantName")} onChange={(event) => setParticipantName(event.target.value)} /><button type="submit" disabled={participantSaving || !canManageParticipants || !participantName.trim()}><UserPlus aria-hidden="true" />{t(locale, "add")}</button></form>
          {activeParticipants.length ? <div className="participant-list">{activeParticipants.map((person) => <div key={person.id}><span className="avatar" aria-hidden="true">{person.name.slice(0, 1).toUpperCase()}</span><strong>{person.name}</strong><label><input type="radio" disabled={participantSaving} name={`self-${ledger.id}`} checked={ledger.selfParticipantId === person.id} onChange={() => update({ selfParticipantId: person.id })} />{t(locale, "chooseYourself")}</label><button type="button" disabled={participantSaving || !canManageParticipants} aria-label={`${person.name} ${t(locale, "delete")}`} onClick={() => openParticipantRemoval(person.id)}><Trash2 aria-hidden="true" /></button></div>)}</div> : <p className="empty-inline">{ui(locale, "peopleFirstHelp")}</p>}
          {archivedParticipants.length ? <details><summary>{p(locale, "archived")} ({archivedParticipants.length})</summary><div className="participant-list">{archivedParticipants.map((person) => <div key={person.id}><strong>{person.name}</strong>{ledger.historyRemovedParticipantIds?.includes(person.id) ? <small>{p(locale, "historyRemoved")}</small> : <><button type="button" disabled={participantSaving || !canManageParticipants} onClick={() => void saveParticipants(() => restoreTravelParticipant(ledger, person.id), p(locale, "restored"))}>{p(locale, "restore")}</button><button type="button" disabled={participantSaving || !canManageParticipants} aria-label={`${person.name}: ${p(locale, "eraseChoice")}`} onClick={() => openParticipantRemoval(person.id)}><Trash2 aria-hidden="true" /></button></>}</div>)}</div></details> : null}
        </section> : null}
        {section === "settle" ? <section className="mobile-panel settlement-panel"><div className="section-heading"><h3>{t(locale, "settlement")}</h3></div>{settlements.every((item) => item.transfers.length === 0) ? <p className="empty-inline">{t(locale, "settlementEmpty")}</p> : settlements.filter((item) => item.transfers.length > 0).map((settlement) => <div className="currency-settlement" key={settlement.currency}><strong>{settlement.currency}</strong>{settlement.transfers.map((transfer, index) => <p key={`${transfer.from}-${transfer.to}-${index}`}><span>{participantNames.get(transfer.from)}</span><ArrowRight role="img" aria-label={t(locale, "pays")} /><span>{participantNames.get(transfer.to)}</span><b>{formatMoney(transfer.minorUnits, transfer.currency, locale)}</b></p>)}</div>)}</section> : null}
        {section === "entries" && ledger.participants.length > 0 ? <section className="mobile-panel expense-history">
          <div className="section-heading"><h3>{ui(locale, "entries")}</h3><span className="entry-count">{visibleExpenses.length}</span></div>
          <div className="category-rail"><button className={filter === "all" ? "active" : ""} aria-pressed={filter === "all"} type="button" onClick={() => setFilter("all")}>{t(locale, "allCategories")}</button>{TRAVEL_CATEGORIES.map((category) => <button className={filter === category ? "active" : ""} aria-pressed={filter === category} type="button" key={category} onClick={() => setFilter(category)}>{travelCategoryLabel(locale, category)}</button>)}</div>
          {visibleExpenses.length ? <div className="expense-list">{newestExpensesFirst(visibleExpenses).map((expense) => <article key={expense.id}><span className="category-icon"><CategoryIcon category={expense.category} /></span><div><strong>{expense.description}</strong><small>{travelCategoryLabel(locale, expense.category)} · {participantNames.get(expense.paidBy)} · {expense.occurredOn}</small><SharedExpenseAttribution ledger={ledger} expenseId={expense.id} locale={locale} /></div><b>{formatMoney(expense.minorUnits, expense.currency, locale)}</b><span className="expense-actions"><button type="button" disabled={!canEditExpense(expense.id)} aria-label={`${t(locale, "edit")}: ${expense.description}`} onClick={() => { setExpenseToEdit(expense); setFormOpen(true); }}><Pencil aria-hidden="true" /></button><button type="button" disabled={!canEditExpense(expense.id)} aria-label={`${t(locale, "delete")}: ${expense.description}`} onClick={() => removeExpense(expense.id)}><Trash2 aria-hidden="true" /></button></span></article>)}</div> : <p className="ledger-empty">{t(locale, "noExpenses")}</p>}
        </section> : null}
      </div>
      <button className="floating-add" type="button" onClick={activeParticipants.length === 0 ? showPeople : openExpenseForm}>{activeParticipants.length === 0 ? <UserPlus aria-hidden="true" /> : <Plus aria-hidden="true" />}{activeParticipants.length === 0 ? t(locale, "addParticipant") : ui(locale, "recordExpense")}</button>
      {removing ? <SheetFrame title={p(locale, "removeTitle")} locale={locale} onClose={() => { if (!participantSaving) setParticipantToRemove(null); }}>
        <strong>{removing.name}</strong>
        {archiveRemoval ? <fieldset className="participant-removal-options"><legend>{p(locale, "archiveTitle")}</legend>{(["preserve", "erase"] as const).map((mode) => <label key={mode}><input type="radio" name={`removal-${ledger.id}`} checked={removalMode === mode} onChange={() => { setRemovalMode(mode); setEraseConsent(false); }} /><span>{p(locale, mode === "preserve" ? "preserveChoice" : "eraseChoice")}</span></label>)}</fieldset> : null}
        <p>{p(locale, removalMode === "erase" ? "eraseHelp" : archiveRemoval ? "archiveHelp" : "deleteHelp")}</p>
        {removalMode === "erase" && removalPreview ? <div className="delete-confirm">
          <p>{p(locale, "eraseCounts").replace("{deleted}", String(removalPreview.deletedExpenseCount)).replace("{recalculated}", String(removalPreview.recalculatedExpenseCount))}</p>
          {removalPreview.deletedTotals.length ? <p>{p(locale, "deletedTotal")}: {removalPreview.deletedTotals.map(({ currency, minorUnits }) => formatMoney(minorUnits, currency, locale)).join(" · ")}</p> : null}
          {ledger.sharedSync ? <p>{p(locale, "eraseShared")}</p> : null}
          {staleRemovalPreview ? <><p role="alert">{sharedText(locale, "conflict")}</p><button type="button" onClick={() => { setRemovalSnapshot(ledger); setEraseConsent(false); }}>{p(locale, "refreshPreview")}</button></> : null}
          {removalPreview.orphanExpenseCount ? <p role="alert">{p(locale, "orphan")}</p> : <label className="participant-removal-consent"><input type="checkbox" checked={eraseConsent} onChange={(event) => setEraseConsent(event.target.checked)} /><span>{p(locale, "eraseConsent")}</span></label>}
        </div> : null}
        <div className="sheet-actions"><button type="button" disabled={participantSaving} onClick={() => setParticipantToRemove(null)}>{t(locale, "cancel")}</button><button className="danger-button" type="button" disabled={participantSaving || removalMode === "erase" && (!eraseConsent || staleRemovalPreview || Boolean(removalPreview?.orphanExpenseCount))} onClick={() => void confirmRemoveParticipant()}>{p(locale, removalMode === "erase" ? "eraseChoice" : archiveRemoval ? "archive" : "removeTitle")}</button></div>
      </SheetFrame> : null}
      {formOpen ? <TravelExpenseSheet ledger={ledger} locale={locale} expense={expenseToEdit} onClose={() => { setFormOpen(false); setExpenseToEdit(null); }} onSave={async (expense) => { if (ledger.sharedSync && expenseToEdit && JSON.stringify(ledger.expenses.find((current) => current.id === expenseToEdit.id)) !== JSON.stringify(expenseToEdit)) { onNotify(sharedText(locale, "conflict"), "error"); return; } const saved = await update({ expenses: expenseToEdit ? replaceExpenseById(ledger.expenses, expense) : Object.freeze([...ledger.expenses, expense]) }); if (saved) { setFormOpen(false); setExpenseToEdit(null); onNotify(t(locale, expenseToEdit ? "expenseUpdated" : "expenseAdded"), "success"); } }} onNotify={onNotify} /> : null}
      {currencyEditorOpen ? <SheetFrame title={t(locale, "manageCurrencies")} locale={locale} onClose={() => setCurrencyEditorOpen(false)}><div className="currency-list">{ledger.currencies.map((currency) => <div key={currency}><span>{currencyName(currency, locale)}</span>{currency !== ledger.defaultCurrency ? <button type="button" onClick={() => removeCurrency(currency)}>{t(locale, "removeCurrency")}</button> : null}</div>)}</div><div className="currency-add-row"><select value={currencyToAdd} onChange={(event) => setCurrencyToAdd(event.target.value)}>{availableCurrencies().map((code) => <option value={code} key={code}>{currencyName(code, locale)}</option>)}</select><button type="button" onClick={addCurrency}>{t(locale, "addCurrency")}</button></div></SheetFrame> : null}
    </section>
  );
}

function TravelExpenseSheet({ ledger, locale, expense, onClose, onSave, onNotify }: { ledger: TravelLedger; locale: Locale; expense: TravelExpense | null; onClose: () => void; onSave: (expense: TravelExpense) => Promise<void>; onNotify: Notify }) {
  const availablePeople = travelExpenseParticipants(ledger, expense);
  const [description, setDescription] = useState(expense?.description ?? ""); const [amount, setAmount] = useState(expense ? minorUnitsInput(expense.minorUnits, expense.currency) : ""); const [category, setCategory] = useState<TravelCategory>(expense?.category ?? "food"); const [currency, setCurrency] = useState(expense?.currency ?? ledger.defaultCurrency); const [paidBy, setPaidBy] = useState(expense?.paidBy ?? availablePeople.find((person) => person.id === ledger.selfParticipantId)?.id ?? availablePeople[0]?.id ?? ""); const [selected, setSelected] = useState<string[]>(expense ? expense.shares.map((share) => share.participantId) : availablePeople.map((person) => person.id)); const [occurredOn, setOccurredOn] = useState(expense?.occurredOn ?? defaultDate());
  const [saving, setSaving] = useState(false); const saveLock = useRef(false);
  const submit = async () => { if (saveLock.current) return; const minorUnits = parseMinorUnits(amount, currency); if (!availablePeople.some((person) => person.id === paidBy) || selected.some((id) => !availablePeople.some((person) => person.id === id))) return onNotify(p(locale, "missing"), "error"); if (!description.trim() || !paidBy || selected.length === 0 || !occurredOn) return onNotify(t(locale, "requiredFields"), "error"); if (!minorUnits) return onNotify(t(locale, "amountInvalid"), "error"); const saved = createTravelExpense({ description: description.trim(), category, currency, minorUnits, paidBy, participantIds: selected, occurredOn }); const preservedShares = expense ? preserveTravelShares(expense, minorUnits, currency, selected) : null; saveLock.current = true; setSaving(true); try { await onSave(expense ? Object.freeze({ ...saved, id: expense.id, ...(preservedShares ? { shares: preservedShares } : {}) }) : saved); } finally { saveLock.current = false; setSaving(false); } };
  return <SheetFrame title={t(locale, expense ? "editExpense" : "addExpense")} locale={locale} onClose={() => { if (!saving) onClose(); }}><div className="expense-form-grid"><label>{t(locale, "description")}<input value={description} maxLength={ledger.sharedSync ? MAX_SHARED_DESCRIPTION_LENGTH : 500} onChange={(event) => setDescription(event.target.value)} autoFocus /></label><div className="two-fields"><label>{t(locale, "amount")}<input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></label><label>{t(locale, "currency")}<select value={currency} onChange={(event) => setCurrency(event.target.value)}>{ledger.currencies.map((code) => <option value={code} key={code}>{code}</option>)}</select></label></div><div className="two-fields"><label>{t(locale, "category")}<select value={category} onChange={(event) => setCategory(event.target.value as TravelCategory)}>{TRAVEL_CATEGORIES.map((code) => <option value={code} key={code}>{travelCategoryLabel(locale, code)}</option>)}</select></label><label>{t(locale, "date")}<input type="date" value={occurredOn} onChange={(event) => setOccurredOn(event.target.value)} /></label></div><label>{t(locale, "payer")}<select value={paidBy} onChange={(event) => setPaidBy(event.target.value)}>{availablePeople.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label><fieldset><legend>{t(locale, "splitWith")}</legend><div className="split-grid">{availablePeople.map((person) => <label key={person.id}><input type="checkbox" checked={selected.includes(person.id)} onChange={() => setSelected((current) => current.includes(person.id) ? current.filter((id) => id !== person.id) : [...current, person.id])} />{person.name}</label>)}</div><small>{t(locale, "equalSplit")}</small></fieldset><button className="primary-button wide" type="button" disabled={saving} onClick={() => void submit()}>{t(locale, expense ? "saveChanges" : "addExpense")}</button></div></SheetFrame>;
}

function SharedExpenseAttribution({ ledger, expenseId, locale }: { ledger: TravelLedger; expenseId: string; locale: Locale }) {
  const sync = ledger.sharedSync;
  if (!sync) return null;
  const record = sync.records.find((item) => item.id === expenseId);
  if (!record) return <small>{sharedText(locale, "waiting")}</small>;
  const words = locale === "ko" ? { author: "기록", editor: "수정", former: "이전 참가자" } : locale === "fr" ? { author: "Ajout", editor: "Modification", former: "Ancien membre" } : { author: "Added", editor: "Edited", former: "Former member" };
  const name = (uid: string) => sync.members.find((member) => member.uid === uid)?.displayName ?? words.former;
  return <small>{words.author}: {name(record.authorUid)} · {words.editor}: {name(record.updatedBy)} ({record.revision})</small>;
}

function minorUnitsInput(minorUnits: number, currency: string): string { const digits = currencyDigits(currency); return (minorUnits / 10 ** digits).toFixed(digits); }
