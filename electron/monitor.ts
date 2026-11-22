import path from 'node:path';
import type { ActionId, AgentSession, AgentSourceConfig, AgentSourceState } from '../src/shared/types.js';
import { registry as defaults } from './adapters/registry.js';
import { sessionKey, unavailableActions, type AdapterConnection, type AdapterRegistry } from './adapters/contract.js';
import { applyContextOverride, overlayTelemetry } from './telemetry.js';
import { estimateSourceCost } from '../src/shared/pricing-catalog.js';

export class AgentMonitor {
  private connections = new Map<string, AdapterConnection>();
  constructor(readonly sources: AgentSourceConfig[], private telemetryRoot: string, registry: AdapterRegistry = defaults) {
    for (const source of sources) if (source.enabled) this.connections.set(source.id, registry[source.runtime].create(source));
  }
  telemetryDirectory(id: string) { return path.join(this.telemetryRoot, id); }
  async refreshControl() { await Promise.allSettled([...this.connections.values()].map(connection => connection.control?.refresh())); }
  async read(): Promise<{ sessions: AgentSession[]; sources: AgentSourceState[]; errors: string[] }> {
    const results = await Promise.allSettled(this.sources.map(async source => {
      const connection = this.connections.get(source.id);
      const result = connection ? await connection.monitor.read() : { sessions: [], exists: false, errors: [] };
      const telemetryDirectory = source.runtime === 'claude-code' ? this.telemetryDirectory(source.id) : null;
      if (telemetryDirectory) await overlayTelemetry(result.sessions, source, telemetryDirectory);
      const sessions = result.sessions.map(native => {
        const session = structuredClone(native);
        const status = connection?.control?.statuses.get(native.id);
        if (status) { session.status = status; session.statusOrigin = 'runtime'; }
        session.runtime = source.runtime; session.sourceId = source.id; session.externalId ||= native.id;
        session.actions = connection?.control?.capabilities(session) ?? unavailableActions();
        applyContextOverride(session, source.contextLimitOverride);
        session.estimatedCost = estimateSourceCost(session.costUsage, source);
        session.id = sessionKey(source.runtime, source.id, native.id);
        session.parentId = native.parentId ? sessionKey(source.runtime, source.id, native.parentId) : null;
        session.forkedFromId = native.forkedFromId ? sessionKey(source.runtime, source.id, native.forkedFromId) : null;
        return session;
      });
      const state: AgentSourceState = { ...source, exists: result.exists, sessions: sessions.length, errors: result.errors, telemetryDirectory,
        control: structuredClone(connection?.control?.state ?? { status: 'unavailable', message: 'To narzędzie udostępnia obecnie tylko podgląd.', loadedThreadIds: [] }) };
      return { sessions, state };
    }));
    const sessions: AgentSession[] = [], sources: AgentSourceState[] = [];
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') { sessions.push(...result.value.sessions); sources.push(result.value.state); }
      else sources.push({ ...this.sources[index], exists: false, sessions: 0, errors: ['Nie udało się odczytać danych. Sprawdź wybrany katalog i uprawnienia.'], telemetryDirectory: null, control: { status: 'unavailable', message: 'Sterowanie tą sesją nie jest dostępne.', loadedThreadIds: [] } });
    });
    sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { sessions, sources, errors: sources.flatMap(source => source.errors.map(error => `${source.id}: ${error}`)) };
  }
  async execute(action: ActionId, session: AgentSession) {
    const connection = this.connections.get(session.sourceId);
    if (!connection?.control) throw new Error('To narzędzie udostępnia obecnie tylko podgląd.');
    return connection.control.execute(action, session);
  }
  preview(session: AgentSession) {
    const prefix = sessionKey(session.runtime, session.sourceId, '');
    if (!session.id.startsWith(prefix)) return null;
    return this.connections.get(session.sourceId)?.monitor.preview?.(decodeURIComponent(session.id.slice(prefix.length))) ?? null;
  }
  dispose() { for (const connection of this.connections.values()) { connection.monitor.dispose(); connection.control?.dispose(); } }
}
