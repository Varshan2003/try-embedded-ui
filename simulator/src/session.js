import { parse, Runtime } from './interpreter.js';
import { BOARDS, Board } from './board.js';
import { checkCircuit, readAnalog, readInput, resolveWires, wireOf } from './circuit.js';

export const MAX_OPS_PER_FRAME = 120000;
const MICROS_PER_OP = 4;
const MAX_SERIAL_OUT = 200000;

export function boardSpec(id) { return BOARDS[id] || BOARDS.uno; }

// Deterministic PRNG so graded runs are reproducible.
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One project loaded onto one board. Owns everything the sketch can observe or
// change; has no DOM or timer dependencies, so the browser and the grader drive
// it the same way through advance().
export class Session {
  constructor(project, opts = {}) {
    this.random = opts.random || Math.random;
    this.project = project;
    this.status = 'idle';
    this.program = null;
    this.diagnostics = [];
    this.warnings = new Set();
    this.serial = [];
    this.serialOut = '';
    this.serialRx = '';
    this.events = [];
    this.sleepUntil = 0;
    this.errorLine = null;
    this.lastOps = 0;
    this.io = this.makeIo();
    this.setBoard(project.board);
  }

  makeIo() {
    const s = this;
    return {
      serialBegin(baud) { s.pushSerial(`[serial opened at ${baud} baud]\n`, 'meta'); },
      serialWrite(text) {
        s.pushSerial(text, 'out');
        if (s.serialOut.length < MAX_SERIAL_OUT) s.serialOut += text;
      },
      serialAvailable() { return s.serialRx.length; },
      serialRead() { if (!s.serialRx.length) return -1; const c = s.serialRx.charCodeAt(0); s.serialRx = s.serialRx.slice(1); return c; },
      serialReadAll() { const v = s.serialRx; s.serialRx = ''; return v; },
      busEvent(bus, op, args) { s.logEvent(bus, `${op}(${args.map(a => typeof a === 'string' ? JSON.stringify(a) : a).join(', ')})`); },
      random: () => s.random(),
      warn(msg) { s.addDiagnostic('warning', msg); },
      warnOnce(key, msg) { if (s.warnings.has(key)) return; s.warnings.add(key); s.addDiagnostic('warning', msg); },
      event(pin, value) { s.logEvent(pin, value); },
      pinChanged() { },
      readInput(pin) { return readInput(s.project, s.board, pin); },
      readAnalog(pin) { return readAnalog(s.project, s.board, pin); },
    };
  }

  get micros() { return this.runtime.micros; }

  setBoard(boardId) {
    this.project.board = boardSpec(boardId).id;
    this.board = new Board(boardSpec(boardId), this.io);
    resolveWires(this.project, this.board);
    this.runtime = new Runtime(this.board, this.io);
    this.program = null;
    this.status = 'idle';
    this.sleepUntil = 0;
  }

  pushSerial(text, kind) {
    const lines = String(text).split('\n');
    if (!this.serial.length) this.serial.push({ kind, text: '' });
    const last = this.serial[this.serial.length - 1];
    if (!last.text) last.kind = kind;
    last.text += lines[0];
    for (let i = 1; i < lines.length; i++) this.serial.push({ kind, text: lines[i], t: this.runtime ? this.runtime.micros : 0 });
    if (this.serial.length > 2000) this.serial.splice(0, this.serial.length - 2000);
  }

  // Everything the sketch printed, without the simulator's own annotations.
  serialText() { return this.serialOut; }

  logEvent(source, detail) {
    this.events.push({ t: this.runtime ? this.runtime.micros : 0, source, detail });
    if (this.events.length > 800) this.events.splice(0, this.events.length - 800);
  }

  addDiagnostic(severity, message, line) {
    this.diagnostics.push({ severity, message, line });
  }

  invalidate() { this.program = null; }

  compile(src = this.project.code) {
    this.diagnostics = [];
    this.warnings.clear();
    this.errorLine = null;
    const started = performance.now();
    try {
      const program = parse(src);
      this.program = program;
      if (!program.functions.setup) this.addDiagnostic('warning', 'No setup() found; the sketch will start straight into loop()');
      if (!program.functions.loop) this.addDiagnostic('warning', 'No loop() found; the sketch will run once and idle');
      for (const d of checkCircuit(this.project, this.board)) this.addDiagnostic(d.severity, d.message);
      const spec = this.board.spec;
      const size = Math.min(spec.flash, 900 + src.length * 6);
      this.addDiagnostic('info', `Compiled in ${(performance.now() - started).toFixed(0)} ms. Sketch uses about ${size} bytes of program storage (${(size / spec.flash * 100).toFixed(1)}% of ${spec.name}).`);
      this.status = 'idle';
      return true;
    } catch (e) {
      this.program = null;
      this.addDiagnostic('error', e.message, e.line);
      this.errorLine = e.line || null;
      this.status = 'error';
      return false;
    }
  }

  clearRun() {
    this.serial = [];
    this.serialOut = '';
    this.events = [];
    this.serialRx = '';
    this.warnings.clear();
    this.sleepUntil = 0;
  }

  start() {
    if (!this.program && !this.compile()) return false;
    if (this.status === 'error') return false;
    this.runtime.reset(this.program);
    this.board.reset();
    this.clearRun();
    this.status = 'running';
    this.logEvent('sim', 'started');
    return true;
  }

  pause() {
    if (this.status !== 'running') return;
    this.status = 'paused';
    this.logEvent('sim', 'paused');
  }

  resume() {
    if (this.status !== 'paused') return;
    this.status = 'running';
    this.logEvent('sim', 'resumed');
  }

  reset() {
    this.board.reset();
    if (this.program) this.runtime.reset(this.program);
    this.clearRun();
    this.status = 'idle';
  }

  fail(prefix, e) {
    this.status = 'error';
    this.addDiagnostic('error', `${prefix}: ${e.message}`, e.line);
    this.errorLine = e.line || null;
  }

  // Run the sketch forward by `budgetMicros` of simulated time, or until the op cap.
  advance(budgetMicros, maxOps = MAX_OPS_PER_FRAME) {
    if (this.status !== 'running') return 0;
    const rt = this.runtime;
    const target = rt.micros + budgetMicros;
    let ops = 0;
    try {
      while (rt.micros < target && ops < maxOps) {
        if (this.sleepUntil > rt.micros) { rt.micros = Math.min(this.sleepUntil, target); continue; }
        const r = rt.main.next();
        ops++;
        rt.micros += MICROS_PER_OP;
        if (r.done) { this.status = 'idle'; break; }
        if (r.value && r.value.sleep) this.sleepUntil = rt.micros + r.value.sleep;
      }
    } catch (e) {
      this.fail('Runtime', e);
    }
    this.lastOps = ops;
    return ops;
  }

  step() {
    if (this.status !== 'paused') return;
    const rt = this.runtime;
    try {
      const r = rt.main.next();
      rt.micros += MICROS_PER_OP;
      if (r.value && r.value.sleep) {
        rt.micros += r.value.sleep;
        this.sleepUntil = rt.micros;
      }
      if (r.done) this.status = 'idle';
    } catch (e) {
      this.fail('Runtime', e);
    }
  }

  fireInterrupt(pin, edge) {
    const isr = this.runtime.interrupts.get(pin);
    if (!isr) return;
    const wanted = isr.mode === 3 ? 'rising' : isr.mode === 2 ? 'falling' : 'any';
    if (wanted !== 'any' && wanted !== edge) return;
    const gen = this.runtime.callUser(isr.fn, []);
    let guard = 0;
    try {
      let r = gen.next();
      while (!r.done && guard++ < 20000) r = gen.next();
    } catch (e) {
      this.addDiagnostic('error', `Interrupt handler: ${e.message}`, e.line);
    }
    this.logEvent(`D${pin}`, `interrupt ${edge}`);
  }

  component(id) { return this.project.components.find(c => c.id === id); }

  setButton(compId, pressed) {
    const c = this.component(compId);
    if (!c || c.state.pressed === pressed) return;
    c.state.pressed = pressed;
    const pinId = wireOf(this.project, c.id, '1');
    const other = wireOf(this.project, c.id, '2');
    if (pinId !== null && other !== null && this.status === 'running') {
      const kind = this.board.pin(pinId).kind;
      const signalPin = kind === 'digital' || kind === 'analog' ? pinId : other;
      this.fireInterrupt(signalPin, pressed ? 'falling' : 'rising');
    }
  }

  serialSend(text) {
    this.serialRx += text + '\n';
    this.pushSerial(`> ${text}\n`, 'meta');
  }

  snapshot() {
    return JSON.parse(JSON.stringify({
      pins: this.board.pins,
      micros: this.runtime.micros,
      components: this.project.components.map(c => c.state),
    }));
  }

  restore(snap) {
    this.board.pins = JSON.parse(JSON.stringify(snap.pins));
    this.project.components.forEach((c, i) => {
      if (snap.components[i]) c.state = JSON.parse(JSON.stringify(snap.components[i]));
    });
  }
}
