const App = (() => {
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const el = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt !== undefined) n.textContent = txt; return n; };
const uid = () => Math.random().toString(36).slice(2, 9);
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

const COMPONENTS = {
  led: {
    label: 'LED', w: 92, h: 76,
    terminals: [{ id: 'A', label: 'anode' }, { id: 'K', label: 'cathode' }],
    defaults: { color: 'red' },
  },
  button: {
    label: 'Push button', w: 92, h: 76,
    terminals: [{ id: '1', label: 'leg 1' }, { id: '2', label: 'leg 2' }],
    defaults: { pressed: 0, latching: 0 },
  },
  pot: {
    label: 'Potentiometer', w: 108, h: 92,
    terminals: [{ id: 'VCC', label: 'supply' }, { id: 'W', label: 'wiper' }, { id: 'GND', label: 'ground' }],
    defaults: { value: 512 },
  },
  servo: {
    label: 'Servo', w: 116, h: 96,
    terminals: [{ id: 'SIG', label: 'signal' }, { id: 'VCC', label: 'supply' }, { id: 'GND', label: 'ground' }],
    defaults: {},
  },
  buzzer: {
    label: 'Piezo buzzer', w: 96, h: 80,
    terminals: [{ id: 'SIG', label: 'signal' }, { id: 'GND', label: 'ground' }],
    defaults: {},
  },
  tmp36: {
    label: 'TMP36 temperature sensor', w: 116, h: 88,
    terminals: [{ id: 'VCC', label: 'supply' }, { id: 'OUT', label: 'output' }, { id: 'GND', label: 'ground' }],
    defaults: { tempC: 22 },
  },
  sevenseg: {
    label: 'Seven-segment display', w: 132, h: 132,
    terminals: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }, { id: 'f' }, { id: 'g' }, { id: 'COM', label: 'common cathode' }],
    defaults: {},
  },
};

const state = {
  project: null,
  projects: [],
  board: null,
  runtime: null,
  status: 'idle',
  speed: 1,
  sleepUntil: 0,
  program: null,
  diagnostics: [],
  serial: [],
  serialRx: '',
  events: [],
  warnings: new Set(),
  selection: new Set(),
  pendingWire: null,
  view: { x: 40, y: 30, z: 1 },
  undoStack: [],
  redoStack: [],
  dirty: true,
  serialDirty: true,
  eventsDirty: true,
  bottomTab: 'serial',
  snapshot: null,
  audio: null,
  osc: null,
  lastMicros: 0,
  opsLastSecond: 0,
};

const store = {
  read(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  },
  write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch { return false; }
  },
};

const io = {
  serialBegin(baud) { pushSerial(`[serial opened at ${baud} baud]\n`, 'meta'); },
  serialWrite(text) { pushSerial(text, 'out'); },
  serialAvailable() { return state.serialRx.length; },
  serialRead() { if (!state.serialRx.length) return -1; const c = state.serialRx.charCodeAt(0); state.serialRx = state.serialRx.slice(1); return c; },
  serialReadAll() { const s = state.serialRx; state.serialRx = ''; return s; },
  busEvent(bus, op, args) { logEvent(bus, `${op}(${args.map(a => typeof a === 'string' ? JSON.stringify(a) : a).join(', ')})`); },
  random: Math.random,
  warn(msg) { addDiagnostic('warning', msg); },
  warnOnce(key, msg) { if (state.warnings.has(key)) return; state.warnings.add(key); addDiagnostic('warning', msg); },
  event(pin, value) { logEvent(pin, value); },
  pinChanged() { state.dirty = true; },
  readInput(pin) {
    const driven = drivenLevel(pin);
    if (driven !== null) return driven;
    return pin.mode === 'INPUT_PULLUP' ? 1 : 0;
  },
  readAnalog(pin) {
    for (const c of state.project.components) {
      if (c.type === 'pot' && wireOf(c.id, 'W') === pin.id) return clamp(Math.round(c.state.value), 0, 1023);
      if (c.type === 'tmp36' && wireOf(c.id, 'OUT') === pin.id) {
        const mv = c.state.tempC * 10 + 500;
        return clamp(Math.round(mv / 5000 * 1023), 0, 1023);
      }
    }
    const driven = drivenLevel(pin);
    if (driven !== null) return driven ? 1023 : 0;
    return pin.mode === 'INPUT_PULLUP' ? 1023 : 0;
  },
};

function drivenLevel(pin) {
  for (const c of state.project.components) {
    if (c.type !== 'button') continue;
    const a = wireOf(c.id, '1'), b = wireOf(c.id, '2');
    if (a === null || b === null) continue;
    if (!c.state.pressed) continue;
    const other = a === pin.id ? b : (b === pin.id ? a : null);
    if (other === null) continue;
    const op = state.board.pin(other);
    if (!op) continue;
    if (op.kind === 'ground') return 0;
    if (op.kind === 'power') return 1;
    if (op.mode === 'OUTPUT') return op.value;
  }
  return null;
}

function wireOf(compId, term) {
  const w = state.project.wires.find(w => w.comp === compId && w.term === term);
  return w ? w.pin : null;
}

function pinByName(name) { return state.board.pins.find(p => p.name === name); }
function pinIdByName(name) { const p = pinByName(name); return p ? p.id : null; }

function pushSerial(text, kind) {
  const lines = String(text).split('\n');
  if (!state.serial.length) state.serial.push({ kind, text: '' });
  const last = state.serial[state.serial.length - 1];
  last.text += lines[0];
  for (let i = 1; i < lines.length; i++) state.serial.push({ kind, text: lines[i], t: state.runtime ? state.runtime.micros : 0 });
  if (state.serial.length > 2000) state.serial.splice(0, state.serial.length - 2000);
  state.serialDirty = true;
}

function logEvent(source, detail) {
  state.events.push({ t: state.runtime ? state.runtime.micros : 0, source, detail });
  if (state.events.length > 800) state.events.splice(0, state.events.length - 800);
  state.eventsDirty = true;
}

function addDiagnostic(severity, message, line) {
  state.diagnostics.push({ severity, message, line });
  renderDiagnostics();
  if (severity === 'error') setBottomTab('compiler');
}

const STARTERS = [
  {
    name: 'Blink LED',
    board: 'uno',
    components: [{ type: 'led', x: 330, y: 120, state: { color: 'red' } }],
    wires: [['0:A', 'D13'], ['0:K', 'GND']],
    code: `void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
}

void loop() {
  digitalWrite(LED_BUILTIN, HIGH);
  delay(500);
  digitalWrite(LED_BUILTIN, LOW);
  delay(500);
}`,
  },
  {
    name: 'Button-controlled LED',
    board: 'uno',
    components: [
      { type: 'button', x: 330, y: 110, state: { pressed: 0, latching: 0 } },
      { type: 'led', x: 330, y: 260, state: { color: 'green' } },
    ],
    wires: [['0:1', 'D2'], ['0:2', 'GND'], ['1:A', 'D8'], ['1:K', 'GND2']],
    code: `const int buttonPin = 2;
const int ledPin = 8;

void setup() {
  pinMode(buttonPin, INPUT_PULLUP);
  pinMode(ledPin, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  if (digitalRead(buttonPin) == LOW) {
    digitalWrite(ledPin, HIGH);
  } else {
    digitalWrite(ledPin, LOW);
  }
}`,
  },
  {
    name: 'Analog potentiometer',
    board: 'uno',
    components: [
      { type: 'pot', x: 330, y: 100, state: { value: 512 } },
      { type: 'led', x: 350, y: 280, state: { color: 'amber' } },
    ],
    wires: [['0:VCC', '5V'], ['0:W', 'A0'], ['0:GND', 'GND'], ['1:A', 'D9'], ['1:K', 'GND2']],
    code: `void setup() {
  Serial.begin(9600);
  pinMode(9, OUTPUT);
}

void loop() {
  int raw = analogRead(A0);
  int duty = map(raw, 0, 1023, 0, 255);
  analogWrite(9, duty);
  Serial.print("raw=");
  Serial.print(raw);
  Serial.print("  duty=");
  Serial.println(duty);
  delay(200);
}`,
  },
  {
    name: 'Traffic light controller',
    board: 'uno',
    components: [
      { type: 'led', x: 330, y: 70, state: { color: 'red' } },
      { type: 'led', x: 330, y: 220, state: { color: 'amber' } },
      { type: 'led', x: 330, y: 370, state: { color: 'green' } },
    ],
    wires: [['0:A', 'D11'], ['0:K', 'GND'], ['1:A', 'D10'], ['1:K', 'GND'], ['2:A', 'D9'], ['2:K', 'GND2']],
    code: `const int red = 11;
const int amber = 10;
const int green = 9;

void setup() {
  pinMode(red, OUTPUT);
  pinMode(amber, OUTPUT);
  pinMode(green, OUTPUT);
  Serial.begin(9600);
}

void phase(int pin, unsigned long ms, const char* name) {
  digitalWrite(red, LOW);
  digitalWrite(amber, LOW);
  digitalWrite(green, LOW);
  digitalWrite(pin, HIGH);
  Serial.println(name);
  delay(ms);
}

void loop() {
  phase(red, 4000, "stop");
  phase(amber, 1500, "prepare");
  phase(green, 4000, "go");
  phase(amber, 1500, "slow down");
}`,
  },
  {
    name: 'Servo motor control',
    board: 'uno',
    components: [
      { type: 'servo', x: 330, y: 100, state: {} },
      { type: 'pot', x: 330, y: 260, state: { value: 512 } },
    ],
    wires: [['0:SIG', 'D9'], ['0:VCC', '5V'], ['0:GND', 'GND'], ['1:VCC', '5V'], ['1:W', 'A0'], ['1:GND', 'GND2']],
    code: `#include <Servo.h>

Servo arm;

void setup() {
  arm.attach(9);
  Serial.begin(9600);
}

void loop() {
  int angle = map(analogRead(A0), 0, 1023, 0, 180);
  arm.write(angle);
  Serial.print("angle ");
  Serial.println(angle);
  delay(100);
}`,
  },
  {
    name: 'Temperature sensor with serial output',
    board: 'uno',
    components: [
      { type: 'tmp36', x: 330, y: 110, state: { tempC: 22 } },
      { type: 'led', x: 350, y: 290, state: { color: 'red' } },
    ],
    wires: [['0:VCC', '5V'], ['0:OUT', 'A0'], ['0:GND', 'GND'], ['1:A', 'D6'], ['1:K', 'GND2']],
    code: `const float threshold = 28.0;

void setup() {
  Serial.begin(9600);
  pinMode(6, OUTPUT);
}

void loop() {
  int raw = analogRead(A0);
  float millivolts = raw * 5000.0 / 1024.0;
  float celsius = (millivolts - 500.0) / 10.0;

  Serial.print("temp ");
  Serial.print(celsius, 1);
  Serial.println(" C");

  digitalWrite(6, celsius > threshold ? HIGH : LOW);
  delay(500);
}`,
  },
  {
    name: 'Seven-segment counter',
    board: 'uno',
    components: [{ type: 'sevenseg', x: 330, y: 90, state: {} }],
    wires: [['0:a', 'D2'], ['0:b', 'D3'], ['0:c', 'D4'], ['0:d', 'D5'], ['0:e', 'D6'], ['0:f', 'D7'], ['0:g', 'D8'], ['0:COM', 'GND']],
    code: `const int segs[7] = {2, 3, 4, 5, 6, 7, 8};

const byte digits[10] = {
  0b0111111, 0b0000110, 0b1011011, 0b1001111, 0b1100110,
  0b1101101, 0b1111101, 0b0000111, 0b1111111, 0b1101111
};

void showDigit(int n) {
  for (int i = 0; i < 7; i++) {
    digitalWrite(segs[i], (digits[n] >> i) & 1);
  }
}

void setup() {
  for (int i = 0; i < 7; i++) pinMode(segs[i], OUTPUT);
  Serial.begin(9600);
}

void loop() {
  for (int n = 0; n < 10; n++) {
    showDigit(n);
    Serial.println(n);
    delay(700);
  }
}`,
  },
  {
    name: 'PWM fade with buzzer alert',
    board: 'uno',
    components: [
      { type: 'led', x: 330, y: 110, state: { color: 'cyan' } },
      { type: 'buzzer', x: 350, y: 270, state: {} },
    ],
    wires: [['0:A', 'D9'], ['0:K', 'GND'], ['1:SIG', 'D5'], ['1:GND', 'GND2']],
    code: `int duty = 0;
int step = 5;

void setup() {
  pinMode(9, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  duty += step;
  if (duty >= 255 || duty <= 0) {
    step = -step;
    tone(5, duty >= 255 ? 1200 : 600, 80);
    delay(80);
    noTone(5);
  }
  analogWrite(9, constrain(duty, 0, 255));
  delay(20);
}`,
  },
  {
    name: 'Interrupt-driven button counter',
    board: 'uno',
    components: [
      { type: 'button', x: 330, y: 110, state: { pressed: 0, latching: 0 } },
      { type: 'led', x: 330, y: 270, state: { color: 'amber' } },
    ],
    wires: [['0:1', 'D2'], ['0:2', 'GND'], ['1:A', 'D13'], ['1:K', 'GND2']],
    code: `volatile unsigned long presses = 0;
unsigned long shown = 0;

void onPress() {
  presses++;
}

void setup() {
  pinMode(2, INPUT_PULLUP);
  pinMode(13, OUTPUT);
  attachInterrupt(digitalPinToInterrupt(2), onPress, FALLING);
  Serial.begin(9600);
}

void loop() {
  if (presses != shown) {
    shown = presses;
    Serial.print("presses: ");
    Serial.println(shown);
    digitalWrite(13, shown % 2);
  }
}`,
  },
  {
    name: 'Serial command console',
    board: 'uno',
    components: [
      { type: 'led', x: 330, y: 110, state: { color: 'green' } },
      { type: 'led', x: 330, y: 260, state: { color: 'red' } },
    ],
    wires: [['0:A', 'D8'], ['0:K', 'GND'], ['1:A', 'D7'], ['1:K', 'GND2']],
    code: `void setup() {
  pinMode(7, OUTPUT);
  pinMode(8, OUTPUT);
  Serial.begin(9600);
  Serial.println("send g, r or x");
}

void loop() {
  if (Serial.available() > 0) {
    char c = Serial.read();
    if (c == 'g') { digitalWrite(8, HIGH); Serial.println("green on"); }
    if (c == 'r') { digitalWrite(7, HIGH); Serial.println("red on"); }
    if (c == 'x') {
      digitalWrite(7, LOW);
      digitalWrite(8, LOW);
      Serial.println("all off");
    }
  }
}`,
  },
];

function buildStarter(tpl) {
  const comps = tpl.components.map((c, i) => ({
    id: 'c' + i + uid().slice(0, 3),
    type: c.type, x: c.x, y: c.y, rot: 0,
    state: Object.assign({}, COMPONENTS[c.type].defaults, c.state || {}),
  }));
  const wires = tpl.wires.map(([from, pinName]) => {
    const [ci, term] = from.split(':');
    return { id: uid(), comp: comps[+ci].id, term, pinName };
  });
  return {
    id: uid(), name: tpl.name, board: tpl.board || 'uno', code: tpl.code,
    components: comps, wires, createdAt: Date.now(), updatedAt: Date.now(),
  };
}

function resolveWires(project) {
  project.wires = project.wires.map(w => {
    if (w.pinName !== undefined) {
      const p = pinByName(w.pinName);
      return { id: w.id || uid(), comp: w.comp, term: w.term, pin: p ? p.id : null };
    }
    return w;
  }).filter(w => w.pin !== null && w.pin !== undefined);
}

function boardSpec(id) { return SL.BOARDS[id] || SL.BOARDS.uno; }

function loadProject(project, opts = {}) {
  stopSim();
  state.project = project;
  state.board = new SL.Board(boardSpec(project.board), io);
  resolveWires(project);
  state.runtime = new SL.Runtime(state.board, io);
  state.program = null;
  state.diagnostics = [];
  state.warnings.clear();
  state.serial = [];
  state.events = [];
  state.selection.clear();
  state.undoStack = [];
  state.redoStack = [];
  state.snapshot = null;
  setStatus('idle');
  $('#board-select').value = project.board;
  $('#project-name').value = project.name;
  editorSetValue(project.code);
  renderCircuit();
  fitView();
  renderProjects();
  renderDiagnostics();
  renderSerial();
  renderEvents();
  renderPinTable();
  state.dirty = true;
  if (!opts.silent) toast(`Opened ${project.name}`);
}

function saveProjects() { store.write('siliconlab:projects', state.projects); }

function persist() {
  if (!state.project) return;
  state.project.code = editorGetValue();
  state.project.name = $('#project-name').value.trim() || 'Untitled sketch';
  state.project.updatedAt = Date.now();
  const idx = state.projects.findIndex(p => p.id === state.project.id);
  if (idx >= 0) state.projects[idx] = state.project; else state.projects.push(state.project);
  const ok = saveProjects();
  store.write('siliconlab:last', state.project.id);
  return ok;
}

let autosaveTimer = null;
function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => { persist(); renderProjects(); $('#autosave').textContent = 'saved ' + new Date().toLocaleTimeString(); }, 700);
}

function setStatus(status) {
  state.status = status;
  const badge = $('#status-badge');
  badge.dataset.status = status;
  badge.textContent = ({ idle: 'Idle', compiling: 'Compiling', running: 'Running', paused: 'Paused', error: 'Error' })[status];
  $('#btn-run').setAttribute('aria-pressed', String(status === 'running'));
  $('#run-label').textContent = status === 'running' ? 'Pause' : 'Run';
  $('#btn-step').disabled = !(status === 'paused');
  $('#run-icon').innerHTML = status === 'running' ? ICONS.pause : ICONS.play;
}

function compile() {
  state.diagnostics = [];
  state.warnings.clear();
  setStatus('compiling');
  const src = editorGetValue();
  const started = performance.now();
  try {
    const program = SL.parse(src);
    state.program = program;
    if (!program.functions.setup) addDiagnostic('warning', 'No setup() found; the sketch will start straight into loop()');
    if (!program.functions.loop) addDiagnostic('warning', 'No loop() found; the sketch will run once and idle');
    checkCircuit();
    const size = Math.min(boardSpec(state.project.board).flash, 900 + src.length * 6);
    addDiagnostic('info', `Compiled in ${(performance.now() - started).toFixed(0)} ms. Sketch uses about ${size} bytes of program storage (${(size / boardSpec(state.project.board).flash * 100).toFixed(1)}% of ${boardSpec(state.project.board).name}).`);
    setStatus('idle');
    renderDiagnostics();
    if (state.diagnostics.some(d => d.severity !== 'info')) setBottomTab('compiler');
    return true;
  } catch (e) {
    state.program = null;
    addDiagnostic('error', e.message, e.line);
    setStatus('error');
    markEditorError(e.line);
    return false;
  }
}

function checkCircuit() {
  const p = state.project;
  for (const c of p.components) {
    const def = COMPONENTS[c.type];
    const wired = new Set(p.wires.filter(w => w.comp === c.id).map(w => w.term));
    for (const t of def.terminals) {
      if (!wired.has(t.id)) addDiagnostic('warning', `${def.label} terminal ${t.id} is not connected`);
    }
    if (c.type === 'led') {
      const k = wireOf(c.id, 'K'), a = wireOf(c.id, 'A');
      const kp = k !== null ? state.board.pin(k) : null;
      const ap = a !== null ? state.board.pin(a) : null;
      if (kp && kp.kind !== 'ground') addDiagnostic('warning', `LED cathode is on ${kp.name}; it normally returns to GND`);
      if (ap && kp && ap.kind === 'power' && kp.kind === 'ground') addDiagnostic('warning', `LED is wired straight across ${ap.name} and GND, so it cannot be controlled by code`);
    }
    if (c.type === 'button') {
      const a = wireOf(c.id, '1'), b = wireOf(c.id, '2');
      const pa = a !== null ? state.board.pin(a) : null, pb = b !== null ? state.board.pin(b) : null;
      if (pa && pb && pa.kind === 'power' && pb.kind === 'ground') addDiagnostic('error', 'Short circuit: the button connects 5V directly to GND when pressed');
    }
  }
  const byPin = new Map();
  for (const w of p.wires) {
    const pin = state.board.pin(w.pin);
    if (!pin || pin.kind === 'power' || pin.kind === 'ground') continue;
    byPin.set(w.pin, (byPin.get(w.pin) || 0) + 1);
  }
  for (const [pinId, count] of byPin) {
    if (count > 1) addDiagnostic('warning', `${state.board.pin(pinId).name} has ${count} connections; signals may conflict`);
  }
}

function startSim() {
  if (!state.program && !compile()) return;
  if (state.status === 'error') return;
  state.runtime.reset(state.program);
  state.board.reset();
  state.sleepUntil = 0;
  state.serial = [];
  state.events = [];
  state.warnings.clear();
  state.serialRx = '';
  setStatus('running');
  logEvent('sim', 'started');
  state.dirty = true;
  loopFrame(performance.now(), true);
}

function stopSim() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  stopAudio();
}

function resetSim() {
  stopSim();
  if (state.board) state.board.reset();
  if (state.runtime && state.program) state.runtime.reset(state.program);
  state.serial = [];
  state.events = [];
  state.serialRx = '';
  state.warnings.clear();
  state.sleepUntil = 0;
  setStatus('idle');
  state.dirty = true;
  state.serialDirty = true;
  state.eventsDirty = true;
  toast('Simulation reset');
}

function toggleRun() {
  if (state.status === 'running') {
    setStatus('paused');
    stopSim();
    logEvent('sim', 'paused');
  } else if (state.status === 'paused') {
    setStatus('running');
    logEvent('sim', 'resumed');
    loopFrame(performance.now(), true);
  } else {
    startSim();
  }
}

let rafId = null;
let lastFrame = 0;
const MAX_OPS_PER_FRAME = 120000;

function loopFrame(ts, first) {
  if (state.status !== 'running') return;
  const dt = first ? 16 : Math.min(48, ts - lastFrame);
  lastFrame = ts;
  const rt = state.runtime;
  const budget = dt * 1000 * state.speed;
  const target = rt.micros + budget;
  let ops = 0;
  try {
    while (rt.micros < target && ops < MAX_OPS_PER_FRAME) {
      if (state.sleepUntil > rt.micros) { rt.micros = Math.min(state.sleepUntil, target); continue; }
      const r = rt.main.next();
      ops++;
      rt.micros += 4;
      if (r.done) { setStatus('idle'); break; }
      if (r.value && r.value.sleep) state.sleepUntil = rt.micros + r.value.sleep;
    }
  } catch (e) {
    setStatus('error');
    addDiagnostic('error', `Runtime: ${e.message}`, e.line);
    markEditorError(e.line);
    stopSim();
    updateLive();
    return;
  }
  state.opsLastSecond = ops;
  updateLive();
  rafId = requestAnimationFrame(loopFrame);
}

function stepOnce() {
  if (state.status !== 'paused') return;
  try {
    const r = state.runtime.main.next();
    state.runtime.micros += 4;
    if (r.value && r.value.sleep) {
      state.runtime.micros += r.value.sleep;
      state.sleepUntil = state.runtime.micros;
    }
    if (r.done) setStatus('idle');
  } catch (e) {
    setStatus('error');
    addDiagnostic('error', `Runtime: ${e.message}`, e.line);
  }
  updateLive();
}

function fireInterrupt(pin, edge) {
  const isr = state.runtime && state.runtime.interrupts.get(pin);
  if (!isr) return;
  const mode = isr.mode;
  const wanted = mode === 3 ? 'rising' : mode === 2 ? 'falling' : 'any';
  if (wanted !== 'any' && wanted !== edge) return;
  const gen = state.runtime.callUser(isr.fn, []);
  let guard = 0;
  try {
    let r = gen.next();
    while (!r.done && guard++ < 20000) r = gen.next();
  } catch (e) {
    addDiagnostic('error', `Interrupt handler: ${e.message}`, e.line);
  }
  logEvent(`D${pin}`, `interrupt ${edge}`);
}

function setSpeed(v) {
  state.speed = v;
  $('#speed-value').textContent = v + 'x';
  $$('#speed-menu button').forEach(b => b.setAttribute('aria-checked', String(+b.dataset.speed === v)));
}

const ICONS = {
  play: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><polygon points="6 3 20 12 6 21 6 3" fill="currentColor" stroke="none"/></svg>',
  pause: '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>',
  build: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14.7 6.3a4 4 0 0 0 4.6 5.7L21 13l-8 8-1-1-7-7 1-1 1.1 1.7a4 4 0 0 0 5.6-4.6z"/></svg>',
  reset: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
  step: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 4l10 8-10 8z" fill="currentColor" stroke="none"/><path d="M19 4v16"/></svg>',
};

function toast(message, kind = 'info') {
  const host = $('#toasts');
  const t = el('div', 'toast toast-' + kind);
  t.setAttribute('role', 'status');
  t.textContent = message;
  host.appendChild(t);
  setTimeout(() => { t.classList.add('leaving'); setTimeout(() => t.remove(), 260); }, 2600);
}

let editorEl, gutterEl, highlightEl;
function editorGetValue() { return editorEl.value; }
function editorSetValue(v) { editorEl.value = v; refreshEditor(); }

function refreshEditor() {
  const src = editorEl.value;
  highlightEl.innerHTML = highlight(src);
  const lines = src.split('\n').length;
  let g = '';
  for (let i = 1; i <= lines; i++) g += `<div data-line="${i}">${i}</div>`;
  gutterEl.innerHTML = g;
  if (errorLine) markEditorError(errorLine);
  $('#code-stats').textContent = `${lines} lines`;
}

let errorLine = null;
function markEditorError(line) {
  errorLine = line || null;
  $$('#gutter div').forEach(d => d.classList.toggle('err', errorLine !== null && +d.dataset.line === errorLine));
}

const HL_KEYWORDS = /\b(if|else|for|while|do|return|break|continue|switch|case|default|void|int|long|float|double|char|bool|boolean|byte|unsigned|const|static|volatile|String|word|uint8_t|uint16_t|uint32_t|size_t|Servo)\b/g;
const HL_BUILTINS = /\b(pinMode|digitalWrite|digitalRead|analogWrite|analogRead|delay|delayMicroseconds|millis|micros|map|constrain|random|tone|noTone|attachInterrupt|detachInterrupt|digitalPinToInterrupt|Serial|Wire|SPI|setup|loop|min|max|abs|sqrt|pow)\b/g;
const HL_CONST = /\b(HIGH|LOW|INPUT|OUTPUT|INPUT_PULLUP|LED_BUILTIN|A0|A1|A2|A3|A4|A5|true|false|CHANGE|RISING|FALLING|DEC|HEX|BIN)\b/g;

function highlight(src) {
  const esc = src.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const parts = [];
  let out = esc.replace(/(\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:[^"\\]|\\.)*"|#[^\n]*)/g, m => {
    const cls = m.startsWith('//') || m.startsWith('/*') ? 'c' : m.startsWith('#') ? 'p' : 's';
    parts.push(`<span class="hl-${cls}">${m}</span>`);
    return `\u0000${parts.length - 1}\u0000`;
  });
  out = out
    .replace(HL_CONST, '<span class="hl-n">$1</span>')
    .replace(HL_KEYWORDS, '<span class="hl-k">$1</span>')
    .replace(HL_BUILTINS, '<span class="hl-b">$1</span>')
    .replace(/\b(\d+\.?\d*)\b/g, '<span class="hl-num">$1</span>');
  out = out.replace(/\u0000(\d+)\u0000/g, (_, i) => parts[+i]);
  return out + '\n';
}

function renderProjects() {
  const list = $('#project-list');
  list.innerHTML = '';
  const sorted = state.projects.slice().sort((a, b) => b.updatedAt - a.updatedAt);
  for (const p of sorted) {
    const row = el('div', 'project-row' + (state.project && p.id === state.project.id ? ' active' : ''));
    const btn = el('button', 'project-open');
    btn.innerHTML = `<span class="project-title">${escapeHtml(p.name)}</span><span class="project-meta">${boardSpec(p.board).name.replace('Arduino ', '')} · ${p.components.length} parts</span>`;
    btn.onclick = () => { persist(); loadProject(JSON.parse(JSON.stringify(p))); };
    const menu = el('button', 'icon-btn small');
    menu.title = 'Duplicate sketch';
    menu.setAttribute('aria-label', `Duplicate ${p.name}`);
    menu.textContent = '⧉';
    menu.onclick = () => duplicateProject(p);
    const del = el('button', 'icon-btn small danger');
    del.title = 'Delete sketch';
    del.setAttribute('aria-label', `Delete ${p.name}`);
    del.textContent = '×';
    del.onclick = () => deleteProject(p);
    row.append(btn, menu, del);
    list.appendChild(row);
  }
  if (!sorted.length) {
    const empty = el('p', 'empty', 'No sketches yet. Start one from the templates below.');
    list.appendChild(empty);
  }
}

function duplicateProject(p) {
  const copy = JSON.parse(JSON.stringify(p));
  copy.id = uid();
  copy.name = p.name + ' copy';
  copy.updatedAt = Date.now();
  const idMap = new Map();
  copy.components.forEach(c => { const n = uid(); idMap.set(c.id, n); c.id = n; });
  copy.wires.forEach(w => { w.comp = idMap.get(w.comp) || w.comp; w.id = uid(); });
  state.projects.push(copy);
  saveProjects();
  loadProject(copy);
  toast('Duplicated sketch');
}

function deleteProject(p) {
  state.projects = state.projects.filter(x => x.id !== p.id);
  saveProjects();
  if (state.project && state.project.id === p.id) {
    const next = state.projects[0] || buildStarter(STARTERS[0]);
    if (!state.projects.length) state.projects.push(next);
    loadProject(JSON.parse(JSON.stringify(next)), { silent: true });
  }
  renderProjects();
  toast(`Deleted ${p.name}`);
}

function renderTemplates() {
  const host = $('#template-list');
  host.innerHTML = '';
  STARTERS.forEach((t, i) => {
    const b = el('button', 'template-btn', t.name);
    b.onclick = () => {
      persist();
      const p = buildStarter(t);
      state.projects.push(p);
      saveProjects();
      loadProject(p);
    };
    host.appendChild(b);
  });
}

function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }

function pushUndo() {
  state.undoStack.push(JSON.stringify({ components: state.project.components, wires: state.project.wires }));
  if (state.undoStack.length > 60) state.undoStack.shift();
  state.redoStack.length = 0;
  updateUndoButtons();
}

function updateUndoButtons() {
  $('#btn-undo').disabled = !state.undoStack.length;
  $('#btn-redo').disabled = !state.redoStack.length;
}

function undo() {
  if (!state.undoStack.length) return;
  state.redoStack.push(JSON.stringify({ components: state.project.components, wires: state.project.wires }));
  const snap = JSON.parse(state.undoStack.pop());
  state.project.components = snap.components;
  state.project.wires = snap.wires;
  renderCircuit();
  scheduleAutosave();
  updateUndoButtons();
}

function redo() {
  if (!state.redoStack.length) return;
  state.undoStack.push(JSON.stringify({ components: state.project.components, wires: state.project.wires }));
  const snap = JSON.parse(state.redoStack.pop());
  state.project.components = snap.components;
  state.project.wires = snap.wires;
  renderCircuit();
  scheduleAutosave();
  updateUndoButtons();
}

function addComponent(type) {
  pushUndo();
  const c = {
    id: uid(), type,
    x: Math.round((330 + Math.random() * 40) / 10) * 10,
    y: Math.round((90 + state.project.components.length * 40) / 10) * 10,
    rot: 0,
    state: Object.assign({}, COMPONENTS[type].defaults),
  };
  state.project.components.push(c);
  state.selection = new Set([c.id]);
  renderCircuit();
  scheduleAutosave();
  toast(`Added ${COMPONENTS[type].label}`);
}

function deleteSelection() {
  if (!state.selection.size) return;
  pushUndo();
  state.project.components = state.project.components.filter(c => !state.selection.has(c.id));
  state.project.wires = state.project.wires.filter(w => !state.selection.has(w.comp));
  state.selection.clear();
  renderCircuit();
  scheduleAutosave();
}

function rotateSelection() {
  if (!state.selection.size) return;
  pushUndo();
  state.project.components.forEach(c => { if (state.selection.has(c.id)) c.rot = (c.rot + 90) % 360; });
  renderCircuit();
  scheduleAutosave();
}

function renderCircuit() {
  const layer = $('#nodes');
  layer.innerHTML = '';
  layer.appendChild(buildBoardNode());
  for (const c of state.project.components) layer.appendChild(buildComponentNode(c));
  applyView();
  state.dirty = true;
  renderInspector();
}

function buildBoardNode() {
  const spec = boardSpec(state.project.board);
  const node = el('div', 'node board-node');
  node.id = 'board-node';
  node.style.left = '40px';
  node.style.top = '60px';
  const head = el('div', 'node-head');
  head.append(el('span', 'node-title', spec.name));
  head.append(el('span', 'node-tag', `${spec.digital} digital · ${spec.analog} analog`));
  node.appendChild(head);
  const body = el('div', 'board-body');
  const digital = el('div', 'pin-col');
  const analog = el('div', 'pin-col');
  for (const p of state.board.pins) {
    const b = el('button', 'pin');
    b.dataset.pin = p.id;
    b.dataset.kind = p.kind;
    b.innerHTML = `<span class="pin-dot" data-pindot="${p.id}"></span><span class="pin-label">${p.name}</span><span class="pin-live" data-pinlive="${p.id}"></span>`;
    b.title = `${p.name}${state.board.isPwm(p.id) ? ' (PWM)' : ''}${spec.interrupts.includes(p.id) ? ' (interrupt)' : ''}`;
    b.setAttribute('aria-label', `Pin ${p.name}`);
    b.onclick = () => onPinClick(p);
    (p.kind === 'digital' ? digital : analog).appendChild(b);
  }
  body.append(digital, analog);
  node.appendChild(body);
  return node;
}

function buildComponentNode(c) {
  const def = COMPONENTS[c.type];
  const node = el('div', 'node comp-node' + (state.selection.has(c.id) ? ' selected' : ''));
  node.dataset.comp = c.id;
  node.style.left = c.x + 'px';
  node.style.top = c.y + 'px';
  node.tabIndex = 0;
  node.setAttribute('role', 'group');
  node.setAttribute('aria-label', def.label);
  const head = el('div', 'node-head drag-handle');
  head.append(el('span', 'node-title', def.label));
  node.appendChild(head);

  const vis = el('div', 'comp-visual');
  vis.style.transform = `rotate(${c.rot}deg)`;
  vis.dataset.visual = c.id;
  vis.innerHTML = visualFor(c);
  node.appendChild(vis);

  if (c.type === 'button') {
    const press = el('button', 'press-btn', 'Press');
    press.onmousedown = () => setButton(c, 1);
    press.onmouseup = () => setButton(c, 0);
    press.onmouseleave = () => { if (!c.state.latching) setButton(c, 0); };
    press.ontouchstart = e => { e.preventDefault(); setButton(c, 1); };
    press.ontouchend = e => { e.preventDefault(); setButton(c, 0); };
    press.onkeydown = e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setButton(c, 1); } };
    press.onkeyup = e => { if (e.key === ' ' || e.key === 'Enter') setButton(c, 0); };
    node.appendChild(press);
  }
  if (c.type === 'pot' || c.type === 'tmp36') {
    const wrap = el('div', 'slider-wrap');
    const input = el('input');
    input.type = 'range';
    if (c.type === 'pot') { input.min = 0; input.max = 1023; input.value = c.state.value; input.setAttribute('aria-label', 'Potentiometer position'); }
    else { input.min = -20; input.max = 60; input.value = c.state.tempC; input.setAttribute('aria-label', 'Temperature in Celsius'); }
    input.oninput = () => {
      if (c.type === 'pot') c.state.value = +input.value; else c.state.tempC = +input.value;
      state.dirty = true;
      scheduleAutosave();
    };
    wrap.appendChild(input);
    node.appendChild(wrap);
  }

  const terms = el('div', 'terminals');
  for (const t of def.terminals) {
    const b = el('button', 'term');
    b.dataset.comp = c.id;
    b.dataset.term = t.id;
    b.innerHTML = `<span class="term-dot" data-termdot="${c.id}:${t.id}"></span>${t.id}`;
    const wired = wireOf(c.id, t.id);
    b.title = wired !== null ? `${t.label || t.id} → ${state.board.pin(wired).name} (click to rewire)` : `${t.label || t.id}: click, then click a board pin`;
    b.setAttribute('aria-label', `${def.label} terminal ${t.id}${wired !== null ? `, connected to ${state.board.pin(wired).name}` : ', not connected'}`);
    b.onclick = e => { e.stopPropagation(); onTerminalClick(c, t.id); };
    terms.appendChild(b);
  }
  node.appendChild(terms);

  node.onmousedown = e => onNodeMouseDown(e, c, node);
  node.onclick = e => { if (!e.target.closest('.term') && !e.target.closest('input') && !e.target.closest('.press-btn')) selectNode(c.id, e.shiftKey); };
  node.onkeydown = e => {
    if (e.key === 'Delete' || e.key === 'Backspace') { selectNode(c.id, false); deleteSelection(); }
    if (e.key === 'r') rotateSelection();
    const nudge = { ArrowUp: [0, -10], ArrowDown: [0, 10], ArrowLeft: [-10, 0], ArrowRight: [10, 0] }[e.key];
    if (nudge) { e.preventDefault(); c.x += nudge[0]; c.y += nudge[1]; node.style.left = c.x + 'px'; node.style.top = c.y + 'px'; state.dirty = true; scheduleAutosave(); }
  };
  return node;
}

function setButton(c, pressed) {
  if (c.state.pressed === pressed) return;
  c.state.pressed = pressed;
  const pinId = wireOf(c.id, '1');
  const other = wireOf(c.id, '2');
  state.dirty = true;
  if (pinId !== null && other !== null && state.status === 'running') {
    const signalPin = state.board.pin(pinId).kind === 'digital' || state.board.pin(pinId).kind === 'analog' ? pinId : other;
    const edge = pressed ? 'falling' : 'rising';
    fireInterrupt(signalPin, edge);
  }
  scheduleAutosave();
}

function visualFor(c) {
  switch (c.type) {
    case 'led':
      return `<svg viewBox="0 0 60 50" width="72" height="60" aria-hidden="true">
        <ellipse data-led="${c.id}" cx="30" cy="22" rx="15" ry="17" fill="var(--led-off)" stroke="#2a3138" stroke-width="1.5"/>
        <path d="M15 30h30v6H15z" fill="#171c21"/>
        <path d="M22 36v12M38 36v12" stroke="#7b848c" stroke-width="2"/>
      </svg>`;
    case 'button':
      return `<svg viewBox="0 0 60 44" width="70" height="52" aria-hidden="true">
        <rect x="8" y="10" width="44" height="24" rx="4" fill="#1b2127" stroke="#333c44"/>
        <circle data-btn="${c.id}" cx="30" cy="22" r="9" fill="#39434c"/>
      </svg>`;
    case 'pot':
      return `<svg viewBox="0 0 60 50" width="72" height="58" aria-hidden="true">
        <circle cx="30" cy="24" r="17" fill="#1b2127" stroke="#333c44"/>
        <line data-knob="${c.id}" x1="30" y1="24" x2="30" y2="10" stroke="var(--cyan)" stroke-width="3" stroke-linecap="round"/>
      </svg>`;
    case 'servo':
      return `<svg viewBox="0 0 80 54" width="92" height="60" aria-hidden="true">
        <rect x="6" y="14" width="40" height="30" rx="3" fill="#1b2127" stroke="#333c44"/>
        <circle cx="54" cy="29" r="9" fill="#232a31" stroke="#333c44"/>
        <line data-horn="${c.id}" x1="54" y1="29" x2="74" y2="29" stroke="var(--amber)" stroke-width="3" stroke-linecap="round"/>
      </svg>`;
    case 'buzzer':
      return `<svg viewBox="0 0 60 50" width="70" height="56" aria-hidden="true">
        <circle cx="30" cy="24" r="17" fill="#15191e" stroke="#333c44"/>
        <circle data-buz="${c.id}" cx="30" cy="24" r="5" fill="#39434c"/>
      </svg>`;
    case 'tmp36':
      return `<svg viewBox="0 0 60 52" width="70" height="58" aria-hidden="true">
        <path d="M14 26a16 16 0 0 1 32 0v14H14z" fill="#1b2127" stroke="#333c44"/>
        <text data-temp="${c.id}" x="30" y="34" text-anchor="middle" font-size="12" fill="var(--cyan)" font-family="ui-monospace,monospace">22C</text>
      </svg>`;
    case 'sevenseg': {
      const seg = (id, d) => `<path data-seg="${c.id}:${id}" d="${d}" fill="var(--seg-off)"/>`;
      return `<svg viewBox="0 0 70 110" width="86" height="120" aria-hidden="true">
        ${seg('a', 'M18 8h34l-6 7H24z')}
        ${seg('b', 'M54 12l-4 7v28l-5-6V19z')}
        ${seg('c', 'M54 58l-4 7v28l-5-6V65z')}
        ${seg('d', 'M18 98h34l-6-7H24z')}
        ${seg('e', 'M16 58l4 7v28l5-6V65z')}
        ${seg('f', 'M16 12l4 7v28l5-6V19z')}
        ${seg('g', 'M20 53h30l-5 6H25z')}
      </svg>`;
    }
    default: return '';
  }
}

function onTerminalClick(c, term) {
  if (state.pendingWire && state.pendingWire.comp === c.id && state.pendingWire.term === term) {
    state.pendingWire = null;
    setHint('');
    state.dirty = true;
    return;
  }
  state.pendingWire = { comp: c.id, term };
  setHint(`Now click a board pin to connect ${COMPONENTS[c.type].label} ${term}. Press Escape to cancel.`);
  state.dirty = true;
}

function onPinClick(pin) {
  if (!state.pendingWire) {
    setHint(`${pin.name}: mode ${pin.mode}${pin.pwm !== null ? `, PWM ${pin.pwm}` : ''}. Click a component terminal first to wire it.`);
    return;
  }
  pushUndo();
  const { comp, term } = state.pendingWire;
  state.project.wires = state.project.wires.filter(w => !(w.comp === comp && w.term === term));
  state.project.wires.push({ id: uid(), comp, term, pin: pin.id });
  state.pendingWire = null;
  setHint('');
  renderCircuit();
  scheduleAutosave();
  toast(`Wired ${term} to ${pin.name}`);
}

function setHint(text) {
  $('#canvas-hint').textContent = text;
  $('#canvas-hint').style.display = text ? 'block' : 'none';
}

function selectNode(id, additive) {
  if (!additive) state.selection.clear();
  if (state.selection.has(id)) state.selection.delete(id); else state.selection.add(id);
  $$('.comp-node').forEach(n => n.classList.toggle('selected', state.selection.has(n.dataset.comp)));
  renderInspector();
}

let drag = null;
function onNodeMouseDown(e, c, node) {
  if (e.target.closest('.term') || e.target.closest('input') || e.target.closest('.press-btn') || e.target.closest('.pin')) return;
  e.preventDefault();
  if (!state.selection.has(c.id)) selectNode(c.id, e.shiftKey);
  pushUndo();
  const ids = state.selection.size ? Array.from(state.selection) : [c.id];
  drag = {
    startX: e.clientX, startY: e.clientY,
    items: ids.map(id => {
      const comp = state.project.components.find(x => x.id === id);
      return { comp, ox: comp.x, oy: comp.y };
    }),
  };
}

window.addEventListener('mousemove', e => {
  if (drag) {
    const dx = (e.clientX - drag.startX) / state.view.z;
    const dy = (e.clientY - drag.startY) / state.view.z;
    for (const it of drag.items) {
      it.comp.x = Math.round((it.ox + dx) / 10) * 10;
      it.comp.y = Math.round((it.oy + dy) / 10) * 10;
      const n = document.querySelector(`.comp-node[data-comp="${it.comp.id}"]`);
      if (n) { n.style.left = it.comp.x + 'px'; n.style.top = it.comp.y + 'px'; }
    }
    state.dirty = true;
  }
  if (pan) {
    state.view.x = pan.ox + (e.clientX - pan.sx);
    state.view.y = pan.oy + (e.clientY - pan.sy);
    if (Math.abs(e.clientX - pan.sx) + Math.abs(e.clientY - pan.sy) > 6) state.userMovedView = true;
    applyView();
  }
});

window.addEventListener('mouseup', () => {
  if (drag) { drag = null; scheduleAutosave(); }
  pan = null;
});

let pan = null;
function applyView() {
  const l = $('#canvas-content');
  l.style.transform = `translate(${state.view.x}px, ${state.view.y}px) scale(${state.view.z})`;
  $('#zoom-value').textContent = Math.round(state.view.z * 100) + '%';
  state.dirty = true;
}

function fitView() {
  state.userMovedView = false;
  const nodes = $$('#nodes .node');
  if (!nodes.length) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  nodes.forEach(n => {
    minX = Math.min(minX, n.offsetLeft);
    minY = Math.min(minY, n.offsetTop);
    maxX = Math.max(maxX, n.offsetLeft + n.offsetWidth);
    maxY = Math.max(maxY, n.offsetTop + n.offsetHeight);
  });
  const box = $('#canvas').getBoundingClientRect();
  if (!box.width || !box.height) return;
  const pad = 22;
  const z = clamp(Math.min((box.width - pad * 2) / Math.max(1, maxX - minX), (box.height - pad * 2) / Math.max(1, maxY - minY)), 0.4, 1);
  state.view.z = z;
  state.view.x = pad - minX * z + Math.max(0, (box.width - pad * 2 - (maxX - minX) * z) / 2);
  state.view.y = pad - minY * z;
  applyView();
}

function zoomBy(f) {
  state.view.z = clamp(state.view.z * f, 0.4, 2.2);
  state.userMovedView = true;
  applyView();
}

function renderInspector() {
  const host = $('#inspector-body');
  host.innerHTML = '';
  const ids = Array.from(state.selection);
  if (!ids.length) {
    const spec = boardSpec(state.project.board);
    host.appendChild(kv('Board', spec.name));
    host.appendChild(kv('Digital pins', String(spec.digital)));
    host.appendChild(kv('Analog inputs', String(spec.analog)));
    host.appendChild(kv('PWM pins', spec.pwm.join(', ')));
    host.appendChild(kv('Interrupt pins', spec.interrupts.join(', ')));
    host.appendChild(kv('Logic level', spec.voltage + ' V'));
    const note = el('p', 'hint', 'Select a component on the canvas to inspect and rewire it.');
    host.appendChild(note);
    return;
  }
  for (const id of ids) {
    const c = state.project.components.find(x => x.id === id);
    if (!c) continue;
    const def = COMPONENTS[c.type];
    const h = el('h3', 'inspector-heading', def.label);
    host.appendChild(h);
    if (c.type === 'led') {
      const row = el('div', 'field');
      row.appendChild(el('label', 'field-label', 'Colour'));
      const sel = el('select');
      ['red', 'green', 'amber', 'cyan'].forEach(col => { const o = el('option', null, col); o.value = col; if (c.state.color === col) o.selected = true; sel.appendChild(o); });
      sel.onchange = () => { c.state.color = sel.value; state.dirty = true; scheduleAutosave(); };
      row.appendChild(sel);
      host.appendChild(row);
    }
    if (c.type === 'button') {
      const row = el('div', 'field');
      row.appendChild(el('label', 'field-label', 'Latching'));
      const cb = el('input'); cb.type = 'checkbox'; cb.checked = !!c.state.latching;
      cb.onchange = () => { c.state.latching = cb.checked ? 1 : 0; scheduleAutosave(); };
      row.appendChild(cb);
      host.appendChild(row);
    }
    for (const t of def.terminals) {
      const row = el('div', 'field');
      row.appendChild(el('label', 'field-label', t.id + (t.label ? ` (${t.label})` : '')));
      const sel = el('select');
      const none = el('option', null, 'not connected'); none.value = '';
      sel.appendChild(none);
      for (const p of state.board.pins) {
        const o = el('option', null, p.name);
        o.value = p.id;
        if (wireOf(c.id, t.id) === p.id) o.selected = true;
        sel.appendChild(o);
      }
      sel.onchange = () => {
        pushUndo();
        state.project.wires = state.project.wires.filter(w => !(w.comp === c.id && w.term === t.id));
        if (sel.value !== '') state.project.wires.push({ id: uid(), comp: c.id, term: t.id, pin: +sel.value });
        renderCircuit();
        scheduleAutosave();
      };
      row.appendChild(sel);
      host.appendChild(row);
    }
    const actions = el('div', 'inspector-actions');
    const rot = el('button', 'btn small', 'Rotate');
    rot.onclick = rotateSelection;
    const del = el('button', 'btn small danger', 'Delete');
    del.onclick = deleteSelection;
    actions.append(rot, del);
    host.appendChild(actions);
  }
}

function kv(k, v) {
  const row = el('div', 'kv');
  row.append(el('span', 'kv-k', k), el('span', 'kv-v', v));
  return row;
}

function renderDiagnostics() {
  const host = $('#compiler-body');
  if (!state.diagnostics.length) {
    host.innerHTML = '<p class="empty">Nothing to report. Compile a sketch to see storage use, warnings and errors.</p>';
    $('#compiler-count').textContent = '';
    return;
  }
  host.innerHTML = '';
  for (const d of state.diagnostics) {
    const row = el('div', 'diag diag-' + d.severity);
    row.innerHTML = `<span class="diag-sev">${d.severity}</span><span class="diag-msg">${escapeHtml(d.message)}</span>${d.line ? `<button class="diag-line" data-line="${d.line}">line ${d.line}</button>` : ''}`;
    const jump = row.querySelector('.diag-line');
    if (jump) jump.onclick = () => jumpToLine(d.line);
    host.appendChild(row);
  }
  const errs = state.diagnostics.filter(d => d.severity === 'error').length;
  const warns = state.diagnostics.filter(d => d.severity === 'warning').length;
  $('#compiler-count').textContent = errs || warns ? `${errs} errors, ${warns} warnings` : '';
}

function jumpToLine(line) {
  const src = editorEl.value.split('\n');
  let pos = 0;
  for (let i = 0; i < line - 1 && i < src.length; i++) pos += src[i].length + 1;
  editorEl.focus();
  editorEl.setSelectionRange(pos, pos + (src[line - 1] || '').length);
  editorEl.scrollTop = Math.max(0, (line - 6) * 20);
}

function renderSerial() {
  const host = $('#serial-body');
  if (!state.serial.length) {
    host.innerHTML = '<p class="empty">No serial traffic yet. Call Serial.begin() in setup(), then run the sketch.</p>';
    state.serialDirty = false;
    return;
  }
  const atBottom = host.scrollTop + host.clientHeight >= host.scrollHeight - 40;
  const lines = state.serial.slice(-400);
  host.innerHTML = lines.map(l => `<div class="serial-line ${l.kind === 'meta' ? 'meta' : ''}">${l.t !== undefined && $('#serial-timestamps').checked ? `<span class="ts">${(l.t / 1000).toFixed(0).padStart(6, ' ')} ms</span>` : ''}${escapeHtml(l.text)}</div>`).join('');
  if (atBottom && $('#serial-autoscroll').checked) host.scrollTop = host.scrollHeight;
  state.serialDirty = false;
}

function renderEvents() {
  const host = $('#events-body');
  const rows = state.events.slice(-300).reverse();
  if (!rows.length) { host.innerHTML = '<p class="empty">Pin changes, interrupts and bus traffic appear here once the simulation runs.</p>'; state.eventsDirty = false; return; }
  host.innerHTML = rows.map(e => `<div class="event-row"><span class="ts">${(e.t / 1000).toFixed(1)} ms</span><span class="ev-src">${escapeHtml(e.source)}</span><span class="ev-detail">${escapeHtml(e.detail)}</span></div>`).join('');
  state.eventsDirty = false;
}

function renderPinTable() {
  const host = $('#pins-body');
  const rows = state.board.pins.filter(p => p.kind !== 'power' && p.kind !== 'ground');
  host.innerHTML = `<table class="pin-table"><thead><tr><th>Pin</th><th>Mode</th><th>Digital</th><th>PWM</th><th>Volts</th><th>Analog</th><th>Wired to</th></tr></thead><tbody>${rows.map(p => `<tr data-pinrow="${p.id}"><td>${p.name}</td><td class="m">${p.mode}</td><td class="d">${p.mode === 'OUTPUT' ? (p.value ? 'HIGH' : 'LOW') : '—'}</td><td class="w">${p.pwm ?? '—'}</td><td class="v">0.00</td><td class="a">—</td><td class="c">${wiredLabel(p.id)}</td></tr>`).join('')}</tbody></table>`;
}

function wiredLabel(pinId) {
  const ws = state.project.wires.filter(w => w.pin === pinId);
  if (!ws.length) return '—';
  return ws.map(w => {
    const c = state.project.components.find(x => x.id === w.comp);
    return c ? `${COMPONENTS[c.type].label} ${w.term}` : '?';
  }).join(', ');
}

function updateLive() {
  if (!state.board) return;
  updatePinTableLive();
  updateComponentsLive();
  drawWires();
  $('#sim-clock').textContent = (state.runtime.micros / 1000000).toFixed(2) + ' s';
  $('#sim-ops').textContent = state.opsLastSecond ? `${Math.round(state.opsLastSecond / 1000)}k ops/frame` : '';
  if (state.serialDirty) renderSerial();
  if (state.eventsDirty && state.bottomTab === 'events') renderEvents();
  state.dirty = false;
}

function updatePinTableLive() {
  if (state.bottomTab !== 'pins') return;
  for (const p of state.board.pins) {
    const row = document.querySelector(`[data-pinrow="${p.id}"]`);
    if (!row) continue;
    row.querySelector('.m').textContent = p.mode;
    row.querySelector('.d').textContent = p.mode === 'OUTPUT' ? (p.value ? 'HIGH' : 'LOW') : (p.mode === 'INPUT_PULLUP' || p.mode === 'INPUT' ? (io.readInput(p) ? 'HIGH' : 'LOW') : '—');
    row.querySelector('.w').textContent = p.pwm ?? '—';
    row.querySelector('.v').textContent = state.board.level(p).toFixed(2);
    row.querySelector('.a').textContent = p.kind === 'analog' ? io.readAnalog(p) : '—';
  }
}

function updateComponentsLive() {
  let buzzFreq = 0;
  for (const c of state.project.components) {
    if (c.type === 'led') {
      const a = wireOf(c.id, 'A'), k = wireOf(c.id, 'K');
      const ap = a !== null ? state.board.pin(a) : null;
      const kp = k !== null ? state.board.pin(k) : null;
      let level = 0;
      if (ap && kp && kp.kind === 'ground') level = state.board.level(ap) / boardSpec(state.project.board).voltage;
      const dot = document.querySelector(`[data-led="${c.id}"]`);
      if (dot) {
        const col = { red: '255,86,86', green: '86,230,140', amber: '255,184,74', cyan: '86,220,255' }[c.state.color || 'red'];
        dot.setAttribute('fill', level > 0.02 ? `rgba(${col},${0.25 + level * 0.75})` : 'var(--led-off)');
        dot.style.filter = level > 0.02 ? `drop-shadow(0 0 ${6 + level * 14}px rgba(${col},${level}))` : 'none';
      }
    }
    if (c.type === 'button') {
      const dot = document.querySelector(`[data-btn="${c.id}"]`);
      if (dot) dot.setAttribute('fill', c.state.pressed ? 'var(--cyan)' : '#39434c');
    }
    if (c.type === 'pot') {
      const knob = document.querySelector(`[data-knob="${c.id}"]`);
      if (knob) {
        const ang = -135 + (c.state.value / 1023) * 270;
        knob.setAttribute('transform', `rotate(${ang} 30 24)`);
      }
    }
    if (c.type === 'tmp36') {
      const label = document.querySelector(`[data-temp="${c.id}"]`);
      if (label) label.textContent = Math.round(c.state.tempC) + 'C';
    }
    if (c.type === 'servo') {
      const sig = wireOf(c.id, 'SIG');
      const p = sig !== null ? state.board.pin(sig) : null;
      let angle = p && p.servo !== null && p.servo !== undefined ? p.servo : (p && p.pwm !== null ? Math.round(p.pwm / 255 * 180) : 0);
      const horn = document.querySelector(`[data-horn="${c.id}"]`);
      if (horn) horn.setAttribute('transform', `rotate(${angle - 90} 54 29)`);
    }
    if (c.type === 'buzzer') {
      const sig = wireOf(c.id, 'SIG');
      const p = sig !== null ? state.board.pin(sig) : null;
      const freq = p ? p.tone : 0;
      if (freq) buzzFreq = freq;
      const dot = document.querySelector(`[data-buz="${c.id}"]`);
      if (dot) dot.setAttribute('fill', freq ? 'var(--amber)' : '#39434c');
    }
    if (c.type === 'sevenseg') {
      const com = wireOf(c.id, 'COM');
      const comPin = com !== null ? state.board.pin(com) : null;
      for (const seg of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
        const pinId = wireOf(c.id, seg);
        const p = pinId !== null ? state.board.pin(pinId) : null;
        const lit = p && comPin && comPin.kind === 'ground' && state.board.level(p) > 2;
        const node = document.querySelector(`[data-seg="${c.id}:${seg}"]`);
        if (node) node.setAttribute('fill', lit ? 'var(--red)' : 'var(--seg-off)');
      }
    }
  }
  updateAudio(buzzFreq);
}

function updateAudio(freq) {
  if (!freq) { stopAudio(); return; }
  try {
    if (!state.audio) state.audio = new (window.AudioContext || window.webkitAudioContext)();
    if (!state.osc) {
      state.osc = state.audio.createOscillator();
      state.gain = state.audio.createGain();
      state.gain.gain.value = 0.04;
      state.osc.connect(state.gain).connect(state.audio.destination);
      state.osc.start();
    }
    state.osc.frequency.value = freq;
  } catch { }
}

function stopAudio() {
  try { if (state.osc) { state.osc.stop(); state.osc.disconnect(); } } catch { }
  state.osc = null;
}

function drawWires() {
  const svg = $('#wires');
  const content = $('#canvas-content');
  const box = content.getBoundingClientRect();
  const z = state.view.z;
  let out = '';
  for (const w of state.project.wires) {
    const from = document.querySelector(`[data-termdot="${w.comp}:${w.term}"]`);
    const to = document.querySelector(`[data-pindot="${w.pin}"]`);
    if (!from || !to) continue;
    const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
    const x1 = (a.left + a.width / 2 - box.left) / z, y1 = (a.top + a.height / 2 - box.top) / z;
    const x2 = (b.left + b.width / 2 - box.left) / z, y2 = (b.top + b.height / 2 - box.top) / z;
    const pin = state.board.pin(w.pin);
    const v = pin ? state.board.level(pin) : 0;
    const cls = pin && pin.kind === 'ground' ? 'gnd' : pin && pin.kind === 'power' ? 'pwr' : v > 2.5 ? 'hot' : v > 0.2 ? 'mid' : 'cold';
    const mx = (x1 + x2) / 2;
    out += `<path class="wire ${cls}" d="M${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}"/>`;
  }
  if (state.pendingWire) {
    const from = document.querySelector(`[data-termdot="${state.pendingWire.comp}:${state.pendingWire.term}"]`);
    if (from) {
      const a = from.getBoundingClientRect();
      const x1 = (a.left + a.width / 2 - box.left) / z, y1 = (a.top + a.height / 2 - box.top) / z;
      out += `<circle class="wire-pending" cx="${x1}" cy="${y1}" r="7"/>`;
    }
  }
  svg.innerHTML = out;
}

function setBottomTab(tab) {
  state.bottomTab = tab;
  $$('.tab').forEach(b => {
    const on = b.dataset.tab === tab;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
  });
  $$('.tab-panel').forEach(p => p.hidden = p.dataset.panel !== tab);
  if (tab === 'pins') { renderPinTable(); updatePinTableLive(); }
  if (tab === 'events') renderEvents();
  if (tab === 'serial') renderSerial();
}

function shareUrl() {
  persist();
  const payload = {
    name: state.project.name, board: state.project.board, code: state.project.code,
    components: state.project.components, wires: state.project.wires,
  };
  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  const url = location.origin + location.pathname + '#p=' + encoded;
  copyText(url);
  return url;
}

function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => toast('Copied to clipboard'), () => fallbackCopy(text));
  } else fallbackCopy(text);
}

function fallbackCopy(text) {
  const ta = el('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); toast('Copied to clipboard'); } catch { toast('Copy failed; select the text manually', 'warn'); }
  ta.remove();
}

function loadFromHash() {
  const m = location.hash.match(/#p=(.+)$/);
  if (!m) return null;
  try {
    const data = JSON.parse(decodeURIComponent(escape(atob(m[1]))));
    return { id: uid(), name: data.name || 'Shared sketch', board: data.board || 'uno', code: data.code, components: data.components || [], wires: data.wires || [], createdAt: Date.now(), updatedAt: Date.now() };
  } catch { toast('That shared link could not be read', 'error'); return null; }
}

function openDialog(id) { $(id).showModal(); }

function bindUI() {
  editorEl = $('#code');
  gutterEl = $('#gutter');
  highlightEl = $('#highlight');

  let editTimer;
  editorEl.addEventListener('input', () => {
    clearTimeout(editTimer);
    editTimer = setTimeout(() => { refreshEditor(); scheduleAutosave(); state.program = null; }, 140);
  });
  editorEl.addEventListener('scroll', () => {
    highlightEl.scrollTop = editorEl.scrollTop;
    highlightEl.scrollLeft = editorEl.scrollLeft;
    gutterEl.scrollTop = editorEl.scrollTop;
  });
  editorEl.addEventListener('keydown', e => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = editorEl.selectionStart, en = editorEl.selectionEnd;
      editorEl.value = editorEl.value.slice(0, s) + '  ' + editorEl.value.slice(en);
      editorEl.selectionStart = editorEl.selectionEnd = s + 2;
      refreshEditor();
    }
  });

  $('#btn-compile').onclick = () => { if (compile()) toast('Compiled'); };
  $('#btn-run').onclick = toggleRun;
  $('#btn-reset').onclick = resetSim;
  $('#btn-step').onclick = stepOnce;
  $('#btn-undo').onclick = undo;
  $('#btn-redo').onclick = redo;
  $('#btn-zoom-in').onclick = () => zoomBy(1.2);
  $('#btn-zoom-out').onclick = () => zoomBy(1 / 1.2);
  $('#btn-zoom-reset').onclick = fitView;
  $('#btn-snapshot').onclick = () => {
    state.snapshot = { pins: JSON.parse(JSON.stringify(state.board.pins)), micros: state.runtime.micros, components: JSON.parse(JSON.stringify(state.project.components.map(c => c.state))) };
    $('#btn-restore').disabled = false;
    toast('Snapshot captured');
    logEvent('sim', 'snapshot captured');
  };
  $('#btn-restore').onclick = () => {
    if (!state.snapshot) return;
    state.board.pins = JSON.parse(JSON.stringify(state.snapshot.pins));
    state.project.components.forEach((c, i) => { if (state.snapshot.components[i]) c.state = JSON.parse(JSON.stringify(state.snapshot.components[i])); });
    state.dirty = true;
    renderCircuit();
    updateLive();
    toast('Snapshot restored');
  };
  $('#btn-share').onclick = () => { shareUrl(); };
  $('#btn-export').onclick = () => {
    persist();
    copyText(JSON.stringify(state.project, null, 2));
  };
  $('#btn-import').onclick = () => { $('#import-text').value = ''; openDialog('#import-dialog'); };
  $('#import-confirm').onclick = e => {
    e.preventDefault();
    try {
      const data = JSON.parse($('#import-text').value);
      const p = { id: uid(), name: data.name || 'Imported sketch', board: data.board || 'uno', code: data.code || '', components: data.components || [], wires: data.wires || [], createdAt: Date.now(), updatedAt: Date.now() };
      state.projects.push(p);
      saveProjects();
      loadProject(p);
      $('#import-dialog').close();
    } catch (err) {
      toast('That is not valid project JSON', 'error');
    }
  };
  $('#btn-new').onclick = () => {
    persist();
    const p = buildStarter(STARTERS[0]);
    p.name = 'Untitled sketch';
    state.projects.push(p);
    saveProjects();
    loadProject(p);
  };
  $('#btn-save').onclick = () => {
    const ok = persist();
    toast(ok ? 'Sketch saved' : 'Local storage is unavailable, so this sketch stays in memory only', ok ? 'info' : 'warn');
    renderProjects();
  };
  $('#project-name').oninput = scheduleAutosave;
  $('#board-select').onchange = e => {
    state.project.board = e.target.value;
    state.board = new SL.Board(boardSpec(e.target.value), io);
    state.runtime = new SL.Runtime(state.board, io);
    state.program = null;
    state.project.wires = state.project.wires.filter(w => state.board.pin(w.pin));
    resetSim();
    renderCircuit();
    fitView();
    renderPinTable();
    scheduleAutosave();
    toast(`Switched to ${boardSpec(e.target.value).name}`);
  };

  $$('#speed-menu button').forEach(b => { b.onclick = () => setSpeed(+b.dataset.speed); });
  $$('.tab').forEach(b => {
    b.onclick = () => setBottomTab(b.dataset.tab);
    b.onkeydown = e => {
      const tabs = $$('.tab');
      const i = tabs.indexOf(b);
      if (e.key === 'ArrowRight') { tabs[(i + 1) % tabs.length].focus(); tabs[(i + 1) % tabs.length].click(); }
      if (e.key === 'ArrowLeft') { tabs[(i - 1 + tabs.length) % tabs.length].focus(); tabs[(i - 1 + tabs.length) % tabs.length].click(); }
    };
  });

  $('#serial-send').onsubmit = e => {
    e.preventDefault();
    const v = $('#serial-input').value;
    if (!v) return;
    state.serialRx += v + '\n';
    pushSerial(`> ${v}\n`, 'meta');
    $('#serial-input').value = '';
    renderSerial();
  };
  $('#serial-clear').onclick = () => { state.serial = []; renderSerial(); };
  $('#events-clear').onclick = () => { state.events = []; renderEvents(); };
  $('#serial-timestamps').onchange = renderSerial;

  $('#palette').innerHTML = '';
  for (const [type, def] of Object.entries(COMPONENTS)) {
    const b = el('button', 'palette-btn', def.label);
    b.title = `Add ${def.label} to the canvas`;
    b.onclick = () => addComponent(type);
    $('#palette').appendChild(b);
  }

  const canvas = $('#canvas');
  canvas.addEventListener('mousedown', e => {
    if (e.target.closest('.node')) return;
    state.selection.clear();
    $$('.comp-node').forEach(n => n.classList.remove('selected'));
    renderInspector();
    pan = { sx: e.clientX, sy: e.clientY, ox: state.view.x, oy: state.view.y };
  });
  canvas.addEventListener('wheel', e => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1.08 : 1 / 1.08);
  }, { passive: false });

  window.addEventListener('keydown', e => {
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape' && state.pendingWire) { state.pendingWire = null; setHint(''); state.dirty = true; }
    if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); if (compile()) toast('Compiled'); }
    if (mod && e.key === 'Enter') { e.preventDefault(); toggleRun(); }
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); persist(); toast('Sketch saved'); renderProjects(); }
    if (mod && e.altKey && e.key.toLowerCase() === 'r') { e.preventDefault(); resetSim(); }
    if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey && !isEditing(e)) { e.preventDefault(); undo(); }
    if (mod && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z')) && !isEditing(e)) { e.preventDefault(); redo(); }
    if (e.altKey && ['1', '2', '3', '4'].includes(e.key)) {
      e.preventDefault();
      setBottomTab(['serial', 'compiler', 'pins', 'events'][+e.key - 1]);
    }
    if (e.altKey && e.key.toLowerCase() === 'b') { e.preventDefault(); toggleBottom(); }
    if ((e.key === 'Delete') && !isEditing(e)) deleteSelection();
    if (e.key === 'r' && !isEditing(e) && !mod && state.selection.size) rotateSelection();
  });

  $('#btn-toggle-bottom').onclick = toggleBottom;
  $('#btn-toggle-left').onclick = () => {
    const hidden = getComputedStyle($('.sidebar')).display === 'none';
    document.body.classList.toggle('hide-left', !hidden);
    document.body.classList.toggle('show-left', hidden);
    $('#btn-toggle-left').setAttribute('aria-expanded', String(hidden));
  };
  $('#btn-toggle-right').onclick = () => {
    const hidden = getComputedStyle($('.inspector')).display === 'none';
    document.body.classList.toggle('hide-right', !hidden);
    document.body.classList.toggle('show-right', hidden);
    $('#btn-toggle-right').setAttribute('aria-expanded', String(hidden));
  };
  $$('dialog').forEach(d => { d.querySelectorAll('[data-close]').forEach(b => b.onclick = () => d.close()); });
  $('#btn-help').onclick = () => openDialog('#help-dialog');
  window.addEventListener('beforeunload', persist);
}

function isEditing(e) {
  const t = e.target;
  return t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable);
}

function toggleBottom() {
  document.body.classList.toggle('hide-bottom');
  $('#btn-toggle-bottom').setAttribute('aria-expanded', String(!document.body.classList.contains('hide-bottom')));
}

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!state.userMovedView) fitView();
    state.dirty = true;
    drawWires();
  }, 140);
});

function idleRender() {
  if (state.dirty && state.status !== 'running') updateLive();
  requestAnimationFrame(idleRender);
}

function boot() {
  bindUI();
  $('#run-icon').innerHTML = ICONS.play;
  $('#compile-icon').innerHTML = ICONS.build;
  $('#reset-icon').innerHTML = ICONS.reset;
  $('#step-icon').innerHTML = ICONS.step;
  state.projects = store.read('siliconlab:projects', []);
  if (!Array.isArray(state.projects) || !state.projects.length) {
    state.projects = [buildStarter(STARTERS[0])];
    saveProjects();
  }
  renderTemplates();
  const shared = loadFromHash();
  let target = shared;
  if (!target) {
    const lastId = store.read('siliconlab:last', null);
    target = state.projects.find(p => p.id === lastId) || state.projects[0];
  } else {
    state.projects.push(target);
    saveProjects();
    history.replaceState(null, '', location.pathname);
  }
  loadProject(JSON.parse(JSON.stringify(target)), { silent: true });
  setSpeed(1);
  setBottomTab('serial');
  compile();
  setBottomTab('serial');
  updateLive();
  idleRender();
  $('#boot-overlay').remove();
}

window.addEventListener('error', e => {
  const banner = $('#crash');
  if (!banner) return;
  banner.hidden = false;
  banner.querySelector('.crash-msg').textContent = e.message;
});

return { boot, state, compile, startSim, STARTERS, COMPONENTS };
})();

window.addEventListener('DOMContentLoaded', () => {
  try { App.boot(); }
  catch (e) {
    const b = document.querySelector('#crash');
    b.hidden = false;
    b.querySelector('.crash-msg').textContent = e.message;
    console.error(e);
  }
});

