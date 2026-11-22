import type { SessionActivity, SessionActivityEvent, SessionActivityKind } from '../src/shared/types.js';

type Data = Record<string, unknown>;
const obj = (v: unknown): Data => v && typeof v === 'object' && !Array.isArray(v) ? v as Data : {};
const str = (v: unknown): string => typeof v === 'string' ? v : '';
export const MAX_ACTIVITY_EVENTS = 60;
export const MAX_ACTIVITY_TEXT = 3000;
const MAX_BUFFER_TEXT = 64 * 1024;

// Only text and bounded tool parameters are retained. Images and reasoning blocks are omitted.
function boundedValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return value.slice(0, MAX_ACTIVITY_TEXT + 1);
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth >= 3) return '…';
  if (Array.isArray(value)) return value.slice(0, 12).map(v => boundedValue(v, depth + 1));
  return Object.fromEntries(Object.entries(obj(value)).slice(0, 12).map(([key, v]) => [key.slice(0, 120), boundedValue(v, depth + 1)]));
}
function body(value: unknown): string {
  if (typeof value === 'string') return value.slice(0, MAX_ACTIVITY_TEXT * 2);
  if (Array.isArray(value)) {
    let result = '';
    for (const part of value.slice(0, 32)) {
      const p = obj(part);
      if (p.type === 'thinking' || p.type === 'reasoning' || p.thought === true) continue;
      result += (result ? '\n' : '') + (typeof part === 'string' ? part.slice(0, MAX_ACTIVITY_TEXT * 2) : str(p.text).slice(0, MAX_ACTIVITY_TEXT * 2));
      if (result.length > MAX_ACTIVITY_TEXT) break;
    }
    return result;
  }
  return value == null ? '' : JSON.stringify(boundedValue(value));
}
function clean(value: string): string {
  return value.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').replace(/\r\n?/g, '\n').trim();
}

/** Kept inside adapter caches, never in graph snapshots or on disk. */
export class ActivityBuffer {
  private events: SessionActivityEvent[] = [];
  private sequence = 0;
  private omitted = false;
  add(kind: SessionActivityKind, text: unknown, at: unknown, name: unknown = null, key?: string): void {
    const raw = clean(body(text));
    if (!raw && kind !== 'status' && kind !== 'tool') return;
    if (kind === 'user' && /^(# AGENTS\.md|<environment_context>|<INSTRUCTIONS>|<system-reminder>)/i.test(raw)) return;
    const timestamp = typeof at === 'string' && Number.isFinite(Date.parse(at)) ? new Date(at).toISOString() : null;
    const item: SessionActivityEvent = { id: key ?? `event-${++this.sequence}`, kind, timestamp, name: typeof name === 'string' ? clean(name.slice(0, 200)) : null, text: raw.slice(0, MAX_ACTIVITY_TEXT), truncated: raw.length > MAX_ACTIVITY_TEXT };
    if (!key && (kind === 'user' || kind === 'assistant') && this.events.slice(-6).some(previous => previous.kind === kind && previous.text === item.text && previous.timestamp !== null && timestamp !== null && Math.abs(Date.parse(previous.timestamp) - Date.parse(timestamp)) < 1000)) return;
    const index = key ? this.events.findIndex(event => event.id === key) : -1;
    if (index >= 0) this.events[index] = item;
    else this.events.push(item);
    let length = this.events.reduce((sum, event) => sum + Buffer.byteLength(event.text, 'utf8'), 0);
    while (this.events.length > MAX_ACTIVITY_EVENTS || length > MAX_BUFFER_TEXT) {
      length -= Buffer.byteLength(this.events.shift()!.text, 'utf8'); this.omitted = true;
    }
  }
  snapshot(): SessionActivity { return { events: structuredClone(this.events), earlierEventsOmitted: this.omitted }; }
}

export function recordCodexActivity(buffer: ActivityBuffer, value: unknown): void {
  const record = obj(value), p = obj(record.payload), at = record.timestamp;
  if (record.type === 'response_item') {
    if (p.type === 'message' && (p.role === 'user' || p.role === 'assistant') && p.channel !== 'analysis') buffer.add(p.role, p.content, at);
    if (p.type === 'function_call' || p.type === 'custom_tool_call') buffer.add('tool', p.arguments ?? p.input, at, p.name);
    if (p.type === 'function_call_output' || p.type === 'custom_tool_call_output') buffer.add('result', p.output, at);
    if (p.type === 'web_search_call') buffer.add('tool', p.action, at, 'web_search');
  }
  if (record.type === 'compacted') buffer.add('status', '', at, 'compacted');
  if (record.type !== 'event_msg') return;
  if (p.type === 'user_message') buffer.add('user', p.message, at);
  if (p.type === 'agent_message') buffer.add('assistant', p.message, at);
  if (p.type === 'error') buffer.add('error', p.message ?? p.error, at);
  if (['task_started', 'turn_started', 'task_complete', 'turn_complete', 'turn_aborted', 'context_compaction_started'].includes(str(p.type))) buffer.add('status', '', at, p.type);
  if (p.type === 'item_completed') {
    const item = obj(p.item);
    if (item.type === 'UserMessage' || item.type === 'userMessage') buffer.add('user', item.content, at);
    if (item.type === 'AgentMessage' || item.type === 'agentMessage') buffer.add('assistant', item.text ?? item.content, at);
    if (item.type === 'CommandExecution' || item.type === 'commandExecution') { buffer.add('tool', item.command, at, 'terminal'); buffer.add('result', item.aggregated_output ?? item.aggregatedOutput, at); }
  }
}

export function recordClaudeActivity(buffer: ActivityBuffer, value: unknown, sequence: number): void {
  const record = obj(value), message = obj(record.message), at = record.timestamp;
  if (record.type === 'system' && record.subtype === 'compact_boundary') buffer.add('status', '', at, 'compacted');
  if (record.type === 'system' && record.subtype === 'api_error') buffer.add('error', record.error ?? record.message, at);
  if (record.type !== 'assistant' && record.type !== 'user' || record.isMeta) return;
  const prefix = str(message.id) || str(record.uuid) || `record-${sequence}`;
  if (typeof message.content === 'string') buffer.add(record.type, message.content, at, null, `${prefix}:text`);
  for (const [index, value] of (Array.isArray(message.content) ? message.content : []).entries()) {
    const part = obj(value), key = `${prefix}:${index}`;
    if (part.type === 'text') buffer.add(record.type, part.text, at, null, key);
    if (part.type === 'tool_use') buffer.add('tool', part.input, at, part.name, str(part.id) || key);
    if (part.type === 'tool_result') buffer.add(part.is_error ? 'error' : 'result', part.content, at, null, `result:${str(part.tool_use_id) || key}`);
  }
}

export function geminiActivity(messages: Data[]): SessionActivity {
  const buffer = new ActivityBuffer();
  for (const m of messages.slice(-MAX_ACTIVITY_EVENTS)) {
    if (m.type === 'user' || m.type === 'gemini' || m.type === 'error') buffer.add(m.type === 'gemini' ? 'assistant' : m.type, m.content, m.timestamp);
    for (const value of Array.isArray(m.toolCalls) ? m.toolCalls : []) {
      const tool = obj(value);
      buffer.add('tool', tool.args, m.timestamp, tool.name ?? tool.displayName);
      if (tool.result !== undefined) buffer.add('result', tool.result, m.timestamp, tool.name ?? tool.displayName);
    }
  }
  const result = buffer.snapshot();
  result.earlierEventsOmitted ||= messages.length > MAX_ACTIVITY_EVENTS;
  return result;
}
