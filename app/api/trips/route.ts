import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { trips } from "../../../db/schema";
import { databaseError, requireApiUser, safeJsonParse } from "../_shared";

export async function GET() {
  const auth = await requireApiUser();
  if (!auth.user) return auth.response;
  try {
    const rows = await getDb().select().from(trips).where(eq(trips.ownerEmail, auth.user.email)).orderBy(desc(trips.updatedAt)).limit(50);
    return Response.json({ trips: rows.map((row) => ({ ...row, payload: safeJsonParse(row.payload) })) });
  } catch (error) {
    return databaseError(error);
  }
}

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (!auth.user) return auth.response;
  try {
    const body = (await request.json()) as { name?: unknown; payload?: unknown; id?: unknown };
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 100) : "";
    const serialized = JSON.stringify(body.payload ?? null);
    if (!name || serialized.length > 100_000) return Response.json({ error: "Invalid trip" }, { status: 400 });
    const id = typeof body.id === "string" && /^[a-zA-Z0-9_-]{8,80}$/.test(body.id) ? body.id : crypto.randomUUID();
    const now = new Date().toISOString();
    const existing = await getDb().select({ id: trips.id }).from(trips).where(and(eq(trips.id, id), eq(trips.ownerEmail, auth.user.email))).limit(1);
    if (existing.length) {
      await getDb().update(trips).set({ name, payload: serialized, updatedAt: now }).where(and(eq(trips.id, id), eq(trips.ownerEmail, auth.user.email)));
    } else {
      await getDb().insert(trips).values({ id, ownerEmail: auth.user.email, name, payload: serialized, createdAt: now, updatedAt: now });
    }
    return Response.json({ trip: { id, name, payload: body.payload, createdAt: now, updatedAt: now } }, { status: existing.length ? 200 : 201 });
  } catch (error) {
    return databaseError(error);
  }
}
