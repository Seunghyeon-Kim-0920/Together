import { Capacitor } from "@capacitor/core";
import { parseInviteInput, WEB_COMPANION_PATH } from "./inviteLink";

/** The hosted browser build under /app/ only joins shared trips by invitation.
 * Private ledgers are not offered there: browser storage can be evicted, and
 * only shared trips can be restored from the server. */
export function isWebCompanionLocation(pathname: string, native: boolean): boolean {
  return !native && (pathname === WEB_COMPANION_PATH.slice(0, -1) || pathname.startsWith(WEB_COMPANION_PATH));
}

export function isWebCompanion(): boolean {
  return typeof window !== "undefined" && isWebCompanionLocation(window.location.pathname, Capacitor.isNativePlatform());
}

/** The invitation stays in the fragment until the join succeeds, so a reload keeps it. */
export function readLocationInvite(): string | null {
  if (typeof window === "undefined") return null;
  const fragment = window.location.hash.slice(1);
  return fragment ? parseInviteInput(fragment) : null;
}

export function clearLocationInvite(): void {
  if (typeof window === "undefined" || !window.location.hash) return;
  try { window.history.replaceState(null, "", window.location.pathname + window.location.search); } catch { /* The fragment is harmless if history is unavailable. */ }
}

export interface BrowserEnvironment {
  readonly android: boolean;
  readonly ios: boolean;
  /** Messenger and social in-app browsers keep their own storage, separate from the system browser. */
  readonly inApp: "kakaotalk" | "other" | null;
}

export function detectBrowser(userAgent: string, platform = "", maxTouchPoints = 0): BrowserEnvironment {
  const android = /Android/i.test(userAgent);
  const ios = /iPhone|iPad|iPod/i.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1);
  const inApp = /KAKAOTALK/i.test(userAgent) ? "kakaotalk" as const
    : /Instagram|FBAN|FBAV|FB_IAB|\bLine\/|NAVER\(inapp|DaumApps|Twitter|TikTok|Snapchat|;\s*wv\)/i.test(userAgent) ? "other" as const : null;
  return { android, ios, inApp };
}

export function currentBrowser(): BrowserEnvironment {
  if (typeof navigator === "undefined") return { android: false, ios: false, inApp: null };
  return detectBrowser(navigator.userAgent ?? "", navigator.platform ?? "", navigator.maxTouchPoints ?? 0);
}

/** Ask the browser not to evict the anonymous connection under storage pressure. Best effort. */
export function requestPersistentStorage(): void {
  try { void navigator.storage?.persist?.().catch(() => undefined); } catch { /* Unsupported browsers keep the default policy. */ }
}
