import type { Language } from './i18n.js';

export type AgentStatus = 'running' | 'idle' | 'waiting' | 'completed' | 'interrupted' | 'error' | 'compacting' | 'unknown';
export type SessionSource = 'desktop' | 'vscode' | 'cli' | 'subagent' | 'unknown';
export const RUNTIMES = ['codex', 'claude-code', 'gemini-cli'] as const;
export type RuntimeId = typeof RUNTIMES[number];
export const RUNTIME_LABELS: Record<RuntimeId, string> = { codex: 'Codex', 'claude-code': 'Claude Code', 'gemini-cli': 'Gemini CLI' };
export type ActionId = 'compact' | 'fresh-context';
export type ContextAlertLevel = 'warn' | 'critical';
export const COST_TOKEN_KINDS = ['input', 'cachedInput', 'output', 'cacheWrite', 'cacheWrite5m', 'cacheWrite1h'] as const;
export type CostTokenKind = typeof COST_TOKEN_KINDS[number];
export type CostTokenCounts = Record<CostTokenKind, number>;
export interface ModelPrice { model: string; rates: Record<CostTokenKind, number | null> }
export interface ModelTokenUsage { model: string | null; tokens: CostTokenCounts; complete: boolean; pricingBand?: 'standard' | 'long' | 'unknown' }
export interface SessionCostEstimate { amountUsd: number | null; complete: boolean; missingModels: string[]; incompleteUsage: boolean }
export interface TreeCostEstimate {
  amountUsd: number | null;
  rootUsd: number | null;
  descendantsUsd: number | null;
  complete: boolean;
  sessionCount: number;
  pricedSessionCount: number;
  missingModels: string[];
}
export interface ContextAlertRule {
  threshold: number;
  systemNotification: boolean;
}
export type ContextAlertSettings = Record<ContextAlertLevel, ContextAlertRule>;
export function defaultContextAlerts(): ContextAlertSettings {
  return { warn: { threshold: 70, systemNotification: false }, critical: { threshold: 90, systemNotification: false } };
}

export interface ActionCapability {
  id: ActionId;
  supported: boolean;
  available: boolean;
  reason: string | null;
  effect: 'summarize' | 'create-session';
}

export interface AgentSourceConfig {
  id: string;
  runtime: RuntimeId;
  directory: string;
  enabled: boolean;
  contextLimitOverride: number | null;
  contextAlerts: ContextAlertSettings;
  modelPrices: ModelPrice[];
  useBuiltInPrices: boolean;
}

export interface ContextSample {
  timestamp: string;
  tokens: number;
  limit: number;
  percent: number;
}

export type SessionActivityKind = 'user' | 'assistant' | 'tool' | 'result' | 'status' | 'error';
export interface SessionActivityEvent {
  id: string;
  timestamp: string | null;
  kind: SessionActivityKind;
  name: string | null;
  text: string;
  truncated: boolean;
}
export interface SessionActivity {
  events: SessionActivityEvent[];
  earlierEventsOmitted: boolean;
}
export interface SessionPreview extends SessionActivity {
  sessionId: string;
  scannedAt: string;
}

export interface AgentSession {
  runtime: RuntimeId;
  sourceId: string;
  externalId: string;
  lineage: 'root' | 'parent' | 'unknown-parent';
  contextQuality: 'reported' | 'estimated' | 'unavailable';
  contextMethod: string;
  actions: ActionCapability[];
  id: string;
  parentId: string | null;
  forkedFromId: string | null;
  title: string;
  nickname: string | null;
  role: string | null;
  agentPath: string | null;
  project: string;
  cwd: string;
  model: string | null;
  modelProvider: string | null;
  source: SessionSource;
  status: AgentStatus;
  statusOrigin: 'log' | 'runtime';
  createdAt: string;
  updatedAt: string;
  measuredAt: string | null;
  contextTokens: number | null;
  contextLimit: number | null;
  contextPercent: number | null;
  totalTokens: number;
  costUsage: ModelTokenUsage[];
  estimatedCost: SessionCostEstimate;
  compactions: number;
  history: ContextSample[];
  filePath: string;
  warnings: string[];
}

export interface ControlState {
  status: 'connecting' | 'connected' | 'unavailable';
  message: string;
  loadedThreadIds: string[];
}

export interface MonitorSettings {
  language: Language;
  sources: AgentSourceConfig[];
  launchAtLogin: boolean;
  showCompleted: boolean;
  showEstimatedCosts: boolean;
}

export interface MonitorSnapshot {
  sessions: AgentSession[];
  scannedAt: string;
  scanning: boolean;
  sources: AgentSourceState[];
  sourceDefaults: AgentSourceConfig[];
  systemNotifications: { supported: boolean; error: string | null };
  errors: string[];
  settings: MonitorSettings;
  platform: string;
  version: string;
}

export interface AgentSourceState extends AgentSourceConfig {
  exists: boolean;
  sessions: number;
  errors: string[];
  control: ControlState;
  telemetryDirectory: string | null;
}

export interface ActionResult {
  ok: boolean;
  message: string;
  threadId?: string;
}

export interface MonitorBridge {
  getSnapshot(): Promise<MonitorSnapshot>;
  getSessionPreview(sessionId: string): Promise<SessionPreview>;
  onSnapshot(callback: (snapshot: MonitorSnapshot) => void): () => void;
  onFocusSession(callback: (sessionId: string) => void): () => void;
  refresh(): Promise<void>;
  chooseDirectory(sourceId: string): Promise<void>;
  copyTelemetrySetup(sourceId: string): Promise<void>;
  updateSettings(settings: Partial<Pick<MonitorSettings, 'launchAtLogin' | 'showCompleted' | 'showEstimatedCosts' | 'language' | 'sources'>>): Promise<void>;
  compact(threadId: string): Promise<ActionResult>;
  freshContext(threadId: string): Promise<ActionResult>;
  revealSession(threadId: string): Promise<void>;
  copySessionId(threadId: string): Promise<void>;
}

export const STATUS_LABELS: Record<AgentStatus, string> = {
  running: 'Pracuje', idle: 'Gotowy', waiting: 'Oczekuje', completed: 'Zakończony',
  interrupted: 'Przerwany', error: 'Błąd', compacting: 'Kompaktuje', unknown: 'Brak stanu',
};

export const SOURCE_LABELS: Record<SessionSource, string> = {
  desktop: 'Codex App', vscode: 'VS Code', cli: 'Terminal', subagent: 'Subagent', unknown: 'Codex',
};
