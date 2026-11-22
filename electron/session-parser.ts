import path from 'node:path';
import type { AgentSession, AgentStatus, SessionSource } from '../src/shared/types.js';
import { emptyCostEstimate } from '../src/shared/costs.js';
import { recordCodexCost } from './usage-cost.js';

type Data = Record<string, unknown>;
const object = (value: unknown): Data => value && typeof value === 'object' && !Array.isArray(value) ? value as Data : {};
const string = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value : null;
const number = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const date = (value: unknown): string | null => {
  const text = string(value);
  return text && Number.isFinite(Date.parse(text)) ? new Date(text).toISOString() : null;
};

export function createSession(filePath: string): AgentSession {
  return {
    runtime: 'codex', sourceId: '', externalId: '', lineage: 'root', contextQuality: 'unavailable', contextMethod: 'codex-usage', actions: [],
    id: '', parentId: null, forkedFromId: null, title: 'Sesja Codex', nickname: null,
    role: null, agentPath: null, project: 'Bez projektu', cwd: '', model: null, modelProvider: null,
    source: 'unknown', status: 'unknown', statusOrigin: 'log', createdAt: '', updatedAt: '',
    measuredAt: null, contextTokens: null, contextLimit: null, contextPercent: null,
    totalTokens: 0, costUsage: [], estimatedCost: emptyCostEstimate(), compactions: 0, history: [], filePath, warnings: [],
  };
}

function sourceOf(value: unknown, originator: unknown): SessionSource {
  if (object(value).subagent) return 'subagent';
  const source = `${typeof value === 'string' ? value : ''} ${typeof originator === 'string' ? originator : ''}`.toLowerCase();
  if (/desktop|codex.app|codex app|codex_macos|codex_windows/.test(source)) return 'desktop';
  if (/vscode|vs_code|extension/.test(source)) return 'vscode';
  if (/cli|terminal|exec|tui/.test(source)) return 'cli';
  return 'unknown';
}

function projectName(cwd: string): string {
  return cwd.includes('\\') ? path.win32.basename(cwd) : path.posix.basename(cwd);
}

function shortTitle(text: string): string | null {
  // Instruction blocks are not useful session names; don't expose their contents in the graph.
  const clean = text.replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  if (!clean || /^(# AGENTS\.md|<environment_context>|<INSTRUCTIONS>)/i.test(text.trim())) return null;
  return clean.length > 90 ? `${clean.slice(0, 87)}…` : clean;
}

function userTitle(session: AgentSession, text: unknown): void {
  if (session.title !== 'Sesja Codex' || typeof text !== 'string') return;
  session.title = shortTitle(text) ?? session.title;
}

function resetMeasurement(session: AgentSession): void {
  session.contextQuality = 'unavailable';
  session.contextTokens = null;
  session.contextPercent = null;
  session.measuredAt = null;
}

function parseUsage(session: AgentSession, infoValue: unknown, timestamp: string): void {
  const info = object(infoValue);
  recordCodexCost(session, info, timestamp);
  const last = object(info.last_token_usage);
  const limit = number(info.model_context_window);
  if (limit !== null && limit > 0) session.contextLimit = limit;
  const total = number(object(info.total_token_usage).total_tokens);
  if (total !== null) session.totalTokens = total;
  const input = number(last.input_tokens);
  const output = number(last.output_tokens);
  const tokens = number(last.total_tokens) ?? (input !== null && output !== null ? input + output : null);
  if (tokens === null) return;
  session.contextTokens = tokens;
  session.measuredAt = timestamp;
  if (!session.contextLimit) return;
  // Cached tokens already belong to input_tokens. Lifetime total is never context occupancy.
  const percent = tokens / session.contextLimit * 100;
  session.contextTokens = tokens;
  session.contextPercent = percent;
  session.contextQuality = 'reported';
  session.measuredAt = timestamp;
  const previous = session.history.at(-1);
  if (!previous || previous.tokens !== tokens || previous.limit !== session.contextLimit) {
    session.history.push({ timestamp, tokens, limit: session.contextLimit, percent });
    if (session.history.length > 60) session.history.shift();
  }
}

/** Tolerant reducer for both classic and paginated Codex rollout records. No raw messages leave it. */
export function applyRecord(session: AgentSession, recordValue: unknown): void {
  const record = object(recordValue);
  const payload = object(record.payload);
  // Forked/subagent rollouts can embed the parent's session_meta after their own header.
  // That historical record must never replace the identity of this file's session.
  if (record.type === 'session_meta' && session.id) return;
  const timestamp = date(record.timestamp) ?? session.updatedAt ?? '';
  if (timestamp && timestamp > session.updatedAt) session.updatedAt = timestamp;
  if (record.type === 'session_meta') {
    session.id = string(payload.id) ?? session.id;
    session.createdAt = date(payload.timestamp) ?? timestamp;
    session.cwd = string(payload.cwd) ?? session.cwd;
    session.project = projectName(session.cwd) || 'Bez projektu';
    const source = payload.source;
    const spawn = object(object(object(source).subagent).thread_spawn);
    session.parentId = string(payload.parent_thread_id) ?? string(spawn.parent_thread_id);
    session.forkedFromId = string(payload.forked_from_id);
    // A normal fork is a new root, not a spawned child.
    if (!session.parentId && object(source).subagent) session.parentId = session.forkedFromId;
    session.lineage = session.parentId ? 'parent' : object(source).subagent ? 'unknown-parent' : 'root';
    session.role = string(payload.agent_role) ?? string(spawn.agent_role);
    session.nickname = string(payload.agent_nickname) ?? string(spawn.agent_nickname);
    session.agentPath = string(payload.agent_path) ?? string(spawn.agent_path);
    session.source = session.parentId ? 'subagent' : sourceOf(source, payload.originator);
    session.modelProvider = string(payload.model_provider);
    return;
  }
  if (record.type === 'turn_context') {
    session.model = string(payload.model) ?? session.model;
    return;
  }
  if (record.type === 'compacted') {
    session.compactions++;
    resetMeasurement(session);
    if (session.status === 'compacting') session.status = 'idle';
    return;
  }
  if (record.type === 'response_item' && payload.type === 'message' && payload.role === 'user') {
    const content = Array.isArray(payload.content) ? payload.content : [];
    for (const part of content) userTitle(session, object(part).text);
    return;
  }
  if (record.type !== 'event_msg') return;
  switch (payload.type) {
    case 'token_count': parseUsage(session, payload.info, timestamp); break;
    case 'user_message': userTitle(session, payload.message); break;
    case 'task_started':
    case 'turn_started': {
      session.status = 'running';
      const limit = number(payload.model_context_window);
      if (limit && session.contextLimit !== limit) {
        session.contextLimit = limit;
        resetMeasurement(session);
      }
      break;
    }
    case 'task_complete':
    case 'turn_complete': session.status = 'completed'; break;
    case 'turn_aborted': session.status = 'interrupted'; break;
    case 'error': session.status = 'error'; break;
    case 'context_compaction_started': session.status = 'compacting'; break;
    case 'item_completed': {
      const item = object(payload.item);
      if (item.type === 'UserMessage' || item.type === 'userMessage') {
        for (const part of Array.isArray(item.content) ? item.content : []) userTitle(session, object(part).text);
      }
      break;
    }
    case 'thread_name_updated': session.title = string(payload.name) ?? session.title; break;
  }
}

/** Pure mapping, also used by the runtime adapter. Loaded does not mean currently running. */
export function runtimeStatus(value: unknown): AgentStatus {
  const status = object(value);
  if (status.type === 'active') {
    const flags = Array.isArray(status.activeFlags) ? status.activeFlags : [];
    if (flags.includes('waitingOnApproval') || flags.includes('waitingOnUserInput')) return 'waiting';
    return 'running';
  }
  if (status.type === 'idle') return 'idle';
  if (status.type === 'systemError') return 'error';
  return 'unknown';
}
