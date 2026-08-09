import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { profiles } from "../../../db/schema";
import { databaseError, requireApiUser } from "../_shared";

const ageBands = new Set(["unspecified", "teens", "20s", "30s", "40s", "50s", "60s", "70plus"]);
const preferenceValues = new Set(["unspecified", "yes", "no"]);
const mbtiValues = new Set([
  "unspecified", "INTJ", "INTP", "ENTJ", "ENTP", "INFJ", "INFP", "ENFJ", "ENFP",
  "ISTJ", "ISFJ", "ESTJ", "ESFJ", "ISTP", "ISFP", "ESTP", "ESFP",
]);

export async function GET() {
  const auth = await requireApiUser();
  if (!auth.user) return auth.response;
  try {
    const [profile] = await getDb().select().from(profiles).where(eq(profiles.email, auth.user.email)).limit(1);
    return Response.json({
      profile: profile ?? {
        email: auth.user.email,
        displayName: auth.user.fullName ?? auth.user.displayName,
        ageBand: "unspecified",
        smoking: "unspecified",
        drinking: "unspecified",
        mbti: "unspecified",
      },
    });
  } catch (error) {
    return databaseError(error);
  }
}

export async function PUT(request: Request) {
  const auth = await requireApiUser();
  if (!auth.user) return auth.response;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const displayName = typeof body.displayName === "string" ? body.displayName.trim().slice(0, 80) : "";
    const ageBand = typeof body.ageBand === "string" && ageBands.has(body.ageBand) ? body.ageBand : "unspecified";
    const smoking = typeof body.smoking === "string" && preferenceValues.has(body.smoking) ? body.smoking : "unspecified";
    const drinking = typeof body.drinking === "string" && preferenceValues.has(body.drinking) ? body.drinking : "unspecified";
    const mbti = typeof body.mbti === "string" && mbtiValues.has(body.mbti) ? body.mbti : "unspecified";
    if (!displayName) return Response.json({ error: "Display name is required" }, { status: 400 });
    const value = { email: auth.user.email, displayName, ageBand, smoking, drinking, mbti, updatedAt: new Date().toISOString() };
    await getDb().insert(profiles).values(value).onConflictDoUpdate({ target: profiles.email, set: value });
    return Response.json({ profile: value });
  } catch (error) {
    return databaseError(error);
  }
}
