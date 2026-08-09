import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(root, "public");

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function pngDimensions(buffer, label) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  invariant(
    buffer.length >= 24 && buffer.subarray(0, 8).equals(signature),
    `${label} is not a PNG file`,
  );
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

async function checkPng(file, width, height) {
  const dimensions = pngDimensions(await readFile(file), path.relative(root, file));
  invariant(
    dimensions.width === width && dimensions.height === height,
    `${path.relative(root, file)} must be ${width}x${height}, got ${dimensions.width}x${dimensions.height}`,
  );
}

function findIcon(manifest, src, purpose) {
  return manifest.icons?.find(
    (icon) => icon.src === src && icon.purpose?.split(/\s+/).includes(purpose),
  );
}

function validateManifest(manifest, label) {
  for (const field of [
    "id",
    "name",
    "short_name",
    "start_url",
    "scope",
    "display",
    "background_color",
    "theme_color",
  ]) {
    invariant(
      typeof manifest[field] === "string" && manifest[field].length > 0,
      `${label} is missing ${field}`,
    );
  }
  invariant(manifest.id === "/", `${label} id must be /`);
  invariant(manifest.start_url === "/", `${label} start_url must be /`);
  invariant(manifest.scope === "/", `${label} scope must be /`);
  invariant(
    ["standalone", "fullscreen", "minimal-ui"].includes(manifest.display),
    `${label} must be installable in app mode`,
  );
  invariant(
    findIcon(manifest, "/icon-192.png", "any"),
    `${label} needs a 192x192 any-purpose PNG icon`,
  );
  invariant(
    findIcon(manifest, "/icon-512.png", "any"),
    `${label} needs a 512x512 any-purpose PNG icon`,
  );
  invariant(
    findIcon(manifest, "/maskable-512.png", "maskable"),
    `${label} needs a separate 512x512 maskable PNG icon`,
  );
}

async function checkLocal() {
  const manifest = await readJson(path.join(publicDir, "manifest.webmanifest"));
  validateManifest(manifest, "public/manifest.webmanifest");

  await Promise.all([
    checkPng(path.join(publicDir, "icon-192.png"), 192, 192),
    checkPng(path.join(publicDir, "icon-512.png"), 512, 512),
    checkPng(path.join(publicDir, "maskable-512.png"), 512, 512),
    checkPng(path.join(publicDir, "apple-touch-icon.png"), 180, 180),
  ]);

  const [serviceWorker, registration, layout, offline] = await Promise.all([
    readFile(path.join(publicDir, "sw.js"), "utf8"),
    readFile(path.join(root, "app", "PwaRegistration.tsx"), "utf8"),
    readFile(path.join(root, "app", "layout.tsx"), "utf8"),
    readFile(path.join(publicDir, "offline.html"), "utf8"),
  ]);

  for (const excludedPath of [
    "/api/",
    "/signin-with-chatgpt",
    "/signout-with-chatgpt",
    "/callback",
  ]) {
    invariant(serviceWorker.includes(excludedPath), `service worker must bypass ${excludedPath}`);
  }
  invariant(
    serviceWorker.includes("/offline.html"),
    "service worker must provide the offline navigation fallback",
  );
  invariant(
    registration.includes('register("/sw.js"'),
    "PWA registration must register /sw.js",
  );
  invariant(
    layout.includes("<PwaRegistration />"),
    "root layout must mount PwaRegistration",
  );
  invariant(
    layout.includes('manifest: "/manifest.webmanifest"'),
    "root metadata must link the web manifest",
  );
  invariant(offline.includes("Together"), "offline fallback must identify the app");
}

async function fetchOk(url, expectedType) {
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
  });
  invariant(response.ok, `${url} returned HTTP ${response.status}`);
  if (expectedType) {
    invariant(
      response.headers.get("content-type")?.includes(expectedType),
      `${url} has unexpected content-type`,
    );
  }
  return response;
}

async function checkLive(input) {
  const parsed = new URL(input);
  invariant(parsed.protocol === "https:", "live PWA validation requires an HTTPS URL");
  const origin = parsed.origin;

  await fetchOk(`${origin}/`);
  const manifestResponse = await fetchOk(`${origin}/manifest.webmanifest`);
  const manifest = await manifestResponse.json();
  validateManifest(manifest, `${origin}/manifest.webmanifest`);
  await fetchOk(`${origin}/sw.js`);

  for (const [src, width, height] of [
    ["/icon-192.png", 192, 192],
    ["/icon-512.png", 512, 512],
    ["/maskable-512.png", 512, 512],
  ]) {
    const response = await fetchOk(`${origin}${src}`, "image/png");
    const dimensions = pngDimensions(
      Buffer.from(await response.arrayBuffer()),
      `${origin}${src}`,
    );
    invariant(
      dimensions.width === width && dimensions.height === height,
      `${origin}${src} has invalid dimensions`,
    );
  }
  return origin;
}

await checkLocal();
const liveUrl = process.argv[2] ?? process.env.TOGETHER_SITE_URL;
const checkedOrigin = liveUrl ? await checkLive(liveUrl) : null;
console.log(
  `PWA checks passed (${checkedOrigin ? `local + ${checkedOrigin}` : "local"}).`,
);
