import { Component, useEffect, useRef, type ReactNode } from 'react';
import { componentOutput } from '@try-embedded/simulator';
import { BottomPanel, toggleBottom } from './components/BottomPanel';
import { Canvas } from './components/Canvas';
import { Dialogs } from './components/Dialogs';
import { Editor } from './components/Editor';
import { Inspector } from './components/Inspector';
import { Sidebar } from './components/Sidebar';
import { Toolbar } from './components/Toolbar';
import { store, useStore, type BottomTab } from './store';

const TAB_KEYS: BottomTab[] = ['serial', 'compiler', 'pins', 'events'];

function isEditing(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.isContentEditable);
}

function onKeyDown(e: KeyboardEvent) {
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (e.key === 'Escape' && store.pendingWire) store.cancelWire();
  if (mod && e.altKey && key === 'r') { e.preventDefault(); store.reset(); return; }
  if (mod && key === 'b') { e.preventDefault(); if (store.compile()) store.toast('Compiled'); }
  if (mod && e.key === 'Enter') { e.preventDefault(); store.toggleRun(); }
  if (mod && key === 's') { e.preventDefault(); store.save(); }
  if (mod && key === 'z' && !e.shiftKey && !isEditing(e)) { e.preventDefault(); store.undo(); }
  if (mod && (key === 'y' || (e.shiftKey && key === 'z')) && !isEditing(e)) { e.preventDefault(); store.redo(); }
  // e.code, because Alt changes the character e.key reports on macOS.
  const digit = /^Digit([1-4])$/.exec(e.code);
  if (e.altKey && !mod && digit) { e.preventDefault(); store.setBottomTab(TAB_KEYS[+digit[1] - 1]); }
  if (e.altKey && !mod && e.code === 'KeyB') { e.preventDefault(); toggleBottom(); }
  if (e.key === 'Delete' && !isEditing(e)) store.deleteSelection();
  if (e.key === 'r' && !isEditing(e) && !mod && !e.altKey && store.selection.size) store.rotateSelection();
}

// Plays whatever tone a wired buzzer is currently being driven with.
function useBuzzer() {
  const { project, session } = useStore();
  const audio = useRef<{ ctx: AudioContext; osc: OscillatorNode | null } | null>(null);
  let freq = 0;
  if (session.status === 'running') {
    for (const c of project.components) {
      if (c.type === 'buzzer') freq = componentOutput(project, session.board, c).freq || freq;
    }
  }
  useEffect(() => {
    const stop = () => {
      const a = audio.current;
      if (!a?.osc) return;
      try { a.osc.stop(); a.osc.disconnect(); } catch { /* already stopped */ }
      a.osc = null;
    };
    if (!freq) { stop(); return; }
    try {
      audio.current ??= { ctx: new AudioContext(), osc: null };
      const a = audio.current;
      if (!a.osc) {
        a.osc = a.ctx.createOscillator();
        const gain = a.ctx.createGain();
        gain.gain.value = 0.04;
        a.osc.connect(gain).connect(a.ctx.destination);
        a.osc.start();
      }
      a.osc.frequency.value = freq;
    } catch { /* audio is optional */ }
  }, [freq]);
}

function Toasts() {
  const { toasts } = useStore();
  return (
    <div id="toasts" aria-live="polite">
      {toasts.map(t => <div key={t.id} role="status" className={`toast toast-${t.kind}${t.leaving ? ' leaving' : ''}`}>{t.message}</div>)}
    </div>
  );
}

export class CrashBoundary extends Component<{ children: ReactNode }, { message: string | null }> {
  state = { message: null as string | null };
  static getDerivedStateFromError(error: Error) { return { message: error.message }; }
  render() {
    if (this.state.message === null) return this.props.children;
    return (
      <div id="crash" role="alert">
        <strong>Something broke in the interface.</strong>
        <p className="crash-msg">{this.state.message}</p>
        <p>Your sketches are saved. Reload the page to continue.</p>
      </div>
    );
  }
}

export function App() {
  useBuzzer();
  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <>
      <Toolbar />
      <main>
        <Sidebar />
        <section className="workspace">
          <div className="split">
            <Editor />
            <Canvas />
          </div>
          <BottomPanel />
        </section>
        <Inspector />
      </main>
      <Toasts />
      <Dialogs />
    </>
  );
}
