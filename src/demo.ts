import type { AgentSession, MonitorSnapshot } from './shared/types';
import { translate, type Language } from './shared/i18n';

export function demoSnapshot(language: Language = 'pl'): MonitorSnapshot {
  const now = Date.now();
  const make = (id: string, project: string, percent: number, parentId: string | null, nickname: string | null, role: string | null, status: AgentSession['status']): AgentSession => {
    const limit = 475_000;
    return {
      runtime: 'codex', sourceId: 'codex', externalId: id, lineage: parentId ? 'parent' : 'root', contextQuality: 'reported', contextMethod: 'demo', actions: [],
      id, project, parentId, nickname, role, title: parentId ? `${role} · ${project}` : translate(language, 'Praca nad {project}', { project }),
      forkedFromId: null, agentPath: parentId ? `/root/${role}` : '/root', cwd: `/Projects/${project}`,
      model: 'gpt-6.2-sol', modelProvider: 'openai', source: parentId ? 'subagent' : id === 'demo-production' ? 'cli' : 'vscode',
      status, statusOrigin: 'log', createdAt: new Date(now - 3_600_000).toISOString(),
      updatedAt: new Date(now - 4000).toISOString(), measuredAt: new Date(now - 4000).toISOString(),
      contextTokens: Math.round(limit * percent / 100), contextLimit: limit, contextPercent: percent,
      totalTokens: 2_130_441, costUsage: [], estimatedCost: { amountUsd: percent / 100, complete: true, missingModels: [], incompleteUsage: false }, compactions: id === 'demo-configurator' ? 1 : 0,
      history: Array.from({ length: 20 }, (_, i) => ({ timestamp: new Date(now - (20 - i) * 45_000).toISOString(), tokens: Math.round(limit * percent * (0.2 + 0.8 * i / 19) / 100), limit, percent: percent * (0.2 + 0.8 * i / 19) })),
      filePath: '', warnings: [],
    };
  };
  return {
    sessions: [
      make('demo-configurator', 'demo-motors-configurator', 42, null, null, null, 'running'),
      make('demo-axle', 'demo-motors-configurator', 76, 'demo-configurator', 'Axle', 'jvm-router', 'running'),
      make('demo-spark', 'demo-motors-configurator', 23, 'demo-axle', 'Spark', 'jvm-planner', 'completed'),
      make('demo-torque', 'demo-motors-configurator', 58, 'demo-axle', 'Torque', 'jvm-reviewer', 'waiting'),
      make('demo-piston', 'demo-motors-configurator', 31, 'demo-configurator', 'Piston', 'unit-test-expert', 'running'),
      make('demo-production', 'demo-motors-production', 91, null, null, null, 'idle'),
      make('demo-gear', 'demo-motors-production', 36, 'demo-production', 'Gear', 'explorer', 'completed'),
    ],
    scanning: false, scannedAt: new Date(now).toISOString(), sources: [], sourceDefaults: [], systemNotifications: { supported: false, error: null }, errors: [],
    settings: { sources: [], launchAtLogin: false, showCompleted: true, showEstimatedCosts: true, language },
    platform: 'preview', version: '0.6.1',
  };
}
