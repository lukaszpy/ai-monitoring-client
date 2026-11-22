import { COST_TOKEN_KINDS, type CostTokenCounts, type ModelPrice, type ModelTokenUsage, type SessionCostEstimate } from './types.js';

export const emptyCostTokens = (): CostTokenCounts => ({ input: 0, cachedInput: 0, output: 0, cacheWrite: 0, cacheWrite5m: 0, cacheWrite1h: 0 });
export const emptyCostEstimate = (): SessionCostEstimate => ({ amountUsd: null, complete: false, missingModels: [], incompleteUsage: true });

export function sumModelUsage(samples: Iterable<ModelTokenUsage>): ModelTokenUsage[] {
  const totals = new Map<string, ModelTokenUsage>();
  for (const sample of samples) {
    const key = JSON.stringify([sample.model, sample.pricingBand]);
    const total = totals.get(key) ?? { model: sample.model, tokens: emptyCostTokens(), complete: true, ...(sample.pricingBand ? { pricingBand: sample.pricingBand } : {}) };
    total.complete &&= sample.complete;
    for (const kind of COST_TOKEN_KINDS) total.tokens[kind] += sample.tokens[kind];
    totals.set(key, total);
  }
  return [...totals.values()];
}

/** Prices are explicit local assumptions in USD per million tokens, never inferred from model names. */
export function estimateSessionCost(usage: ModelTokenUsage[], prices: ModelPrice[]): SessionCostEstimate {
  if (!usage.length) return emptyCostEstimate();
  const ratesByModel = new Map(prices.map(price => [price.model, price.rates]));
  const missing = new Set<string>();
  let amount = 0, priced = false, complete = true, incompleteUsage = false;
  for (const sample of usage) {
    const rates = sample.model ? ratesByModel.get(sample.model) : undefined;
    incompleteUsage ||= !sample.complete;
    complete &&= sample.complete;
    if (!rates) { missing.add(sample.model ?? ''); complete = false; continue; }
    let hasTokens = false;
    for (const kind of COST_TOKEN_KINDS) {
      const tokens = sample.tokens[kind];
      if (!Number.isFinite(tokens) || tokens < 0) { complete = false; incompleteUsage = true; continue; }
      if (!tokens) continue;
      hasTokens = true;
      const rate = rates[kind];
      if (rate === null || !Number.isFinite(rate) || rate < 0) { missing.add(sample.model ?? ''); complete = false; continue; }
      amount += tokens * rate / 1_000_000; priced = true;
    }
    if (!hasTokens && sample.complete) priced = true; // Explicit zero usage is different from missing usage.
  }
  return { amountUsd: priced && Number.isFinite(amount) ? amount : null, complete: complete && priced && Number.isFinite(amount), missingModels: [...missing], incompleteUsage };
}
