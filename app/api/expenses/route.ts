import { and, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { privateStates } from "../../../db/schema";
import { parseExpenseLedger } from "../../../lib/expenses";
import { databaseError, enforceUserWriteLimit, privateJson, requireApiUser, safeJsonParse } from "../_shared";
import { limitedJsonError, readLimitedJsonBody } from "../../../lib/request-json";

export const MAX_EXPENSE_REQUEST_BYTES = 220_000;
const EXPENSE_WRITES_PER_MINUTE = 20;

const stateId = (email: string) => `expenses:${email.toLowerCase()}`;

export async function GET() {
  const auth = await requireApiUser();
  if (!auth.user) return auth.response;
  try {
    const [row] = await getDb().select().from(privateStates).where(and(eq(privateStates.ownerEmail, auth.user.email), eq(privateStates.kind, "expenses"))).limit(1);
    return privateJson({
      expenses: row ? parseExpenseLedger(safeJsonParse(row.payload)) : null,
    });
  } catch (error) {
    return databaseError(error);
  }
}

export async function PUT(request: Request) {
  const auth = await requireApiUser();
  if (!auth.user) return auth.response;
  const limited = enforceUserWriteLimit("expenses", auth.user.email, EXPENSE_WRITES_PER_MINUTE);
  if (limited) return limited;
  try {
    const parsedBody = await readLimitedJsonBody(request, MAX_EXPENSE_REQUEST_BYTES);
    if (!parsedBody.ok) return limitedJsonError(parsedBody);
    const ledger = parseExpenseLedger(parsedBody.value);
    if (!ledger) return privateJson({ code: "INVALID_LEDGER" }, { status: 400 });
    const payload = JSON.stringify(ledger);
    if (payload.length > 200_000) return privateJson({ code: "LEDGER_TOO_LARGE" }, { status: 400 });
    const now = new Date().toISOString();
    const value = { id: stateId(auth.user.email), ownerEmail: auth.user.email, kind: "expenses", payload, updatedAt: now };
    await getDb().insert(privateStates).values(value).onConflictDoUpdate({ target: privateStates.id, set: value });
    return privateJson({ expenses: ledger, updatedAt: now });
  } catch (error) {
    return databaseError(error);
  }
}
