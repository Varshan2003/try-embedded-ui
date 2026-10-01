import { useEffect, useLayoutEffect, useRef } from 'react';
import { COMPONENTS, componentOutput, wireOf, type CircuitComponent } from '@try-embedded/simulator';
import { store, useStore } from '../store';

const LED_RGB: Record<string, string> = { red: '255,86,86', green: '86,230,140', amber: '255,184,74', cyan: '86,220,255' };
const SEGMENTS: [string, string][] = [
  ['a', 'M18 8h34l-6 7H24z'], ['b', 'M54 12l-4 7v28l-5-6V19z'], ['c', 'M54 58l-4 7v28l-5-6V65z'], ['d', 'M18 98h34l-6-7H24z'],
  ['e', 'M16 58l4 7v28l5-6V65z'], ['f', 'M16 12l4 7v28l5-6V19z'], ['g', 'M20 53h30l-5 6H25z'],
];

function Visual({ c }: { c: CircuitComponent }) {
  const { project, session } = store;
  const out = componentOutput(project, session.board, c);
  switch (c.type) {
    case 'led': {
      const level = out.level ?? 0;
      const rgb = LED_RGB[c.state.color || 'red'] ?? LED_RGB.red;
      const lit = level > 0.02;
      return (
        <svg viewBox="0 0 60 50" width="72" height="60" aria-hidden="true">
          <ellipse cx="30" cy="22" rx="15" ry="17" stroke="#2a3138" strokeWidth="1.5"
            fill={lit ? `rgba(${rgb},${0.25 + level * 0.75})` : 'var(--led-off)'}
            style={{ filter: lit ? `drop-shadow(0 0 ${6 + level * 14}px rgba(${rgb},${level}))` : 'none' }} />
          <path d="M15 30h30v6H15z" fill="#171c21" />
          <path d="M22 36v12M38 36v12" stroke="#7b848c" strokeWidth="2" />
        </svg>
      );
    }
    case 'button':
      return (
        <svg viewBox="0 0 60 44" width="70" height="52" aria-hidden="true">
          <rect x="8" y="10" width="44" height="24" rx="4" fill="#1b2127" stroke="#333c44" />
          <circle cx="30" cy="22" r="9" fill={c.state.pressed ? 'var(--cyan)' : '#39434c'} />
        </svg>
      );
    case 'pot':
      return (
        <svg viewBox="0 0 60 50" width="72" height="58" aria-hidden="true">
          <circle cx="30" cy="24" r="17" fill="#1b2127" stroke="#333c44" />
          <line x1="30" y1="24" x2="30" y2="10" stroke="var(--cyan)" strokeWidth="3" strokeLinecap="round"
            transform={`rotate(${-135 + ((c.state.value ?? 0) / 1023) * 270} 30 24)`} />
        </svg>
      );
    case 'servo':
      return (
        <svg viewBox="0 0 80 54" width="92" height="60" aria-hidden="true">
          <rect x="6" y="14" width="40" height="30" rx="3" fill="#1b2127" stroke="#333c44" />
          <circle cx="54" cy="29" r="9" fill="#232a31" stroke="#333c44" />
          <line x1="54" y1="29" x2="74" y2="29" stroke="var(--amber)" strokeWidth="3" strokeLinecap="round"
            transform={`rotate(${(out.angle ?? 0) - 90} 54 29)`} />
        </svg>
      );
    case 'buzzer':
      return (
        <svg viewBox="0 0 60 50" width="70" height="56" aria-hidden="true">
          <circle cx="30" cy="24" r="17" fill="#15191e" stroke="#333c44" />
          <circle cx="30" cy="24" r="5" fill={out.freq ? 'var(--amber)' : '#39434c'} />
        </svg>
      );
    case 'tmp36':
      return (
        <svg viewBox="0 0 60 52" width="70" height="58" aria-hidden="true">
          <path d="M14 26a16 16 0 0 1 32 0v14H14z" fill="#1b2127" stroke="#333c44" />
          <text x="30" y="34" textAnchor="middle" fontSize="12" fill="var(--cyan)" fontFamily="ui-monospace,monospace">{Math.round(c.state.tempC ?? 0)}C</text>
        </svg>
      );
    case 'sevenseg':
      return (
        <svg viewBox="0 0 70 110" width="86" height="120" aria-hidden="true">
          {SEGMENTS.map(([id, d]) => <path key={id} d={d} fill={out.segments?.[id] ? 'var(--red)' : 'var(--seg-off)'} />)}
        </svg>
      );
  }
}

const INTERACTIVE = '.term, input, .press-btn, .pin';

function ComponentNode({ c, onDragStart }: { c: CircuitComponent; onDragStart: (e: React.MouseEvent, c: CircuitComponent) => void }) {
  const { project, session } = store;
  const def = COMPONENTS[c.type];

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { store.select(c.id, false); store.deleteSelection(); return; }
    if (e.key === 'r') { e.stopPropagation(); store.select(c.id, false); store.rotateSelection(); return; }
    const nudge = ({ ArrowUp: [0, -10], ArrowDown: [0, 10], ArrowLeft: [-10, 0], ArrowRight: [10, 0] } as Record<string, number[]>)[e.key];
    if (nudge) {
      e.preventDefault();
      c.x += nudge[0];
      c.y += nudge[1];
      store.touchCircuit();
    }
  };

  const release = () => store.setButton(c, 0);

  return (
    <div
      className={'node comp-node' + (store.selection.has(c.id) ? ' selected' : '')}
      style={{ left: c.x, top: c.y }} tabIndex={0} role="group" aria-label={def.label}
      onMouseDown={e => onDragStart(e, c)} onKeyDown={onKeyDown}
    >
      <div className="node-head drag-handle"><span className="node-title">{def.label}</span></div>
      <div className="comp-visual" style={{ transform: `rotate(${c.rot}deg)` }}><Visual c={c} /></div>

      {c.type === 'button' && (
        <button
          className="press-btn" style={{ touchAction: 'none' }}
          onPointerDown={() => store.setButton(c, 1)} onPointerUp={release}
          onPointerLeave={() => { if (!c.state.latching) release(); }}
          onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); store.setButton(c, 1); } }}
          onKeyUp={e => { if (e.key === ' ' || e.key === 'Enter') release(); }}
        >Press</button>
      )}
      {c.type === 'pot' && (
        <div className="slider-wrap">
          <input type="range" min={0} max={1023} value={c.state.value ?? 0} aria-label="Potentiometer position"
            onChange={e => { c.state.value = +e.target.value; store.touchCircuit(); }} />
        </div>
      )}
      {c.type === 'tmp36' && (
        <div className="slider-wrap">
          <input type="range" min={-20} max={60} value={c.state.tempC ?? 0} aria-label="Temperature in Celsius"
            onChange={e => { c.state.tempC = +e.target.value; store.touchCircuit(); }} />
        </div>
      )}

      <div className="terminals">
        {def.terminals.map(t => {
          const wired = wireOf(project, c.id, t.id);
          const pinName = wired !== null ? session.board.pin(wired)?.name : undefined;
          return (
            <button
              key={t.id} className="term"
              title={pinName ? `${t.label || t.id} → ${pinName} (click to rewire)` : `${t.label || t.id}: click, then click a board pin`}
              aria-label={`${def.label} terminal ${t.id}${pinName ? `, connected to ${pinName}` : ', not connected'}`}
              onClick={() => store.clickTerminal(c, t.id)}
            >
              <span className="term-dot" data-termdot={`${c.id}:${t.id}`} />{t.id}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function BoardNode() {
  const { board } = store.session;
  const spec = board.spec;
  const pinButton = (p: (typeof board.pins)[number]) => (
    <button
      key={p.id} className="pin" data-kind={p.kind} aria-label={`Pin ${p.name}`}
      title={`${p.name}${board.isPwm(p.id) ? ' (PWM)' : ''}${spec.interrupts.includes(p.id) ? ' (interrupt)' : ''}`}
      onClick={() => store.clickPin(p)}
    >
      <span className="pin-dot" data-pindot={p.id} /><span className="pin-label">{p.name}</span><span className="pin-live" />
    </button>
  );
  return (
    <div className="node board-node" style={{ left: 40, top: 60 }}>
      <div className="node-head">
        <span className="node-title">{spec.name}</span>
        <span className="node-tag">{spec.digital} digital · {spec.analog} analog</span>
      </div>
      <div className="board-body">
        <div className="pin-col">{board.pins.filter(p => p.kind === 'digital').map(pinButton)}</div>
        <div className="pin-col">{board.pins.filter(p => p.kind !== 'digital').map(pinButton)}</div>
      </div>
    </div>
  );
}

// Wire endpoints are wherever the browser laid out the terminal and pin dots, so the
// paths are measured from the DOM after each render rather than computed from state.
function drawWires(svg: SVGSVGElement, content: HTMLElement) {
  const { project, session, view, pendingWire } = store;
  const box = content.getBoundingClientRect();
  const center = (el: Element) => {
    const r = el.getBoundingClientRect();
    return [(r.left + r.width / 2 - box.left) / view.z, (r.top + r.height / 2 - box.top) / view.z];
  };
  let out = '';
  for (const w of project.wires) {
    const from = content.querySelector(`[data-termdot="${w.comp}:${w.term}"]`);
    const to = content.querySelector(`[data-pindot="${w.pin}"]`);
    if (!from || !to) continue;
    const [x1, y1] = center(from);
    const [x2, y2] = center(to);
    const pin = session.board.pin(w.pin);
    const v = pin ? session.board.level(pin) : 0;
    const cls = pin?.kind === 'ground' ? 'gnd' : pin?.kind === 'power' ? 'pwr' : v > 2.5 ? 'hot' : v > 0.2 ? 'mid' : 'cold';
    const mx = (x1 + x2) / 2;
    out += `<path class="wire ${cls}" d="M${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}"/>`;
  }
  if (pendingWire) {
    const from = content.querySelector(`[data-termdot="${pendingWire.comp}:${pendingWire.term}"]`);
    if (from) {
      const [x, y] = center(from);
      out += `<circle class="wire-pending" cx="${x}" cy="${y}" r="7"/>`;
    }
  }
  if (svg.innerHTML !== out) svg.innerHTML = out;
}

interface Drag {
  startX: number;
  startY: number;
  moved: boolean;
  items: { comp: CircuitComponent; ox: number; oy: number }[];
}

export function Canvas() {
  const store = useStore();
  const { project, view } = store;
  const canvas = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const wires = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const pan = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);

  useLayoutEffect(() => { store.fitView(); }, [store, store.fitRequest]);
  useLayoutEffect(() => {
    if (wires.current && content.current) drawWires(wires.current, content.current);
  });

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = drag.current;
      if (d) {
        const dx = (e.clientX - d.startX) / store.view.z;
        const dy = (e.clientY - d.startY) / store.view.z;
        if (!d.moved) {
          if (Math.abs(dx) + Math.abs(dy) < 3) return;
          d.moved = true;
          store.pushUndo();
        }
        for (const it of d.items) {
          it.comp.x = Math.round((it.ox + dx) / 10) * 10;
          it.comp.y = Math.round((it.oy + dy) / 10) * 10;
        }
        store.emit();
      }
      const p = pan.current;
      if (p) {
        if (Math.abs(e.clientX - p.sx) + Math.abs(e.clientY - p.sy) > 6) store.userMovedView = true;
        store.setView(p.ox + (e.clientX - p.sx), p.oy + (e.clientY - p.sy));
      }
    };
    const onUp = () => {
      if (drag.current?.moved) store.scheduleAutosave();
      drag.current = null;
      pan.current = null;
    };
    // React registers wheel listeners as passive, which cannot cancel the browser's own zoom.
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      store.zoomBy(e.deltaY < 0 ? 1.08 : 1 / 1.08);
    };
    let resizeTimer: ReturnType<typeof setTimeout>;
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { if (!store.userMovedView) store.fitView(); else store.emit(); }, 140);
    };
    const el = canvas.current;
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('resize', onResize);
    el?.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('resize', onResize);
      el?.removeEventListener('wheel', onWheel);
      clearTimeout(resizeTimer);
    };
  }, [store]);

  const startDrag = (e: React.MouseEvent, c: CircuitComponent) => {
    if ((e.target as Element).closest(INTERACTIVE)) return;
    if (e.shiftKey) store.select(c.id, true);
    else if (!store.selection.has(c.id)) store.select(c.id, false);
    if (!store.selection.has(c.id)) return;
    drag.current = {
      startX: e.clientX, startY: e.clientY, moved: false,
      items: project.components.filter(x => store.selection.has(x.id)).map(comp => ({ comp, ox: comp.x, oy: comp.y })),
    };
  };

  const startPan = (e: React.MouseEvent) => {
    if ((e.target as Element).closest('.node')) return;
    store.clearSelection();
    pan.current = { sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y };
  };

  return (
    <div className="pane">
      <div className="pane-head">
        <span>circuit</span>
        <span className="spacer" />
        <button className="icon-btn small" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!store.undoStack.length} onClick={() => store.undo()}>↶</button>
        <button className="icon-btn small" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" disabled={!store.redoStack.length} onClick={() => store.redo()}>↷</button>
        <button className="icon-btn small" title="Zoom out" aria-label="Zoom out" onClick={() => store.zoomBy(1 / 1.2)}>−</button>
        <span className="zoom-value">{Math.round(view.z * 100)}%</span>
        <button className="icon-btn small" title="Zoom in" aria-label="Zoom in" onClick={() => store.zoomBy(1.2)}>+</button>
        <button className="icon-btn small" title="Reset view" aria-label="Reset view" onClick={() => store.fitView()}>⤢</button>
      </div>
      <div id="canvas" ref={canvas} onMouseDown={startPan}>
        <div id="canvas-content" ref={content} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}>
          <svg id="wires" ref={wires} aria-hidden="true" />
          <div id="nodes">
            <BoardNode />
            {project.components.map(c => <ComponentNode key={c.id} c={c} onDragStart={startDrag} />)}
          </div>
        </div>
        {store.hint && <p id="canvas-hint" role="status" style={{ display: 'block' }}>{store.hint}</p>}
      </div>
    </div>
  );
}
