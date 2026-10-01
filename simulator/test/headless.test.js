import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runHeadless } from '../src/index.js';

const blink = {
  board: 'uno',
  components: [{ id: 'led1', type: 'led' }],
  wires: [
    { comp: 'led1', term: 'A', pinName: 'D13' },
    { comp: 'led1', term: 'K', pinName: 'GND' },
  ],
  code: `void setup() { pinMode(LED_BUILTIN, OUTPUT); }
void loop() {
  digitalWrite(LED_BUILTIN, HIGH);
  delay(500);
  digitalWrite(LED_BUILTIN, LOW);
  delay(500);
}`,
};

test('blink toggles the LED on simulated time', () => {
  const r = runHeadless({ project: blink, durationMs: 1200, samples: [{ atMs: 250 }, { atMs: 750 }, { atMs: 1100 }] });
  assert.equal(r.compiled, true);
  assert.equal(r.status, 'running');
  assert.deepEqual(r.samples.map(s => s.pins.D13.value), [1, 0, 1]);
  assert.deepEqual(r.samples.map(s => s.components.led1.level), [1, 0, 1]);
});

test('compile errors are reported with a line', () => {
  const r = runHeadless({ project: { ...blink, code: 'void setup() {\n  int x = ;\n}' } });
  assert.equal(r.compiled, false);
  assert.equal(r.diagnostics[0].severity, 'error');
  assert.equal(r.diagnostics[0].line, 2);
});

test('button presses fire interrupts and reach serial output', () => {
  const r = runHeadless({
    project: {
      board: 'uno',
      components: [{ id: 'btn', type: 'button' }],
      wires: [
        { comp: 'btn', term: '1', pinName: 'D2' },
        { comp: 'btn', term: '2', pinName: 'GND' },
      ],
      code: `volatile unsigned long presses = 0;
unsigned long shown = 0;
void onPress() { presses++; }
void setup() {
  pinMode(2, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(2), onPress, FALLING);
  Serial.begin(9600);
}
void loop() {
  if (presses != shown) { shown = presses; Serial.print("presses: "); Serial.println(shown); }
}`,
    },
    durationMs: 400,
    inputs: [
      { atMs: 100, action: 'button', comp: 'btn', pressed: true },
      { atMs: 150, action: 'button', comp: 'btn', pressed: false },
      { atMs: 200, action: 'button', comp: 'btn', pressed: true },
    ],
  });
  assert.match(r.serial, /presses: 1\npresses: 2/);
  assert.equal(r.final.pins.D2.value, 0);
});

test('serial input and analog sensors are scriptable', () => {
  const r = runHeadless({
    project: {
      board: 'uno',
      components: [{ id: 'pot', type: 'pot', state: { value: 0 } }],
      wires: [{ comp: 'pot', term: 'W', pinName: 'A0' }],
      code: `void setup() { Serial.begin(9600); }
void loop() {
  if (Serial.available() > 0) { char c = Serial.read(); if (c == 'r') Serial.println(analogRead(A0)); }
}`,
    },
    durationMs: 300,
    inputs: [
      { atMs: 50, action: 'serial', text: 'r' },
      { atMs: 100, action: 'set', comp: 'pot', state: { value: 800 } },
      { atMs: 150, action: 'serial', text: 'r' },
    ],
  });
  assert.equal(r.serial.trim(), '0\n800');
});

test('a sketch that never yields time is stopped by the op budget', () => {
  const r = runHeadless({ project: { ...blink, code: 'void setup() {}\nvoid loop() {}' }, durationMs: 60000, maxOps: 20000 });
  assert.equal(r.timedOut, true);
});

test('runs are deterministic', () => {
  const project = { ...blink, code: 'void setup() { Serial.begin(9600); }\nvoid loop() { Serial.println(random(1000)); delay(10); }' };
  const a = runHeadless({ project, durationMs: 200, seed: 7 });
  const b = runHeadless({ project, durationMs: 200, seed: 7 });
  assert.equal(a.serial, b.serial);
  assert.ok(a.serial.length > 0);
});
