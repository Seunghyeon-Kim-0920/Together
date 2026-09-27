import { categoryMerchantKey, createCategoryResolver } from "../../src/lib/categoryInference";
import { GENERAL_CATEGORIES, type GeneralCategory, type GeneralLedger } from "../../src/lib/types";
import { createLedger } from "../../src/lib/wallet";
import { CATEGORY_FIXTURES, type CategoryFixture } from "./fixtures";

export interface BaselineRecord {
  readonly fixture: CategoryFixture;
  readonly baselineCategory: GeneralCategory;
  readonly correct: boolean;
  readonly baselineIsOther: boolean;
  readonly jevEligible: boolean;
}

export function validateFixtures(fixtures: readonly CategoryFixture[] = CATEGORY_FIXTURES, minimumCount = 100): void {
  if (fixtures.length < minimumCount) throw new Error(`At least ${minimumCount} synthetic fixtures required; found ${fixtures.length}.`);
  const ids = new Set<string>();
  const valid = new Set<string>(GENERAL_CATEGORIES);
  for (const fixture of fixtures) {
    if (!fixture.id.startsWith("synthetic-") || ids.has(fixture.id)) throw new Error(`Invalid or duplicate synthetic ID: ${fixture.id}`);
    ids.add(fixture.id);
    if (!fixture.merchant.trim() || fixture.merchant.length > 500) throw new Error(`Invalid merchant in ${fixture.id}`);
    if (!valid.has(fixture.expectedCategory) || fixture.categoryHint && !valid.has(fixture.categoryHint)) throw new Error(`Invalid category in ${fixture.id}`);
    if (fixture.labelConfidence !== "clear" && fixture.labelConfidence !== "ambiguous") throw new Error(`Invalid label confidence in ${fixture.id}`);
    if (fixture.split !== "development" && fixture.split !== "validation") throw new Error(`Invalid split in ${fixture.id}`);
    if (fixture.learned && (!valid.has(fixture.learned.category) || !["preference", "history"].includes(fixture.learned.kind))) throw new Error(`Invalid learned context in ${fixture.id}`);
  }
}

function syntheticLedger(fixture: CategoryFixture): GeneralLedger {
  const ledger = createLedger("general", "Synthetic evaluation ledger", "EUR");
  if (!fixture.learned) return ledger;
  if (fixture.learned.kind === "preference") return {
    ...ledger,
    merchantCategoryPreferences: [{ merchantKey: categoryMerchantKey(fixture.merchant), category: fixture.learned.category, updatedAt: "2026-01-01T00:00:00.000Z" }],
  };
  return {
    ...ledger,
    expenses: [{ id: `manual-${fixture.id}`, description: fixture.merchant, category: fixture.learned.category, currency: "EUR", minorUnits: 100, occurredOn: "2026-01-01" }],
  };
}

export function evaluateBaseline(fixtures: readonly CategoryFixture[] = CATEGORY_FIXTURES, minimumCount = 100): readonly BaselineRecord[] {
  validateFixtures(fixtures, minimumCount);
  return fixtures.map((fixture) => {
    const ledger = syntheticLedger(fixture);
    const baselineCategory = createCategoryResolver([ledger])(fixture.merchant, ledger.id, fixture.categoryHint);
    const baselineIsOther = baselineCategory === "other";
    return Object.freeze({
      fixture,
      baselineCategory,
      correct: baselineCategory === fixture.expectedCategory,
      baselineIsOther,
      jevEligible: baselineIsOther && !fixture.learned,
    });
  });
}
