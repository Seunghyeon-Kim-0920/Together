/** Invitation links wrap the existing 24-hour invitation code so a companion can
 * join with one tap. The code travels in the URL fragment, which browsers do
 * not send to the hosting server. Keep these values in step with
 * AndroidManifest.xml, hosting/invite/index.html and hosting/.well-known. */
export const INVITE_LINK_HOST = "wallet-diary-c2a1a.web.app";
export const INVITE_LANDING_PATH = "/join";
export const WEB_COMPANION_PATH = "/app/";
export const ANDROID_PACKAGE_NAME = "com.seunghyeonkim.walletdiary";
export const INVITE_URL_SCHEME = "walletdiary";
export const INSTALL_REFERRER_KEY = "invite";

const MAX_INPUT_LENGTH = 2_000;
const CODE_SOURCE = "[A-Za-z0-9_-]{1,100}\\.[a-f0-9]{64}";
const EXACT_CODE = new RegExp(`^${CODE_SOURCE}$`);
// No lookbehind: older iOS Safari rejects it while parsing the whole bundle.
const EMBEDDED_CODE = new RegExp(`(?:^|[^A-Za-z0-9_-])(${CODE_SOURCE})(?![A-Za-z0-9_-])`);

function safeDecode(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

/** `<tripId>.<64 lowercase hex>` exactly as created by the shared-trip client. */
export function isInviteCode(value: unknown): value is string {
  return typeof value === "string" && EXACT_CODE.test(value);
}

export function inviteTripId(code: string): string | null {
  return isInviteCode(code) ? code.slice(0, code.indexOf(".")) : null;
}

export function buildInviteLink(code: string): string {
  if (!isInviteCode(code)) throw new Error("invalid invite code");
  return `https://${INVITE_LINK_HOST}${INVITE_LANDING_PATH}#${code}`;
}

export function buildWebCompanionLink(code?: string | null): string {
  return `https://${INVITE_LINK_HOST}${WEB_COMPANION_PATH}${isInviteCode(code) ? `#${code}` : ""}`;
}

/** The referrer survives a Play Store installation and is read once on first launch. */
export function buildPlayStoreLink(code?: string | null): string {
  const base = `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE_NAME}`;
  return isInviteCode(code) ? `${base}&referrer=${encodeURIComponent(`${INSTALL_REFERRER_KEY}=${code}`)}` : base;
}

/** Opens the installed app, otherwise falls back to the Play Store listing. */
export function buildAndroidIntentLink(code: string): string {
  if (!isInviteCode(code)) throw new Error("invalid invite code");
  return `intent://join/${code}#Intent;scheme=${INVITE_URL_SCHEME};package=${ANDROID_PACKAGE_NAME};S.browser_fallback_url=${encodeURIComponent(buildPlayStoreLink(code))};end`;
}

/** Accepts a bare code, an invitation link, or a pasted share message that contains one. */
export function parseInviteInput(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw || raw.length > MAX_INPUT_LENGTH) return null;
  if (EXACT_CODE.test(raw)) return raw;
  const candidates = raw.includes("%") ? [safeDecode(raw), raw] : [raw];
  for (const candidate of candidates) {
    const match = EMBEDDED_CODE.exec(candidate);
    if (match) return match[1];
  }
  return null;
}

/** Strict parser for URLs delivered by the Android intent filters. */
export function inviteFromDeepLink(url: unknown): string | null {
  if (typeof url !== "string" || !url || url.length > MAX_INPUT_LENGTH) return null;
  // Custom schemes are split by hand: WebViews before Chromium 130 parse them differently.
  const schemePrefix = `${INVITE_URL_SCHEME}://join/`;
  if (url.startsWith(schemePrefix)) {
    const code = safeDecode(url.slice(schemePrefix.length).split(/[?#]/)[0]);
    return isInviteCode(code) ? code : null;
  }
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  if (parsed.protocol !== "https:" || parsed.hostname !== INVITE_LINK_HOST) return null;
  if (parsed.pathname !== INVITE_LANDING_PATH && !parsed.pathname.startsWith(`${INVITE_LANDING_PATH}/`)) return null;
  const code = safeDecode(parsed.hash.slice(1));
  return isInviteCode(code) ? code : null;
}

/** Only an explicit `invite=` parameter is honoured; campaign text is ignored. */
export function inviteFromInstallReferrer(referrer: unknown): string | null {
  if (typeof referrer !== "string" || !referrer || referrer.length > MAX_INPUT_LENGTH) return null;
  for (const candidate of referrer.includes("%") ? [referrer, safeDecode(referrer)] : [referrer]) {
    let value: string | null = null;
    try { value = new URLSearchParams(candidate).get(INSTALL_REFERRER_KEY); } catch { value = null; }
    if (isInviteCode(value)) return value;
  }
  return null;
}
