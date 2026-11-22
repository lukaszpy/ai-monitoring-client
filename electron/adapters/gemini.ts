import path from 'node:path';
import type { AgentSession } from '../../src/shared/types.js';
import type { MonitoringAdapter } from './contract.js';
import { RecordFileStore, type FileInfo } from './file-store.js';
import { applyUsage, count, object, projectName, providerSession, text, timestamp, titleFrom, type Data, type Usage } from './records.js';
import { geminiCostUsage } from '../usage-cost.js';
import { sumModelUsage } from '../../src/shared/costs.js';
import { geminiActivity } from '../session-activity.js';

export interface GeminiState { session: AgentSession; metadata: Data; messages: Data[]; lifetime: Map<string, Usage>; sequence: number }
export function createGemini(info: FileInfo): GeminiState {
  const session = providerSession(info.filePath, 'gemini-cli');
  const parts = info.relative.split(path.sep), chats = parts.lastIndexOf('chats');
  if (chats >= 0 && parts.length > chats + 2) { session.parentId = parts.at(-2)!; session.lineage = 'parent'; session.source = 'subagent'; }
  return { session, metadata: {}, messages: [], lifetime: new Map(), sequence: 0 };
}

function usageOf(message: Data): Usage | null {
  const tokens = object(message.tokens), input = count(tokens.input);
  if (input === null) return null;
  const output = count(tokens.output) ?? 0;
  return { input, output, total: count(tokens.total) ?? input + output, at: timestamp(message.timestamp) ?? '', limit: count(tokens.contextWindow) || count(message.contextWindowSize) || null, model: text(message.model), cost: geminiCostUsage(tokens, text(message.model)) };
}
function mergeMessage(original: Data, patch: Data): Data {
  const merged = { ...original, ...patch };
  if (Array.isArray(patch.toolCalls)) {
    const tools = new Map((Array.isArray(original.toolCalls) ? original.toolCalls : []).map(item => { const tool = object(item); return [tool.id, tool] as const; }));
    for (const value of patch.toolCalls) { const tool = object(value); tools.set(tool.id, { ...tools.get(tool.id), ...tool }); }
    merged.toolCalls = [...tools.values()];
  }
  return merged;
}

export function applyGemini(state: GeminiState, value: unknown): void {
  const record = object(value); state.sequence++;
  const remember = (message: Data) => { const usage = usageOf(message); if (usage) state.lifetime.set(text(message.id) ?? `record-${state.sequence}`, usage); };
  if ('$rewindTo' in record) {
    const index = state.messages.findIndex(message => message.id === record.$rewindTo);
    state.messages = index < 0 ? [] : state.messages.slice(0, index);
  } else if (record.$patch) {
    const patch = object(record.$patch);
    const updates = Array.isArray(patch.updates) ? patch.updates : patch.id ? [patch] : [];
    for (const value of updates) {
      const update = object(value), index = state.messages.findIndex(message => message.id === update.id);
      if (index >= 0) { state.messages[index] = mergeMessage(state.messages[index], update); remember(state.messages[index]); }
    }
    if (Array.isArray(patch.removeIds)) state.messages = state.messages.filter(message => !(patch.removeIds as unknown[]).includes(message.id));
    if (Array.isArray(patch.orderIds)) {
      const ids = patch.orderIds as unknown[];
      const ordered = new Map(state.messages.map(message => [message.id, message]));
      state.messages = [...state.messages.filter(message => !ids.includes(message.id)), ...ids.flatMap(id => ordered.has(id) ? [ordered.get(id)!] : [])];
    }
  } else if (record.$set || Array.isArray(record.messages) || (!record.type && record.sessionId)) {
    const metadata = record.$set ? object(record.$set) : record;
    const { messages, ...fields } = metadata;
    state.metadata = { ...state.metadata, ...fields };
    if (Array.isArray(messages)) { state.messages = messages.map(object); state.messages.forEach(remember); }
  } else if (record.type && record.id) {
    const index = state.messages.findIndex(message => message.id === record.id);
    if (index >= 0) state.messages[index] = mergeMessage(state.messages[index], record);
    else state.messages.push(record);
    remember(index >= 0 ? state.messages[index] : record);
  }
}

export function materializeGemini(state: GeminiState, info: FileInfo): AgentSession | null {
  const metadata = state.metadata, s = structuredClone(state.session);
  const id = text(metadata.sessionId);
  if (!id) return null;
  s.id = id; s.externalId = id;
  if (text(metadata.parentSessionId)) s.parentId = text(metadata.parentSessionId);
  if (s.parentId) { s.lineage = 'parent'; s.source = 'subagent'; }
  else if (metadata.kind === 'subagent') { s.lineage = 'unknown-parent'; s.source = 'subagent'; }
  s.createdAt = timestamp(metadata.startTime) ?? '';
  s.updatedAt = timestamp(metadata.lastUpdated) ?? '';
  s.cwd = text(metadata.cwd, 8192) ?? (Array.isArray(metadata.directories) ? text(metadata.directories[0], 8192) : null) ?? '';
  s.project = s.cwd ? projectName(s.cwd) : text(metadata.projectHash) ?? 'Bez projektu';
  s.title = text(metadata.summary) ?? titleFrom(state.messages.find(message => message.type === 'user')?.content) ?? s.title;
  const samples = state.messages.flatMap(message => { const usage = usageOf(message); return usage ? [usage] : []; });
  applyUsage(s, samples);
  s.totalTokens = [...state.lifetime.values()].reduce((sum, usage) => sum + usage.total, 0);
  s.costUsage = sumModelUsage([...state.lifetime.values()].flatMap(usage => usage.cost ? [usage.cost] : []));
  for (const message of state.messages) {
    const at = timestamp(message.timestamp);
    if (at && at > s.updatedAt) s.updatedAt = at;
    if (text(message.model)) s.model = text(message.model);
    if (message.type === 'user') s.status = 'running';
    if (message.type === 'error') s.status = 'error';
    if (message.type === 'gemini') {
      const tools = Array.isArray(message.toolCalls) ? message.toolCalls.map(object) : [];
      s.status = tools.some(tool => ['executing', 'scheduled', 'validating', 'awaiting_approval'].includes(String(tool.status))) ? 'running' : 'completed';
    }
  }
  s.updatedAt ||= info.modifiedAt; s.createdAt ||= s.updatedAt;
  if (s.status === 'running' && Date.now() - Date.parse(s.updatedAt) > 120_000) s.status = 'unknown';
  return s;
}

export class GeminiAdapter implements MonitoringAdapter {
  readonly runtime = 'gemini-cli' as const;
  private store: RecordFileStore<GeminiState>;
  private previews = new Map<string, GeminiState>();
  constructor(directory: string) {
    this.store = new RecordFileStore(path.join(directory, 'tmp'), relative => /(?:^|[\\/])chats[\\/].*\.(jsonl|json)$/.test(relative), createGemini, applyGemini);
  }
  async read() {
    const result = await this.store.read();
    const byId = new Map<string, AgentSession>();
    const previews = new Map<string, GeminiState>();
    for (const file of result.files) {
      const session = materializeGemini(file.state, file.info);
      if (!session) continue;
      session.warnings.push(...file.warnings);
      const previous = byId.get(session.id);
      if (!previous || previous.updatedAt <= session.updatedAt) { byId.set(session.id, session); previews.set(session.id, file.state); }
    }
    this.previews = previews;
    return { sessions: [...byId.values()], exists: result.exists, errors: result.errors };
  }
  preview(id: string) { const state = this.previews.get(id); return state ? geminiActivity(state.messages) : null; }
  dispose() { this.previews.clear(); }
}
