import type { AgentSession } from '../shared/types';

export interface ForestEntry {
  session: AgentSession;
  parentId: string | null;
  children: string[];
  depth: number;
  rootId: string;
}

/** Break corrupt cycles without changing the source data; ordinary forks remain roots. */
export function createForest(sessions: AgentSession[]): Map<string, ForestEntry> {
  const entries = new Map<string, ForestEntry>();
  for (const session of sessions) entries.set(session.id, { session, parentId: session.parentId, children: [], depth: 0, rootId: session.id });
  for (const entry of entries.values()) {
    if (!entry.parentId || !entries.has(entry.parentId) || entry.parentId === entry.session.id) entry.parentId = null;
  }
  const resolved = new Set<string>();
  for (const id of entries.keys()) {
    const path = new Set<string>();
    let cursor: string | null = id;
    while (cursor && !resolved.has(cursor)) {
      if (path.has(cursor)) { entries.get(cursor)!.parentId = null; break; }
      path.add(cursor);
      cursor = entries.get(cursor)?.parentId ?? null;
    }
    for (const visited of path) resolved.add(visited);
  }
  for (const entry of entries.values()) if (entry.parentId) entries.get(entry.parentId)!.children.push(entry.session.id);
  for (const entry of entries.values()) entry.children.sort((a, b) => entries.get(a)!.session.createdAt.localeCompare(entries.get(b)!.session.createdAt) || a.localeCompare(b));
  const roots = [...entries.values()].filter(entry => !entry.parentId).sort((a, b) => b.session.updatedAt.localeCompare(a.session.updatedAt));
  const queue = roots.map(entry => ({ id: entry.session.id, depth: 0, rootId: entry.session.id }));
  for (let i = 0; i < queue.length; i++) {
    const item = queue[i]; const entry = entries.get(item.id)!;
    entry.depth = item.depth; entry.rootId = item.rootId;
    for (const child of entry.children) queue.push({ id: child, depth: item.depth + 1, rootId: item.rootId });
  }
  return entries;
}

export function descendants(forest: Map<string, ForestEntry>, rootId: string): Set<string> {
  const result = new Set<string>();
  const queue = [rootId];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    if (result.has(id) || !forest.has(id)) continue;
    result.add(id); queue.push(...forest.get(id)!.children);
  }
  return result;
}

export function withAncestors(forest: Map<string, ForestEntry>, matching: Set<string>): Set<string> {
  const result = new Set<string>();
  for (const id of matching) {
    let cursor: string | null = id;
    while (cursor && !result.has(cursor)) {
      result.add(cursor); cursor = forest.get(cursor)?.parentId ?? null;
    }
  }
  return result;
}

/** Stable hierarchical layout, independent of live percentages. No depth limit and no force jitter. */
export function layoutForest(forest: Map<string, ForestEntry>, visible: Set<string>, collapsed: Set<string>): { positions: Map<string, { x: number; y: number }>; shown: Set<string> } {
  const roots = [...forest.values()].filter(entry => !entry.parentId && visible.has(entry.session.id))
    .sort((a, b) => b.session.createdAt.localeCompare(a.session.createdAt) || a.session.id.localeCompare(b.session.id));
  const positions = new Map<string, { x: number; y: number }>();
  const shown = new Set<string>();
  let shelfX = 0; let shelfY = 0; let shelfHeight = 0;
  const canvasWidth = 1250;
  for (const root of roots) {
    const order: string[] = []; const stack = [root.session.id];
    while (stack.length) {
      const id = stack.pop()!;
      if (!visible.has(id)) continue;
      order.push(id);
      if (!collapsed.has(id)) stack.push(...[...forest.get(id)!.children].reverse());
    }
    const widths = new Map<string, number>();
    let maxDepth = 0;
    for (let i = order.length - 1; i >= 0; i--) {
      const entry = forest.get(order[i])!;
      const childrenWidth = collapsed.has(order[i]) ? 0 : entry.children.reduce((sum, child) => sum + (widths.get(child) ?? 0), 0);
      widths.set(order[i], Math.max(240, childrenWidth));
      maxDepth = Math.max(maxDepth, entry.depth);
    }
    const width = widths.get(root.session.id) ?? 240;
    const height = (maxDepth + 1) * 274;
    if (shelfX > 0 && shelfX + width > canvasWidth) { shelfX = 0; shelfY += shelfHeight + 46; shelfHeight = 0; }
    const lefts = new Map<string, number>([[root.session.id, shelfX]]);
    for (const id of order) {
      const entry = forest.get(id)!;
      const left = lefts.get(id)!;
      positions.set(id, { x: left + (widths.get(id)! - 192) / 2, y: shelfY + entry.depth * 274 });
      shown.add(id);
      let childLeft = left;
      if (!collapsed.has(id)) for (const child of entry.children) {
        if (!widths.has(child)) continue;
        lefts.set(child, childLeft); childLeft += widths.get(child)!;
      }
    }
    shelfX += width + 66; shelfHeight = Math.max(shelfHeight, height);
  }
  return { positions, shown };
}
