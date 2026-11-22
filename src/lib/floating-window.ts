export interface Point { x: number; y: number }
export interface Size { width: number; height: number }
export interface WindowFrame { position: Point; size: Size }
export const RESIZE_EDGES = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as const;
export type ResizeEdge = typeof RESIZE_EDGES[number];
export const MIN_PREVIEW_SIZE: Size = { width: 320, height: 240 };

export function constrainSize(size: Size, bounds: Size, padding = 8): Size {
  return {
    width: Math.min(Math.max(0, bounds.width - padding * 2), Math.max(MIN_PREVIEW_SIZE.width, size.width)),
    height: Math.min(Math.max(0, bounds.height - padding * 2), Math.max(MIN_PREVIEW_SIZE.height, size.height)),
  };
}

/** Keep the whole window reachable when the graph or application is resized. */
export function constrainPosition(position: Point, bounds: Size, size: Size, padding = 8): Point {
  return {
    x: Math.max(padding, Math.min(position.x, bounds.width - size.width - padding)),
    y: Math.max(padding, Math.min(position.y, bounds.height - size.height - padding)),
  };
}

/** Resize the selected edges while keeping the opposite edges fixed and reachable. */
export function resizeFrame(frame: WindowFrame, edge: ResizeEdge, delta: Point, bounds: Size, padding = 8): WindowFrame {
  const size = constrainSize(frame.size, bounds, padding);
  const position = constrainPosition(frame.position, bounds, size, padding);
  const minimum = constrainSize({ width: 0, height: 0 }, bounds, padding);
  let left = position.x, top = position.y, right = left + size.width, bottom = top + size.height;
  if (edge.includes('w')) left = Math.max(padding, Math.min(left + delta.x, right - minimum.width));
  if (edge.includes('e')) right = Math.max(left + minimum.width, Math.min(right + delta.x, bounds.width - padding));
  if (edge.includes('n')) top = Math.max(padding, Math.min(top + delta.y, bottom - minimum.height));
  if (edge.includes('s')) bottom = Math.max(top + minimum.height, Math.min(bottom + delta.y, bounds.height - padding));
  return { position: { x: left, y: top }, size: { width: right - left, height: bottom - top } };
}
