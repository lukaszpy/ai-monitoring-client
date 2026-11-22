import { estimateSessionCost } from './costs.js';
import type { AgentSourceConfig, ModelPrice, ModelTokenUsage, RuntimeId, SessionCostEstimate } from './types.js';

/** Offline API Standard list-price snapshot. Exact model IDs only; never inferred aliases. */
export const BUILT_IN_PRICE_DATE = '2026-11-19';
export const BUILT_IN_PRICE_SOURCES = [
  'https://developers.openai.com/api/docs/models/gpt-6.1-sol',
  'https://developers.openai.com/api/docs/models/gpt-6-sol',
] as const;
const catalog: ModelPrice[] = [
  { model: 'gpt-6.1-sol', rates: { input: 2, cachedInput: 0.1, output: 10, cacheWrite: 2.5, cacheWrite5m: null, cacheWrite1h: null } },
  { model: 'gpt-6-sol', rates: { input: 2, cachedInput: 0.2, output: 10, cacheWrite: 2.5, cacheWrite5m: null, cacheWrite1h: null } },
];

export function builtInModelPrices(runtime: RuntimeId): ModelPrice[] { return runtime === 'codex' ? structuredClone(catalog) : []; }

/** A manual entry replaces the whole model, including deliberately blank or zero rates. */
export function estimateSourceCost(usage: ModelTokenUsage[], source: Pick<AgentSourceConfig, 'runtime' | 'modelPrices' | 'useBuiltInPrices'>): SessionCostEstimate {
  if (!usage.length) return estimateSessionCost([], []);
  const custom = new Map(source.modelPrices.map(price => [price.model, price]));
  const defaults = new Map((source.useBuiltInPrices ? builtInModelPrices(source.runtime) : []).map(price => [price.model, price]));
  const missing = new Set<string>();
  let amount: number | null = null, complete = true, incompleteUsage = false;
  for (const sample of usage) {
    const manual = sample.model ? custom.get(sample.model) : undefined;
    let price = manual ?? (sample.model ? defaults.get(sample.model) : undefined);
    let measured = sample;
    if (!manual && price) {
      if (sample.pricingBand === 'long') {
        price = { ...price, rates: Object.fromEntries(Object.entries(price.rates).map(([kind, rate]) => [kind, rate === null ? null : rate * (kind === 'output' ? 1.5 : 2)])) as ModelPrice['rates'] };
      } else if (sample.pricingBand !== 'standard') measured = { ...sample, complete: false };
    }
    const estimate = estimateSessionCost([measured], price ? [price] : []);
    if (estimate.amountUsd !== null) amount = (amount ?? 0) + estimate.amountUsd;
    complete &&= estimate.complete; incompleteUsage ||= estimate.incompleteUsage;
    for (const model of estimate.missingModels) missing.add(model);
  }
  const valid = amount !== null && Number.isFinite(amount);
  return { amountUsd: valid ? amount : null, complete: complete && valid, incompleteUsage, missingModels: [...missing] };
}
