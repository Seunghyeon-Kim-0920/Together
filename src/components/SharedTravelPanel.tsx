import { Cloud, Share2, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { SHARED_TRAVEL_FIREBASE_CONFIG } from "../lib/sharedTravelConfig";
import { MAX_SHARED_PARTICIPANTS, normalizeSharedError, SharedTravelError, type SharedTravelClient, type SharedTripSnapshot } from "../lib/sharedTravel";
import { acknowledgeSharedMutation, connectSharedLedger, disconnectSharedLedger, receiveSharedSnapshot, resolveSharedConflict } from "../lib/sharedTravelLocal";
import { sharedText as s } from "../lib/sharedTravelI18n";
import { formatMoney } from "../lib/currency";
import type { Locale, TravelLedger } from "../lib/types";
import "./shared-travel.css";

type Props = {
  ledger: TravelLedger; locale: Locale;
  getLatest: () => TravelLedger;
  onApply: (mutation: (ledger: TravelLedger) => TravelLedger) => Promise<TravelLedger>;
  onNotify: (message: string, tone?: "success" | "error" | "info") => void;
};
type Phase = "syncing" | "online" | "offline" | "quota" | "error" | "permission" | "identity";

export function SharedTravelPanel({ ledger, locale, getLatest, onApply, onNotify }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [displayName, setDisplayName] = useState(""); const [inviteInput, setInviteInput] = useState("");
  const [consent, setConsent] = useState(false); const [inviteCode, setInviteCode] = useState("");
  const [busy, setBusy] = useState(false); const actionLock = useRef(false);
  const [phase, setPhase] = useState<Phase>("syncing"); const [retry, setRetry] = useState(0);
  const [confirmExit, setConfirmExit] = useState<"leave" | "delete" | "local" | null>(null);
  const [removeUid, setRemoveUid] = useState<string | null>(null);
  const [conflictChoice, setConflictChoice] = useState<string | null>(null);
  const triggerRef = useRef<(() => void) | null>(null);
  const sync = ledger.sharedSync; const tripId = sync?.tripId; const uid = sync?.uid;
  const configured = SHARED_TRAVEL_FIREBASE_CONFIG !== null;
  const owner = Boolean(sync && sync.trip.ownerUid === uid);
  const exitMode = phase === "identity" ? "local" : owner ? "delete" : sync?.trip.deleted || phase === "permission" ? "local" : "leave";

  // One listener and one serialized worker per visible trip. Processing new
  // snapshots waits for in-flight acknowledgements, preventing false conflicts.
  useEffect(() => {
    if (!tripId || !uid || !configured) return;
    let disposed = false; let running = false; let halted = false; let recoverable = false;
    let latestSnapshot: SharedTripSnapshot | null = null;
    let client: SharedTravelClient | null = null; let unsubscribe: (() => void) | null = null;
    const fail = (error: unknown) => {
      halted = true;
      const code = normalizeSharedError(error).code; recoverable = code === "unavailable";
      if (!disposed) setPhase(!navigator.onLine ? "offline" : code === "quota" ? "quota" : code === "permission-denied" || code === "not-found" ? "permission" : "error");
    };
    const run = async () => {
      if (disposed || running || halted || !client) return;
      if (!navigator.onLine) { setPhase("offline"); return; }
      running = true;
      try {
        if (latestSnapshot) {
          const snapshot = latestSnapshot; latestSnapshot = null;
          await onApply((current) => receiveSharedSnapshot(current, snapshot));
        }
        for (let count = 0; count < 25 && !disposed; count += 1) {
          const current = getLatest();
          if (!current.sharedSync || current.sharedSync.tripId !== tripId || current.sharedSync.trip.deleted) break;
          const op = current.sharedSync.pending.find((item) => !item.conflict);
          if (!op) break;
          setPhase("syncing");
          try {
            const result = await client.publishExpense(tripId, op);
            await onApply((latest) => latest.sharedSync?.tripId === tripId ? acknowledgeSharedMutation(latest, op, result) : latest);
          } catch (error) {
            if (normalizeSharedError(error).code !== "conflict") throw error;
            const snapshot = await client.getSnapshot(tripId);
            await onApply((latest) => receiveSharedSnapshot(latest, snapshot));
            // Stop this pass if the backend could not supply the changed row.
            if (getLatest().sharedSync?.pending.find((p) => p.id === op.id)?.conflict !== true) throw error;
          }
        }
        if (!disposed) setPhase("online");
      } catch (error) { fail(error); }
      finally {
        running = false;
        if (!disposed && !halted && navigator.onLine && !getLatest().sharedSync?.trip.deleted && (latestSnapshot || getLatest().sharedSync?.pending.some((p) => !p.conflict))) window.setTimeout(() => void run(), 50);
      }
    };
    const wake = () => { if (!navigator.onLine) { setPhase("offline"); return; } void run(); };
    triggerRef.current = wake;
    void import("../lib/sharedTravelClient").then(async ({ getSharedTravelClient }) => {
      client = await getSharedTravelClient();
      if (disposed) return;
      if (client.uid !== uid) { halted = true; setPhase("identity"); return; }
      unsubscribe = client.listenTrip(tripId, (snapshot) => { latestSnapshot = snapshot; void run(); }, fail);
      latestSnapshot = await client.getSnapshot(tripId);
      await run();
    }).catch(fail);
    const reconnected = () => { if (halted && recoverable) setRetry((attempt) => attempt + 1); else wake(); };
    window.addEventListener("online", reconnected); window.addEventListener("offline", wake);
    return () => { disposed = true; triggerRef.current = null; unsubscribe?.(); window.removeEventListener("online", reconnected); window.removeEventListener("offline", wake); };
  }, [tripId, uid, configured, retry, getLatest, onApply]);
  useEffect(() => { triggerRef.current?.(); }, [ledger.sharedSync?.pending]);

  const action = async (task: (client: SharedTravelClient) => Promise<void>, deletion = false) => {
    if (actionLock.current) return;
    actionLock.current = true; setBusy(true);
    try {
      const { getSharedTravelClient } = await import("../lib/sharedTravelClient");
      const client = await getSharedTravelClient();
      if (uid && client.uid !== uid) throw new SharedTravelError("permission-denied");
      await task(client);
    } catch (error) { const code = normalizeSharedError(error).code; onNotify(s(locale, deletion ? "deleteFailed" : code === "quota" ? "quota" : code === "permission-denied" ? "permission" : "error"), "error"); }
    finally { actionLock.current = false; setBusy(false); }
  };
  const connect = (join: boolean) => action(async (client) => {
    if (!consent || !displayName.trim()) return;
    if (!join && (!getLatest().participants.length || getLatest().participants.length > MAX_SHARED_PARTICIPANTS)) { onNotify(s(locale, "warning"), "error"); return; }
    const current = getLatest();
    if (join && (current.expenses.length || current.participants.length)) { onNotify(s(locale, "joinEmpty"), "error"); return; }
    const connection = join ? await client.joinTrip(inviteInput.trim(), displayName.trim()) : await client.createTrip(current, displayName.trim());
    const trip = connection.trip;
    try {
      const snapshot = join ? await client.getSnapshot(trip.id) : undefined;
      await onApply((latest) => {
      if (JSON.stringify(current) !== JSON.stringify(latest)) throw new SharedTravelError("conflict");
      return connectSharedLedger(latest, trip, client.uid, snapshot);
    }); } catch (error) {
      // Do not leave a newly created cloud trip orphaned if durable local save fails.
      if (!join && "created" in connection && connection.created) await client.deleteTrip(trip.id);
      else if (join && "joined" in connection && connection.joined) await client.leaveTrip(trip.id);
      throw error;
    }
    setExpanded(true); setConsent(false);
  });
  const exit = async () => {
    if (!sync || !confirmExit) return;
    const mode = confirmExit;
    if (mode === "local") {
      await onApply(disconnectSharedLedger); setConfirmExit(null); return;
    }
    await action(async (client) => {
      if (mode === "delete") await client.deleteTrip(sync.tripId); else await client.leaveTrip(sync.tripId);
      await onApply(disconnectSharedLedger); setConfirmExit(null);
    }, true);
  };
  const resolve = async (id: string, keepLocal: boolean) => {
    if (actionLock.current) return;
    actionLock.current = true; setBusy(true);
    try { await onApply((current) => resolveSharedConflict(current, id, keepLocal)); setConflictChoice(null); }
    catch { onNotify(s(locale, "error"), "error"); }
    finally { actionLock.current = false; setBusy(false); }
  };

  return <section className="mobile-panel shared-travel-panel">
    <button className="summary-setting-row" type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}><Cloud aria-hidden="true" /><span className="summary-setting-copy"><strong>{s(locale, "title")}</strong><small>{!configured ? s(locale, "unavailable") : sync ? `${s(locale, phase)}${sync.pending.length ? ` · ${s(locale, "waiting")} ${sync.pending.length}` : ""}` : s(locale, "intro")}</small></span></button>
    {expanded ? <div className="shared-travel-body">
      {!sync ? <>
        <p>{s(locale, "intro")}</p><p className="storage-note">{s(locale, "warning")}</p>
        {configured ? <><label className="field-label">{s(locale, "name")}<input maxLength={80} value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label><label className="shared-consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>{s(locale, "consent")}</span></label><button type="button" className="wide-secondary" disabled={busy || !consent || !displayName.trim() || !ledger.participants.length || ledger.participants.length > MAX_SHARED_PARTICIPANTS} onClick={() => void connect(false)}>{s(locale, "create")}</button><label className="field-label">{s(locale, "code")}<input autoCapitalize="none" autoComplete="off" maxLength={200} value={inviteInput} onChange={(event) => setInviteInput(event.target.value)} /></label><button className="wide-secondary" type="button" disabled={busy || !consent || !displayName.trim() || !inviteInput.trim()} onClick={() => void connect(true)}>{s(locale, "join")}</button></> : <p role="status">{s(locale, "unavailable")}</p>}
      </> : <>
        <p className="storage-note">{s(locale, "locked")}</p><p role="status">{sync.trip.deleted ? s(locale, "deletedTrip") : s(locale, phase)}</p>
        {configured ? <button className="wide-secondary" type="button" disabled={busy} onClick={() => { setPhase("syncing"); setRetry((r) => r + 1); }}>{s(locale, "retry")}</button> : null}
        {sync.pending.filter((op) => op.conflict).map((op) => {
          const remote = sync.records.find((r) => r.id === op.id)?.expense;
          return <article className="delete-confirm" key={op.id}><strong>{s(locale, "conflict")}</strong><p>{s(locale, "local")}: {op.expense ? `${op.expense.occurredOn} · ${op.expense.description} · ${formatMoney(op.expense.minorUnits, op.expense.currency, locale)}` : s(locale, "deleted")}</p><p>{s(locale, "remote")}: {remote ? `${remote.occurredOn} · ${remote.description} · ${formatMoney(remote.minorUnits, remote.currency, locale)}` : s(locale, "deleted")}</p><div><button disabled={busy} type="button" onClick={() => void resolve(op.id, false)}>{s(locale, "keepRemote")}</button><button disabled={busy} type="button" onClick={() => setConflictChoice(op.id)}>{s(locale, "keepLocal")}</button></div>{conflictChoice === op.id ? <button className="danger-button" type="button" disabled={busy} onClick={() => void resolve(op.id, true)}>{s(locale, "confirm")}: {s(locale, "keepLocal")}</button> : null}</article>;
        })}
        <h3><Users aria-hidden="true" />{s(locale, "members")}</h3>{sync.members.map((m) => <div className="shared-member" key={m.uid}><span>{m.displayName}</span>{owner && m.uid !== uid ? <button disabled={busy} type="button" onClick={() => setRemoveUid(m.uid)}>{s(locale, "remove")}</button> : null}</div>)}
        {removeUid ? <div className="delete-confirm"><p>{s(locale, "remove")}: {sync.members.find((m) => m.uid === removeUid)?.displayName}</p><button type="button" disabled={busy} onClick={() => void action(async (client) => { await client.revokeMember(sync.tripId, removeUid); setRemoveUid(null); })}>{s(locale, "confirm")}</button><button type="button" disabled={busy} onClick={() => setRemoveUid(null)}>{s(locale, "cancel")}</button></div> : null}
        {owner && !sync.trip.deleted ? <button className="wide-secondary" type="button" disabled={busy || !configured} onClick={() => void action(async (client) => setInviteCode(await client.createInvite(sync.tripId)))}>{s(locale, "invite")}</button> : null}
        {inviteCode ? <div className="shared-invite"><label className="field-label">{s(locale, "code")}<textarea readOnly value={inviteCode} /></label><p>{s(locale, "expired")}</p><button type="button" onClick={() => void import("@capacitor/share").then(({ Share }) => Share.share({ title: ledger.title, text: `${ledger.title}\n${s(locale, "code")}: ${inviteCode}` })).catch(() => onNotify(s(locale, "error"), "error"))}><Share2 aria-hidden="true" />{s(locale, "share")}</button><button type="button" disabled={busy} onClick={() => void action(async (client) => { await client.revokeInvite(inviteCode); setInviteCode(""); })}>{s(locale, "revokeInvite")}</button></div> : null}
        {confirmExit ? <div className="delete-confirm"><p>{s(locale, "confirmDelete")}</p>{sync.pending.length ? <p>{s(locale, "pendingWarning")}</p> : null}<button className="danger-button" type="button" disabled={busy} onClick={() => void exit().catch(() => onNotify(s(locale, "error"), "error"))}>{s(locale, "confirm")}</button><button type="button" disabled={busy} onClick={() => setConfirmExit(null)}>{s(locale, "cancel")}</button></div> : <button className="wide-danger" type="button" disabled={busy} onClick={() => setConfirmExit(exitMode)}>{s(locale, exitMode === "local" ? "disconnect" : exitMode === "delete" ? "closeTrip" : "leave")}</button>}
      </>}
    </div> : null}
  </section>;
}
