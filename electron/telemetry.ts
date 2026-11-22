import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { AgentSession, AgentSourceConfig } from '../src/shared/types.js';
import { count, object, text, timestamp } from './adapters/records.js';

export async function overlayTelemetry(sessions: AgentSession[], source: AgentSourceConfig, directory: string): Promise<void> {
  const byId = new Map(sessions.map(session => [session.externalId, session]));
  const files = await readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const file of files) {
    if (!file.isFile() || !/^[a-f0-9]{64}\.json$/.test(file.name)) continue;
    try {
      const filename = path.join(directory, file.name);
      if ((await stat(filename)).size > 1024 * 1024) continue;
      const packet = object(JSON.parse(await readFile(filename, 'utf8')));
      if (packet.version !== 1 || packet.runtime !== source.runtime || packet.sourceId !== source.id) continue;
      const id = text(packet.sessionId), observed = timestamp(packet.observedAt), measured = timestamp(packet.measuredAt);
      const session = id ? byId.get(id) : undefined;
      if (!session || !observed || (observed < session.updatedAt || (session.measuredAt && observed < session.measuredAt))) continue;
      const tokens = count(packet.contextTokens), limit = count(packet.contextLimit);
      session.contextTokens = tokens; session.contextLimit = limit && limit > 0 ? limit : null;
      const percent = count(packet.contextPercent);
      session.contextPercent = tokens !== null && session.contextLimit ? percent ?? tokens / session.contextLimit * 100 : null;
      session.measuredAt = tokens === null ? null : measured;
      session.contextQuality = session.contextPercent === null ? 'unavailable' : 'reported';
      session.contextMethod = 'claude-statusline';
      const model = text(packet.model);
      if (model) session.model = model;
    } catch { /* A reporter can be writing or replacing the packet during this scan. */ }
  }
}

export function applyContextOverride(session: AgentSession, limit: number | null): void {
  if (!limit || session.contextLimit) return;
  session.contextLimit = limit;
  session.contextPercent = session.contextTokens === null ? null : session.contextTokens / limit * 100;
  session.contextQuality = session.contextPercent === null ? 'unavailable' : 'estimated';
  session.contextMethod += '+configured-limit';
}
