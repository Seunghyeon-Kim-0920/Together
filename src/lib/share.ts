import { Capacitor } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { formatMoney } from "./currency";
import { publicExpenseId } from "./expenseIdentity";
import { t, travelCategoryLabel } from "./i18n";
import { merchantDisplayName } from "./merchant";
import type { Ledger, Locale, TravelLedger } from "./types";
import { newestExpensesFirst, parseLedger, settleTravelExpenses } from "./wallet";

const SHARE_VERSION = 1;
const MAX_IMPORT_BYTES = 2_000_000;

export function createLedgerSharePayload(ledger: Ledger): string {
  // Travel shares omit local identity. General shares omit the local budget
  // and notification-source allowlist because both are private settings.
  const shareSafe = ledger.kind === "travel" ? { ...ledger, selfParticipantId: null } : omitGeneralPrivacySettings(ledger);
  return JSON.stringify({ format: "wallet-diary", version: SHARE_VERSION, ledger: shareSafe });
}

function omitGeneralPrivacySettings(ledger: Extract<Ledger, { kind: "general" }>) {
  // Do not expose provider-derived or card-auto id prefixes. A deterministic
  // opaque id keeps repeated imports idempotent without revealing provenance.
  const expenses = ledger.expenses.map((expense) => ({ id: publicExpenseId(ledger.id, expense.id), description: merchantDisplayName(expense.description, expense.id), category: expense.category, currency: expense.currency, minorUnits: expense.minorUnits, occurredOn: expense.occurredOn }));
  return { id: ledger.id, title: ledger.title, kind: ledger.kind, createdAt: ledger.createdAt, updatedAt: ledger.updatedAt, currency: ledger.currency, expenses };
}

export function createTravelSharePayload(ledger: TravelLedger): string {
  return createLedgerSharePayload(ledger);
}

function withoutImportedPrivacy(parsed: Ledger): Ledger {
  if (parsed.kind === "travel") return Object.freeze({ ...parsed, selfParticipantId: null });
  const shareSafe = omitGeneralPrivacySettings(parsed);
  return Object.freeze({ ...shareSafe, monthlyLimitMinor: null, automationAllApps: false, automationSources: Object.freeze([]), automationReversalIds: Object.freeze([]), movedExpenseIds: Object.freeze([]), expenses: Object.freeze(shareSafe.expenses.map((expense) => Object.freeze(expense))) });
}

function cloneImportedLedger(parsed: Ledger): Ledger {
  const now = new Date().toISOString();
  // Treat imported JSON as untrusted even when it passes the ledger schema.
  // Automation consent, trusted packages, reversal tombstones, and private
  // expense fingerprints are local-only state and must never cross this edge.
  return Object.freeze({ ...withoutImportedPrivacy(parsed), id: crypto.randomUUID(), createdAt: now, updatedAt: now });
}

export interface LedgerShareDocument {
  readonly format: "wallet-diary";
  readonly version: 1;
  readonly sourceLedgerId: string;
  readonly ledger: Ledger;
}

/** Parse an untrusted share without losing source/record identity for a merge. */
export function parseLedgerShareDocument(raw: string): LedgerShareDocument | null {
  if (new TextEncoder().encode(raw).byteLength > MAX_IMPORT_BYTES) return null;
  try {
    const value = JSON.parse(raw) as { format?: unknown; version?: unknown; ledger?: unknown };
    if (value.format !== "wallet-diary" || value.version !== SHARE_VERSION) return null;
    const parsed = parseLedger(value.ledger);
    return parsed ? Object.freeze({ format: "wallet-diary", version: SHARE_VERSION, sourceLedgerId: parsed.id, ledger: withoutImportedPrivacy(parsed) }) : null;
  } catch { return null; }
}

/** Parse either a travel or general `.walletdiary` file as a new local tab. */
export function parseLedgerSharePayload(raw: string): Ledger | null {
  const document = parseLedgerShareDocument(raw);
  return document ? cloneImportedLedger(document.ledger) : null;
}

export function parseTravelSharePayload(raw: string): TravelLedger | null {
  const parsed = parseLedgerSharePayload(raw);
  return parsed?.kind === "travel" ? parsed : null;
}

export function createTravelShareText(ledger: TravelLedger, locale: Locale): string {
  const participantNames = new Map(ledger.participants.map((person) => [person.id, person.name]));
  const totals = ledger.currencies.map((currency) => `${formatMoney(ledger.expenses.filter((expense) => expense.currency === currency).reduce((sum, expense) => sum + expense.minorUnits, 0), currency, locale)}`);
  const recent = newestExpensesFirst(ledger.expenses).slice(0, 10).map((expense) => `${expense.occurredOn} · ${expense.description} · ${travelCategoryLabel(locale, expense.category)} · ${participantNames.get(expense.paidBy) ?? "-"} · ${formatMoney(expense.minorUnits, expense.currency, locale)}`);
  const transfers = settleTravelExpenses(ledger).flatMap((settlement) => settlement.transfers.map((transfer) => `${participantNames.get(transfer.from) ?? "-"} → ${participantNames.get(transfer.to) ?? "-"} · ${formatMoney(transfer.minorUnits, transfer.currency, locale)}`));
  return [ledger.title, "", `${t(locale, "totalSpent")}: ${totals.join(" · ")}`, "", t(locale, "recentExpenses"), ...(recent.length ? recent : [t(locale, "noExpenses")]), "", t(locale, "settlement"), ...(transfers.length ? transfers : [t(locale, "settlementEmpty")])].join("\n");
}

export async function shareTravelLedger(ledger: TravelLedger, text = ledger.title, previewJpegs: readonly string[] = []): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const files: string[] = [];
    for (let index = 0; index < previewJpegs.length; index += 1) {
      const written = await Filesystem.writeFile({ path: `${safeFilename(ledger.title)}-${index + 1}.jpg`, data: previewJpegs[index], directory: Directory.Cache, recursive: true });
      files.push(written.uri);
    }
    await Share.share({ title: ledger.title, text, ...(files.length ? { files } : {}), dialogTitle: ledger.title });
    return;
  }
  if (navigator.share) { await navigator.share({ title: ledger.title, text }); return; }
  const file = new File([text], `${safeFilename(ledger.title)}.txt`, { type: "text/plain;charset=utf-8" }); const url = URL.createObjectURL(file); const anchor = document.createElement("a"); anchor.href = url; anchor.download = file.name; anchor.click(); URL.revokeObjectURL(url);
}

/** Share the complete machine-readable ledger, including exact payer/splits. */
export async function shareTravelLedgerFile(ledger: TravelLedger): Promise<void> {
  const parsed = parseLedger(ledger);
  if (!parsed || parsed.kind !== "travel") throw new Error("invalid travel ledger");
  const payload = createTravelSharePayload(parsed);
  if (new TextEncoder().encode(payload).byteLength > MAX_IMPORT_BYTES) throw new Error("share file too large");
  const filename = `${safeFilename(parsed.title)}.walletdiary`;
  if (Capacitor.isNativePlatform()) {
    const written = await Filesystem.writeFile({ path: `wallet-shares/${crypto.randomUUID()}/${filename}`, data: payload, encoding: Encoding.UTF8, directory: Directory.Cache, recursive: true });
    await Share.share({ title: parsed.title, files: [written.uri], dialogTitle: parsed.title });
    return;
  }
  const file = new File([payload], filename, { type: "application/octet-stream" });
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ title: parsed.title, files: [file] });
    return;
  }
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove();
  // Revoking synchronously can cancel a download in some WebViews/browsers.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function safeFilename(value: string): string { return value.normalize("NFKC").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 60) || "wallet-diary"; }
