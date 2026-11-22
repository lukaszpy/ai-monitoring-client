import { ArrowUpRight, Check, ChevronRight, Copy, FileText, GitBranch, Layers, RotateCcw, Sparkles, X } from 'lucide-react';
import { useState } from 'react';
import type { AgentSession, MonitorSnapshot, TreeCostEstimate } from '../shared/types';
import { RUNTIME_LABELS, SOURCE_LABELS, STATUS_LABELS } from '../shared/types';
import { ago, compactNumber, contextColor, dateTime, fullNumber, estimatedUsd } from '../lib/format';
import { Gauge } from './Gauge';
import { useI18n } from '../i18n';

function Sparkline({ session }: { session: AgentSession }) {
  const { t } = useI18n();
  if (session.history.length < 2) return <div className="sparkline-empty">{t("Wykres pojawi się po kolejnych pomiarach.")}</div>;
  const values = session.history;
  const ceiling = Math.max(100, ...values.map(value => value.percent));
  const points = values.map((value, i) => `${i / (values.length - 1) * 260},${68 - value.percent / ceiling * 56}`).join(' ');
  return <svg className="sparkline" viewBox="0 0 260 78" role="img" aria-label={t("Historia zapełnienia kontekstu")}>
    <defs><linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={contextColor(session.contextPercent)} stopOpacity=".2" /><stop offset="100%" stopColor={contextColor(session.contextPercent)} stopOpacity="0" /></linearGradient></defs>
    <path d={`M 0 68 L ${points.replace(/ /g, ' L ')} L 260 78 L 0 78 Z`} fill="url(#spark-fill)" />
    <line x1="0" y1="68" x2="260" y2="68" stroke="#252c37" strokeDasharray="3 4" />
    <polyline points={points} fill="none" stroke={contextColor(session.contextPercent)} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

interface Props {
  session: AgentSession;
  snapshot: MonitorSnapshot;
  cost?: TreeCostEstimate;
  isDemo: boolean;
  depth: number;
  childCount: number;
  onClose: () => void;
  onParent: () => void;
  onAction: (action: 'compact' | 'fresh', session: AgentSession) => Promise<void>;
  busy: boolean;
}

export function DetailsPanel({ session, snapshot, cost, isDemo, depth, childCount, onClose, onParent, onAction, busy }: Props) {
  const { t, message, unit, language } = useI18n();
  const [copied, setCopied] = useState(false);
  const compact = session.actions.find(action => action.id === 'compact');
  const fresh = session.actions.find(action => action.id === 'fresh-context');
  const canControl = !isDemo && !!compact?.available;
  const reason = isDemo ? t('Dane demonstracyjne — operacje na sesjach są wyłączone.') : compact?.reason ? message(compact.reason) : null;
  return <aside className="details-panel" data-testid="details-panel">
    <div className="details-heading"><span>{t("SZCZEGÓŁY WĘZŁA")}</span><button className="icon-button" onClick={onClose} aria-label={t("Zamknij szczegóły")}><X size={17} /></button></div>
    <div className="detail-identity"><div className="identity-icon">{session.lineage !== 'root' ? <GitBranch size={21} /> : <Layers size={21} />}</div><div><span className="eyebrow">{session.lineage !== 'root' ? t("SUBAGENT") : t("SESJA GŁÓWNA")}</span><h2>{session.nickname ?? (session.project === 'Bez projektu' ? t('Bez projektu') : session.project)}</h2></div></div>
    <p className="detail-description">{session.role ?? message(session.title)}</p>
    <div className="detail-status"><span className={`status-pill pill-${session.status}`}><i className={`status-dot status-${session.status}`} />{message(STATUS_LABELS[session.status])}</span><span>{session.statusOrigin === 'runtime' ? t("Stan z Codex") : t("Ostatni stan z logu")}</span></div>
    <section className="context-section"><div className="section-caption">{t("OKNO KONTEKSTU")}<span>{t("Ostatni pomiar")}</span></div>
      <div className="detail-gauge"><Gauge percent={session.contextPercent} estimated={session.contextQuality === 'estimated'} size={142} stroke={7} /></div>
      <div className="context-tokens"><strong>{session.contextTokens === null ? '—' : compactNumber(session.contextTokens, language)}</strong><span>/ {session.contextLimit === null ? '—' : compactNumber(session.contextLimit, language)} {t('tokenów')}</span></div>
      <div className="measurement-age"><i className="tiny-dot" />{ago(session.measuredAt, language)}</div>
      <p className="measurement-note">{t(session.contextLimit === null ? 'Log nie podaje limitu okna. Procent pozostaje nieznany.' : session.contextQuality === 'estimated' ? 'Procent obliczony z limitu podanego w ustawieniach źródła.' : 'Pomiar z danych narzędzia. Odświeża się po otrzymaniu nowego zużycia.')}</p>
    </section>
    <section className="history-section"><div className="section-caption">{t("HISTORIA KONTEKSTU")}<span>{fullNumber(session.history.length, language)} {unit('measurements', session.history.length)}</span></div><Sparkline session={session} /><div className="history-labels"><span>{t("Wcześniej")}</span><span>{t("Ostatni pomiar")}</span></div></section>
    {snapshot.settings.showEstimatedCosts && <section className="cost-details" data-testid="cost-details"><div className="section-caption">{t(session.lineage === 'root' ? 'Koszt drzewa · estymacja' : 'Koszt agenta · estymacja')}</div>
      <strong className="cost-details-total">≈ {estimatedUsd(session.lineage === 'root' ? cost?.amountUsd ?? null : session.estimatedCost.amountUsd, language)}</strong>
      {session.lineage === 'root' && cost && <dl className="metadata-list"><div><dt>{t('Sam root')}</dt><dd>≈ {estimatedUsd(cost.rootUsd, language)}</dd></div><div><dt>{t('Wszyscy potomkowie')}</dt><dd>≈ {estimatedUsd(cost.descendantsUsd, language)}</dd></div><div><dt>{t('Pełne dane sesji')}</dt><dd>{cost.pricedSessionCount} / {cost.sessionCount}</dd></div></dl>}
      <p className="measurement-note">{t('To tylko estymacja według stawek źródła, nie kwota rachunku ani rozliczenie abonamentu.')}</p>
      {(session.lineage === 'root' ? !cost?.complete : !session.estimatedCost.complete) && <p className="inline-warning">{t('Estymacja niepełna — brakuje części stawek, danych zużycia lub relacji agentów.')}</p>}
      {(session.lineage === 'root' ? cost?.missingModels : session.estimatedCost.missingModels)?.length ? <p className="source-hint">{t('Uzupełnij stawki w ustawieniach źródła. Modele: {models}', { models: (session.lineage === 'root' ? cost?.missingModels ?? [] : session.estimatedCost.missingModels).map(model => model || t('Model nieznany')).join(', ') })}</p> : null}
    </section>}
    <section className="metadata-section"><div className="section-caption">{t("INFORMACJE")}</div>
      <dl className="metadata-list">
        <div><dt>{t("Narzędzie AI")}</dt><dd>{RUNTIME_LABELS[session.runtime]}</dd></div>
        <div><dt>{t("Pomiar")}</dt><dd>{t(session.contextQuality === 'reported' ? 'Z narzędzia' : session.contextQuality === 'estimated' ? 'Szacowany' : 'Brak limitu lub pomiaru')}</dd></div>
        <div><dt>{t("Źródło danych")}</dt><dd title={session.contextMethod}>{session.sourceId}</dd></div>
        <div><dt>{t("Model")}</dt><dd title={session.model ?? ''}>{session.model ?? t("Brak danych")}</dd></div>
        <div><dt>{t("Źródło")}</dt><dd>{message(SOURCE_LABELS[session.source])}</dd></div>
        <div><dt>{t("Projekt")}</dt><dd title={session.cwd}>{session.project === 'Bez projektu' ? t('Bez projektu') : session.project}</dd></div>
        <div><dt>{t("Poziom / dzieci")}</dt><dd>{depth} / {childCount}</dd></div>
        <div><dt>{t("Kompakcje")}</dt><dd>{session.compactions}</dd></div>
        <div><dt>{t("Zużycie łączne")}</dt><dd title={t('{count} tokenów; nie oznacza zajętości kontekstu', { count: fullNumber(session.totalTokens, language) })}>{compactNumber(session.totalTokens, language)} {t('tokenów')}</dd></div>
        <div><dt>{t("Utworzono")}</dt><dd>{dateTime(session.createdAt, language)}</dd></div>
      </dl>
      <button className="session-id" aria-label={t("Kopiuj identyfikator sesji")} onClick={() => { const copy = window.monitor && !isDemo ? window.monitor.copySessionId(session.id) : navigator.clipboard.writeText(session.externalId); void copy.then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }).catch(() => undefined); }} title={session.externalId}><code>{session.externalId}</code>{copied ? <Check size={13} /> : <Copy size={13} />}</button>
      {session.lineage === 'unknown-parent' && <p className="inline-warning">{t('Brak potwierdzonego rodzica w lokalnych logach.')}</p>}
      {session.parentId && <button className="text-link" onClick={onParent}><GitBranch size={13} />{t("Przejdź do rodzica")}<ChevronRight size={13} /></button>}
    </section>
    <section className="actions-section"><div className="section-caption">{t("ZARZĄDZANIE KONTEKSTEM")}</div>
      <button className="primary-button full-width" disabled={!canControl || busy} title={reason ?? t("Podsumuj historię wybranego agenta")} onClick={() => { void onAction('compact', session); }}><Sparkles size={15} />{busy ? t("Przetwarzanie…") : t("Kompaktuj kontekst")}<ArrowUpRight size={14} /></button>
      <button className="secondary-button full-width" disabled={isDemo || busy || !fresh?.available} title={session.lineage !== 'root' ? t("Nowego subagenta trzeba utworzyć z sesji rodzica.") : reason ?? t("Utwórz nową pustą sesję w tym projekcie")} onClick={() => { void onAction('fresh', session); }}><RotateCcw size={14} />{t("Świeży kontekst")}</button>
      <p className="action-note">{reason ?? (session.lineage !== 'root' ? t("Świeży kontekst subagenta wymaga utworzenia nowego agenta przez rodzica.") : t("Świeży kontekst tworzy nową sesję. Obecna historia pozostaje dostępna."))}</p>
      <button className="text-link" disabled={isDemo} onClick={() => { void window.monitor?.revealSession(session.id); }}><FileText size={13} />{t("Pokaż plik sesji")}<ArrowUpRight size={12} /></button>
      {session.warnings.map(warning => <p className="inline-warning" key={warning}>{message(warning)}</p>)}
    </section>
  </aside>;
}
