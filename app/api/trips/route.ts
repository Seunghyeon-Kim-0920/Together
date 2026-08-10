import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { trips } from "../../../db/schema";
import { parseRouteSnapshot } from "../../../lib/route-snapshot";
import { databaseError, enforceUserWriteLimit, privateJson, requireApiUser, safeJsonParse } from "../_shared";
import { limitedJsonError, readLimitedJsonBody } from "../../../lib/request-json";

export const MAX_SAVED_TRIPS_PER_USER = 50;
export const MAX_TRIP_REQUEST_BYTES = 120_000;
const TRIP_WRITES_PER_MINUTE = 10;

async function tripSlotId(email: string, slot: number): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(email.trim().toLowerCase()),
  );
  const ownerHash = Array.from(new Uint8Array(digest).slice(0, 16), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `trip_${ownerHash}_${slot}`;
}

export async function GET() {
  const auth = await requireApiUser();
  if (!auth.user) return auth.response;
  try {
    const rows = await getDb().select().from(trips).where(eq(trips.ownerEmail, auth.user.email)).orderBy(desc(trips.updatedAt)).limit(50);
    return privateJson({
      trips: rows.map((row) => ({
        ...row,
        payload: parseRouteSnapshot(safeJsonParse(row.payload)),
      })),
    });
  } catch (error) {
    return databaseError(error);
  }
}

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (!auth.user) return auth.response;
  const limited = enforceUserWriteLimit("trips", auth.user.email, TRIP_WRITES_PER_MINUTE);
  if (limited) return limited;
  try {
    const parsedBody = await readLimitedJsonBody(request, MAX_TRIP_REQUEST_BYTES);
    if (!parsedBody.ok) return limitedJsonError(parsedBody);
    if (typeof parsedBody.value !== "object" || parsedBody.value === null || Array.isArray(parsedBody.value)) {
      return privateJson({ code: "INVALID_TRIP" }, { status: 400 });
    }
    const body = parsedBody.value as { name?: unknown; payload?: unknown; id?: unknown };
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 100) : "";
    const snapshot = parseRouteSnapshot(body.payload);
    const serialized = JSON.stringify(snapshot);
    if (!name || !snapshot || serialized.length > 100_000) return privateJson({ code: "INVALID_TRIP" }, { status: 400 });
    const requestedId = typeof body.id === "string" && /^[a-zA-Z0-9_-]{8,80}$/.test(body.id) ? body.id : null;
    const now = new Date().toISOString();
    const existing = requestedId
      ? await getDb().select({ id: trips.id }).from(trips).where(and(eq(trips.id, requestedId), eq(trips.ownerEmail, auth.user.email))).limit(1)
      : [];
    if (existing.length) {
      await getDb().update(trips).set({ name, payload: serialized, updatedAt: now }).where(and(eq(trips.id, requestedId as string), eq(trips.ownerEmail, auth.user.email)));
      return privateJson({ trip: { id: requestedId, name, payload: snapshot, createdAt: now, updatedAt: now } });
    } else {
      const ownedTrips = await getDb().select({ id: trips.id }).from(trips).where(eq(trips.ownerEmail, auth.user.email)).limit(MAX_SAVED_TRIPS_PER_USER);
      if (ownedTrips.length >= MAX_SAVED_TRIPS_PER_USER) {
        return privateJson({ code: "TRIP_LIMIT_REACHED", limit: MAX_SAVED_TRIPS_PER_USER }, { status: 409 });
      }
      const existingIds = new Set(ownedTrips.map((trip) => trip.id));
      let id = "";
      for (let slot = 0; slot < MAX_SAVED_TRIPS_PER_USER; slot += 1) {
        const candidate = await tripSlotId(auth.user.email, slot);
        if (!existingIds.has(candidate)) {
          id = candidate;
          break;
        }
      }
      if (!id) return privateJson({ code: "TRIP_LIMIT_REACHED", limit: MAX_SAVED_TRIPS_PER_USER }, { status: 409 });
      try {
        await getDb().insert(trips).values({ id, ownerEmail: auth.user.email, name, payload: serialized, createdAt: now, updatedAt: now });
      } catch (error) {
        if (/unique|constraint/i.test(error instanceof Error ? error.message : "")) {
          return privateJson({ code: "TRIP_WRITE_CONFLICT" }, { status: 409 });
        }
        throw error;
      }
      return privateJson({ trip: { id, name, payload: snapshot, createdAt: now, updatedAt: now } }, { status: 201 });
    }
  } catch (error) {
    return databaseError(error);
  }
}
