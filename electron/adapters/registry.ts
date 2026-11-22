import type { AdapterRegistry } from './contract.js';
import { CodexAdapter, CodexController } from './codex.js';
import { ClaudeAdapter } from './claude.js';
import { GeminiAdapter } from './gemini.js';

/** Register another runtime here; the graph and IPC do not depend on its log format. */
export const registry: AdapterRegistry = {
  codex: { storageFolder: '.codex', create: source => ({ monitor: new CodexAdapter(source.directory), control: new CodexController(source.directory) }) },
  'claude-code': { storageFolder: '.claude', create: source => ({ monitor: new ClaudeAdapter(source.directory) }) },
  'gemini-cli': { storageFolder: '.gemini', create: source => ({ monitor: new GeminiAdapter(source.directory) }) },
};
