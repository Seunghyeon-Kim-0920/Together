import { Capacitor } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import type { TravelLedger } from "./types";
import { parseLedger } from "./wallet";

const SHARE_VERSION = 1;
const MAX_IMPORT_BYTES = 2_000_000;

export function createTravelSharePayload(ledger: TravelLedger): string {
  const { selfParticipantId: _privateSelf, ...shareSafe } = ledger;
  return JSON.stringify({ format: "wallet-diary", version: SHARE_VERSION, ledger: { ...shareSafe, selfParticipantId: null } });
}

export function parseTravelSharePayload(raw: string): TravelLedger | null {
  if (new TextEncoder().encode(raw).byteLength > MAX_IMPORT_BYTES) return null;
  try {
    const value = JSON.parse(raw) as { format?: unknown; version?: unknown; ledger?: unknown };
    if (value.format !== "wallet-diary" || value.version !== SHARE_VERSION) return null;
    const parsed = parseLedger(value.ledger);
    return parsed?.kind === "travel" ? Object.freeze({ ...parsed, id: crypto.randomUUID(), title: `${parsed.title}`, selfParticipantId: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }) : null;
  } catch { return null; }
}

export async function shareTravelLedger(ledger: TravelLedger): Promise<void> {
  const payload = createTravelSharePayload(ledger); const filename = `${safeFilename(ledger.title)}.walletdiary`;
  if (Capacitor.isNativePlatform()) {
    const written = await Filesystem.writeFile({ path: filename, data: payload, directory: Directory.Cache, encoding: Encoding.UTF8, recursive: true });
    await Share.share({ title: ledger.title, text: ledger.title, url: written.uri, dialogTitle: ledger.title });
    return;
  }
  const file = new File([payload], filename, { type: "application/json" });
  if (navigator.canShare?.({ files: [file] })) { await navigator.share({ title: ledger.title, files: [file] }); return; }
  const url = URL.createObjectURL(file); const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url);
}

export function safeFilename(value: string): string { return value.normalize("NFKC").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 60) || "wallet-diary"; }
