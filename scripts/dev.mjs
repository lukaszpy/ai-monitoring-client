import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';

const root = fileURLToPath(new URL('../', import.meta.url));
const children = new Set();
let exiting = false;
function stop(code = 0) {
  if (exiting) return;
  exiting = true;
  for (const child of children) child.kill();
  process.exitCode = code;
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());

function runNode(script, args = []) {
  const child = spawn(process.execPath, [script, ...args], { cwd: root, stdio: 'inherit' });
  children.add(child); child.on('exit', () => children.delete(child));
  return child;
}

const compiler = runNode('node_modules/typescript/bin/tsc', ['-p', 'tsconfig.electron.json']);
const exitCode = await new Promise(resolve => compiler.on('exit', resolve));
if (exitCode !== 0) stop(1);
else {
  const vite = runNode('node_modules/vite/bin/vite.js', ['--host', '127.0.0.1']);
  vite.on('exit', code => { if (!exiting) stop(code ?? 1); });
  let ready = false;
  for (let i = 0; i < 100 && !exiting; i++) {
    try { const response = await fetch('http://127.0.0.1:5173'); if (response.ok) { ready = true; break; } }
    catch { /* Wait for the local development server. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!ready) stop(1);
  else {
    const env = { ...process.env, AI_MONITORING_DEV_URL: 'http://127.0.0.1:5173' };
    delete env.ELECTRON_RUN_AS_NODE;
    const desktop = spawn(electronPath, ['.'], { cwd: root, env, stdio: 'inherit' });
    children.add(desktop);
    desktop.on('error', error => { console.error(error.message); stop(1); });
    desktop.on('exit', code => { children.delete(desktop); stop(code ?? 0); });
  }
}
