import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Background, BackgroundVariant, ReactFlow, ReactFlowProvider, useReactFlow, type Edge } from '@xyflow/react';
import { Eye, Focus, Minus, Plus, ScanLine } from 'lucide-react';
import { AgentNode, type AgentGraphNode } from './AgentNode';
import { layoutForest, type ForestEntry } from '../lib/forest';
import { useI18n } from '../i18n';
import { fullNumber } from '../lib/format';
import type { TreeCostEstimate } from '../shared/types';

const nodeTypes = { agent: AgentNode };
// React Flow 13 interprets numeric padding as pixels, not the old fractional ratio.
const fitOptions = { padding: { top: 44, right: 24, bottom: 36, left: 24 }, maxZoom: 1, minZoom: 0.12, duration: 280, includeHiddenNodes: true };

interface Props {
  forest: Map<string, ForestEntry>;
  visible: Set<string>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onPreview: (id: string) => void;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  isDemo: boolean;
  costs: Map<string, TreeCostEstimate>;
  showEstimatedCosts: boolean;
}

function GraphCanvas({ forest, visible, selectedId, onSelect, onPreview, collapsed, onToggle, isDemo, costs, showEstimatedCosts }: Props) {
  const { t, unit, language } = useI18n();
  const flow = useReactFlow<AgentGraphNode>();
  const canvasRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number; trigger: HTMLElement | null } | null>(null);
  const layout = useMemo(() => layoutForest(forest, visible, collapsed), [forest, visible, collapsed]);
  const nodes: AgentGraphNode[] = useMemo(() => [...layout.shown].map(id => {
    const entry = forest.get(id)!;
    return { id, type: 'agent', width: 192, height: entry.session.lineage === 'root' && showEstimatedCosts ? 252 : 220, position: layout.positions.get(id)!, selected: selectedId === id,
      ariaLabel: `${entry.session.nickname ?? entry.session.project} · ${t(entry.session.lineage !== 'root' ? 'SUBAGENT' : 'SESJA GŁÓWNA')}`,
      data: { session: entry.session, isRoot: entry.session.lineage === 'root', childCount: entry.children.length, collapsed: collapsed.has(id), onToggle, cost: costs.get(id), showEstimatedCosts } };
  }), [layout, forest, collapsed, onToggle, selectedId, t, costs, showEstimatedCosts]);
  const edges: Edge[] = useMemo(() => [...layout.shown].flatMap(id => {
    const parent = forest.get(id)!.parentId;
    return parent && layout.shown.has(parent) ? [{ id: `${parent}-${id}`, source: parent, target: id, type: 'smoothstep', selectable: false,
      style: { stroke: selectedId === id || selectedId === parent ? '#6bdfbc' : '#3c4b56', strokeWidth: 1.4, opacity: selectedId === id || selectedId === parent ? 0.9 : 0.7 } }] : [];
  }), [layout, forest, selectedId]);
  const structure = `${showEstimatedCosts}:` + [...layout.shown].map(id => `${id}:${forest.get(id)?.parentId ?? ''}`).join('|');
  const lastStructure = useRef('');
  useEffect(() => {
    if (lastStructure.current === structure) return;
    lastStructure.current = structure;
    const timer = setTimeout(() => { void flow.fitView(fitOptions); }, 70);
    return () => clearTimeout(timer);
  }, [structure, flow]);
  useEffect(() => {
    if (!canvasRef.current) return;
    let timer: ReturnType<typeof setTimeout>;
    const observer = new ResizeObserver(() => {
      setMenu(null);
      clearTimeout(timer);
      timer = setTimeout(() => { void flow.fitView(fitOptions); }, 80);
    });
    observer.observe(canvasRef.current);
    return () => { observer.disconnect(); clearTimeout(timer); };
  }, [flow]);
  useEffect(() => {
    if (!menu) return;
    if (!layout.shown.has(menu.id)) { setMenu(null); return; }
    menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenu(null); };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); event.stopPropagation(); setMenu(null); menu.trigger?.focus({ preventScroll: true }); }
      if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) { event.preventDefault(); menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus(); }
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', keyboard, true);
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', keyboard, true); };
  }, [menu, layout.shown]);
  const select = useCallback((_event: React.MouseEvent, node: AgentGraphNode) => { setMenu(null); onSelect(node.id); }, [onSelect]);
  const showMenu = (id: string, clientX: number, clientY: number, trigger: HTMLElement | null) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (rect) setMenu({ id, x: Math.max(8, Math.min(clientX - rect.left, rect.width - 228)), y: Math.max(8, Math.min(clientY - rect.top, rect.height - 60)), trigger });
  };
  return <div ref={canvasRef} className="graph-canvas" data-testid="session-graph" onKeyDownCapture={event => {
    if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return;
    const node = (event.target as HTMLElement).closest<HTMLElement>('.react-flow__node');
    if (!node?.dataset.id) return;
    event.preventDefault(); event.stopPropagation(); const rect = node.getBoundingClientRect();
    showMenu(node.dataset.id, rect.x + rect.width / 2, rect.y + rect.height / 2, node);
  }}>
    <div className="canvas-label"><span className={isDemo ? 'demo-dot' : 'live-dot'} />{t(isDemo ? 'DANE DEMONSTRACYJNE' : 'ODCZYT LOKALNY')}<span className="canvas-label-divider" />{fullNumber(nodes.length, language)} {unit('nodes', nodes.length)}</div>
    <ReactFlow<AgentGraphNode> nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodeClick={select} onPaneClick={() => { setMenu(null); onSelect(null); }} onMoveStart={event => { if (event) setMenu(null); }} onNodeContextMenu={(event, node) => { event.preventDefault(); event.stopPropagation(); showMenu(node.id, event.clientX, event.clientY, (event.target as HTMLElement).closest('.react-flow__node')); }}
      nodesDraggable={false} nodesConnectable={false} elementsSelectable fitView fitViewOptions={fitOptions}
      minZoom={0.08} maxZoom={1.6} proOptions={{ hideAttribution: false }} className="dark" onlyRenderVisibleElements
      ariaLabelConfig={{
        'node.a11yDescription.default': t('Wybierz węzeł klawiszem Enter lub spacją. Naciśnij Escape, aby cofnąć wybór.'),
        'node.a11yDescription.keyboardDisabled': t('Wybierz węzeł klawiszem Enter lub spacją. Naciśnij Escape, aby cofnąć wybór.'),
        'node.a11yDescription.ariaLiveMessage': ({ x, y }) => t('Pozycja: {x}, {y}', { x, y }),
        'edge.a11yDescription.default': t('Połączenie między agentem a jego rodzicem.'),
        'controls.ariaLabel': t('Nawigacja po grafie'), 'controls.zoomIn.ariaLabel': t('Przybliż graf'),
        'controls.zoomOut.ariaLabel': t('Oddal graf'), 'controls.fitView.ariaLabel': t('Dopasuj graf'),
        'controls.interactive.ariaLabel': t('Przełącz interakcję'), 'minimap.ariaLabel': t('Minimapa'), 'handle.ariaLabel': t('Punkt połączenia'),
      }}
      defaultEdgeOptions={{ type: 'smoothstep' }}>
      <Background variant={BackgroundVariant.Dots} color="#35404c" gap={24} size={1} />
    </ReactFlow>
    {menu && <div ref={menuRef} className="agent-context-menu" role="menu" aria-label={t('Opcje agenta')} style={{ left: menu.x, top: menu.y }}><button role="menuitem" onClick={() => { onPreview(menu.id); setMenu(null); }}><Eye size={15} />{t('Podgląd sesji')}</button></div>}
    <div className="graph-legend"><span><i style={{ background: '#6bdfbc' }} />{t('Poniżej 70%')}</span><span><i style={{ background: '#f0bf74' }} />{t('70–89%')}</span><span><i style={{ background: '#fa8b8b' }} />{t('Od 90%')}</span></div>
    <div className="graph-controls"><button title={t("Oddal")} aria-label={t("Oddal graf")} onClick={() => { void flow.zoomOut({ duration: 180 }); }}><Minus size={16} /></button><button title={t("Przybliż")} aria-label={t("Przybliż graf")} onClick={() => { void flow.zoomIn({ duration: 180 }); }}><Plus size={16} /></button><span /><button title={t("Dopasuj do okna")} aria-label={t("Dopasuj graf")} onClick={() => { void flow.fitView(fitOptions); }}><Focus size={17} /></button><button title={t("Skala 100%")} aria-label={t("Skala 100 procent")} onClick={() => { void flow.zoomTo(1, { duration: 180 }); }}><ScanLine size={16} /></button></div>
    <div className="canvas-hint">{t('Przeciągnij tło, aby przesunąć · przewiń, aby przybliżyć')} · {t('Prawy przycisk agenta: podgląd sesji')}</div>
  </div>;
}

export function SessionGraph(props: Props) {
  return <ReactFlowProvider><GraphCanvas {...props} /></ReactFlowProvider>;
}
