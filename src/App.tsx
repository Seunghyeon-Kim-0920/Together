import { Download, Languages, Plus, WalletCards, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GeneralLedgerView } from "./components/GeneralLedgerView";
import { LedgerTabs } from "./components/LedgerTabs";
import { LedgerMenuSheet, NewLedgerSheet } from "./components/Sheets";
import { TravelLedgerView } from "./components/TravelLedgerView";
import { applyHighConfidenceCardAutomation, buildNativeAutomationConfiguration, confirmCardCandidate, parseNativeCandidateBatch, type NativeCardCandidate } from "./lib/cardAutomation";
import { t } from "./lib/i18n";
import { cardAutomationPlugin, UNSUPPORTED_CARD_AUTOMATION_STATUS, type CardAutomationStatus } from "./lib/nativeCardAutomation";
import { parseLedgerSharePayload } from "./lib/share";
import { getWalletRepository } from "./lib/storage";
import { EMPTY_WALLET_STATE, SUPPORTED_LOCALES, type AutomationSource, type Ledger, type LedgerKind, type Locale, type WalletState } from "./lib/types";
import { createLedger, MAX_AUTOMATION_SOURCES, MAX_LEDGERS, mergeGeneralLedgerMutation, mergeGeneralLedgers, parseWalletStateStrict, replaceLedger } from "./lib/wallet";

type Toast = { readonly id: number; readonly message: string; readonly tone: "success" | "error" | "info" } | null;

export function App() {
  const [state, setState] = useState<WalletState>(EMPTY_WALLET_STATE);
  const [loaded, setLoaded] = useState(false);
  const [newLedgerOpen, setNewLedgerOpen] = useState(false);
  const [menuLedger, setMenuLedger] = useState<Ledger | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [automationStatus, setAutomationStatus] = useState<CardAutomationStatus>(UNSUPPORTED_CARD_AUTOMATION_STATUS);
  const [pendingAutomation, setPendingAutomation] = useState<readonly NativeCardCandidate[]>(Object.freeze([]));
  const [automationBusy, setAutomationBusy] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);
  const saveQueue = useRef(Promise.resolve());
  const configureQueue = useRef(Promise.resolve());
  const stateRef = useRef<WalletState>(EMPTY_WALLET_STATE);
  const refreshPromise = useRef<Promise<void> | null>(null);
  const locale = state.locale; const activeLedger = useMemo(() => state.ledgers.find((ledger) => ledger.id === state.activeLedgerId) ?? state.ledgers[0] ?? null, [state]);
  const notify = useCallback((message: string, tone: "success" | "error" | "info" = "info") => { const id = Date.now(); setToast({ id, message, tone }); window.setTimeout(() => setToast((current) => current?.id === id ? null : current), 3600); }, []);

  useEffect(() => { let cancelled = false; getWalletRepository().load().then((saved) => { if (cancelled) return; const next = saved.ledgers.length && !saved.activeLedgerId ? Object.freeze({ ...saved, activeLedgerId: saved.ledgers[0].id }) : saved; stateRef.current = next; setState(next); setLoaded(true); }).catch(() => { if (!cancelled) { setLoaded(true); notify(t("ko", "storageError"), "error"); } }); return () => { cancelled = true; }; }, [notify]);
  useEffect(() => { document.documentElement.lang = locale; document.title = "지갑의 일기"; document.querySelector('meta[name="description"]')?.setAttribute("content", t(locale, "appDescription")); }, [locale]);
  useEffect(() => { if (!loaded) return; void import("@capacitor/status-bar").then(({ StatusBar, Style }) => StatusBar.setStyle({ style: Style.Light }).catch(() => undefined)); }, [loaded]);

  const commit = useCallback((updater: WalletState | ((current: WalletState) => WalletState)): Promise<boolean> => {
    const operation = saveQueue.current.then(async () => {
      const current = stateRef.current;
      const candidate = typeof updater === "function" ? updater(current) : updater;
      const parsed = parseWalletStateStrict(candidate);
      if (!parsed) throw new Error("invalid wallet mutation");
      await getWalletRepository().save(parsed);
      stateRef.current = parsed;
      setState(parsed);
      return true;
    }).catch(() => {
      queueMicrotask(() => notify(t(stateRef.current.locale, "storageError"), "error"));
      return false;
    });
    saveQueue.current = operation.then(() => undefined);
    return operation;
  }, [notify]);

  const persistWalletMutation = useCallback(<T,>(mutate: (current: WalletState) => { readonly state: WalletState; readonly result: T }): Promise<T> => {
    const operation = saveQueue.current.then(async () => {
      const current = stateRef.current;
      const mutation = mutate(current);
      if (mutation.state !== current) {
        const parsed = parseWalletStateStrict(mutation.state);
        if (!parsed) throw new Error("invalid wallet mutation");
        // Do not expose the new state in memory or acknowledge the native event
        // until the durable repository write has succeeded.
        await getWalletRepository().save(parsed);
        stateRef.current = parsed;
        setState(parsed);
      }
      return mutation.result;
    });
    saveQueue.current = operation.then(() => undefined, () => undefined);
    return operation;
  }, []);

  const changeLocale = (next: Locale) => commit((current) => Object.freeze({ ...current, locale: next }));
  const selectLedger = (id: string) => { commit((current) => Object.freeze({ ...current, activeLedgerId: id })); void import("@capacitor/haptics").then(({ Haptics, ImpactStyle }) => Haptics.impact({ style: ImpactStyle.Light }).catch(() => undefined)); };
  const addLedger = (kind: LedgerKind, title: string, currency: string) => {
    if (state.ledgers.length >= MAX_LEDGERS || state.ledgers.some((ledger) => ledger.title.localeCompare(title.trim(), locale, { sensitivity: "accent" }) === 0)) return notify(t(locale, state.ledgers.length >= MAX_LEDGERS ? "storageError" : "duplicateName"), "error");
    const ledger: Ledger = kind === "travel" ? createLedger("travel", title, currency) : createLedger("general", title, currency);
    commit((current) => Object.freeze({ ...current, activeLedgerId: ledger.id, ledgers: Object.freeze([...current.ledgers, ledger]) })); setNewLedgerOpen(false); notify(t(locale, "ledgerCreated"), "success");
  };
  const updateLedger = useCallback((ledger: Ledger) => {
    const base = state.ledgers.find((candidate) => candidate.id === ledger.id);
    void commit((current) => {
      const latest = current.ledgers.find((candidate) => candidate.id === ledger.id);
      const merged = base?.kind === "general" && ledger.kind === "general" && latest?.kind === "general" ? mergeGeneralLedgerMutation(base, ledger, latest) : ledger;
      return replaceLedger(current, merged);
    });
  }, [commit, state.ledgers]);
  const renameLedger = (title: string) => {
    if (!menuLedger) return; const normalized = title.trim(); if (!normalized || state.ledgers.some((ledger) => ledger.id !== menuLedger.id && ledger.title.localeCompare(normalized, locale, { sensitivity: "accent" }) === 0)) return notify(t(locale, "duplicateName"), "error");
    updateLedger(Object.freeze({ ...menuLedger, title: normalized, updatedAt: new Date().toISOString() })); setMenuLedger(null); notify(t(locale, "ledgerRenamed"), "success");
  };
  const deleteLedger = () => {
    if (!menuLedger) return; commit((current) => { const ledgers = current.ledgers.filter((ledger) => ledger.id !== menuLedger.id); return Object.freeze({ ...current, ledgers: Object.freeze(ledgers), activeLedgerId: current.activeLedgerId === menuLedger.id ? ledgers[0]?.id ?? null : current.activeLedgerId }); }); setMenuLedger(null); notify(t(locale, "ledgerDeleted"), "success");
  };
  const importLedger = async (file: File) => {
    try {
      const ledger = parseLedgerSharePayload(await file.text()); if (!ledger) throw new Error("invalid");
      commit((current) => {
        const target = ledger.kind === "general" ? current.ledgers.find((candidate) => candidate.kind === "general" && candidate.title === ledger.title && candidate.currency === ledger.currency) : undefined;
        if (target?.kind === "general" && ledger.kind === "general") {
          const merged = mergeGeneralLedgers(target, ledger);
          return Object.freeze({ ...current, activeLedgerId: merged.id, ledgers: Object.freeze(current.ledgers.map((candidate) => candidate.id === merged.id ? merged : candidate)) });
        }
        if (current.ledgers.length >= MAX_LEDGERS) throw new Error("limit");
        return Object.freeze({ ...current, activeLedgerId: ledger.id, ledgers: Object.freeze([...current.ledgers, ledger]) });
      });
      notify(t(locale, "importedLedger"), "success");
    } catch { notify(t(locale, "invalidFile"), "error"); }
  };

  const refreshCardAutomation = useCallback((): Promise<void> => {
    if (!cardAutomationPlugin.isAvailable()) return Promise.resolve();
    if (refreshPromise.current) return refreshPromise.current;
    setAutomationBusy(true);
    const task = (async () => {
      try {
        const status = await cardAutomationPlugin.getStatus();
        setAutomationStatus(status);
        if (!status.supported) { setPendingAutomation(Object.freeze([])); return; }
        const batch = parseNativeCandidateBatch(await cardAutomationPlugin.peekPendingEvents());
        const result = await persistWalletMutation((current) => {
          const applied = applyHighConfidenceCardAutomation(current, batch.candidates);
          return Object.freeze({ state: applied.state, result: applied });
        });
        const idsToAcknowledge = [...new Set([...result.acknowledgedIds, ...batch.rejectedIds])];
        // Native events are removed only after the corresponding wallet state
        // has been saved successfully above.
        await cardAutomationPlugin.acknowledgeEvents({ ids: idsToAcknowledge });
        setPendingAutomation(result.pending);
        if (result.insertedIds.length) notify(t(stateRef.current.locale, "automationRecorded"), "success");
      } catch {
        notify(t(stateRef.current.locale, "automationError"), "error");
      } finally {
        setAutomationBusy(false);
      }
    })();
    refreshPromise.current = task;
    void task.then(() => { if (refreshPromise.current === task) refreshPromise.current = null; });
    return task;
  }, [notify, persistWalletMutation]);

  const confirmAutomationExpense = useCallback((ledgerId: string, candidate: NativeCardCandidate) => {
    setAutomationBusy(true);
    void persistWalletMutation((current) => {
      const confirmed = confirmCardCandidate(current, ledgerId, candidate);
      return Object.freeze({ state: confirmed.state, result: confirmed });
    }).then(async (confirmed) => {
      await cardAutomationPlugin.acknowledgeEvents({ ids: [candidate.id] });
      setPendingAutomation((current) => Object.freeze(current.filter((item) => item.id !== candidate.id || item.packageName !== candidate.packageName)));
      if (confirmed.inserted) notify(t(stateRef.current.locale, "expenseAdded"), "success");
    }).catch(() => notify(t(stateRef.current.locale, "automationError"), "error")).finally(() => setAutomationBusy(false));
  }, [notify, persistWalletMutation]);

  const dismissAutomationCandidate = useCallback((candidate: NativeCardCandidate) => {
    setAutomationBusy(true);
    void cardAutomationPlugin.acknowledgeEvents({ ids: [candidate.id] }).then(() => {
      setPendingAutomation((current) => Object.freeze(current.filter((item) => item.id !== candidate.id || item.packageName !== candidate.packageName)));
    }).catch(() => notify(t(stateRef.current.locale, "automationError"), "error")).finally(() => setAutomationBusy(false));
  }, [notify]);

  const registerAutomationSource = useCallback((ledgerId: string, source: AutomationSource) => {
    void commit((wallet) => {
      const owner = wallet.ledgers.find((ledger) => ledger.kind === "general" && ledger.automationSources.some((item) => item.packageName === source.packageName));
      if (owner && owner.id !== ledgerId) { queueMicrotask(() => notify(t(wallet.locale, "sourceAlreadyAssigned"), "error")); return wallet; }
      const target = wallet.ledgers.find((ledger) => ledger.id === ledgerId);
      if (!target || target.kind !== "general" || target.automationSources.length >= MAX_AUTOMATION_SOURCES || owner) return wallet;
      const updated = Object.freeze({ ...target, automationSources: Object.freeze([...target.automationSources, Object.freeze(source)]), updatedAt: new Date().toISOString() });
      return replaceLedger(wallet, updated);
    });
  }, [commit, notify]);

  const removeAutomationSource = useCallback((ledgerId: string, packageName: string) => {
    void commit((wallet) => {
      const target = wallet.ledgers.find((ledger) => ledger.id === ledgerId);
      if (!target || target.kind !== "general") return wallet;
      const updated = Object.freeze({ ...target, automationSources: Object.freeze(target.automationSources.filter((source) => source.packageName !== packageName)), updatedAt: new Date().toISOString() });
      return replaceLedger(wallet, updated);
    });
  }, [commit]);

  const openAutomationSettings = useCallback(() => {
    setAutomationBusy(true);
    void cardAutomationPlugin.openAccessSettings().catch(() => notify(t(stateRef.current.locale, "automationError"), "error")).finally(() => setAutomationBusy(false));
  }, [notify]);

  const requestAutomationAlertPermission = useCallback(() => {
    setAutomationBusy(true);
    void cardAutomationPlugin.requestAlertPermission().then(() => refreshCardAutomation()).catch(() => notify(t(stateRef.current.locale, "automationError"), "error")).finally(() => setAutomationBusy(false));
  }, [notify, refreshCardAutomation]);

  useEffect(() => {
    if (!loaded || !cardAutomationPlugin.isAvailable()) return;
    const configuration = buildNativeAutomationConfiguration(state, state.locale);
    configureQueue.current = configureQueue.current.then(() => cardAutomationPlugin.configure(configuration)).catch(() => notify(t(state.locale, "automationError"), "error"));
  }, [loaded, notify, state]);

  useEffect(() => {
    if (!loaded || !cardAutomationPlugin.isAvailable()) return;
    const refresh = () => { void refreshCardAutomation(); };
    const onVisibility = () => { if (document.visibilityState === "visible") refresh(); };
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisibility);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", onVisibility); };
  }, [loaded, refreshCardAutomation]);

  const pendingForActiveLedger = useMemo(() => {
    if (!activeLedger || activeLedger.kind !== "general") return Object.freeze([]) as readonly NativeCardCandidate[];
    return Object.freeze(pendingAutomation.filter((candidate) => {
      if (candidate.currency !== activeLedger.currency) return false;
      const owners = state.ledgers.filter((ledger) => ledger.kind === "general" && ledger.automationSources.some((source) => source.packageName === candidate.packageName));
      return owners.length === 0 || (owners.length === 1 && owners[0].id === activeLedger.id);
    }));
  }, [activeLedger, pendingAutomation, state.ledgers]);

  const activeGeneralLedgerId = activeLedger?.kind === "general" ? activeLedger.id : null;
  const registerSourceForActiveLedger = useCallback((source: AutomationSource) => { if (activeGeneralLedgerId) registerAutomationSource(activeGeneralLedgerId, source); }, [activeGeneralLedgerId, registerAutomationSource]);
  const removeSourceFromActiveLedger = useCallback((packageName: string) => { if (activeGeneralLedgerId) removeAutomationSource(activeGeneralLedgerId, packageName); }, [activeGeneralLedgerId, removeAutomationSource]);
  const confirmExpenseForActiveLedger = useCallback((candidate: NativeCardCandidate) => { if (activeGeneralLedgerId) confirmAutomationExpense(activeGeneralLedgerId, candidate); }, [activeGeneralLedgerId, confirmAutomationExpense]);

  if (!loaded) return <main className="mobile-app loading-screen"><WalletCards /><p>{t(locale, "loading")}</p></main>;
  return (
    <main className="mobile-app">
      <header className="app-header"><h1>지갑의 일기</h1><div className="header-tools"><label className="language-control"><Languages aria-hidden="true" /><span className="sr-only">{t(locale, "language")}</span><select value={locale} onChange={(event) => changeLocale(event.target.value as Locale)}>{SUPPORTED_LOCALES.map((code) => <option value={code} key={code}>{code === "ko" ? "한국어" : code === "en" ? "English" : "Français"}</option>)}</select></label><button className="icon-button" type="button" onClick={() => importInput.current?.click()} aria-label={t(locale, "importLedger")}><Download /></button><input ref={importInput} className="sr-only" type="file" accept=".walletdiary,application/json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importLedger(file); event.currentTarget.value = ""; }} /></div></header>
      <LedgerTabs ledgers={state.ledgers} activeId={activeLedger?.id ?? null} locale={locale} onSelect={selectLedger} onAdd={() => setNewLedgerOpen(true)} onMenu={setMenuLedger} />
      {activeLedger ? activeLedger.kind === "travel" ? <TravelLedgerView key={activeLedger.id} ledger={activeLedger} locale={locale} onChange={updateLedger} onNotify={notify} /> : <GeneralLedgerView key={activeLedger.id} ledger={activeLedger} locale={locale} automationStatus={automationStatus} pendingAutomation={pendingForActiveLedger} automationBusy={automationBusy} onAutomationRefresh={refreshCardAutomation} onOpenAutomationSettings={openAutomationSettings} onRequestAutomationAlertPermission={requestAutomationAlertPermission} onRegisterAutomationSource={registerSourceForActiveLedger} onRemoveAutomationSource={removeSourceFromActiveLedger} onConfirmAutomationExpense={confirmExpenseForActiveLedger} onDismissAutomationCandidate={dismissAutomationCandidate} onChange={updateLedger} onNotify={notify} /> : <section className="empty-app"><WalletCards /><h2>{t(locale, "noLedgers")}</h2><button className="primary-button" type="button" onClick={() => setNewLedgerOpen(true)}><Plus />{t(locale, "newLedger")}</button><p>{t(locale, "storageHelp")}</p></section>}
      {newLedgerOpen ? <NewLedgerSheet locale={locale} onClose={() => setNewLedgerOpen(false)} onCreate={addLedger} /> : null}
      {menuLedger ? <LedgerMenuSheet ledger={menuLedger} locale={locale} onClose={() => setMenuLedger(null)} onRename={renameLedger} onDelete={deleteLedger} /> : null}
      {toast ? <div className={`toast ${toast.tone}`} role="status"><span>{toast.message}</span><button type="button" onClick={() => setToast(null)} aria-label={t(locale, "close")}><X /></button></div> : null}
    </main>
  );
}
