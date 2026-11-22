import { open, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';

export interface FileInfo { filePath: string; relative: string; modifiedAt: string }
interface Cursor<T> { state: T; offset: number; modified: number; inode: number; pending: string; skipping: boolean; decoder: StringDecoder; warnings: string[] }
export interface FileState<T> { state: T; info: FileInfo; warnings: string[] }

/** Bounded, incremental local input. Symlinked files/directories are never followed. */
export class RecordFileStore<T> {
  private files = new Map<string, Cursor<T>>();
  constructor(
    private directory: string,
    private accept: (relative: string) => boolean,
    private create: (info: FileInfo) => T,
    private apply: (state: T, record: unknown, info: FileInfo) => void,
  ) {}

  private async discover(errors: string[]): Promise<string[]> {
    const result: string[] = [];
    const queue = [{ directory: this.directory, depth: 0 }];
    for (let i = 0; i < queue.length; i++) {
      const current = queue[i];
      let entries;
      try { entries = await readdir(current.directory, { withFileTypes: true }); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') errors.push(`Nie można odczytać katalogu ${current.directory}.`);
        continue;
      }
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        const file = path.join(current.directory, entry.name);
        if (entry.isDirectory() && current.depth < 32) queue.push({ directory: file, depth: current.depth + 1 });
        else if (entry.isFile() && this.accept(path.relative(this.directory, file))) result.push(file);
      }
    }
    return result;
  }

  private warn(cursor: Cursor<T>, text: string) { if (!cursor.warnings.includes(text)) cursor.warnings.push(text); }

  private consume(cursor: Cursor<T>, chunk: string, info: FileInfo) {
    const lines = (cursor.pending + chunk).split('\n');
    cursor.pending = lines.pop() ?? '';
    for (const line of lines) {
      if (cursor.skipping) { cursor.skipping = false; continue; }
      if (!line.trim()) continue;
      if (line.length > 16 * 1024 * 1024) { this.warn(cursor, 'Pominięto rekord większy niż 16 MB.'); continue; }
      try { this.apply(cursor.state, JSON.parse(line), info); }
      catch { this.warn(cursor, 'Pominięto uszkodzony rekord JSONL.'); }
    }
    if (cursor.pending.length > 16 * 1024 * 1024) {
      cursor.pending = ''; cursor.skipping = true; this.warn(cursor, 'Pominięto rekord większy niż 16 MB.');
    }
  }

  private async update(filePath: string): Promise<FileState<T>> {
    const attributes = await stat(filePath);
    const info: FileInfo = { filePath, relative: path.relative(this.directory, filePath), modifiedAt: attributes.mtime.toISOString() };
    const json = filePath.endsWith('.json');
    let cursor = this.files.get(filePath);
    if (!cursor || attributes.ino !== cursor.inode || attributes.size < cursor.offset ||
      (attributes.mtimeMs !== cursor.modified && (json || attributes.size === cursor.offset))) {
      cursor = { state: this.create(info), offset: 0, modified: -1, inode: attributes.ino, pending: '', skipping: false, decoder: new StringDecoder('utf8'), warnings: [] };
      this.files.set(filePath, cursor);
    }
    if (cursor.modified === attributes.mtimeMs && cursor.offset === attributes.size) return { state: cursor.state, info, warnings: cursor.warnings };
    if (json) {
      if (attributes.size > 64 * 1024 * 1024) throw new Error('JSON file size limit exceeded');
      const record = JSON.parse(await readFile(filePath, 'utf8'));
      const state = this.create(info);
      this.apply(state, record, info);
      cursor.state = state; cursor.offset = attributes.size;
    } else {
      const file = await open(filePath, 'r');
      try {
        const buffer = Buffer.allocUnsafe(256 * 1024);
        while (cursor.offset < attributes.size) {
          const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.length, attributes.size - cursor.offset), cursor.offset);
          if (!bytesRead) break;
          cursor.offset += bytesRead;
          this.consume(cursor, cursor.decoder.write(buffer.subarray(0, bytesRead)), info);
        }
      } finally { await file.close(); }
    }
    cursor.modified = attributes.mtimeMs;
    return { state: cursor.state, info, warnings: cursor.warnings };
  }

  async read(): Promise<{ files: FileState<T>[]; exists: boolean; errors: string[] }> {
    const exists = await stat(this.directory).then(s => s.isDirectory(), () => false);
    const errors: string[] = [];
    const paths = await this.discover(errors);
    const present = new Set(paths);
    for (const file of this.files.keys()) if (!present.has(file)) this.files.delete(file);
    const files: FileState<T>[] = [];
    for (let i = 0; i < paths.length; i += 8) {
      const batch = await Promise.allSettled(paths.slice(i, i + 8).map(file => this.update(file)));
      batch.forEach((result, index) => {
        if (result.status === 'fulfilled') files.push(result.value);
        else errors.push(`Nie można odczytać ${path.basename(paths[i + index])}.`);
      });
    }
    return { files, exists, errors };
  }
}
