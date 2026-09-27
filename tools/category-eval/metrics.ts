import { GENERAL_CATEGORIES, type GeneralCategory } from "../../src/lib/types";
import type { BaselineRecord } from "./baseline";
import type { JevResult } from "./jev";

export interface BenchmarkRecord extends BaselineRecord {
  /** Null means no request was made, never a successful classification. */
  readonly jev: JevResult | null;
}

export interface Accuracy {
  readonly correct: number;
  readonly scored: number;
  readonly total: number;
  readonly accuracy: number | null;
  readonly otherCount: number;
  readonly otherRate: number | null;
}

type Gate = { readonly signal: "confidence" | "top_probability" | "top_two_margin"; readonly threshold: number };

export const GATES: readonly Gate[] = Object.freeze([
  ...[0.50, 0.60, 0.70, 0.80, 0.90, 0.95].flatMap((threshold): Gate[] => [
    { signal: "confidence", threshold }, { signal: "top_probability", threshold },
  ]),
  ...[0.10, 0.20, 0.30, 0.40, 0.50].map((threshold): Gate => ({ signal: "top_two_margin", threshold })),
]);

function signal(jev: JevResult, kind: Gate["signal"]): number | null {
  if (jev.status !== "success" || !jev.probabilities) return null;
  if (kind === "confidence") return jev.confidence;
  const ordered = GENERAL_CATEGORIES.map((category) => jev.probabilities![category]).sort((a, b) => b - a);
  return kind === "top_probability" ? ordered[0] : ordered[0] - ordered[1];
}

/** Null means the policy cannot be scored because the API was not successful. */
export function policyCategory(record: BenchmarkRecord, policy: "A" | "B" | Gate): GeneralCategory | null {
  if (policy === "A" || !record.jevEligible) return record.baselineCategory;
  const jev = record.jev;
  if (!jev || jev.status !== "success" || !jev.selectedCategory) return null;
  if (jev.selectedCategory === "other") return "other";
  if (policy === "B") return jev.selectedCategory;
  const measured = signal(jev, policy.signal);
  return measured !== null && measured >= policy.threshold ? jev.selectedCategory : "other";
}

export function accuracy(records: readonly BenchmarkRecord[], policy: "A" | "B" | Gate): Accuracy {
  let correct = 0, scored = 0, otherCount = 0;
  for (const record of records) {
    const category = policyCategory(record, policy);
    if (category === null) continue;
    scored++;
    if (category === record.fixture.expectedCategory) correct++;
    if (category === "other") otherCount++;
  }
  return { correct, scored, total: records.length, accuracy: scored ? correct / scored : null, otherCount, otherRate: scored ? otherCount / scored : null };
}

export function percentile(values: readonly number[], quantile: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * quantile;
  const lower = Math.floor(position), upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function pct(value: number | null): string { return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`; }
function formatted(result: Accuracy): string { return `${pct(result.accuracy)} (${result.correct}/${result.scored}; coverage ${result.scored}/${result.total}, other ${pct(result.otherRate)})`; }

export function printBaseline(records: readonly BaselineRecord[]): void {
  const wrapped = records.map((record): BenchmarkRecord => ({ ...record, jev: null }));
  console.log(`Synthetic fixtures: ${records.length}; development ${records.filter((record) => record.fixture.split === "development").length}; validation ${records.filter((record) => record.fixture.split === "validation").length}`);
  console.log(`Baseline accuracy: ${formatted(accuracy(wrapped, "A"))}`);
  const eligible = wrapped.filter((record) => record.jevEligible);
  console.log(`Final resolver "other" / Jev eligible: ${records.filter((record) => record.baselineIsOther).length} / ${eligible.length}`);
  console.log(`Baseline eligible accuracy: ${formatted(accuracy(eligible, "A"))}`);
  for (const split of ["development", "validation"] as const) {
    const set = wrapped.filter((record) => record.fixture.split === split);
    if (!set.length) continue;
    const splitEligible = set.filter((record) => record.jevEligible);
    console.log(`  ${split}: all ${formatted(accuracy(set, "A"))}; eligible ${formatted(accuracy(splitEligible, "A"))}`);
  }
  console.log("Baseline incorrect cases (synthetic IDs; labels remain reviewable, not absolute truth):");
  for (const record of records.filter((item) => !item.correct)) console.log(`  ${record.fixture.id}: ${record.baselineCategory} -> expected ${record.fixture.expectedCategory} [${record.fixture.labelConfidence}]`);
}

export function printGateway(records: readonly BenchmarkRecord[]): void {
  const eligible = records.filter((record) => record.jevEligible);
  const succeeded = eligible.filter((record) => record.jev?.status === "success");
  const failed = eligible.filter((record) => record.jev && record.jev.status !== "success");
  const missing = eligible.filter((record) => !record.jev);
  const latencies = succeeded.map((record) => record.jev!.latencyMs);
  console.log("\nBaseline vs Jev always-use vs Jev confidence-gated (no final gate selected)");
  console.log(`API: attempted ${eligible.length - missing.length}; success ${succeeded.length}; failure ${failed.length}; not called ${missing.length}`);
  console.log(`API success/failure among attempts: ${pct((eligible.length - missing.length) ? succeeded.length / (eligible.length - missing.length) : null)} / ${pct((eligible.length - missing.length) ? failed.length / (eligible.length - missing.length) : null)}`);
  console.log(`Latency success p50/p95: ${percentile(latencies, 0.5)?.toFixed(0) ?? "n/a"}/${percentile(latencies, 0.95)?.toFixed(0) ?? "n/a"} ms`);
  console.log(`Total API calls: ${eligible.length - missing.length}; calls per eligible transaction: ${eligible.length ? ((eligible.length - missing.length) / eligible.length).toFixed(2) : "n/a"}`);
  if (!succeeded.length) {
    console.log("No successful eligible Jev responses. Policy B/C accuracy, threshold selection, and category confusion are not measurable.");
    console.log(`API failures: ${failed.length}`);
    for (const record of failed) console.log(`  ${record.fixture.id}: ${record.jev?.status} (HTTP ${record.jev?.httpStatus ?? "n/a"})`);
    if (missing.length) console.log(`Not called: ${missing.map((record) => record.fixture.id).join(", ")}`);
    return;
  }
  for (const split of ["all", "development", "validation"] as const) {
    const group = split === "all" ? records : records.filter((record) => record.fixture.split === split);
    if (!group.length) continue;
    const subset = group.filter((record) => record.jevEligible);
    const comparable = group.filter((record) => !record.jevEligible || record.jev?.status === "success");
    const answered = subset.filter((record) => record.jev?.status === "success");
    console.log(`\n${split}: all ${group.length}, eligible ${subset.length}`);
    console.log(`  Baseline all:      ${formatted(accuracy(group, "A"))}`);
    console.log(`  Jev always all:    ${formatted(accuracy(group, "B"))}`);
    console.log(`  Matched all A/B:   ${formatted(accuracy(comparable, "A"))} / ${formatted(accuracy(comparable, "B"))}`);
    console.log(`  Baseline eligible: ${formatted(accuracy(subset, "A"))}`);
    console.log(`  Matched eligible A/Jev raw/B: ${formatted(accuracy(answered, "A"))} / ${formatted(accuracy(answered, "B"))}`);
    for (const label of ["clear", "ambiguous"] as const) {
      const labeled = subset.filter((record) => record.fixture.labelConfidence === label);
      console.log(`  ${label} eligible: A ${formatted(accuracy(labeled, "A"))}; B ${formatted(accuracy(labeled, "B"))}`);
    }
  }
  console.log("\nPolicy C candidate gates (each uses the same recorded Jev answers; none is selected as final):");
  console.log("  signal threshold | all accuracy | eligible accuracy | wrong confident overrides | remaining other among scored eligible");
  for (const gate of GATES) {
    const all = accuracy(records, gate), sub = accuracy(eligible, gate);
    const wrong = eligible.filter((record) => {
      const category = policyCategory(record, gate);
      return category !== null && category !== "other" && category !== record.fixture.expectedCategory;
    }).length;
    console.log(`  ${gate.signal.padEnd(17)} ${gate.threshold.toFixed(2)} | ${pct(all.accuracy).padEnd(7)} (${all.scored}/${all.total}) | ${pct(sub.accuracy).padEnd(7)} (${sub.scored}/${sub.total}) | ${wrong} | ${pct(sub.otherRate)}`);
  }
  const resolved = succeeded.filter((record) => record.fixture.expectedCategory !== "other" && record.jev?.selectedCategory === record.fixture.expectedCategory);
  const harmed = succeeded.filter((record) => record.fixture.expectedCategory === "other" && record.jev?.selectedCategory !== "other");
  const wrong = succeeded.filter((record) => record.jev?.selectedCategory !== record.fixture.expectedCategory);
  const remained = succeeded.filter((record) => record.jev?.selectedCategory === "other");
  const cases = (heading: string, list: readonly BenchmarkRecord[]) => {
    console.log(`\n${heading}: ${list.length}`);
    for (const record of list) console.log(`  ${record.fixture.id}: baseline ${record.baselineCategory}, Jev ${record.jev?.selectedCategory ?? "-"}, expected ${record.fixture.expectedCategory}`);
  };
  cases("Jev resolved existing other", resolved);
  cases("Correct other -> incorrect non-other", harmed);
  cases("Jev wrong classifications", wrong);
  cases("Jev kept other", remained);
  console.log(`\nAPI failures: ${failed.length}`);
  for (const record of failed) console.log(`  ${record.fixture.id}: ${record.jev?.status} (HTTP ${record.jev?.httpStatus ?? "n/a"})`);
  if (missing.length) console.log(`Not called: ${missing.map((record) => record.fixture.id).join(", ")}`);
  console.log("\nEligible successful confusion by expected category (predicted: count):");
  for (const expected of GENERAL_CATEGORIES) {
    const group = succeeded.filter((record) => record.fixture.expectedCategory === expected);
    if (!group.length) continue;
    const counts = new Map<GeneralCategory, number>();
    for (const record of group) counts.set(record.jev!.selectedCategory!, (counts.get(record.jev!.selectedCategory!) ?? 0) + 1);
    console.log(`  ${expected}: ${[...counts].map(([category, count]) => `${category}:${count}`).join(" ")}`);
  }
}
