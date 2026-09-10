import { useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, FileUp, Plus } from "lucide-react";
import { SheetFrame } from "./Sheets";
import { availableCurrencies, currencyDigits, currencyName, formatMoney, parseMinorUnits } from "../lib/currency";
import { documentText as d } from "../lib/documentI18n";
import { readExpenseDocument, type ReadDocument } from "../lib/documentReader";
import { generalCategoryLabel, t } from "../lib/i18n";
import { GENERAL_CATEGORIES, type Locale, type TravelLedger, type WalletState } from "../lib/types";
import { previewExpenseDocument, validateStatementImportRow, type StatementColumnMapping, type StatementImportAdjustment, type StatementImportOptions, type StatementImportRow, type StatementImportTarget } from "../lib/statementImport";

export interface DocumentImportSelection { rows: StatementImportRow[]; target: StatementImportTarget; adjustments: StatementImportAdjustment[]; }
interface Props { state: WalletState; locale: Locale; onClose: () => void; onTravel: (ledger: TravelLedger) => void; onConfirm: (selection: DocumentImportSelection) => Promise<void>; }
const currencyCodes = availableCurrencies();
export function DocumentImportSheet({ state, locale, onClose, onTravel, onConfirm }: Props) {
  const [source, setSource] = useState<ReadDocument | null>(null);
  const [password, setPassword] = useState(""); const [language, setLanguage] = useState(locale === "ko" ? "ko" : "en");
  const [encoding, setEncoding] = useState("auto"); const [reading, setReading] = useState(false); const [progress, setProgress] = useState("");
  const [error, setError] = useState(""); const [generation, setGeneration] = useState(0);
  const [importing, setImporting] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const [options, setOptions] = useState<StatementImportOptions>(() => { const active = state.ledgers.find((ledger) => ledger.id === state.activeLedgerId); return { dateOrder: "auto", amountSign: "auto", defaultCurrency: active?.kind === "general" ? active.currency : active?.defaultCurrency ?? "EUR" }; });
  const read = async (file: File) => {
    setReading(true); setError(""); setSource(null); setProgress("");
    try {
      const parsed = await readExpenseDocument(file, { password, language, encoding, progress: (page, total) => setProgress(`${page} / ${total}`) });
      setPassword("");
      if (parsed.ledger?.ledger.kind === "travel") { onTravel(parsed.ledger.ledger); return; }
      setOptions((current) => ({ dateOrder: current.dateOrder, amountSign: "auto", defaultCurrency: current.defaultCurrency }));
      setSource(parsed); setGeneration((value) => value + 1);
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "";
      setError(d(locale, code === "ocr-android" ? "ocrAndroid" : code === "size" || code === "limit" || code === "encrypted" || code === "unsupported" ? code : "failed"));
    } finally { setReading(false); }
  };
  const confirm = async (selection: DocumentImportSelection) => { setImporting(true); try { await onConfirm(selection); } finally { setImporting(false); } };
  return <SheetFrame title={d(locale, "title")} locale={locale} onClose={() => { if (!reading && !importing) onClose(); }}>
    <div className="document-import">
      <p className="sheet-intro">{d(locale, "supported")}</p>
      <details><summary>{d(locale, "password")} · {d(locale, "language")}</summary>
        <label className="field-label">{d(locale, "password")}<input type="password" autoComplete="off" value={password} disabled={reading} onChange={(event) => setPassword(event.target.value)} /></label>
        <label className="field-label">{d(locale, "language")}<select value={language} disabled={reading} onChange={(event) => setLanguage(event.target.value)}>{([['en', 'latin'], ['ko', 'korean'], ['zh', 'chinese'], ['ja', 'japanese'], ['hi', 'hindi']] as const).map(([code, label]) => <option key={code} value={code}>{d(locale, label)}</option>)}</select></label>
        <label className="field-label">{d(locale, "encoding")}<select value={encoding} disabled={reading} onChange={(event) => setEncoding(event.target.value)}><option value="auto">{d(locale, "automatic")}</option>{['utf-8', 'euc-kr', 'windows-1252', 'shift_jis', 'gb18030', 'utf-16le'].map((code) => <option key={code}>{code}</option>)}</select></label>
      </details>
      <button type="button" className="wide-secondary" disabled={reading || importing} onClick={() => input.current?.click()}><FileUp />{reading ? d(locale, "reading") + " " + progress : d(locale, "choose")}</button>
      <input className="sr-only" ref={input} type="file" disabled={reading || importing} aria-label={d(locale, "choose")} onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) void read(file); }} />
      {error && <p className="exchange-error" role="alert">{error}</p>}
      {source && <DocumentReview key={generation + JSON.stringify(options)} source={source} state={state} locale={locale} options={options} onOptions={setOptions} onConfirm={confirm} />}
    </div>
  </SheetFrame>;
}

function DocumentReview({ source, state, locale, options, onOptions, onConfirm }: { source: ReadDocument; state: WalletState; locale: Locale; options: StatementImportOptions; onOptions: (options: StatementImportOptions) => void; onConfirm: Props['onConfirm'] }) {
  const preview = useMemo(() => previewExpenseDocument(source, options, state), [source, options, state]);
  const [rows, setRows] = useState<StatementImportRow[]>(() => preview.rows.map((row) => ({ ...row })));
  const [adjustments, setAdjustments] = useState<StatementImportAdjustment[]>(() => preview.adjustments.map((adjustment) => ({ ...adjustment })));
  const [targetId, setTargetId] = useState(state.activeLedgerId ?? "new");
  const [title, setTitle] = useState((source.ledger?.ledger.title ?? source.name.replace(/\.[^.]+$/, "")).slice(0, 70));
  const [payer, setPayer] = useState(""); const [people, setPeople] = useState<string[]>([]);
  const [page, setPage] = useState(0); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const target = state.ledgers.find((ledger) => ledger.id === targetId);
  const selected = rows.filter((row) => row.selected);
  const selectedAdjustments = adjustments.filter((adjustment) => adjustment.selected);
  const totals = new Map<string, number>(); selected.forEach((row) => totals.set(row.currency, (totals.get(row.currency) ?? 0) + row.minorUnits));
  const dates = selected.map((row) => row.occurredOn).sort();
  const invalid = selected.some((row) => !validateStatementImportRow(row));
  const wrongCurrency = target?.kind === "general" && selected.some((row) => row.currency !== target.currency);
  const badTarget = selected.length > 0 && (targetId === "new" ? !title.trim() : !target || target.kind === "travel" && (!payer || !people.length));
  const canSave = (selected.length > 0 || selectedAdjustments.length > 0) && !invalid && !wrongCurrency && !badTarget && [...totals.values()].every(Number.isSafeInteger);
  const update = (id: string, patch: Partial<StatementImportRow>) => setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
  const confirm = async () => {
    if (busy || !canSave) return; setBusy(true); setError("");
    try { await onConfirm({ rows: selected, target: targetId === "new" ? { kind: "new-general", title } : { kind: "existing", ledgerId: targetId, paidBy: payer, participantIds: people }, adjustments: selectedAdjustments }); }
    catch { setError(d(locale, "saveFailed")); } finally { setBusy(false); }
  };
  const mapping = options.mapping ?? preview.mapping;
  const columnHeaders = preview.headers.length ? preview.headers : Array.from({ length: Math.min(500, Math.max(0, ...((source.tables[options.tableIndex ?? preview.tableIndex]?.rows ?? []).map((row) => row.length)))) }, (_, index) => String(index + 1));
  const setColumn = (key: keyof StatementColumnMapping, value: string) => onOptions({ ...options, tableIndex: options.tableIndex ?? preview.tableIndex, headerRow: options.headerRow ?? preview.headerRow, mapping: { ...mapping, [key]: value === "" ? undefined : Number(value) } });
  const visibleRows = rows.slice(page * 20, page * 20 + 20);
  return <div className="document-review">
    <p className="document-filename">{source.name}</p><p className="sheet-intro">{d(locale, "help")}</p>
    {source.scanned && <p className="document-notice">{d(locale, "scanNotice")}</p>}
    {source.ledger ? <p>{d(locale, "parsedLedger")}</p> : <details className="document-settings"><summary>{d(locale, "columns")}</summary>
      {source.tables.length > 1 && <label className="field-label">{d(locale, "table")}<select value={options.tableIndex ?? preview.tableIndex} onChange={(event) => onOptions({ ...options, tableIndex: Number(event.target.value), mapping: undefined, headerRow: undefined })}>{source.tables.map((table, index) => <option value={index} key={index}>{table.name}</option>)}</select></label>}
      <label className="field-label">{d(locale, "headerRow")}<select value={options.headerRow ?? preview.headerRow} onChange={(event) => onOptions({ ...options, headerRow: Number(event.target.value), mapping: undefined })}><option value={-1}>{d(locale, "noHeader")}</option>{(source.tables[options.tableIndex ?? preview.tableIndex]?.rows ?? []).slice(0, 25).map((row, index) => <option value={index} key={index}>{index + 1}: {row.join(" · ").slice(0, 90)}</option>)}</select></label>
      <div className="two-fields">{([['date', 'dateColumn'], ['description', 'merchantColumn'], ['amount', 'amountColumn'], ['debit', 'debitColumn'], ['credit', 'creditColumn'], ['currency', 'currencyColumn'], ['status', 'statusColumn'], ['type', 'typeColumn'], ['transactionId', 'idColumn']] as const).map(([key, label]) => <label className="field-label" key={key}>{d(locale, label)}<select value={mapping[key] ?? ""} onChange={(event) => setColumn(key, event.target.value)}><option value="">{d(locale, "none")}</option>{columnHeaders.map((header, index) => <option value={index} key={index}>{index + 1}: {header}</option>)}</select></label>)}</div>
      <div className="two-fields"><label className="field-label">{d(locale, "dateOrder")}<select value={options.dateOrder ?? "auto"} onChange={(event) => onOptions({ ...options, dateOrder: event.target.value as StatementImportOptions['dateOrder'] })}>{(['auto', 'dmy', 'mdy'] as const).map((value) => <option value={value} key={value}>{d(locale, value)}</option>)}</select></label><label className="field-label">{d(locale, "sign")}<select value={options.amountSign ?? "auto"} onChange={(event) => onOptions({ ...options, amountSign: event.target.value as StatementImportOptions['amountSign'] })}>{(['auto', 'negative', 'positive'] as const).map((value) => <option value={value} key={value}>{d(locale, value === "auto" ? "automatic" : value)}</option>)}</select></label></div>
      <label className="field-label">{d(locale, "defaultCurrency")}<select value={options.defaultCurrency ?? "EUR"} onChange={(event) => onOptions({ ...options, defaultCurrency: event.target.value })}>{currencyCodes.map((currency) => <option key={currency} value={currency}>{currencyName(currency, locale)}</option>)}</select></label>
    </details>}
    <label className="field-label">{d(locale, "target")}<select value={targetId} disabled={busy} onChange={(event) => { setTargetId(event.target.value); setPayer(""); setPeople([]); }}><option value="new">{d(locale, "newGeneral")}</option>{state.ledgers.map((ledger) => <option value={ledger.id} key={ledger.id}>{ledger.title}{ledger.kind === "general" ? ` (${ledger.currency})` : ""}</option>)}</select></label>
    {targetId === "new" && <label className="field-label">{d(locale, "newTitle")}<input value={title} maxLength={70} disabled={busy} onChange={(event) => setTitle(event.target.value)} /></label>}
    {target?.kind === "travel" && <div className="expense-form-grid"><p className="sheet-intro">{d(locale, "payerHelp")}</p><label>{t(locale, "payer")}<select disabled={busy} value={payer} onChange={(event) => setPayer(event.target.value)}><option value="">{d(locale, "none")}</option>{target.participants.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label><fieldset><legend>{t(locale, "splitWith")}</legend><div className="split-grid">{target.participants.map((person) => <label key={person.id}><input type="checkbox" disabled={busy} checked={people.includes(person.id)} onChange={(event) => setPeople((current) => event.target.checked ? [...current, person.id] : current.filter((id) => id !== person.id))} />{person.name}</label>)}</div>{!target.participants.length && <p>{t(locale, "atLeastOneParticipant")}</p>}</fieldset></div>}
    <h3>{d(locale, "rows")} · {rows.length}</h3><p className="sheet-intro">{d(locale, "incomplete")}</p>
    <div className="document-buttons"><button type="button" disabled={busy} onClick={() => setRows((current) => current.map((row) => ({ ...row, selected: validateStatementImportRow(row) && !row.reviewReasons.some((reason) => ["duplicate", "ambiguous_direction", "cancelled", "refund_unmatched", "conflicting_duplicate"].includes(reason)) })))}>{d(locale, "selectAll")}</button><button type="button" disabled={busy} onClick={() => setRows((current) => current.map((row) => ({ ...row, selected: false })))}>{d(locale, "selectNone")}</button></div>
    {!rows.length && <p className="document-notice">{d(locale, "empty")}</p>}
    {adjustments.length > 0 && <section className="document-adjustments"><h3>{d(locale, "adjustments")} · {adjustments.length}</h3><p className="sheet-intro">{d(locale, "adjustmentHelp")}</p>{adjustments.map((adjustment) => <label className="document-adjustment" key={adjustment.id}><input type="checkbox" disabled={busy} checked={adjustment.selected} onChange={(event) => setAdjustments((current) => current.map((item) => item.id === adjustment.id ? { ...item, selected: event.target.checked } : item))} /><span><strong>{adjustment.description}</strong><small>{adjustment.occurredOn} · {formatMoney(adjustment.minorUnits, adjustment.currency, locale)} · {adjustment.kind === "cancelled" ? d(locale, "cancelled") : d(locale, "refund")}</small></span></label>)}</section>}
    <div className="document-rows">{visibleRows.map((row) => <ExpenseReviewRow key={row.id} row={row} locale={locale} disabled={busy} onChange={(patch) => update(row.id, patch)} />)}</div>
    {rows.length > 20 && <div className="document-pagination"><button type="button" disabled={page === 0} onClick={() => setPage((value) => value - 1)} aria-label={d(locale, "previousPage")}><ChevronLeft /></button><span>{page + 1} / {Math.ceil(rows.length / 20)}</span><button type="button" disabled={(page + 1) * 20 >= rows.length} onClick={() => setPage((value) => value + 1)} aria-label={d(locale, "nextPage")}><ChevronRight /></button></div>}
    <button type="button" className="wide-secondary" disabled={busy || rows.length >= 5000} onClick={() => { setRows((current) => [...current, { id: "document-manual-" + crypto.randomUUID(), sourceRow: -1, raw: [], description: "", occurredOn: "", currency: options.defaultCurrency ?? "EUR", minorUnits: 0, category: "other", reviewReasons: [], selected: false }]); setPage(Math.floor(rows.length / 20)); }}><Plus />{d(locale, "addRow")}</button>
    <details><summary>{d(locale, "ignored")} · {preview.excluded.length} / {d(locale, "unknown")} · {preview.issues.length}</summary><p className="sheet-intro">{d(locale, "cancelledHelp")}</p><pre className="document-original">{[...preview.excluded, ...preview.issues].map((issue) => issue.raw.join(" · ")).join("\n")}</pre></details>
    <details><summary>{d(locale, "original")}</summary><pre className="document-original">{source.text || JSON.stringify(source.ledger?.ledger, null, 2)}</pre></details>
    <section className="document-summary" aria-label={d(locale, "summary")}><h3>{d(locale, "summary")}</h3><p>{dates.length ? dates[0] + " — " + dates[dates.length - 1] : "—"}</p><p>{d(locale, "selected")}: <strong>{selected.length}</strong></p>{[...totals.entries()].map(([currency, amount]) => <p key={currency}>{currency}<strong>{Number.isSafeInteger(amount) ? formatMoney(amount, currency, locale) : d(locale, "invalid")}</strong></p>)}</section>
    {(wrongCurrency || error) && <p className="exchange-error" role="alert">{error || d(locale, "wrongCurrency")}</p>}
    <button type="button" className="primary-button wide" disabled={busy || !canSave} onClick={() => void confirm()}>{busy ? t(locale, "importing") : d(locale, "confirm")}</button>
  </div>;
}

function ExpenseReviewRow({ row, locale, disabled, onChange }: { row: StatementImportRow; locale: Locale; disabled: boolean; onChange: (patch: Partial<StatementImportRow>) => void }) {
  const [amount, setAmount] = useState(row.minorUnits ? (row.minorUnits / 10 ** currencyDigits(row.currency)).toFixed(currencyDigits(row.currency)) : "");
  const valid = validateStatementImportRow(row);
  return <article className={valid ? "document-row" : "document-row needs-review"}>
    <label className="document-keep"><input type="checkbox" checked={row.selected} disabled={disabled || !valid || row.reviewReasons.includes("duplicate")} onChange={(event) => onChange({ selected: event.target.checked })} />{d(locale, "keep")}<span>{row.sourceRow > 0 ? "#" + row.sourceRow : d(locale, "newRow")}</span></label>
    {(!valid || row.reviewReasons.length > 0) && <p className="document-row-note">{d(locale, row.reviewReasons.includes("duplicate") ? "reviewedDuplicate" : row.reviewReasons.some((reason) => reason === "cancelled" || reason === "refund_unmatched") ? "cancelled" : row.reviewReasons.includes("ambiguous_direction") ? "directionReview" : row.reviewReasons.includes("refund_adjusted") ? "refundMatched" : "invalid")}</p>}
    <div className="two-fields"><label className="field-label">{t(locale, "date")}<input type="date" value={row.occurredOn} disabled={disabled} onChange={(event) => onChange({ occurredOn: event.target.value, selected: false })} /></label><label className="field-label">{t(locale, "currency")}<select value={row.currency} disabled={disabled} onChange={(event) => onChange({ currency: event.target.value, minorUnits: parseMinorUnits(amount, event.target.value) ?? 0, selected: false })}>{currencyCodes.map((currency) => <option key={currency}>{currency}</option>)}</select></label></div>
    <label className="field-label">{t(locale, "description")}<input value={row.description} maxLength={500} disabled={disabled} onChange={(event) => onChange({ description: event.target.value })} /></label>
    <div className="two-fields"><label className="field-label">{t(locale, "amount")}<input inputMode="decimal" value={amount} disabled={disabled} onChange={(event) => { setAmount(event.target.value); onChange({ minorUnits: parseMinorUnits(event.target.value, row.currency) ?? 0, selected: false }); }} /></label><label className="field-label">{t(locale, "category")}<select value={row.category} disabled={disabled} onChange={(event) => onChange({ category: event.target.value as StatementImportRow['category'] })}>{GENERAL_CATEGORIES.map((category) => <option key={category} value={category}>{generalCategoryLabel(locale, category)}</option>)}</select></label></div>
    {row.raw.length > 0 && <details><summary>{d(locale, "original")}</summary><p className="document-raw-row">{row.raw.join(" · ")}</p></details>}
  </article>;
}
