import type { TreeCostEstimate } from '../shared/types';
import type { ForestEntry } from './forest';

/** Aggregate the complete forest, before any view filter or branch collapse is applied. */
export function aggregateTreeCosts(forest: Map<string, ForestEntry>): Map<string, TreeCostEstimate> {
  const result = new Map<string, TreeCostEstimate>();
  const uncertainSources = new Set<string>();
  for (const entry of forest.values()) if (entry.session.lineage === 'unknown-parent' || (entry.session.parentId && entry.parentId !== entry.session.parentId)) uncertainSources.add(entry.session.sourceId);
  const missing = new Map<string, Set<string>>();
  for (const entry of forest.values()) {
    const root = result.get(entry.rootId) ?? { amountUsd: null, rootUsd: null, descendantsUsd: null, complete: true, sessionCount: 0, pricedSessionCount: 0, missingModels: [] };
    const estimate = entry.session.estimatedCost;
    root.sessionCount++;
    root.complete &&= estimate.complete && !uncertainSources.has(entry.session.sourceId);
    if (estimate.complete) root.pricedSessionCount++;
    if (estimate.amountUsd !== null) {
      root.amountUsd = (root.amountUsd ?? 0) + estimate.amountUsd;
      if (entry.session.id === entry.rootId) root.rootUsd = estimate.amountUsd;
      else root.descendantsUsd = (root.descendantsUsd ?? 0) + estimate.amountUsd;
    }
    const models = missing.get(entry.rootId) ?? new Set<string>();
    for (const model of estimate.missingModels) models.add(model);
    missing.set(entry.rootId, models);
    result.set(entry.rootId, root);
  }
  for (const [id, total] of result) {
    total.missingModels = [...(missing.get(id) ?? [])];
    if (total.sessionCount === 1) total.descendantsUsd = 0;
    for (const field of ['amountUsd', 'rootUsd', 'descendantsUsd'] as const) if (total[field] !== null && !Number.isFinite(total[field])) { total[field] = null; total.complete = false; }
  }
  return result;
}
