import { Download, Languages, Plus, WalletCards, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GeneralLedgerView } from "./components/GeneralLedgerView";
import { LedgerTabs } from "./components/LedgerTabs";
import { LedgerMenuSheet, NewLedgerSheet } from "./components/Sheets";
import { TravelLedgerView } from "./components/TravelLedgerView";
import { MoveExpenseSheet, type MoveSelection } from "./components/MoveExpenseSheet";
import { TravelImportSheet, type TravelImportSelection } from "./components/TravelImportSheet";
import { applyHighConfidenceCardAutomation, buildNativeAutomationConfiguration, candidateAcknowledgement, confirmCardCandidate, parseNativeCandidateBatch, visibleCardCandidates, type NativeCardCandidate, type NativeEventAcknowledgement } from "./lib/cardAutomation";
import { t } from "./lib/i18n";
import { cardAutomationPlugin, UNSUPPORTED_CARD_AUTOMATION_STATUS, type CardAutomationStatus } from "./lib/nativeCardAutomation";
import { parseLedgerShareDocument, parseLedgerSharePayload } from "./lib/share";
import { exchangeText as x } from "./lib/exchangeI18n";
import { moveGeneralExpenseToTravel } from "./lib/moveExpense";
import { previewTravelLedgerMerge } from "./lib/travelExchange";
import { getWalletRepository } from "./lib/storage";
import { EMPTY_WALLET_STATE, SUPPORTED_LOCALES, type AutomationSource, type GeneralExpense, type Ledger, type LedgerKind, type Locale, type TravelLedger, type WalletState } from "./lib/types";
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
  const [moveRequest, setMoveRequest] = useState<{ readonly sourceLedgerId: string; readonly expense: GeneralExpense } | null>(null);
  const [travelImport, setTravelImport] = useState<TravelLedger | null>(null);
  const [exchangeBusy, setExchangeBusy] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);
  const saveQueue = useRef(Promise.resolve());
  const configureQueue = useRef(Promise.resolve());
  const stateRef = useRef<WalletState>(EMPTY_WALLET_STATE);
  const refreshPromise = useRef<Promise<void> | null>(null);
  const locale = state.locale; const activeLedger = useMemo(() => state.ledgers.find((ledger) => ledger.id === state.activeLedgerId) ?? state.ledgers[0] ?? null, [state]);
  const travelLedgers = useMemo(() => state.ledgers.filter((ledger): ledger is TravelLedger => ledger.kind === "travel"), [state.ledgers]);
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

  const commitWithNativeScopeReduction = useCallback((updater: WalletState | ((current: WalletState) => WalletState)): Promise<boolean> => {
    let stage: "native" | "storage" = "native";
    const operation = saveQueue.current.then(async () => {
      const current = stateRef.current;
      const candidate = typeof updater === "function" ? updater(current) : updater;
      const parsed = parseWalletStateStrict(candidate);
      if (!parsed) throw new Error("invalid wallet mutation");
      if (parsed === current) return true;
      if (cardAutomationPlugin.isAvailable()) {
        const configuration = buildNativeAutomationConfiguration(parsed, parsed.locale);
        const preconfigure = configureQueue.current.then(() => cardAutomationPlugin.configure(configuration));
        configureQueue.current = preconfigure.then(() => undefined, () => undefined);
        await preconfigure;
      }
      stage = "storage";
      await getWalletRepository().save(parsed);
      stateRef.current = parsed;
      setState(parsed);
      return true;
    }).catch(() => {
      queueMicrotask(() => notify(t(stateRef.current.locale, stage === "native" ? "automationError" : "storageError"), "error"));
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
    if (!menuLedger) return; void commitWithNativeScopeReduction((current) => { const ledgers = current.ledgers.filter((ledger) => ledger.id !== menuLedger.id); return Object.freeze({ ...current, ledgers: Object.freeze(ledgers), activeLedgerId: current.activeLedgerId === menuLedger.id ? ledgers[0]?.id ?? null : current.activeLedgerId }); }); setMenuLedger(null); notify(t(locale, "ledgerDeleted"), "success");
  };
  const importLedger = async (file: File) => {
    try {
      if (file.size > 2_000_000) throw new Error("invalid");
      const raw = await file.text();
      const document = parseLedgerShareDocument(raw);
      if (!document) throw new Error("invalid");
      if (document.ledger.kind === "travel") { setTravelImport(document.ledger); return; }
      const ledger = parseLedgerSharePayload(raw); if (!ledger) throw new Error("invalid");
      const saved = await commit((current) => {
        const target = ledger.kind === "general" ? current.ledgers.find((candidate) => candidate.kind === "general" && candidate.title === ledger.title && candidate.currency === ledger.currency) : undefined;
        if (target?.kind === "general" && ledger.kind === "general") {
          const merged = mergeGeneralLedgers(target, ledger, document.sourceLedgerId);
          return Object.freeze({ ...current, activeLedgerId: merged.id, ledgers: Object.freeze(current.ledgers.map((candidate) => candidate.id === merged.id ? merged : candidate)) });
        }
        if (current.ledgers.length >= MAX_LEDGERS) throw new Error("limit");
        return Object.freeze({ ...current, activeLedgerId: ledger.id, ledgers: Object.freeze([...current.ledgers, ledger]) });
      });
      if (saved) notify(t(locale, "importedLedger"), "success");
    } catch { notify(t(locale, "invalidFile"), "error"); }
  };

  const moveExpense = async (selection: MoveSelection) => {
    if (!moveRequest || exchangeBusy) return;
    setExchangeBusy(true);
    try {
      await persistWalletMutation((current) => {
        const source = current.ledgers.find((ledger) => ledger.id === moveRequest.sourceLedgerId);
        const latest = source?.kind === "general" ? source.expenses.find((expense) => expense.id === moveRequest.expense.id) : null;
        if (!latest || JSON.stringify(latest) !== JSON.stringify(moveRequest.expense)) throw new Error("changed");
        const moved = moveGeneralExpenseToTravel(current, { sourceLedgerId: moveRequest.sourceLedgerId, expenseId: latest.id, ...selection });
        return { state: Object.freeze({ ...moved, activeLedgerId: selection.targetLedgerId }), result: true };
      });
      setMoveRequest(null); notify(x(locale, "moved"), "success");
    } catch { notify(x(locale, "moveFailed"), "error"); }
    finally { setExchangeBusy(false); }
  };

  const confirmTravelImport = async (selection: TravelImportSelection) => {
    if (!travelImport || exchangeBusy) return;
    setExchangeBusy(true);
    try {
      await persistWalletMutation((current) => {
        const latest = selection.targetId ? current.ledgers.find((ledger) => ledger.id === selection.targetId) : selection.base;
        if (latest?.kind !== "travel" || JSON.stringify(latest) !== JSON.stringify(selection.base)) throw new Error("changed");
        if (!selection.targetId && current.ledgers.length >= MAX_LEDGERS) throw new Error("capacity");
        const preview = previewTravelLedgerMerge(latest, travelImport, selection.mapping);
        if (!preview.ok || !preview.ledger) throw new Error("invalid");
        const ledger = preview.ledger;
        const ledgers = selection.targetId ? current.ledgers.map((item) => item.id === ledger.id ? ledger : item) : [...current.ledgers, ledger];
        return { state: Object.freeze({ ...current, activeLedgerId: ledger.id, ledgers: Object.freeze(ledgers) }), result: true };
      });
      setTravelImport(null); notify(x(locale, "importSaved"), "success");
    } catch (error) { notify(x(locale, error instanceof Error && error.message === "changed" ? "changed" : "importFailed"), "error"); }
    finally { setExchangeBusy(false); }
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
        const acknowledgedIds = new Set(result.acknowledgedIds);
        const acknowledgements = new Map<string, NativeEventAcknowledgement>();
        for (const candidate of batch.candidates) if (acknowledgedIds.has(candidate.id)) {
          const acknowledgement = candidateAcknowledgement(candidate);
          acknowledgements.set(`${acknowledgement.id}\u0000${acknowledgement.queueToken ?? ""}`, acknowledgement);
        }
        for (const acknowledgement of batch.rejectedAcknowledgements) acknowledgements.set(`${acknowledgement.id}\u0000${acknowledgement.queueToken ?? ""}`, acknowledgement);
        // Native events are removed only after the corresponding wallet state
        // has been saved successfully above.
        await cardAutomationPlugin.acknowledgeEvents({ events: [...acknowledgements.values()] });
        setPendingAutomation(result.pending);
        if (result.insertedIds.length) notify(t(stateRef.current.locale, "automationRecorded"), "success");
        if (result.reversedIds.length) notify(t(stateRef.current.locale, "automationCancellationApplied"), "success");
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
      await cardAutomationPlugin.acknowledgeEvents({ events: [candidateAcknowledgement(candidate)] });
      setPendingAutomation((current) => Object.freeze(current.filter((item) => item.id !== candidate.id || item.packageName !== candidate.packageName)));
      if (confirmed.inserted) notify(t(stateRef.current.locale, "expenseAdded"), "success");
      if (confirmed.reversed) notify(t(stateRef.current.locale, "automationCancellationApplied"), "success");
    }).catch(() => notify(t(stateRef.current.locale, "automationError"), "error")).finally(() => setAutomationBusy(false));
  }, [notify, persistWalletMutation]);

  const dismissAutomationCandidate = useCallback((candidate: NativeCardCandidate) => {
    setAutomationBusy(true);
    void cardAutomationPlugin.acknowledgeEvents({ events: [candidateAcknowledgement(candidate)] }).then(() => {
      setPendingAutomation((current) => Object.freeze(current.filter((item) => item.id !== candidate.id || item.packageName !== candidate.packageName)));
    }).catch(() => notify(t(stateRef.current.locale, "automationError"), "error")).finally(() => setAutomationBusy(false));
  }, [notify]);

  const registerAutomationSource = useCallback((ledgerId: string, source: AutomationSource) => {
    void commit((wallet) => {
      const target = wallet.ledgers.find((ledger) => ledger.id === ledgerId);
      if (!target || target.kind !== "general") return wallet;
      const owner = wallet.ledgers.find((ledger) => ledger.kind === "general" && ledger.currency === target.currency && ledger.automationSources.some((item) => item.packageName === source.packageName));
      if (owner && owner.id !== ledgerId) { queueMicrotask(() => notify(t(wallet.locale, "sourceAlreadyAssigned"), "error")); return wallet; }
      if (target.automationSources.length >= MAX_AUTOMATION_SOURCES || owner) return wallet;
      const updated = Object.freeze({ ...target, automationSources: Object.freeze([...target.automationSources, Object.freeze(source)]), updatedAt: new Date().toISOString() });
      return replaceLedger(wallet, updated);
    });
  }, [commit, notify]);

  const removeAutomationSource = useCallback((ledgerId: string, packageName: string) => {
    void commitWithNativeScopeReduction((wallet) => {
      const target = wallet.ledgers.find((ledger) => ledger.id === ledgerId);
      if (!target || target.kind !== "general") return wallet;
      const updated = Object.freeze({ ...target, automationSources: Object.freeze(target.automationSources.filter((source) => source.packageName !== packageName)), updatedAt: new Date().toISOString() });
      return replaceLedger(wallet, updated);
    });
  }, [commitWithNativeScopeReduction]);

  const toggleAllPaymentApps = useCallback((ledgerId: string, enabled: boolean) => {
    setAutomationBusy(true);
    void (async () => {
      try {
        const update = (wallet: WalletState) => {
          const target = wallet.ledgers.find((ledger) => ledger.id === ledgerId);
          if (!target || target.kind !== "general" || target.automationAllApps === enabled) return wallet;
          if (enabled && wallet.ledgers.some((ledger) => ledger.kind === "general" && ledger.id !== ledgerId && ledger.currency === target.currency && ledger.automationAllApps)) {
            queueMicrotask(() => notify(t(wallet.locale, "allAppsAlreadyAssigned"), "error"));
            return wallet;
          }
          return replaceLedger(wallet, Object.freeze({ ...target, automationAllApps: enabled, updatedAt: new Date().toISOString() }));
        };
        await (enabled ? commit(update) : commitWithNativeScopeReduction(update));
      } catch {
        notify(t(stateRef.current.locale, "automationError"), "error");
      } finally {
        setAutomationBusy(false);
      }
    })();
  }, [commit, commitWithNativeScopeReduction, notify]);

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
    const interval = window.setInterval(onVisibility, 10_000);
    return () => { window.clearInterval(interval); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", onVisibility); };
  }, [loaded, refreshCardAutomation]);

  const pendingForActiveLedger = useMemo(() => visibleCardCandidates(state.ledgers, activeLedger?.id ?? null, pendingAutomation), [activeLedger?.id, pendingAutomation, state.ledgers]);

  const activeGeneralLedgerId = activeLedger?.kind === "general" ? activeLedger.id : null;
  const registerSourceForActiveLedger = useCallback((source: AutomationSource) => { if (activeGeneralLedgerId) registerAutomationSource(activeGeneralLedgerId, source); }, [activeGeneralLedgerId, registerAutomationSource]);
  const removeSourceFromActiveLedger = useCallback((packageName: string) => { if (activeGeneralLedgerId) removeAutomationSource(activeGeneralLedgerId, packageName); }, [activeGeneralLedgerId, removeAutomationSource]);
  const toggleAllAppsForActiveLedger = useCallback((enabled: boolean) => { if (activeGeneralLedgerId) toggleAllPaymentApps(activeGeneralLedgerId, enabled); }, [activeGeneralLedgerId, toggleAllPaymentApps]);
  const confirmExpenseForActiveLedger = useCallback((candidate: NativeCardCandidate) => { if (activeGeneralLedgerId) confirmAutomationExpense(activeGeneralLedgerId, candidate); }, [activeGeneralLedgerId, confirmAutomationExpense]);

  if (!loaded) return <main className="mobile-app loading-screen"><WalletCards /><p>{t(locale, "loading")}</p></main>;
  return (
    <main className="mobile-app">
      <header className="app-header"><h1>지갑의 일기</h1><div className="header-tools"><label className="language-control"><Languages aria-hidden="true" /><span className="sr-only">{t(locale, "language")}</span><select value={locale} onChange={(event) => changeLocale(event.target.value as Locale)}>{SUPPORTED_LOCALES.map((code) => <option value={code} key={code}>{code === "ko" ? "한국어" : code === "en" ? "English" : "Français"}</option>)}</select></label><button className="icon-button" type="button" onClick={() => importInput.current?.click()} aria-label={t(locale, "importLedger")}><Download /></button><input ref={importInput} className="sr-only" type="file" accept=".walletdiary,.json,application/json,application/octet-stream" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importLedger(file); event.currentTarget.value = ""; }} /></div></header>
      <LedgerTabs ledgers={state.ledgers} activeId={activeLedger?.id ?? null} locale={locale} onSelect={selectLedger} onAdd={() => setNewLedgerOpen(true)} onMenu={setMenuLedger} />
      {activeLedger ? activeLedger.kind === "travel" ? <TravelLedgerView key={activeLedger.id} ledger={activeLedger} locale={locale} onImport={() => importInput.current?.click()} onChange={updateLedger} onNotify={notify} /> : <GeneralLedgerView key={activeLedger.id} ledger={activeLedger} locale={locale} automationStatus={automationStatus} pendingAutomation={pendingForActiveLedger} automationBusy={automationBusy} onAutomationRefresh={refreshCardAutomation} onOpenAutomationSettings={openAutomationSettings} onRequestAutomationAlertPermission={requestAutomationAlertPermission} onToggleAllPaymentApps={toggleAllAppsForActiveLedger} onRegisterAutomationSource={registerSourceForActiveLedger} onRemoveAutomationSource={removeSourceFromActiveLedger} onConfirmAutomationExpense={confirmExpenseForActiveLedger} onDismissAutomationCandidate={dismissAutomationCandidate} onMove={(expense) => setMoveRequest({ sourceLedgerId: activeLedger.id, expense })} onChange={updateLedger} onNotify={notify} /> : <section className="empty-app"><WalletCards /><h2>{t(locale, "noLedgers")}</h2><button className="primary-button" type="button" onClick={() => setNewLedgerOpen(true)}><Plus />{t(locale, "newLedger")}</button><p>{t(locale, "storageHelp")}</p></section>}
      {newLedgerOpen ? <NewLedgerSheet locale={locale} onClose={() => setNewLedgerOpen(false)} onCreate={addLedger} /> : null}
      {moveRequest ? <MoveExpenseSheet expense={moveRequest.expense} travels={travelLedgers} locale={locale} busy={exchangeBusy} onClose={() => setMoveRequest(null)} onMove={(selection) => void moveExpense(selection)} /> : null}
      {travelImport ? <TravelImportSheet incoming={travelImport} travels={travelLedgers} preferredId={activeLedger?.id ?? null} locale={locale} busy={exchangeBusy} onClose={() => setTravelImport(null)} onConfirm={(selection) => void confirmTravelImport(selection)} /> : null}
      {menuLedger ? <LedgerMenuSheet ledger={menuLedger} locale={locale} onClose={() => setMenuLedger(null)} onRename={renameLedger} onDelete={deleteLedger} /> : null}
      {toast ? <div className={`toast ${toast.tone}`} role="status"><span>{toast.message}</span><button type="button" onClick={() => setToast(null)} aria-label={t(locale, "close")}><X /></button></div> : null}
    </main>
  );
}
