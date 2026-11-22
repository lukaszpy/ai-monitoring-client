import { useEffect, useId, useRef, useState, type PointerEvent } from 'react';
import { Eye, GripHorizontal, Radio, X } from 'lucide-react';
import { useI18n } from '../i18n';
import { ago } from '../lib/format';
import { constrainPosition, constrainSize, resizeFrame, RESIZE_EDGES, type Point, type ResizeEdge, type Size, type WindowFrame } from '../lib/floating-window';
import { RUNTIME_LABELS, STATUS_LABELS, type AgentSession, type SessionActivityKind, type SessionPreview as Preview } from '../shared/types';

const KIND_LABELS = { user: 'Użytkownik', assistant: 'Agent', tool: 'Wywołanie narzędzia', result: 'Wynik narzędzia', status: 'Stan sesji', error: 'Błąd' } as const satisfies Record<SessionActivityKind, string>;
const EVENT_LABELS = { task_started: 'Rozpoczęto pracę', turn_started: 'Rozpoczęto pracę', task_complete: 'Zakończono pracę', turn_complete: 'Zakończono pracę', turn_aborted: 'Przerwano pracę', context_compaction_started: 'Rozpoczęto kompakcję', compacted: 'Kontekst skompaktowany' } as const;

interface WindowProps {
  sessionId: string;
  session: AgentSession | undefined;
  bounds: Size;
  offset: number;
  order: number;
  isDemo: boolean;
  onClose: () => void;
  onActivate: () => void;
}

function PreviewWindow({ sessionId, session, bounds, offset, order, isDemo, onClose, onActivate }: WindowProps) {
  const { t, language, message } = useI18n();
  const titleId = useId();
  const knownSession = useRef(session);
  if (session) knownSession.current = session;
  const current = session ?? knownSession.current;
  const name = current?.nickname ?? current?.project ?? sessionId;
  const [preferredSize, setPreferredSize] = useState<Size>({ width: 560, height: 390 });
  const size = constrainSize(preferredSize, bounds);
  const [position, setPosition] = useState<Point>({ x: 24 + offset * 26, y: 24 + offset * 24 });
  const placed = constrainPosition(position, bounds, size);
  const drag = useRef<{ pointerId: number; start: Point; position: Point } | null>(null);
  const resize = useRef<{ pointerId: number; start: Point; frame: WindowFrame; edge: ResizeEdge } | null>(null);
  const [resizing, setResizing] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState(false);
  const [follow, setFollow] = useState(true);

  useEffect(() => {
    setPosition(previous => {
      const next = constrainPosition(previous, bounds, size);
      return next.x === previous.x && next.y === previous.y ? previous : next;
    });
  }, [bounds.width, bounds.height, size.width, size.height]);
  useEffect(() => { resize.current = null; setResizing(false); }, [bounds.width, bounds.height]);
  useEffect(() => { closeRef.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        const value: Preview = isDemo ? { sessionId, scannedAt: new Date().toISOString(), earlierEventsOmitted: false, events: [
          { id: 'demo-user', timestamp: null, kind: 'user', name: null, text: t('Przykładowa sesja: sprawdź projekt i przygotuj zmiany.'), truncated: false },
          { id: 'demo-tool', timestamp: null, kind: 'tool', name: 'terminal', text: 'git status --short', truncated: false },
          { id: 'demo-agent', timestamp: null, kind: 'assistant', name: null, text: t('Przykładowa aktywność agenta. To okno nie łączy się z rzeczywistą sesją.'), truncated: false },
        ] } : await window.monitor!.getSessionPreview(sessionId);
        if (!cancelled && value.sessionId === sessionId) { setPreview(value); setError(false); }
      } catch { if (!cancelled) setError(true); }
      if (!cancelled && !isDemo) timer = setTimeout(() => { void read(); }, 1500);
    };
    void read();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [sessionId, isDemo, language]);
  const signature = preview?.events.map(event => `${event.id}:${event.text}:${event.name}`).join('|');
  useEffect(() => {
    if (follow && contentRef.current) contentRef.current.scrollTop = contentRef.current.scrollHeight;
  }, [signature, follow, size.width, size.height]);

  const close = () => {
    onClose();
    const node = [...document.querySelectorAll<HTMLElement>('.react-flow__node')].find(node => node.dataset.id === sessionId);
    node?.focus({ preventScroll: true });
  };
  const startDrag = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
    event.preventDefault(); event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, position: placed };
  };
  const moveDrag = (event: PointerEvent<HTMLElement>) => {
    const active = drag.current;
    if (active?.pointerId !== event.pointerId) return;
    setPosition(constrainPosition({ x: active.position.x + event.clientX - active.start.x, y: active.position.y + event.clientY - active.start.y }, bounds, size));
  };
  const applyResize = (frame: WindowFrame) => { setPosition(frame.position); setPreferredSize(frame.size); };
  const startResize = (event: PointerEvent<HTMLElement>, edge: ResizeEdge) => {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation(); onActivate();
    if (edge === 'se') event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    resize.current = { pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, frame: { position: placed, size }, edge };
    setResizing(true);
  };
  const moveResize = (event: PointerEvent<HTMLElement>) => {
    const active = resize.current;
    if (active?.pointerId !== event.pointerId) return;
    applyResize(resizeFrame(active.frame, active.edge, { x: event.clientX - active.start.x, y: event.clientY - active.start.y }, bounds));
  };
  const endResize = () => { resize.current = null; setResizing(false); };
  return <section className={`session-preview-window${resizing ? ' is-resizing' : ''}`} role="dialog" aria-modal="false" aria-labelledby={titleId} data-testid="session-preview" data-preview-session-id={sessionId} style={{ left: placed.x, top: placed.y, width: size.width, height: size.height, zIndex: order + 1 }} onPointerDown={onActivate} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } }}>
    <header className="session-preview-header" data-testid="preview-drag-handle" tabIndex={0} aria-label={t('Przesuń okno podglądu. Użyj przeciągania lub klawiszy strzałek.')} onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }} onKeyDown={event => {
      if (event.target !== event.currentTarget) return;
      const delta = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] }[event.key];
      if (!delta) return;
      event.preventDefault(); event.stopPropagation(); onActivate();
      setPosition(constrainPosition({ x: placed.x + delta[0], y: placed.y + delta[1] }, bounds, size));
    }}>
      <Eye size={16} /><div><h2 id={titleId}>{t('Podgląd sesji')} · {name}</h2><span>{current ? `${RUNTIME_LABELS[current.runtime]} · ${current.externalId}` : sessionId}</span></div><GripHorizontal size={17} className="preview-grip" /><button ref={closeRef} className="icon-button" aria-label={t('Zamknij podgląd sesji {name}', { name })} title={t('Zamknij')} onClick={close}><X size={17} /></button>
    </header>
    <div className="session-preview-toolbar"><span><i className={`status-dot status-${current?.status ?? 'unknown'}`} />{current ? message(STATUS_LABELS[current.status]) : t('Brak stanu')}</span><label><input type="checkbox" checked={follow} onChange={event => setFollow(event.target.checked)} />{t('Śledź nowe zdarzenia')}</label></div>
    <p className="session-preview-note">{t(isDemo ? 'Dane demonstracyjne' : 'Podgląd tylko do odczytu · zdarzenia zapisane w lokalnych logach.')}</p>
    {error && <p className="preview-error" role="status">{t('Nie udało się odczytać podglądu. Widoczne dane mogą być nieaktualne; ponawiam odczyt.')}</p>}
    <div ref={contentRef} className="session-preview-events" data-testid="preview-events" onWheel={event => { if (event.deltaY < 0) setFollow(false); }} onPointerDown={() => setFollow(false)}>
      {preview?.earlierEventsOmitted && <p className="preview-limit">{t('Wyświetlam ostatnie zdarzenia. Starsza część historii została pominięta.')}</p>}
      {!preview && !error && <p className="preview-empty"><Radio size={18} />{t('Odczytuję podgląd sesji…')}</p>}
      {preview?.events.length === 0 && <p className="preview-empty">{t('Brak zapisanych wiadomości lub wywołań narzędzi dla tej sesji.')}</p>}
      {preview?.events.map(event => <article key={event.id} className={`preview-event preview-event-${event.kind}`}><div className="preview-event-heading"><strong>{t(KIND_LABELS[event.kind])}{event.name && event.kind !== 'status' ? ` · ${event.name}` : ''}</strong>{event.timestamp && <time dateTime={event.timestamp}>{new Date(event.timestamp).toLocaleTimeString(language)}</time>}</div>{event.kind === 'status' ? <p>{event.name && event.name in EVENT_LABELS ? t(EVENT_LABELS[event.name as keyof typeof EVENT_LABELS]) : event.name}</p> : <pre>{event.text}</pre>}{event.truncated && <span className="preview-truncated">{t('Treść skrócona')}</span>}</article>)}
    </div>
    <footer className="session-preview-footer"><span>{isDemo ? t('Dane demo') : t('Co 1,5 s')}</span><span>{error ? t('Odczyt niedostępny') : preview ? t('Odczyt {time}', { time: ago(preview.scannedAt, language) }) : '—'}</span></footer>
    {RESIZE_EDGES.map(edge => <div key={edge} className={`preview-resize-handle preview-resize-${edge}`} data-testid={`preview-resize-${edge}`} role={edge === 'se' ? 'button' : undefined} tabIndex={edge === 'se' ? 0 : undefined} aria-hidden={edge !== 'se' ? true : undefined} aria-label={edge === 'se' ? t('Zmień rozmiar okna. Przeciągnij krawędź lub użyj strzałek.') : undefined} title={edge === 'se' ? t('Zmień rozmiar okna') : undefined} onPointerDown={event => startResize(event, edge)} onPointerMove={moveResize} onPointerUp={endResize} onPointerCancel={endResize} onLostPointerCapture={endResize} onKeyDown={event => {
      const delta = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] }[event.key];
      if (!delta || edge !== 'se') return;
      event.preventDefault(); event.stopPropagation(); onActivate();
      applyResize(resizeFrame({ position: placed, size }, 'se', { x: delta[0], y: delta[1] }, bounds));
    }} />)}
  </section>;
}

export function SessionPreviewLayer({ ids, sessions, isDemo, onClose, onActivate }: { ids: string[]; sessions: AgentSession[]; isDemo: boolean; onClose: (id: string) => void; onActivate: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState<Size>({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setBounds({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return <div ref={ref} className="session-preview-layer">{bounds.width > 16 && bounds.height > 16 && [...ids].sort().map(id => <PreviewWindow key={id} sessionId={id} session={sessions.find(session => session.id === id)} bounds={bounds} offset={ids.indexOf(id) % 5} order={ids.indexOf(id)} isDemo={isDemo} onClose={() => onClose(id)} onActivate={() => onActivate(id)} />)}</div>;
}
