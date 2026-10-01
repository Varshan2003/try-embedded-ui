const BOARDS = {
  uno: { id: 'uno', name: 'Arduino Uno', digital: 14, analog: 6, pwm: [3, 5, 6, 9, 10, 11], interrupts: [2, 3], voltage: 5, flash: 32256, ram: 2048 },
  nano: { id: 'nano', name: 'Arduino Nano', digital: 14, analog: 8, pwm: [3, 5, 6, 9, 10, 11], interrupts: [2, 3], voltage: 5, flash: 30720, ram: 2048 },
  mega: { id: 'mega', name: 'Arduino Mega 2560', digital: 24, analog: 16, pwm: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], interrupts: [2, 3, 18, 19, 20, 21], voltage: 5, flash: 253952, ram: 8192 },
};

class Board {
  constructor(spec, io) {
    this.spec = spec;
    this.io = io;
    this.pins = [];
    this.reset();
  }
  reset() {
    const s = this.spec;
    this.pins = [];
    for (let i = 0; i < s.digital; i++) {
      this.pins.push({ id: i, name: `D${i}`, kind: 'digital', mode: 'INPUT', value: 0, pwm: null, servo: null, tone: 0, analog: 0 });
    }
    for (let i = 0; i < s.analog; i++) {
      this.pins.push({ id: s.digital + i, name: `A${i}`, kind: 'analog', mode: 'INPUT', value: 0, pwm: null, servo: null, tone: 0, analog: 0 });
    }
    this.pins.push({ id: 900, name: '5V', kind: 'power', mode: 'POWER', value: 1, pwm: null, servo: null, tone: 0, analog: 1023 });
    this.pins.push({ id: 901, name: '3V3', kind: 'power', mode: 'POWER', value: 1, pwm: null, servo: null, tone: 0, analog: 674 });
    this.pins.push({ id: 902, name: 'GND', kind: 'ground', mode: 'POWER', value: 0, pwm: null, servo: null, tone: 0, analog: 0 });
    this.pins.push({ id: 903, name: 'GND2', kind: 'ground', mode: 'POWER', value: 0, pwm: null, servo: null, tone: 0, analog: 0 });
    this.pins.push({ id: 904, name: 'VIN', kind: 'power', mode: 'POWER', value: 1, pwm: null, servo: null, tone: 0, analog: 1023 });
  }
  pin(id) { return this.pins.find(p => p.id === Math.trunc(id)); }
  isPwm(id) { return this.spec.pwm.includes(Math.trunc(id)); }
  setMode(id, mode) {
    const p = this.pin(id);
    if (!p) { this.io.warn(`pinMode() on pin ${id}, which does not exist on ${this.spec.name}`); return 0; }
    if (p.mode !== mode) { p.mode = mode; this.io.event(p.name, `mode ${mode}`); }
    if (mode === 'INPUT_PULLUP') p.value = 1;
    return 0;
  }
  digitalWrite(id, v) {
    const p = this.pin(id);
    if (!p) { this.io.warn(`digitalWrite() on pin ${id}, which does not exist on ${this.spec.name}`); return 0; }
    if (p.mode !== 'OUTPUT') this.io.warnOnce(`pin-${p.name}-mode`, `${p.name} was written without pinMode(${p.name.replace('D', '')}, OUTPUT)`);
    p.pwm = null;
    if (p.value !== v) { p.value = v; this.io.pinChanged(p); this.io.event(p.name, v ? 'HIGH' : 'LOW'); }
    return 0;
  }
  digitalRead(id) {
    const p = this.pin(id);
    if (!p) return 0;
    if (p.mode === 'OUTPUT') return p.value;
    return this.io.readInput(p);
  }
  analogWrite(id, v) {
    const p = this.pin(id);
    if (!p) return 0;
    if (!this.isPwm(id) && p.kind === 'digital') this.io.warnOnce(`pwm-${p.name}`, `${p.name} has no PWM hardware on ${this.spec.name}; output is on/off only`);
    p.mode = 'OUTPUT';
    p.pwm = v;
    p.value = v > 127 ? 1 : 0;
    this.io.pinChanged(p);
    return 0;
  }
  analogRead(id) {
    const p = this.pin(id);
    if (!p) return 0;
    return this.io.readAnalog(p);
  }
  setServo(id, angle) {
    const p = this.pin(id);
    if (!p) return 0;
    p.servo = angle;
    this.io.pinChanged(p);
    return 0;
  }
  tone(id, freq) {
    const p = this.pin(id);
    if (!p) return 0;
    p.tone = freq;
    this.io.pinChanged(p);
    this.io.event(p.name, freq ? `tone ${freq} Hz` : 'tone off');
    return 0;
  }
  level(p) {
    if (p.kind === 'power') return p.name === '3V3' ? 3.3 : 5;
    if (p.kind === 'ground') return 0;
    if (p.mode === 'OUTPUT') {
      if (p.pwm !== null) return this.spec.voltage * p.pwm / 255;
      return p.value ? this.spec.voltage : 0;
    }
    return this.io.readInput(p) ? this.spec.voltage : 0;
  }
}

export { BOARDS, Board };
