import { COMPONENTS } from './components.js';

const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

export function wireOf(project, compId, term) {
  const w = project.wires.find(w => w.comp === compId && w.term === term);
  return w ? w.pin : null;
}

// Wires may name their pin (`pinName: 'D13'`) in authored content; the runtime works on pin ids.
export function resolveWires(project, board) {
  project.wires = project.wires.map((w, i) => {
    if (w.pinName !== undefined) {
      const p = board.pins.find(p => p.name === w.pinName);
      return { id: w.id || `w${i}`, comp: w.comp, term: w.term, pin: p ? p.id : null };
    }
    return w;
  }).filter(w => w.pin !== null && w.pin !== undefined && board.pin(w.pin));
}

export function drivenLevel(project, board, pin) {
  for (const c of project.components) {
    if (c.type !== 'button') continue;
    const a = wireOf(project, c.id, '1'), b = wireOf(project, c.id, '2');
    if (a === null || b === null) continue;
    if (!c.state.pressed) continue;
    const other = a === pin.id ? b : (b === pin.id ? a : null);
    if (other === null) continue;
    const op = board.pin(other);
    if (!op) continue;
    if (op.kind === 'ground') return 0;
    if (op.kind === 'power') return 1;
    if (op.mode === 'OUTPUT') return op.value;
  }
  return null;
}

export function readInput(project, board, pin) {
  const driven = drivenLevel(project, board, pin);
  if (driven !== null) return driven;
  return pin.mode === 'INPUT_PULLUP' ? 1 : 0;
}

export function readAnalog(project, board, pin) {
  for (const c of project.components) {
    if (c.type === 'pot' && wireOf(project, c.id, 'W') === pin.id) return clamp(Math.round(c.state.value), 0, 1023);
    if (c.type === 'tmp36' && wireOf(project, c.id, 'OUT') === pin.id) {
      const mv = c.state.tempC * 10 + 500;
      return clamp(Math.round(mv / 5000 * 1023), 0, 1023);
    }
  }
  const driven = drivenLevel(project, board, pin);
  if (driven !== null) return driven ? 1023 : 0;
  return pin.mode === 'INPUT_PULLUP' ? 1023 : 0;
}

export function checkCircuit(project, board) {
  const out = [];
  const add = (severity, message) => out.push({ severity, message });
  const pinOf = (c, term) => {
    const id = wireOf(project, c.id, term);
    return id !== null ? board.pin(id) : null;
  };
  for (const c of project.components) {
    const def = COMPONENTS[c.type];
    if (!def) continue;
    const wired = new Set(project.wires.filter(w => w.comp === c.id).map(w => w.term));
    for (const t of def.terminals) {
      if (!wired.has(t.id)) add('warning', `${def.label} terminal ${t.id} is not connected`);
    }
    if (c.type === 'led') {
      const kp = pinOf(c, 'K'), ap = pinOf(c, 'A');
      if (kp && kp.kind !== 'ground') add('warning', `LED cathode is on ${kp.name}; it normally returns to GND`);
      if (ap && kp && ap.kind === 'power' && kp.kind === 'ground') add('warning', `LED is wired straight across ${ap.name} and GND, so it cannot be controlled by code`);
    }
    if (c.type === 'button') {
      const pa = pinOf(c, '1'), pb = pinOf(c, '2');
      if (pa && pb && pa.kind === 'power' && pb.kind === 'ground') add('error', 'Short circuit: the button connects 5V directly to GND when pressed');
    }
  }
  const byPin = new Map();
  for (const w of project.wires) {
    const pin = board.pin(w.pin);
    if (!pin || pin.kind === 'power' || pin.kind === 'ground') continue;
    byPin.set(w.pin, (byPin.get(w.pin) || 0) + 1);
  }
  for (const [pinId, count] of byPin) {
    if (count > 1) add('warning', `${board.pin(pinId).name} has ${count} connections; signals may conflict`);
  }
  return out;
}

// What a component is visibly doing right now: the UI draws it, the grader asserts on it.
export function componentOutput(project, board, c) {
  const pinOf = term => {
    const id = wireOf(project, c.id, term);
    return id !== null ? board.pin(id) : null;
  };
  switch (c.type) {
    case 'led': {
      const ap = pinOf('A'), kp = pinOf('K');
      return { level: ap && kp && kp.kind === 'ground' ? board.level(ap) / board.spec.voltage : 0 };
    }
    case 'servo': {
      const p = pinOf('SIG');
      if (!p) return { angle: 0 };
      if (p.servo !== null && p.servo !== undefined) return { angle: p.servo };
      return { angle: p.pwm !== null ? Math.round(p.pwm / 255 * 180) : 0 };
    }
    case 'buzzer': {
      const p = pinOf('SIG');
      return { freq: p ? p.tone : 0 };
    }
    case 'sevenseg': {
      const com = pinOf('COM');
      const segments = {};
      for (const seg of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
        const p = pinOf(seg);
        segments[seg] = !!(p && com && com.kind === 'ground' && board.level(p) > 2);
      }
      return { segments };
    }
    case 'button': return { pressed: c.state.pressed ? 1 : 0 };
    case 'pot': return { value: c.state.value };
    case 'tmp36': return { tempC: c.state.tempC };
    default: return {};
  }
}
