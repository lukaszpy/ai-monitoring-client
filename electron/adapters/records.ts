import path from 'node:path';
import { createSession } from '../session-parser.js';
import type { AgentSession, ModelTokenUsage, RuntimeId } from '../../src/shared/types.js';

export type Data = Record<string, unknown>;
export const object = (v: unknown): Data => v && typeof v === 'object' && !Array.isArray(v) ? v as Data : {};
export const text = (v: unknown, maximum = 512): string | null => typeof v === 'string' && v.trim() && v.length <= maximum ? v : null;
export const count = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
export const timestamp = (v: unknown): string | null => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;

export function projectName(cwd: string): string { return (cwd.includes('\\') ? path.win32 : path.posix).basename(cwd) || 'Bez projektu'; }
export function plainText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.map(part => typeof part === 'string' ? part : typeof object(part).text === 'string' ? object(part).text : '').join(' ');
}
export function titleFrom(value: unknown): string | null {
  const raw = plainText(value).trim();
  if (!raw || /^(# AGENTS\.md|<environment_context>|<INSTRUCTIONS>|<system-reminder>)/i.test(raw)) return null;
  const clean = raw.replace(/\s+/g, ' ');
  return clean.length > 100 ? `${clean.slice(0, 97)}…` : clean;
}

export function providerSession(filePath: string, runtime: RuntimeId): AgentSession {
  return { ...createSession(filePath), runtime, title: runtime === 'claude-code' ? 'Sesja Claude Code' : 'Sesja Gemini CLI', modelProvider: runtime === 'claude-code' ? 'anthropic' : 'google', source: 'cli', contextMethod: runtime === 'claude-code' ? 'claude-input' : 'gemini-prompt' };
}

export interface Usage { input: number; output: number; total: number; at: string; limit: number | null; model: string | null; cost?: ModelTokenUsage }

export function applyUsage(session: AgentSession, samples: Usage[]): void {
  session.totalTokens = samples.reduce((sum, item) => sum + item.total, 0);
  session.contextTokens = null; session.contextLimit = null; session.contextPercent = null; session.measuredAt = null;
  session.contextQuality = 'unavailable'; session.history = [];
  const last = samples.at(-1);
  if (!last) return;
  session.contextTokens = last.input; session.measuredAt = last.at || null;
  session.contextLimit = last.limit;
  if (last.model) session.model = last.model;
  if (last.limit && last.limit > 0) {
    session.contextPercent = last.input / last.limit * 100;
    session.contextQuality = 'reported';
  }
  session.history = samples.slice(-60).flatMap(item => item.limit && item.limit > 0 ? [{ timestamp: item.at, tokens: item.input, limit: item.limit, percent: item.input / item.limit * 100 }] : []);
}
