#!/usr/bin/env node
// Assembles the Firebase Hosting root in hosting-dist/.
//
//   /                              privacy policy            (docs/privacy/index.html)
//   /delete-account.html           deletion request page     (docs/privacy/delete-account.html)
//   /join  →  /invite/index.html   invitation landing page   (hosting/invite/index.html)
//   /app/                          browser version for invited companions (npm run build:web)
//   /.well-known/assetlinks.json   Android App Links verification
//
// Run through `npm run build:hosting`; `firebase deploy --only hosting` does that by itself.
import { cp, mkdir, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "hosting-dist");

/** Source file → served path. The privacy pages keep their public addresses. */
const HOSTING_FILES = [
  ["docs/privacy/index.html", "index.html"],
  ["docs/privacy/delete-account.html", "delete-account.html"],
  ["hosting/invite/index.html", "invite/index.html"],
  ["hosting/.well-known/assetlinks.json", ".well-known/assetlinks.json"],
  ["public/brand/wallet-diary-mark.png", "brand/wallet-diary-mark.png"],
];

async function exists(file) {
  try { return (await stat(file)).isFile(); } catch { return false; }
}

async function main() {
  if (!await exists(path.join(output, "app", "index.html"))) {
    throw new Error("hosting-dist/app is missing. Run `npm run build:hosting`, which builds the web version first.");
  }
  const links = JSON.parse(await readFile(path.join(root, "hosting/.well-known/assetlinks.json"), "utf8"));
  const fingerprints = links?.[0]?.target?.sha256_cert_fingerprints;
  if (!Array.isArray(links) || links.length !== 1 || links[0]?.target?.package_name !== "com.seunghyeonkim.walletdiary"
    || !Array.isArray(fingerprints) || !fingerprints.length || fingerprints.some((value) => !/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(value))) {
    throw new Error("hosting/.well-known/assetlinks.json is not a valid Digital Asset Links statement for this app.");
  }
  for (const [source, served] of HOSTING_FILES) {
    const from = path.join(root, source);
    if (!await exists(from)) throw new Error(`Missing hosting source: ${source}`);
    const to = path.join(output, served);
    await mkdir(path.dirname(to), { recursive: true });
    await cp(from, to);
    console.log(`${source} -> /${served}`);
  }
  // Fail closed if an unrelated file (including a dotfile or junction) ever
  // lands in this deploy directory. Do not delete it automatically.
  const pages = new Set([...HOSTING_FILES.map(([, served]) => served), "app/index.html", "app/brand/wallet-diary-mark.png"]);
  async function validate(dir, prefix = "") {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      const key = prefix + item.name;
      if (item.isSymbolicLink()) throw new Error("Link in Hosting output; deployment stopped.");
      if (item.isDirectory()) { await validate(path.join(dir, item.name), key + "/"); continue; }
      const asset = /^app\/assets\/[\w.-]+-[\w-]{8}\.(?:css|m?js)$/.test(key);
      const pdf = /^app\/pdf-resources\/(?:cmaps|standard_fonts|wasm)\/(?:LICENSE(?:_[A-Z0-9_]+)?|[\w.-]+\.(?:bcmap|pfb|ttf|wasm|js))$/.test(key);
      if (!item.isFile() || (!pages.has(key) && !asset && !pdf)) throw new Error("Unexpected file in Hosting output; deployment stopped.");
    }
  }
  await validate(output);
  console.log(`Hosting root ready: ${path.relative(root, output)}`);
  if (fingerprints.length < 2) {
    console.warn("\nNote: assetlinks.json lists one certificate (the upload key). Apps installed from Google Play are signed"
      + "\nwith the Play app signing key. Add its SHA-256 fingerprint (Play Console > App integrity > App signing) so"
      + "\ninvitation links open the installed app directly. Until then the link opens the landing page instead.");
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
