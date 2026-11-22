import type { ActionCapability, ActionId, ActionResult, AgentSession, AgentSourceConfig, ControlState, RuntimeId, SessionActivity } from '../../src/shared/types.js';

export interface AdapterSnapshot {
  sessions: AgentSession[];
  exists: boolean;
  errors: string[];
}

/** Provider-local IDs live inside adapters. The coordinator namespaces them before publishing. */
export interface MonitoringAdapter {
  readonly runtime: RuntimeId;
  read(): Promise<AdapterSnapshot>;
  preview?(nativeSessionId: string): SessionActivity | null;
  dispose(): void;
}

/** Monitoring and control are independent; a runtime need not provide a controller. */
export interface ControlAdapter {
  readonly state: ControlState;
  readonly statuses: ReadonlyMap<string, AgentSession['status']>;
  refresh(): Promise<void>;
  capabilities(session: AgentSession): ActionCapability[];
  execute(action: ActionId, session: AgentSession): Promise<ActionResult>;
  dispose(): void;
}

export interface AdapterConnection {
  monitor: MonitoringAdapter;
  control?: ControlAdapter;
}

export interface RuntimeDefinition {
  storageFolder: string;
  create(source: AgentSourceConfig): AdapterConnection;
}

export type AdapterRegistry = Record<RuntimeId, RuntimeDefinition>;

export function sessionKey(runtime: RuntimeId, sourceId: string, nativeId: string): string {
  return [runtime, sourceId, nativeId].map(encodeURIComponent).join(':');
}

export function unavailableActions(reason = 'To narzędzie udostępnia obecnie tylko podgląd.'): ActionCapability[] {
  return [
    { id: 'compact', supported: false, available: false, reason, effect: 'summarize' },
    { id: 'fresh-context', supported: false, available: false, reason, effect: 'create-session' },
  ];
}
