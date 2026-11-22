import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ActivityBuffer, MAX_ACTIVITY_EVENTS, MAX_ACTIVITY_TEXT, geminiActivity, recordClaudeActivity, recordCodexActivity } from '../electron/session-activity.js';
import { SessionStore } from '../electron/session-store.js';
import { ClaudeAdapter } from '../electron/adapters/claude.js';
import { GeminiAdapter } from '../electron/adapters/gemini.js';
import { AgentMonitor } from '../electron/monitor.js';
import { defaultSources } from '../electron/settings.js';
import { constrainPosition } from '../src/lib/floating-window.ts';

const at = '2026-11-20T10:00:00Z';
const jsonl = (records: unknown[]) => records.map(record => JSON.stringify(record)).join('\n') + '\n';
const codexMessage = (text: string) => ({ type: 'response_item', timestamp: at, payload: { type: 'message', role: 'assistant', channel: 'commentary', content: [{ type: 'output_text', text }] } });
const meta = (id = 'root', extra = {}) => ({ type: 'session_meta', timestamp: at, payload: { id, ...extra } });
async function temporary(t: { after(fn: () => unknown): void }) {
  const directory = await mkdtemp(path.join(tmpdir(), 'ai-preview-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('Codex preview shows public activity, tool calls, results and lifecycle while omitting reasoning and injected instructions', () => {
  const buffer = new ActivityBuffer();
  for (const record of [
    { type: 'event_msg', timestamp: at, payload: { type: 'user_message', message: 'Inspect source' } },
    { type: 'response_item', timestamp: at, payload: { type: 'message', role: 'user', content: [{ text: 'Inspect source' }] } },
    { type: 'event_msg', timestamp: at, payload: { type: 'user_message', message: '<environment_context>not a user task</environment_context>' } },
    codexMessage('Reading files'),
    { type: 'event_msg', timestamp: at, payload: { type: 'agent_message', message: 'Reading files' } },
    { type: 'response_item', timestamp: at, payload: { type: 'message', role: 'assistant', channel: 'analysis', content: [{ text: 'private analysis' }] } },
    { type: 'response_item', timestamp: at, payload: { type: 'reasoning', summary: [{ text: 'private reasoning' }] } },
    { type: 'response_item', timestamp: at, payload: { type: 'function_call', name: 'exec_command', arguments: '{"cmd":"git status"}' } },
    { type: 'response_item', timestamp: at, payload: { type: 'function_call_output', output: '\x1b[31mclean\x1b[0m\u0000\n<script>literal text</script>' } },
    { type: 'event_msg', timestamp: at, payload: { type: 'task_complete' } },
  ]) recordCodexActivity(buffer, record);
  const activity = buffer.snapshot();
  assert.deepEqual(activity.events.map(event => event.kind), ['user', 'assistant', 'tool', 'result', 'status']);
  assert.equal(activity.events[2].name, 'exec_command');
  assert.equal(activity.events[3].text, 'clean\n<script>literal text</script>');
  assert.equal(activity.events[4].name, 'task_complete');
  assert.doesNotMatch(JSON.stringify(activity), /private|environment_context|\\u001b|\\u0000/);
});

test('activity buffers bound event counts, UTF-8 bytes and individual text and never expose mutable cache state', () => {
  const buffer = new ActivityBuffer();
  for (let i = 0; i < 100; i++) buffer.add('tool', `command ${i}`, at, 'terminal');
  assert.equal(buffer.snapshot().events.length, MAX_ACTIVITY_EVENTS);
  assert.equal(buffer.snapshot().earlierEventsOmitted, true);
  for (let i = 0; i < 100; i++) buffer.add('result', 'ą'.repeat(10000), at);
  const activity = buffer.snapshot();
  assert.ok(activity.events.every(event => event.text.length <= MAX_ACTIVITY_TEXT && event.truncated));
  assert.ok(activity.events.reduce((sum, event) => sum + Buffer.byteLength(event.text), 0) <= 64 * 1024);
  activity.events[0].text = 'mutated'; activity.events.length = 0;
  assert.ok(buffer.snapshot().events.length > 0);
  assert.doesNotMatch(JSON.stringify(buffer.snapshot()), /mutated/);
});

test('Claude preview updates repeated chunks by message and tool IDs and records tool errors without thinking blocks', () => {
  const buffer = new ActivityBuffer();
  const assistant = (text: string) => ({ type: 'assistant', timestamp: at, message: { id: 'm1', content: [{ type: 'thinking', thinking: 'private thought' }, { type: 'text', text }, { type: 'tool_use', id: 'call1', name: 'Bash', input: { command: 'pwd' } }] } });
  recordClaudeActivity(buffer, assistant('Checking'), 1);
  recordClaudeActivity(buffer, assistant('Checking files'), 2);
  recordClaudeActivity(buffer, { type: 'user', timestamp: at, uuid: 'u1', message: { content: [{ type: 'tool_result', tool_use_id: 'call1', content: [{ type: 'text', text: 'command failed' }], is_error: true }] } }, 3);
  const activity = buffer.snapshot();
  assert.deepEqual(activity.events.map(event => event.kind), ['assistant', 'tool', 'error']);
  assert.equal(activity.events[0].text, 'Checking files');
  assert.match(activity.events[1].text, /pwd/);
  assert.equal(activity.events[2].text, 'command failed');
  assert.doesNotMatch(JSON.stringify(activity), /private thought/);
});

test('Codex store preview excludes inherited parent history, follows appended records and resets after replacement/deletion', async t => {
  const home = await temporary(t), folder = path.join(home, 'sessions'); await mkdir(folder);
  const file = path.join(folder, 'rollout-child.jsonl'), store = new SessionStore(home);
  await writeFile(file, jsonl([meta('child', { parent_thread_id: 'parent', subagent_history_start_ordinal: 2 }), codexMessage('parent secret'), meta('parent'), codexMessage('child own activity')]));
  const first = await store.scan();
  assert.equal(first.sessions[0].id, 'child');
  assert.deepEqual(store.preview('child')?.events.map(event => event.text), ['child own activity']);
  assert.equal(store.preview('parent'), null);
  await appendFile(file, jsonl([codexMessage('child next activity')]));
  await store.scan(); const before = store.preview('child'); await store.scan();
  assert.deepEqual(store.preview('child'), before);
  assert.deepEqual(before?.events.map(event => event.text), ['child own activity', 'child next activity']);
  await writeFile(file, jsonl([meta('child'), codexMessage('replacement')])); await store.scan();
  assert.deepEqual(store.preview('child')?.events.map(event => event.text), ['replacement']);
  await unlink(file); await store.scan(); assert.equal(store.preview('child'), null);
});

test('Claude adapter isolates root and subagent previews without putting message contents in monitor snapshots', async t => {
  const home = await temporary(t), project = path.join(home, 'projects', 'p');
  await mkdir(path.join(project, 'root', 'subagents'), { recursive: true });
  for (const [relative, content] of [['root.jsonl', 'root assistant content'], ['root/subagents/agent-child.jsonl', 'child assistant content']]) {
    await writeFile(path.join(project, relative), jsonl([{ type: 'assistant', timestamp: at, message: { id: 'same-message-id', content: [{ type: 'text', text: content }] } }]));
  }
  const adapter = new ClaudeAdapter(home);
  const result = await adapter.read();
  assert.equal(adapter.preview('root')?.events[0].text, 'root assistant content');
  assert.equal(adapter.preview('root/agent/child')?.events[0].text, 'child assistant content');
  assert.doesNotMatch(JSON.stringify(result), /assistant content/);
  assert.equal(adapter.preview('unknown'), null);
});

test('Gemini preview follows tool-result patches and removals/rewinds in the existing replayed transcript', async t => {
  const home = await temporary(t), folder = path.join(home, 'tmp', 'p', 'chats'); await mkdir(folder, { recursive: true });
  const file = path.join(folder, 'root.jsonl');
  await writeFile(file, jsonl([
    { $set: { sessionId: 'root' } },
    { type: 'user', id: 'u1', content: 'task', timestamp: at },
    { type: 'gemini', id: 'm1', content: [{ text: 'visible text' }, { thought: true, text: 'private thought' }], timestamp: at, toolCalls: [{ id: 'call', name: 'run_shell_command', args: { command: 'pwd' }, status: 'executing' }] },
  ]));
  const adapter = new GeminiAdapter(home); await adapter.read();
  assert.deepEqual(adapter.preview('root')?.events.map(event => event.kind), ['user', 'assistant', 'tool']);
  await appendFile(file, jsonl([{ $patch: { id: 'm1', toolCalls: [{ id: 'call', result: 'project directory', status: 'success' }] } }]));
  await adapter.read(); assert.equal(adapter.preview('root')?.events.at(-1)?.text, 'project directory');
  assert.doesNotMatch(JSON.stringify(adapter.preview('root')), /private thought/);
  await appendFile(file, jsonl([{ $rewindTo: 'm1' }])); await adapter.read();
  assert.deepEqual(adapter.preview('root')?.events.map(event => event.text), ['task']);
  await unlink(file); await adapter.read(); assert.equal(adapter.preview('root'), null);
  const bounded = geminiActivity(Array.from({ length: 100 }, (_, i) => ({ type: 'gemini', id: `m${i}`, content: `message ${i}` })));
  assert.equal(bounded.events.length, MAX_ACTIVITY_EVENTS); assert.equal(bounded.earlierEventsOmitted, true);
});

test('preview coordinator routes equal native IDs to their own source and returns detached on-demand data only', async t => {
  const home = await temporary(t), sources = [];
  for (const id of ['first', 'second']) {
    const directory = path.join(home, id); await mkdir(path.join(directory, 'sessions'), { recursive: true });
    await writeFile(path.join(directory, 'sessions', 'rollout-root.jsonl'), jsonl([meta(), codexMessage(`${id} unique assistant activity`)]));
    sources.push({ ...defaultSources(directory)[0], id });
  }
  const monitor = new AgentMonitor(sources, path.join(home, 'telemetry')); t.after(() => monitor.dispose());
  const snapshot = await monitor.read();
  assert.equal(snapshot.sessions.length, 2);
  for (const session of snapshot.sessions) assert.equal(monitor.preview(session)?.events[0].text, `${session.sourceId} unique assistant activity`);
  assert.doesNotMatch(JSON.stringify(snapshot), /unique assistant activity/);
  const first = snapshot.sessions[0], preview = monitor.preview(first)!;
  preview.events.length = 0;
  assert.equal(monitor.preview(first)?.events.length, 1);
});

test('floating windows stay inside graph bounds when dragged beyond an edge or the application is resized', () => {
  const bounds = { width: 1200, height: 700 }, size = { width: 560, height: 390 };
  assert.deepEqual(constrainPosition({ x: -100, y: -100 }, bounds, size), { x: 8, y: 8 });
  assert.deepEqual(constrainPosition({ x: 2000, y: 2000 }, bounds, size), { x: 632, y: 302 });
  assert.deepEqual(constrainPosition({ x: 140, y: 70 }, bounds, size), { x: 140, y: 70 });
  assert.deepEqual(constrainPosition({ x: 140, y: 70 }, { width: 400, height: 300 }, { width: 384, height: 284 }), { x: 8, y: 8 });
});
