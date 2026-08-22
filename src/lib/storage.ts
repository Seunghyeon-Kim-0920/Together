import { Capacitor } from "@capacitor/core";
import type { WalletState } from "./types";
import { EMPTY_WALLET_STATE } from "./types";
import { parseWalletStateStrict } from "./wallet";

const WEB_KEY = "wallet-diary-state-v2";
const DATABASE_NAME = "wallet_diary";

export interface WalletRepository {
  load(): Promise<WalletState>;
  save(state: WalletState): Promise<void>;
}

class WebWalletRepository implements WalletRepository {
  async load(): Promise<WalletState> {
    try { const raw = window.localStorage.getItem(WEB_KEY); return raw ? parseWalletStateStrict(JSON.parse(raw)) ?? EMPTY_WALLET_STATE : EMPTY_WALLET_STATE; } catch { return EMPTY_WALLET_STATE; }
  }
  async save(state: WalletState): Promise<void> {
    const parsed = parseWalletStateStrict(state); if (!parsed) throw new Error("invalid state");
    window.localStorage.setItem(WEB_KEY, JSON.stringify(parsed));
  }
}

class NativeWalletRepository implements WalletRepository {
  private connectionPromise: Promise<import("@capacitor-community/sqlite").SQLiteDBConnection> | null = null;

  private connection() {
    this.connectionPromise ??= (async () => {
      const { CapacitorSQLite, SQLiteConnection } = await import("@capacitor-community/sqlite");
      const sqlite = new SQLiteConnection(CapacitorSQLite);
      const existing = await sqlite.isConnection(DATABASE_NAME, false);
      const database = existing.result
        ? await sqlite.retrieveConnection(DATABASE_NAME, false)
        : await sqlite.createConnection(DATABASE_NAME, false, "no-encryption", 1, false);
      const opened = await database.isDBOpen();
      if (!opened.result) await database.open();
      await database.execute("CREATE TABLE IF NOT EXISTS wallet_snapshots (slot INTEGER PRIMARY KEY NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL);", true);
      return database;
    })();
    return this.connectionPromise;
  }

  async load(): Promise<WalletState> {
    const database = await this.connection();
    for (const slot of [1, 2]) {
      const result = await database.query("SELECT payload FROM wallet_snapshots WHERE slot = ? LIMIT 1", [slot]);
      const payload = result.values?.[0]?.payload;
      if (typeof payload !== "string") continue;
      try { const parsed = parseWalletStateStrict(JSON.parse(payload)); if (parsed) return parsed; } catch { /* try backup */ }
    }
    return EMPTY_WALLET_STATE;
  }

  async save(state: WalletState): Promise<void> {
    const parsed = parseWalletStateStrict(state); if (!parsed) throw new Error("invalid state");
    const database = await this.connection(); const payload = JSON.stringify(parsed); const now = new Date().toISOString();
    const current = await database.query("SELECT payload, updated_at FROM wallet_snapshots WHERE slot = 1 LIMIT 1");
    const priorPayload = current.values?.[0]?.payload; const priorUpdatedAt = current.values?.[0]?.updated_at;
    const statements = [] as Array<{ statement: string; values: unknown[] }>;
    if (typeof priorPayload === "string") statements.push({ statement: "INSERT OR REPLACE INTO wallet_snapshots (slot, payload, updated_at) VALUES (2, ?, ?)", values: [priorPayload, typeof priorUpdatedAt === "string" ? priorUpdatedAt : now] });
    statements.push({ statement: "INSERT OR REPLACE INTO wallet_snapshots (slot, payload, updated_at) VALUES (1, ?, ?)", values: [payload, now] });
    await database.executeSet(statements, true);
  }
}

let repository: WalletRepository | null = null;
export function getWalletRepository(): WalletRepository {
  repository ??= Capacitor.isNativePlatform() ? new NativeWalletRepository() : new WebWalletRepository();
  return repository;
}
