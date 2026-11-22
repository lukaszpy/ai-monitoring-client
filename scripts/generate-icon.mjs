import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const tag = Buffer.from(type); const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([tag, data])));
  return Buffer.concat([length, tag, data, crc]);
}
function segmentDistance(px, py, ax, ay, bx, by) {
  const t = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
  return Math.hypot(px - ax - t * (bx - ax), py - ay - t * (by - ay));
}
const size = 512;
const rows = Buffer.alloc((size * 4 + 1) * size);
const nodes = [[256, 143, 49], [147, 350, 49], [365, 350, 49]];
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  const dx = Math.max(Math.abs(x - 255.5) - 154, 0);
  const dy = Math.max(Math.abs(y - 255.5) - 154, 0);
  if (Math.hypot(dx, dy) > 100) continue;
  const offset = y * (size * 4 + 1) + 1 + x * 4;
  const gradient = (x + y) / (size * 2);
  let color = [Math.round(28 - 15 * gradient), Math.round(49 - 26 * gradient), Math.round(52 - 22 * gradient), 255];
  const ring = nodes.some(([cx, cy, radius]) => Math.abs(Math.hypot(x - cx, y - cy) - radius) <= 6);
  const dot = nodes.some(([cx, cy]) => Math.hypot(x - cx, y - cy) <= 7);
  const line = segmentDistance(x, y, 231, 188, 174, 302) <= 5 || segmentDistance(x, y, 281, 188, 338, 302) <= 5;
  if (line) color = [90, 181, 158, 255];
  if (ring || dot) color = [135, 235, 199, 255];
  rows.set(color, offset);
}
const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
const directory = new URL('../assets/', import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(new URL('icon.png', directory), png);
console.log(`Generated ${fileURLToPath(new URL('icon.png', directory))}`);
