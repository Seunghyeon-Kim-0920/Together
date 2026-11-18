import { currencyDigits } from "./currency";
import type { MissingRate } from "./exchangeRates";
import type { TravelLedger } from "./types";
import type { SettlementTransfer } from "./wallet";

/** Units of the settlement currency per one unit of `currency` on `date`, or null if unknown. */
export type RateResolver = (currency: string, date: string) => number | null;

export interface ConvertedSettlement {
  readonly target: string;
  /** False while a rate is missing; no partial settlement is offered then. */
  readonly complete: boolean;
  readonly missing: readonly MissingRate[];
  readonly totalMinor: number;
  readonly balances: ReadonlyMap<string, number>;
  readonly transfers: readonly SettlementTransfer[];
  /** Currencies that needed a rate, in code order. */
  readonly convertedCurrencies: readonly string[];
}

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Converts whole minor units and rounds half up once per expense. Work with
 * the rate's decimal representation, not a floating-point product: otherwise
 * 100 cents × 1.005 can become 100.49999999999999 and lose a cent. */
export function convertMinorUnits(minorUnits: number, from: string, to: string, rate: number): number {
  if (!Number.isSafeInteger(minorUnits) || minorUnits < 0 || !Number.isFinite(rate) || rate <= 0) throw new Error("invalid conversion");
  const [decimal, exponent = "0"] = rate.toString().toLowerCase().split("e");
  const [whole, fraction = ""] = decimal.split(".");
  const shift = Number(exponent) - fraction.length + currencyDigits(to) - currencyDigits(from);
  let numerator = BigInt(minorUnits) * BigInt(`${whole}${fraction}`);
  let denominator = 1n;
  if (shift >= 0) numerator *= 10n ** BigInt(shift);
  else denominator = 10n ** BigInt(-shift);
  const converted = numerator / denominator + (numerator % denominator * 2n >= denominator ? 1n : 0n);
  if (converted > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("amount overflow");
  return Number(converted);
}

/** Largest-remainder split in integer arithmetic, so the parts always add up to
 * `total` and every device assigns the leftover units to the same people. */
export function allocateProportionally(total: number, parts: readonly { readonly id: string; readonly weight: number }[]): ReadonlyMap<string, number> {
  if (!Number.isSafeInteger(total) || total < 0 || !parts.length || parts.some((part) => !Number.isSafeInteger(part.weight) || part.weight < 0) || new Set(parts.map((part) => part.id)).size !== parts.length) throw new Error("invalid allocation");
  const weightSum = parts.reduce((sum, part) => sum + BigInt(part.weight), 0n);
  if (weightSum === 0n) throw new Error("invalid allocation");
  const shares = parts.map((part) => {
    const scaled = BigInt(total) * BigInt(part.weight);
    return { id: part.id, amount: Number(scaled / weightSum), remainder: scaled % weightSum };
  });
  let leftover = total - shares.reduce((sum, share) => sum + share.amount, 0);
  for (const share of [...shares].sort((a, b) => (a.remainder === b.remainder ? byCodeUnit(a.id, b.id) : a.remainder > b.remainder ? -1 : 1))) {
    if (leftover <= 0) break;
    share.amount += 1; leftover -= 1;
  }
  return new Map(shares.map((share) => [share.id, share.amount]));
}

/** One settlement for the whole trip in `target`. Each expense is converted at
 * the rate of its own day; expenses already in `target` keep their exact shares. */
export function settleInCurrency(ledger: TravelLedger, target: string, resolve: RateResolver): ConvertedSettlement {
  const balances = new Map(ledger.participants.map((participant) => [participant.id, 0]));
  const missing = new Map<string, MissingRate>(); const converted = new Set<string>();
  let totalMinor = 0;
  for (const expense of ledger.expenses) {
    let amount = expense.minorUnits;
    let shares: ReadonlyMap<string, number> = new Map(expense.shares.map((share) => [share.participantId, share.minorUnits]));
    if (expense.currency !== target) {
      converted.add(expense.currency);
      const rate = resolve(expense.currency, expense.occurredOn);
      if (rate === null) { missing.set(`${expense.currency}@${expense.occurredOn}`, { currency: expense.currency, date: expense.occurredOn }); continue; }
      amount = convertMinorUnits(expense.minorUnits, expense.currency, target, rate);
      shares = allocateProportionally(amount, expense.shares.map((share) => ({ id: share.participantId, weight: share.minorUnits })));
    }
    totalMinor += amount;
    balances.set(expense.paidBy, (balances.get(expense.paidBy) ?? 0) + amount);
    for (const [participantId, share] of shares) balances.set(participantId, (balances.get(participantId) ?? 0) - share);
  }
  const amounts = [...balances.values()];
  if (!Number.isSafeInteger(totalMinor) || amounts.some((amount) => !Number.isSafeInteger(amount)) || amounts.reduce((sum, amount) => sum + amount, 0) !== 0) throw new Error("invalid balances");
  const convertedCurrencies = Object.freeze([...converted].sort(byCodeUnit));
  const missingRates = Object.freeze([...missing.values()].sort((a, b) => byCodeUnit(a.currency, b.currency) || byCodeUnit(a.date, b.date)));
  if (missingRates.length) return Object.freeze({ target, complete: false, missing: missingRates, totalMinor, balances, transfers: Object.freeze([]), convertedCurrencies });
  const debtors = [...balances].filter(([, amount]) => amount < 0).map(([id, amount]) => ({ id, amount: -amount })).sort((a, b) => byCodeUnit(a.id, b.id));
  const creditors = [...balances].filter(([, amount]) => amount > 0).map(([id, amount]) => ({ id, amount })).sort((a, b) => byCodeUnit(a.id, b.id));
  const transfers: SettlementTransfer[] = []; let debtor = 0; let creditor = 0;
  while (debtor < debtors.length && creditor < creditors.length) {
    const amount = Math.min(debtors[debtor].amount, creditors[creditor].amount);
    transfers.push(Object.freeze({ from: debtors[debtor].id, to: creditors[creditor].id, currency: target, minorUnits: amount }));
    debtors[debtor].amount -= amount; creditors[creditor].amount -= amount;
    if (!debtors[debtor].amount) debtor += 1;
    if (!creditors[creditor].amount) creditor += 1;
  }
  return Object.freeze({ target, complete: true, missing: missingRates, totalMinor, balances, transfers: Object.freeze(transfers), convertedCurrencies });
}
