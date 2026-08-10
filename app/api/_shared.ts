import { getChatGPTUser } from "../chatgpt-auth";

type WriteLimitEntry = { count: number; windowStartedAt: number };

const writeLimits = new Map<string, WriteLimitEntry>();
const MAX_WRITE_LIMIT_ENTRIES = 4_096;

export function privateJson(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "private, no-store");
  return Response.json(body, { ...init, headers });
}

export async function requireApiUser() {
  const user = await getChatGPTUser();
  if (!user) {
    return {
      user: null,
      response: privateJson({ code: "AUTH_REQUIRED" }, { status: 401 }),
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
  const message = error instanceof Error ? error.message : "";
  const unavailable = /no such table|binding `DB` is unavailable|D1_ERROR/i.test(message);
  return privateJson(
    {
      code: unavailable ? "STORAGE_UNAVAILABLE" : "REQUEST_FAILED",
    },
    { status: unavailable ? 503 : 500 },
  );
}

export function enforceUserWriteLimit(
  scope: string,
  userIdentity: string,
  maximumWrites: number,
  windowSeconds = 60,
): Response | null {
  const now = Date.now();
  const windowMs = windowSeconds * 1_000;
  for (const [key, entry] of writeLimits) {
    if (now - entry.windowStartedAt >= windowMs) writeLimits.delete(key);
  }
  while (writeLimits.size >= MAX_WRITE_LIMIT_ENTRIES) {
    const oldestKey = writeLimits.keys().next().value as string | undefined;
    if (!oldestKey) break;
    writeLimits.delete(oldestKey);
  }

  const key = `${scope}:${userIdentity.trim().toLowerCase()}`;
  let entry = writeLimits.get(key);
  if (!entry || now < entry.windowStartedAt || now - entry.windowStartedAt >= windowMs) {
    entry = { count: 0, windowStartedAt: now };
    writeLimits.set(key, entry);
  }
  const resetAt = entry.windowStartedAt + windowMs;
  if (entry.count >= maximumWrites) {
    return privateJson(
      { code: "WRITE_RATE_LIMITED" },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.max(1, Math.ceil((resetAt - now) / 1_000))),
          "X-RateLimit-Limit": String(maximumWrites),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(Math.ceil(resetAt / 1_000)),
        },
      },
    );
  }
  entry.count += 1;
  return null;
}
