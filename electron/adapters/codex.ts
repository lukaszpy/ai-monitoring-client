import { CodexControl } from '../codex-control.js';
import { SessionStore } from '../session-store.js';
import type { ActionCapability, ActionId, AgentSession } from '../../src/shared/types.js';
import type { ControlAdapter, MonitoringAdapter } from './contract.js';

export class CodexAdapter implements MonitoringAdapter {
  readonly runtime = 'codex' as const;
  private store: SessionStore;
  constructor(directory: string) { this.store = new SessionStore(directory); }
  async read() {
    const result = await this.store.scan();
    return { sessions: result.sessions.map(session => ({ ...session, externalId: session.id })), errors: result.errors, exists: result.directoryExists };
  }
  preview(id: string) { return this.store.preview(id); }
  dispose() {}
}

export class CodexController implements ControlAdapter {
  private control: CodexControl;
  constructor(directory: string) { this.control = new CodexControl(directory); }
  get state() { return this.control.state; }
  get statuses() { return this.control.statuses; }
  refresh() { return this.control.poll(); }
  capabilities(session: AgentSession): ActionCapability[] {
    const id = session.externalId || session.id;
    const reason = this.state.status !== 'connected' ? 'Sterowanie tą sesją nie jest dostępne.'
      : !this.state.loadedThreadIds.includes(id) ? 'Ta sesja nie jest załadowana w podłączonym serwerze Codex.'
      : this.statuses.get(id) !== 'idle' ? 'Poczekaj, aż agent zakończy bieżącą pracę. Operacja wymaga gotowej sesji.' : null;
    return [
      { id: 'compact', supported: true, available: reason === null, reason, effect: 'summarize' },
      { id: 'fresh-context', supported: session.lineage === 'root', available: reason === null && session.lineage === 'root', reason: session.lineage !== 'root' ? 'Świeży kontekst subagenta wymaga utworzenia nowego agenta przez rodzica.' : reason, effect: 'create-session' },
    ];
  }
  async execute(action: ActionId, session: AgentSession) {
    const capability = this.capabilities(session).find(item => item.id === action);
    if (!capability?.available) throw new Error(capability?.reason ?? 'Sterowanie tą sesją nie jest dostępne.');
    const native = { ...session, id: session.externalId || session.id };
    if (action === 'compact') {
      await this.control.compact(native);
      return { ok: true, message: 'Codex przyjął zlecenie kompakcji. Pomiar odświeży się po otrzymaniu nowych danych.' };
    }
    const threadId = await this.control.freshContext(native);
    return { ok: true, message: threadId, threadId };
  }
  dispose() { this.control.dispose(); }
}
