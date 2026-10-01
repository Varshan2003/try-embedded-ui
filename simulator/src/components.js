export const COMPONENTS = {
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
