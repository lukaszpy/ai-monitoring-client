import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const release = process.argv[2] ? path.resolve(root, process.argv[2]) : path.join(root, 'release');
if (!process.env.AI_MONITORING_TEST_EXECUTABLE) {
  if (process.platform === 'darwin') {
    process.env.AI_MONITORING_TEST_EXECUTABLE = path.join(release, process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'AI Monitoring.app', 'Contents', 'MacOS', 'AI Monitoring');
  } else if (process.platform === 'win32') {
    process.env.AI_MONITORING_TEST_EXECUTABLE = path.join(release, 'win-unpacked', 'AI Monitoring.exe');
  } else throw new Error('Test pakietu jest przygotowany dla macOS i Windows.');
}
await import('./smoke-ui.mjs');
