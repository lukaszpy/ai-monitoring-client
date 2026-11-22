// Optional Claude statusLine reporter. Whitelists counters; never persists prompts or messages.
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

try {
  const args = process.argv.slice(2), directory = args[args.indexOf('--directory') + 1], sourceId = args[args.indexOf('--source') + 1];
  if (!args.includes('--directory') || !args.includes('--source') || !path.isAbsolute(directory)) process.exit(0);
  let input = '';
  for await (const chunk of process.stdin) { input += chunk; if (input.length > 1024 * 1024) process.exit(0); }
  const data = JSON.parse(input), window = data.context_window, usage = window?.current_usage;
  if (typeof data.session_id !== 'string' || !data.session_id || data.session_id.length > 512) process.exit(0);
  const valid = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  const tokens = valid(usage?.input_tokens) === null ? null : usage.input_tokens + (valid(usage.cache_creation_input_tokens) ?? 0) + (valid(usage.cache_read_input_tokens) ?? 0);
  const now = new Date().toISOString();
  const file = path.join(directory, `${createHash('sha256').update(data.session_id).digest('hex')}.json`);
  const packet = { version: 1, runtime: 'claude-code', sourceId, sessionId: data.session_id, observedAt: now, measuredAt: tokens === null ? null : now,
    model: typeof data.model?.id === 'string' ? data.model.id : null, contextTokens: tokens, contextLimit: valid(window?.context_window_size), contextPercent: valid(window?.used_percentage) };
  try {
    const previous = JSON.parse(await readFile(file, 'utf8'));
    if (['model', 'contextTokens', 'contextLimit', 'contextPercent'].every(key => previous[key] === packet[key])) packet.measuredAt = previous.measuredAt;
  } catch { /* First packet. */ }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(packet), { mode: 0o600 });
  await rename(temporary, file);
  process.stdout.write(packet.contextPercent === null ? 'AI Monitoring' : `Context ${Math.round(packet.contextPercent)}%`);
} catch { /* A statusLine helper must never interrupt the agent. */ }
