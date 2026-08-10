import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { profiles } from "../../../db/schema";
import { databaseError, enforceUserWriteLimit, privateJson, requireApiUser } from "../_shared";
import { limitedJsonError, readLimitedJsonBody } from "../../../lib/request-json";

export const MAX_PROFILE_REQUEST_BYTES = 8_192;
const PROFILE_WRITES_PER_MINUTE = 10;

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
    return privateJson({
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
  const limited = enforceUserWriteLimit("profile", auth.user.email, PROFILE_WRITES_PER_MINUTE);
  if (limited) return limited;
  try {
    const parsedBody = await readLimitedJsonBody(request, MAX_PROFILE_REQUEST_BYTES);
    if (!parsedBody.ok) return limitedJsonError(parsedBody);
    const body = typeof parsedBody.value === "object" && parsedBody.value !== null && !Array.isArray(parsedBody.value)
      ? parsedBody.value as Record<string, unknown>
      : {};
    const displayName = typeof body.displayName === "string" ? body.displayName.trim().slice(0, 80) : "";
    const ageBand = typeof body.ageBand === "string" && ageBands.has(body.ageBand) ? body.ageBand : "unspecified";
    const smoking = typeof body.smoking === "string" && preferenceValues.has(body.smoking) ? body.smoking : "unspecified";
    const drinking = typeof body.drinking === "string" && preferenceValues.has(body.drinking) ? body.drinking : "unspecified";
    const mbti = typeof body.mbti === "string" && mbtiValues.has(body.mbti) ? body.mbti : "unspecified";
    if (!displayName) return privateJson({ code: "DISPLAY_NAME_REQUIRED" }, { status: 400 });
    const value = { email: auth.user.email, displayName, ageBand, smoking, drinking, mbti, updatedAt: new Date().toISOString() };
    await getDb().insert(profiles).values(value).onConflictDoUpdate({ target: profiles.email, set: value });
    return privateJson({ profile: value });
  } catch (error) {
    return databaseError(error);
  }
}
