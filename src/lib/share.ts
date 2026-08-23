import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { formatMoney } from "./currency";
import { t, travelCategoryLabel } from "./i18n";
import type { Ledger, Locale, TravelLedger } from "./types";
import { newestExpensesFirst, parseLedger, settleTravelExpenses } from "./wallet";

const SHARE_VERSION = 1;
const MAX_IMPORT_BYTES = 2_000_000;

export function createLedgerSharePayload(ledger: Ledger): string {
  // A general ledger has no participant identity to redact. Travel ledgers
  // still omit the local "self" selection when they are shared.
  const shareSafe = ledger.kind === "travel" ? { ...ledger, selfParticipantId: null } : ledger;
  return JSON.stringify({ format: "wallet-diary", version: SHARE_VERSION, ledger: shareSafe });
}

export function createTravelSharePayload(ledger: TravelLedger): string {
  return createLedgerSharePayload(ledger);
}

function cloneImportedLedger(parsed: Ledger): Ledger {
  const importedBase = { ...parsed, id: crypto.randomUUID(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  return parsed.kind === "travel" ? Object.freeze({ ...importedBase, selfParticipantId: null }) : Object.freeze(importedBase);
}

/** Parse either a travel or general `.walletdiary` share file. */
export function parseLedgerSharePayload(raw: string): Ledger | null {
  if (new TextEncoder().encode(raw).byteLength > MAX_IMPORT_BYTES) return null;
  try {
    const value = JSON.parse(raw) as { format?: unknown; version?: unknown; ledger?: unknown };
    if (value.format !== "wallet-diary" || value.version !== SHARE_VERSION) return null;
    const parsed = parseLedger(value.ledger);
    return parsed ? cloneImportedLedger(parsed) : null;
  } catch { return null; }
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

export function safeFilename(value: string): string { return value.normalize("NFKC").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 60) || "wallet-diary"; }
