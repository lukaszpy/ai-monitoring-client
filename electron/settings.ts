import path from 'node:path';
import { homedir } from 'node:os';
import { isLanguage, resolveLanguage } from '../src/shared/i18n.js';
import { COST_TOKEN_KINDS, defaultContextAlerts, RUNTIMES, type AgentSourceConfig, type ContextAlertSettings, type ModelPrice, type MonitorSettings, type RuntimeId } from '../src/shared/types.js';

export function validateModelPrices(value: unknown): ModelPrice[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) throw new Error('Nieprawidłowe stawki modeli.');
  const models = new Set<string>();
  return value.map(item => {
    if (!item || typeof item !== 'object' || typeof item.model !== 'string' || !item.model.trim() || item.model.length > 200 || models.has(item.model.trim()) || !item.rates || typeof item.rates !== 'object' || Array.isArray(item.rates)) throw new Error('Nieprawidłowe stawki modeli.');
    const rates = {} as ModelPrice['rates'];
    for (const kind of COST_TOKEN_KINDS) {
      const rate: unknown = item.rates[kind];
      if (rate !== null && (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0 || rate > 1e9)) throw new Error('Nieprawidłowe stawki modeli.');
      rates[kind] = rate as number | null;
    }
    models.add(item.model.trim());
    return { model: item.model.trim(), rates };
  });
}

export function validateContextAlerts(value: unknown): ContextAlertSettings {
  if (value === undefined) return defaultContextAlerts(); // Migrate sources saved before alerts existed.
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Nieprawidłowe progi powiadomień. Wymagane: 1–100% i Warn < Critical.');
  const settings = value as ContextAlertSettings;
  for (const level of ['warn', 'critical'] as const) {
    const rule = settings[level];
    if (!rule || typeof rule !== 'object' || !Number.isInteger(rule.threshold) || rule.threshold < 1 || rule.threshold > 100 || typeof rule.systemNotification !== 'boolean') throw new Error('Nieprawidłowe progi powiadomień. Wymagane: 1–100% i Warn < Critical.');
  }
  if (settings.warn.threshold >= settings.critical.threshold) throw new Error('Nieprawidłowe progi powiadomień. Wymagane: 1–100% i Warn < Critical.');
  return { warn: { threshold: settings.warn.threshold, systemNotification: settings.warn.systemNotification }, critical: { threshold: settings.critical.threshold, systemNotification: settings.critical.systemNotification } };
}

export function validateSources(value: unknown): AgentSourceConfig[] {
  if (!Array.isArray(value) || value.length > 24) throw new Error('Nieprawidłowe źródła danych.');
  const ids = new Set<string>();
  return value.map(item => {
    if (!item || typeof item !== 'object') throw new Error('Nieprawidłowe źródła danych.');
    const source = item as AgentSourceConfig;
    if (typeof source.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(source.id) || ids.has(source.id) ||
      !RUNTIMES.includes(source.runtime) || typeof source.directory !== 'string' || source.directory.length > 8192 || !path.isAbsolute(source.directory) ||
      typeof source.enabled !== 'boolean' || (source.contextLimitOverride !== null && (!Number.isSafeInteger(source.contextLimitOverride) || source.contextLimitOverride <= 0 || source.contextLimitOverride > 1e9))) throw new Error('Nieprawidłowe źródła danych.');
    if (source.useBuiltInPrices !== undefined && typeof source.useBuiltInPrices !== 'boolean') throw new Error('Nieprawidłowe ustawienia.');
    ids.add(source.id);
    return { id: source.id, runtime: source.runtime, directory: path.resolve(source.directory), enabled: source.enabled, contextLimitOverride: source.contextLimitOverride, contextAlerts: validateContextAlerts(source.contextAlerts), modelPrices: validateModelPrices(source.modelPrices), useBuiltInPrices: source.useBuiltInPrices ?? (source.runtime === 'codex') };
  });
}

export function standardSourceDirectories(homeDirectory = homedir(), platform: NodeJS.Platform = process.platform): Record<RuntimeId, string> {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  return { codex: paths.join(homeDirectory, '.codex'), 'claude-code': paths.join(homeDirectory, '.claude'), 'gemini-cli': paths.join(homeDirectory, '.gemini') };
}

export function defaultSources(codexHome = standardSourceDirectories().codex, homes?: Partial<Record<RuntimeId, string>>): AgentSourceConfig[] {
  const directories = { ...standardSourceDirectories(), codex: codexHome, ...homes };
  return RUNTIMES.map(runtime => ({ id: runtime, runtime, directory: directories[runtime], enabled: true, contextLimitOverride: null, contextAlerts: defaultContextAlerts(), modelPrices: [], useBuiltInPrices: runtime === 'codex' }));
}

export function configuredDefaultSources(environment: NodeJS.ProcessEnv = process.env): AgentSourceConfig[] {
  const standard = standardSourceDirectories();
  return defaultSources(path.resolve(environment.CODEX_HOME || standard.codex), {
    'claude-code': path.resolve(environment.CLAUDE_CONFIG_DIR || standard['claude-code']),
    'gemini-cli': path.resolve(environment.AI_MONITORING_GEMINI_HOME || standard['gemini-cli']),
  });
}

export function settingsFromDisk(value: unknown, sourceDefaults = configuredDefaultSources()): MonitorSettings {
  const defaults: MonitorSettings = { sources: structuredClone(sourceDefaults), launchAtLogin: false, showCompleted: true, showEstimatedCosts: true, language: 'pl' };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults;
  const saved = value as Record<string, unknown>;
  const codex = defaults.sources.find(source => source.runtime === 'codex');
  if (codex && typeof saved.codexHome === 'string' && path.isAbsolute(saved.codexHome)) codex.directory = saved.codexHome;
  if ('sources' in saved) { try { defaults.sources = validateSources(saved.sources); } catch { /* Keep valid defaults if damaged. */ } }
  if (typeof saved.showCompleted === 'boolean') defaults.showCompleted = saved.showCompleted;
  if (typeof saved.showEstimatedCosts === 'boolean') defaults.showEstimatedCosts = saved.showEstimatedCosts;
  defaults.language = resolveLanguage(saved.language);
  // Autostart is read from the OS, not trusted from this file.
  return defaults;
}

export function validateSettingsPatch(value: unknown): Partial<Pick<MonitorSettings, 'language' | 'showCompleted' | 'showEstimatedCosts' | 'launchAtLogin' | 'sources'>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Nieprawidłowe ustawienia.');
  const input = value as Record<string, unknown>;
  if ('language' in input && !isLanguage(input.language)) throw new Error('Nieprawidłowy język.');
  if ('showEstimatedCosts' in input && typeof input.showEstimatedCosts !== 'boolean') throw new Error('Nieprawidłowe ustawienia.');
  return {
    ...('sources' in input ? { sources: validateSources(input.sources) } : {}),
    ...(isLanguage(input.language) ? { language: input.language } : {}),
    ...(typeof input.showCompleted === 'boolean' ? { showCompleted: input.showCompleted } : {}),
    ...(typeof input.showEstimatedCosts === 'boolean' ? { showEstimatedCosts: input.showEstimatedCosts } : {}),
    ...(typeof input.launchAtLogin === 'boolean' ? { launchAtLogin: input.launchAtLogin } : {}),
  };
}
