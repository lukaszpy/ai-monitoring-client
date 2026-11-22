import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createSession, applyRecord } from '../electron/session-parser.js';
import { claudeCostUsage, geminiCostUsage, recordCodexCost } from '../electron/usage-cost.js';
import { defaultSources, settingsFromDisk, validateModelPrices, validateSettingsPatch } from '../electron/settings.js';
import { ClaudeAdapter } from '../electron/adapters/claude.js';
import { GeminiAdapter } from '../electron/adapters/gemini.js';
import { emptyCostEstimate, emptyCostTokens, estimateSessionCost, sumModelUsage } from '../src/shared/costs.js';
import { COST_TOKEN_KINDS, type AgentSession, type ModelPrice, type ModelTokenUsage } from '../src/shared/types.js';
import { aggregateTreeCosts } from '../src/lib/costs.ts';
import { createForest, layoutForest } from '../src/lib/forest.ts';
import { estimatedUsd } from '../src/lib/format.ts';
import { builtInModelPrices, estimateSourceCost } from '../src/shared/pricing-catalog.js';
import { AgentMonitor } from '../electron/monitor.js';

const price = (model = 'model-a'): ModelPrice => ({ model, rates: { input: 2, cachedInput: 0.5, output: 10, cacheWrite: 3, cacheWrite5m: 2.5, cacheWrite1h: 4 } });
const sample = (tokens: Partial<ModelTokenUsage['tokens']>, model: string | null = 'model-a', complete = true): ModelTokenUsage => ({ model, tokens: { ...emptyCostTokens(), ...tokens }, complete });
const close = (actual: number | null, expected: number) => assert.ok(actual !== null && Math.abs(actual - expected) < 1e-10, `${actual} ≈ ${expected}`);
const codexUsage = (input: number, cached: number, output: number) => ({ input_tokens: input, cached_input_tokens: cached, output_tokens: output, reasoning_output_tokens: output / 2, total_tokens: input + output });
const at = '2026-11-19T12:00:00Z';

test('estimation weights each model and token category independently without adding cached/reasoning tokens twice', () => {
  const first = sample({ input: 1000000, cachedInput: 2000000, output: 100000, cacheWrite5m: 100000, cacheWrite1h: 100000, cacheWrite: 100000 });
  const second = sample({ input: 1000000 }, 'model-b');
  const result = estimateSessionCost([first, second], [price(), { ...price('model-b'), rates: { ...price().rates, input: 5 } }]);
  close(result.amountUsd, 9.95); assert.equal(result.complete, true);
});

test('unknown usage, models and rates remain unknown or partial, while explicit zero prices and usage remain zero', () => {
  assert.equal(estimateSessionCost([], [price()]).amountUsd, null);
  assert.equal(estimateSessionCost([sample({ input: 100 })], []).amountUsd, null);
  assert.equal(estimateSessionCost([sample({ input: 100 }, null)], [price()]).amountUsd, null);
  const missing = { ...price(), rates: { ...price().rates, cachedInput: null } };
  let result = estimateSessionCost([sample({ input: 1000000, cachedInput: 1000000 })], [missing]);
  close(result.amountUsd, 2); assert.equal(result.complete, false); assert.deepEqual(result.missingModels, ['model-a']);
  result = estimateSessionCost([sample({ input: 1000000 })], [{ ...price(), rates: { ...price().rates, input: 0, cachedInput: null } }]);
  assert.equal(result.amountUsd, 0); assert.equal(result.complete, true);
  assert.equal(estimateSessionCost([sample({})], [price()]).amountUsd, 0);
  assert.equal(estimateSessionCost([sample({}, 'model-a', false)], [price()]).amountUsd, null);
});

test('Codex cumulative deltas suppress duplicate/streamed events and attribute model switches to the correct rates', () => {
  const s = createSession('file'); s.model = 'model-a';
  const first = codexUsage(1000, 500, 100);
  recordCodexCost(s, { last_token_usage: first, total_token_usage: first }, at);
  recordCodexCost(s, { last_token_usage: first, total_token_usage: first }, at + '-repeat');
  const streamed = codexUsage(1000, 500, 120);
  recordCodexCost(s, { last_token_usage: streamed, total_token_usage: streamed }, at + '-stream');
  s.model = 'model-b';
  recordCodexCost(s, { last_token_usage: codexUsage(200, 100, 50), total_token_usage: codexUsage(1200, 600, 170) }, at + '-next');
  assert.deepEqual(s.costUsage.map(usage => [usage.model, usage.tokens.input, usage.tokens.cachedInput, usage.tokens.output]), [['model-a', 500, 500, 120], ['model-b', 100, 100, 50]]);
  const before = structuredClone(s.costUsage); applyRecord(s, { type: 'compacted', timestamp: at, payload: {} });
  assert.deepEqual(s.costUsage, before, 'compaction never resets lifetime consumption');
});

test('Codex first visible counters exclude unseen parent history and flag its incomplete coverage', () => {
  const s = createSession('child'); s.model = 'model-a';
  recordCodexCost(s, { last_token_usage: codexUsage(1000, 200, 100), total_token_usage: codexUsage(100000, 20000, 10000) }, at);
  assert.equal(s.costUsage[0].tokens.input, 800); assert.equal(s.costUsage[0].complete, false);
  const unknown = createSession('prefix'); unknown.model = 'model-a';
  recordCodexCost(unknown, { total_token_usage: codexUsage(100000, 20000, 10000) }, at);
  assert.equal(estimateSessionCost(unknown.costUsage, [price()]).amountUsd, null, 'unknown prefix is not attributed to the current model or billed again');
  const sparse = createSession('sparse'); sparse.model = 'model-a';
  recordCodexCost(sparse, { last_token_usage: { total_tokens: 10000 } }, at);
  assert.equal(estimateSessionCost(sparse.costUsage, [price()]).amountUsd, null, 'an aggregate token number cannot be priced as free input/output');
});

test('Claude separates all cache TTLs and marks paid tools outside token rates as incomplete', () => {
  const usage = { input_tokens: 1000, cache_read_input_tokens: 500, cache_creation_input_tokens: 700, output_tokens: 100, cache_creation: { ephemeral_5m_input_tokens: 200, ephemeral_1h_input_tokens: 300 } };
  const result = claudeCostUsage(usage, 'model-a');
  assert.deepEqual(result.tokens, { input: 1000, cachedInput: 500, output: 100, cacheWrite: 200, cacheWrite5m: 200, cacheWrite1h: 300 });
  assert.equal(result.complete, true);
  assert.equal(claudeCostUsage({ ...usage, server_tool_use: { web_search_requests: 1 } }, 'model-a').complete, false);
});

test('missing cache counters do not silently price the full prompt as uncached input', () => {
  const s = createSession('sparse-cache'); s.model = 'model-a';
  recordCodexCost(s, { last_token_usage: { input_tokens: 1000, output_tokens: 100 } }, at);
  assert.equal(s.costUsage[0].tokens.input, 0); assert.equal(s.costUsage[0].tokens.output, 100);
  assert.equal(s.costUsage[0].complete, false);
  const gemini = geminiCostUsage({ input: 1000, output: 100 }, 'model-a');
  assert.equal(gemini.tokens.input, 0); assert.equal(gemini.complete, false);
});

test('Gemini splits cached input and bills reasoning with output, preserving unknown tool usage as partial', () => {
  const usage = { input: 1000, cached: 400, output: 100, thoughts: 50, total: 1150, tool: 0 };
  const result = geminiCostUsage(usage, 'model-a');
  assert.equal(result.tokens.input, 600); assert.equal(result.tokens.cachedInput, 400); assert.equal(result.tokens.output, 150); assert.equal(result.complete, true);
  assert.equal(geminiCostUsage({ ...usage, tool: 100, total: 1250 }, 'model-a').complete, false);
});

test('Claude cost ledger deduplicates assistant chunks and survives compaction without inheriting monetary totals', async t => {
  const home = await mkdtemp(path.join(tmpdir(), 'ai-cost-claude-')); t.after(() => rm(home, { recursive: true, force: true }));
  const folder = path.join(home, 'projects', 'p'); await mkdir(folder, { recursive: true });
  const assistant = { type: 'assistant', timestamp: at, message: { id: 'm1', model: 'model-a', usage: { input_tokens: 1000, cache_read_input_tokens: 100, cache_creation_input_tokens: 0, output_tokens: 10 } } };
  await writeFile(path.join(folder, 'root.jsonl'), [assistant, assistant, { type: 'cost-state', totalCostUSD: 999999 }, { type: 'system', subtype: 'compact_boundary', timestamp: at }].map(JSON.stringify).join('\n') + '\n');
  const session = (await new ClaudeAdapter(home).read()).sessions[0];
  assert.equal(session.costUsage[0].tokens.input, 1000); assert.equal(session.costUsage[0].tokens.output, 10);
  close(estimateSessionCost(session.costUsage, [price()]).amountUsd, 0.00215); assert.equal(session.contextTokens, null);
});

test('Gemini rewind and message patches retain consumed token costs without duplicating a recorded message', async t => {
  const home = await mkdtemp(path.join(tmpdir(), 'ai-cost-gemini-')); t.after(() => rm(home, { recursive: true, force: true }));
  const folder = path.join(home, 'tmp', 'p', 'chats'); await mkdir(folder, { recursive: true });
  const file = path.join(folder, 'session-root.jsonl');
  await writeFile(file, [{ $set: { sessionId: 'root' } }, { id: 'm1', type: 'gemini', model: 'model-a', timestamp: at, tokens: { input: 1000, cached: 200, output: 100, thoughts: 50, total: 1150 } }, { id: 'm2', type: 'gemini', model: 'model-a', timestamp: at, tokens: { input: 2000, cached: 400, output: 100, thoughts: 50, total: 2150 } }].map(JSON.stringify).join('\n') + '\n');
  const adapter = new GeminiAdapter(home); const before = (await adapter.read()).sessions[0].costUsage;
  await appendFile(file, JSON.stringify({ $patch: { id: 'm2', content: 'Updated' } }) + '\n' + JSON.stringify({ $rewindTo: 'm2' }) + '\n');
  const s = (await adapter.read()).sessions[0];
  assert.deepEqual(s.costUsage, before); assert.equal(s.costUsage[0].tokens.output, 300); assert.equal(s.contextTokens, 1000);
});

const agent = (id: string, parentId: string | null, amount: number | null, extra: Partial<AgentSession> = {}): AgentSession => ({ ...createSession('file'), id, parentId, lineage: parentId ? 'parent' : 'root', sourceId: 'source', estimatedCost: { ...emptyCostEstimate(), amountUsd: amount, complete: amount !== null, incompleteUsage: amount === null }, ...extra });

test('root cost includes all descendants independently of collapse, completion, visibility and depth', () => {
  const sessions = [agent('root', null, 1), agent('child', 'root', 2, { status: 'completed' }), agent('grandchild', 'child', 3)];
  const forest = createForest(sessions), totals = aggregateTreeCosts(forest);
  const root = totals.get('root')!;
  assert.equal(root.amountUsd, 6); assert.equal(root.rootUsd, 1); assert.equal(root.descendantsUsd, 5); assert.equal(root.pricedSessionCount, 3); assert.equal(root.complete, true);
  layoutForest(forest, new Set(['root']), new Set(['root']));
  assert.deepEqual(aggregateTreeCosts(forest), totals);
  const deep = createForest(Array.from({ length: 2500 }, (_, i) => agent(`deep-${i}`, i ? `deep-${i - 1}` : null, 1)));
  assert.equal(aggregateTreeCosts(deep).get('deep-0')!.amountUsd, 2500);
});

test('separate roots/sources never share costs and unknown child values make the known sum partial', () => {
  const root = aggregateTreeCosts(createForest([agent('a', null, 2), agent('child', 'a', null), agent('b', null, 7, { sourceId: 'other' })]));
  assert.equal(root.get('a')!.amountUsd, 2); assert.equal(root.get('a')!.complete, false); assert.equal(root.get('a')!.pricedSessionCount, 1);
  assert.equal(root.get('b')!.amountUsd, 7); assert.equal(root.get('b')!.complete, true);
  const unknown = aggregateTreeCosts(createForest([agent('unknown', null, null)])); assert.equal(unknown.get('unknown')!.amountUsd, null);
  const orphan = aggregateTreeCosts(createForest([agent('a', null, 2), agent('orphan', 'missing', 3)])); assert.equal(orphan.get('a')!.complete, false);
});

test('summing models and estimating values never mutates parser samples or source rates', () => {
  const usage = [sample({ input: 10 }), sample({ input: 20 })], prices = [price()];
  const saved = structuredClone({ usage, prices });
  assert.equal(sumModelUsage(usage)[0].tokens.input, 30); estimateSessionCost(usage, prices);
  assert.deepEqual({ usage, prices }, saved);
});

test('settings migrate price lists and the global visibility switch without losing other preferences', () => {
  const defaults = defaultSources(); const { modelPrices: _prices, useBuiltInPrices: _builtIn, ...legacy } = defaults[0];
  const settings = settingsFromDisk({ language: 'de', showCompleted: false, sources: [legacy] }, defaults);
  assert.equal(settings.showEstimatedCosts, true); assert.deepEqual(settings.sources[0].modelPrices, []); assert.equal(settings.showCompleted, false);
  assert.equal(settings.sources[0].useBuiltInPrices, true);
  assert.equal(settingsFromDisk({ showEstimatedCosts: false }, defaults).showEstimatedCosts, false);
  assert.deepEqual(validateSettingsPatch({ showEstimatedCosts: false }), { showEstimatedCosts: false });
  assert.throws(() => validateSettingsPatch({ showEstimatedCosts: 'true' }));
  const updated = validateSettingsPatch({ sources: [{ ...defaults[0], modelPrices: [price()] }] });
  assert.deepEqual(updated.sources?.[0].modelPrices, [price()]);
});

test('price validation rejects invalid, duplicate or ambiguous entries and retains explicit unknown/zero rates', () => {
  assert.deepEqual(validateModelPrices(undefined), []);
  assert.deepEqual(validateModelPrices([price()]), [price()]);
  for (const rates of [null, {}, { ...price().rates, input: -1 }, { ...price().rates, input: Infinity }, { ...price().rates, input: '2' }]) assert.throws(() => validateModelPrices([{ model: 'm', rates }]));
  assert.throws(() => validateModelPrices([price(), price()])); assert.throws(() => validateModelPrices([{ ...price(), model: '' }]));
  const nullable = { ...price(), rates: Object.fromEntries(COST_TOKEN_KINDS.map(kind => [kind, kind === 'input' ? 0 : null])) };
  assert.deepEqual(validateModelPrices([nullable])[0], nullable);
});

test('cost formatting preserves unknown values and tiny positive amounts without displaying a false zero', () => {
  assert.equal(estimatedUsd(null, 'en'), '—'); assert.match(estimatedUsd(0.000001, 'en'), /<.*0\.0001/);
  assert.match(estimatedUsd(1.25, 'de'), /1,25/); assert.match(estimatedUsd(0, 'en'), /0\.00/);
});

test('Codex estimates verified exact models with an empty manual price list', () => {
  for (const [model, expected] of [['gpt-6.1-sol', 0.00277], ['gpt-6-sol', 0.00279]] as const) {
    const session = createSession('native'); session.model = model;
    const usage = { ...codexUsage(1000, 200, 100), cache_write_input_tokens: 300 };
    recordCodexCost(session, { last_token_usage: usage, total_token_usage: usage }, at);
    const result = estimateSourceCost(session.costUsage, defaultSources()[0]);
    close(result.amountUsd, expected); assert.equal(result.complete, true);
    assert.deepEqual(session.costUsage[0].tokens, { input: 500, cachedInput: 200, cacheWrite: 300, output: 100, cacheWrite5m: 0, cacheWrite1h: 0 });
  }
});

test('Codex cache write deltas and output streaming never bill repeated input twice', () => {
  const session = createSession('stream'); session.model = 'gpt-6.1-sol';
  const first = { ...codexUsage(1000, 200, 100), cache_write_input_tokens: 300 };
  recordCodexCost(session, { last_token_usage: first, total_token_usage: first }, at);
  recordCodexCost(session, { last_token_usage: first, total_token_usage: first }, at + '-duplicate');
  const streamed = { ...first, output_tokens: 120, total_tokens: 1120 };
  recordCodexCost(session, { last_token_usage: streamed, total_token_usage: streamed }, at + '-stream');
  recordCodexCost(session, { last_token_usage: { ...codexUsage(2000, 400, 50), cache_write_input_tokens: 700 }, total_token_usage: { ...codexUsage(3000, 600, 170), cache_write_input_tokens: 1000 } }, at + '-next');
  assert.equal(session.costUsage.length, 1);
  assert.deepEqual(session.costUsage[0].tokens, { input: 1400, cachedInput: 600, cacheWrite: 1000, output: 170, cacheWrite5m: 0, cacheWrite1h: 0 });
  close(estimateSourceCost(session.costUsage, defaultSources()[0]).amountUsd, 0.00706);
});

test('pricing bands survive aggregation and use request input rather than lifetime context', () => {
  const session = createSession('bands'); session.model = 'gpt-6.1-sol';
  const first = codexUsage(272000, 20000, 1000);
  recordCodexCost(session, { last_token_usage: first, total_token_usage: first }, at);
  const second = codexUsage(272001, 20000, 1000);
  recordCodexCost(session, { last_token_usage: second, total_token_usage: codexUsage(544001, 40000, 2000) }, at + '-long');
  recordCodexCost(session, { last_token_usage: codexUsage(1000, 0, 100), total_token_usage: codexUsage(545001, 40000, 2100) }, at + '-short');
  assert.deepEqual(session.costUsage.map(usage => [usage.pricingBand, usage.tokens.input]), [['standard', 253000], ['long', 252001]]);
  const saved = structuredClone(session.costUsage), defaults = defaultSources()[0];
  const result = estimateSourceCost(session.costUsage, defaults);
  close(result.amountUsd, 1.546004); assert.equal(result.complete, true);
  assert.deepEqual(session.costUsage, saved);
  assert.deepEqual(defaults.modelPrices, []);
});

test('manual entries replace all default rates including null and zero without automatic long-context premiums', () => {
  const measured: ModelTokenUsage = { ...sample({ input: 1000000, cachedInput: 1000000 }, 'gpt-6.1-sol'), pricingBand: 'long' };
  const manual: ModelPrice = { ...price('gpt-6.1-sol'), rates: { ...price().rates, input: 0, cachedInput: null } };
  const config = { ...defaultSources()[0], modelPrices: [manual] };
  const result = estimateSourceCost([measured], config);
  assert.equal(result.amountUsd, 0); assert.equal(result.complete, false); assert.deepEqual(result.missingModels, ['gpt-6.1-sol']);
  manual.rates.input = 7; manual.rates.cachedInput = 1;
  close(estimateSourceCost([measured], config).amountUsd, 8);
  config.useBuiltInPrices = false;
  close(estimateSourceCost([measured], config).amountUsd, 8);
});

test('built-in prices can be disabled, never leak to another runtime and never guess aliases', () => {
  const config = defaultSources()[0], usage: ModelTokenUsage[] = [{ ...sample({ input: 100 }, 'gpt-6.1-sol'), pricingBand: 'standard' }];
  assert.equal(estimateSourceCost(usage, { ...config, useBuiltInPrices: false }).amountUsd, null);
  assert.equal(estimateSourceCost(usage, { ...config, runtime: 'claude-code' }).amountUsd, null);
  assert.equal(estimateSourceCost([{ ...usage[0], model: 'gpt-6.1-sol-future' }], config).amountUsd, null);
  assert.equal(estimateSourceCost([], config).amountUsd, null);
  const catalog = builtInModelPrices('codex'); catalog[0].rates.input = 999;
  assert.equal(builtInModelPrices('codex')[0].rates.input, 2);
});

test('unknown request bands and unseen cumulative jumps remain partial', () => {
  const config = defaultSources()[0];
  const result = estimateSourceCost([sample({ input: 100 }, 'gpt-6.1-sol')], config);
  assert.ok(result.amountUsd! > 0); assert.equal(result.complete, false); assert.equal(result.incompleteUsage, true);
  const session = createSession('gap'); session.model = 'gpt-6.1-sol';
  const first = codexUsage(1000, 0, 10);
  recordCodexCost(session, { last_token_usage: first, total_token_usage: first }, at);
  recordCodexCost(session, { last_token_usage: first, total_token_usage: codexUsage(5000, 0, 50) }, at + '-gap');
  assert.equal(session.costUsage[1].pricingBand, 'unknown');
  assert.equal(estimateSourceCost(session.costUsage, config).complete, false);
});

test('legacy source migration enables Codex defaults only and preserves opt-out and overrides', () => {
  const legacy = defaultSources().map(({ useBuiltInPrices: _builtIn, ...source }) => source);
  const migrated = settingsFromDisk({ sources: legacy });
  assert.deepEqual(migrated.sources.map(source => source.useBuiltInPrices), [true, false, false]);
  const config = { ...migrated.sources[0], useBuiltInPrices: false, modelPrices: [price('gpt-6.1-sol')] };
  assert.deepEqual(settingsFromDisk({ sources: [config] }).sources, [config]);
  for (const invalid of [null, 1, 'true']) assert.throws(() => validateSettingsPatch({ sources: [{ ...config, useBuiltInPrices: invalid }] }));
});

test('legacy Codex source with no configured prices estimates root and descendants through the real monitor', async t => {
  const home = await mkdtemp(path.join(tmpdir(), 'ai-cost-codex-')); t.after(() => rm(home, { recursive: true, force: true }));
  const folder = path.join(home, 'sessions'); await mkdir(folder);
  for (const [id, parent] of [['root', null], ['child', 'root']]) {
    const usage = { ...codexUsage(1000, 200, 100), cache_write_input_tokens: 300 };
    const records = [
      { type: 'session_meta', timestamp: at, payload: { id, parent_thread_id: parent } },
      { type: 'turn_context', timestamp: at, payload: { model: 'gpt-6.1-sol' } },
      { type: 'event_msg', timestamp: at, payload: { type: 'token_count', info: { last_token_usage: usage, total_token_usage: usage } } },
    ];
    await writeFile(path.join(folder, `rollout-${id}.jsonl`), records.map(JSON.stringify).join('\n') + '\n');
  }
  const { useBuiltInPrices: _builtIn, ...legacy } = defaultSources(home)[0];
  const config = settingsFromDisk({ sources: [legacy] }).sources;
  const monitor = new AgentMonitor(config, path.join(home, 'telemetry')); t.after(() => monitor.dispose());
  const first = await monitor.read(), second = await monitor.read();
  assert.equal(first.errors.length, 0); assert.equal(first.sessions.length, 2);
  assert.ok(first.sessions.every(session => session.estimatedCost.complete));
  const totals = [...aggregateTreeCosts(createForest(first.sessions)).values()];
  assert.equal(totals.length, 1); close(totals[0].amountUsd, 0.00554); assert.equal(totals[0].sessionCount, 2);
  assert.deepEqual(second.sessions.map(session => session.estimatedCost), first.sessions.map(session => session.estimatedCost));
});
