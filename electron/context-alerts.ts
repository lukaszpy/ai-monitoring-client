import type { AgentSession, AgentSourceConfig, ContextAlertLevel } from '../src/shared/types.js';

export interface ContextAlert {
  level: ContextAlertLevel;
  threshold: number;
  percent: number;
  session: AgentSession;
  source: AgentSourceConfig;
}
interface SessionState {
  sample: string;
  measuredAt: number;
  compactions: number;
  latched: Record<ContextAlertLevel, boolean>;
}
interface SourceState { signature: string; armedAt: number; sessions: Map<string, SessionState> }
const levels = ['warn', 'critical'] as const;
const MAX_MEASUREMENT_AGE = 5 * 60_000;

/** Pure crossing detector. No notifications, filesystem, or provider-specific logic here. */
export class ContextAlertMonitor {
  private sources = new Map<string, SourceState>();

  evaluate(sessions: AgentSession[], sources: AgentSourceConfig[], now = Date.now()): ContextAlert[] {
    const enabled = new Set(sources.filter(source => source.enabled).map(source => source.id));
    for (const id of this.sources.keys()) if (!enabled.has(id)) this.sources.delete(id);
    const grouped = new Map<string, AgentSession[]>();
    for (const session of sessions) {
      const list = grouped.get(session.sourceId) ?? [];
      list.push(session); grouped.set(session.sourceId, list);
    }
    const alerts: ContextAlert[] = [];
    for (const source of sources) {
      if (!source.enabled) continue;
      const signature = JSON.stringify([source.runtime, source.directory, source.contextLimitOverride, source.contextAlerts]);
      let tracker = this.sources.get(source.id);
      const baseline = !tracker || tracker.signature !== signature;
      if (baseline) { tracker = { signature, armedAt: now, sessions: new Map() }; this.sources.set(source.id, tracker); }
      const current = tracker!;
      for (const session of grouped.get(source.id) ?? []) {
        if (session.runtime !== source.runtime) continue;
        const percent = session.contextPercent;
        const measuredAt = Date.parse(session.measuredAt ?? '');
        const known = percent !== null && Number.isFinite(percent) && percent >= 0 && Number.isFinite(measuredAt) && session.contextQuality !== 'unavailable';
        const sample = JSON.stringify([session.measuredAt, percent, session.contextLimit, session.contextQuality, session.compactions]);
        let previous = current.sessions.get(session.id);
        if (!previous) {
          previous = { sample: '', measuredAt: 0, compactions: session.compactions, latched: { warn: false, critical: false } };
          current.sessions.set(session.id, previous);
          // Baseline existing transcripts on startup/configuration changes. New sessions may alert later.
          if (baseline || !known || measuredAt < current.armedAt) {
            previous.sample = sample; previous.measuredAt = known ? measuredAt : 0;
            for (const level of levels) previous.latched[level] = known && percent! >= source.contextAlerts[level].threshold;
            continue;
          }
        }
        if (previous.compactions !== session.compactions) {
          previous.compactions = session.compactions;
          previous.latched = { warn: false, critical: false };
        }
        if (sample === previous.sample) continue;
        previous.sample = sample;
        if (!known) continue; // Missing data does not re-arm an already emitted alert.
        const fresh = measuredAt >= previous.measuredAt && measuredAt >= now - MAX_MEASUREMENT_AGE && measuredAt <= now + 60_000;
        previous.measuredAt = Math.max(previous.measuredAt, measuredAt);
        let highest: ContextAlert | null = null;
        for (const level of levels) {
          const rule = source.contextAlerts[level];
          // Hysteresis prevents noise when a prompt oscillates just around a threshold.
          const resetBelow = rule.threshold - Math.min(5, rule.threshold / 2);
          if (percent! <= resetBelow) previous.latched[level] = false;
          if (percent! >= rule.threshold && !previous.latched[level]) {
            previous.latched[level] = true;
            if (fresh && rule.systemNotification) highest = { level, threshold: rule.threshold, percent: percent!, session, source };
          }
        }
        if (highest) alerts.push(highest); // A jump across both levels emits only the highest enabled level.
      }
    }
    return alerts;
  }
}
