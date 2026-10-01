import type { ComponentState, ComponentType } from '@try-embedded/simulator';

export interface StarterTemplate {
  name: string;
  board: string;
  components: { type: ComponentType; x: number; y: number; state: ComponentState }[];
  // Each wire is ['<component index>:<terminal>', '<pin name>'].
  wires: [string, string][];
  code: string;
}

export const STARTERS: StarterTemplate[] = [
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
