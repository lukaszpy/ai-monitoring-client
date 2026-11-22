import path from 'node:path';
import type { AgentSession } from '../../src/shared/types.js';
import type { MonitoringAdapter } from './contract.js';
import { RecordFileStore, type FileInfo } from './file-store.js';
import { applyUsage, count, object, plainText, projectName, providerSession, text, timestamp, titleFrom, type Usage } from './records.js';
import { claudeCostUsage } from '../usage-cost.js';
import { sumModelUsage } from '../../src/shared/costs.js';
import { ActivityBuffer, recordClaudeActivity } from '../session-activity.js';

interface Spawn { child: string; parent: string; title: string | null; role: string | null }
export interface ClaudeState {
  activity: ActivityBuffer;
  session: AgentSession; root: string; agent: string | null; explicitParent: string | null;
  usage: Map<string, Usage>; current: Map<string, Usage>; tools: Map<string, { title: string | null; role: string | null }>;
  spawns: Spawn[]; sequence: number;
}
const childId = (root: string, agent: string) => `${root}/agent/${agent}`;

export function createClaude(info: FileInfo): ClaudeState {
  const parts = info.relative.split(path.sep);
  const child = parts.at(-2) === 'subagents';
  const agent = child ? path.basename(info.relative, '.jsonl').replace(/^agent-/, '') : null;
  const root = child ? parts.at(-3)! : path.basename(info.relative, '.jsonl');
  const session = providerSession(info.filePath, 'claude-code');
  session.id = agent ? childId(root, agent) : root;
  session.externalId = agent ?? root;
  session.lineage = child ? 'unknown-parent' : 'root';
  session.source = child ? 'subagent' : 'cli';
  return { session, activity: new ActivityBuffer(), root, agent, explicitParent: null, usage: new Map(), current: new Map(), tools: new Map(), spawns: [], sequence: 0 };
}

export function applyClaude(state: ClaudeState, value: unknown): void {
  const r = object(value), s = state.session, message = object(r.message);
  state.sequence++;
  recordClaudeActivity(state.activity, value, state.sequence);
  const at = timestamp(r.timestamp);
  if (at) { if (!s.createdAt || at < s.createdAt) s.createdAt = at; if (at > s.updatedAt) s.updatedAt = at; }
  const cwd = text(r.cwd, 8192);
  if (cwd) { s.cwd = cwd; s.project = projectName(cwd); }
  if (text(r.parentAgentId)) state.explicitParent = text(r.parentAgentId);
  if (r.type === 'ai-title' && !state.agent) s.title = text(r.aiTitle, 512) ?? s.title;
  if (r.type === 'custom-title' && !state.agent) s.title = text(r.customTitle, 512) ?? s.title;
  if (r.type === 'system' && r.subtype === 'compact_boundary') {
    s.compactions++; state.current.clear(); s.status = 'idle';
  }
  if (r.type === 'system' && r.subtype === 'api_error') s.status = 'error';
  if (r.type === 'system' && r.subtype === 'turn_duration') s.status = 'completed';
  if (r.type === 'user') {
    const result = object(r.toolUseResult);
    const agent = text(result.agentId);
    const content = Array.isArray(message.content) ? message.content : [];
    const toolResult = content.map(object).find(part => part.type === 'tool_result');
    const tool = toolResult ? state.tools.get(String(toolResult.tool_use_id)) : undefined;
    if (agent && !state.spawns.some(spawn => spawn.child === childId(state.root, agent))) {
      state.spawns.push({ child: childId(state.root, agent), parent: s.id, title: text(result.description) ?? tool?.title ?? null, role: tool?.role ?? null });
    }
    if (!toolResult && !r.isMeta && plainText(message.content).trim()) {
      if (s.title.startsWith('Sesja ')) s.title = titleFrom(message.content) ?? s.title;
      s.status = 'running';
    }
  }
  if (r.type !== 'assistant') return;
  if (text(message.model)) s.model = text(message.model);
  const content = Array.isArray(message.content) ? message.content : [];
  for (const part of content.map(object)) {
    if (part.type === 'tool_use' && (part.name === 'Agent' || part.name === 'Task') && text(part.id)) {
      const input = object(part.input);
      state.tools.set(String(part.id), { title: text(input.description), role: text(input.subagent_type) ?? text(input.name) });
    }
  }
  if (message.stop_reason === 'tool_use') s.status = 'running';
  else if (['end_turn', 'stop_sequence', 'max_tokens'].includes(String(message.stop_reason))) s.status = 'completed';
  const usage = object(message.usage), input = count(usage.input_tokens);
  if (input === null) return;
  const prompt = input + (count(usage.cache_creation_input_tokens) ?? 0) + (count(usage.cache_read_input_tokens) ?? 0);
  const output = count(usage.output_tokens) ?? 0;
  const key = text(message.id) ?? text(r.requestId) ?? `record-${state.sequence}`;
  const model = text(message.model) ?? state.usage.get(key)?.model ?? null;
  const sample: Usage = { input: prompt, output, total: prompt + output, at: at ?? s.updatedAt, limit: count(usage.context_window_size) || null, model, cost: claudeCostUsage(usage, model) };
  state.usage.set(key, sample); state.current.set(key, sample);
}

export class ClaudeAdapter implements MonitoringAdapter {
  readonly runtime = 'claude-code' as const;
  private store: RecordFileStore<ClaudeState>;
  private previews = new Map<string, ActivityBuffer>();
  constructor(directory: string) {
    this.store = new RecordFileStore(path.join(directory, 'projects'), relative => relative.endsWith('.jsonl'), createClaude, applyClaude);
  }
  async read() {
    const result = await this.store.read();
    this.previews = new Map(result.files.map(({ state }) => [state.session.id, state.activity]));
    const parents = new Map<string, Spawn>();
    for (const { state } of result.files) for (const spawn of state.spawns) parents.set(spawn.child, spawn);
    const sessions = result.files.map(({ state, info, warnings }) => {
      const s = structuredClone(state.session);
      const parent = parents.get(s.id);
      if (state.agent && state.explicitParent) s.parentId = childId(state.root, state.explicitParent);
      else if (parent) s.parentId = parent.parent;
      if (s.parentId) s.lineage = 'parent';
      if (parent?.title) s.title = parent.title;
      if (parent?.role) s.role = parent.role;
      applyUsage(s, [...state.current.values()]);
      s.totalTokens = [...state.usage.values()].reduce((sum, usage) => sum + usage.total, 0);
      s.costUsage = sumModelUsage([...state.usage.values()].flatMap(usage => usage.cost ? [usage.cost] : []));
      s.updatedAt ||= info.modifiedAt; s.createdAt ||= s.updatedAt;
      if (s.status === 'running' && Date.now() - Date.parse(s.updatedAt) > 120_000) s.status = 'unknown';
      s.warnings.push(...warnings);
      return s;
    });
    return { sessions, exists: result.exists, errors: result.errors };
  }
  preview(id: string) { return this.previews.get(id)?.snapshot() ?? null; }
  dispose() { this.previews.clear(); }
}
