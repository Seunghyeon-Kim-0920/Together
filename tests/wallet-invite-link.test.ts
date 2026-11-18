import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ANDROID_PACKAGE_NAME, buildAndroidIntentLink, buildInviteLink, buildPlayStoreLink, buildWebCompanionLink, INVITE_LANDING_PATH, INVITE_LINK_HOST, INVITE_URL_SCHEME, inviteFromDeepLink, inviteFromInstallReferrer, inviteTripId, isInviteCode, parseInviteInput, WEB_COMPANION_PATH } from "../src/lib/inviteLink";
import { inviteShareMessage, inviteText, staleConnectionMessage } from "../src/lib/inviteLinkI18n";
import { SHARED_TRAVEL_FIREBASE_CONFIG } from "../src/lib/sharedTravelConfig";
import { sharedText } from "../src/lib/sharedTravelI18n";
import { SUPPORTED_LOCALES } from "../src/lib/types";
import { detectBrowser, isWebCompanionLocation } from "../src/lib/webCompanion";
import { readInstallReferrerInvite } from "../src/lib/nativeInviteLink";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const token = "0123456789abcdef".repeat(4);
const code = `3f0c2a1e-7b6d-4c1a-9e2f-5d8a7b6c4e31.${token}`;

test("invitation codes keep the exact shape created by the shared-trip client", () => {
  assert.equal(isInviteCode(code), true);
  assert.equal(inviteTripId(code), "3f0c2a1e-7b6d-4c1a-9e2f-5d8a7b6c4e31");
  for (const invalid of ["", "trip", `trip.${token.slice(1)}`, `trip.${token}0`, `trip.${token.toUpperCase()}`, `tr ip.${token}`, `.${token}`, `${"a".repeat(101)}.${token}`, `a.b.${token}`]) {
    assert.equal(isInviteCode(invalid), false, invalid);
    assert.equal(inviteTripId(invalid), null, invalid);
  }
  assert.equal(isInviteCode(null), false);
});

test("an invitation link carries the code only in the fragment and round-trips", () => {
  const link = buildInviteLink(code);
  assert.equal(link, `https://${INVITE_LINK_HOST}${INVITE_LANDING_PATH}#${code}`);
  const url = new URL(link);
  assert.equal(url.search, "");
  assert.equal(url.pathname, "/join");
  assert.equal(inviteFromDeepLink(link), code);
  assert.equal(parseInviteInput(link), code);
  assert.throws(() => buildInviteLink("not-a-code"));
  assert.equal(buildWebCompanionLink(code), `https://${INVITE_LINK_HOST}${WEB_COMPANION_PATH}#${code}`);
  assert.equal(buildWebCompanionLink(), `https://${INVITE_LINK_HOST}/app/`);
  assert.equal(buildWebCompanionLink("bad"), `https://${INVITE_LINK_HOST}/app/`);
});

test("pasted codes, links and whole share messages resolve to the same code", () => {
  assert.equal(parseInviteInput(`  ${code}\n`), code);
  for (const locale of SUPPORTED_LOCALES) {
    const message = inviteShareMessage(locale, "뉴욕 여행 · NYC", buildInviteLink(code));
    assert.ok(message.includes(buildInviteLink(code)), locale);
    assert.equal(parseInviteInput(message), code, locale);
  }
  assert.equal(parseInviteInput(`${buildInviteLink(code)}.`), code);
  assert.equal(parseInviteInput(`walletdiary://join/${code}`), code);
  assert.equal(parseInviteInput(`invite%3D${code}`), code);
  assert.equal(parseInviteInput(`${sharedText("ko", "code")}: ${code}`), code);
  assert.equal(parseInviteInput(buildAndroidIntentLink(code)), code);
  for (const invalid of ["", "   ", "https://wallet-diary-c2a1a.web.app/join", `x${"y".repeat(2_100)}`, `trip.${token.slice(2)}`, `trip.${token}abc`, 42, null, undefined]) assert.equal(parseInviteInput(invalid), null);
});

test("deep links are accepted only from the invitation host, path and scheme", () => {
  assert.equal(inviteFromDeepLink(`https://${INVITE_LINK_HOST}/join/#${code}`), code);
  assert.equal(inviteFromDeepLink(`https://${INVITE_LINK_HOST}/join#${encodeURIComponent(code)}`), code);
  assert.equal(inviteFromDeepLink(`${INVITE_URL_SCHEME}://join/${code}`), code);
  assert.equal(inviteFromDeepLink(`${INVITE_URL_SCHEME}://join/${code}?from=landing`), code);
  for (const rejected of [
    `https://example.com/join#${code}`, `http://${INVITE_LINK_HOST}/join#${code}`, `https://${INVITE_LINK_HOST}/joined#${code}`,
    `https://${INVITE_LINK_HOST}/app/#${code}`, `https://${INVITE_LINK_HOST}/join?code=${code}`, `https://${INVITE_LINK_HOST}/join#${code}x`,
    `https://${INVITE_LINK_HOST}.evil.example/join#${code}`, `${INVITE_URL_SCHEME}://other/${code}`, `${INVITE_URL_SCHEME}://join/`, "javascript:alert(1)", "", 7, null,
  ]) assert.equal(inviteFromDeepLink(rejected), null, String(rejected));
});

test("the Play Store referrer hands over only an explicit invite parameter", () => {
  const store = new URL(buildPlayStoreLink(code));
  assert.equal(store.origin + store.pathname, "https://play.google.com/store/apps/details");
  assert.equal(store.searchParams.get("id"), ANDROID_PACKAGE_NAME);
  const referrer = store.searchParams.get("referrer");
  assert.equal(referrer, `invite=${code}`);
  assert.equal(inviteFromInstallReferrer(referrer), code);
  assert.equal(inviteFromInstallReferrer(`utm_source=share&invite=${code}&utm_medium=link`), code);
  assert.equal(inviteFromInstallReferrer(`invite%3D${code}`), code);
  assert.equal(buildPlayStoreLink(), `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE_NAME}`);
  assert.equal(buildPlayStoreLink("bad"), `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE_NAME}`);
  for (const organic of ["utm_source=google-play&utm_medium=organic", "", `note=${code}`, `invite=${code}x`, "invite=", "x".repeat(2_100), undefined, 3]) assert.equal(inviteFromInstallReferrer(organic), null, String(organic));
});

test("the Android intent link opens the app and falls back to the store with the invitation", () => {
  const link = buildAndroidIntentLink(code);
  assert.ok(link.startsWith(`intent://join/${code}#Intent;scheme=${INVITE_URL_SCHEME};package=${ANDROID_PACKAGE_NAME};`));
  assert.ok(link.endsWith(";end"));
  const fallback = /S\.browser_fallback_url=([^;]+);/.exec(link)?.[1];
  assert.equal(decodeURIComponent(fallback ?? ""), buildPlayStoreLink(code));
  assert.throws(() => buildAndroidIntentLink("bad"));
});

test("the referrer bridge waits for its definitive native response without a competing JS deadline", async () => {
  let resolve!: (result: { referrer: string }) => void;
  let settled = false;
  const result = readInstallReferrerInvite(() => new Promise((done) => { resolve = done; })).then((value) => { settled = true; return value; });
  await Promise.resolve();
  assert.equal(settled, false);
  resolve({ referrer: `invite=${code}` });
  assert.equal(await result, code);
  assert.equal(await readInstallReferrerInvite(async () => ({ referrer: "" })), null);
  assert.equal(await readInstallReferrerInvite(async () => { throw new Error("unavailable"); }), null);
  const bridge = read("../src/lib/nativeInviteLink.ts");
  assert.doesNotMatch(bridge, /Promise\.race|setTimeout/);
});

test("native referrer timeout is bounded, closes the service and never consumes a missing answer", () => {
  const plugin = read("../android/app/src/main/java/com/seunghyeonkim/walletdiary/InviteLinkPlugin.java");
  assert.match(plugin, /REFERRER_TIMEOUT_MS = 8000L/);
  assert.match(plugin, /timeoutHandler\.postDelayed\(timeout, REFERRER_TIMEOUT_MS\)/);
  const timeout = /final Runnable timeout = \(\) -> \{([\s\S]*?)\n {8}\};/.exec(plugin)?.[1] ?? "";
  assert.match(timeout, /finished\.compareAndSet\(false, true\)/);
  assert.match(timeout, /closeClient\(client\)/);
  assert.match(timeout, /resolveReferrer\(call, ""\)/);
  assert.doesNotMatch(timeout, /REFERRER_CONSUMED|putBoolean/);
  assert.match(plugin, /onInstallReferrerSetupFinished\(int responseCode\) \{\s*if \(!finished\.compareAndSet\(false, true\)\) return;/);
  assert.match(plugin, /if \(definitive\) preferences\.edit\(\)\.putBoolean\(REFERRER_CONSUMED, true\)/);
});

test("the web companion is limited to the hosted /app/ path outside the native app", () => {
  assert.equal(isWebCompanionLocation("/app/", false), true);
  assert.equal(isWebCompanionLocation("/app", false), true);
  assert.equal(isWebCompanionLocation("/app/index.html", false), true);
  assert.equal(isWebCompanionLocation("/", false), false);
  assert.equal(isWebCompanionLocation("/apple", false), false);
  assert.equal(isWebCompanionLocation("/app/", true), false);
});

test("browser detection separates Android, iOS and messenger in-app browsers", () => {
  const iphoneSafari = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
  assert.deepEqual(detectBrowser(iphoneSafari), { android: false, ios: true, inApp: null });
  assert.deepEqual(detectBrowser(`${iphoneSafari} KAKAOTALK 25.9.0`), { android: false, ios: true, inApp: "kakaotalk" });
  assert.deepEqual(detectBrowser("Mozilla/5.0 (Linux; Android 15; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36"), { android: true, ios: false, inApp: null });
  assert.deepEqual(detectBrowser("Mozilla/5.0 (Linux; Android 15; SM-S928N; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36 Instagram 400.0"), { android: true, ios: false, inApp: "other" });
  assert.deepEqual(detectBrowser("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15", "MacIntel", 5), { android: false, ios: true, inApp: null });
  assert.deepEqual(detectBrowser("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36", "Win32", 0), { android: false, ios: false, inApp: null });
});

test("invitation texts exist in every language and name the real panel controls", () => {
  const keys = ["link", "createLink", "revokeLink", "linkHelp", "shareLink", "copyLink", "copied", "copyFailed", "codeFallback", "codeOrLink", "sheetTitle", "sheetIntro", "nameHelp", "joinShort", "joining", "joined", "already", "open", "later", "expired", "offline", "tooMany", "webBadge", "webTitle", "webNoInviteTitle", "webNoInvite", "webStore", "webAndroid", "webStorage", "webInApp", "webOpenExternal"] as const;
  for (const locale of SUPPORTED_LOCALES) {
    for (const key of keys) assert.ok(inviteText(locale, key).trim(), `${locale}:${key}`);
    const stale = staleConnectionMessage(locale);
    assert.ok(stale.includes(sharedText(locale, "title")) && stale.includes(sharedText(locale, "disconnect")), locale);
    assert.ok(!stale.includes("{"), locale);
  }
  for (const key of keys) for (const locale of ["en", "fr"] as const) assert.ok(!/[가-힣]/u.test(inviteText(locale, key)), `${locale}:${key}`);
});

test("the link host, Android filters, landing page and asset links describe the same app", () => {
  assert.equal(INVITE_LINK_HOST, `${SHARED_TRAVEL_FIREBASE_CONFIG?.projectId}.web.app`);
  const manifest = read("../android/app/src/main/AndroidManifest.xml");
  assert.match(manifest, /<intent-filter android:autoVerify="true">[\s\S]*?android:scheme="https"[\s\S]*?android:host="wallet-diary-c2a1a\.web\.app"[\s\S]*?android:pathPrefix="\/join"[\s\S]*?<\/intent-filter>/);
  assert.match(manifest, new RegExp(`android:scheme="${INVITE_URL_SCHEME}"\\s+android:host="join"`));
  assert.equal(read("../android/app/src/main/res/values/strings.xml").includes(ANDROID_PACKAGE_NAME), true);
  const plugin = read("../android/app/src/main/java/com/seunghyeonkim/walletdiary/InviteLinkPlugin.java");
  assert.match(plugin, /@CapacitorPlugin\(name = "InviteLink"\)/);
  assert.match(plugin, /notifyListeners\("inviteLink", event, true\)/);
  assert.match(read("../android/app/src/main/java/com/seunghyeonkim/walletdiary/MainActivity.java"), /registerPlugin\(InviteLinkPlugin\.class\)/);
  assert.match(read("../android/app/build.gradle"), /com\.android\.installreferrer:installreferrer:/);
  const landing = read("../hosting/invite/index.html");
  for (const expected of [`"${ANDROID_PACKAGE_NAME}"`, `"${INVITE_URL_SCHEME}"`, `"${WEB_COMPANION_PATH}"`, "[A-Za-z0-9_-]{1,100}\\.[a-f0-9]{64}", "S.browser_fallback_url=", "referrer="]) assert.ok(landing.includes(expected), expected);
  assert.doesNotMatch(landing, /<script[^>]+src=|<link[^>]+href="https?:|googletagmanager|analytics/i);
  const links = JSON.parse(read("../hosting/.well-known/assetlinks.json")) as { relation: string[]; target: { namespace: string; package_name: string; sha256_cert_fingerprints: string[] } }[];
  assert.equal(links.length, 1);
  assert.deepEqual(links[0].relation, ["delegate_permission/common.handle_all_urls"]);
  assert.equal(links[0].target.namespace, "android_app");
  assert.equal(links[0].target.package_name, ANDROID_PACKAGE_NAME);
  assert.ok(links[0].target.sha256_cert_fingerprints.length >= 1);
  for (const fingerprint of links[0].target.sha256_cert_fingerprints) assert.match(fingerprint, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
});

test("the shared-trip panel shares the link and still accepts a pasted code", () => {
  const panel = read("../src/components/SharedTravelPanel.tsx");
  assert.match(panel, /inviteShareMessage\(locale, ledger\.title, buildInviteLink\(inviteCode\)\)/);
  assert.match(panel, /parseInviteInput\(inviteInput\) \?\? inviteInput\.trim\(\)/);
});

test("hosting serves the landing page at /join and deploys the asset links file", () => {
  const hosting = JSON.parse(read("../firebase.json")).hosting as { public: string; ignore: string[]; rewrites: unknown; redirects: unknown };
  assert.equal(hosting.public, "hosting-dist");
  assert.ok(!hosting.ignore.some((pattern) => pattern.includes(".*")), "dot directories such as .well-known must be deployed");
  assert.deepEqual(hosting.rewrites, [{ source: "/join", destination: "/invite/index.html" }, { source: "/join/**", destination: "/invite/index.html" }, { source: "/app", destination: "/app/index.html" }]);
  // Hosting treats /app and /app/ as the same glob, so redirecting one to the other loops.
  assert.equal(hosting.redirects, undefined);
  const assembly = read("../scripts/build-hosting.mjs");
  for (const mapping of ['["hosting/invite/index.html", "invite/index.html"]', '["hosting/.well-known/assetlinks.json", ".well-known/assetlinks.json"]', '["public/brand/wallet-diary-mark.png", "brand/wallet-diary-mark.png"]']) assert.ok(assembly.includes(mapping), mapping);
  const scripts = JSON.parse(read("../package.json")).scripts as Record<string, string>;
  assert.match(scripts["build:web"], /vite build --base=\/app\/ --outDir hosting-dist\/app/);
  assert.equal(scripts["build:hosting"], "npm run build:web && node scripts/build-hosting.mjs");
  assert.match(read("../.gitignore"), /^\/hosting-dist\/\r?$/m);
});

test("the privacy policy discloses invitation links, the web version and rate lookups in every language", () => {
  const policy = read("../docs/privacy/index.html");
  for (const expected of ["wallet-diary-c2a1a.web.app/join", "wallet-diary-c2a1a.web.app/app/", "api.frankfurter.dev", "cdn.jsdelivr.net", "currency-api.pages.dev"]) assert.equal(policy.split(expected).length - 1, 3, expected);
  for (const heading of ["5a. 환율 조회", "5a. Exchange-rate lookup", "5a. Consultation des taux de change"]) assert.ok(policy.includes(heading), heading);
});
