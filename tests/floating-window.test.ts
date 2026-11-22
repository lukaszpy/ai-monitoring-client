import assert from 'node:assert/strict';
import test from 'node:test';
import { constrainSize, MIN_PREVIEW_SIZE, RESIZE_EDGES, resizeFrame, type ResizeEdge } from '../src/lib/floating-window.ts';

const bounds = { width: 1400, height: 900 };
const frame = { position: { x: 200, y: 150 }, size: { width: 560, height: 390 } };

test('preview sizing respects minimum dimensions and can fit a viewport smaller than that minimum', () => {
  assert.deepEqual(constrainSize({ width: 10, height: 10 }, bounds), MIN_PREVIEW_SIZE);
  assert.deepEqual(constrainSize(frame.size, bounds), frame.size);
  assert.deepEqual(constrainSize(frame.size, { width: 280, height: 200 }), { width: 264, height: 184 });
  assert.deepEqual(constrainSize({ width: 3000, height: 2000 }, bounds), { width: 1384, height: 884 });
});

test('all eight resize handles change only the dragged edges and keep opposite edges anchored', () => {
  const expected: Record<ResizeEdge, [number, number, number, number]> = {
    n: [200, 180, 560, 360], ne: [200, 180, 600, 360], e: [200, 150, 600, 390], se: [200, 150, 600, 420],
    s: [200, 150, 560, 420], sw: [240, 150, 520, 420], w: [240, 150, 520, 390], nw: [240, 180, 520, 360],
  };
  for (const edge of RESIZE_EDGES) {
    const actual = resizeFrame(frame, edge, { x: 40, y: 30 }, bounds);
    assert.deepEqual([actual.position.x, actual.position.y, actual.size.width, actual.size.height], expected[edge], edge);
  }
});

test('shrinking cannot cross the minimum or move the opposite corner', () => {
  assert.deepEqual(resizeFrame(frame, 'se', { x: -10000, y: -10000 }, bounds), { position: frame.position, size: MIN_PREVIEW_SIZE });
  assert.deepEqual(resizeFrame(frame, 'nw', { x: 10000, y: 10000 }, bounds), { position: { x: 440, y: 300 }, size: MIN_PREVIEW_SIZE });
});

test('expanding beyond each boundary stays inside the graph without shifting the anchored edge', () => {
  assert.deepEqual(resizeFrame(frame, 'se', { x: 10000, y: 10000 }, bounds), { position: frame.position, size: { width: 1192, height: 742 } });
  assert.deepEqual(resizeFrame(frame, 'nw', { x: -10000, y: -10000 }, bounds), { position: { x: 8, y: 8 }, size: { width: 752, height: 532 } });
});

test('resizing in a constrained viewport remains usable and never mutates the previous frame or preferences', () => {
  const saved = structuredClone(frame);
  const result = resizeFrame(frame, 'se', { x: 300, y: 300 }, { width: 280, height: 200 });
  assert.deepEqual(result, { position: { x: 8, y: 8 }, size: { width: 264, height: 184 } });
  assert.deepEqual(frame, saved);
  const expanded = resizeFrame(frame, 'w', { x: -40, y: 0 }, bounds);
  assert.deepEqual(resizeFrame(expanded, 'w', { x: 40, y: 0 }, bounds), frame);
});
