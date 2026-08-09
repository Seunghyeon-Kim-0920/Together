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

async function render(pathname = "/") {
  return fetch(`${baseUrl}${pathname}`, {
    headers: { accept: "text/html" },
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
    /<title>Together \u2014 multi-city travel, in the fastest order<\/title>/i,
  );
  assert.match(html, /Together/);
  assert.match(html, /여러 도시를, 가장 빠른 순서로\./);
  assert.match(html, /가장 빠른 동선 찾기/);
  assert.match(html, /계획 모델 추정치/);
  assert.match(html, /가계부/);
  assert.doesNotMatch(
    html,
    /codex-preview|react-loading-skeleton|Your site is taking shape/i,
  );
});

test("ships installable metadata and a private-save boundary", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  const manifestHref = html.match(/<link rel="manifest" href="([^"]+)"/i)?.[1];
  assert.ok(manifestHref, "rendered HTML must include a web manifest link");
  assert.equal(new URL(manifestHref, baseUrl).pathname, "/manifest.webmanifest");
  assert.match(html, /실제 공급자 키가 연결되기 전에는/);
  const privateTrips = await fetch(`${baseUrl}/api/trips`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(privateTrips.status, 401);
});
