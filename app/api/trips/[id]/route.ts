import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { trips } from "../../../../db/schema";
import { databaseError, requireApiUser } from "../../_shared";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser();
  if (!auth.user) return auth.response;
  try {
    const { id } = await context.params;
    await getDb().delete(trips).where(and(eq(trips.id, id), eq(trips.ownerEmail, auth.user.email)));
    return new Response(null, { status: 204 });
  } catch (error) {
    return databaseError(error);
  }
}
