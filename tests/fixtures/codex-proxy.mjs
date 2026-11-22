// A local stdio protocol fixture. No HTTP, network, real Codex, or model calls.
import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';

const log = process.argv[2];
const statuses = { 'idle-root': { type: 'idle' }, 'idle-child': { type: 'idle' }, 'busy': { type: 'active', activeFlags: [] }, 'waiting': { type: 'active', activeFlags: ['waitingOnApproval'] } };
const reader = createInterface({ input: process.stdin });
reader.on('line', line => {
  const request = JSON.parse(line);
  appendFileSync(log, `${JSON.stringify(request)}\n`);
  if (!request.id) return;
  let result;
  switch (request.method) {
    case 'initialize': result = {}; break;
    case 'thread/loaded/list': result = request.params.cursor ? { data: ['busy', 'waiting'], nextCursor: null } : { data: ['idle-root', 'idle-child'], nextCursor: 'page-2' }; break;
    case 'thread/read': result = { thread: { id: request.params.threadId, status: statuses[request.params.threadId] ?? { type: 'notLoaded' } } }; break;
    case 'thread/compact/start': result = {}; break;
    case 'thread/start': result = { thread: { id: 'new-root' } }; break;
    default: process.stdout.write(`${JSON.stringify({ id: request.id, error: { code: -32601, message: 'Unknown method' } })}\n`); return;
  }
  process.stdout.write(`${JSON.stringify({ id: request.id, result })}\n`);
});
