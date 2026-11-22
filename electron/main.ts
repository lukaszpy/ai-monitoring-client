import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, Notification, session as electronSession, shell, Tray } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AgentMonitor } from './monitor.js';
import { sessionKey } from './adapters/contract.js';
import { trayIcon } from './tray-icon.js';
import { RUNTIME_LABELS, type ActionResult, type AgentSession, type MonitorSettings, type MonitorSnapshot } from '../src/shared/types.js';
import { localizeMessage, translate, type MessageKey, type TranslationValues } from '../src/shared/i18n.js';
import { configuredDefaultSources, settingsFromDisk, validateSettingsPatch } from './settings.js';
import { applicationMenu, trayMenu } from './menus.js';
import { ContextAlertMonitor, type ContextAlert } from './context-alerts.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const rendererPath = path.resolve(here, '../../dist/index.html');
const devUrl = !app.isPackaged && process.env.AI_MONITORING_DEV_URL === 'http://127.0.0.1:5173' ? process.env.AI_MONITORING_DEV_URL : null;
if (process.env.AI_MONITORING_USER_DATA) app.setPath('userData', process.env.AI_MONITORING_USER_DATA);
app.setName('AI Monitoring');
if (process.platform === 'win32') app.setAppUserModelId('local.ai-monitoring.desktop');

let window: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let scanning = false;
let settings: MonitorSettings;
let monitor: AgentMonitor;
let scanTimer: NodeJS.Timeout | null = null;
let controlTimer: NodeJS.Timeout | null = null;
let snapshot: MonitorSnapshot;
const actionsInProgress = new Set<string>();
const loginSettings = () => app.getLoginItemSettings(process.platform === 'win32' ? { args: ['--hidden'] } : {});
const t = (key: MessageKey, values?: TranslationValues) => translate(settings?.language ?? 'pl', key, values);

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
const sourceDefaults = configuredDefaultSources();
const contextAlerts = new ContextAlertMonitor();
const systemNotifications: MonitorSnapshot['systemNotifications'] = { supported: false, error: null };
const activeNotifications = new Set<Notification>();

function showContextAlert(alert: ContextAlert): void {
  if (!systemNotifications.supported) return;
  try {
    const percent = new Intl.NumberFormat(settings.language, { maximumFractionDigits: 1 }).format(alert.percent);
    const name = `${alert.session.project} · ${alert.session.nickname ?? alert.session.role ?? alert.session.externalId.slice(0, 8)}`;
    const notification = new Notification({
      title: t('AI Monitoring · {runtime} · {level}', { runtime: RUNTIME_LABELS[alert.source.runtime], level: alert.level === 'critical' ? 'Critical' : 'Warn' }),
      body: t('{name}: kontekst {percent}% (próg {threshold}%). Źródło: {source}.', { name, percent, threshold: alert.threshold, source: alert.source.id }) + (alert.session.contextQuality === 'estimated' ? ` ${t('Wartość szacowana.')}` : ''),
      urgency: alert.level === 'critical' ? 'critical' : 'normal',
    });
    activeNotifications.add(notification);
    notification.on('click', () => {
      showWindow();
      if (snapshot.sessions.some(session => session.id === alert.session.id)) window?.webContents.send('monitor:focus-session', alert.session.id);
    });
    notification.on('close', () => { activeNotifications.delete(notification); });
    notification.on('failed', () => {
      activeNotifications.delete(notification);
      systemNotifications.error = 'Nie udało się wyświetlić powiadomienia. Sprawdź uprawnienia i ustawienia powiadomień systemowych.';
      publish();
    });
    notification.on('show', () => { if (systemNotifications.error) { systemNotifications.error = null; publish(); } });
    notification.show();
  } catch {
    systemNotifications.error = 'Nie udało się wyświetlić powiadomienia. Sprawdź uprawnienia i ustawienia powiadomień systemowych.';
  }
}

async function loadSettings(): Promise<MonitorSettings> {
  let saved: unknown = null;
  try {
    saved = JSON.parse(await readFile(settingsPath(), 'utf8'));
  } catch { /* First launch, or reset to safe defaults if the local settings file is damaged. */ }
  const defaults = settingsFromDisk(saved, sourceDefaults);
  if (app.isPackaged) defaults.launchAtLogin = loginSettings().openAtLogin;
  return defaults;
}

async function saveSettings(): Promise<void> {
  await mkdir(app.getPath('userData'), { recursive: true });
  await writeFile(settingsPath(), JSON.stringify(settings, null, 2), { mode: 0o600 });
}

function publish(): void {
  if (!snapshot) return;
  snapshot.settings = { ...settings };
  if (window && !window.isDestroyed()) window.webContents.send('monitor:updated', snapshot);
  const active = snapshot.sessions.filter(item => item.status === 'running' || item.status === 'compacting').length;
  const maximum = Math.max(0, ...snapshot.sessions.filter(item => item.status !== 'completed').map(item => item.contextPercent ?? 0));
  tray?.setToolTip(t('AI Monitoring · {count} pracujących · kontekst maks. {percent}%', { count: active, percent: Math.round(maximum) }));
}

async function scan(): Promise<void> {
  if (scanning || quitting) return;
  scanning = true;
  const activeMonitor = monitor;
  try {
    const result = await activeMonitor.read();
    if (activeMonitor !== monitor) return;
    snapshot = { ...snapshot, ...result, scanning: false, scannedAt: new Date().toISOString() };
    for (const alert of contextAlerts.evaluate(result.sessions, settings.sources)) showContextAlert(alert);
    publish();
  } catch {
    snapshot.errors = ['Nie udało się odczytać danych. Sprawdź wybrany katalog i uprawnienia.'];
    snapshot.scanning = false;
    publish();
  } finally { scanning = false; }
}

async function replaceMonitor(): Promise<void> {
  monitor.dispose();
  monitor = new AgentMonitor(settings.sources, path.join(app.getPath('userData'), 'telemetry'));
  snapshot.sessions = []; snapshot.sources = []; snapshot.scanning = true;
  publish();
  // Wait for an in-flight scan to finish; its result is discarded by identity.
  while (scanning) await new Promise(resolve => setTimeout(resolve, 20));
  await scan();
  if (!process.env.AI_MONITORING_SMOKE) void monitor.refreshControl().then(() => scan());
}

function showWindow(): void {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function makeWindow(): void {
  window = new BrowserWindow({
    width: 1510, height: 970, minWidth: 1060, minHeight: 700, show: false,
    backgroundColor: '#0b0e14', title: 'AI Monitoring',
    icon: path.resolve(here, '../../assets/icon.png'),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 19, y: 19 }, autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(here, 'preload.cjs'), contextIsolation: true,
      nodeIntegration: false, sandbox: true, webSecurity: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, target) => {
    if (target !== (devUrl ?? pathToFileURL(rendererPath).href)) event.preventDefault();
  });
  window.on('close', event => {
    if (!quitting && tray) { event.preventDefault(); window?.hide(); }
  });
  window.once('ready-to-show', () => {
    const atLogin = app.isPackaged && process.platform === 'darwin' && loginSettings().wasOpenedAtLogin;
    if (!process.argv.includes('--hidden') && !atLogin && !process.env.AI_MONITORING_SMOKE) showWindow();
  });
  if (devUrl) void window.loadURL(devUrl);
  else void window.loadFile(rendererPath);
}

function makeTray(): void {
  try {
    tray = new Tray(trayIcon());
    tray.setToolTip('AI Monitoring');
    tray.on('click', showWindow);
    tray.on('double-click', showWindow);
  } catch { tray = null; /* If the OS has no tray, closing the window must still quit. */ }
}

function refreshMenus(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(applicationMenu(settings.language, process.platform)));
  tray?.setContextMenu(Menu.buildFromTemplate(trayMenu(settings.language, {
    show: showWindow, refresh: () => { void scan(); }, quit: () => { quitting = true; app.quit(); },
  })));
}

function verifySender(event: Electron.IpcMainInvokeEvent): void {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error(t("Niedozwolony nadawca."));
  const expected = devUrl ?? pathToFileURL(rendererPath).href;
  if (event.senderFrame.url !== expected && event.senderFrame.url !== `${expected}/`) throw new Error(t("Niedozwolone źródło."));
}

function selectedSession(id: unknown): AgentSession {
  if (typeof id !== 'string' || id.length > 2048) throw new Error(t("Nieprawidłowy identyfikator sesji."));
  const session = snapshot.sessions.find(item => item.id === id);
  if (!session) throw new Error(t("Nie znaleziono sesji. Odśwież mapę."));
  return session;
}

async function performAction(kind: 'compact' | 'fresh', id: unknown): Promise<ActionResult> {
  try {
    const item = selectedSession(id);
    if (actionsInProgress.has(item.id)) throw new Error(t("Operacja dla tej sesji już trwa."));
    actionsInProgress.add(item.id);
    try {
      const capability = item.actions.find(action => action.id === (kind === 'fresh' ? 'fresh-context' : 'compact'));
      if (!capability?.available) throw new Error(capability?.reason ?? t('Sterowanie tą sesją nie jest dostępne.'));
      const result = await dialog.showMessageBox(window!, {
        type: 'question', title: kind === 'compact' ? t("Kompaktowanie kontekstu") : t("Nowy, świeży kontekst"),
        message: kind === 'compact' ? t("Skompaktować kontekst tej sesji?") : t("Utworzyć nową sesję ze świeżym kontekstem?"),
        detail: kind === 'compact'
          ? t("Codex podsumuje historię wybranego agenta. Operacja może zużyć tokeny modelu. Pozostałe sesje nie są objęte tą operacją.")
          : t("Powstanie nowa sesja w tym samym projekcie, z tym samym modelem, bez historii rozmowy. Obecna sesja i jej subagenci pozostaną dostępni. W aplikacji lub terminalu Codex trzeba będzie wybrać nową sesję."),
        buttons: [t("Anuluj"), kind === 'compact' ? t("Kompaktuj") : t("Utwórz nową sesję")], defaultId: 0, cancelId: 0,
      });
      if (result.response !== 1) return { ok: false, message: t("Operacja anulowana.") };
      const resultAction = await monitor.execute(kind === 'compact' ? 'compact' : 'fresh-context', item);
      await scan();
      if (resultAction.threadId) return { ...resultAction,
        message: t('Utworzono nową sesję: {id}. Wybierz ją w Codex, aby rozpocząć pracę.', { id: resultAction.threadId }),
        threadId: sessionKey(item.runtime, item.sourceId, resultAction.threadId) };
      return { ...resultAction, message: localizeMessage(settings.language, resultAction.message) };
    } finally { actionsInProgress.delete(item.id); }
  } catch (error) { return { ok: false, message: localizeMessage(settings.language, error instanceof Error ? error.message : t("Operacja nie powiodła się.")) }; }
}

function registerIpc(): void {
  const handle = (channel: string, handler: (value: unknown) => unknown) => {
    ipcMain.handle(channel, (event, value) => { verifySender(event); return handler(value); });
  };
  handle('monitor:snapshot', () => snapshot);
  handle('monitor:session-preview', id => {
    const session = selectedSession(id);
    const activity = monitor.preview(session);
    if (!activity) throw new Error(t('Podgląd tej sesji nie jest obecnie dostępny.'));
    return { ...activity, sessionId: session.id, scannedAt: snapshot.scannedAt };
  });
  handle('monitor:refresh', async () => { await Promise.all([scan(), monitor.refreshControl()]); await scan(); });
  handle('monitor:compact', id => performAction('compact', id));
  handle('monitor:fresh-context', id => performAction('fresh', id));
  handle('monitor:reveal', id => { shell.showItemInFolder(selectedSession(id).filePath); });
  handle('monitor:copy-id', id => { clipboard.writeText(selectedSession(id).externalId); });
  const selectedSource = (id: unknown) => {
    const source = settings.sources.find(item => item.id === id);
    if (!source) throw new Error(t('Nieprawidłowe źródła danych.'));
    return source;
  };
  handle('monitor:choose-directory', async id => {
    const source = selectedSource(id);
    const result = await dialog.showOpenDialog(window!, { title: t('Wybierz katalog źródła'), properties: ['openDirectory', 'showHiddenFiles'], defaultPath: source.directory });
    if (result.canceled || !result.filePaths[0]) return;
    settings.sources = settings.sources.map(item => item.id === source.id ? { ...item, directory: result.filePaths[0] } : item);
    await replaceMonitor();
    await saveSettings();
  });
  handle('monitor:telemetry-setup', id => {
    const source = selectedSource(id);
    if (source.runtime !== 'claude-code') throw new Error(t('To narzędzie udostępnia obecnie tylko podgląd.'));
    const helper = app.isPackaged ? path.join(process.resourcesPath, 'collect-telemetry.mjs') : path.resolve(here, '../../scripts/collect-telemetry.mjs');
    // POSIX shells and cmd.exe need different quoting; all arguments originate from trusted paths/validated IDs.
    const quote = (value: string) => process.platform === 'win32' ? `"${value.replace(/"/g, '')}"` : "'" + value.replace(/'/g, "'\\''") + "'";
    const command = ['node', helper, '--directory', monitor.telemetryDirectory(source.id), '--source', source.id].map(quote).join(' ');
    clipboard.writeText(JSON.stringify({ statusLine: { type: 'command', command } }, null, 2));
  });
  handle('monitor:settings', async value => {
    const input = validateSettingsPatch(value);
    if (input.sources) { settings.sources = input.sources; await replaceMonitor(); }
    if (input.language) settings.language = input.language;
    if (typeof input.showCompleted === 'boolean') settings.showCompleted = input.showCompleted;
    if (typeof input.showEstimatedCosts === 'boolean') settings.showEstimatedCosts = input.showEstimatedCosts;
    if (typeof input.launchAtLogin === 'boolean' && app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: input.launchAtLogin, args: ['--hidden'] });
      settings.launchAtLogin = loginSettings().openAtLogin;
    }
    await saveSettings();
    refreshMenus();
    publish();
  });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', showWindow);
  app.on('activate', showWindow);
  app.on('before-quit', () => {
    quitting = true;
    if (scanTimer) clearInterval(scanTimer);
    if (controlTimer) clearInterval(controlTimer);
    monitor?.dispose();
    for (const notification of activeNotifications) notification.close();
    activeNotifications.clear();
    tray?.destroy();
  });
  app.on('window-all-closed', () => { if (!tray) app.quit(); });
  void app.whenReady().then(async () => {
    electronSession.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    electronSession.defaultSession.setPermissionCheckHandler(() => false);
    settings = await loadSettings();
    systemNotifications.supported = Notification.isSupported();
    monitor = new AgentMonitor(settings.sources, path.join(app.getPath('userData'), 'telemetry'));
    snapshot = {
      sessions: [], scanning: true, scannedAt: '', sources: [], sourceDefaults, systemNotifications, errors: [],
      settings, platform: process.platform, version: `${app.getVersion()}${app.isPackaged ? '' : '-dev'}`,
    };
    registerIpc();
    makeTray();
    refreshMenus();
    makeWindow();
    await scan();
    if (!process.env.AI_MONITORING_SMOKE) void monitor.refreshControl().then(() => scan());
    scanTimer = setInterval(() => { void scan(); }, 1_500);
    if (!process.env.AI_MONITORING_SMOKE) controlTimer = setInterval(() => { void monitor.refreshControl().then(() => scan()); }, 5_000);
  }).catch(error => {
    dialog.showErrorBox('AI Monitoring', error instanceof Error ? error.message : t("Nie udało się uruchomić aplikacji."));
    app.quit();
  });
}
