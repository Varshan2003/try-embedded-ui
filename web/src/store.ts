import { useSyncExternalStore } from 'react';
import {
  COMPONENTS, Session, boardSpec,
  type CircuitComponent, type ComponentType, type Pin, type Project, type Snapshot,
} from '@try-embedded/simulator';
import { api, ApiError, type Challenge, type ChallengeSummary, type ProgressItem, type SubmissionResult, type User } from './api';
import { STARTERS, type StarterTemplate } from './starters';

export type BottomTab = 'serial' | 'compiler' | 'pins' | 'events';
export type DialogId = 'import' | 'help' | 'account' | null;
export type ToastKind = 'info' | 'warn' | 'error';
export interface Toast { id: number; message: string; kind: ToastKind; leaving: boolean }

const uid = () => Math.random().toString(36).slice(2, 9);
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const clamp = (v: number, a: number, b: number) => Math.min(Math.max(v, a), b);

const storage = {
  read<T>(key: string, fallback: T): T {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  },
  write(key: string, value: unknown): boolean {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch { return false; }
  },
  remove(key: string) { try { localStorage.removeItem(key); } catch { /* storage unavailable */ } },
};

function buildStarter(tpl: StarterTemplate): Project {
  const components: CircuitComponent[] = tpl.components.map((c, i) => ({
    id: 'c' + i + uid().slice(0, 3),
    type: c.type, x: c.x, y: c.y, rot: 0,
    state: { ...COMPONENTS[c.type].defaults, ...c.state },
  }));
  const wires = tpl.wires.map(([from, pinName]) => {
    const [ci, term] = from.split(':');
    return { id: uid(), comp: components[+ci].id, term, pinName };
  });
  // Pin names are resolved to ids when the project is loaded into a Session.
  return { id: uid(), name: tpl.name, board: tpl.board || 'uno', code: tpl.code, components, wires: wires as unknown as Project['wires'], createdAt: Date.now(), updatedAt: Date.now() };
}

function projectFromData(data: Partial<Project>, fallbackName: string): Project {
  return {
    id: uid(), name: data.name || fallbackName, board: data.board || 'uno', code: data.code || '',
    components: data.components || [], wires: data.wires || [], createdAt: Date.now(), updatedAt: Date.now(),
  };
}

class Store {
  private listeners = new Set<() => void>();
  private version = 0;

  projects: Project[] = [];
  project!: Project;
  session!: Session;

  speed = 1;
  selection = new Set<string>();
  pendingWire: { comp: string; term: string } | null = null;
  view = { x: 40, y: 30, z: 1 };
  userMovedView = false;
  fitRequest = 0;
  hint = '';
  undoStack: string[] = [];
  redoStack: string[] = [];
  snapshot: Snapshot | null = null;

  bottomTab: BottomTab = 'serial';
  serialAutoscroll = true;
  serialTimestamps = false;
  dialog: DialogId = null;
  toasts: Toast[] = [];
  savedLabel = 'autosave on';
  focusLine: { line: number; tick: number } | null = null;

  token: string | null = null;
  user: User | null = null;
  apiAvailable: boolean | null = null;
  challenges: ChallengeSummary[] = [];
  challengeDetails = new Map<string, Challenge>();
  progress = new Map<string, ProgressItem>();
  submission: { challengeId: string; result: SubmissionResult } | null = null;
  submitting = false;

  private raf: number | null = null;
  private firstFrame = true;
  private lastFrame = 0;
  private autosaveTimer: ReturnType<typeof setTimeout> | undefined;
  private toastId = 0;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  getVersion = () => this.version;
  emit = () => {
    this.version++;
    for (const listener of this.listeners) listener();
  };

  // ---- boot and persistence -------------------------------------------------

  boot() {
    const saved = storage.read<Project[]>('siliconlab:projects', []);
    this.projects = Array.isArray(saved) && saved.length ? saved : [buildStarter(STARTERS[0])];
    let target = this.loadFromHash();
    if (target) {
      this.projects.push(target);
      history.replaceState(null, '', location.pathname);
    } else {
      const lastId = storage.read<string | null>('siliconlab:last', null);
      target = this.projects.find(p => p.id === lastId) || this.projects[0];
    }
    this.saveProjects();
    this.load(clone(target), { silent: true });
    this.compile();
    this.bottomTab = 'serial';
    window.addEventListener('beforeunload', () => this.persist());
    void this.connect();
  }

  private saveProjects() { return storage.write('siliconlab:projects', this.projects); }

  persist() {
    if (!this.project) return false;
    this.project.updatedAt = Date.now();
    const idx = this.projects.findIndex(p => p.id === this.project.id);
    if (idx >= 0) this.projects[idx] = this.project; else this.projects.push(this.project);
    const ok = this.saveProjects();
    storage.write('siliconlab:last', this.project.id);
    return ok;
  }

  scheduleAutosave() {
    clearTimeout(this.autosaveTimer);
    this.autosaveTimer = setTimeout(() => {
      this.persist();
      this.savedLabel = 'saved ' + new Date().toLocaleTimeString();
      this.emit();
    }, 700);
  }

  save() {
    const ok = this.persist();
    this.toast(ok ? 'Sketch saved' : 'Local storage is unavailable, so this sketch stays in memory only', ok ? 'info' : 'warn');
  }

  load(project: Project, opts: { silent?: boolean } = {}) {
    this.stopLoop();
    this.project = project;
    this.session = new Session(project);
    this.selection.clear();
    this.pendingWire = null;
    this.hint = '';
    this.undoStack = [];
    this.redoStack = [];
    this.snapshot = null;
    this.fitRequest++;
    if (project.challengeId) void this.ensureChallenge(project.challengeId);
    if (!opts.silent) this.toast(`Opened ${displayName(project)}`);
    this.emit();
  }

  open(project: Project) {
    this.persist();
    this.load(clone(project));
  }

  private add(project: Project) {
    this.persist();
    this.projects.push(project);
    this.saveProjects();
    this.load(project);
  }

  newSketch() {
    const p = buildStarter(STARTERS[0]);
    p.name = 'Untitled sketch';
    this.add(p);
  }

  openTemplate(tpl: StarterTemplate) { this.add(buildStarter(tpl)); }

  duplicate(p: Project) {
    const copy = clone(p);
    copy.id = uid();
    copy.name = displayName(p) + ' copy';
    copy.updatedAt = Date.now();
    const idMap = new Map<string, string>();
    copy.components.forEach(c => { const n = uid(); idMap.set(c.id, n); c.id = n; });
    copy.wires.forEach(w => { w.comp = idMap.get(w.comp) || w.comp; w.id = uid(); });
    this.projects.push(copy);
    this.saveProjects();
    this.load(copy, { silent: true });
    this.toast('Duplicated sketch');
  }

  remove(p: Project) {
    this.projects = this.projects.filter(x => x.id !== p.id);
    if (this.project.id === p.id) {
      if (!this.projects.length) this.projects.push(buildStarter(STARTERS[0]));
      this.load(clone(this.projects[0]), { silent: true });
    }
    this.saveProjects();
    this.toast(`Deleted ${displayName(p)}`);
  }

  rename(name: string) {
    this.project.name = name;
    this.scheduleAutosave();
    this.emit();
  }

  // ---- editor and simulation --------------------------------------------------

  setCode(code: string) {
    this.project.code = code;
    this.session.invalidate();
    this.session.errorLine = null;
    this.scheduleAutosave();
    this.emit();
  }

  compile() {
    const ok = this.session.compile();
    this.stopLoop();
    if (this.session.diagnostics.some(d => d.severity !== 'info')) this.bottomTab = 'compiler';
    this.emit();
    return ok;
  }

  toggleRun() {
    const s = this.session;
    if (s.status === 'running') {
      s.pause();
      this.stopLoop();
    } else if (s.status === 'paused') {
      s.resume();
      this.startLoop();
    } else {
      // A previous compile or runtime error is cleared by compiling again.
      if ((!s.program || s.status === 'error') && !this.compile()) return;
      if (s.start()) this.startLoop();
    }
    this.emit();
  }

  step() {
    this.session.step();
    if (this.session.status === 'error') this.bottomTab = 'compiler';
    this.emit();
  }

  reset() {
    this.stopLoop();
    this.session.reset();
    this.toast('Simulation reset');
  }

  setSpeed(speed: number) { this.speed = speed; this.emit(); }

  private startLoop() {
    this.firstFrame = true;
    if (this.raf === null) this.raf = requestAnimationFrame(this.frame);
  }

  private stopLoop() {
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  private frame = (ts: number) => {
    this.raf = null;
    const s = this.session;
    if (s.status !== 'running') return;
    const dt = this.firstFrame ? 16 : Math.min(48, ts - this.lastFrame);
    this.firstFrame = false;
    this.lastFrame = ts;
    s.advance(dt * 1000 * this.speed);
    // advance() may have changed the status the check above narrowed, so read it afresh.
    const status = this.session.status;
    if (status === 'error') this.bottomTab = 'compiler';
    if (status === 'running') this.raf = requestAnimationFrame(this.frame);
    this.emit();
  };

  setBoard(boardId: string) {
    this.stopLoop();
    this.session.setBoard(boardId);
    this.session.reset();
    this.fitRequest++;
    this.scheduleAutosave();
    this.toast(`Switched to ${boardSpec(boardId).name}`);
  }

  sendSerial(text: string) {
    if (!text) return;
    this.session.serialSend(text);
    this.emit();
  }

  clearSerial() { this.session.serial = []; this.emit(); }
  clearEvents() { this.session.events = []; this.emit(); }

  captureSnapshot() {
    this.snapshot = this.session.snapshot();
    this.session.logEvent('sim', 'snapshot captured');
    this.toast('Snapshot captured');
  }

  restoreSnapshot() {
    if (!this.snapshot) return;
    this.session.restore(this.snapshot);
    this.toast('Snapshot restored');
  }

  // ---- circuit editing --------------------------------------------------------

  private circuitJson() {
    return JSON.stringify({ components: this.project.components, wires: this.project.wires });
  }

  pushUndo() {
    this.undoStack.push(this.circuitJson());
    if (this.undoStack.length > 60) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  private swapCircuit(from: string[], to: string[]) {
    const json = from.pop();
    if (!json) return;
    to.push(this.circuitJson());
    const snap = JSON.parse(json);
    this.project.components = snap.components;
    this.project.wires = snap.wires;
    this.scheduleAutosave();
    this.emit();
  }

  undo() { this.swapCircuit(this.undoStack, this.redoStack); }
  redo() { this.swapCircuit(this.redoStack, this.undoStack); }

  addComponent(type: ComponentType) {
    this.pushUndo();
    const c: CircuitComponent = {
      id: uid(), type,
      x: Math.round((330 + Math.random() * 40) / 10) * 10,
      y: Math.round((90 + this.project.components.length * 40) / 10) * 10,
      rot: 0,
      state: { ...COMPONENTS[type].defaults },
    };
    this.project.components.push(c);
    this.selection = new Set([c.id]);
    this.scheduleAutosave();
    this.toast(`Added ${COMPONENTS[type].label}`);
  }

  deleteSelection() {
    if (!this.selection.size) return;
    this.pushUndo();
    this.project.components = this.project.components.filter(c => !this.selection.has(c.id));
    this.project.wires = this.project.wires.filter(w => !this.selection.has(w.comp));
    this.selection.clear();
    this.scheduleAutosave();
    this.emit();
  }

  rotateSelection() {
    if (!this.selection.size) return;
    this.pushUndo();
    this.project.components.forEach(c => { if (this.selection.has(c.id)) c.rot = (c.rot + 90) % 360; });
    this.scheduleAutosave();
    this.emit();
  }

  select(id: string, additive: boolean) {
    if (additive) {
      if (this.selection.has(id)) this.selection.delete(id); else this.selection.add(id);
    } else {
      this.selection = new Set([id]);
    }
    this.emit();
  }

  clearSelection() {
    if (!this.selection.size) return;
    this.selection.clear();
    this.emit();
  }

  setButton(c: CircuitComponent, pressed: number) {
    if (c.state.pressed === pressed) return;
    this.session.setButton(c.id, pressed);
    this.scheduleAutosave();
    this.emit();
  }

  // For edits that should not land on the undo stack one keystroke at a time (sliders, nudges).
  touchCircuit() {
    this.scheduleAutosave();
    this.emit();
  }

  clickTerminal(c: CircuitComponent, term: string) {
    if (this.pendingWire && this.pendingWire.comp === c.id && this.pendingWire.term === term) {
      this.cancelWire();
      return;
    }
    this.pendingWire = { comp: c.id, term };
    this.hint = `Now click a board pin to connect ${COMPONENTS[c.type].label} ${term}. Press Escape to cancel.`;
    this.emit();
  }

  cancelWire() {
    this.pendingWire = null;
    this.hint = '';
    this.emit();
  }

  clickPin(pin: Pin) {
    if (!this.pendingWire) {
      this.hint = `${pin.name}: mode ${pin.mode}${pin.pwm !== null ? `, PWM ${pin.pwm}` : ''}. Click a component terminal first to wire it.`;
      this.emit();
      return;
    }
    const { comp, term } = this.pendingWire;
    this.pendingWire = null;
    this.hint = '';
    this.rewire(comp, term, pin.id);
    this.toast(`Wired ${term} to ${pin.name}`);
  }

  // Connect a terminal to a pin, or disconnect it when pinId is null.
  rewire(comp: string, term: string, pinId: number | null) {
    this.pushUndo();
    this.project.wires = this.project.wires.filter(w => !(w.comp === comp && w.term === term));
    if (pinId !== null) this.project.wires.push({ id: uid(), comp, term, pin: pinId });
    this.scheduleAutosave();
    this.emit();
  }

  // ---- canvas view ------------------------------------------------------------

  setView(x: number, y: number) {
    this.view.x = x;
    this.view.y = y;
    this.emit();
  }

  zoomBy(factor: number) {
    this.view.z = clamp(this.view.z * factor, 0.4, 2.2);
    this.userMovedView = true;
    this.emit();
  }

  fitView() {
    this.userMovedView = false;
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('#nodes .node'));
    const canvas = document.querySelector('#canvas');
    if (!nodes.length || !canvas) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach(n => {
      minX = Math.min(minX, n.offsetLeft);
      minY = Math.min(minY, n.offsetTop);
      maxX = Math.max(maxX, n.offsetLeft + n.offsetWidth);
      maxY = Math.max(maxY, n.offsetTop + n.offsetHeight);
    });
    const box = canvas.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const pad = 22;
    const z = clamp(Math.min((box.width - pad * 2) / Math.max(1, maxX - minX), (box.height - pad * 2) / Math.max(1, maxY - minY)), 0.4, 1);
    this.view.z = z;
    this.view.x = pad - minX * z + Math.max(0, (box.width - pad * 2 - (maxX - minX) * z) / 2);
    this.view.y = pad - minY * z;
    this.emit();
  }

  // ---- panels, dialogs, toasts ------------------------------------------------

  setBottomTab(tab: BottomTab) { this.bottomTab = tab; this.emit(); }
  setSerialOption(key: 'serialAutoscroll' | 'serialTimestamps', value: boolean) { this[key] = value; this.emit(); }
  openDialog(dialog: DialogId) { this.dialog = dialog; this.emit(); }
  jumpToLine(line: number) { this.focusLine = { line, tick: Date.now() }; this.emit(); }

  toast(message: string, kind: ToastKind = 'info') {
    const toast: Toast = { id: ++this.toastId, message, kind, leaving: false };
    this.toasts.push(toast);
    this.emit();
    setTimeout(() => {
      toast.leaving = true;
      this.emit();
      setTimeout(() => {
        this.toasts = this.toasts.filter(t => t !== toast);
        this.emit();
      }, 260);
    }, 2600);
  }

  // ---- sharing ----------------------------------------------------------------

  private copy(text: string) {
    navigator.clipboard.writeText(text).then(
      () => this.toast('Copied to clipboard'),
      () => this.toast('Copy failed; your browser blocked clipboard access', 'warn'),
    );
  }

  share() {
    this.persist();
    const { name, board, code, components, wires } = this.project;
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify({ name, board, code, components, wires }))));
    this.copy(location.origin + location.pathname + '#p=' + encoded);
  }

  exportJson() {
    this.persist();
    this.copy(JSON.stringify(this.project, null, 2));
  }

  importJson(text: string) {
    try {
      const data = JSON.parse(text);
      if (!data || typeof data !== 'object') throw new Error('not an object');
      this.add(projectFromData(data, 'Imported sketch'));
      return true;
    } catch {
      this.toast('That is not valid project JSON', 'error');
      return false;
    }
  }

  private loadFromHash(): Project | null {
    const m = location.hash.match(/#p=(.+)$/);
    if (!m) return null;
    try {
      return projectFromData(JSON.parse(decodeURIComponent(escape(atob(m[1])))), 'Shared sketch');
    } catch {
      this.toast('That shared link could not be read', 'error');
      return null;
    }
  }

  // ---- backend: account, challenges, grading ----------------------------------

  private async connect() {
    this.token = storage.read<string | null>('siliconlab:token', null);
    try {
      this.challenges = await api.challenges();
      this.apiAvailable = true;
    } catch {
      this.apiAvailable = false;
      this.emit();
      return;
    }
    if (this.token) {
      try {
        this.user = await api.me(this.token);
        await this.loadProgress();
      } catch (e) {
        // Only an explicit rejection means the token is dead; a network blip should not sign the user out.
        if (e instanceof ApiError && e.status === 401) this.forgetSession();
      }
    }
    this.emit();
  }

  private forgetSession() {
    this.token = null;
    this.user = null;
    this.progress.clear();
    storage.remove('siliconlab:token');
  }

  private async loadProgress() {
    if (!this.token) return;
    const items = await api.progress(this.token);
    this.progress = new Map(items.map(i => [i.challenge_id, i]));
  }

  async authenticate(mode: 'login' | 'register', email: string, password: string): Promise<string | null> {
    try {
      const res = await (mode === 'login' ? api.login(email, password) : api.register(email, password));
      this.token = res.access_token;
      this.user = res.user;
      storage.write('siliconlab:token', this.token);
      await this.loadProgress().catch(() => { });
      this.dialog = null;
      this.toast(`Signed in as ${res.user.email}`);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : 'Sign in failed';
    }
  }

  signOut() {
    this.forgetSession();
    this.dialog = null;
    this.toast('Signed out');
  }

  private async ensureChallenge(id: string): Promise<Challenge | null> {
    const cached = this.challengeDetails.get(id);
    if (cached) return cached;
    try {
      const challenge = await api.challenge(id);
      this.challengeDetails.set(id, challenge);
      this.emit();
      return challenge;
    } catch {
      return null;
    }
  }

  get challenge(): Challenge | null {
    return this.project.challengeId ? this.challengeDetails.get(this.project.challengeId) ?? null : null;
  }

  private challengeProject(challenge: Challenge): Project {
    const { board, code, components, wires } = clone(challenge.starter);
    return {
      id: uid(), name: challenge.title, board, code, components,
      wires: wires as unknown as Project['wires'],
      createdAt: Date.now(), updatedAt: Date.now(), challengeId: challenge.id,
    };
  }

  async openChallenge(id: string) {
    // Reopen the learner's own attempt if there is one rather than discarding their work.
    const existing = this.projects.find(p => p.challengeId === id);
    if (existing) {
      if (existing.id !== this.project.id) this.open(existing);
      return;
    }
    const challenge = await this.ensureChallenge(id);
    if (!challenge) { this.toast('That challenge could not be loaded', 'error'); return; }
    this.add(this.challengeProject(challenge));
  }

  restartChallenge() {
    const challenge = this.challenge;
    if (!challenge) return;
    const fresh = this.challengeProject(challenge);
    fresh.id = this.project.id;
    fresh.createdAt = this.project.createdAt;
    this.submission = null;
    this.load(fresh, { silent: true });
    this.persist();
    this.toast('Challenge reset to its starting point');
  }

  async submit() {
    const challengeId = this.project.challengeId;
    if (!challengeId || this.submitting) return;
    this.persist();
    this.submitting = true;
    this.emit();
    try {
      const { board, code, components, wires } = this.project;
      const result = await api.submit(challengeId, { board, code, components, wires }, this.token);
      this.submission = { challengeId, result };
      if (result.saved) await this.loadProgress().catch(() => { });
      this.toast(result.passed ? 'All tests passed' : `${result.passed_tests} of ${result.total_tests} tests passed`, result.passed ? 'info' : 'warn');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) this.forgetSession();
      this.toast(e instanceof Error ? e.message : 'Submission failed', 'error');
    } finally {
      this.submitting = false;
      this.emit();
    }
  }
}

export function displayName(p: Pick<Project, 'name'>) { return p.name.trim() || 'Untitled sketch'; }

export const store = new Store();

// Re-renders the calling component whenever the store changes. The store is mutated in
// place (the simulation writes to it every frame), so components read from it directly.
export function useStore() {
  useSyncExternalStore(store.subscribe, store.getVersion);
  return store;
}
