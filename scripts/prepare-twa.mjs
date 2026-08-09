import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const androidDir = path.join(root, "android");

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

const siteInput = process.env.TOGETHER_SITE_URL;
invariant(
  siteInput,
  "TOGETHER_SITE_URL is required (for example, https://together.example.com)",
);
const site = new URL(siteInput);
invariant(site.protocol === "https:", "TOGETHER_SITE_URL must use HTTPS");
const origin = site.origin;

const packageId = process.env.ANDROID_PACKAGE_ID ?? "com.together.travel";
invariant(
  /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(packageId),
  "ANDROID_PACKAGE_ID is not a valid lowercase Android application ID",
);

const packageJson = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
);
const versionName = process.env.ANDROID_VERSION_NAME ?? packageJson.version;
invariant(
  /^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/.test(versionName),
  "ANDROID_VERSION_NAME is invalid",
);
const versionCode = Number.parseInt(
  process.env.ANDROID_VERSION_CODE ?? process.env.GITHUB_RUN_NUMBER ?? "1",
  10,
);
invariant(
  Number.isSafeInteger(versionCode) &&
    versionCode > 0 &&
    versionCode <= 2_100_000_000,
  "ANDROID_VERSION_CODE must be a positive Android version code",
);
const keyAlias = process.env.ANDROID_KEY_ALIAS ?? "together-release";
invariant(
  /^[A-Za-z0-9._-]+$/.test(keyAlias),
  "ANDROID_KEY_ALIAS contains unsupported characters",
);

const manifestResponse = await fetch(`${origin}/manifest.webmanifest`, {
  signal: AbortSignal.timeout(20_000),
});
invariant(
  manifestResponse.ok,
  `Unable to load deployed manifest: HTTP ${manifestResponse.status}`,
);
const webManifest = await manifestResponse.json();
invariant(
  webManifest.start_url === "/" && webManifest.scope === "/",
  "The deployed PWA must have root start_url and scope",
);

const template = JSON.parse(
  await readFile(path.join(androidDir, "twa-manifest.template.json"), "utf8"),
);
const twaManifest = {
  ...template,
  packageId,
  host: site.host,
  name: webManifest.name ?? template.name,
  launcherName: webManifest.short_name ?? template.launcherName,
  themeColor: webManifest.theme_color ?? template.themeColor,
  backgroundColor: webManifest.background_color ?? template.backgroundColor,
  iconUrl: `${origin}/icon-512.png`,
  maskableIconUrl: `${origin}/maskable-512.png`,
  signingKey: { path: "./release.keystore", alias: keyAlias },
  appVersionCode: versionCode,
  appVersion: versionName,
  webManifestUrl: `${origin}/manifest.webmanifest`,
  fullScopeUrl: `${origin}/`,
};

await mkdir(androidDir, { recursive: true });
await writeFile(
  path.join(androidDir, "twa-manifest.json"),
  `${JSON.stringify(twaManifest, null, 2)}\n`,
  "utf8",
);
console.log(
  `Prepared Android TWA manifest for ${origin} (${packageId}, ${versionName}+${versionCode}).`,
);
