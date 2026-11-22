import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SessionStore } from '../electron/session-store.js';

async function fixture() {
  const home = await mkdtemp(path.join(tmpdir(), 'ai-monitoring-test-'));
  const dir = path.join(home, 'sessions', '2026', '11', '18');
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, 'rollout-test.jsonl');
  const meta = JSON.stringify({ type: 'session_meta', timestamp: new Date().toISOString(), payload: { id: 'test', cwd: '/projects/test', source: 'cli' } }) + '\n';
  await writeFile(file, meta);
  return { home, file, meta, store: new SessionStore(home) };
}

test('reads a growing rollout incrementally without duplicate events, including split UTF-8', async () => {
  const f = await fixture();
  try {
    const first = await f.store.scan();
    assert.equal(first.sessions.length, 1);
    const message = Buffer.from(JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'Żółć i źródło' } }) + '\n');
    const cut = message.indexOf(Buffer.from('Ż')) + 1;
    await appendFile(f.file, message.subarray(0, cut));
    assert.equal((await f.store.scan()).sessions[0].title, 'Sesja Codex');
    await appendFile(f.file, message.subarray(cut));
    const complete = await f.store.scan();
    assert.equal(complete.sessions[0].title, 'Żółć i źródło');
    assert.deepEqual(complete.sessions[0].warnings, []);
    await appendFile(f.file, JSON.stringify({ type: 'compacted', payload: {} }) + '\n');
    assert.equal((await f.store.scan()).sessions[0].compactions, 1);
    assert.equal((await f.store.scan()).sessions[0].compactions, 1);
  } finally { await rm(f.home, { recursive: true, force: true }); }
});

test('retains a partial line until complete, skips corrupt lines, and recovers after truncation', async () => {
  const f = await fixture();
  try {
    await appendFile(f.file, '{broken json}\n{"type":"compac');
    const partial = await f.store.scan();
    assert.equal(partial.sessions[0].warnings.length, 1);
    assert.equal(partial.sessions[0].compactions, 0);
    await appendFile(f.file, 'ted","payload":{}}\n');
    assert.equal((await f.store.scan()).sessions[0].compactions, 1);
    await writeFile(f.file, f.meta);
    const truncated = await f.store.scan();
    assert.equal(truncated.sessions[0].compactions, 0);
    assert.deepEqual(truncated.sessions[0].warnings, []);
  } finally { await rm(f.home, { recursive: true, force: true }); }
});

test('title index wins, deleted files disappear, and a missing sessions directory is recoverable', async () => {
  const f = await fixture();
  try {
    await writeFile(path.join(f.home, 'session_index.jsonl'), JSON.stringify({ id: 'test', thread_name: 'Nazwa z Codex' }) + '\n');
    assert.equal((await f.store.scan()).sessions[0].title, 'Nazwa z Codex');
    await rm(f.file);
    assert.equal((await f.store.scan()).sessions.length, 0);
    await rm(path.join(f.home, 'sessions'), { recursive: true });
    const missing = await f.store.scan();
    assert.equal(missing.directoryExists, false);
    assert.deepEqual(missing.errors, []);
  } finally { await rm(f.home, { recursive: true, force: true }); }
});

test('old unfinished logs are unknown instead of falsely claiming a running agent', async () => {
  const f = await fixture();
  try {
    await writeFile(f.file, [
      { type: 'session_meta', timestamp: '2020-01-01T00:00:00Z', payload: { id: 'test' } },
      { type: 'event_msg', timestamp: '2020-01-01T00:00:01Z', payload: { type: 'task_started' } },
    ].map(x => JSON.stringify(x)).join('\n') + '\n');
    assert.equal((await f.store.scan()).sessions[0].status, 'unknown');
  } finally { await rm(f.home, { recursive: true, force: true }); }
});

test('subagent inheritance does not replace identity or count the parent context and compactions', async () => {
  const f = await fixture();
  try {
    const records = [
      { type: 'session_meta', timestamp: '2026-11-18T09:00:00Z', payload: { id: 'child', parent_thread_id: 'parent', subagent_history_start_ordinal: 3 } },
      { type: 'session_meta', timestamp: '2026-11-18T09:00:00Z', payload: { id: 'parent' } },
      { type: 'compacted', payload: {} },
      { type: 'event_msg', payload: { type: 'token_count', info: { model_context_window: 100000, last_token_usage: { total_tokens: 90000 } } } },
      { type: 'event_msg', payload: { type: 'task_started' } },
    ];
    await writeFile(f.file, records.map(record => JSON.stringify(record)).join('\n') + '\n');
    const session = (await f.store.scan()).sessions[0];
    assert.equal(session.id, 'child');
    assert.equal(session.parentId, 'parent');
    assert.equal(session.compactions, 0);
    assert.equal(session.contextPercent, null);
  } finally { await rm(f.home, { recursive: true, force: true }); }
});
