import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateBaseline, validateFixtures } from "./baseline";
import { CATEGORY_FIXTURES, type CategoryFixture } from "./fixtures";
import { printBaseline, printGateway, type BenchmarkRecord } from "./metrics";

type Mode = "baseline" | "gateway";
type Split = CategoryFixture["split"];

function options(argv: readonly string[]): { mode: Mode; split: Split | null; maxCalls: number | null } {
  let mode: Mode | null = null;
  let split: Split | null = null;
  let maxCalls: number | null = null;
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index], value = argv[index + 1];
    if (flag === "--mode" && (value === "baseline" || value === "gateway")) { mode = value; index++; }
    else if (flag === "--split" && (value === "development" || value === "validation")) { split = value; index++; }
    else if (flag === "--max-calls" && value && /^[1-9]\d*$/u.test(value)) { maxCalls = Number(value); index++; }
    else throw new Error(`Invalid argument: ${flag}. Use --mode baseline|gateway --split development|validation [--max-calls N].`);
  }
  if (!mode) throw new Error("Missing --mode baseline|gateway.");
  if (mode === "gateway" && !split) throw new Error("Gateway mode requires an explicit --split development|validation; refusing to call both sets.");
  if (mode === "gateway" && (!maxCalls || !Number.isSafeInteger(maxCalls))) throw new Error("Gateway mode requires a positive --max-calls N limit.");
  if (mode === "baseline" && maxCalls !== null) throw new Error("--max-calls applies only to gateway mode.");
  return { mode, split, maxCalls };
}

async function main(): Promise<void> {
  const { mode, split, maxCalls } = options(process.argv.slice(2));
  validateFixtures(CATEGORY_FIXTURES);
  const fixtures = split ? CATEGORY_FIXTURES.filter((fixture) => fixture.split === split) : CATEGORY_FIXTURES;
  const baseline = evaluateBaseline(fixtures, split ? 1 : 100);
  printBaseline(baseline);
  if (mode === "baseline") return; // No API module import, key read, or network call on this path.

  const eligible = baseline.filter((record) => record.jevEligible);
  if (eligible.length > maxCalls!) throw new Error(`Call cap ${maxCalls} is below ${eligible.length} eligible fixtures; no API call was made.`);
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) throw new Error("AI_GATEWAY_API_KEY is missing. Set it in the local shell; never paste or commit it.");
  const { evaluateJev } = await import("./jev");
  const answers = new Map<string, Awaited<ReturnType<typeof evaluateJev>>>();
  let calls = 0;
  for (const record of eligible) {
    if (calls >= maxCalls!) break;
    const result = await evaluateJev(record.fixture.merchant, apiKey);
    calls++;
    answers.set(record.fixture.id, result);
    // Authentication cannot recover without user action. Rate limiting should
    // not generate a burst of repeated failed calls in a paid-capable gateway.
    if (result.status === "authentication_error" || result.status === "access_denied" || result.status === "rate_limited") break;
  }
  const records: readonly BenchmarkRecord[] = baseline.map((record) => ({ ...record, jev: answers.get(record.fixture.id) ?? null }));
  printGateway(records);

  const outputDir = join(dirname(fileURLToPath(import.meta.url)), "results");
  await mkdir(outputDir, { recursive: true });
  const outputPath = join(outputDir, `category-eval-${split}-${new Date().toISOString().replace(/[:.]/gu, "-")}.json`);
  const report = {
    kind: "synthetic-category-evaluation",
    model: "typesafe-ai/jev",
    split,
    inputVariant: "merchant-only",
    createdAt: new Date().toISOString(),
    maxCalls,
    calls,
    records: records.map((record) => ({
      id: record.fixture.id,
      split: record.fixture.split,
      labelConfidence: record.fixture.labelConfidence,
      expectedCategory: record.fixture.expectedCategory,
      baselineCategory: record.baselineCategory,
      baselineCorrect: record.correct,
      baselineIsOther: record.baselineIsOther,
      jevEligible: record.jevEligible,
      jevSelectedCategory: record.jev?.selectedCategory ?? null,
      probabilities: record.jev?.probabilities ?? null,
      confidence: record.jev?.confidence ?? null,
      topChoiceProbability: record.jev?.probabilities && record.jev.selectedCategory ? record.jev.probabilities[record.jev.selectedCategory] : null,
      topTwoProbabilityMargin: record.jev?.probabilities ? (() => {
        const ordered = Object.values(record.jev.probabilities).sort((left, right) => right - left);
        return ordered[0] - ordered[1];
      })() : null,
      latencyMs: record.jev?.latencyMs ?? null,
      jevCorrect: record.jev?.status === "success" ? record.jev.selectedCategory === record.fixture.expectedCategory : null,
      apiStatus: record.jev?.status ?? "not_called",
      httpStatus: record.jev?.httpStatus ?? null,
      resolvedModel: record.jev?.model ?? null,
    })),
  };
  await writeFile(outputPath, JSON.stringify(report, null, 2), { encoding: "utf8", flag: "wx" });
  console.log(`\nLocal ignored report: ${outputPath}`);
}

main().catch((error: unknown) => {
  // Never print HTTP response bodies, request headers, or environment secrets.
  console.error(error instanceof Error ? error.message : "Benchmark failed.");
  process.exitCode = 1;
});
