import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { createInterface, type Interface } from 'node:readline';
import { runtimeStatus } from './session-parser.js';
import type { AgentSession, AgentStatus, ControlState } from '../src/shared/types.js';

type Data = Record<string, unknown>;
const obj = (value: unknown): Data => value && typeof value === 'object' && !Array.isArray(value) ? value as Data : {};
interface Pending { resolve: (value: Data) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }

function executable(): string {
  if (process.env.AI_MONITORING_CODEX_BIN) return process.env.AI_MONITORING_CODEX_BIN;
  // Finder-launched apps don't inherit the interactive shell's PATH.
  const candidates = process.platform === 'win32'
    ? [path.join(homedir(), '.local', 'bin', 'codex.exe')]
    : ['/opt/homebrew/bin/codex', '/usr/local/bin/codex', path.join(homedir(), '.local', 'bin', 'codex')];
  return candidates.find(file => existsSync(file)) ?? (process.platform === 'win32' ? 'codex.exe' : 'codex');
}

/** Connects only to an EXISTING daemon. Never starts another server or resumes someone else's thread. */
export class CodexControl {
  state: ControlState = { status: 'unavailable', message: 'Sprawdzanie połączenia z Codex…', loadedThreadIds: [] };
  readonly statuses = new Map<string, AgentStatus>();
  private child: ChildProcessWithoutNullStreams | null = null;
  private reader: Interface | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private retryAt = 0;
  private polling = false;
  private disposed = false;

  constructor(private codexHome: string, private transport?: { command: string; args: string[] }) {}

  private send(value: unknown): void {
    if (!this.child?.stdin.writable) throw new Error('Brak połączenia z procesem Codex.');
    this.child.stdin.write(`${JSON.stringify(value)}\n`);
  }

  private request(method: string, params: unknown = {}): Promise<Data> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Codex nie odpowiedział w ciągu 8 sekund.')); }, 8_000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ id, method, params }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }

  private receive(line: string): void {
    let message: Data;
    try { message = obj(JSON.parse(line)); } catch { return; }
    if (typeof message.id === 'number' && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(String(obj(message.error).message ?? 'Codex odrzucił operację.')));
      else pending.resolve(obj(message.result));
    } else if (message.method === 'thread/status/changed') {
      const params = obj(message.params);
      if (typeof params.threadId === 'string') this.statuses.set(params.threadId, runtimeStatus(params.status));
    } else if (message.id !== undefined && typeof message.method === 'string') {
      // A monitor must never grant an approval or execute a tool on behalf of another client.
      this.send({ id: message.id, error: { code: -32601, message: 'AI Monitoring is a monitoring client; this request requires the owning Codex client.' } });
    }
  }

  private disconnect(): void {
    this.reader?.close();
    this.reader = null;
    const child = this.child;
    this.child = null;
    child?.kill();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Połączenie z Codex zostało zakończone.'));
    }
    this.pending.clear();
    this.statuses.clear();
    this.state = { status: 'unavailable', message: 'Podgląd z plików działa. Sterowanie wymaga dostępnego lokalnego serwera Codex.', loadedThreadIds: [] };
    this.retryAt = Date.now() + 30_000;
  }

  private async connect(): Promise<void> {
    this.state = { status: 'connecting', message: 'Łączenie z lokalnym Codex…', loadedThreadIds: [] };
    const child = spawn(this.transport?.command ?? executable(), this.transport?.args ?? ['app-server', 'proxy'], {
      env: { ...process.env, CODEX_HOME: this.codexHome }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    this.reader = createInterface({ input: child.stdout });
    this.reader.on('line', line => this.receive(line));
    child.stderr.resume(); // Never forward Codex logs, configuration, or credentials into the renderer.
    child.stdin.on('error', () => { if (this.child === child) this.disconnect(); });
    child.on('error', () => { if (this.child === child) this.disconnect(); });
    child.on('exit', () => { if (this.child === child) this.disconnect(); });
    await this.request('initialize', { clientInfo: { name: 'ai_monitoring', title: 'AI Monitoring', version: '0.6.1' }, capabilities: {} });
    this.send({ method: 'initialized' });
    this.state = { status: 'connected', message: 'Połączono z lokalnym serwerem Codex.', loadedThreadIds: [] };
  }

  async poll(): Promise<void> {
    if (this.disposed || this.polling || (this.state.status !== 'connected' && Date.now() < this.retryAt)) return;
    this.polling = true;
    try {
      if (!this.child) await this.connect();
      const loaded: string[] = [];
      let cursor: string | undefined;
      const seenCursors = new Set<string>();
      do {
        const page = await this.request('thread/loaded/list', { cursor, limit: 100 });
        if (Array.isArray(page.data)) loaded.push(...page.data.filter((id): id is string => typeof id === 'string'));
        cursor = typeof page.nextCursor === 'string' ? page.nextCursor : undefined;
        if (cursor && seenCursors.has(cursor)) break;
        if (cursor) seenCursors.add(cursor);
      } while (cursor);
      const loadedIds = new Set(loaded);
      for (const id of this.statuses.keys()) if (!loadedIds.has(id)) this.statuses.delete(id);
      for (let i = 0; i < loaded.length; i += 6) {
        await Promise.all(loaded.slice(i, i + 6).map(async threadId => {
          try {
            const result = await this.request('thread/read', { threadId, includeTurns: false });
            this.statuses.set(threadId, runtimeStatus(obj(result.thread).status));
          } catch { this.statuses.set(threadId, 'unknown'); }
        }));
      }
      this.state = { status: 'connected', message: 'Połączono z lokalnym serwerem Codex.', loadedThreadIds: loaded };
    } catch { this.disconnect(); }
    finally { this.polling = false; }
  }

  private async assertIdle(threadId: string): Promise<void> {
    if (this.state.status !== 'connected') throw new Error('Sterowanie tą sesją nie jest dostępne.');
    if (!this.state.loadedThreadIds.includes(threadId)) throw new Error('Ta sesja nie jest załadowana w podłączonym serwerze Codex.');
    const result = await this.request('thread/read', { threadId, includeTurns: false });
    if (runtimeStatus(obj(result.thread).status) !== 'idle') throw new Error('Poczekaj, aż agent zakończy bieżącą pracę. Operacja wymaga gotowej sesji.');
  }

  async compact(session: AgentSession): Promise<void> {
    await this.assertIdle(session.id);
    await this.request('thread/compact/start', { threadId: session.id });
    this.statuses.set(session.id, 'compacting');
  }

  async freshContext(session: AgentSession): Promise<string> {
    if (session.parentId) throw new Error('Codex nie udostępnia resetu subagenta z zachowaniem relacji z rodzicem. Utwórz nowego subagenta z sesji nadrzędnej.');
    await this.assertIdle(session.id);
    // A new root with the same workspace/model; no transcript or tool results are copied.
    // The original client remains on its original thread. Do not masquerade as an in-place reset.
    const result = await this.request('thread/start', {
      cwd: session.cwd || undefined, model: session.model ?? undefined,
      modelProvider: session.modelProvider ?? undefined, serviceName: 'ai_monitoring',
    });
    const id = obj(result.thread).id;
    if (typeof id !== 'string') throw new Error('Codex nie zwrócił identyfikatora nowej sesji.');
    return id;
  }

  dispose(): void { this.disposed = true; this.disconnect(); }
}
