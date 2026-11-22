import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { CodexControl } from '../electron/codex-control.js';
import { createSession } from '../electron/session-parser.js';

async function fixture() {
  const home = await mkdtemp(path.join(tmpdir(), 'ai-monitoring-rpc-'));
  const log = path.join(home, 'rpc.jsonl');
  const control = new CodexControl(home, { command: process.execPath, args: [fileURLToPath(new URL('./fixtures/codex-proxy.mjs', import.meta.url)), log] });
  const requests = async () => (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  return { home, control, requests };
}

test('background discovery only initializes and reads; all loaded pages are followed', async () => {
  const f = await fixture();
  try {
    await f.control.poll();
    assert.equal(f.control.state.status, 'connected');
    assert.equal(f.control.state.loadedThreadIds.length, 4);
    assert.equal(f.control.statuses.get('idle-root'), 'idle');
    assert.equal(f.control.statuses.get('busy'), 'running');
    assert.equal(f.control.statuses.get('waiting'), 'waiting');
    const methods = (await f.requests()).map(request => request.method);
    assert.ok(methods.every(method => ['initialize', 'initialized', 'thread/loaded/list', 'thread/read'].includes(method)));
    assert.equal(methods.includes('thread/resume'), false);
    assert.equal(methods.includes('thread/start'), false);
  } finally { f.control.dispose(); await rm(f.home, { recursive: true, force: true }); }
});

test('active, waiting and unloaded sessions cannot be compacted or silently resumed', async () => {
  const f = await fixture();
  try {
    await f.control.poll();
    for (const id of ['busy', 'waiting', 'unloaded']) {
      await assert.rejects(f.control.compact({ ...createSession(''), id }));
    }
    const methods = (await f.requests()).map(request => request.method);
    assert.equal(methods.includes('thread/compact/start'), false);
    assert.equal(methods.includes('thread/resume'), false);
    await f.control.compact({ ...createSession(''), id: 'idle-child', parentId: 'idle-root' });
    assert.equal(f.control.statuses.get('idle-child'), 'compacting');
    assert.equal((await f.requests()).filter(request => request.method === 'thread/compact/start').length, 1);
  } finally { f.control.dispose(); await rm(f.home, { recursive: true, force: true }); }
});

test('fresh context creates a root without copying messages and cannot replace a subagent', async () => {
  const f = await fixture();
  try {
    await f.control.poll();
    const session = { ...createSession(''), id: 'idle-root', cwd: '/projects/reading', model: 'test-model', modelProvider: 'openai' };
    assert.equal(await f.control.freshContext(session), 'new-root');
    await assert.rejects(f.control.freshContext({ ...session, id: 'idle-child', parentId: 'idle-root' }), /subagenta/);
    const starts = (await f.requests()).filter(request => request.method === 'thread/start');
    assert.equal(starts.length, 1);
    assert.deepEqual(starts[0].params, { cwd: '/projects/reading', model: 'test-model', modelProvider: 'openai', serviceName: 'ai_monitoring' });
  } finally { f.control.dispose(); await rm(f.home, { recursive: true, force: true }); }
});

test('unavailable native Codex executable degrades to monitoring without throwing', async () => {
  const control = new CodexControl('/tmp', { command: '/this-executable-does-not-exist/ai-monitoring-codex', args: [] });
  try {
    await control.poll();
    assert.equal(control.state.status, 'unavailable');
    assert.deepEqual(control.state.loadedThreadIds, []);
  } finally { control.dispose(); }
});
