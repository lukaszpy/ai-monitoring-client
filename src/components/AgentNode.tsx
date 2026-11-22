import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { ChevronDown, ChevronRight, GitBranch } from 'lucide-react';
import { Gauge } from './Gauge';
import { RUNTIME_LABELS, STATUS_LABELS, type AgentSession, type TreeCostEstimate } from '../shared/types';
import { estimatedUsd } from '../lib/format';
import { useI18n } from '../i18n';

export type AgentGraphNode = Node<{
  session: AgentSession;
  childCount: number;
  collapsed: boolean;
  isRoot: boolean;
  cost: TreeCostEstimate | undefined;
  showEstimatedCosts: boolean;
  onToggle: (id: string) => void;
}, 'agent'>;

export const AgentNode = memo(function AgentNode({ data, selected }: NodeProps<AgentGraphNode>) {
  const { t, message, language } = useI18n();
  const { session, childCount, collapsed, isRoot, onToggle, cost, showEstimatedCosts } = data;
  return <div className={`agent-node ${selected ? 'is-selected' : ''} ${isRoot ? 'is-root' : ''} ${isRoot && showEstimatedCosts ? 'has-cost' : ''}`} data-testid="agent-node" data-session-id={session.id}>
    {!isRoot && <Handle type="target" position={Position.Top} />}
    <div className="node-top"><span className={`node-kind ${isRoot ? 'root-kind' : ''}`}>{isRoot ? t("SESJA GŁÓWNA") : <><GitBranch size={10} /> {t("SUBAGENT")}</>}</span><span className={`runtime-badge runtime-${session.runtime}`} title={session.sourceId}>{RUNTIME_LABELS[session.runtime]}</span></div>
    <Gauge percent={session.contextPercent} estimated={session.contextQuality === 'estimated'} />
    <div className="node-name" title={session.nickname ?? session.title}>{session.nickname ?? (session.project === 'Bez projektu' ? t('Bez projektu') : session.project)}</div>
    <div className="node-role" title={session.role ?? message(session.title)}>{session.role ?? message(session.title)}</div>
    <div className="node-status"><i className={`status-dot status-${session.status}`} />{message(STATUS_LABELS[session.status])}{session.statusOrigin === 'log' && <span className="log-indicator" title={t("Ostatni stan zapisany w logu")}>· {t('log')}</span>}</div>
    {isRoot && showEstimatedCosts && <div className={`node-cost ${cost?.complete ? '' : 'cost-partial'}`} data-testid="root-cost" title={cost?.amountUsd == null ? cost?.missingModels.length ? t('Brak stawek dla modelu: {models}. Dodaj je w ustawieniach źródła.', { models: cost.missingModels.filter(Boolean).join(', ') || '—' }) : t('Brak danych o zużyciu tokenów w dostępnych logach.') : t('To tylko estymacja według stawek źródła, nie kwota rachunku ani rozliczenie abonamentu.')}><span>{t('Koszt drzewa · estymacja')}</span><strong>≈ {estimatedUsd(cost?.amountUsd ?? null, language)}{cost?.amountUsd != null && !cost?.complete ? '*' : ''}</strong></div>}
    {childCount > 0 && <button className="node-collapse nodrag nopan" onClick={event => { event.stopPropagation(); onToggle(session.id); }} aria-label={t(collapsed ? 'Rozwiń subagentów {name}' : 'Zwiń subagentów {name}', { name: session.nickname ?? session.project })}>{collapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}{childCount}</button>}
    {childCount > 0 && <Handle type="source" position={Position.Bottom} />}
  </div>;
});
