import type { AgentSession, ModelTokenUsage } from '../src/shared/types.js';
import { emptyCostTokens, sumModelUsage } from '../src/shared/costs.js';

type Data = Record<string, unknown>;
const obj = (value: unknown): Data => value && typeof value === 'object' && !Array.isArray(value) ? value as Data : {};
const n = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
interface Counters { input: number | null; cached: number | null; writes: number | null; output: number | null }
const counters = (value: unknown): Counters => { const usage = obj(value); return { input: n(usage.input_tokens), cached: n(usage.cached_input_tokens), writes: usage.cache_write_input_tokens === undefined ? 0 : n(usage.cache_write_input_tokens), output: n(usage.output_tokens) }; };
const hasCounters = (usage: Counters) => usage.input !== null || usage.cached !== null || usage.output !== null || (usage.writes ?? 0) > 0;
const codexStates = new WeakMap<AgentSession, { total: Counters | null; fallback: string }>();

/** Cumulative deltas suppress repeated Codex token events and assign each increment to its active model. */
export function recordCodexCost(session: AgentSession, info: Data, at: string): void {
  const last = counters(info.last_token_usage), total = counters(info.total_token_usage);
  if (!hasCounters(last) && !hasCounters(total) && n(obj(info.last_token_usage).total_tokens) === null && n(obj(info.total_token_usage).total_tokens) === null) return;
  const state = codexStates.get(session) ?? { total: null, fallback: '' };
  const fingerprint = JSON.stringify([at, last, total]);
  if (hasCounters(total) && state.total && JSON.stringify(total) === JSON.stringify(state.total)) return;
  if (!hasCounters(total) && fingerprint === state.fallback) return;
  let current = last, complete = hasCounters(total);
  if (state.total && hasCounters(total)) {
    const previous = state.total;
    const reset = (['input', 'cached', 'writes', 'output'] as const).some(key => total[key] !== null && previous[key] !== null && total[key]! < previous[key]!);
    if (reset) { current = last; complete = false; }
    else {
      const delta = (key: keyof Counters) => total[key] === null || previous[key] === null ? null : total[key]! - previous[key]!;
      current = { input: delta('input'), cached: delta('cached'), writes: delta('writes'), output: delta('output') };
    }
  } else if (hasCounters(total)) {
    // A first visible cumulative counter may include unseen history or inherited parent usage.
    if (!hasCounters(last)) {
      const zero = total.input === 0 && total.cached === 0 && total.writes === 0 && total.output === 0;
      current = zero ? total : { input: null, cached: null, writes: null, output: null }; complete = zero;
    }
    else complete = !(Object.keys(total) as (keyof Counters)[]).some(key => total[key] !== null && (last[key] === null || total[key]! > last[key]!));
    if (session.forkedFromId) complete = false;
  }
  const tokens = emptyCostTokens();
  tokens.input = current.input !== null && current.cached !== null && current.writes !== null ? Math.max(0, current.input - current.cached - current.writes) : 0;
  tokens.cachedInput = current.cached ?? 0; tokens.output = current.output ?? 0;
  tokens.cacheWrite = current.writes ?? 0;
  complete &&= current.input !== null && current.cached !== null && current.writes !== null && current.output !== null && current.input >= current.cached + current.writes;
  // A cumulative jump may span unobserved requests with different context bands.
  const pricingBand = last.input === null || current.input === null || current.input > last.input ? 'unknown' : last.input > 272000 ? 'long' : 'standard';
  session.costUsage = sumModelUsage([...session.costUsage, { model: session.model, tokens, complete, pricingBand }]);
  state.total = hasCounters(total) ? total : state.total; state.fallback = fingerprint; codexStates.set(session, state);
}

export function claudeCostUsage(usage: Data, model: string | null): ModelTokenUsage {
  const tokens = emptyCostTokens();
  const input = n(usage.input_tokens), cached = n(usage.cache_read_input_tokens), output = n(usage.output_tokens), writes = n(usage.cache_creation_input_tokens);
  const creation = obj(usage.cache_creation), five = n(creation.ephemeral_5m_input_tokens), hour = n(creation.ephemeral_1h_input_tokens);
  tokens.input = input ?? 0; tokens.cachedInput = cached ?? 0; tokens.output = output ?? 0;
  tokens.cacheWrite5m = five ?? 0; tokens.cacheWrite1h = hour ?? 0;
  tokens.cacheWrite = Math.max(0, (writes ?? 0) - tokens.cacheWrite5m - tokens.cacheWrite1h);
  const paidTools = Object.values(obj(usage.server_tool_use)).some(value => (n(value) ?? 0) > 0);
  return { model, tokens, complete: input !== null && cached !== null && output !== null && writes !== null && tokens.cacheWrite5m + tokens.cacheWrite1h <= writes && !paidTools };
}

export function geminiCostUsage(usage: Data, model: string | null): ModelTokenUsage {
  const tokens = emptyCostTokens();
  const input = n(usage.input), cached = n(usage.cached), output = n(usage.output), thoughts = n(usage.thoughts) ?? 0;
  tokens.input = input !== null && cached !== null ? Math.max(0, input - cached) : 0; tokens.cachedInput = cached ?? 0;
  tokens.output = (output ?? 0) + thoughts;
  const accounted = (input ?? 0) + tokens.output;
  return { model, tokens, complete: input !== null && cached !== null && output !== null && input >= cached && (n(usage.tool) ?? 0) === 0 && (n(usage.total) ?? accounted) <= accounted };
}
