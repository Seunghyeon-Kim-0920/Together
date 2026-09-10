import { currencyDigits } from "./currency";
import { publicExpenseId } from "./expenseIdentity";
import { merchantDisplayName } from "./merchant";
import type { LedgerShareDocument } from "./share";
import { GENERAL_CATEGORIES, TRAVEL_CATEGORIES, type GeneralCategory, type GeneralExpense, type Ledger, type WalletState } from "./types";
import { createLedger, MAX_EXPENSES_PER_LEDGER, MAX_LEDGERS, parseWalletStateStrict, splitEvenly } from "./wallet";

/** Extraction is intentionally separate from interpreting money. Nothing in
 * this module reads the network or writes storage; every import is a preview. */
export interface ReadExpenseDocument {
  readonly tables: readonly { readonly name: string; readonly rows: readonly (readonly string[])[] }[];
  readonly text: string;
  readonly ledger: LedgerShareDocument | null;
  readonly scanned: boolean;
  readonly name: string;
}
export interface StatementColumnMapping {
  readonly date?: number; readonly description?: number; readonly amount?: number;
  readonly debit?: number; readonly credit?: number; readonly currency?: number;
  readonly status?: number; readonly type?: number; readonly transactionId?: number;
  readonly relatedTransactionId?: number;
}
export interface StatementImportOptions {
  readonly defaultCurrency?: string;
  readonly dateOrder?: "auto" | "dmy" | "mdy" | "ymd";
  readonly amountSign?: "auto" | "negative" | "positive";
  readonly decimalSeparator?: "auto" | "." | ",";
  readonly mapping?: StatementColumnMapping;
  readonly tableIndex?: number;
  /** -1 means no header; data starts at the first row. */
  readonly headerRow?: number;
}
export type StatementIssueReason = "invalid_date" | "ambiguous_date" | "invalid_amount" | "missing_description" | "missing_currency" | "ambiguous_direction" | "income" | "balance" | "failed" | "pending" | "cancelled" | "refund_unmatched" | "refund_adjusted" | "refunded" | "duplicate" | "conflicting_duplicate" | "mapping_required" | "no_rows" | "scanned_document" | "row_limit" | "total_overflow";
export interface StatementImportRow {
  /** Identity belongs to the extracted source; keep it unchanged during edits. */
  readonly id: string;
  readonly sourceRow: number;
  readonly description: string;
  readonly occurredOn: string;
  readonly currency: string;
  readonly minorUnits: number;
  readonly category: GeneralCategory;
  readonly reviewReasons: readonly StatementIssueReason[];
  readonly raw: readonly string[];
  readonly selected: boolean;
  /** Original equal-transaction ordinal survives selecting only part of a
   * preview, so commit does not mistake the second payment for the first. */
  readonly sourceOccurrence?: number;
}
export interface StatementImportIssue { readonly sourceRow: number; readonly reason: StatementIssueReason; readonly raw: readonly string[]; }
export interface StatementImportAdjustment {
  readonly id: string;
  readonly sourceRow: number;
  readonly kind: "refund" | "cancelled";
  readonly description: string;
  readonly occurredOn: string;
  readonly currency: string;
  readonly minorUnits: number;
  readonly raw: readonly string[];
  readonly targetLedgerId: string;
  readonly targetExpenseId: string;
  readonly expectedMinorUnits: number;
  readonly selected: boolean;
}
export interface StatementCurrencyTotal { readonly currency: string; readonly minorUnits: string; readonly count: number; }
export interface StatementImportPreview {
  readonly rows: readonly StatementImportRow[];
  readonly excluded: readonly StatementImportIssue[];
  readonly issues: readonly StatementImportIssue[];
  readonly mapping: StatementColumnMapping;
  readonly headers: readonly string[];
  readonly tableIndex: number;
  readonly headerRow: number;
  readonly dateRange: { readonly from: string; readonly to: string } | null;
  readonly currencyTotals: readonly StatementCurrencyTotal[];
  readonly receivedCount: number;
  readonly adjustments: readonly StatementImportAdjustment[];
}
export type StatementImportTarget = { readonly kind: "existing"; readonly ledgerId: string; readonly paidBy?: string; readonly participantIds?: readonly string[] } | { readonly kind: "new-general"; readonly title: string };
export interface StatementImportResult { readonly state: WalletState; readonly added: number; readonly duplicates: number; readonly adjusted: number; readonly removed: number; readonly ledgerIds: readonly string[]; }

const MAX_SOURCE_ROWS = 20_000;
const FAILED = /(?:\b(?:declined|failed|rejected|échoué|echec|échec|refusé)\b|승인\s*거절|결제\s*실패|처리\s*불가)/iu;
const PENDING = /(?:\b(?:pending|scheduled|processing|authori[sz]ation|en attente|à venir)\b|예정|처리중|처리 중|승인대기)/iu;
const CANCELLED = /(?:\b(?:cancelled|canceled|reverted|reversed|annulé|annule|annulation)\b|취소)/iu;
const REFUND = /(?:\b(?:refund(?:ed)?|reimbursement|chargeback|remboursement|remboursé|avoir)\b|환불|환급)/iu;
const INCOME = /(?:\b(?:income|salary|deposit|top.?up|received|incoming|credited|credit titres.resto|crédit titres.resto|virement reçu|versement)\b|입금|급여|충전|받은\s*이체)/iu;
const BALANCE = /(?:\b(?:balance|solde|opening|closing|available|total|subtotal)\b|잔액|잔고|누계|합계|이월|월계)/iu;
const DEBIT = /(?:\b(?:debit|débit|purchase|payment|card payment|paid|withdrawal|direct debit|standing order|outgoing|sent|paiement|prélèvement|virement émis)\b|출금|결제|구매|사용|송금|보낸\s*이체|자동이체)/iu;
const fieldAliases: Record<keyof StatementColumnMapping, readonly string[]> = {
  date: ["date", "transaction date", "payment date", "booking date", "booked on", "completed date", "started date", "occurred on", "occurredOn", "date de transaction", "date opération", "date d'opération", "date de paiement", "날짜", "거래일", "거래일자", "거래일시", "이용일자", "승인일자", "결제일", "사용일시"],
  description: ["description", "merchant", "merchant name", "payee", "name", "counterparty", "libellé", "libelle", "commerçant", "commercant", "bénéficiaire", "가맹점", "가맹점명", "사용처", "적요", "거래내용", "내용", "받는분"],
  amount: ["amount", "transaction amount", "payment amount", "montant", "montant de transaction", "금액", "거래금액", "이용금액", "승인금액", "결제금액", "사용금액"],
  debit: ["debit", "débit", "money out", "paid out", "withdrawal", "withdrawals", "expense", "dépense", "지출", "출금", "출금액", "출금금액", "찾으신금액", "지출금액"],
  credit: ["credit", "crédit", "money in", "paid in", "deposit", "deposits", "income", "입금", "입금액", "입금금액", "맡기신금액"],
  currency: ["currency", "currency code", "devise", "통화", "화폐", "통화코드", "이용통화", "거래통화"],
  status: ["status", "state", "statut", "état", "etat", "상태", "거래상태", "승인상태", "처리결과"],
  type: ["type", "transaction type", "direction", "nature", "유형", "거래구분", "구분", "거래유형", "입출금구분"],
  transactionId: ["transaction id", "transactionId", "id", "fitid", "reference", "référence", "거래번호", "승인번호"],
  relatedTransactionId: ["related transaction id", "relatedTransactionId", "original transaction id", "original reference", "원거래번호", "원승인번호"],
};
function canonical(value: string): string { return value.normalize("NFKC").toLocaleLowerCase("en").replace(/[\s\p{P}\p{S}]+/gu, ""); }
function merchantKey(value: string): string { return value.normalize("NFKC").trim().toLocaleLowerCase("en").replace(/\s+/gu, " "); }
function fingerprint(value: string): string {
  let left = 0x811c9dc5; let right = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) { const code = value.charCodeAt(index); left = Math.imul(left ^ code, 0x01000193); right = Math.imul(right ^ code, 0x85ebca6b); right ^= right >>> 13; }
  return `${(left >>> 0).toString(16).padStart(8, "0")}${(right >>> 0).toString(16).padStart(8, "0")}`;
}
function currencyCode(value: string | undefined): string | null {
  const clean = (value ?? "").trim().toUpperCase();
  const symbols: Record<string, string> = { "€": "EUR", EURO: "EUR", EUROS: "EUR", "유로": "EUR", "₩": "KRW", "원": "KRW", "£": "GBP", "円": "JPY" };
  return symbols[clean] ?? (/^[A-Z]{3}$/u.test(clean) ? clean : null);
}
function amountCurrency(raw: string, fallback?: string): string | null {
  const chosen = currencyCode(fallback);
  const code = raw.match(/\b(?:EUR|USD|GBP|KRW|JPY|CNY|CHF|CAD|AUD|NZD|SGD|HKD|INR|THB|VND|KWD|BHD|TND|PLN|CZK|DKK|NOK|SEK|HUF|RON|TRY|BRL|MXN|ZAR|AED|SAR|QAR|IDR|PHP|MYR|TWD)\b/iu)?.[0];
  if (code) return currencyCode(code);
  if (/€|\beuros?\b|유로/iu.test(raw)) return "EUR";
  if (/₩|원/u.test(raw)) return "KRW";
  if (/£/u.test(raw)) return "GBP";
  if (/円/u.test(raw)) return "JPY";
  if (/¥|￥/u.test(raw)) return chosen === "JPY" || chosen === "CNY" ? chosen : null;
  // A bare dollar sign cannot distinguish USD, CAD, AUD, etc.
  if (/\$/u.test(raw)) return chosen && /^(?:USD|CAD|AUD|NZD|SGD|HKD|MXN|TWD)$/u.test(chosen) ? chosen : null;
  return chosen;
}

/** The calendar date displayed by the provider is retained; offsets never
 * shift a late-night local purchase to another date. Ambiguous slash dates
 * require the user's chosen order. */
export function parseStatementDate(input: string, order: StatementImportOptions["dateOrder"] = "auto"): string | null {
  const value = input.trim().replace(/년\s*/gu, "-").replace(/월\s*/gu, "-").replace(/일/gu, "");
  const clock = /[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/u.exec(value);
  if (clock && (Number(clock[1]) > 23 || Number(clock[2]) > 59 || Number(clock[3] ?? 0) > 59)) return null;
  let year = 0; let month = 0; let day = 0;
  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:\s?(?:Z|[+-]\d{2}:?\d{2}))?)?$/u.exec(value);
  if (iso) { year = Number(iso[1]); month = Number(iso[2]); day = Number(iso[3]); }
  else {
    const local = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/u.exec(value);
    if (!local || order === "ymd") return null;
    const first = Number(local[1]); const second = Number(local[2]); year = Number(local[3]);
    if (order === "dmy" || (order === "auto" && first > 12 && second <= 12)) { day = first; month = second; }
    else if (order === "mdy" || (order === "auto" && second > 12 && first <= 12)) { month = first; day = second; }
    else if (first === second) { month = first; day = second; }
    else return null;
  }
  if (year < 1900 || year > 2199 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const result = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const parsed = new Date(`${result}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === result ? result : null;
}

/** Strict decimal parsing uses integer arithmetic, including zero-decimal
 * currencies. Separators are never deleted if that would change precision. */
export function parseStatementAmount(input: string, currency: string, decimal: StatementImportOptions["decimalSeparator"] = "auto"): number | null {
  if (!currencyCode(currency)) return null;
  let value = input.normalize("NFKC").trim().replace(/[−–]/gu, "-");
  const declared = amountCurrency(value, currency);
  if (declared !== currency) return null;
  let negative = /^\(.*\)$/u.test(value); if (negative) value = value.slice(1, -1).trim();
  const creditDebit = /\s+(CR|DR)$/iu.exec(value); if (creditDebit) { negative ||= creditDebit[1].toUpperCase() === "DR"; value = value.slice(0, creditDebit.index); }
  value = value.replace(new RegExp(`\\b${currency}\\b`, "giu"), "").replace(/\beuros?\b|유로|[€$£₩¥￥円원]/giu, "").trim();
  if (/^[+-]/u.test(value)) { if (negative) return null; negative = value[0] === "-"; value = value.slice(1).trim(); }
  if (/-$/u.test(value)) { if (negative) return null; negative = true; value = value.slice(0, -1).trim(); }
  if (!/^[\d., '\u00a0\u202f]+$/u.test(value) || !/\d/u.test(value)) return null;
  // Space/apostrophe groups must have genuine thousands-group structure.
  if (/[ '\u00a0\u202f]/u.test(value)) {
    if (!/^\d{1,3}(?:[ '\u00a0\u202f]\d{3})+(?:[.,]\d+)?$/u.test(value)) return null;
    value = value.replace(/[ '\u00a0\u202f]/gu, "");
  }
  const digits = currencyDigits(currency); const commas = (value.match(/,/gu) ?? []).length; const dots = (value.match(/\./gu) ?? []).length;
  let decimalChar: "." | "," | null = decimal === "." || decimal === "," ? decimal : null;
  if (!decimalChar && commas && dots) decimalChar = value.lastIndexOf(",") > value.lastIndexOf(".") ? "," : ".";
  if (!decimalChar && commas + dots === 1) {
    const separator = commas ? "," : "."; const fractionLength = value.length - value.lastIndexOf(separator) - 1;
    if (fractionLength <= digits && fractionLength !== 3) decimalChar = separator;
    else if (fractionLength === 3 && digits === 3) return null;
    else if (fractionLength !== 3) return null;
  }
  let whole = value; let fraction = "";
  if (decimalChar && value.includes(decimalChar)) {
    const pieces = value.split(decimalChar); if (pieces.length !== 2) return null;
    [whole, fraction] = pieces;
    if (!/^\d+$/u.test(fraction) || fraction.length > digits) return null;
  }
  if (/[.,]/u.test(whole)) {
    const grouping = whole.includes(",") ? "," : ".";
    if (whole.includes(grouping === "," ? "." : ",")) return null;
    const escaped = grouping === "." ? "\\." : ",";
    const western = new RegExp(`^\\d{1,3}(?:${escaped}\\d{3})+$`, "u");
    const indian = new RegExp(`^\\d{1,2}(?:${escaped}\\d{2})*${escaped}\\d{3}$`, "u");
    if (!western.test(whole) && !indian.test(whole)) return null;
    whole = whole.split(grouping).join("");
  }
  if (!/^\d{1,18}$/u.test(whole)) return null;
  const result = BigInt(whole) * 10n ** BigInt(digits) + BigInt(fraction.padEnd(digits, "0") || "0");
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(result) * (negative ? -1 : 1);
}

export function detectStatementColumns(headers: readonly string[]): StatementColumnMapping {
  const mapping: Partial<Record<keyof StatementColumnMapping, number>> = {};
  for (const key of Object.keys(fieldAliases) as (keyof StatementColumnMapping)[]) {
    const aliases = fieldAliases[key].map(canonical);
    const matches = headers.flatMap((header, index) => aliases.includes(canonical(header)) ? [index] : []);
    if (matches.length) mapping[key] = matches[0];
  }
  // Revolut exports both dates; completed is the posted transaction date.
  const completed = headers.findIndex((header) => canonical(header) === "completeddate");
  if (completed >= 0) mapping.date = completed;
  return Object.freeze(mapping);
}
function headerScore(mapping: StatementColumnMapping): number {
  return (mapping.date !== undefined ? 3 : 0) + (mapping.description !== undefined ? 3 : 0) + (mapping.amount !== undefined || mapping.debit !== undefined ? 4 : 0) + (mapping.currency !== undefined ? 1 : 0);
}
function issue(sourceRow: number, reason: StatementIssueReason, raw: readonly string[]): StatementImportIssue { return Object.freeze({ sourceRow, reason, raw: Object.freeze([...raw]) }); }
function categoryFor(description: string): GeneralCategory {
  if (/\b(?:lidl|aldi|supermarket|supermarché|restaurant|cafe|café|coffee|starbucks|mcdonald|burger|kfc|grocery)\b|마트|식당|카페|편의점/iu.test(description)) return "food";
  if (/\b(?:uber|bolt|sncf|train|metro|métro|bus|taxi)\b|택시|지하철|철도/iu.test(description)) return "transport";
  return "other";
}
function semanticKey(row: Pick<StatementImportRow, "description" | "occurredOn" | "currency" | "minorUnits">): string { return JSON.stringify([merchantKey(row.description), row.occurredOn, row.currency, row.minorUnits]); }
function existingIndex(state?: WalletState): { ids: Set<string>; signatures: Map<string, number>; weakSignatures: Map<string, number> } {
  const ids = new Set<string>(); const signatures = new Map<string, number>(); const weakSignatures = new Map<string, number>();
  for (const ledger of state?.ledgers ?? []) {
    for (const receipt of ledger.statementImportHistory ?? []) { ids.add(receipt.id); ids.add(receipt.expenseId); }
    for (const expense of ledger.expenses) {
      ids.add(expense.id); ids.add(publicExpenseId(ledger.id, expense.id));
      if (ledger.kind === "general") { const general = expense as GeneralExpense; if (general.automationFingerprint) ids.add(general.automationFingerprint); }
      const key = semanticKey({ ...expense, description: merchantDisplayName(expense.description, expense.id) });
      signatures.set(key, (signatures.get(key) ?? 0) + 1);
      if (!expense.id.startsWith("statement-t-")) weakSignatures.set(key, (weakSignatures.get(key) ?? 0) + 1);
    }
    if (ledger.kind === "general") for (const id of ledger.movedExpenseIds) { ids.add(id); ids.add(publicExpenseId(ledger.id, id)); }
  }
  return { ids, signatures, weakSignatures };
}
function markExistingDuplicates(rows: readonly StatementImportRow[], state?: WalletState): StatementImportRow[] {
  const known = existingIndex(state); const consumed = new Map<string, number>();
  return rows.map((row) => {
    const key = semanticKey(row); const used = consumed.get(key) ?? 0; consumed.set(key, used + 1);
    const signatures = row.id.startsWith("statement-t-") ? known.weakSignatures : known.signatures;
    const duplicate = known.ids.has(row.id) || used < (signatures.get(key) ?? 0);
    return Object.freeze({ ...row, sourceOccurrence: used, reviewReasons: Object.freeze([...row.reviewReasons.filter((reason) => reason !== "duplicate"), ...(duplicate ? ["duplicate" as const] : [])]), selected: row.selected && !duplicate });
  });
}

interface ParsedSourceRow { row: StatementImportRow; transactionId: string; relatedId: string; kind: "expense" | "refund" | "cancelled"; }
function parseTableRow(raw: readonly string[], sourceRow: number, mapping: StatementColumnMapping, options: StatementImportOptions): { parsed?: ParsedSourceRow; excluded?: StatementImportIssue } {
  const cell = (key: keyof StatementColumnMapping) => { const index = mapping[key]; return index === undefined ? "" : (raw[index] ?? "").trim(); };
  const description = cell("description"); const status = cell("status"); const type = cell("type"); const context = `${status} ${type} ${description}`;
  // Merchant brands include Total and New Balance. Only a balance label or
  // explicit transaction type is evidence that this row is an account total.
  const balanceLabel = /^(?:(?:opening|closing|available|current|account)\s+)?(?:balance|solde)(?:\s+(?:initial|final|disponible|du compte))?\s*[:：]?$/iu.test(description) || /^(?:잔액|잔고|누계|합계|이월|월계)(?:\s*금액)?\s*[:：]?$/u.test(description) || /\b(?:opening balance|closing balance|solde initial|solde final)\b/iu.test(description);
  if (balanceLabel || BALANCE.test(type)) return { excluded: issue(sourceRow, "balance", raw) };
  if (FAILED.test(context)) return { excluded: issue(sourceRow, "failed", raw) };
  if (PENDING.test(status) || PENDING.test(type)) return { excluded: issue(sourceRow, "pending", raw) };
  const cancelled = CANCELLED.test(context);
  const refund = REFUND.test(context);
  if (!refund && !cancelled && (INCOME.test(context) || /^(?:credit|crédit|cr|c)$/iu.test(type))) return { excluded: issue(sourceRow, "income", raw) };
  const rawAmount = mapping.debit !== undefined ? cell("debit") : cell("amount");
  const code = cell("currency") ? currencyCode(cell("currency")) : amountCurrency(rawAmount || cell("credit"), options.defaultCurrency);
  const amount = code ? parseStatementAmount(rawAmount, code, options.decimalSeparator) : null;
  const credit = code && cell("credit") ? parseStatementAmount(cell("credit"), code, options.decimalSeparator) : null;
  if (mapping.debit !== undefined && (amount === 0 || rawAmount === "") && credit !== null && credit > 0 && !refund && !cancelled) return { excluded: issue(sourceRow, "income", raw) };
  const review: StatementIssueReason[] = [];
  const occurredOn = parseStatementDate(cell("date"), options.dateOrder);
  if (!occurredOn) review.push(options.dateOrder !== "dmy" && options.dateOrder !== "mdy" && /^\d{1,2}[/.-]\d{1,2}[/.-]\d{4}/u.test(cell("date")) ? "ambiguous_date" : "invalid_date");
  if (!description || description.length > 500) review.push("missing_description");
  if (!code) review.push("missing_currency");
  const actualAmount = (refund || cancelled) && (amount === null || amount === 0) && credit !== null ? credit : amount;
  if (actualAmount === null || actualAmount === 0) review.push("invalid_amount");
  if (!refund && !cancelled && actualAmount !== null && actualAmount !== 0 && mapping.debit === undefined) {
    if (options.amountSign === "negative" && actualAmount > 0) return { excluded: issue(sourceRow, "income", raw) };
    if (options.amountSign === "positive" && actualAmount < 0) return { excluded: issue(sourceRow, "income", raw) };
    if ((!options.amountSign || options.amountSign === "auto") && actualAmount > 0 && !DEBIT.test(type) && !DEBIT.test(status)) review.push("ambiguous_direction");
  }
  const minorUnits = actualAmount === null ? 0 : Math.abs(actualAmount);
  const transactionId = cell("transactionId"); const relatedId = cell("relatedTransactionId");
  const identity = JSON.stringify([transactionId || null, occurredOn || cell("date"), code || "", merchantKey(description), minorUnits]);
  const row: StatementImportRow = Object.freeze({ id: `statement-${transactionId ? "t-" : ""}${fingerprint(identity)}`, sourceRow, description, occurredOn: occurredOn ?? "", currency: code ?? "", minorUnits, category: categoryFor(description), reviewReasons: Object.freeze(review), raw: Object.freeze([...raw]), selected: review.length === 0 });
  return { parsed: { row, transactionId, relatedId, kind: cancelled ? "cancelled" : refund ? "refund" : "expense" } };
}

/** Text-only PDF/OCR lines become editable rows. Only date-leading lines with
 * an explicit currency (or user-selected default) are interpreted. Multiple
 * numeric columns require mapping instead of guessing which one is balance. */
function textTable(text: string): { name: string; rows: readonly string[][] } {
  const rows: string[][] = [["Date", "Description", "Amount", "Currency", "Type"]];
  for (const line of text.split(/\r?\n/u)) {
    const date = /^\s*(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?\s+(.+)$/u.exec(line);
    if (!date) continue;
    const content = date[2];
    const ending = /^(.*?)\s+([+-]?\(?\d[\d., '\u00a0\u202f]*\)?(?:\s*(?:€|EUR|USD|GBP|KRW|JPY|CNY|CHF|CAD|AUD|INR|KWD|[$£₩¥]))?|(?:€|[$£₩¥]|EUR|USD|GBP|KRW)\s*[+-]?\d[\d., '\u00a0\u202f]*)\s*$/iu.exec(content);
    if (!ending) { rows.push([date[1], content, "", "", ""]); continue; }
    const description = ending[1].trim(); const amount = ending[2].trim();
    // A preceding numeric amount is evidence of a multi-column statement.
    if (/(?:^|\s)[+-]?\(?\d[\d., '\u00a0\u202f]*\)?\s*(?:[€$£₩¥]|[A-Z]{3}|원|円)?\s*$/u.test(description)) { rows.push([date[1], content, "", "", ""]); continue; }
    rows.push([date[1], description, amount, amountCurrency(amount) ?? "", DEBIT.test(description) ? "payment" : ""]);
  }
  return { name: "text", rows };
}

function completePreview(rowsInput: readonly StatementImportRow[], excluded: StatementImportIssue[], issues: StatementImportIssue[], mapping: StatementColumnMapping, headers: readonly string[], tableIndex: number, headerRow: number, receivedCount: number, state?: WalletState, adjustments: readonly StatementImportAdjustment[] = []): StatementImportPreview {
  const rows = markExistingDuplicates(rowsInput, state); const dates = rows.filter((row) => validateStatementImportRow(row)).map((row) => row.occurredOn).sort();
  const totals = new Map<string, { amount: bigint; count: number }>();
  for (const row of rows) if (row.selected && validateStatementImportRow(row)) { const total = totals.get(row.currency) ?? { amount: 0n, count: 0 }; total.amount += BigInt(row.minorUnits); total.count += 1; totals.set(row.currency, total); }
  if ([...totals.values()].some((total) => total.amount > BigInt(Number.MAX_SAFE_INTEGER))) issues.push(issue(0, "total_overflow", []));
  return Object.freeze({ rows: Object.freeze(rows), excluded: Object.freeze(excluded), issues: Object.freeze(issues), mapping, headers: Object.freeze([...headers]), tableIndex, headerRow, receivedCount, adjustments: Object.freeze(adjustments.map((adjustment) => Object.freeze({ ...adjustment, raw: Object.freeze([...adjustment.raw]) }))), dateRange: dates.length ? Object.freeze({ from: dates[0], to: dates[dates.length - 1] }) : null, currencyTotals: Object.freeze([...totals].sort(([a], [b]) => a.localeCompare(b)).map(([currency, total]) => Object.freeze({ currency, minorUnits: total.amount.toString(), count: total.count }))) });
}

function existingAdjustmentHistory(state?: WalletState): Set<string> {
  return new Set((state?.ledgers ?? []).flatMap((ledger) => (ledger.statementImportHistory ?? []).filter((receipt) => receipt.kind === "adjustment").map((receipt) => receipt.id)));
}

function savedRefundCandidates(state: WalletState | undefined, reversal: ParsedSourceRow): { ledgerId: string; expenseId: string; minorUnits: number }[] {
  if (!state || !validateStatementImportRow(reversal.row)) return [];
  const cleanDescription = merchantKey(reversal.row.description.replace(REFUND, "").replace(CANCELLED, "").trim());
  const candidates: { ledgerId: string; expenseId: string; minorUnits: number }[] = [];
  for (const ledger of state.ledgers) {
    if (ledger.kind !== "general") continue;
    for (const expense of ledger.expenses) {
      const merchant = merchantKey(merchantDisplayName(expense.description, expense.id));
      if (expense.currency !== reversal.row.currency || merchant !== cleanDescription || expense.occurredOn > reversal.row.occurredOn) continue;
      if (reversal.kind === "cancelled" ? expense.minorUnits === reversal.row.minorUnits : expense.minorUnits >= reversal.row.minorUnits) candidates.push({ ledgerId: ledger.id, expenseId: expense.id, minorUnits: expense.minorUnits });
    }
  }
  return candidates;
}

export function previewExpenseDocument(document: ReadExpenseDocument, options: StatementImportOptions = {}, existingState?: WalletState): StatementImportPreview {
  if (document.ledger?.ledger.kind === "general") {
    const rows = document.ledger.ledger.expenses.map((expense, index): StatementImportRow => Object.freeze({ ...expense, description: merchantDisplayName(expense.description, expense.id), sourceRow: index + 1, raw: Object.freeze([expense.occurredOn, expense.description, String(expense.minorUnits), expense.currency]), reviewReasons: Object.freeze([]), selected: true }));
    return completePreview(rows, [], [], {}, [], 0, -1, rows.length, existingState);
  }
  const tables = document.tables.length ? document.tables.map((table) => {
    // Real multi-column data must retain its original column positions for
    // manual mapping, including trailing status and balance columns.
    if (table.rows.some((cells) => cells.length > 1)) return table;
    const score = Math.max(0, ...table.rows.slice(0, 30).map((header) => headerScore(detectStatementColumns(header))));
    if (score >= 7) return table;
    const extracted = textTable(table.rows.map((cells) => cells.join(" ")).join("\n"));
    // PDF/OCR readers provide tables even for single line fragments. Replace
    // only usable date-leading text with explicit virtual column headers.
    return extracted.rows.length > 1 ? { name: table.name, rows: extracted.rows } : table;
  }) : [textTable(document.text)];
  let tableIndex = options.tableIndex ?? 0; let headerRow = options.headerRow ?? -1; let mapping = options.mapping ?? {};
  if (options.tableIndex === undefined || options.headerRow === undefined || options.mapping === undefined) {
    let bestScore = -1;
    for (let table = 0; table < tables.length; table += 1) {
      if (options.tableIndex !== undefined && table !== options.tableIndex) continue;
      const possibleRows = options.headerRow !== undefined ? [options.headerRow] : Array.from({ length: Math.min(30, tables[table].rows.length) }, (_, index) => index);
      for (const header of possibleRows) {
        const detected = options.mapping ?? detectStatementColumns(tables[table].rows[header] ?? []); const score = headerScore(detected);
        if (score > bestScore) { bestScore = score; tableIndex = table; headerRow = options.headerRow === undefined && score < 7 ? -1 : header; mapping = detected; }
      }
    }
  }
  const table = tables[tableIndex]; const headers = table?.rows[headerRow] ?? [];
  if (!table) return completePreview([], [], [issue(0, "no_rows", [])], mapping, headers, tableIndex, headerRow, 0, existingState);
  const sourceRows = table.rows.slice(Math.max(0, headerRow + 1)); const excluded: StatementImportIssue[] = []; const issues: StatementImportIssue[] = [];
  if (mapping.date === undefined || mapping.description === undefined || (mapping.amount === undefined && mapping.debit === undefined)) issues.push(issue(0, "mapping_required", headers));
  if (document.scanned && !document.text.trim() && !sourceRows.length) issues.push(issue(0, "scanned_document", []));
  if (sourceRows.length > MAX_SOURCE_ROWS) issues.push(issue(0, "row_limit", []));
  const parsed: ParsedSourceRow[] = []; const identitySeen = new Map<string, ParsedSourceRow>(); const occurrences = new Map<string, number>(); const conflicts = new Set<string>();
  for (const [index, raw] of sourceRows.slice(0, MAX_SOURCE_ROWS).entries()) {
    if (!raw.some((cell) => cell.trim())) continue;
    const result = parseTableRow(raw, index + headerRow + 2, mapping, options);
    if (result.excluded) { excluded.push(result.excluded); continue; }
    if (!result.parsed) continue;
    const current = result.parsed;
    if (current.transactionId && current.kind === "expense") {
      const identityKey = JSON.stringify([current.transactionId, current.row.currency]); const previous = identitySeen.get(identityKey);
      if (previous) {
        if (previous.row.id === current.row.id) excluded.push(issue(current.row.sourceRow, "duplicate", raw));
        else { conflicts.add(identityKey); excluded.push(issue(current.row.sourceRow, "conflicting_duplicate", raw)); }
        continue;
      }
      identitySeen.set(identityKey, current);
    }
    if (!current.transactionId && current.kind === "expense") {
      const occurrence = occurrences.get(current.row.id) ?? 0; occurrences.set(current.row.id, occurrence + 1);
      current.row = Object.freeze({ ...current.row, id: `${current.row.id}-${occurrence}` });
    }
    parsed.push(current);
  }
  const expenses = parsed.filter((entry) => entry.kind === "expense" && !conflicts.has(JSON.stringify([entry.transactionId, entry.row.currency])));
  for (const entry of parsed) if (entry.kind === "expense" && conflicts.has(JSON.stringify([entry.transactionId, entry.row.currency]))) excluded.push(issue(entry.row.sourceRow, "conflicting_duplicate", entry.row.raw));
  const adjustments = new Set<string>(); const savedAdjustments: StatementImportAdjustment[] = []; const appliedAdjustmentIds = existingAdjustmentHistory(existingState);
  for (const reversal of parsed.filter((entry) => entry.kind !== "expense")) {
    const reversalKey = JSON.stringify([reversal.transactionId || null, reversal.row.id, reversal.kind]);
    if (adjustments.has(reversalKey)) { excluded.push(issue(reversal.row.sourceRow, "duplicate", reversal.row.raw)); continue; }
    adjustments.add(reversalKey);
    if (!validateStatementImportRow(reversal.row)) { excluded.push(issue(reversal.row.sourceRow, reversal.kind === "cancelled" ? "cancelled" : "refund_unmatched", reversal.row.raw)); continue; }
    const targetId = reversal.relatedId || (reversal.kind === "cancelled" ? reversal.transactionId : "");
    const matching = expenses.filter((entry) => entry.row.minorUnits > 0 && entry.row.currency === reversal.row.currency && (targetId ? entry.transactionId === targetId : merchantKey(entry.row.description.replace(REFUND, "").replace(CANCELLED, "").trim()) === merchantKey(reversal.row.description.replace(REFUND, "").replace(CANCELLED, "").trim()) && entry.row.occurredOn && reversal.row.occurredOn && entry.row.occurredOn <= reversal.row.occurredOn && (reversal.kind === "cancelled" ? entry.row.minorUnits === reversal.row.minorUnits : entry.row.minorUnits >= reversal.row.minorUnits)));
    if (matching.length !== 1 || !Number.isSafeInteger(reversal.row.minorUnits) || reversal.row.minorUnits <= 0 || matching[0].row.minorUnits < reversal.row.minorUnits) {
      for (const match of matching) match.row = Object.freeze({ ...match.row, selected: false, reviewReasons: Object.freeze([...match.row.reviewReasons, reversal.kind === "cancelled" ? "cancelled" as const : "refund_unmatched" as const]) });
      const candidates = savedRefundCandidates(existingState, reversal);
      if (candidates.length === 1 && !appliedAdjustmentIds.has(`statement-adjustment-${fingerprint(JSON.stringify([reversal.row.id, reversal.kind, reversal.row.occurredOn, reversal.row.minorUnits]))}`)) {
        const candidate = candidates[0]; const adjustmentId = `statement-adjustment-${fingerprint(JSON.stringify([reversal.row.id, reversal.kind, reversal.row.occurredOn, reversal.row.minorUnits]))}`;
        savedAdjustments.push(Object.freeze({ id: adjustmentId, sourceRow: reversal.row.sourceRow, kind: reversal.kind === "cancelled" ? "cancelled" : "refund", description: reversal.row.description, occurredOn: reversal.row.occurredOn, currency: reversal.row.currency, minorUnits: reversal.row.minorUnits, raw: reversal.row.raw, targetLedgerId: candidate.ledgerId, targetExpenseId: candidate.expenseId, expectedMinorUnits: candidate.minorUnits, selected: true }));
        excluded.push(issue(reversal.row.sourceRow, "refund_adjusted", reversal.row.raw)); continue;
      }
      excluded.push(issue(reversal.row.sourceRow, reversal.kind === "cancelled" ? "cancelled" : "refund_unmatched", reversal.row.raw)); continue;
    }
    const match = matching[0]; const remaining = reversal.kind === "cancelled" ? 0 : match.row.minorUnits - reversal.row.minorUnits;
    match.row = Object.freeze({ ...match.row, minorUnits: remaining, reviewReasons: Object.freeze([...match.row.reviewReasons, "refund_adjusted" as const]) });
    excluded.push(issue(reversal.row.sourceRow, "refunded", reversal.row.raw));
  }
  const rows: StatementImportRow[] = [];
  for (const entry of expenses) { if (!entry.row.minorUnits && entry.row.reviewReasons.includes("refund_adjusted")) excluded.push(issue(entry.row.sourceRow, "refunded", entry.row.raw)); else rows.push(entry.row); }
  if (!rows.length && !excluded.length) issues.push(issue(0, "no_rows", []));
  return completePreview(rows, excluded, issues, mapping, headers, tableIndex, headerRow, sourceRows.length, existingState, savedAdjustments);
}

/** Review reasons are informational after a user edits a row. Fields are
 * revalidated independently at commit; no earlier preview is trusted. */
export function validateStatementImportRow(row: StatementImportRow): boolean {
  return typeof row.id === "string" && row.id.trim().length > 0 && row.id.length <= 100 && typeof row.description === "string" && row.description.trim().length > 0 && row.description.trim().length <= 500 && currencyCode(row.currency) === row.currency && Number.isSafeInteger(row.minorUnits) && row.minorUnits > 0 && parseStatementDate(row.occurredOn, "ymd") === row.occurredOn && GENERAL_CATEGORIES.includes(row.category) && (row.sourceOccurrence === undefined || Number.isSafeInteger(row.sourceOccurrence) && row.sourceOccurrence >= 0 && row.sourceOccurrence < MAX_SOURCE_ROWS);
}

/** Call only after the user confirms the selected preview. Validation and
 * capacity checks complete before a new immutable state is returned. */
export function applyStatementImport(state: WalletState, rows: readonly StatementImportRow[], target: StatementImportTarget, adjustments: readonly StatementImportAdjustment[] = []): StatementImportResult {
  if (!parseWalletStateStrict(state)) throw new Error("invalid_state");
  if (rows.length > MAX_SOURCE_ROWS || rows.some((row) => !validateStatementImportRow(row))) throw new Error("invalid_rows");
  const known = existingIndex(state); const consumed = new Map<string, number>(); const accepted: StatementImportRow[] = []; let duplicates = 0;
  for (const row of rows) {
    const signature = semanticKey(row); const used = row.sourceOccurrence ?? consumed.get(signature) ?? 0; consumed.set(signature, used + 1);
    const signatures = row.id.startsWith("statement-t-") ? known.weakSignatures : known.signatures;
    if (known.ids.has(row.id) || used < (signatures.get(signature) ?? 0)) { duplicates += 1; continue; }
    known.ids.add(row.id); accepted.push(row);
  }
  if (adjustments.some((adjustment) => !adjustment.id.startsWith("statement-adjustment-") || !/^statement-adjustment-[0-9a-f]{16}$/u.test(adjustment.id) || !adjustment.targetLedgerId || !adjustment.targetExpenseId || !validateStatementImportRow({ id: adjustment.id, sourceRow: adjustment.sourceRow, description: adjustment.description, occurredOn: adjustment.occurredOn, currency: adjustment.currency, minorUnits: adjustment.minorUnits, category: "other", reviewReasons: [], raw: adjustment.raw, selected: true }))) throw new Error("invalid_adjustments");
  const ledgers: Ledger[] = [...state.ledgers]; let adjusted = 0; let removed = 0; const adjustmentIds = new Set<string>();
  for (const adjustment of adjustments.filter((item) => item.selected)) {
    if (adjustmentIds.has(adjustment.id)) continue; adjustmentIds.add(adjustment.id);
    const ledgerIndex = ledgers.findIndex((ledger) => ledger.id === adjustment.targetLedgerId); const ledger = ledgerIndex >= 0 ? ledgers[ledgerIndex] : null;
    if (!ledger || ledger.kind !== "general") throw new Error("adjustment_ledger");
    const history = ledger.statementImportHistory ?? []; if (history.some((receipt) => receipt.kind === "adjustment" && receipt.id === adjustment.id)) continue;
    const expenseIndex = ledger.expenses.findIndex((expense) => expense.id === adjustment.targetExpenseId); const expense = expenseIndex >= 0 ? ledger.expenses[expenseIndex] : null;
    if (!expense || expense.currency !== adjustment.currency || expense.minorUnits !== adjustment.expectedMinorUnits || expense.minorUnits < adjustment.minorUnits) throw new Error("adjustment_changed");
    const nextHistory = [...history, Object.freeze({ kind: "adjustment" as const, id: adjustment.id, expenseId: expense.id })];
    const remaining = adjustment.kind === "cancelled" ? 0 : expense.minorUnits - adjustment.minorUnits;
    const nextExpenses = remaining ? [...ledger.expenses.slice(0, expenseIndex), Object.freeze({ ...expense, minorUnits: remaining }), ...ledger.expenses.slice(expenseIndex + 1)] : [...ledger.expenses.slice(0, expenseIndex), ...ledger.expenses.slice(expenseIndex + 1)];
    ledgers[ledgerIndex] = { ...ledger, expenses: nextExpenses, statementImportHistory: nextHistory, updatedAt: new Date().toISOString() };
    if (remaining) adjusted += 1; else removed += 1;
  }
  if (!accepted.length && !adjusted && !removed) return Object.freeze({ state, added: 0, duplicates, adjusted: 0, removed: 0, ledgerIds: Object.freeze([]) });
  const ledgerIds: string[] = [];
  if (!accepted.length) {
    const result = parseWalletStateStrict({ ...state, ledgers });
    if (!result) throw new Error("invalid_import");
    return Object.freeze({ state: result, added: 0, duplicates, adjusted, removed, ledgerIds: Object.freeze([...new Set(adjustments.filter((adjustment) => adjustment.selected).map((adjustment) => adjustment.targetLedgerId))]) });
  }
  if (target.kind === "existing") {
    const index = ledgers.findIndex((ledger) => ledger.id === target.ledgerId); if (index < 0) throw new Error("missing_ledger");
    const ledger = ledgers[index];
    if (ledger.expenses.length + accepted.length > MAX_EXPENSES_PER_LEDGER) throw new Error("expense_limit");
    if (ledger.kind === "general") {
      if (accepted.some((row) => row.currency !== ledger.currency)) throw new Error("currency_mismatch");
      const imported = accepted.map(toGeneralExpense); ledgers[index] = { ...ledger, expenses: [...ledger.expenses, ...imported], statementImportHistory: [...(ledger.statementImportHistory ?? []), ...imported.map((expense) => Object.freeze({ kind: "payment" as const, id: expense.id, expenseId: expense.id }))], updatedAt: new Date().toISOString() };
    } else {
      const participantIds = target.participantIds ?? []; const allowed = new Set(ledger.participants.map((person) => person.id));
      if (!target.paidBy || !allowed.has(target.paidBy) || !participantIds.length || participantIds.some((id) => !allowed.has(id)) || new Set(participantIds).size !== participantIds.length) throw new Error("participants_required");
      const paidBy = target.paidBy; const currencies = [...new Set([...ledger.currencies, ...accepted.map((row) => row.currency)])];
      if (currencies.length > 20) throw new Error("currency_limit");
      const imported = accepted.map((row) => ({ ...toGeneralExpense(row), category: TRAVEL_CATEGORIES.includes(row.category as never) ? row.category as (typeof TRAVEL_CATEGORIES)[number] : "other" as const, paidBy, shares: splitEvenly(row.minorUnits, participantIds) })); ledgers[index] = { ...ledger, currencies, expenses: [...ledger.expenses, ...imported], statementImportHistory: [...(ledger.statementImportHistory ?? []), ...imported.map((expense) => Object.freeze({ kind: "payment" as const, id: expense.id, expenseId: expense.id }))], updatedAt: new Date().toISOString() };
    }
    ledgerIds.push(ledger.id);
  } else {
    if (!target.title.trim() || target.title.trim().length > 80) throw new Error("invalid_title");
    const currencies = [...new Set(accepted.map((row) => row.currency))];
    if (state.ledgers.length + currencies.length > MAX_LEDGERS) throw new Error("ledger_limit");
    for (const currency of currencies) {
      const currencyRows = accepted.filter((row) => row.currency === currency); if (currencyRows.length > MAX_EXPENSES_PER_LEDGER) throw new Error("expense_limit");
      const title = currencies.length > 1 ? `${target.title.trim().slice(0, 74)} · ${currency}` : target.title.trim();
      const ledger = createLedger("general", title, currency); const imported = currencyRows.map(toGeneralExpense); ledgers.push({ ...ledger, expenses: imported, statementImportHistory: imported.map((expense) => Object.freeze({ kind: "payment" as const, id: expense.id, expenseId: expense.id })) }); ledgerIds.push(ledger.id);
    }
  }
  // Totals must remain exactly representable by existing statistics code.
  for (const ledger of ledgers.filter((entry) => ledgerIds.includes(entry.id))) {
    const totals = new Map<string, bigint>();
    for (const expense of ledger.expenses) totals.set(expense.currency, (totals.get(expense.currency) ?? 0n) + BigInt(expense.minorUnits));
    if ([...totals.values()].some((total) => total > BigInt(Number.MAX_SAFE_INTEGER))) throw new Error("total_overflow");
  }
  const result = parseWalletStateStrict({ ...state, ledgers, activeLedgerId: ledgerIds[0] ?? state.activeLedgerId });
  if (!result) throw new Error("invalid_import");
  return Object.freeze({ state: result, added: accepted.length, duplicates, adjusted, removed, ledgerIds: Object.freeze(ledgerIds) });
}
function toGeneralExpense(row: StatementImportRow): GeneralExpense { return Object.freeze({ id: row.id, description: row.description.trim(), category: row.category, occurredOn: row.occurredOn, currency: row.currency, minorUnits: row.minorUnits }); }
