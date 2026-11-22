import { nativeImage } from 'electron';
import { deflateSync } from 'node:zlib';

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const tag = Buffer.from(type);
  const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([tag, data])));
  return Buffer.concat([size, tag, data, crc]);
}

/** Small original bitmap icon, generated locally; no external images or fonts. */
export function trayIcon(attention = false): Electron.NativeImage {
  const size = 40;
  const rows = Buffer.alloc((size * 4 + 1) * size);
  const nodes = [[20, 9, 6], [9, 29, 5], [31, 29, 5]];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const ring = nodes.some(([cx, cy, radius]) => Math.abs(Math.hypot(x - cx, y - cy) - radius) < 1.7);
    const leftLine = y >= 14 && y <= 24 && Math.abs(x - (20 - (y - 9) * 0.55)) < 1.1;
    const rightLine = y >= 14 && y <= 24 && Math.abs(x - (20 + (y - 9) * 0.55)) < 1.1;
    if (!ring && !leftLine && !rightLine) continue;
    const offset = y * (size * 4 + 1) + 1 + x * 4;
    const color = process.platform === 'darwin' ? [0, 0, 0] : attention ? [248, 181, 87] : [96, 226, 185];
    rows.set([...color, 255], offset);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
  const icon = nativeImage.createFromBuffer(png).resize({ width: 20, height: 20 });
  if (process.platform === 'darwin') icon.setTemplateImage(true);
  return icon;
}
