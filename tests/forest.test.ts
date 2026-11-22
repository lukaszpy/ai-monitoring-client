import assert from 'node:assert/strict';
import test from 'node:test';
import { createSession } from '../electron/session-parser.js';
import { createForest, descendants, layoutForest, withAncestors } from '../src/lib/forest.ts';

const make = (id: string, parentId: string | null = null) => ({ ...createSession('test'), id, parentId });

test('builds deep hierarchies without an arbitrary level limit or recursive call stack', () => {
  const sessions = Array.from({ length: 2500 }, (_, i) => make(`agent-${i}`, i ? `agent-${i - 1}` : null));
  const forest = createForest(sessions);
  assert.equal(forest.get('agent-2499')!.depth, 2499);
  assert.equal(forest.get('agent-2499')!.rootId, 'agent-0');
  assert.equal(descendants(forest, 'agent-0').size, 2500);
  const layout = layoutForest(forest, new Set(forest.keys()), new Set());
  assert.equal(layout.positions.size, 2500);
});

test('search keeps ancestors, and collapsed branches hide all of their descendants', () => {
  const forest = createForest([make('root'), make('child', 'root'), make('grandchild', 'child'), make('sibling', 'root')]);
  assert.deepEqual([...withAncestors(forest, new Set(['grandchild']))], ['grandchild', 'child', 'root']);
  const layout = layoutForest(forest, new Set(forest.keys()), new Set(['child']));
  assert.equal(layout.shown.has('grandchild'), false);
  assert.equal(layout.shown.has('sibling'), true);
});

test('cycles, self references, and missing parents cannot hang the renderer', () => {
  const forest = createForest([make('a', 'b'), make('b', 'a'), make('c', 'missing'), make('d', 'd')]);
  const roots = [...forest.values()].filter(entry => !entry.parentId);
  assert.equal(roots.length, 3);
  const layout = layoutForest(forest, new Set(forest.keys()), new Set());
  assert.equal(layout.positions.size, 4);
});

test('token and activity updates never move graph nodes', () => {
  const sessions = [make('a'), make('b'), make('c', 'a')];
  const first = createForest(sessions);
  const previous = layoutForest(first, new Set(first.keys()), new Set());
  sessions[1].updatedAt = '2099-01-01'; sessions[2].contextPercent = 91;
  const second = createForest([...sessions].reverse());
  const next = layoutForest(second, new Set(second.keys()), new Set());
  assert.deepEqual(next.positions, previous.positions);
});
