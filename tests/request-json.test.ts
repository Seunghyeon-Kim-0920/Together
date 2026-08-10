import assert from "node:assert/strict";
import test from "node:test";
import { readLimitedJsonBody } from "../lib/request-json";

test("limited JSON reader accepts valid bodies without preloading beyond the cap", async () => {
  const result = await readLimitedJsonBody(new Request("https://example.test", {
    method: "POST",
    body: JSON.stringify({ value: "ok" }),
  }), 64);
  assert.deepEqual(result, { ok: true, value: { value: "ok" } });
});

test("limited JSON reader rejects oversized, compressed, and malformed bodies", async () => {
  const oversized = await readLimitedJsonBody(new Request("https://example.test", {
    method: "POST",
    body: JSON.stringify({ value: "x".repeat(100) }),
  }), 32);
  assert.equal(oversized.ok, false);
  if (!oversized.ok) assert.equal(oversized.status, 413);

  const compressed = await readLimitedJsonBody(new Request("https://example.test", {
    method: "POST",
    headers: { "Content-Encoding": "gzip" },
    body: "not-actually-compressed",
  }), 64);
  assert.equal(compressed.ok, false);
  if (!compressed.ok) assert.equal(compressed.status, 415);

  const malformed = await readLimitedJsonBody(new Request("https://example.test", {
    method: "POST",
    body: "{",
  }), 64);
  assert.equal(malformed.ok, false);
  if (!malformed.ok) assert.equal(malformed.status, 400);
});
