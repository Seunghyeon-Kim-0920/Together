import { getChatGPTUser } from "../chatgpt-auth";

export async function requireApiUser() {
  const user = await getChatGPTUser();
  if (!user) {
    return {
      user: null,
      response: Response.json({ error: "Authentication required" }, { status: 401 }),
    } as const;
  }
  return { user, response: null } as const;
}

export function safeJsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function databaseError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected database error";
  const unavailable = /no such table|binding `DB` is unavailable|D1_ERROR/i.test(message);
  return Response.json(
    {
      error: unavailable
        ? "Private storage is still being prepared. Please retry shortly."
        : "The request could not be completed.",
    },
    { status: unavailable ? 503 : 500 },
  );
}
