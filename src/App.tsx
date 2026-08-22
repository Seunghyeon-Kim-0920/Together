import { Download, Languages, Plus, WalletCards, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GeneralLedgerView } from "./components/GeneralLedgerView";
import { LedgerTabs } from "./components/LedgerTabs";
import { LedgerMenuSheet, NewLedgerSheet } from "./components/Sheets";
import { TravelLedgerView } from "./components/TravelLedgerView";
import { t } from "./lib/i18n";
import { parseTravelSharePayload } from "./lib/share";
import { getWalletRepository } from "./lib/storage";
import { EMPTY_WALLET_STATE, SUPPORTED_LOCALES, type Ledger, type LedgerKind, type Locale, type WalletState } from "./lib/types";
import { createLedger, MAX_LEDGERS, parseWalletStateStrict, replaceLedger } from "./lib/wallet";

type Toast = { readonly id: number; readonly message: string; readonly tone: "success" | "error" | "info" } | null;

export function App() {
  const [state, setState] = useState<WalletState>(EMPTY_WALLET_STATE); const [loaded, setLoaded] = useState(false); const [newLedgerOpen, setNewLedgerOpen] = useState(false); const [menuLedger, setMenuLedger] = useState<Ledger | null>(null); const [toast, setToast] = useState<Toast>(null); const importInput = useRef<HTMLInputElement>(null); const saveQueue = useRef(Promise.resolve());
  const locale = state.locale; const activeLedger = useMemo(() => state.ledgers.find((ledger) => ledger.id === state.activeLedgerId) ?? state.ledgers[0] ?? null, [state]);
  const notify = useCallback((message: string, tone: "success" | "error" | "info" = "info") => { const id = Date.now(); setToast({ id, message, tone }); window.setTimeout(() => setToast((current) => current?.id === id ? null : current), 3600); }, []);

  useEffect(() => { let cancelled = false; getWalletRepository().load().then((saved) => { if (cancelled) return; const next = saved.ledgers.length && !saved.activeLedgerId ? Object.freeze({ ...saved, activeLedgerId: saved.ledgers[0].id }) : saved; setState(next); setLoaded(true); }).catch(() => { if (!cancelled) { setLoaded(true); notify(t("ko", "storageError"), "error"); } }); return () => { cancelled = true; }; }, [notify]);
  useEffect(() => { document.documentElement.lang = locale; document.title = "지갑의 일기"; document.querySelector('meta[name="description"]')?.setAttribute("content", t(locale, "appDescription")); }, [locale]);
  useEffect(() => { if (!loaded) return; void import("@capacitor/status-bar").then(({ StatusBar, Style }) => StatusBar.setStyle({ style: Style.Light }).catch(() => undefined)); }, [loaded]);

  const commit = useCallback((updater: WalletState | ((current: WalletState) => WalletState)) => {
    setState((current) => {
      const candidate = typeof updater === "function" ? updater(current) : updater; const parsed = parseWalletStateStrict(candidate);
      if (!parsed) { queueMicrotask(() => notify(t(current.locale, "storageError"), "error")); return current; }
      saveQueue.current = saveQueue.current.then(() => getWalletRepository().save(parsed)).catch(() => { queueMicrotask(() => notify(t(parsed.locale, "storageError"), "error")); });
      return parsed;
    });
  }, [notify]);

  const changeLocale = (next: Locale) => commit((current) => Object.freeze({ ...current, locale: next }));
  const selectLedger = (id: string) => { commit((current) => Object.freeze({ ...current, activeLedgerId: id })); void import("@capacitor/haptics").then(({ Haptics, ImpactStyle }) => Haptics.impact({ style: ImpactStyle.Light }).catch(() => undefined)); };
  const addLedger = (kind: LedgerKind, title: string, currency: string) => {
    if (state.ledgers.length >= MAX_LEDGERS || state.ledgers.some((ledger) => ledger.title.localeCompare(title.trim(), locale, { sensitivity: "accent" }) === 0)) return notify(t(locale, state.ledgers.length >= MAX_LEDGERS ? "storageError" : "duplicateName"), "error");
    const ledger: Ledger = kind === "travel" ? createLedger("travel", title, currency) : createLedger("general", title, currency);
    commit((current) => Object.freeze({ ...current, activeLedgerId: ledger.id, ledgers: Object.freeze([...current.ledgers, ledger]) })); setNewLedgerOpen(false); notify(t(locale, "ledgerCreated"), "success");
  };
  const updateLedger = (ledger: Ledger) => commit((current) => replaceLedger(current, ledger));
  const renameLedger = (title: string) => {
    if (!menuLedger) return; const normalized = title.trim(); if (!normalized || state.ledgers.some((ledger) => ledger.id !== menuLedger.id && ledger.title.localeCompare(normalized, locale, { sensitivity: "accent" }) === 0)) return notify(t(locale, "duplicateName"), "error");
    updateLedger(Object.freeze({ ...menuLedger, title: normalized, updatedAt: new Date().toISOString() })); setMenuLedger(null); notify(t(locale, "ledgerRenamed"), "success");
  };
  const deleteLedger = () => {
    if (!menuLedger) return; commit((current) => { const ledgers = current.ledgers.filter((ledger) => ledger.id !== menuLedger.id); return Object.freeze({ ...current, ledgers: Object.freeze(ledgers), activeLedgerId: current.activeLedgerId === menuLedger.id ? ledgers[0]?.id ?? null : current.activeLedgerId }); }); setMenuLedger(null); notify(t(locale, "ledgerDeleted"), "success");
  };
  const importLedger = async (file: File) => {
    try { const ledger = parseTravelSharePayload(await file.text()); if (!ledger || state.ledgers.length >= MAX_LEDGERS) throw new Error("invalid"); commit((current) => Object.freeze({ ...current, activeLedgerId: ledger.id, ledgers: Object.freeze([...current.ledgers, ledger]) })); notify(t(locale, "importedLedger"), "success"); } catch { notify(t(locale, "invalidFile"), "error"); }
  };

  if (!loaded) return <main className="mobile-app loading-screen"><WalletCards /><p>{t(locale, "loading")}</p></main>;
  return (
    <main className="mobile-app">
      <header className="app-header"><h1>지갑의 일기</h1><div className="header-tools"><label className="language-control"><Languages aria-hidden="true" /><span className="sr-only">{t(locale, "language")}</span><select value={locale} onChange={(event) => changeLocale(event.target.value as Locale)}>{SUPPORTED_LOCALES.map((code) => <option value={code} key={code}>{code === "ko" ? "한국어" : code === "en" ? "English" : "Français"}</option>)}</select></label><button className="icon-button" type="button" onClick={() => importInput.current?.click()} aria-label={t(locale, "importLedger")}><Download /></button><input ref={importInput} className="sr-only" type="file" accept=".walletdiary,application/json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importLedger(file); event.currentTarget.value = ""; }} /></div></header>
      <LedgerTabs ledgers={state.ledgers} activeId={activeLedger?.id ?? null} locale={locale} onSelect={selectLedger} onAdd={() => setNewLedgerOpen(true)} onMenu={setMenuLedger} />
      {activeLedger ? activeLedger.kind === "travel" ? <TravelLedgerView ledger={activeLedger} locale={locale} onChange={updateLedger} onNotify={notify} /> : <GeneralLedgerView ledger={activeLedger} locale={locale} onChange={updateLedger} onNotify={notify} /> : <section className="empty-app"><WalletCards /><h2>{t(locale, "noLedgers")}</h2><button className="primary-button" type="button" onClick={() => setNewLedgerOpen(true)}><Plus />{t(locale, "newLedger")}</button><p>{t(locale, "storageHelp")}</p></section>}
      {newLedgerOpen ? <NewLedgerSheet locale={locale} onClose={() => setNewLedgerOpen(false)} onCreate={addLedger} /> : null}
      {menuLedger ? <LedgerMenuSheet ledger={menuLedger} locale={locale} onClose={() => setMenuLedger(null)} onRename={renameLedger} onDelete={deleteLedger} /> : null}
      {toast ? <div className={`toast ${toast.tone}`} role="status"><span>{toast.message}</span><button type="button" onClick={() => setToast(null)} aria-label={t(locale, "close")}><X /></button></div> : null}
    </main>
  );
}
