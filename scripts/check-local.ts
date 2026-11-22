import { homedir } from 'node:os';
import path from 'node:path';
import { AgentMonitor } from '../electron/monitor.js';
import { configuredDefaultSources } from '../electron/settings.js';
import { aggregateTreeCosts } from '../src/lib/costs.js';
import { createForest } from '../src/lib/forest.js';

const sources = configuredDefaultSources();
const monitor = new AgentMonitor(sources, path.join(homedir(), 'Library', 'Application Support', 'AI Monitoring', 'telemetry'));
try {
  const first = await monitor.read();
  const second = await monitor.read();
  await monitor.refreshControl();
  const live = await monitor.read();
  console.log(JSON.stringify({
    sources: live.sources.map(source => ({ runtime: source.runtime, exists: source.exists, sessions: source.sessions, control: source.control.status, loaded: source.control.loadedThreadIds.length })),
    roots: live.sessions.filter(s => s.lineage === 'root').length,
    subagents: live.sessions.filter(s => s.lineage !== 'root').length,
    unknownParents: live.sessions.filter(s => s.lineage === 'unknown-parent').length,
    measuredTokens: live.sessions.filter(s => s.contextTokens !== null).length,
    measuredPercent: live.sessions.filter(s => s.contextPercent !== null).length,
    sessionPreviews: live.sources.map(source => ({ runtime: source.runtime, withEvents: live.sessions.filter(session => session.sourceId === source.id && (monitor.preview(session)?.events.length ?? 0) > 0).length })),
    estimatedCosts: live.sources.map(source => {
      const sessions = live.sessions.filter(session => session.sourceId === source.id);
      return {
        runtime: source.runtime, sessions: sessions.length,
        withEstimate: sessions.filter(session => session.estimatedCost.amountUsd !== null).length,
        withoutTokenUsage: sessions.filter(session => session.costUsage.length === 0).length,
        missingRateModels: [...new Set(sessions.flatMap(session => session.estimatedCost.missingModels))],
        treesWithEstimate: [...aggregateTreeCosts(createForest(sessions)).values()].filter(cost => cost.amountUsd !== null).length,
      };
    }),
    stableSecondScan: first.sessions.length === second.sessions.length,
    parseWarnings: live.sessions.reduce((sum, s) => sum + s.warnings.length, 0),
    errors: live.errors,
  }, null, 2));
  if (live.errors.length) process.exitCode = 1;
} finally { monitor.dispose(); }
