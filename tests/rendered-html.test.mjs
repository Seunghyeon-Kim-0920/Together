import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let productionServer;
let baseUrl;
let serverOutput = "";

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function reservePort() {
  const socket = createServer();
  socket.unref();
  await new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", resolve);
  });
  const address = socket.address();
  assert.ok(address && typeof address === "object");
  await new Promise((resolve, reject) => socket.close((error) => (error ? reject(error) : resolve())));
  return address.port;
}

before(async () => {
  const port = await reservePort();
  baseUrl = `http://127.0.0.1:${port}`;
  const cli = path.join(root, "node_modules", "vinext", "dist", "cli.js");
  productionServer = spawn(
    process.execPath,
    [cli, "dev", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: root,
      env: { ...process.env, NODE_ENV: "development" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );

  const record = (chunk) => {
    serverOutput = `${serverOutput}${chunk}`.slice(-12_000);
  };
  productionServer.stdout.on("data", record);
  productionServer.stderr.on("data", record);

  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (productionServer.exitCode !== null || productionServer.signalCode !== null) {
      throw new Error(`vinext dev exited before becoming ready:\n${serverOutput}`);
    }
    try {
      const response = await fetch(baseUrl, { signal: AbortSignal.timeout(1_000) });
      if (response.status < 500) return;
    } catch {
      // The server is still starting.
    }
    await delay(250);
  }
  throw new Error(`vinext dev did not become ready:\n${serverOutput}`);
}, { timeout: 90_000 });

after(async () => {
  if (
    productionServer &&
    productionServer.exitCode === null &&
    productionServer.signalCode === null
  ) {
    productionServer.kill();
    await Promise.race([once(productionServer, "exit"), delay(5_000)]);
  }
});

async function render(pathname = "/", headers = {}) {
  return fetch(`${baseUrl}${pathname}`, {
    headers: { accept: "text/html", ...headers },
    signal: AbortSignal.timeout(10_000),
  });
}

test("server-renders the Together travel product", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(
    html,
    /<title>Together \| 공개 운행표 기반 다도시 여행<\/title>/i,
  );
  assert.match(html, /Together/);
  assert.match(html, /공개 운행표로 확인하는 여러 도시 동선\./);
  assert.match(html, /가장 빠른 동선 찾기/);
  assert.doesNotMatch(html, /계획 모델 추정치|같은 나라와 가까운 유럽 도시|철도·버스는 선택한 출발일|항공만 공항 이동/);
  assert.match(html, /eiffel-paris-hero/);
  assert.match(html, /가계부/);
  assert.doesNotMatch(
    html,
    /codex-preview|react-loading-skeleton|Your site is taking shape/i,
  );
});

test("ships installable metadata and device-only storage without login UI", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  const manifestHref = html.match(/<link rel="manifest" href="([^"]+)"/i)?.[1];
  assert.ok(manifestHref, "rendered HTML must include a web manifest link");
  assert.equal(new URL(manifestHref, baseUrl).pathname, "/manifest.webmanifest");
  assert.match(html, /내 여행/);
  assert.doesNotMatch(html, /로그인|계정|signin-with-chatgpt|signout-with-chatgpt/i);
  const deviceTrips = await fetch(`${baseUrl}/api/trips`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(deviceTrips.status, 401, "legacy account API must not be used by the guest UI");
});

test("server rendering and manifest honor every selected language without a fallback-language flash", async () => {
  const cases = [
    ["ko", "ko-KR", "공개 운행표로 확인하는 여러 도시 동선."],
    ["en", "en-US", "Multi-city routes verified by published timetables."],
    ["fr", "fr-FR", "Des itinéraires intervilles vérifiés par les horaires publiés."],
    ["ja", "ja-JP", "公開時刻表で確認する複数都市ルート。"],
    ["zh", "zh-CN", "通过公开时刻表核验多城市路线。"],
  ];
  for (const [locale, languageTag, routeTitle] of cases) {
    const cookie = `together-locale=${locale}`;
    const response = await render("/", { cookie });
    const html = await response.text();
    assert.match(html, new RegExp(`<html[^>]+lang="${languageTag}"`));
    assert.ok(html.includes(routeTitle), `${locale} route title`);
    const manifestResponse = await fetch(`${baseUrl}/manifest.webmanifest`, { headers: { cookie } });
    assert.equal(manifestResponse.status, 200);
    assert.match(manifestResponse.headers.get("content-type") ?? "", /application\/manifest\+json/);
    const manifest = await manifestResponse.json();
    assert.equal(manifest.lang, locale);
    assert.equal(manifest.short_name, "Together");
  }
});

test("serves Android Digital Asset Links at the required origin path", async () => {
  const response = await fetch(`${baseUrl}/.well-known/assetlinks.json`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/i);
  const statements = await response.json();
  assert.equal(statements[0].target.package_name, "com.together.travel");
  assert.deepEqual(statements[0].target.sha256_cert_fingerprints, [
    "48:B5:B1:3F:A7:03:D2:D9:57:67:3F:F1:08:60:B5:6B:73:C1:2E:C8:15:A5:50:AE:31:1A:B4:51:C1:6C:7E:B7",
  ]);

  const unknown = await fetch(`${baseUrl}/not-a-real-route`, {
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(unknown.status, 404);
});
