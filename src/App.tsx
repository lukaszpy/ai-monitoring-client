import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, ArrowDownUp, ArrowUpRight, Check, ChevronRight, CircleHelp, Folder, FolderOpen, GitBranch, HardDrive, Layers, LayoutDashboard, Network, Radio, RefreshCw, Search, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, Terminal, X } from 'lucide-react';
import { demoSnapshot } from './demo';
import { createForest, descendants, withAncestors } from './lib/forest';
import { ago, contextColor, fullNumber } from './lib/format';
import { DetailsPanel } from './components/DetailsPanel';
import { SessionGraph } from './components/SessionGraph';
import { SettingsDialog } from './components/SettingsDialog';
import { SessionPreviewLayer } from './components/SessionPreview';
import { RUNTIMES, RUNTIME_LABELS, type RuntimeId, type AgentSession, type MonitorSnapshot } from './shared/types';
import { I18nProvider, useI18n } from './i18n';
import { resolveLanguage, type Language } from './shared/i18n';
import { aggregateTreeCosts } from './lib/costs';

const demo = demoSnapshot();
const empty: MonitorSnapshot = { ...demo, sessions: [], scanning: true, sources: [], scannedAt: '', platform: '' };

export default function App() {
  const [live, setLive] = useState<MonitorSnapshot>(empty);
  const [browserLanguage, setBrowserLanguage] = useState<Language>(() => {
    try { return resolveLanguage(localStorage.getItem('ai-monitoring.language')); } catch { return 'pl'; }
  });
  useEffect(() => {
    if (!window.monitor) return;
    let mounted = true;
    const unsubscribe = window.monitor.onSnapshot(value => { if (mounted) setLive(value); });
    void window.monitor.getSnapshot().then(value => { if (mounted) setLive(value); }).catch(() => {
      if (mounted) setLive(previous => ({ ...previous, errors: ['Nie udało się połączyć z monitorem.'] }));
    });
    return () => { mounted = false; unsubscribe(); };
  }, []);
  const onLanguageChange = useCallback(async (language: Language) => {
    if (window.monitor) await window.monitor.updateSettings({ language });
    else {
      try { localStorage.setItem('ai-monitoring.language', language); } catch { /* Language still works when storage is blocked. */ }
      setBrowserLanguage(language);
    }
  }, []);
  return <I18nProvider language={window.monitor ? live.settings.language : browserLanguage}><MonitorApp live={live} onLanguageChange={onLanguageChange} /></I18nProvider>;
}

function MonitorApp({ live, onLanguageChange }: { live: MonitorSnapshot; onLanguageChange: (language: Language) => Promise<void> }) {
  const { t, language, message, unit } = useI18n();
  const demo = useMemo(() => demoSnapshot(language), [language]);
  const browserPreview = !window.monitor;
  const [demoMode, setDemoMode] = useState(browserPreview);
  const [rootFilter, setRootFilter] = useState<string | null>(null);
  const [scope, setScope] = useState<'recent' | 'all' | 'high'>('recent');
  const [runtimeFilter, setRuntimeFilter] = useState<RuntimeId | 'all'>('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewIds, setPreviewIds] = useState<string[]>([]);
  const [notificationFocusId, setNotificationFocusId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);
  const [, setTick] = useState(0);
  const snapshot = demoMode ? { ...demo, settings: { ...demo.settings, showEstimatedCosts: browserPreview ? demo.settings.showEstimatedCosts : live.settings.showEstimatedCosts } } : live;

  useEffect(() => window.monitor?.onFocusSession(id => {
    setDemoMode(false); setRuntimeFilter('all'); setRootFilter(null); setScope('all');
    setQuery(''); setCollapsed(new Set()); setSelectedId(id); setNotificationFocusId(id); setSettingsOpen(false); setHelpOpen(false); setPreviewIds([]);
  }), []);
  useEffect(() => { if (selectedId !== notificationFocusId) setNotificationFocusId(null); }, [selectedId, notificationFocusId]);

  useEffect(() => { const timer = setInterval(() => setTick(value => value + 1), 15_000); return () => clearInterval(timer); }, []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(null), 9000); return () => clearTimeout(timer); }, [toast]);
  const forest = useMemo(() => createForest(snapshot.sessions), [snapshot.sessions]);
  const costs = useMemo(() => aggregateTreeCosts(forest), [forest]);
  const roots = useMemo(() => [...forest.values()].filter(entry => entry.session.lineage === 'root').sort((a, b) => b.session.updatedAt.localeCompare(a.session.updatedAt)), [forest]);
  const visible = useMemo(() => {
    const allowed = rootFilter ? descendants(forest, rootFilter) : new Set(forest.keys());
    const matching = new Set<string>();
    const cutoff = Date.now() - 86_400_000;
    const search = query.trim().toLocaleLowerCase(language);
    for (const id of allowed) {
      const entry = forest.get(id); if (!entry) continue;
      const s = entry.session;
      if (runtimeFilter !== 'all' && s.runtime !== runtimeFilter) continue;
      if (s.id !== notificationFocusId && !snapshot.settings.showCompleted && (s.status === 'completed' || s.status === 'interrupted')) continue;
      if (!rootFilter && scope === 'recent' && Date.parse(s.updatedAt) < cutoff && !(s.statusOrigin === 'runtime' && (s.status === 'running' || s.status === 'idle' || s.status === 'waiting'))) continue;
      if (scope === 'high' && (s.contextPercent ?? 0) < 70) continue;
      if (search && ![s.title, s.project, s.nickname, s.role, s.id, s.model].some(value => value?.toLocaleLowerCase(language).includes(search))) continue;
      matching.add(id);
    }
    return withAncestors(forest, matching);
  }, [forest, rootFilter, scope, query, snapshot.settings.showCompleted, language, runtimeFilter, notificationFocusId]);
  const selected = selectedId && visible.has(selectedId) ? forest.get(selectedId) : undefined;
  const graphCollapsed = useMemo(() => query.trim() ? new Set<string>() : collapsed, [query, collapsed]);
  const working = snapshot.sessions.filter(s => s.status === 'running' || s.status === 'compacting').length;
  const max = snapshot.sessions.reduce<number | null>((value, s) => s.contextPercent === null ? value : Math.max(value ?? 0, s.contextPercent), null);
  const high = snapshot.sessions.filter(s => (s.contextPercent ?? 0) >= 70).length;
  const rootCount = snapshot.sessions.filter(s => s.lineage === 'root').length;
  const toggleCollapse = useCallback((id: string) => setCollapsed(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; }), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const resetView = () => { setRuntimeFilter('all'); setRootFilter(null); setScope('recent'); setQuery(''); setSelectedId(null); setCollapsed(new Set()); };
  const changeDemo = () => { if (browserPreview) return; setDemoMode(value => !value); setPreviewIds([]); resetView(); };
  const openPreview = useCallback((id: string) => setPreviewIds(previous => previous.at(-1) === id ? previous : [...previous.filter(value => value !== id), id]), []);
  const closePreview = useCallback((id: string) => setPreviewIds(previous => previous.filter(value => value !== id)), []);
  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try { await window.monitor?.refresh(); }
    catch { setToast({ text: t("Nie udało się odświeżyć danych."), ok: false }); }
    finally { setRefreshing(false); }
  };
  const action = async (kind: 'compact' | 'fresh', session: AgentSession) => {
    if (!window.monitor || demoMode || busy) return;
    setBusy(true);
    try {
      const result = await (kind === 'compact' ? window.monitor.compact(session.id) : window.monitor.freshContext(session.id));
      setToast({ text: result.message, ok: result.ok });
      if (result.threadId) { resetView(); setScope('all'); setSelectedId(result.threadId); }
    } catch { setToast({ text: t("Nie udało się wykonać operacji."), ok: false }); }
    finally { setBusy(false); }
  };

  return <div className={`app-shell platform-${browserPreview ? 'preview' : live.platform}`}>
    <div className="titlebar"><div className="titlebar-brand"><Network size={14} /><span>AI Monitoring</span></div><span className="titlebar-caption">{t("LOCAL AGENT OBSERVATORY")}</span><span className="titlebar-version">v{snapshot.version.replace('-dev', '')}</span></div>
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Network size={23} strokeWidth={1.8} /></div><div><strong>AI Monitoring</strong><span>{t("Twoi agenci. Jeden widok.")}</span></div></div>
      <div className="workspace-tag"><HardDrive size={13} /><span>{t("Stacja robocza")}</span><span className="workspace-local">{t("LOCAL")}</span></div>
      <div className="nav-caption">{t("PRZESTRZEŃ ROBOCZA")}</div>
      <button className={`nav-item ${!rootFilter ? 'active' : ''}`} onClick={resetView}><LayoutDashboard size={16} /><span>{t("Mapa agentów")}</span><span className="nav-counter">{snapshot.sessions.length}</span></button>
      <div className="sidebar-section-heading"><span>{t("SESJE GŁÓWNE")}</span><span>{roots.length}</span></div>
      <div className="root-list">
        {roots.map(({ session: s }) => <button key={s.id} className={`root-item ${rootFilter === s.id ? 'root-active' : ''}`} onClick={() => { setRuntimeFilter(s.runtime); setRootFilter(s.id); setScope('all'); setSelectedId(s.id); setQuery(''); }} title={s.title === 'Sesja Codex' ? t('Sesja Codex') : s.title}>
          <Folder size={14} /><div><strong>{s.nickname ?? (s.project === 'Bez projektu' ? t('Bez projektu') : s.project)}</strong><span>{RUNTIME_LABELS[s.runtime]} · {message(s.title)}</span></div><i className={`status-dot status-${s.status}`} />
        </button>)}
        {!roots.length && <div className="sidebar-empty">{snapshot.scanning ? t("Wczytywanie sesji…") : t("Sesje pojawią się tutaj.")}</div>}
      </div>
      <div className="sidebar-bottom"><button className="nav-item" onClick={() => setSettingsOpen(true)}><Settings2 size={16} /><span>{t("Ustawienia")}</span></button><button className="nav-item" onClick={() => setHelpOpen(value => !value)}><CircleHelp size={16} /><span>{t("Jak to działa")}</span><ArrowUpRight size={13} /></button>
        <div className="local-card"><div className="local-card-icon"><ShieldCheck size={19} /></div><div><strong>{t("Wszystko na tej stacji")}</strong><span>{t("Bez konta. Bez telemetrii.")}</span></div></div>
      </div>
    </aside>
    <main className="main-content">
      <header className="page-header"><div><div className="page-breadcrumb">{t("PRZESTRZEŃ ROBOCZA")}<ChevronRight size={11} /><span>{rootFilter ? forest.get(rootFilter)?.session.project : t("PRZEGLĄD")}</span></div><h1>{t("Mapa agentów")}<span className="header-live"><i className={demoMode ? 'demo-dot' : 'live-dot'} />{demoMode ? t("DEMO") : t("LIVE")}</span></h1><p>{t("Pełny obraz sesji, zależności i okien kontekstu.")}</p></div><div className="header-actions"><button className={`demo-button ${demoMode ? 'demo-selected' : ''}`} disabled={browserPreview} onClick={changeDemo}><Sparkles size={14} />{demoMode ? t("Dane demo") : t("Zobacz demo")}</button><button className={`icon-button bordered ${refreshing ? 'refreshing' : ''}`} aria-label={t("Odśwież dane")} title={t("Odśwież dane")} disabled={demoMode || refreshing} onClick={() => { void refresh(); }}><RefreshCw size={16} /></button><button className="icon-button bordered" aria-label={t("Otwórz ustawienia")} title={t("Ustawienia")} onClick={() => setSettingsOpen(true)}><Settings2 size={17} /></button></div></header>
      {demoMode && <div className="demo-banner"><Sparkles size={14} /><span>{t("Tryb demonstracyjny — przykładowe sesje, bez operacji na Twoich agentach.")}</span>{!browserPreview && <button onClick={changeDemo}>{t("Wróć do lokalnych danych")}<ArrowUpRight size={13} /></button>}</div>}
      {snapshot.errors.length > 0 && <div className="error-banner" role="alert">{snapshot.errors.slice(0, 2).map(message).join(' ')}</div>}
      <section className="stats-grid" aria-label={t("Podsumowanie sesji")}>
        <div className="stat-card"><div className="stat-top"><span>{t("Sesje główne")}</span><Layers size={16} /></div><div className="stat-value">{fullNumber(rootCount, language)}<span>{unit('sessions', rootCount)}</span></div><div className="stat-foot"><span className="neutral-dot" />{t("Wszystkie lokalne źródła")}</div></div>
        <div className="stat-card"><div className="stat-top"><span>{t("Subagenci")}</span><GitBranch size={16} /></div><div className="stat-value">{fullNumber(snapshot.sessions.length - rootCount, language)}<span>{unit('agents', snapshot.sessions.length - rootCount)}</span></div><div className="stat-foot"><GitBranch size={11} />{t("Pełna głębokość hierarchii")}</div></div>
        <div className="stat-card"><div className="stat-top"><span>{t("Ostatni stan: praca")}</span><Activity size={16} /></div><div className="stat-value mint-value">{fullNumber(working, language)}<span>{unit('agents', working)}</span></div><div className="stat-foot"><i className="live-dot" />{t("Stan z narzędzia lub świeżego logu")}</div></div>
        <div className="stat-card"><div className="stat-top"><span>{t("Najwyższy kontekst")}</span><ArrowDownUp size={16} /></div><div className="stat-value" style={{ color: contextColor(max) }}>{max === null ? '—' : Math.round(max)}{max !== null && <em>%</em>}</div><div className="stat-foot">{high ? <><i className="warning-dot" />{t('Kontekst ≥ 70%: {count}', { count: high })}</> : <><Check size={12} />{t("Brak wysokich pomiarów")}</>}</div></div>
      </section>
      <section className="graph-section"><div className="graph-toolbar"><div className="graph-title"><Network size={17} /><strong>{rootFilter ? forest.get(rootFilter)?.session.project : t("Hierarchia sesji")}</strong><span>{visible.size}</span>{rootFilter && <button className="clear-root" title={t("Pokaż wszystkie sesje")} aria-label={t("Usuń filtr sesji")} onClick={() => setRootFilter(null)}><X size={13} /></button>}</div><div className="graph-toolbar-right"><select className="runtime-filter" data-testid="runtime-filter" aria-label={t('Narzędzie AI')} value={runtimeFilter} onChange={event => { setRuntimeFilter(event.target.value as RuntimeId | 'all'); setRootFilter(null); setSelectedId(null); }}><option value="all">{t('Wszystkie narzędzia')}</option>{RUNTIMES.map(runtime => <option key={runtime} value={runtime}>{RUNTIME_LABELS[runtime]}</option>)}</select><label className="search-input"><Search size={14} /><input aria-label={t("Szukaj sesji lub agenta")} placeholder={t("Szukaj sesji lub agenta…")} value={query} onChange={event => setQuery(event.target.value)} />{query && <button aria-label={t("Wyczyść wyszukiwanie")} onClick={() => setQuery('')}><X size={12} /></button>}</label><div className="scope-tabs" aria-label={t("Filtr sesji")}><button className={scope === 'recent' ? 'selected' : ''} onClick={() => { setScope('recent'); setRootFilter(null); }}>{t("24 h")}</button><button className={scope === 'all' ? 'selected' : ''} onClick={() => setScope('all')}>{t("Wszystkie")}</button><button className={scope === 'high' ? 'selected' : ''} onClick={() => setScope('high')}>≥ 70%</button></div><button className="icon-button filter-button" aria-label={t("Ustawienia widoku")} title={t("Ustawienia widoku")} onClick={() => setSettingsOpen(true)}><SlidersHorizontal size={15} /></button></div></div>
        <div className="graph-body">{visible.size > 0 ? <SessionGraph forest={forest} visible={visible} selectedId={selected?.session.id ?? null} onSelect={setSelectedId} onPreview={openPreview} collapsed={graphCollapsed} onToggle={toggleCollapse} isDemo={demoMode} costs={costs} showEstimatedCosts={snapshot.settings.showEstimatedCosts} /> : <div className="empty-state"><div className="empty-icon">{snapshot.scanning ? <Radio size={29} /> : <Network size={29} />}</div><h2>{snapshot.scanning ? t("Odczytuję lokalne sesje…") : snapshot.sessions.length ? t("Brak pasujących agentów") : t("Czekam na pierwszą sesję")}</h2><p>{snapshot.sessions.length ? t("Zmień filtr lub wybierz inny zakres, aby zobaczyć hierarchię.") : t("Uruchom Codex, Claude Code lub Gemini CLI. Sprawdź katalogi źródeł w ustawieniach.")}</p><button className="secondary-button" onClick={() => { if (snapshot.sessions.length) { setScope('all'); setQuery(''); setRootFilter(null); } else setSettingsOpen(true); }}>{snapshot.sessions.length ? <><Network size={14} />{t("Pokaż wszystkie sesje")}</> : <><FolderOpen size={14} />{t("Zarządzaj źródłami")}</>}</button></div>}
          {selected && <DetailsPanel key={selected.session.id} session={selected.session} cost={costs.get(selected.rootId)} snapshot={snapshot} isDemo={demoMode} depth={selected.depth} childCount={selected.children.length} onClose={() => setSelectedId(null)} onParent={() => setSelectedId(selected.parentId)} onAction={action} busy={busy} />}
          <SessionPreviewLayer ids={previewIds} sessions={snapshot.sessions} isDemo={demoMode} onClose={closePreview} onActivate={openPreview} />
        </div>
      </section>
      <footer className="statusbar"><div><HardDrive size={12} /><span>{t('Aktywne źródła: {count}', { count: snapshot.settings.sources.filter(source => source.enabled).length })}</span><span className="footer-divider">/</span><span>{snapshot.scanning ? t("Skanowanie…") : t('Odczyt {time}', { time: ago(snapshot.scannedAt, language) })}</span></div><div><i className={snapshot.sources.some(source => source.control.status === 'connected') && !demoMode ? 'live-dot' : 'neutral-dot'} /><span>{demoMode ? t("Dane demo") : snapshot.sources.some(source => source.control.status === 'connected') ? t("Sterowanie połączone") : t("Podgląd z plików")}</span><span className="footer-divider">·</span><span>{t("Co 1,5 s")}</span></div></footer>
    </main>
    {settingsOpen && <SettingsDialog snapshot={snapshot} isDemo={demoMode} onClose={closeSettings} onLanguageChange={onLanguageChange} />}
    {helpOpen && <div className="help-card" role="dialog" aria-label={t("Jak działa monitor")}><div><Network size={18} /><strong>{t("Jedna mapa. Każdy agent.")}</strong><button className="icon-button" aria-label={t("Zamknij pomoc")} onClick={() => setHelpOpen(false)}><X size={16} /></button></div><p>{t("Każda sesja główna jest korzeniem. Ciągłe linie pokazują relacje z subagentami na dowolnej głębokości. Kliknij węzeł, aby zobaczyć szczegóły.")}</p><p>{t("Pierścień pokazuje przybliżoną zajętość kontekstu z ostatniego wywołania modelu. Łączne zużycie tokenów jest osobną liczbą.")}</p><p><Terminal size={13} />{t("Stan oznaczony „log” pochodzi z pliku. Potwierdzony stan procesu i akcje są dostępne po połączeniu z serwerem danej sesji.")}</p><div className="help-foot"><ShieldCheck size={13} />{t("Monitor nie modyfikuje plików sesji.")}</div></div>}
    {toast && <div className={`toast ${toast.ok ? 'toast-success' : ''}`} role="status"><span>{message(toast.text)}</span><button aria-label={t("Zamknij komunikat")} onClick={() => setToast(null)}><X size={15} /></button></div>}
  </div>;
}
