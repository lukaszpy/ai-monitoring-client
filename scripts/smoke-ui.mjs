import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';
import { checkSessionPreviews } from './check-session-previews.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const temp = await mkdtemp(path.join(tmpdir(), 'ai-monitoring-ui-'));
const codexHome = path.join(temp, 'codex');
const sessions = path.join(codexHome, 'sessions', '2026', '11', '18');
const artifacts = path.join(root, 'artifacts');
await mkdir(sessions, { recursive: true });
await mkdir(artifacts, { recursive: true });
const timestamp = new Date().toISOString();
const costCounters = total => ({ input_tokens: total - 1000, cached_input_tokens: 20000, output_tokens: 1000, reasoning_output_tokens: 500, total_tokens: total });
for (const [id, parent, nickname, percent] of [['fixture-root', null, null, 42], ['fixture-child', 'fixture-root', 'Carver', 76], ['fixture-grandchild', 'fixture-child', 'Laplace', 23]]) {
  const records = [
    { type: 'session_meta', timestamp, payload: { id, cwd: '/Projects/reading-service', source: 'vscode', parent_thread_id: parent, agent_nickname: nickname, agent_role: parent ? 'jvm-reviewer' : null } },
    { type: 'turn_context', timestamp, payload: { model: 'gpt-6.2-sol' } },
    { type: 'event_msg', timestamp, payload: { type: 'user_message', message: 'Przegląd serwisu reading' } },
    { type: 'event_msg', timestamp, payload: { type: 'task_started', model_context_window: 475000 } },
    { type: 'event_msg', timestamp, payload: { type: 'token_count', info: { model_context_window: 475000, last_token_usage: costCounters(475000 * percent / 100), total_token_usage: costCounters(475000 * percent / 100) } } },
    { type: 'response_item', timestamp, payload: { type: 'function_call', name: 'exec_command', arguments: JSON.stringify({ cmd: `echo ${id}` }) } },
    { type: 'response_item', timestamp, payload: { type: 'function_call_output', output: `<b>CODEX_RESULT_${id}</b>` } },
    { type: 'response_item', timestamp, payload: { type: 'message', role: 'assistant', channel: 'commentary', content: [{ type: 'output_text', text: `CODEX_PREVIEW_${id}` }] } },
  ];
  await writeFile(path.join(sessions, `rollout-${id}.jsonl`), records.map(record => JSON.stringify(record)).join('\n') + '\n');
}

const claudeHome = path.join(temp, 'claude');
const geminiHome = path.join(temp, 'gemini');
const claudeProject = path.join(claudeHome, 'projects', 'fixture');
await mkdir(path.join(claudeProject, 'fixture-root', 'subagents'), { recursive: true });
const claudeSpawn = (agentId) => [
  { type: 'assistant', timestamp, message: { id: `spawn-${agentId}`, stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'Agent', id: `tool-${agentId}`, input: { description: `Claude ${agentId}`, subagent_type: 'explorer' } }] } },
  { type: 'user', timestamp, toolUseResult: { agentId }, message: { content: [{ type: 'tool_result', tool_use_id: `tool-${agentId}` }] } },
];
const claudeUsage = id => ({ type: 'assistant', sessionId: 'fixture-root', timestamp, cwd: '/Projects/claude-project', message: { id, model: 'claude-fixture', stop_reason: 'tool_use', content: [{ type: 'text', text: `CLAUDE_PREVIEW_${id}` }, { type: 'tool_use', id: `preview-${id}`, name: 'Bash', input: { command: 'pwd' } }], usage: { input_tokens: 20000, cache_creation_input_tokens: 10000, cache_read_input_tokens: 50000, output_tokens: 500 } } });
for (const [relative, records] of [
  ['fixture-root.jsonl', [claudeUsage('root'), ...claudeSpawn('child')]],
  ['fixture-root/subagents/agent-child.jsonl', [claudeUsage('child'), ...claudeSpawn('grandchild')]],
  ['fixture-root/subagents/agent-grandchild.jsonl', [claudeUsage('grandchild')]],
]) await writeFile(path.join(claudeProject, relative), records.map(JSON.stringify).join('\n') + '\n');
const geminiChats = path.join(geminiHome, 'tmp', 'project', 'chats');
await mkdir(path.join(geminiChats, 'fixture-root'), { recursive: true });
await writeFile(path.join(geminiChats, 'session-root.jsonl'), [
  { $set: { sessionId: 'fixture-root', directories: ['/Projects/gemini-project'], startTime: timestamp } },
  { id: 'g1', type: 'gemini', timestamp, model: 'gemini-fixture', content: 'GEMINI_PREVIEW_root', toolCalls: [{ id: 'preview-gemini', name: 'run_shell_command', args: { command: 'pwd' }, result: 'GEMINI_RESULT_root', status: 'success' }], tokens: { input: 25000, cached: 5000, output: 100, total: 25100 } },
  { id: 'g2', type: 'user', timestamp, content: 'Work on Gemini fixture' },
].map(JSON.stringify).join('\n') + '\n');
await writeFile(path.join(geminiChats, 'fixture-root', 'child.json'), JSON.stringify({ sessionId: 'gemini-child', kind: 'subagent', directories: ['/Projects/gemini-project'], startTime: timestamp, messages: [{ id: 'child', type: 'user', timestamp, content: 'Gemini subtask' }] }));

const env = { ...process.env, CODEX_HOME: codexHome, CLAUDE_CONFIG_DIR: claudeHome, AI_MONITORING_GEMINI_HOME: geminiHome, AI_MONITORING_USER_DATA: path.join(temp, 'settings'), AI_MONITORING_SMOKE: '1' };
delete env.ELECTRON_RUN_AS_NODE;
let desktop;
let page;
const errors = [];
// Snapshot access is IPC and asynchronous; poll in Node so a Promise is never treated as a truthy result.
const waitForSnapshot = async (condition, argument) => {
  const deadline = Date.now() + 10000;
  let snapshot;
  do {
    snapshot = await page.evaluate(() => window.monitor.getSnapshot());
    if (condition(snapshot, argument)) return snapshot;
    await page.waitForTimeout(100);
  } while (Date.now() < deadline);
  assert.fail(`Snapshot condition timed out: ${snapshot.sessions.length} sessions; errors: ${JSON.stringify(snapshot.errors)}`);
};
const launchOptions = {
  ...(process.env.AI_MONITORING_TEST_EXECUTABLE ? { executablePath: process.env.AI_MONITORING_TEST_EXECUTABLE, args: [] } : { args: ['.'] }),
  cwd: root, env, timeout: 30000,
};
try {
  desktop = await electron.launch(launchOptions);
  page = await desktop.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1510, height: 940 });
  await page.waitForFunction(() => window.monitor !== undefined);
  await waitForSnapshot(snapshot => snapshot.sessions.length === 8);
  await page.getByRole('heading', { name: 'Mapa agentów' }).waitFor();
  await checkSessionPreviews({ page, sessions, artifacts, waitForSnapshot });
  await page.getByTestId('runtime-filter').selectOption('claude-code');
  await page.locator('[data-session-id="claude-code:claude-code:fixture-root%2Fagent%2Fchild"]').click();
  let details = page.getByTestId('details-panel');
  assert.match(await details.innerText(), /Claude Code/);
  assert.match(await details.innerText(), /Log nie podaje limitu/);
  assert.equal(await details.getByRole('button', { name: 'Kompaktuj kontekst' }).isDisabled(), true);
  await page.waitForFunction(() => document.querySelectorAll('.react-flow__edge').length === 2);
  const claudeAction = await page.evaluate(() => window.monitor.compact('claude-code:claude-code:fixture-root'));
  assert.equal(claudeAction.ok, false); assert.match(claudeAction.message, /podgląd/);
  await page.getByRole('button', { name: 'Zamknij szczegóły' }).click();
  await page.getByTestId('runtime-filter').selectOption('gemini-cli');
  await page.locator('[data-session-id="gemini-cli:gemini-cli:fixture-root"]').click();
  details = page.getByTestId('details-panel');
  assert.match(await details.innerText(), /Gemini CLI/);
  await page.waitForFunction(() => document.querySelectorAll('.react-flow__edge').length === 1);
  const usage = await page.evaluate(async () => (await window.monitor.getSnapshot()).sessions.find(s => s.runtime === 'gemini-cli' && s.externalId === 'fixture-root'));
  assert.equal(usage.contextTokens, 25000); assert.equal(usage.contextPercent, null);
  await page.getByRole('button', { name: 'Zamknij szczegóły' }).click();
  await page.getByTestId('runtime-filter').selectOption('codex');
  await page.locator('[data-session-id="codex:codex:fixture-root"]').waitFor();
  assert.match(await page.locator('[data-session-id="codex:codex:fixture-root"]').getByTestId('root-cost').innerText(), /—/, 'missing prices must not display a zero dollar cost');
  await page.waitForTimeout(700);
  assert.equal(await page.locator('[data-testid="agent-node"]').count(), 3);
  await page.locator('[data-session-id="codex:codex:fixture-child"]').click();
  await page.getByTestId('details-panel').waitFor();
  assert.match(await page.getByTestId('details-panel').innerText(), /Carver/);
  assert.equal(await page.getByRole('button', { name: 'Kompaktuj kontekst' }).isDisabled(), true);
  await page.getByRole('button', { name: 'Zamknij szczegóły' }).click();
  await page.getByRole('button', { name: 'Zwiń subagentów reading-service' }).click();
  await page.waitForTimeout(600);
  assert.equal(await page.getByTestId('agent-node').count(), 1);
  await page.getByRole('button', { name: 'Rozwiń subagentów reading-service' }).click();
  await page.waitForTimeout(600);
  assert.equal(await page.getByTestId('agent-node').count(), 3);
  await page.getByRole('textbox', { name: 'Szukaj sesji lub agenta' }).fill('Laplace');
  await page.waitForTimeout(300);
  assert.equal(await page.getByTestId('agent-node').count(), 3, 'search preserves all ancestors');
  await page.getByRole('textbox', { name: 'Szukaj sesji lub agenta' }).fill('no-such-agent');
  await page.getByRole('heading', { name: 'Brak pasujących agentów' }).waitFor();
  await page.getByRole('button', { name: 'Pokaż wszystkie sesje' }).click();
  await page.getByRole('button', { name: 'Otwórz ustawienia' }).click();
  await page.getByRole('dialog', { name: 'Ustawienia' }).waitFor();
  await desktop.evaluate(({ Notification }) => {
    globalThis.monitorTestNotifications = [];
    Notification.prototype.show = function () { globalThis.monitorTestNotifications.push(this); this.emit('show'); };
  });
  const generalTab = page.getByRole('tab', { name: 'Ogólne', exact: true });
  const sourceTab = page.getByRole('tab', { name: 'Źródła danych', exact: true });
  assert.equal(await generalTab.getAttribute('aria-selected'), 'true');
  assert.equal(await page.getByTestId('language-select').isVisible(), true);
  assert.equal(await page.getByTestId('source-codex').isVisible(), false);
  await generalTab.focus(); await generalTab.press('ArrowRight');
  assert.equal(await sourceTab.getAttribute('aria-selected'), 'true');
  assert.equal(await sourceTab.evaluate(element => element === document.activeElement), true);
  assert.equal(await page.getByTestId('language-select').isVisible(), false);
  assert.equal(await page.getByRole('checkbox', { name: 'Pokaż zakończonych agentów' }).count(), 0);
  const beforeSources = await page.evaluate(() => window.monitor.getSnapshot());
  assert.deepEqual(beforeSources.sourceDefaults.map(source => source.directory), [codexHome, claudeHome, geminiHome], 'runtime environment overrides remain explicit defaults');
  const customCodex = path.join(temp, 'custom-codex-data');
  await page.evaluate(async directory => {
    const snapshot = await window.monitor.getSnapshot();
    await window.monitor.updateSettings({ sources: snapshot.settings.sources.map(source => source.runtime === 'codex' ? { ...source, directory } : source) });
  }, customCodex);
  await page.getByTestId('source-codex').getByText(customCodex, { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Dodaj źródło' }).click();
  await waitForSnapshot(snapshot => snapshot.settings.sources.length === 4);
  const added = (await page.evaluate(() => window.monitor.getSnapshot())).settings.sources.find(source => source.id.startsWith('codex-'));
  assert.equal(added.enabled, false);
  assert.equal(added.directory, codexHome, 'new sources use tool defaults, not the existing custom source directory');
  await page.getByRole('button', { name: `Usuń źródło ${added.id}`, exact: true }).click();
  await waitForSnapshot(snapshot => snapshot.settings.sources.length === 3);
  await page.getByRole('button', { name: 'Przywróć domyślny katalog codex', exact: true }).click();
  await waitForSnapshot(snapshot => snapshot.sessions.length === 8);
  assert.equal((await page.evaluate(() => window.monitor.getSnapshot())).settings.sources[0].directory, codexHome);
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(artifacts, 'settings-sources-local.png') });
  const codexPrices = page.getByTestId('source-codex').locator('.model-price-settings');
  await codexPrices.locator('summary').click();
  await codexPrices.getByRole('button', { name: 'Dodaj model do cennika' }).click();
  await codexPrices.getByLabel('Model w cenniku 1', { exact: true }).fill('gpt-6.2-sol');
  // Fictional fixture rates, not provider prices.
  for (const [name, rate] of [['Wejście bez cache', '2'], ['Odczyt cache', '0.5'], ['Wyjście i rozumowanie', '10'], ['Zapis cache — brak TTL', '0'], ['Zapis cache 5 min', '0'], ['Zapis cache 1 godz.', '0']]) {
    await codexPrices.getByRole('spinbutton', { name: `${name} · model 1`, exact: true }).fill(rate);
  }
  await codexPrices.getByRole('button', { name: 'Zapisz stawki' }).click();
  await waitForSnapshot(snapshot => snapshot.sessions.find(session => session.id === 'codex:codex:fixture-root')?.estimatedCost.complete);
  await page.waitForFunction(() => document.querySelector('[data-session-id="codex:codex:fixture-root"] [data-testid="root-cost"]')?.textContent.includes('1,2735'));
  const costSnapshot = await page.evaluate(() => window.monitor.getSnapshot());
  assert.ok(Math.abs(costSnapshot.sessions.find(session => session.id === 'codex:codex:fixture-root').estimatedCost.amountUsd - 0.377) < 1e-10);
  assert.equal(costSnapshot.sessions.find(session => session.runtime === 'claude-code').estimatedCost.amountUsd, null, 'one source price list does not price another source');
  const claudeSource = page.getByTestId('source-claude-code');
  await claudeSource.getByRole('spinbutton', { name: 'Limit kontekstu claude-code', exact: true }).fill('200000');
  await claudeSource.getByRole('spinbutton', { name: 'Limit kontekstu claude-code', exact: true }).press('Tab');
  await waitForSnapshot(snapshot => snapshot.sessions.filter(s => s.runtime === 'claude-code').length === 3 && snapshot.sessions.filter(s => s.runtime === 'claude-code').every(s => s.contextPercent === 40 && s.contextQuality === 'estimated'));
  await claudeSource.getByRole('button', { name: 'Kopiuj konfigurację pomiaru Claude' }).click();
  const copiedConfig = await desktop.evaluate(({ clipboard }) => clipboard.readText());
  assert.ok(JSON.parse(copiedConfig).statusLine.command.includes('collect-telemetry.mjs'));
  assert.ok(JSON.parse(copiedConfig).statusLine.command.includes('--source'));
  const codexAlerts = page.getByTestId('alerts-codex');
  assert.equal(await codexAlerts.getByRole('spinbutton', { name: 'Próg Warn dla codex', exact: true }).inputValue(), '70');
  assert.equal(await codexAlerts.getByRole('checkbox', { name: 'Powiadomienie systemowe Warn dla codex', exact: true }).isChecked(), false);
  await codexAlerts.getByRole('spinbutton', { name: 'Próg Critical dla codex', exact: true }).fill('60');
  assert.equal(await codexAlerts.getByRole('button', { name: 'Zapisz powiadomienia' }).isDisabled(), true);
  await codexAlerts.getByRole('spinbutton', { name: 'Próg Warn dla codex', exact: true }).fill('60');
  await codexAlerts.getByRole('spinbutton', { name: 'Próg Critical dla codex', exact: true }).fill('85');
  await codexAlerts.getByRole('checkbox', { name: 'Powiadomienie systemowe Warn dla codex', exact: true }).check();
  await codexAlerts.getByRole('checkbox', { name: 'Powiadomienie systemowe Critical dla codex', exact: true }).check();
  await codexAlerts.getByRole('button', { name: 'Zapisz powiadomienia' }).click();
  await waitForSnapshot(snapshot => snapshot.settings.sources[0].contextAlerts.critical.threshold === 85);
  const claudeAlerts = page.getByTestId('alerts-claude-code');
  await claudeAlerts.getByRole('spinbutton', { name: 'Próg Warn dla claude-code', exact: true }).fill('50');
  await claudeAlerts.getByRole('spinbutton', { name: 'Próg Critical dla claude-code', exact: true }).fill('80');
  await claudeAlerts.getByRole('checkbox', { name: 'Powiadomienie systemowe Critical dla claude-code', exact: true }).check();
  await claudeAlerts.getByRole('button', { name: 'Zapisz powiadomienia' }).click();
  await waitForSnapshot(snapshot => snapshot.settings.sources.find(source => source.runtime === 'claude-code').contextAlerts.critical.systemNotification);
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(artifacts, 'settings-alerts.png') });
  await sourceTab.focus(); await sourceTab.press('Home');
  assert.equal(await generalTab.getAttribute('aria-selected'), 'true');
  assert.equal(await generalTab.evaluate(element => element === document.activeElement), true);
  assert.equal(await page.getByTestId('source-claude-code').isVisible(), false);
  const costToggle = page.getByRole('checkbox', { name: 'Pokaż szacowany koszt drzewa' });
  await costToggle.uncheck();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="root-cost"]').length === 0);
  assert.equal((await page.evaluate(() => window.monitor.getSnapshot())).settings.showEstimatedCosts, false);
  await costToggle.check();
  await page.waitForFunction(() => document.querySelector('[data-session-id="codex:codex:fixture-root"] [data-testid="root-cost"]')?.textContent.includes('1,2735'));
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(artifacts, 'settings-general-local.png') });
  await page.getByRole('checkbox', { name: 'Pokaż zakończonych agentów' }).uncheck();
  await waitForSnapshot(snapshot => snapshot.settings.showCompleted === false);
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog', { name: 'Ustawienia' }).count(), 0);
  const invalid = await page.evaluate(() => window.monitor.compact('../../outside'));
  assert.equal(invalid.ok, false, 'invalid IDs cannot access files or trigger operations');
  const pricedRoot = page.locator('[data-session-id="codex:codex:fixture-root"]').getByTestId('root-cost');
  const fullTreeCostText = await pricedRoot.innerText();
  await page.getByRole('button', { name: 'Zwiń subagentów reading-service' }).click();
  assert.equal(await pricedRoot.innerText(), fullTreeCostText, 'collapse does not remove descendant costs');
  await page.getByRole('button', { name: 'Rozwiń subagentów reading-service' }).click();
  await page.getByRole('textbox', { name: 'Szukaj sesji lub agenta' }).fill('Carver');
  assert.equal(await pricedRoot.innerText(), fullTreeCostText, 'search filters do not remove descendant costs');
  await page.getByRole('textbox', { name: 'Szukaj sesji lub agenta' }).fill('');
  await page.locator('[data-session-id="codex:codex:fixture-root"]').click();
  await page.getByTestId('cost-details').getByText('Sam root', { exact: true }).waitFor();
  assert.match(await page.getByTestId('cost-details').innerText(), /1,2735/);
  await page.screenshot({ path: path.join(artifacts, 'root-cost-details.png') });
  await page.getByRole('button', { name: 'Zamknij szczegóły' }).click();
  const notificationCount = () => desktop.evaluate(() => globalThis.monitorTestNotifications.length);
  const waitForNotifications = async count => {
    for (let attempt = 0; attempt < 50; attempt++) {
      if (await notificationCount() >= count) return;
      await page.waitForTimeout(100);
    }
    const diagnostics = await page.evaluate(async () => {
      const s = await window.monitor.getSnapshot();
      return { notifications: s.systemNotifications, rules: s.settings.sources.map(source => [source.id, source.contextAlerts]), usage: s.sessions.filter(session => session.runtime === 'codex').map(session => [session.id, session.contextPercent, session.measuredAt, session.contextQuality]) };
    });
    assert.fail(`Expected ${count} notifications; diagnostics: ${JSON.stringify(diagnostics)}`);
  };
  assert.equal(await notificationCount(), 0, 'enabling alerts baselines existing measurements instead of replaying them');
  let cumulativeCostUsage = costCounters(475000 * 42 / 100);
  const writeCodexUsage = async percent => {
    const timestamp = new Date().toISOString();
    const last = costCounters(475000 * percent / 100);
    cumulativeCostUsage = Object.fromEntries(Object.keys(last).map(key => [key, cumulativeCostUsage[key] + last[key]]));
    await appendFile(path.join(sessions, 'rollout-fixture-root.jsonl'), JSON.stringify({ type: 'event_msg', timestamp, payload: { type: 'token_count', info: { model_context_window: 475000, last_token_usage: last, total_token_usage: cumulativeCostUsage } } }) + '\n');
    await waitForSnapshot((snapshot, percent) => snapshot.sessions.find(s => s.id === 'codex:codex:fixture-root').contextPercent === percent, percent);
  };
  await writeCodexUsage(65);
  await waitForNotifications(1);
  assert.equal(await notificationCount(), 1);
  assert.match(await desktop.evaluate(() => globalThis.monitorTestNotifications[0].title), /Codex · Warn/);
  await writeCodexUsage(67); assert.equal(await notificationCount(), 1, 'above-threshold measurements do not repeat a banner');
  await writeCodexUsage(90); await waitForNotifications(2); assert.equal(await notificationCount(), 2);
  assert.match(await desktop.evaluate(() => globalThis.monitorTestNotifications[1].title), /Critical/);
  const writeClaudeUsage = async percent => {
    const record = claudeUsage(`notification-${percent}`); record.timestamp = new Date().toISOString();
    record.message.usage = { input_tokens: percent * 2000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 50 };
    await appendFile(path.join(claudeProject, 'fixture-root/subagents/agent-grandchild.jsonl'), JSON.stringify(record) + '\n');
    await waitForSnapshot((snapshot, percent) => snapshot.sessions.find(s => s.runtime === 'claude-code' && s.externalId === 'grandchild').contextPercent === percent, percent);
  };
  await writeClaudeUsage(60); assert.equal(await notificationCount(), 2, 'a source can disable Warn while retaining Critical');
  await writeClaudeUsage(82); await waitForNotifications(3); assert.equal(await notificationCount(), 3);
  assert.match(await desktop.evaluate(() => globalThis.monitorTestNotifications[2].body), /Wartość szacowana/);
  await page.getByRole('button', { name: 'Zobacz demo' }).click();
  await desktop.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].hide(); globalThis.monitorTestNotifications[2].emit('click'); });
  await page.getByTestId('details-panel').waitFor();
  assert.equal(await page.getByTestId('details-panel').locator('.session-id code').innerText(), 'grandchild', 'clicking a notification opens the live session even from demo');
  assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), true);
  await page.getByRole('button', { name: 'Zamknij szczegóły' }).click();
  await desktop.evaluate(() => globalThis.monitorTestNotifications[2].emit('failed', {}, 'simulated failure'));
  await page.getByRole('button', { name: 'Otwórz ustawienia' }).click();
  await page.getByRole('tab', { name: 'Źródła danych', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Nie udało się wyświetlić powiadomienia' }).waitFor();
  await desktop.evaluate(() => globalThis.monitorTestNotifications[2].emit('show'));
  await page.keyboard.press('Escape');
  await page.getByTestId('runtime-filter').selectOption('all');
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(artifacts, 'local-fixture.png') });
  await page.getByRole('button', { name: 'Zobacz demo' }).click();
  await page.getByText('Tryb demonstracyjny — przykładowe sesje', { exact: false }).waitFor();
  await page.waitForTimeout(800);
  await page.locator('[data-session-id="demo-configurator"]').click();
  await page.waitForTimeout(700);
  await page.locator('[data-session-id="demo-configurator"]').dispatchEvent('contextmenu', { button: 2, clientX: 650, clientY: 400 });
  await page.getByRole('menuitem', { name: 'Podgląd sesji', exact: true }).click();
  await page.getByTestId('session-preview').getByText('Dane demonstracyjne', { exact: true }).waitFor();
  await page.getByTestId('session-preview').getByRole('button', { name: /^Zamknij podgląd/ }).click();
  const canvas = await page.getByTestId('session-graph').boundingBox();
  for (const node of await page.getByTestId('agent-node').all()) {
    const box = await node.boundingBox();
    assert.ok(box && canvas && box.x >= canvas.x - 1 && box.y >= canvas.y + 20 && box.x + box.width <= canvas.x + canvas.width + 1 && box.y + box.height <= canvas.y + canvas.height - 15, 'nodes fit with space for the canvas label and legend after opening details');
  }
  await page.screenshot({ path: path.join(artifacts, 'demo.png') });
  await page.setViewportSize({ width: 1080, height: 740 });
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'minimum window width must not overflow');
  await page.screenshot({ path: path.join(artifacts, 'compact-window.png') });
  const baseline = await page.evaluate(async () => (await window.monitor.getSnapshot()).sessions.map(({ id, title, contextPercent }) => ({ id, title, contextPercent })));
  const locales = [
    { code: 'en', general: 'General', sources: 'Data sources', heading: 'Agent map', settings: 'Settings', open: 'Open settings', file: 'File', compact: 'Compact context', status: 'Working', error: 'Session not found. Refresh the map.' },
    { code: 'de', general: 'Allgemein', sources: 'Datenquellen', heading: 'Agentenkarte', settings: 'Einstellungen', open: 'Einstellungen öffnen', file: 'Datei', compact: 'Kontext komprimieren', status: 'Arbeitet', error: 'Sitzung nicht gefunden. Aktualisieren Sie die Karte.' },
    { code: 'fr', general: 'Général', sources: 'Sources de données', heading: 'Carte des agents', settings: 'Paramètres', open: 'Ouvrir les paramètres', file: 'Fichier', compact: 'Compresser le contexte', status: 'En cours', error: 'Session introuvable. Actualisez la carte.' },
    { code: 'ru', general: 'Общие', sources: 'Источники данных', heading: 'Карта агентов', settings: 'Настройки', open: 'Открыть настройки', file: 'Файл', compact: 'Сжать контекст', status: 'Работает', error: 'Сессия не найдена. Обновите карту.' },
    { code: 'pl', general: 'Ogólne', sources: 'Źródła danych', heading: 'Mapa agentów', settings: 'Ustawienia', open: 'Otwórz ustawienia', file: 'Plik', compact: 'Kompaktuj kontekst', status: 'Pracuje', error: 'Nie znaleziono sesji. Odśwież mapę.' },
  ];
  let openSettings = 'Otwórz ustawienia';
  for (const locale of locales) {
    await page.getByRole('button', { name: openSettings }).click();
    await page.getByTestId('language-select').selectOption(locale.code);
    await page.waitForFunction(code => document.documentElement.lang === code, locale.code);
    await page.getByRole('dialog', { name: locale.settings }).waitFor();
    assert.equal(await page.getByRole('tab', { name: locale.general, exact: true }).getAttribute('aria-selected'), 'true');
    await page.getByRole('tab', { name: locale.sources, exact: true }).click();
    assert.equal(await page.getByTestId('language-select').isVisible(), false);
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(artifacts, `settings-sources-${locale.code}.png`) });
    await page.getByRole('tab', { name: locale.general, exact: true }).click();
    await page.getByRole('heading', { name: locale.heading }).waitFor();
    assert.equal((await page.evaluate(() => window.monitor.getSnapshot())).settings.language, locale.code);
    const nativeMenu = await desktop.evaluate(({ Menu }) => Menu.getApplicationMenu().items.map(item => item.label));
    assert.ok(nativeMenu.includes(locale.file), `native menu language: ${locale.code}`);
    await page.screenshot({ path: path.join(artifacts, `settings-${locale.code}.png`) });
    await page.keyboard.press('Escape');
    assert.equal(await page.getByTestId('details-panel').getByText(locale.status, { exact: true }).count(), 1);
    assert.equal(await page.getByRole('button', { name: locale.compact, exact: true }).isDisabled(), true);
    const error = await page.evaluate(() => window.monitor.compact('unknown-session'));
    assert.equal(error.message, locale.error, `localized native diagnostic: ${locale.code}`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `layout overflow: ${locale.code}`);
    const current = await page.evaluate(async () => (await window.monitor.getSnapshot()).sessions.map(({ id, title, contextPercent }) => ({ id, title, contextPercent })));
    assert.deepEqual(current, baseline, 'changing language must preserve session data and user text');
    await page.screenshot({ path: path.join(artifacts, `language-${locale.code}.png`) });
    openSettings = locale.open;
  }
  await page.getByRole('button', { name: openSettings }).click();
  await page.getByTestId('language-select').selectOption('ru');
  await page.waitForFunction(() => document.documentElement.lang === 'ru');
  await page.keyboard.press('Escape');
  const invalidLanguage = await page.evaluate(async () => {
    try { await window.monitor.updateSettings({ language: 'es' }); return false; } catch { return true; }
  });
  assert.equal(invalidLanguage, true);
  assert.equal((await page.evaluate(() => window.monitor.getSnapshot())).settings.language, 'ru');
  assert.equal(JSON.parse(await readFile(path.join(temp, 'settings', 'settings.json'), 'utf8')).language, 'ru');
  await page.evaluate(() => window.monitor.updateSettings({ showEstimatedCosts: false }));
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="root-cost"]').length === 0);
  assert.deepEqual(errors, [], 'renderer must have no uncaught errors');
  const closeToTray = await desktop.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.show(); window.close();
    return { destroyed: window.isDestroyed(), visible: !window.isDestroyed() && window.isVisible() };
  });
  assert.deepEqual(closeToTray, { destroyed: false, visible: false });
  await desktop.close();
  desktop = undefined;
  desktop = await electron.launch(launchOptions);
  page = await desktop.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('heading', { name: 'Карта агентов' }).waitFor();
  await page.waitForFunction(() => document.documentElement.lang === 'ru');
  assert.equal((await page.evaluate(() => window.monitor.getSnapshot())).settings.language, 'ru', 'language survives a full process restart');
  const restartedSettings = (await page.evaluate(() => window.monitor.getSnapshot())).settings;
  assert.equal(restartedSettings.showEstimatedCosts, false, 'cost visibility survives a full restart');
  assert.equal(restartedSettings.sources[0].modelPrices[0].rates.input, 2, 'model prices survive a full restart');
  assert.deepEqual(restartedSettings.sources[0].contextAlerts, { warn: { threshold: 60, systemNotification: true }, critical: { threshold: 85, systemNotification: true } }, 'source thresholds and independent toggles survive restart');
  // Regression: empty manual rates must still price a known native Codex model.
  const manualBeforeBuiltIn = (await page.evaluate(() => window.monitor.getSnapshot())).sessions.find(session => session.externalId === 'fixture-root' && session.runtime === 'codex').estimatedCost.amountUsd;
  const builtInUsage = { input_tokens: 1000, cached_input_tokens: 200, cache_write_input_tokens: 300, output_tokens: 100, total_tokens: 1100 };
  await writeFile(path.join(sessions, 'rollout-fixture-built-in.jsonl'), [
    { type: 'session_meta', timestamp, payload: { id: 'fixture-built-in', cwd: '/Projects/automatic-pricing', source: 'vscode' } },
    { type: 'turn_context', timestamp, payload: { model: 'gpt-6.1-sol' } },
    { type: 'event_msg', timestamp, payload: { type: 'token_count', info: { model_context_window: 475000, last_token_usage: builtInUsage, total_token_usage: builtInUsage } } },
  ].map(JSON.stringify).join('\n') + '\n');
  await page.evaluate(() => window.monitor.updateSettings({ language: 'pl', showEstimatedCosts: true }));
  const pricingSnapshot = await waitForSnapshot(snapshot => snapshot.sessions.some(session => session.externalId === 'fixture-built-in' && session.estimatedCost.amountUsd !== null));
  const automaticallyPriced = pricingSnapshot.sessions.find(session => session.externalId === 'fixture-built-in');
  assert.ok(Math.abs(automaticallyPriced.estimatedCost.amountUsd - 0.00277) < 1e-10, 'known model automatically uses cache-aware API Standard prices');
  assert.equal(automaticallyPriced.estimatedCost.complete, true);
  const builtInBadge = page.locator('[data-session-id="codex:codex:fixture-built-in"]').getByTestId('root-cost');
  assert.doesNotMatch(await builtInBadge.innerText(), /—/);
  await page.getByRole('button', { name: 'Otwórz ustawienia' }).click();
  await page.getByRole('tab', { name: 'Źródła danych', exact: true }).click();
  const codexSource = page.getByTestId('source-codex');
  await codexSource.locator('.model-price-settings summary').click();
  const automaticRates = codexSource.getByRole('checkbox', { name: 'Używaj wbudowanych stawek Codex' });
  assert.equal(await automaticRates.isChecked(), true);
  await automaticRates.click();
  await waitForSnapshot(snapshot => snapshot.sessions.find(session => session.externalId === 'fixture-built-in')?.estimatedCost.amountUsd === null);
  assert.equal(JSON.parse(await readFile(path.join(temp, 'settings', 'settings.json'), 'utf8')).sources[0].useBuiltInPrices, false);
  await automaticRates.click();
  await waitForSnapshot(snapshot => snapshot.sessions.find(session => session.externalId === 'fixture-built-in')?.estimatedCost.amountUsd > 0);
  assert.equal((await page.evaluate(() => window.monitor.getSnapshot())).sessions.find(session => session.externalId === 'fixture-root' && session.runtime === 'codex').estimatedCost.amountUsd, manualBeforeBuiltIn, 'manual rates retain priority');
  await codexSource.locator('.built-in-prices').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(artifacts, 'built-in-prices.png') });
  assert.deepEqual(errors, [], 'restarted renderer must have no uncaught errors');
  console.log('PASS: Automatic Codex estimates without manual prices, cache writes, per-source opt-out and saved configuration, manual overrides and visible default price table.');
  console.log('PASS: Source-specific notification thresholds and toggles, native notification payloads (display stubbed), no repeated alerts, estimated context, notification click routing, failure handling and persisted configuration. Three local runtimes, hierarchy, tabbed settings, keyboard navigation, source defaults, source management, Electron IPC, gauges, collapse, search, action guards, demo, responsive layout, tray, all five languages and persisted language after restart.');
  console.log(`Screenshots: ${artifacts}`);
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: path.join(artifacts, 'failure.png') }).catch(() => undefined);
  console.error('Renderer errors:', errors);
  throw error;
} finally {
  if (desktop) await desktop.close();
  await rm(temp, { recursive: true, force: true });
}
