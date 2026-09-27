import { performance } from "node:perf_hooks";
import { GENERAL_CATEGORIES, type GeneralCategory } from "../../src/lib/types";

const GATEWAY_URL = "https://ai-gateway.vercel.sh/v1/evaluate";
const MODEL = "typesafe-ai/jev";

/** Choice options exactly mirror the existing general-ledger IDs. */
export const CATEGORY_CRITERIA: Record<GeneralCategory, string> = {
  food: "Groceries, meals, restaurants, cafes, and food delivery.",
  transport: "Ground transport, public transit, taxis, parking, and fuel; not flights or lodging.",
  housing: "Rent, mortgage, residence, and other housing or property costs.",
  utilities: "Electricity, water, gas, internet, phone, and similar household services.",
  shopping: "Retail goods and general marketplaces when no more specific purpose is evident.",
  health: "Medical, dental, pharmacy, and other healthcare spending.",
  leisure: "Entertainment, recreation, fitness, games, and cultural activities.",
  education: "Schooling, classes, learning materials, and bookstores.",
  subscriptions: "Recurring media, software, or membership services, excluding household utilities.",
  travel: "Flights, lodging, and travel booking services; not ordinary ground transport.",
  other: "Insufficient merchant evidence, multiple equally plausible categories, or none of the categories fits.",
};

export const CATEGORY_QUESTION = {
  type: "choice" as const,
  instructions: "Using only state.merchant, which existing general-ledger expense category best fits this spending? If the merchant name does not provide enough evidence or several categories remain equally plausible, choose other. Do not infer a particular product or purchase not shown by the merchant name.",
  criteria: CATEGORY_CRITERIA,
};

export type ApiStatus = "success" | "authentication_error" | "access_denied" | "rate_limited" | "http_error" | "timeout" | "network_error" | "malformed_response" | "unexpected_category";

export interface JevResult {
  readonly status: ApiStatus;
  readonly httpStatus: number | null;
  readonly selectedCategory: GeneralCategory | null;
  readonly probabilities: Readonly<Record<GeneralCategory, number>> | null;
  readonly confidence: number | null;
  readonly latencyMs: number;
  readonly model: string | null;
}

function failure(status: ApiStatus, latencyMs: number, httpStatus: number | null = null): JevResult {
  return { status, httpStatus, selectedCategory: null, probabilities: null, confidence: null, latencyMs, model: null };
}

export function parseChoiceResponse(payload: unknown, latencyMs: number, httpStatus = 200): JevResult {
  if (!payload || typeof payload !== "object") return failure("malformed_response", latencyMs, httpStatus);
  const root = payload as Record<string, unknown>;
  const answers = root.answers;
  if (!answers || typeof answers !== "object") return failure("malformed_response", latencyMs, httpStatus);
  const answer = (answers as Record<string, unknown>).category;
  if (!answer || typeof answer !== "object") return failure("malformed_response", latencyMs, httpStatus);
  const value = answer as Record<string, unknown>;
  if (value.type !== "choice" || typeof value.choice !== "string") return failure("malformed_response", latencyMs, httpStatus);
  const allowed = new Set<string>(GENERAL_CATEGORIES);
  if (!allowed.has(value.choice)) return failure("unexpected_category", latencyMs, httpStatus);
  if (!value.probabilities || typeof value.probabilities !== "object" || Array.isArray(value.probabilities)) return failure("malformed_response", latencyMs, httpStatus);
  const probabilities = value.probabilities as Record<string, unknown>;
  if (Object.keys(probabilities).length !== GENERAL_CATEGORIES.length || Object.keys(probabilities).some((key) => !allowed.has(key))) return failure("unexpected_category", latencyMs, httpStatus);
  let sum = 0;
  for (const category of GENERAL_CATEGORIES) {
    const probability = probabilities[category];
    if (typeof probability !== "number" || !Number.isFinite(probability) || probability < 0 || probability > 1) return failure("malformed_response", latencyMs, httpStatus);
    sum += probability;
  }
  if (Math.abs(sum - 1) > 0.02) return failure("malformed_response", latencyMs, httpStatus);
  const confidence = value.confidence === undefined ? null : value.confidence;
  if (confidence !== null && (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1)) return failure("malformed_response", latencyMs, httpStatus);
  const top = Math.max(...GENERAL_CATEGORIES.map((category) => probabilities[category] as number));
  if ((probabilities[value.choice] as number) < top - 0.02) return failure("malformed_response", latencyMs, httpStatus);
  return {
    status: "success",
    httpStatus,
    selectedCategory: value.choice as GeneralCategory,
    probabilities: probabilities as Record<GeneralCategory, number>,
    confidence: confidence as number | null,
    latencyMs,
    model: typeof root.model === "string" ? root.model : null,
  };
}

/** Dev-only HTTP call. The request body contains the synthetic merchant only. */
export async function evaluateJev(merchant: string, apiKey: string, timeoutMs = 15_000, fetcher: typeof fetch = fetch): Promise<JevResult> {
  const started = performance.now();
  try {
    const response = await fetcher(GATEWAY_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        state: { merchant },
        questions: { category: CATEGORY_QUESTION },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latencyMs = performance.now() - started;
    if (response.status === 401) return failure("authentication_error", latencyMs, response.status);
    if (response.status === 403) return failure("access_denied", latencyMs, response.status);
    if (response.status === 429) return failure("rate_limited", latencyMs, response.status);
    if (!response.ok) return failure("http_error", latencyMs, response.status);
    let payload: unknown;
    try { payload = await response.json(); }
    catch { return failure("malformed_response", performance.now() - started, response.status); }
    return parseChoiceResponse(payload, performance.now() - started, response.status);
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    return failure(name === "TimeoutError" || name === "AbortError" ? "timeout" : "network_error", performance.now() - started);
  }
}
