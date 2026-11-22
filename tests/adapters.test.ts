import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AgentMonitor } from '../electron/monitor.js';
import { ClaudeAdapter } from '../electron/adapters/claude.js';
import { GeminiAdapter } from '../electron/adapters/gemini.js';
import { sessionKey, unavailableActions, type AdapterRegistry } from '../electron/adapters/contract.js';
import { createSession } from '../electron/session-parser.js';
import { defaultSources, settingsFromDisk, validateSettingsPatch, validateSources } from '../electron/settings.js';
import { applyContextOverride, overlayTelemetry } from '../electron/telemetry.js';
import { defaultContextAlerts, type AgentSourceConfig, type RuntimeId } from '../src/shared/types.js';

const at = '2026-11-18T10:00:00.000Z';
const later = '2026-11-18T10:01:00.000Z';
const assistant = (id: string, input: number, extra = {}) => ({ type: 'assistant', timestamp: at, cwd: '/Projects/example', sessionId: 'root', message: { id, model: 'claude-example', stop_reason: 'end_turn', usage: { input_tokens: input, cache_creation_input_tokens: 200, cache_read_input_tokens: 300, output_tokens: 50 }, ...extra } });
const jsonl = (records: unknown[]) => records.map(record => JSON.stringify(record)).join('\n') + '\n';
async function temporary(t: { after(fn: () => unknown): void }) {
  const dir = await mkdtemp(path.join(tmpdir(), 'ai-monitor-adapters-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
async function put(root: string, relative: string, value: unknown[] | object) {
  const file = path.join(root, relative); await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, Array.isArray(value) ? jsonl(value) : JSON.stringify(value)); return file;
}
const source = (directory: string, runtime: RuntimeId = 'claude-code', id: string = runtime): AgentSourceConfig => ({ directory, runtime, id, enabled: true, contextLimitOverride: null, contextAlerts: defaultContextAlerts(), modelPrices: [], useBuiltInPrices: false });

test('Claude deduplicates message chunks, includes cache once, excludes output and does not guess the limit', async t => {
  const root = await temporary(t);
  const record = assistant('m1', 1000);
  await put(root, 'projects/p/root.jsonl', [record, { ...record, message: { ...record.message, usage: { ...record.message.usage, output_tokens: 75 } } }]);
  const result = await new ClaudeAdapter(root).read();
  assert.equal(result.sessions.length, 1);
  const s = result.sessions[0];
  assert.equal(s.contextTokens, 1500); assert.equal(s.totalTokens, 1575);
  assert.equal(s.contextLimit, null); assert.equal(s.contextPercent, null);
  assert.equal(s.project, 'example'); assert.equal(s.lineage, 'root');
  assert.equal(s.status, 'completed');
});

test('Claude reconstructs nested agent lineage from the spawning transcript, never parentUuid', async t => {
  const root = await temporary(t);
  const spawn = (agentId: string) => ({ type: 'user', timestamp: at, toolUseResult: { agentId }, message: { content: [{ type: 'tool_result', tool_use_id: `spawn-${agentId}` }] } });
  const tool = (agentId: string) => assistant(`m-${agentId}`, 10, { content: [{ type: 'tool_use', id: `spawn-${agentId}`, name: 'Agent', input: { description: `Work ${agentId}`, subagent_type: 'explorer' } }] });
  await put(root, 'projects/p/root.jsonl', [tool('child'), spawn('child')]);
  await put(root, 'projects/p/root/subagents/agent-child.jsonl', [tool('grandchild'), spawn('grandchild')]);
  await put(root, 'projects/p/root/subagents/agent-grandchild.jsonl', [{ ...assistant('grand', 10), parentUuid: 'message-not-agent' }]);
  await put(root, 'projects/p/root/subagents/agent-orphan.jsonl', [{ ...assistant('orphan', 10), parentUuid: 'root' }]);
  const sessions = (await new ClaudeAdapter(root).read()).sessions;
  const child = sessions.find(s => s.externalId === 'child')!, grandchild = sessions.find(s => s.externalId === 'grandchild')!;
  assert.equal(child.parentId, 'root'); assert.equal(child.role, 'explorer'); assert.equal(child.title, 'Work child');
  assert.equal(grandchild.parentId, child.id); assert.equal(grandchild.lineage, 'parent');
  assert.equal(sessions.find(s => s.externalId === 'orphan')!.lineage, 'unknown-parent');
  assert.equal(sessions.find(s => s.externalId === 'orphan')!.parentId, null);
});

test('Claude compaction clears current measurement, retains consumption and resumes on new usage', async t => {
  const root = await temporary(t);
  const file = await put(root, 'projects/p/root.jsonl', [assistant('m1', 1000), { type: 'system', subtype: 'compact_boundary', timestamp: later }]);
  const adapter = new ClaudeAdapter(root);
  let s = (await adapter.read()).sessions[0];
  assert.equal(s.compactions, 1); assert.equal(s.contextTokens, null); assert.equal(s.measuredAt, null); assert.equal(s.totalTokens, 1550);
  await appendFile(file, jsonl([{ ...assistant('m2', 100), timestamp: later }]));
  s = (await adapter.read()).sessions[0];
  assert.equal(s.contextTokens, 600); assert.equal(s.totalTokens, 2200);
});

test('Claude incremental reader retains split UTF-8, tolerates corruption and resets truncated files', async t => {
  const root = await temporary(t);
  const file = await put(root, 'projects/p/root.jsonl', [assistant('m1', 100)]);
  const adapter = new ClaudeAdapter(root); await adapter.read();
  const bytes = Buffer.from(jsonl([{ type: 'ai-title', aiTitle: 'Żółw 🐢', timestamp: later }]));
  const split = bytes.indexOf(Buffer.from('🐢')) + 2;
  await appendFile(file, bytes.subarray(0, split));
  assert.notEqual((await adapter.read()).sessions[0].title, 'Żółw 🐢');
  await appendFile(file, Buffer.concat([bytes.subarray(split), Buffer.from('{broken}\n')]));
  const s = (await adapter.read()).sessions[0]; assert.equal(s.title, 'Żółw 🐢'); assert.equal(s.warnings.length, 1);
  await writeFile(file, jsonl([assistant('new', 1)]));
  const next = (await adapter.read()).sessions[0]; assert.equal(next.totalTokens, 551); assert.equal(next.warnings.length, 0);
});

test('Gemini replays metadata, message patches, removals, ordering and inclusive rewinds without double-counting cache', async t => {
  const root = await temporary(t);
  const file = await put(root, 'tmp/p/chats/session-root.jsonl', [
    { $set: { sessionId: 'root', startTime: at, directories: ['C:\\Projects\\example'] } },
    { id: 'u', type: 'user', timestamp: at, content: 'Improve service' },
    { id: 'm1', type: 'gemini', timestamp: at, model: 'gemini-example', tokens: { input: 1000, cached: 400, output: 100, total: 1100 } },
    { id: 'm2', type: 'gemini', timestamp: later, tokens: { input: 2000, output: 50, total: 2050 } },
    { $patch: { id: 'm2', content: 'Updated response', toolCalls: [{ id: 'tool', name: 'read_file', status: 'executing' }] } },
  ]);
  const adapter = new GeminiAdapter(root);
  let s = (await adapter.read()).sessions[0];
  assert.equal(s.contextTokens, 2000); assert.equal(s.totalTokens, 3150); assert.equal(s.contextPercent, null); assert.equal(s.status, 'unknown');
  assert.equal(s.project, 'example'); assert.equal(s.title, 'Improve service');
  await appendFile(file, jsonl([{ $patch: { updates: [{ id: 'm2', toolCalls: [{ id: 'tool', status: 'success' }] }], orderIds: ['u', 'm2', 'm1'] } }]));
  s = (await adapter.read()).sessions[0]; assert.equal(s.contextTokens, 1000); assert.equal(s.totalTokens, 3150);
  await appendFile(file, jsonl([{ $patch: { orderIds: ['u', 'm1', 'm2'] } }, { $rewindTo: 'm2' }]));
  s = (await adapter.read()).sessions[0]; assert.equal(s.contextTokens, 1000); assert.equal(s.totalTokens, 3150);
  await appendFile(file, jsonl([{ $patch: { removeIds: ['m1'] } }]));
  s = (await adapter.read()).sessions[0]; assert.equal(s.contextTokens, null); assert.equal(s.totalTokens, 3150);
  await appendFile(file, jsonl([{ $rewindTo: 'not-present' }]));
  s = (await adapter.read()).sessions[0]; assert.equal(s.title, 'Sesja Gemini CLI'); assert.equal(s.totalTokens, 3150);
});

test('Gemini supports legacy JSON, subagent folders and subagents with missing parents', async t => {
  const root = await temporary(t);
  await put(root, 'tmp/p/chats/parent/child.json', { sessionId: 'child', kind: 'subagent', messages: [{ id: 'm', type: 'gemini', timestamp: at, tokens: { input: 30, output: 5, cached: 10, total: 35 } }] });
  await put(root, 'tmp/p/chats/unknown.json', { sessionId: 'unknown', kind: 'subagent', messages: [] });
  const result = await new GeminiAdapter(root).read();
  assert.equal(result.sessions.length, 2);
  const child = result.sessions.find(s => s.id === 'child')!;
  assert.equal(child.parentId, 'parent'); assert.equal(child.lineage, 'parent'); assert.equal(child.contextTokens, 30);
  assert.equal(result.sessions.find(s => s.id === 'unknown')!.lineage, 'unknown-parent');
});

test('multiple runtimes and sources namespace IDs and isolate failures and disabled sources', async t => {
  const root = await temporary(t);
  const configs = [source(root, 'codex', 'a'), source(root, 'claude-code', 'b'), source(root, 'gemini-cli', 'c'), { ...source(root, 'codex', 'disabled'), enabled: false }, source(root, 'codex', 'broken')];
  const registry = Object.fromEntries(['codex', 'claude-code', 'gemini-cli'].map(runtime => [runtime, { storageFolder: '.', create: (config: AgentSourceConfig) => ({ monitor: { runtime, async read() {
    if (config.id === 'broken') throw new Error('bad input');
    assert.notEqual(config.id, 'disabled');
    return { sessions: [{ ...createSession('file'), id: 'same', parentId: 'parent', lineage: 'parent', contextTokens: 25000 }], exists: true, errors: [] };
  }, dispose() {} } }) }])) as AdapterRegistry;
  const monitor = new AgentMonitor(configs, path.join(root, 'telemetry'), registry); t.after(() => monitor.dispose());
  const result = await monitor.read();
  assert.equal(result.sessions.length, 3); assert.equal(new Set(result.sessions.map(s => s.id)).size, 3);
  assert.equal(result.sources.length, 5); assert.equal(result.errors.length, 1);
  for (const s of result.sessions) {
    assert.equal(s.externalId, 'same'); assert.equal(s.id, sessionKey(s.runtime, s.sourceId, 'same'));
    assert.equal(s.parentId, sessionKey(s.runtime, s.sourceId, 'parent')); assert.ok(s.actions.every(action => !action.available));
    await assert.rejects(() => monitor.execute('compact', s), /podgląd/);
  }
  assert.notEqual(sessionKey('codex', 'a:b', 'c'), sessionKey('codex', 'a', 'b:c'));
});

test('control adapter owns capabilities and receives the native ID via externalId', async t => {
  const root = await temporary(t);
  const base = source(root, 'codex'); let received = '';
  const registry = { codex: { storageFolder: '.codex', create: () => ({
    monitor: { runtime: 'codex', async read() { return { sessions: [{ ...createSession('file'), id: 'native' }], exists: true, errors: [] }; }, dispose() {} },
    control: { state: { status: 'connected', loadedThreadIds: ['native'], message: 'OK' }, statuses: new Map([['native', 'idle']]), async refresh() {},
      capabilities: () => [{ ...unavailableActions()[0], supported: true, available: true, reason: null }],
      async execute(_action, session) { received = session.externalId; return { ok: true, message: 'OK' }; }, dispose() {} },
  }) } } as AdapterRegistry;
  const monitor = new AgentMonitor([base], root, registry); t.after(() => monitor.dispose());
  const s = (await monitor.read()).sessions[0];
  assert.equal(s.statusOrigin, 'runtime'); assert.equal(s.status, 'idle'); assert.equal(s.actions[0].available, true);
  await monitor.execute('compact', s); assert.equal(received, 'native');
});

test('settings migrate Codex home and validate unique bounded source IDs, limits and directories', () => {
  const settings = settingsFromDisk({ codexHome: '/custom', language: 'de', showCompleted: false, launchAtLogin: true }, defaultSources('/default/.codex'));
  assert.equal(settings.sources[0].directory, '/custom'); assert.equal(settings.sources.length, 3);
  assert.equal(settings.language, 'de'); assert.equal(settings.showCompleted, false); assert.equal(settings.launchAtLogin, false);
  const sources = defaultSources('/home/.codex');
  assert.deepEqual(validateSettingsPatch({ sources }), { sources });
  assert.deepEqual(settingsFromDisk({ sources: [] }, defaultSources('/default/.codex')).sources, []);
  for (const bad of [{ id: '../outside' }, { runtime: 'unknown' }, { directory: 'relative' }, { enabled: 1 }, { contextLimitOverride: -1 }, { contextLimitOverride: 1.5 }, { contextLimitOverride: Infinity }]) {
    assert.throws(() => validateSources([{ ...sources[0], ...bad }]));
  }
  assert.throws(() => validateSources([sources[0], sources[0]]));
  assert.throws(() => validateSources(Array.from({ length: 25 }, (_, i) => ({ ...sources[0], id: `s${i}` }))));
});

test('configured limits are marked estimated and never override reported limits', () => {
  const s = { ...createSession('file'), contextTokens: 500 };
  applyContextOverride(s, 1000); assert.equal(s.contextPercent, 50); assert.equal(s.contextQuality, 'estimated');
  const reported = { ...s, contextLimit: 2000, contextQuality: 'reported' as const };
  applyContextOverride(reported, 4000); assert.equal(reported.contextLimit, 2000); assert.equal(reported.contextQuality, 'reported');
  const unknown = createSession('file'); applyContextOverride(unknown, 1000); assert.equal(unknown.contextPercent, null);
});

test('optional Claude reporter persists counters only, preserves age and handles unknown usage', async t => {
  const root = await temporary(t), telemetry = path.join(root, 'telemetry');
  const input = { session_id: 'root', model: { id: 'model' }, context_window: { context_window_size: 200000, used_percentage: 25, current_usage: { input_tokens: 20000, cache_creation_input_tokens: 10000, cache_read_input_tokens: 20000, output_tokens: 999 } }, prompt: 'SECRET PROMPT', transcript: 'SECRET TRANSCRIPT' };
  const run = (value: unknown) => spawnSync(process.execPath, ['scripts/collect-telemetry.mjs', '--directory', telemetry, '--source', 'claude-code'], { input: JSON.stringify(value), encoding: 'utf8' });
  assert.equal(run(input).status, 0);
  const filename = path.join(telemetry, (await readdir(telemetry))[0]);
  const first = JSON.parse(await readFile(filename, 'utf8'));
  assert.equal(first.contextTokens, 50000); assert.equal(first.contextPercent, 25);
  assert.doesNotMatch(JSON.stringify(first), /SECRET|output_tokens|transcript|prompt/);
  run(input); assert.equal(JSON.parse(await readFile(filename, 'utf8')).measuredAt, first.measuredAt);
  const s = { ...createSession('file'), externalId: 'root', updatedAt: at };
  await overlayTelemetry([s], source(root), telemetry);
  assert.equal(s.contextPercent, 25); assert.equal(s.contextQuality, 'reported');
  run({ ...input, context_window: { ...input.context_window, current_usage: null } });
  await overlayTelemetry([s], source(root), telemetry); assert.equal(s.contextTokens, null); assert.equal(s.contextPercent, null);
});

test('telemetry cannot resurrect a measurement after compaction or cross source boundaries', async t => {
  const root = await temporary(t);
  await put(root, `${'a'.repeat(64)}.json`, { version: 1, runtime: 'claude-code', sourceId: 'claude-code', sessionId: 'root', observedAt: at, measuredAt: at, contextTokens: 100, contextLimit: 1000 });
  const s = { ...createSession('file'), externalId: 'root', updatedAt: later };
  await overlayTelemetry([s], source(root), root); assert.equal(s.contextTokens, null);
  s.updatedAt = '';
  await overlayTelemetry([s], source(root, 'claude-code', 'other'), root); assert.equal(s.contextTokens, null);
});
