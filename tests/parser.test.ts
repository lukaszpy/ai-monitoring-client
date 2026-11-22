import assert from 'node:assert/strict';
import test from 'node:test';
import { applyRecord, createSession, runtimeStatus } from '../electron/session-parser.js';

const timestamp = '2026-11-18T09:00:00.000Z';
const record = (type: string, payload: unknown) => ({ type, timestamp, payload });
const event = (payload: unknown) => record('event_msg', payload);
const meta = (extra = {}) => record('session_meta', { id: 'main', cwd: '/projects/reading', source: 'vscode', ...extra });

test('retains direct parent, depth-independent agent metadata, and Windows project names', () => {
  const session = createSession('test.jsonl');
  applyRecord(session, meta({ id: 'child', parent_thread_id: 'parent', agent_role: 'reviewer', agent_nickname: 'Laplace', cwd: 'C:\\projects\\reading-service' }));
  assert.equal(session.parentId, 'parent');
  assert.equal(session.source, 'subagent');
  assert.equal(session.project, 'reading-service');
  assert.equal(session.nickname, 'Laplace');
});

test('reads legacy nested subagent metadata but does not turn ordinary forks into children', () => {
  const child = createSession('child.jsonl');
  applyRecord(child, meta({ source: { subagent: { thread_spawn: { parent_thread_id: 'parent', agent_role: 'planner', agent_nickname: 'Curie' } } } }));
  assert.equal(child.parentId, 'parent');
  assert.equal(child.role, 'planner');
  const fork = createSession('fork.jsonl');
  applyRecord(fork, meta({ forked_from_id: 'main' }));
  assert.equal(fork.parentId, null);
  assert.equal(fork.forkedFromId, 'main');
});

test('uses last request for context, never lifetime usage or cached tokens added twice', () => {
  const session = createSession('test.jsonl');
  applyRecord(session, meta());
  applyRecord(session, event({ type: 'token_count', info: {
    model_context_window: 100_000,
    last_token_usage: { input_tokens: 38_000, cached_input_tokens: 30_000, output_tokens: 2_000, reasoning_output_tokens: 800, total_tokens: 40_000 },
    total_token_usage: { total_tokens: 2_000_000 },
  } }));
  assert.equal(session.contextPercent, 40);
  assert.equal(session.contextTokens, 40_000);
  assert.equal(session.totalTokens, 2_000_000);
  assert.equal(session.history.length, 1);
  applyRecord(session, event({ type: 'token_count', info: null }));
  assert.equal(session.contextTokens, 40_000);
});

test('embedded parent session_meta cannot overwrite the child identity', () => {
  const session = createSession('child.jsonl');
  applyRecord(session, meta({ id: 'child', parent_thread_id: 'parent', agent_nickname: 'Curie' }));
  applyRecord(session, meta({ id: 'parent', parent_thread_id: null }));
  assert.equal(session.id, 'child');
  assert.equal(session.parentId, 'parent');
  assert.equal(session.nickname, 'Curie');
});

test('missing usage or limit is unknown; no hardcoded model limit', () => {
  const session = createSession('test.jsonl');
  applyRecord(session, event({ type: 'token_count', info: { last_token_usage: { total_tokens: 1000 } } }));
  assert.equal(session.contextPercent, null);
  applyRecord(session, event({ type: 'token_count', info: { model_context_window: 0, last_token_usage: { total_tokens: 1000 } } }));
  assert.equal(session.contextPercent, null);
});

test('compaction and changed model limit invalidate the previous context measurement', () => {
  const session = createSession('test.jsonl');
  applyRecord(session, event({ type: 'token_count', info: { model_context_window: 100_000, last_token_usage: { total_tokens: 80_000 } } }));
  applyRecord(session, record('compacted', {}));
  assert.equal(session.compactions, 1);
  assert.equal(session.contextPercent, null);
  assert.equal(session.measuredAt, null);
  assert.equal(session.history.length, 1);
  applyRecord(session, event({ type: 'token_count', info: { model_context_window: 100_000, last_token_usage: { total_tokens: 10_000 } } }));
  assert.equal(session.contextPercent, 10);
  applyRecord(session, event({ type: 'task_started', model_context_window: 200_000 }));
  assert.equal(session.contextPercent, null);
  assert.equal(session.contextLimit, 200_000);
});

test('malformed numbers never poison the gauge, and 0% is a valid known value', () => {
  const session = createSession('test.jsonl');
  applyRecord(session, event({ type: 'token_count', info: { model_context_window: -1, last_token_usage: { total_tokens: Number.NaN } } }));
  assert.equal(session.contextPercent, null);
  applyRecord(session, event({ type: 'token_count', info: { model_context_window: 1000, last_token_usage: { total_tokens: 0 } } }));
  assert.equal(session.contextPercent, 0);
});

test('paginated user message yields a title; injected instructions are not titles', () => {
  const session = createSession('test.jsonl');
  applyRecord(session, record('response_item', { type: 'message', role: 'user', content: [{ text: '# AGENTS.md instructions for /project' }] }));
  assert.equal(session.title, 'Sesja Codex');
  applyRecord(session, event({ type: 'item_completed', item: { type: 'UserMessage', content: [{ type: 'text', text: 'Napraw odczyt sesji' }] } }));
  assert.equal(session.title, 'Napraw odczyt sesji');
});

test('lifecycle is not inferred from token events; history stays bounded', () => {
  const session = createSession('test.jsonl');
  applyRecord(session, event({ type: 'task_started' }));
  assert.equal(session.status, 'running');
  for (let i = 1; i <= 100; i++) applyRecord(session, event({ type: 'token_count', info: { model_context_window: 1000, last_token_usage: { total_tokens: i } } }));
  assert.equal(session.history.length, 60);
  applyRecord(session, event({ type: 'task_complete' }));
  assert.equal(session.status, 'completed');
  assert.equal(runtimeStatus({ type: 'active', activeFlags: ['waitingOnApproval'] }), 'waiting');
  assert.equal(runtimeStatus({ type: 'idle' }), 'idle');
  assert.equal(runtimeStatus({ type: 'notLoaded' }), 'unknown');
});
