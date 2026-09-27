import assert from "node:assert/strict";
import test from "node:test";
import { GENERAL_CATEGORIES, type GeneralCategory } from "../../src/lib/types";
import { evaluateBaseline } from "./baseline";
import { CATEGORY_CRITERIA, evaluateJev, parseChoiceResponse, type JevResult } from "./jev";
import { accuracy, policyCategory, printGateway, type BenchmarkRecord } from "./metrics";

function answer(category: GeneralCategory): unknown {
  const probabilities = Object.fromEntries(GENERAL_CATEGORIES.map((id) => [id, id === category ? 1 : 0]));
  return { model: "typesafe-ai/jev", answers: { category: { type: "choice", choice: category, probabilities, confidence: 1 } } };
}

test("fixtures remain synthetic, stratified, and evaluated by the unchanged production resolver", () => {
  const records = evaluateBaseline();
  assert.ok(records.length >= 100);
  assert.ok(records.some((record) => record.fixture.split === "development"));
  assert.ok(records.some((record) => record.fixture.split === "validation"));
  assert.deepEqual(Object.keys(CATEGORY_CRITERIA).sort(), [...GENERAL_CATEGORIES].sort());
  assert.ok(records.some((record) => record.jevEligible));
  assert.ok(records.some((record) => record.jevEligible && record.fixture.expectedCategory === "other"));
  assert.ok(records.some((record) => record.jevEligible && record.fixture.expectedCategory !== "other"));
  assert.ok(records.every((record) => !record.jevEligible || record.baselineCategory === "other" && !record.fixture.learned));
  assert.ok(records.filter((record) => record.fixture.learned).every((record) => !record.jevEligible));
});

test("Gateway Choice validation rejects unexpected categories and malformed distributions", () => {
  assert.equal(parseChoiceResponse(answer("food"), 12).selectedCategory, "food");
  const withoutConfidence = answer("food") as { answers: { category: { confidence?: number } } };
  delete withoutConfidence.answers.category.confidence;
  assert.equal(parseChoiceResponse(withoutConfidence, 12).confidence, null, "Gateway examples omit confidence, so probability gates must still work");
  assert.equal(parseChoiceResponse({ answers: { category: { type: "choice", choice: "new-category", probabilities: {}, confidence: 1 } } }, 12).status, "unexpected_category");
  assert.equal(parseChoiceResponse({ answers: { category: { type: "choice", choice: "food", probabilities: { food: 1 }, confidence: 1 } } }, 12).status, "unexpected_category");
  assert.equal(parseChoiceResponse({ answers: { category: { type: "choice", choice: "food", probabilities: Object.fromEntries(GENERAL_CATEGORIES.map((id) => [id, 0])), confidence: 1 } } }, 12).status, "malformed_response");
});

test("mocked Gateway request sends only the synthetic merchant, never labels or benchmark metadata", async () => {
  let requestBody: Record<string, unknown> = {};
  const mockFetch: typeof fetch = async (_url, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify(answer("education")), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const result = await evaluateJev("Luma Books", "test-key", 1000, mockFetch);
  assert.equal(result.status, "success");
  assert.deepEqual(requestBody.state, { merchant: "Luma Books" });
  assert.equal("expectedCategory" in requestBody, false);
  assert.equal("sourceName" in (requestBody.state as object), false);
  assert.equal("categoryHint" in (requestBody.state as object), false);
  assert.equal((requestBody.questions as Record<string, { type: string }>).category.type, "choice");
});

test("mocked Gateway failures remain separate from classification errors", async () => {
  const mock = (status: number): typeof fetch => async () => new Response("{}", { status });
  assert.equal((await evaluateJev("Synthetic", "test-key", 1000, mock(401))).status, "authentication_error");
  assert.equal((await evaluateJev("Synthetic", "test-key", 1000, mock(403))).status, "access_denied");
  assert.equal((await evaluateJev("Synthetic", "test-key", 1000, mock(429))).status, "rate_limited");
  assert.equal((await evaluateJev("Synthetic", "test-key", 1000, mock(500))).status, "http_error");
  assert.equal((await evaluateJev("Synthetic", "test-key", 1000, async () => { throw new TypeError("offline"); })).status, "network_error");
});

test("A/B/C use the same answer; failures are unscored rather than silently replaced with baseline", () => {
  const fixture = evaluateBaseline().find((record) => record.jevEligible && record.fixture.expectedCategory === "other");
  assert.ok(fixture);
  const wrong: JevResult = parseChoiceResponse(answer("food"), 12);
  const record: BenchmarkRecord = { ...fixture, jev: wrong };
  assert.equal(policyCategory(record, "A"), "other");
  assert.equal(policyCategory(record, "B"), "food");
  assert.equal(policyCategory(record, { signal: "top_probability", threshold: 0.95 }), "food");
  assert.equal(accuracy([record], "B").correct, 0);
  const failed: BenchmarkRecord = { ...fixture, jev: { ...wrong, status: "timeout", selectedCategory: null } };
  assert.equal(policyCategory(failed, "B"), null);
  assert.equal(accuracy([failed], "B").scored, 0);
});

test("mock report separates rescued, harmed, and API-failed samples", () => {
  const baseline = evaluateBaseline();
  const other = baseline.find((record) => record.jevEligible && record.fixture.expectedCategory === "other");
  const rescuable = baseline.find((record) => record.jevEligible && record.fixture.expectedCategory !== "other");
  assert.ok(other && rescuable);
  const records: BenchmarkRecord[] = [
    { ...other, jev: parseChoiceResponse(answer("food"), 9) },
    { ...rescuable, jev: parseChoiceResponse(answer(rescuable.fixture.expectedCategory), 12) },
    { ...rescuable, fixture: { ...rescuable.fixture, id: "synthetic-api-failure" }, jev: { ...parseChoiceResponse(answer("food"), 20), status: "timeout", selectedCategory: null } },
  ];
  const lines: string[] = [];
  const original = console.log;
  console.log = (...values: unknown[]) => { lines.push(values.map(String).join(" ")); };
  try { printGateway(records); }
  finally { console.log = original; }
  const output = lines.join("\n");
  assert.match(output, /Jev resolved existing other: 1/u);
  assert.match(output, /Correct other -> incorrect non-other: 1/u);
  assert.match(output, /API failures: 1/u);
  assert.match(output, /Policy C candidate gates/u);
});

test("zero successful Jev responses never produce a misleading policy accuracy", () => {
  const fixture = evaluateBaseline().find((record) => record.jevEligible);
  assert.ok(fixture);
  const records: BenchmarkRecord[] = [{ ...fixture, jev: { status: "access_denied", httpStatus: 403, selectedCategory: null, probabilities: null, confidence: null, latencyMs: 50, model: null } }];
  const lines: string[] = [];
  const original = console.log;
  console.log = (...values: unknown[]) => { lines.push(values.map(String).join(" ")); };
  try { printGateway(records); }
  finally { console.log = original; }
  const output = lines.join("\n");
  assert.match(output, /not measurable/u);
  assert.doesNotMatch(output, /Jev always all:/u);
  assert.match(output, /access_denied \(HTTP 403\)/u);
});
