import { open, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { applyRecord, createSession } from './session-parser.js';
import type { AgentSession, SessionActivity } from '../src/shared/types.js';
import { ActivityBuffer, recordCodexActivity } from './session-activity.js';

interface Cursor {
  session: AgentSession;
  activity: ActivityBuffer;
  offset: number;
  inode: number;
  modified: number;
  decoder: StringDecoder;
  pending: string;
  skippingLine: boolean;
  recordIndex: number;
  skipHistoryThrough: number;
}

const MAX_LINE = 16 * 1024 * 1024;
const CHUNK = 256 * 1024;

async function rolloutFiles(directory: string, errors: string[]): Promise<string[]> {
  const result: string[] = [];
  async function walk(current: string, depth: number): Promise<void> {
    if (depth > 6) return;
    let entries;
    try { entries = await readdir(current, { withFileTypes: true }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') errors.push(`Nie można odczytać katalogu ${current}.`);
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await walk(path.join(current, entry.name), depth + 1);
      else if (entry.isFile() && entry.name.startsWith('rollout-') && entry.name.endsWith('.jsonl')) result.push(path.join(current, entry.name));
    }
  }
  await walk(directory, 0);
  return result;
}

export class SessionStore {
  private cursors = new Map<string, Cursor>();
  private indexMtime = -1;
  private titles = new Map<string, string>();

  constructor(readonly codexHome: string) {}

  private async readTitles(): Promise<void> {
    const indexPath = path.join(this.codexHome, 'session_index.jsonl');
    try {
      const info = await stat(indexPath);
      if (info.mtimeMs === this.indexMtime) return;
      const data = await readFile(indexPath, 'utf8');
      const titles = new Map<string, string>();
      for (const line of data.split('\n')) {
        try {
          const item = JSON.parse(line);
          if (typeof item.id === 'string' && typeof item.thread_name === 'string') titles.set(item.id, item.thread_name.slice(0, 200));
        } catch { /* A concurrently appended final line will be read on the next scan. */ }
      }
      this.titles = titles;
      this.indexMtime = info.mtimeMs;
    } catch { /* The optional title index isn't present in every Codex version. */ }
  }

  private consume(cursor: Cursor, text: string): void {
    const lines = (cursor.pending + text).split('\n');
    cursor.pending = lines.pop() ?? '';
    for (const line of lines) {
      if (cursor.skippingLine) { cursor.skippingLine = false; cursor.recordIndex++; continue; }
      if (!line.trim()) continue;
      if (line.length > MAX_LINE) { this.warn(cursor, 'Pominięto rekord większy niż 16 MB.'); cursor.recordIndex++; continue; }
      try {
        const record = JSON.parse(line);
        if (cursor.recordIndex === 0 && record.type === 'session_meta') {
          const boundary = record.payload?.subagent_history_start_ordinal;
          if (Number.isSafeInteger(boundary) && boundary >= 0) cursor.skipHistoryThrough = boundary;
        }
        if (cursor.recordIndex === 0 || cursor.recordIndex > cursor.skipHistoryThrough) {
          applyRecord(cursor.session, record);
          recordCodexActivity(cursor.activity, record);
        }
      } catch { this.warn(cursor, 'Pominięto uszkodzony rekord JSONL.'); }
      finally { cursor.recordIndex++; }
    }
    if (cursor.pending.length > MAX_LINE) {
      cursor.pending = '';
      cursor.skippingLine = true;
      this.warn(cursor, 'Pominięto rekord większy niż 16 MB.');
    }
  }

  private warn(cursor: Cursor, warning: string): void {
    if (!cursor.session.warnings.includes(warning)) cursor.session.warnings.push(warning);
  }

  private async updateFile(filePath: string): Promise<void> {
    const info = await stat(filePath);
    let cursor = this.cursors.get(filePath);
    if (!cursor || cursor.inode !== info.ino || info.size < cursor.offset ||
        (info.size === cursor.offset && info.mtimeMs !== cursor.modified)) {
      cursor = { session: createSession(filePath), activity: new ActivityBuffer(), offset: 0, inode: info.ino, modified: 0,
        decoder: new StringDecoder('utf8'), pending: '', skippingLine: false, recordIndex: 0, skipHistoryThrough: 0 };
      this.cursors.set(filePath, cursor);
    }
    if (info.size === cursor.offset) return;
    const file = await open(filePath, 'r');
    try {
      const buffer = Buffer.allocUnsafe(CHUNK);
      // Snapshot the end position: busy sessions must not starve the rest of the scan.
      while (cursor.offset < info.size) {
        const { bytesRead } = await file.read(buffer, 0, Math.min(CHUNK, info.size - cursor.offset), cursor.offset);
        if (!bytesRead) break;
        cursor.offset += bytesRead;
        this.consume(cursor, cursor.decoder.write(buffer.subarray(0, bytesRead)));
      }
      cursor.modified = info.mtimeMs;
    } finally { await file.close(); }
  }

  async scan(): Promise<{ sessions: AgentSession[]; errors: string[]; directoryExists: boolean }> {
    const directory = path.join(this.codexHome, 'sessions');
    const errors: string[] = [];
    const directoryExists = await stat(directory).then(s => s.isDirectory(), () => false);
    const files = await rolloutFiles(directory, errors);
    const present = new Set(files);
    for (const cached of this.cursors.keys()) if (!present.has(cached)) this.cursors.delete(cached);
    // Bounded concurrency avoids exhausting descriptors in a large session archive.
    for (let i = 0; i < files.length; i += 8) {
      const batch = await Promise.allSettled(files.slice(i, i + 8).map(file => this.updateFile(file)));
      for (let j = 0; j < batch.length; j++) {
        const result = batch[j];
        if (result.status === 'rejected') errors.push(`Nie można odczytać ${path.basename(files[i + j])}.`);
      }
    }
    await this.readTitles();
    const byId = new Map<string, AgentSession>();
    for (const { session } of this.cursors.values()) {
      if (!session.id) continue;
      const copy = structuredClone(session);
      copy.title = this.titles.get(copy.id) || copy.title;
      // Old unfinished log records cannot prove that a process is still alive.
      if ((copy.status === 'running' || copy.status === 'compacting') &&
          Date.now() - Date.parse(copy.updatedAt) > 2 * 60_000) copy.status = 'unknown';
      const previous = byId.get(copy.id);
      if (!previous || copy.updatedAt > previous.updatedAt) byId.set(copy.id, copy);
    }
    return { sessions: [...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), errors, directoryExists };
  }

  preview(id: string): SessionActivity | null {
    let selected: Cursor | undefined;
    for (const cursor of this.cursors.values()) if (cursor.session.id === id && (!selected || cursor.session.updatedAt > selected.session.updatedAt)) selected = cursor;
    return selected?.activity.snapshot() ?? null;
  }
}
