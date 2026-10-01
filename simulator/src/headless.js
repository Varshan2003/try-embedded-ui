import { COMPONENTS } from './components.js';
import { componentOutput } from './circuit.js';
import { Session, seededRandom } from './session.js';

const DEFAULT_MAX_OPS = 5_000_000;

function normalizeProject(project) {
  const p = JSON.parse(JSON.stringify(project));
  p.components = (p.components || []).map(c => {
    if (!COMPONENTS[c.type]) throw new Error(`Unknown component type '${c.type}'`);
    return { ...c, state: { ...COMPONENTS[c.type].defaults, ...(c.state || {}) } };
  });
  p.wires = p.wires || [];
  p.code = p.code || '';
  return p;
}

function observe(session) {
  const pins = {};
  for (const p of session.board.pins) {
    if (p.kind === 'power' || p.kind === 'ground') continue;
    pins[p.name] = {
      mode: p.mode,
      value: p.mode === 'OUTPUT' ? p.value : session.io.readInput(p),
      pwm: p.pwm,
      servo: p.servo,
      tone: p.tone,
      volts: session.board.level(p),
    };
  }
  const components = {};
  for (const c of session.project.components) components[c.id] = componentOutput(session.project, session.board, c);
  return { pins, components };
}

// Run a project with no UI: scripted inputs go in, observations come out.
// Time is purely simulated, so the same spec always produces the same result.
export function runHeadless(spec) {
  const { durationMs = 1000, inputs = [], samples = [], seed = 1, maxOps = DEFAULT_MAX_OPS } = spec;
  const session = new Session(normalizeProject(spec.project), { random: seededRandom(seed) });
  const result = { compiled: false, status: 'error', timedOut: false, micros: 0, diagnostics: session.diagnostics, serial: '', events: [], samples: [], final: null };

  if (!session.compile()) {
    result.diagnostics = session.diagnostics;
    return result;
  }
  result.compiled = true;
  session.start();

  let ops = 0;
  const advanceTo = ms => {
    const target = ms * 1000;
    while (session.status === 'running' && session.micros < target) {
      if (ops >= maxOps) { result.timedOut = true; return; }
      ops += session.advance(Math.min(1000, target - session.micros), maxOps - ops);
    }
  };

  const timeline = [
    ...inputs.map(i => ({ ...i, kind: 'input' })),
    ...samples.map(s => ({ ...s, kind: 'sample' })),
  ].filter(e => e.atMs <= durationMs).sort((a, b) => a.atMs - b.atMs);

  for (const e of timeline) {
    advanceTo(e.atMs);
    if (e.kind === 'sample') { result.samples.push({ atMs: e.atMs, serial: session.serialText(), ...observe(session) }); continue; }
    if (e.action === 'button') session.setButton(e.comp, e.pressed ? 1 : 0);
    else if (e.action === 'serial') session.serialSend(e.text);
    else if (e.action === 'set') {
      const c = session.component(e.comp);
      if (c) Object.assign(c.state, e.state);
    } else throw new Error(`Unknown input action '${e.action}'`);
  }
  advanceTo(durationMs);

  result.status = session.status;
  result.micros = session.micros;
  result.diagnostics = session.diagnostics;
  result.serial = session.serialText();
  result.events = session.events;
  result.final = observe(session);
  return result;
}
