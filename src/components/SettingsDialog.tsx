import { Copy, FolderOpen, HardDrive, Plus, RotateCcw, Settings2, ShieldCheck, Trash2, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { RUNTIMES, RUNTIME_LABELS, type AgentSourceConfig, type MonitorSnapshot, type RuntimeId } from '../shared/types';
import { useI18n } from '../i18n';
import { isLanguage, LANGUAGES, LANGUAGE_NAMES, type Language } from '../shared/i18n';
import { SourceAlertSettings } from './SourceAlertSettings';
import { ModelPriceSettings } from './ModelPriceSettings';

type SettingsTab = 'general' | 'sources';

export function SettingsDialog({ snapshot, isDemo, onClose, onLanguageChange }: { snapshot: MonitorSnapshot; isDemo: boolean; onClose: () => void; onLanguageChange: (language: Language) => Promise<void> }) {
  const { t, language, message } = useI18n();
  const dialogId = useId();
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const tabRefs = useRef<Partial<Record<SettingsTab, HTMLButtonElement | null>>>({});
  const tabs = [{ id: 'general', label: 'Ogólne', icon: Settings2 }, { id: 'sources', label: 'Źródła danych', icon: HardDrive }] as const;
  const closeRef = useRef<HTMLButtonElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [showCompleted, setShowCompleted] = useState(snapshot.settings.showCompleted);
  const [launchAtLogin, setLaunchAtLogin] = useState(snapshot.settings.launchAtLogin);
  const [showEstimatedCosts, setShowEstimatedCosts] = useState(snapshot.settings.showEstimatedCosts);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [adding, setAdding] = useState<RuntimeId>('codex');
  const [saving, setSaving] = useState(false);
  const saveSources = async (sources: AgentSourceConfig[]) => {
    if (saving || isDemo) return;
    setSaving(true); setError('');
    try { await window.monitor?.updateSettings({ sources }); }
    catch { setError('Nie udało się zapisać ustawienia.'); }
    finally { setSaving(false); }
  };
  const changeSource = (id: string, patch: Partial<AgentSourceConfig>) => saveSources(snapshot.settings.sources.map(source => source.id === id ? { ...source, ...patch } : source));
  useEffect(() => setShowCompleted(snapshot.settings.showCompleted), [snapshot.settings.showCompleted]);
  useEffect(() => setLaunchAtLogin(snapshot.settings.launchAtLogin), [snapshot.settings.launchAtLogin]);
  useEffect(() => setShowEstimatedCosts(snapshot.settings.showEstimatedCosts), [snapshot.settings.showEstimatedCosts]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const listener = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab') return;
      const focusable = Array.from(containerRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]') ?? []).filter(element => element.tabIndex >= 0 && element.getClientRects().length > 0);
      if (!focusable?.length) return;
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', listener);
    return () => { document.removeEventListener('keydown', listener); previous?.focus(); };
  }, [onClose]);
  return <div className="modal-backdrop" onClick={onClose}><div ref={containerRef} className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={event => event.stopPropagation()}>
    <div className="dialog-title"><div><span className="eyebrow">AI MONITORING</span><h2 id="settings-title">{t("Ustawienia")}</h2></div><button ref={closeRef} className="icon-button" onClick={onClose} aria-label={t("Zamknij ustawienia")}><X size={20} /></button></div>
    <div className="settings-tabs" role="tablist" aria-label={t('Zakładki ustawień')}>
      {tabs.map(({ id, label, icon: Icon }, index) => <button key={id} ref={element => { tabRefs.current[id] = element; }} role="tab" id={`${dialogId}-tab-${id}`} aria-controls={`${dialogId}-panel-${id}`} aria-selected={activeTab === id} tabIndex={activeTab === id ? 0 : -1} onClick={() => setActiveTab(id)} onKeyDown={event => {
        const nextIndex = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
        if (nextIndex === null) return;
        event.preventDefault();
        const next = tabs[nextIndex].id; setActiveTab(next); tabRefs.current[next]?.focus();
      }}><Icon size={15} />{t(label)}</button>)}
    </div>
    <div className="settings-content">
      <section role="tabpanel" id={`${dialogId}-panel-general`} aria-labelledby={`${dialogId}-tab-general`} hidden={activeTab !== 'general'}>
    <label className="language-setting"><div><strong>{t('Język interfejsu')}</strong><span>{t('Zmiana działa od razu i jest zapisywana na tej stacji.')}</span></div>
      <select data-testid="language-select" aria-label={t('Język')} value={language} onChange={event => {
        const selected = event.target.value;
        if (isLanguage(selected)) void onLanguageChange(selected).catch(() => setError('Nie udało się zapisać ustawienia.'));
      }}>{LANGUAGES.map(code => <option key={code} value={code} lang={code}>{LANGUAGE_NAMES[code]}</option>)}</select>
    </label>
    <label className="setting-toggle"><div><strong>{t("Pokaż zakończonych agentów")}</strong><span>{t("Zachowaj pełny obraz hierarchii.")}</span></div><input type="checkbox" checked={showCompleted} disabled={isDemo} onChange={event => { const checked = event.target.checked; setShowCompleted(checked); void window.monitor?.updateSettings({ showCompleted: checked }).catch(() => { setShowCompleted(!checked); setError(t("Nie udało się zapisać ustawienia.")); }); }} /></label>
    <label className="setting-toggle"><div><strong>{t('Pokaż szacowany koszt drzewa')}</strong><span>{t('To tylko estymacja według stawek źródła, nie kwota rachunku ani rozliczenie abonamentu.')}</span></div><input type="checkbox" checked={showEstimatedCosts} disabled={isDemo} onChange={event => { const checked = event.target.checked; setShowEstimatedCosts(checked); void window.monitor?.updateSettings({ showEstimatedCosts: checked }).catch(() => { setShowEstimatedCosts(!checked); setError('Nie udało się zapisać ustawienia.'); }); }} /></label>
    <label className="setting-toggle"><div><strong>{t("Uruchamiaj przy logowaniu")}</strong><span>{snapshot.version.includes('dev') ? t("Dostępne po zainstalowaniu aplikacji.") : t("Startuj w tle z ikoną systemową.")}</span></div><input type="checkbox" checked={launchAtLogin} disabled={isDemo || snapshot.version.includes('dev')} onChange={event => { const checked = event.target.checked; setLaunchAtLogin(checked); void window.monitor?.updateSettings({ launchAtLogin: checked }).catch(() => { setLaunchAtLogin(!checked); setError(t("Nie udało się zapisać ustawienia.")); }); }} /></label>
      </section>
      <section role="tabpanel" id={`${dialogId}-panel-sources`} aria-labelledby={`${dialogId}-tab-sources`} hidden={activeTab !== 'sources'}>
    <div className="setting-section"><h3><HardDrive size={16} />{t('Lokalne źródła danych')}</h3><p>{t('Każde źródło jest osobnym katalogiem narzędzia. Zmiany zapisują się automatycznie.')}</p><p>{t('Domyślne ścieżki korzystają z katalogu domowego bieżącego użytkownika systemu.')}</p>
      {!snapshot.systemNotifications.supported && <p className="inline-warning">{t('Powiadomienia systemowe nie są dostępne w tym środowisku.')}</p>}
      {snapshot.systemNotifications.error && <p className="inline-warning" role="alert">{message(snapshot.systemNotifications.error)}</p>}
      <p className="source-hint">{t('Banery zależą od uprawnień aplikacji i ustawień powiadomień w systemie.')}</p>
      {snapshot.settings.sources.map(source => {
        const state = snapshot.sources.find(item => item.id === source.id);
        const defaults = snapshot.sourceDefaults.find(item => item.runtime === source.runtime);
        return <div className="source-card" key={source.id} data-testid={`source-${source.id}`}>
          <div className="source-card-heading"><strong className={`runtime-badge runtime-${source.runtime}`}>{RUNTIME_LABELS[source.runtime]}</strong><code title={source.id}>{source.id}</code><button className="icon-button" aria-label={t('Usuń źródło {id}', { id: source.id })} disabled={isDemo || saving} onClick={() => { void saveSources(snapshot.settings.sources.filter(item => item.id !== source.id)); }}><Trash2 size={13} /></button></div>
          <label className="source-enabled"><span>{t('Włącz źródło')}</span><input type="checkbox" checked={source.enabled} disabled={isDemo || saving} onChange={event => { void changeSource(source.id, { enabled: event.target.checked }); }} /></label>
          <div className="directory-path">{source.directory}</div>
          <div className="source-actions"><button disabled={isDemo || saving} className="secondary-button" onClick={() => { void window.monitor?.chooseDirectory(source.id).catch(() => setError('Nie udało się zmienić katalogu. Sprawdź uprawnienia.')); }}><FolderOpen size={13} />{t('Zmień katalog')}</button>{defaults && <button className="secondary-button" disabled={isDemo || saving || source.directory === defaults.directory} aria-label={t('Przywróć domyślny katalog {id}', { id: source.id })} title={defaults.directory} onClick={() => { void changeSource(source.id, { directory: defaults.directory }); }}><RotateCcw size={13} />{t('Przywróć domyślny')}</button>}<span>{!source.enabled ? t('Wyłączone') : !state?.exists ? t('Brak katalogu danych') : t('Sesje: {count}', { count: state.sessions })}</span></div>
          {defaults && <p className="source-hint default-source-path">{t('Domyślny katalog: {path}', { path: defaults.directory })}</p>}
          <label className="context-limit-setting"><span>{t('Własny limit kontekstu (tokeny)')}</span><input type="number" min="1" max="1000000000" step="1" aria-label={t('Limit kontekstu {id}', { id: source.id })} key={`${source.id}-${source.contextLimitOverride}`} defaultValue={source.contextLimitOverride ?? ''} placeholder={t('Automatycznie / nieznany')} disabled={isDemo || saving} onBlur={event => {
            const raw = event.target.value, value = raw === '' ? null : Number(raw);
            if (value !== null && (!Number.isSafeInteger(value) || value <= 0 || value > 1e9)) { setError('Nieprawidłowy limit kontekstu.'); return; }
            if (source.contextLimitOverride !== value) void changeSource(source.id, { contextLimitOverride: value });
          }} /></label>
          <p className="source-hint">{t('Własny limit oznacza pomiar szacowany. Użyj osobnych źródeł dla różnych limitów modeli.')}</p>
          <SourceAlertSettings key={JSON.stringify(source.contextAlerts)} sourceId={source.id} settings={source.contextAlerts} supported={snapshot.systemNotifications.supported} disabled={isDemo || saving} onSave={contextAlerts => changeSource(source.id, { contextAlerts })} />
          <ModelPriceSettings key={`prices-${JSON.stringify(source.modelPrices)}`} runtime={source.runtime} useBuiltInPrices={source.useBuiltInPrices} onBuiltInChange={useBuiltInPrices => changeSource(source.id, { useBuiltInPrices })} prices={source.modelPrices} models={[...new Set(snapshot.sessions.filter(session => session.sourceId === source.id).flatMap(session => session.costUsage.flatMap(usage => usage.model ? [usage.model] : [])))]} disabled={isDemo || saving} onSave={modelPrices => changeSource(source.id, { modelPrices })} />
          {source.runtime === 'claude-code' && <><button className="text-link" disabled={isDemo || saving} onClick={() => { void window.monitor?.copyTelemetrySetup(source.id).then(() => setNotice('Skopiowano konfigurację statusLine. Połącz ją ze swoim settings.json Claude Code; wymagany jest Node.js.')).catch(() => setError('Nie udało się skopiować konfiguracji.')); }}><Copy size={12} />{t('Kopiuj konfigurację pomiaru Claude')}</button><p className="source-hint">{t('Opcjonalny statusLine dostarcza limit sesji głównej. Monitor nie zmienia konfiguracji Claude.')}</p></>}
          {state?.errors.map(error => <p className="inline-warning" key={error}>{message(error)}</p>)}
        </div>;
      })}
      <div className="add-source"><select aria-label={t('Typ nowego źródła')} value={adding} onChange={event => setAdding(event.target.value as RuntimeId)}>{RUNTIMES.map(runtime => <option key={runtime} value={runtime}>{RUNTIME_LABELS[runtime]}</option>)}</select><button className="secondary-button" disabled={isDemo || saving || snapshot.settings.sources.length >= 24 || !snapshot.sourceDefaults.some(source => source.runtime === adding)} onClick={() => {
        const defaults = snapshot.sourceDefaults.find(source => source.runtime === adding);
        if (defaults) void saveSources([...snapshot.settings.sources, { ...defaults, id: `${adding}-${crypto.randomUUID().slice(0, 8)}`, enabled: false }]);
      }}><Plus size={13} />{t('Dodaj źródło')}</button></div>
    </div>
      </section>
    </div>
    {error && <p className="inline-warning" role="alert">{message(error)}</p>}
    {notice && <p className="source-hint" role="status">{message(notice)}</p>}
    <div className="privacy-note"><ShieldCheck size={19} /><p>{t("Dane są przetwarzane na tej stacji. Monitor nie wysyła rozmów do chmury. Kompakcję wykonuje Codex i może ona wywołać model.")}</p></div>
    <div className="settings-version">{t('Wersja {version}', { version: snapshot.version })} · {snapshot.platform} · Electron</div>
  </div></div>;
}
