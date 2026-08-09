import { and, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { privateStates } from "../../../db/schema";
import { databaseError, requireApiUser, safeJsonParse } from "../_shared";

const stateId = (email: string) => `expenses:${email.toLowerCase()}`;

export async function GET() {
  const auth = await requireApiUser();
  if (!auth.user) return auth.response;
  try {
    const [row] = await getDb().select().from(privateStates).where(and(eq(privateStates.ownerEmail, auth.user.email), eq(privateStates.kind, "expenses"))).limit(1);
    return Response.json({ expenses: row ? safeJsonParse(row.payload) : null });
  } catch (error) {
    return databaseError(error);
  }
}

export async function PUT(request: Request) {
  const auth = await requireApiUser();
  if (!auth.user) return auth.response;
  try {
    const body = await request.json();
    const payload = JSON.stringify(body);
    if (payload.length > 200_000) return Response.json({ error: "Expense ledger is too large" }, { status: 400 });
    const now = new Date().toISOString();
    const value = { id: stateId(auth.user.email), ownerEmail: auth.user.email, kind: "expenses", payload, updatedAt: now };
    await getDb().insert(privateStates).values(value).onConflictDoUpdate({ target: privateStates.id, set: value });
    return Response.json({ expenses: body, updatedAt: now });
  } catch (error) {
    return databaseError(error);
  }
}
