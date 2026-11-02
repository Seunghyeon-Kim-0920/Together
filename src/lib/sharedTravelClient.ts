import { getApp, getApps, initializeApp } from "firebase/app";
import { browserLocalPersistence, getAuth, setPersistence, signInAnonymously } from "firebase/auth";
import { collection, deleteDoc, deleteField, doc, documentId, getDocFromServer, getDocsFromServer, getFirestore, limit, onSnapshot, orderBy, query, runTransaction, serverTimestamp, startAfter, Timestamp, where, writeBatch, type Firestore } from "firebase/firestore";
import { SHARED_TRAVEL_FIREBASE_CONFIG, type SharedTravelFirebaseConfig } from "./sharedTravelConfig";
import { MAX_SHARED_EXPENSES, MAX_SHARED_PARTICIPANTS, normalizeSharedError, parseSharedExpense, parseSharedMember, parseSharedTrip, registerSharedParticipant, removeParticipantFromSharedExpense, SharedTravelError, sharedId, toSharedExpenseData, toSharedTripData, updateSharedParticipants, type SharedExpenseRecord, type SharedMember, type SharedTravelClient, type SharedTrip } from "./sharedTravel";

const COLLECTION = "sharedTrips";
const INVITE_DURATION_MS = 24 * 60 * 60 * 1_000;
/** Call only after the user opts into shared travel. No analytics, billing or private-wallet upload. */
export const getSharedTravelClient = createSharedTravelClientLoader(SHARED_TRAVEL_FIREBASE_CONFIG);

/** Injection keeps unit tests offline even after a real project is configured. */
export function createSharedTravelClientLoader(config: SharedTravelFirebaseConfig | null, initialize = initializeClient): () => Promise<SharedTravelClient> {
  let clientPromise: Promise<SharedTravelClient> | null = null;
  return () => {
    if (!config) return Promise.reject(new SharedTravelError("not-configured"));
    if (!clientPromise) clientPromise = deadline(initialize(config), 15_000).catch((error: unknown) => { clientPromise = null; throw normalizeSharedError(error); });
    return clientPromise;
  };
}

async function deadline<T>(operation: Promise<T>, timeoutMs = 20_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([operation, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new SharedTravelError("unavailable")), timeoutMs); })]); }
  finally { if (timer) clearTimeout(timer); }
}

async function initializeClient(config: SharedTravelFirebaseConfig): Promise<SharedTravelClient> {
  const app = sharedFirebaseApp(config);
  const auth = getAuth(app);
  // Do not use a temporary identity if durable auth storage is unavailable.
  await setPersistence(auth, browserLocalPersistence);
  await auth.authStateReady();
  const user = auth.currentUser ?? (await signInAnonymously(auth)).user;
  // Firestore's default in-memory cache is sufficient: the app owns its durable, private outbox.
  return createFirebaseSharedTravelClient(getFirestore(app), user.uid);
}

function sharedFirebaseApp(config: SharedTravelFirebaseConfig) {
  const name = "wallet-diary-shared-travel";
  return getApps().some((candidate) => candidate.name === name) ? getApp(name) : initializeApp(config, name);
}

/** Read an existing anonymous identity without creating a new account. */
export async function existingSharedTravelUid(): Promise<string | null> {
  if (!SHARED_TRAVEL_FIREBASE_CONFIG) return null;
  const auth = getAuth(sharedFirebaseApp(SHARED_TRAVEL_FIREBASE_CONFIG));
  await auth.authStateReady();
  return auth.currentUser?.uid ?? null;
}

function requireId(id: string): void { if (!sharedId(id)) throw new SharedTravelError("invalid-data"); }
function requireName(name: string): string { const value = name.trim(); if (!value || value.length > 80 || value.includes("|")) throw new SharedTravelError("invalid-data"); return value; }
function parseInvite(code: string): { tripId: string; token: string } {
  const parts = code.trim().split(".");
  if (parts.length !== 2 || !sharedId(parts[0]) || !/^[a-f0-9]{64}$/.test(parts[1])) throw new SharedTravelError("invalid-data");
  return { tripId: parts[0], token: parts[1] };
}
function randomToken(): string { return Array.from(crypto.getRandomValues(new Uint8Array(32)), (value) => value.toString(16).padStart(2, "0")).join(""); }
function requireTrip(id: string, data: unknown): SharedTrip { const trip = parseSharedTrip(id, data); if (!trip) throw new SharedTravelError("invalid-data"); return trip; }
function requireExpense(id: string, data: unknown, trip: SharedTrip): SharedExpenseRecord { const record = parseSharedExpense(id, data, trip); if (!record) throw new SharedTravelError("invalid-data"); return record; }

/** Injectable database boundary for authenticated emulator tests; production uses getSharedTravelClient. */
export function createFirebaseSharedTravelClient(db: Firestore, uid: string): SharedTravelClient {
  requireId(uid);
  const tripRef = (tripId: string) => { requireId(tripId); return doc(db, COLLECTION, tripId); };
  const memberRef = (tripId: string, memberUid: string) => { requireId(memberUid); return doc(tripRef(tripId), "members", memberUid); };
  async function guarded<T>(operation: () => Promise<T>): Promise<T> { try { return await deadline(operation()); } catch (error) { throw normalizeSharedError(error); } }
  async function readTrip(tripId: string): Promise<SharedTrip> {
    const snapshot = await getDocFromServer(tripRef(tripId));
    if (!snapshot.exists()) throw new SharedTravelError("not-found");
    const trip = requireTrip(tripId, snapshot.data());
    if (trip.deleted) throw new SharedTravelError("not-found");
    return trip;
  }
  function checkOwner(trip: SharedTrip): void { if (trip.ownerUid !== uid) throw new SharedTravelError("permission-denied"); }
  async function ensureParticipant(tripId: string, preferredParticipantId?: string | null): Promise<SharedTrip> {
    for (let attempt = 0; attempt < MAX_SHARED_PARTICIPANTS; attempt += 1) {
      let attemptedRevision: number | null = null;
      try { return await runTransaction(db, async (transaction) => {
      const [header, membership] = await Promise.all([transaction.get(tripRef(tripId)), transaction.get(memberRef(tripId, uid))]);
      if (!header.exists()) throw new SharedTravelError("not-found");
      const trip = requireTrip(tripId, header.data());
      if (trip.deleted) throw new SharedTravelError("not-found");
      const person = membership.exists() ? parseSharedMember(uid, membership.data()) : null;
      if (!person) throw new SharedTravelError("permission-denied");
      attemptedRevision = trip.revision;
      const next = registerSharedParticipant(trip, uid, person.displayName, preferredParticipantId);
      if (next !== trip) transaction.update(tripRef(tripId), {
        participantIds: next.participants.map((p) => p.id), participantNames: next.participants.map((p) => p.name),
        participantMembers: next.participantMembers, revision: next.revision, updatedAt: serverTimestamp(),
      });
      return next;
      }); } catch (error) {
        if (attemptedRevision === null || normalizeSharedError(error).code !== "permission-denied") throw error;
        // A concurrent registration can advance the header before revision rules are evaluated.
        // Retry only if an authorized server read proves progress; actual access denial still fails.
        const latest = await readTrip(tripId);
        if (latest.revision <= attemptedRevision) throw error;
      }
    }
    throw new SharedTravelError("conflict");
  }

  const client: SharedTravelClient = {
    uid,
    createTrip: (ledger, displayName) => guarded(async () => {
      const reference = tripRef(ledger.id);
      const name = requireName(displayName);
      const initial = registerSharedParticipant(requireTrip(ledger.id, toSharedTripData(ledger, uid)), uid, name, ledger.selfParticipantId);
      const data = { ...toSharedTripData({ ...ledger, participants: initial.participants }, uid), participantMembers: initial.participantMembers };
      const result = await runTransaction(db, async (transaction) => {
        const existing = await transaction.get(reference);
        if (existing.exists()) {
          const trip = requireTrip(ledger.id, existing.data()); checkOwner(trip);
          if (trip.deleted) throw new SharedTravelError("not-found");
          return { trip, created: false };
        }
        transaction.set(reference, { ...data, updatedAt: serverTimestamp() });
        transaction.set(memberRef(ledger.id, uid), { schema: 1, role: "owner", displayName: name, joinedAt: serverTimestamp() });
        return { trip: requireTrip(ledger.id, data), created: true };
      });
      return result.created ? result : { ...result, trip: await ensureParticipant(ledger.id, ledger.selfParticipantId) };
    }),
    createInvite: (tripId) => guarded(async () => {
      checkOwner(await readTrip(tripId));
      const [members, activeInvites] = await Promise.all([
        getDocsFromServer(query(collection(tripRef(tripId), "members"), limit(MAX_SHARED_PARTICIPANTS))),
        getDocsFromServer(query(collection(tripRef(tripId), "invites"), where("expiresAt", ">", Timestamp.now()), limit(MAX_SHARED_PARTICIPANTS))),
      ]);
      if (members.size >= MAX_SHARED_PARTICIPANTS || activeInvites.size >= MAX_SHARED_PARTICIPANTS) throw new SharedTravelError("limit");
      const token = randomToken();
      const batch = writeBatch(db);
      batch.set(doc(tripRef(tripId), "invites", token), { schema: 1, ownerUid: uid, expiresAt: Timestamp.fromMillis(Date.now() + INVITE_DURATION_MS), createdAt: serverTimestamp() });
      await batch.commit();
      return `${tripId}.${token}`;
    }),
    revokeInvite: (code) => guarded(async () => { const { tripId, token } = parseInvite(code); checkOwner(await readTrip(tripId)); await deleteDoc(doc(tripRef(tripId), "invites", token)); }),
    joinTrip: (code, displayName) => guarded(async () => {
      const { tripId, token } = parseInvite(code); const name = requireName(displayName);
      const invite = doc(tripRef(tripId), "invites", token); const member = memberRef(tripId, uid);
      const joined = await runTransaction(db, async (transaction) => {
        const [invitation, existing] = await Promise.all([transaction.get(invite), transaction.get(member)]);
        if (!invitation.exists() || !(invitation.data().expiresAt instanceof Timestamp) || invitation.data().expiresAt.toMillis() <= Date.now()) throw new SharedTravelError("not-found");
        if (existing.exists()) return false;
        transaction.set(member, { schema: 1, role: "member", displayName: name, inviteToken: token, joinedAt: serverTimestamp() });
        return true;
      });
      try { return { trip: await ensureParticipant(tripId), joined }; }
      catch (error) {
        if (joined) {
          // Roll back an incomplete join, but never remove a concurrently completed registration.
          await runTransaction(db, async (transaction) => {
            const header = await transaction.get(tripRef(tripId));
            if (header.exists() && !Object.hasOwn(requireTrip(tripId, header.data()).participantMembers ?? {}, uid)) transaction.delete(member);
          }).catch(() => { /* A network interruption is recoverable by joining with the same UID again. */ });
        }
        throw error;
      }
    }),
    ensureParticipant: (tripId, preferredParticipantId) => guarded(() => ensureParticipant(tripId, preferredParticipantId)),
    getSnapshot: (tripId) => guarded(async () => {
      // Bracket financial reads with one stable header. In particular a second
      // history operation must not mix its partial rows with an unlocked header
      // from a previously completed operation. Bounded retries fail closed.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const before = await readTrip(tripId);
        const [expenses, members] = await Promise.all([getDocsFromServer(query(collection(tripRef(tripId), "expenses"), limit(MAX_SHARED_EXPENSES + 1))), getDocsFromServer(collection(tripRef(tripId), "members"))]);
        if (expenses.size > MAX_SHARED_EXPENSES) throw new SharedTravelError("limit");
        const trip = await readTrip(tripId);
        if (before.revision !== trip.revision) continue;
        return { trip, expenses: expenses.docs.map((record) => requireExpense(record.id, record.data(), trip)), members: members.docs.map((record) => { const member = parseSharedMember(record.id, record.data()); if (!member) throw new SharedTravelError("invalid-data"); return member; }), fromCache: false };
      }
      throw new SharedTravelError("conflict");
    }),
    listenTrip: (tripId, receive, failure) => {
      const reference = tripRef(tripId);
      let disposed = false; let trip: SharedTrip | null = null; let refreshingHeader = false;
      let expenseGeneration = 0; let awaitingExpenseHeader = false;
      let expenseDocs: { id: string; data: unknown }[] | null = null; let members: SharedMember[] | null = null;
      const cached = { trip: true, expenses: true, members: true };
      const stops: (() => void)[] = [];
      function stop(): void { disposed = true; for (const unsubscribe of stops) unsubscribe(); }
      function fail(error: unknown): void { if (!disposed) { stop(); failure(normalizeSharedError(error)); } }
      function emit(): void {
        if (disposed || awaitingExpenseHeader || !trip || !expenseDocs || !members) return;
        try {
          const records = expenseDocs.map((record) => parseSharedExpense(record.id, record.data, trip!));
          if (records.some((record) => !record)) {
            // Independent Firestore listeners may deliver an expense before its new participant header.
            if (refreshingHeader) return;
            refreshingHeader = true;
            const generation = expenseGeneration;
            void client.getSnapshot(tripId).then((snapshot) => {
              if (disposed) return;
              refreshingHeader = false;
              if (generation !== expenseGeneration || trip && snapshot.trip.revision < trip.revision) { emit(); return; }
              trip = snapshot.trip; members = [...snapshot.members];
              expenseDocs = snapshot.expenses.map((record) => ({ id: record.id, data: record.expense
                ? toSharedExpenseData(record.expense, snapshot.trip, record.authorUid, record.updatedBy, record.revision, record.mutationId)
                : { schema: 1, authorUid: record.authorUid, updatedBy: record.updatedBy, revision: record.revision, mutationId: record.mutationId, deleted: true } }));
              cached.trip = false; cached.expenses = false; cached.members = false; emit();
            }).catch(fail);
            return;
          }
          receive({ trip, expenses: records as SharedExpenseRecord[], members, fromCache: cached.trip || cached.expenses || cached.members });
        } catch (error) { fail(error); }
      }
      stops.push(onSnapshot(reference, { includeMetadataChanges: true }, (snapshot) => {
        try {
          if (!snapshot.exists()) { if (snapshot.metadata.fromCache) return; throw new SharedTravelError("not-found"); }
          const latest = requireTrip(tripId, snapshot.data());
          if (!trip || latest.revision >= trip.revision) { trip = latest; cached.trip = snapshot.metadata.fromCache; }
          if (trip.deleted) throw new SharedTravelError("not-found"); emit();
        } catch (error) { fail(error); }
      }, fail));
      stops.push(onSnapshot(query(collection(reference, "expenses"), limit(MAX_SHARED_EXPENSES + 1)), { includeMetadataChanges: true }, (snapshot) => {
        if (snapshot.size > MAX_SHARED_EXPENSES) { fail(new SharedTravelError("limit")); return; }
        const generation = ++expenseGeneration;
        const candidate = snapshot.docs.map((record) => ({ id: record.id, data: record.data() }));
        if (snapshot.metadata.fromCache) { awaitingExpenseHeader = false; expenseDocs = candidate; cached.expenses = true; emit(); return; }
        // Independent listeners can deliver a page's rows before its lock header.
        // Never emit those rows with an older, unlocked header, even if the rows
        // happen to pass ordinary expense validation. Newer callbacks supersede
        // older pending reads, and cached rows never become server-confirmed here.
        awaitingExpenseHeader = true;
        void guarded(() => readTrip(tripId)).then((latest) => {
          if (disposed || generation !== expenseGeneration) return;
          if (!trip || latest.revision >= trip.revision) { trip = latest; cached.trip = false; }
          expenseDocs = candidate; cached.expenses = false; awaitingExpenseHeader = false; emit();
        }).catch((error) => { if (generation === expenseGeneration) fail(error); });
      }, fail));
      stops.push(onSnapshot(collection(reference, "members"), { includeMetadataChanges: true }, (snapshot) => {
        try { members = snapshot.docs.map((record) => { const member = parseSharedMember(record.id, record.data()); if (!member) throw new SharedTravelError("invalid-data"); return member; }); cached.members = snapshot.metadata.fromCache; emit(); } catch (error) { fail(error); }
      }, fail));
      return stop;
    },
    publishExpense: (tripId, mutation) => guarded(async () => {
      requireId(mutation.id); requireId(mutation.mutationId);
      if (!Number.isSafeInteger(mutation.expectedRevision) || mutation.expectedRevision < 0 || mutation.expectedRevision >= 1_999_999_999 || (mutation.expense && mutation.expense.id !== mutation.id)) throw new SharedTravelError("invalid-data");
      return runTransaction(db, async (transaction) => {
        const expenseRef = doc(tripRef(tripId), "expenses", mutation.id);
        const [header, current] = await Promise.all([transaction.get(tripRef(tripId)), transaction.get(expenseRef)]);
        if (!header.exists()) throw new SharedTravelError("not-found");
        const trip = requireTrip(tripId, header.data()); if (trip.deleted) throw new SharedTravelError("not-found");
        if (trip.participantHistoryRemoval) throw new SharedTravelError("history-busy");
        const previous = current.exists() ? requireExpense(mutation.id, current.data(), trip) : null;
        if (previous && previous.authorUid !== uid && trip.ownerUid !== uid) throw new SharedTravelError("permission-denied");
        if (previous?.mutationId === mutation.mutationId) {
          // A durable outbox may replay after the server committed but before the local acknowledgment.
          return previous;
        }
        if ((previous?.revision ?? 0) !== mutation.expectedRevision) throw new SharedTravelError("conflict");
        // A local creation can be deleted before its first upload. An initial
        // tombstone fences off late/replayed creation attempts with the same id.
        const nextRevision = mutation.expectedRevision + 1;
        const authorUid = previous?.authorUid ?? uid;
        const data = mutation.expense ? toSharedExpenseData(mutation.expense, trip, authorUid, uid, nextRevision, mutation.mutationId) : { schema: 1, authorUid, updatedBy: uid, revision: nextRevision, mutationId: mutation.mutationId, deleted: true };
        transaction.set(expenseRef, { ...data, updatedAt: serverTimestamp() });
        return requireExpense(mutation.id, data, trip);
      });
    }),
    updateTrip: (tripId, ledger, expectedRevision) => guarded(async () => runTransaction(db, async (transaction) => {
      const reference = tripRef(tripId); const snapshot = await transaction.get(reference);
      if (!snapshot.exists()) throw new SharedTravelError("not-found");
      const trip = requireTrip(tripId, snapshot.data()); checkOwner(trip);
      if (trip.deleted) throw new SharedTravelError("not-found");
      if (trip.participantHistoryRemoval) throw new SharedTravelError("history-busy");
      if (trip.revision !== expectedRevision) throw new SharedTravelError("conflict");
      if (JSON.stringify(trip.participants) !== JSON.stringify(ledger.participants) || JSON.stringify(trip.currencies) !== JSON.stringify(ledger.currencies) || trip.defaultCurrency !== ledger.defaultCurrency) throw new SharedTravelError("invalid-data");
      const data = toSharedTripData(ledger, uid, expectedRevision + 1);
      transaction.update(reference, { title: data.title, revision: data.revision, updatedAt: serverTimestamp() });
      return { ...trip, title: ledger.title, revision: expectedRevision + 1 };
    })),
    updateParticipants: (tripId, participants, inactiveParticipantIds, expectedRevision) => guarded(async () => runTransaction(db, async (transaction) => {
      const reference = tripRef(tripId); const snapshot = await transaction.get(reference);
      if (!snapshot.exists()) throw new SharedTravelError("not-found");
      const trip = requireTrip(tripId, snapshot.data());
      const next = updateSharedParticipants(trip, uid, participants, inactiveParticipantIds, expectedRevision);
      if (next !== trip) transaction.update(reference, {
        participantIds: next.participants.map((person) => person.id), participantNames: next.participants.map((person) => person.name),
        inactiveParticipantIds: next.inactiveParticipantIds, revision: next.revision, updatedAt: serverTimestamp(),
      });
      return next;
    })),
    removeParticipantHistory: async (tripId, participantId, expectedRevision, expectedRecords) => {
      requireId(participantId);
      const reference = tripRef(tripId);
      // Each committed page is durable. There is deliberately no whole-operation
      // timeout that could report completion/failure while later pages still run.
      let trip = await guarded(() => runTransaction(db, async (transaction) => {
        const snapshot = await transaction.get(reference);
        if (!snapshot.exists()) throw new SharedTravelError("not-found");
        const current = requireTrip(tripId, snapshot.data()); checkOwner(current);
        if (current.deleted) throw new SharedTravelError("not-found");
        if (!current.participants.some((p) => p.id === participantId)) throw new SharedTravelError("invalid-data");
        if (current.historyRemovedParticipantIds?.includes(participantId)) return current;
        if (current.participantHistoryRemoval) {
          if (current.participantHistoryRemoval.participantId !== participantId) throw new SharedTravelError("history-busy");
          return current;
        }
        if (current.revision !== expectedRevision) throw new SharedTravelError("conflict");
        const operation = { id: crypto.randomUUID(), participantId, phase: "preflight" as const, cursor: null };
        transaction.update(reference, { participantHistoryRemoval: operation, revision: current.revision + 1, updatedAt: serverTimestamp() });
        return { ...current, participantHistoryRemoval: operation, revision: current.revision + 1 };
      }));
      // A retry of a completed target is read-only even if a different target
      // is now locked. Never advance that newer operation using the old target.
      if (trip.historyRemovedParticipantIds?.includes(participantId) || !trip.participantHistoryRemoval) return client.getSnapshot(tripId);
      if (trip.participantHistoryRemoval.phase === "preflight") {
        const operationId = trip.participantHistoryRemoval.id;
        try {
          const all = await guarded(() => getDocsFromServer(query(collection(reference, "expenses"), limit(MAX_SHARED_EXPENSES + 1))));
          if (all.size > MAX_SHARED_EXPENSES) throw new SharedTravelError("limit");
          const records = all.docs.map((record) => requireExpense(record.id, record.data(), trip));
          if (expectedRecords) {
            const expected = new Map(expectedRecords.map((record) => [record.id, record]));
            if (records.length !== expected.size || records.some((record) => expected.get(record.id)?.revision !== record.revision || expected.get(record.id)?.deleted !== record.deleted)) throw new SharedTravelError("conflict");
          }
          for (const record of records) if (record.expense) removeParticipantFromSharedExpense(record.expense, participantId);
          trip = await guarded(() => runTransaction(db, async (transaction) => {
            const snapshot = await transaction.get(reference);
            if (!snapshot.exists()) throw new SharedTravelError("not-found");
            const current = requireTrip(tripId, snapshot.data()); checkOwner(current);
            if (current.participantHistoryRemoval?.id !== operationId) throw new SharedTravelError("conflict");
            if (current.participantHistoryRemoval.phase === "applying") return current;
            const operation = { ...current.participantHistoryRemoval, phase: "applying" as const, cursor: null };
            transaction.update(reference, { participantHistoryRemoval: operation, revision: current.revision + 1, updatedAt: serverTimestamp() });
            return { ...current, participantHistoryRemoval: operation, revision: current.revision + 1 };
          }));
        } catch (error) {
          // Only a preflight lock can be canceled: no financial row has changed.
          if (["conflict", "orphan-shares", "limit", "invalid-data"].includes(normalizeSharedError(error).code)) await guarded(() => runTransaction(db, async (transaction) => {
            const snapshot = await transaction.get(reference);
            if (!snapshot.exists()) return;
            const current = requireTrip(tripId, snapshot.data());
            if (current.participantHistoryRemoval?.id === operationId && current.participantHistoryRemoval.phase === "preflight") transaction.update(reference, { participantHistoryRemoval: deleteField(), revision: current.revision + 1, updatedAt: serverTimestamp() });
          }));
          throw normalizeSharedError(error);
        }
      }
      // Pages stay well below the Firestore write limit and the rules access budget.
      while (trip.participantHistoryRemoval) {
        const operation = trip.participantHistoryRemoval;
        const page = await guarded(() => getDocsFromServer(query(collection(reference, "expenses"), orderBy(documentId()), ...(operation.cursor ? [startAfter(operation.cursor)] : []), limit(50))));
        trip = await guarded(() => runTransaction(db, async (transaction) => {
          const header = await transaction.get(reference);
          if (!header.exists()) throw new SharedTravelError("not-found");
          const current = requireTrip(tripId, header.data()); checkOwner(current);
          if (!current.participantHistoryRemoval && current.historyRemovedParticipantIds?.includes(participantId)) return current;
          if (current.participantHistoryRemoval?.id !== operation.id) throw new SharedTravelError("conflict");
          // Another resumed worker committed this page. Re-query from its cursor.
          if (current.participantHistoryRemoval.cursor !== operation.cursor) return current;
          if (page.empty) {
            const inactiveParticipantIds = [...new Set([...(current.inactiveParticipantIds ?? []), participantId])];
            const historyRemovedParticipantIds = [...new Set([...(current.historyRemovedParticipantIds ?? []), participantId])];
            transaction.update(reference, { participantHistoryRemoval: deleteField(), inactiveParticipantIds, historyRemovedParticipantIds, revision: current.revision + 1, updatedAt: serverTimestamp() });
            const { participantHistoryRemoval: _operation, ...rest } = current; void _operation;
            return { ...rest, inactiveParticipantIds, historyRemovedParticipantIds, revision: current.revision + 1 };
          }
          const rows = await Promise.all(page.docs.map((record) => transaction.get(record.ref)));
          for (const row of rows) {
            if (!row.exists()) throw new SharedTravelError("conflict");
            const previous = requireExpense(row.id, row.data(), current);
            if (!previous.expense) continue;
            const expense = removeParticipantFromSharedExpense(previous.expense, participantId);
            if (expense === previous.expense) continue;
            const data = expense ? toSharedExpenseData(expense, current, previous.authorUid, uid, previous.revision + 1, operation.id) : { schema: 1, authorUid: previous.authorUid, updatedBy: uid, revision: previous.revision + 1, mutationId: operation.id, deleted: true };
            transaction.set(row.ref, { ...data, updatedAt: serverTimestamp() });
          }
          const nextOperation = { ...operation, cursor: page.docs[page.docs.length - 1].id };
          transaction.update(reference, { participantHistoryRemoval: nextOperation, revision: current.revision + 1, updatedAt: serverTimestamp() });
          return { ...current, participantHistoryRemoval: nextOperation, revision: current.revision + 1 };
        }));
      }
      return client.getSnapshot(tripId);
    },
    revokeMember: (tripId, memberUid) => guarded(async () => {
      checkOwner(await readTrip(tripId)); requireId(memberUid); if (memberUid === uid) throw new SharedTravelError("invalid-data");
      const batch = writeBatch(db);
      batch.set(doc(tripRef(tripId), "blocked", memberUid), { schema: 1, blockedAt: serverTimestamp() });
      batch.delete(memberRef(tripId, memberUid)); await batch.commit();
    }),
    leaveTrip: (tripId) => guarded(async () => runTransaction(db, async (transaction) => {
      // Read only this device's membership: a completed leave, revocation or owner
      // deletion removes permission to read the trip. Retrying must still succeed
      // so a failed local save cannot leave a permanently undeletable local tab.
      const reference = memberRef(tripId, uid);
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists()) return;
      const membership = parseSharedMember(uid, snapshot.data());
      if (!membership) throw new SharedTravelError("invalid-data");
      if (membership.role === "owner") throw new SharedTravelError("invalid-data");
      transaction.delete(reference);
    })),
    deleteTrip: (tripId) => guarded(async () => {
      const reference = tripRef(tripId);
      const exists = await runTransaction(db, async (transaction) => {
        const snapshot = await transaction.get(reference); if (!snapshot.exists()) return false;
        const trip = requireTrip(tripId, snapshot.data()); checkOwner(trip);
        if (!trip.deleted) transaction.update(reference, { deleted: true, revision: trip.revision + 1, updatedAt: serverTimestamp() });
        return true;
      });
      if (!exists) return;
      // Owner remains authorized through the tombstone, so interruption is safely retryable.
      for (const name of ["expenses", "invites", "members", "blocked"]) {
        while (true) {
          const page = await getDocsFromServer(query(collection(reference, name), limit(150)));
          if (page.empty) break;
          const batch = writeBatch(db); page.docs.forEach((record) => batch.delete(record.ref)); await batch.commit();
        }
      }
      await deleteDoc(reference);
    }),
  };
  return client;
}
