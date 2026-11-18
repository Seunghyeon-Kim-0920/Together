// Read-only post-deploy smoke test. No real invitation, account or expense.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const origin = "https://wallet-diary-c2a1a.web.app";
const bundle = new URL("../hosting-dist/", import.meta.url);
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
async function matches(path, artifact) {
  const response = await fetch(origin + path, { redirect: "follow", signal: AbortSignal.timeout(20000) });
  assert.equal(response.status, 200, path);
  assert.equal(new URL(response.url).origin, origin, path);
  const local = await readFile(new URL(artifact, bundle));
  assert.equal(digest(Buffer.from(await response.arrayBuffer())), digest(local), path);
  console.log("verified published bytes:", path);
  return local.toString("utf8");
}

await matches("/", "index.html");
await matches("/delete-account.html", "delete-account.html");
await matches("/.well-known/assetlinks.json", ".well-known/assetlinks.json");
const landing = await matches("/join", "invite/index.html");
const app = await matches("/app/", "app/index.html");
await matches("/app", "app/index.html");
for (const match of app.matchAll(/(?:href|src)="(\/app\/[^"]+)"/g)) await matches(match[1], match[1].slice(1));

// Exercise our verified *local* landing code with synthetic environments.
// No click, network request, Firebase write or new device identity is created.
const js = landing.match(/<script>([\s\S]+?)<\/script>/)?.[1];
assert.ok(js);
const code = "sample-trip." + "a".repeat(64);
for (const [label, ua, expected] of [
  ["iPhone Safari", "Mozilla/5.0 (iPhone) Mobile Safari/604.1", "redirect"],
  ["iPhone in KakaoTalk", "Mozilla/5.0 (iPhone) KAKAOTALK Safari/604.1", "choice"],
  ["Android", "Mozilla/5.0 (Linux; Android 16)", "intent"],
  ["Desktop", "Mozilla/5.0 (Windows NT 10.0)", "choice"],
]) {
  const links = []; let redirect = null; const nodes = new Map();
  const document = {
    documentElement: {}, createElement: () => ({}),
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, { appendChild: a => links.push(a.href) });
      return nodes.get(id);
    },
  };
  vm.runInNewContext(js, { document, navigator: { userAgent: ua, language: "ko" }, location: { hash: "#" + code, href: origin + "/join#" + code, replace: v => { redirect = v; } } }, { timeout: 500 });
  assert.ok(links.includes("/app/#" + code));
  assert.equal(redirect, expected === "redirect" ? "/app/#" + code : null);
  assert.equal(links.some(link => link.startsWith("intent:")), expected === "intent");
  console.log("verified landing logic:", label);
}
