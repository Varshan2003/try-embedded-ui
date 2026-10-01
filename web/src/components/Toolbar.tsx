import { BOARDS } from '@try-embedded/simulator';
import logo from '../assets/logo.svg';
import { useStore } from '../store';
import { BuildIcon, PauseIcon, PlayIcon, ResetIcon, StepIcon } from './icons';
import { ThemeToggle } from './ThemeToggle';

const SPEEDS: [number, string][] = [[0.25, 'Quarter speed'], [0.5, 'Half speed'], [1, 'Real time'], [2, 'Double speed'], [4, 'Quadruple speed']];
const STATUS_LABEL = { idle: 'Idle', running: 'Running', paused: 'Paused', error: 'Error' };

function togglePanel(side: 'left' | 'right', selector: string) {
  const el = document.querySelector(selector);
  const hidden = !!el && getComputedStyle(el).display === 'none';
  document.body.classList.toggle(`hide-${side}`, !hidden);
  document.body.classList.toggle(`show-${side}`, hidden);
}

export function Toolbar() {
  const store = useStore();
  const { session, project } = store;
  const running = session.status === 'running';
  const ops = session.lastOps;

  return (
    <header className="toolbar" role="banner">
      <a className="brand" href="#/" title="Back to Try Embedded home"><img src={logo} alt="" /><b>SiliconLab</b><span>arduino simulator</span></a>

      <button className="icon-btn" id="btn-toggle-left" title="Toggle project panel" aria-label="Toggle project panel" onClick={() => togglePanel('left', '.sidebar')}>☰</button>

      <label className="visually-hidden" htmlFor="board-select">Board</label>
      <select id="board-select" title="Target board" value={project.board} onChange={e => store.setBoard(e.target.value)}>
        {Object.values(BOARDS).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>

      <input type="text" id="project-name" aria-label="Sketch name" title="Sketch name" value={project.name} onChange={e => store.rename(e.target.value)} />

      <button className="btn" id="btn-compile" title="Compile (Ctrl+B)" onClick={() => { if (store.compile()) store.toast('Compiled'); }}><BuildIcon /><span>Compile</span></button>
      <button className="btn primary" id="btn-run" title="Run or pause (Ctrl+Enter)" aria-pressed={running} onClick={() => store.toggleRun()}>
        {running ? <PauseIcon /> : <PlayIcon />}<span>{running ? 'Pause' : 'Run'}</span>
      </button>
      <button className="btn" id="btn-step" title="Step one statement while paused" disabled={session.status !== 'paused'} onClick={() => store.step()}><StepIcon /><span>Step</span></button>
      <button className="btn" id="btn-reset" title="Reset simulation (Ctrl+Alt+R)" onClick={() => store.reset()}><ResetIcon /><span>Reset</span></button>

      <div className="group" role="radiogroup" aria-label="Simulation speed">
        <span id="speed-menu">
          {SPEEDS.map(([speed, title]) => (
            <button key={speed} role="radio" aria-checked={store.speed === speed} title={title} onClick={() => store.setSpeed(speed)}>{speed}x</button>
          ))}
        </span>
      </div>

      <div className="group" id="snapshot-group">
        <button className="icon-btn" title="Capture pin and component state" aria-label="Capture state snapshot" onClick={() => store.captureSnapshot()}>◉</button>
        <button className="icon-btn" title="Restore the captured state" aria-label="Restore state snapshot" disabled={!store.snapshot} onClick={() => store.restoreSnapshot()}>↺</button>
      </div>

      <span className="spacer" />
      <span className="clock" title="Simulated time">{(session.micros / 1_000_000).toFixed(2)} s</span>
      <span className="clock" id="sim-ops">{running && ops ? `${Math.round(ops / 1000)}k ops/frame` : ''}</span>
      <span id="status-badge" data-status={session.status} role="status">{STATUS_LABEL[session.status]}</span>
      {store.apiAvailable && (
        <button className="btn small" id="btn-account" title={store.user ? `Signed in as ${store.user.email}` : 'Sign in to save your challenge progress'} onClick={() => store.openDialog('account')}>
          {store.user ? store.user.email.split('@')[0] : 'Sign in'}
        </button>
      )}
      <ThemeToggle />
      <button className="icon-btn" title="Keyboard shortcuts and simulator limits" aria-label="Help" onClick={() => store.openDialog('help')}>?</button>
      <button className="icon-btn" id="btn-toggle-right" title="Toggle inspector" aria-label="Toggle inspector" onClick={() => togglePanel('right', '.inspector')}>◧</button>
    </header>
  );
}
