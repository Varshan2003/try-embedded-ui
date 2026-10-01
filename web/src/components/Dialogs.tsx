import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../store';

function Modal({ open, title, children }: { open: boolean; title: string; children: ReactNode }) {
  const store = useStore();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return (
    // onClose also fires for Escape, which keeps the store in step with the element.
    <dialog ref={ref} onClose={() => { if (open) store.openDialog(null); }}>
      <div className="dialog-head">{title}</div>
      {open && children}
    </dialog>
  );
}

function ImportDialog() {
  const store = useStore();
  const [text, setText] = useState('');
  return (
    <>
      <div className="dialog-body">
        <p className="hint">Paste the JSON produced by Export.</p>
        <textarea aria-label="Project JSON" value={text} onChange={e => setText(e.target.value)} />
      </div>
      <div className="dialog-foot">
        <button className="btn" onClick={() => store.openDialog(null)}>Cancel</button>
        <button className="btn primary" onClick={() => { if (store.importJson(text)) store.openDialog(null); }}>Import</button>
      </div>
    </>
  );
}

function HelpDialog() {
  const store = useStore();
  return (
    <>
      <div className="dialog-body">
        <div className="shortcuts">
          <kbd>Ctrl/Cmd B</kbd><span>Compile</span>
          <kbd>Ctrl/Cmd Enter</kbd><span>Run or pause</span>
          <kbd>Ctrl/Cmd S</kbd><span>Save sketch</span>
          <kbd>Ctrl/Cmd Alt R</kbd><span>Reset simulation</span>
          <kbd>Ctrl/Cmd Z</kbd><span>Undo circuit change</span>
          <kbd>Alt 1–4</kbd><span>Switch bottom panel</span>
          <kbd>Alt B</kbd><span>Collapse bottom panel</span>
          <kbd>R</kbd><span>Rotate selected part</span>
          <kbd>Delete</kbd><span>Delete selected part</span>
          <kbd>Ctrl + wheel</kbd><span>Zoom canvas</span>
        </div>
        <p className="hint">Wiring: click a component terminal, then click a board pin. Drag the canvas background to pan.</p>
        <p className="hint">The interpreter covers the Arduino core: pin, timing, PWM, interrupt, tone and Serial functions, plus the Servo class. Pointer arithmetic, classes, structs, and third-party libraries beyond Servo are not implemented, and I2C/SPI calls are logged to the event timeline rather than simulated at the bus level.</p>
      </div>
      <div className="dialog-foot"><button className="btn primary" onClick={() => store.openDialog(null)}>Close</button></div>
    </>
  );
}

function AccountDialog() {
  const store = useStore();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (store.user) {
    return (
      <>
        <div className="dialog-body"><p className="hint">Signed in as {store.user.email}. Challenge results are saved to this account.</p></div>
        <div className="dialog-foot">
          <button className="btn" onClick={() => store.openDialog(null)}>Close</button>
          <button className="btn danger" onClick={() => store.signOut()}>Sign out</button>
        </div>
      </>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(await store.authenticate(mode, email, password));
    setBusy(false);
  };

  return (
    <form onSubmit={submit}>
      <div className="dialog-body account-form">
        <label>Email<input type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} /></label>
        <label>Password<input type="password" required minLength={8} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={e => setPassword(e.target.value)} /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button type="button" className="link-btn" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null); }}>
          {mode === 'login' ? 'New here? Create an account' : 'Already have an account? Sign in'}
        </button>
      </div>
      <div className="dialog-foot">
        <button type="button" className="btn" onClick={() => store.openDialog(null)}>Cancel</button>
        <button type="submit" className="btn primary" disabled={busy}>{mode === 'login' ? 'Sign in' : 'Create account'}</button>
      </div>
    </form>
  );
}

export function Dialogs() {
  const { dialog, user } = useStore();
  return (
    <>
      <Modal open={dialog === 'import'} title="Import project JSON"><ImportDialog /></Modal>
      <Modal open={dialog === 'help'} title="Shortcuts and simulator scope"><HelpDialog /></Modal>
      <Modal open={dialog === 'account'} title={user ? 'Account' : 'Sign in to Try Embedded'}><AccountDialog /></Modal>
    </>
  );
}
