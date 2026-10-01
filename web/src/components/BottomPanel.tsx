import { useLayoutEffect, useRef, useState } from 'react';
import { COMPONENTS } from '@try-embedded/simulator';
import { useStore, type BottomTab } from '../store';

const TABS: [BottomTab, string][] = [['serial', 'Serial Monitor'], ['compiler', 'Compiler Output'], ['pins', 'Pin States'], ['events', 'Event Timeline']];

function SerialPanel() {
  const store = useStore();
  const body = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [input, setInput] = useState('');
  const lines = store.session.serial.slice(-400);
  const last = lines[lines.length - 1];

  useLayoutEffect(() => {
    const el = body.current?.parentElement;
    if (el && stick.current && store.serialAutoscroll) el.scrollTop = el.scrollHeight;
  }, [lines.length, last?.text, store.serialAutoscroll]);

  return (
    <div
      className="tab-panel" id="panel-serial" role="tabpanel"
      onScroll={e => { const el = e.currentTarget; stick.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 40; }}
    >
      <div id="serial-body" ref={body} aria-live="polite">
        {!lines.length && <p className="empty">No serial traffic yet. Call Serial.begin() in setup(), then run the sketch.</p>}
        {lines.map((l, i) => (
          <div key={i} className={'serial-line' + (l.kind === 'meta' ? ' meta' : '')}>
            {l.t !== undefined && store.serialTimestamps && <span className="ts">{(l.t / 1000).toFixed(0).padStart(6, ' ')} ms</span>}
            {l.text}
          </div>
        ))}
      </div>
      <form className="serial-send" onSubmit={e => { e.preventDefault(); store.sendSerial(input); setInput(''); }}>
        <input type="text" placeholder="send to Serial.read()" aria-label="Serial input" value={input} onChange={e => setInput(e.target.value)} />
        <button className="btn small" type="submit">Send</button>
      </form>
    </div>
  );
}

function CompilerPanel() {
  const store = useStore();
  const { diagnostics } = store.session;
  return (
    <div className="tab-panel" id="panel-compiler" role="tabpanel">
      {!diagnostics.length && <p className="empty">Nothing to report. Compile a sketch to see storage use, warnings and errors.</p>}
      {diagnostics.map((d, i) => (
        <div key={i} className={`diag diag-${d.severity}`}>
          <span className="diag-sev">{d.severity}</span>
          <span className="diag-msg">{d.message}</span>
          {d.line ? <button className="diag-line" onClick={() => store.jumpToLine(d.line!)}>line {d.line}</button> : null}
        </div>
      ))}
    </div>
  );
}

function PinsPanel() {
  const { project, session } = useStore();
  const { board, io } = session;
  const wiredTo = (pinId: number) => project.wires.filter(w => w.pin === pinId).map(w => {
    const c = project.components.find(x => x.id === w.comp);
    return c ? `${COMPONENTS[c.type].label} ${w.term}` : '?';
  }).join(', ') || '—';
  return (
    <div className="tab-panel" id="panel-pins" role="tabpanel">
      <table className="pin-table">
        <thead><tr><th>Pin</th><th>Mode</th><th>Digital</th><th>PWM</th><th>Volts</th><th>Analog</th><th>Wired to</th></tr></thead>
        <tbody>
          {board.pins.filter(p => p.kind !== 'power' && p.kind !== 'ground').map(p => (
            <tr key={p.id}>
              <td>{p.name}</td>
              <td className="m">{p.mode}</td>
              <td className="d">{(p.mode === 'OUTPUT' ? p.value : io.readInput(p)) ? 'HIGH' : 'LOW'}</td>
              <td className="w">{p.pwm ?? '—'}</td>
              <td className="v">{board.level(p).toFixed(2)}</td>
              <td className="a">{p.kind === 'analog' ? io.readAnalog(p) : '—'}</td>
              <td className="c">{wiredTo(p.id)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EventsPanel() {
  const rows = useStore().session.events.slice(-300).reverse();
  return (
    <div className="tab-panel" id="panel-events" role="tabpanel">
      <div id="events-body">
        {!rows.length && <p className="empty">Pin changes, interrupts and bus traffic appear here once the simulation runs.</p>}
        {rows.map((e, i) => (
          <div key={rows.length - i} className="event-row">
            <span className="ts">{(e.t / 1000).toFixed(1)} ms</span><span className="ev-src">{e.source}</span><span className="ev-detail">{e.detail}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function toggleBottom() { document.body.classList.toggle('hide-bottom'); }

export function BottomPanel() {
  const store = useStore();
  const tab = store.bottomTab;
  const { diagnostics } = store.session;
  const errors = diagnostics.filter(d => d.severity === 'error').length;
  const warnings = diagnostics.filter(d => d.severity === 'warning').length;

  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    const next = TABS[(i + step + TABS.length) % TABS.length][0];
    store.setBottomTab(next);
    document.querySelector<HTMLElement>(`.tab[data-tab="${next}"]`)?.focus();
  };

  return (
    <div className="bottom">
      <div className="tabbar" role="tablist" aria-label="Simulation panels">
        {TABS.map(([id, label], i) => (
          <button
            key={id} className="tab" role="tab" data-tab={id} aria-selected={tab === id} aria-controls={`panel-${id}`}
            tabIndex={tab === id ? 0 : -1} title={`${label} (Alt+${i + 1})`}
            onClick={() => store.setBottomTab(id)} onKeyDown={e => onKeyDown(e, i)}
          >{label}</button>
        ))}
        <span className="tab-tools">
          <span>{errors || warnings ? `${errors} errors, ${warnings} warnings` : ''}</span>
          <label><input type="checkbox" checked={store.serialAutoscroll} onChange={e => store.setSerialOption('serialAutoscroll', e.target.checked)} /> autoscroll</label>
          <label><input type="checkbox" checked={store.serialTimestamps} onChange={e => store.setSerialOption('serialTimestamps', e.target.checked)} /> timestamps</label>
          <button className="icon-btn small" title="Clear serial output" aria-label="Clear serial output" onClick={() => store.clearSerial()}>⌫</button>
          <button className="icon-btn small" title="Clear event timeline" aria-label="Clear event timeline" onClick={() => store.clearEvents()}>✕</button>
          <button className="icon-btn small" title="Collapse panel (Alt+B)" aria-label="Collapse bottom panel" onClick={toggleBottom}>▾</button>
        </span>
      </div>
      {tab === 'serial' && <SerialPanel />}
      {tab === 'compiler' && <CompilerPanel />}
      {tab === 'pins' && <PinsPanel />}
      {tab === 'events' && <EventsPanel />}
    </div>
  );
}
