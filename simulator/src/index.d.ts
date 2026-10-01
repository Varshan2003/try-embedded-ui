export type PinKind = 'digital' | 'analog' | 'power' | 'ground';
export type PinMode = 'INPUT' | 'OUTPUT' | 'INPUT_PULLUP' | 'POWER';

export interface Pin {
  id: number;
  name: string;
  kind: PinKind;
  mode: PinMode;
  value: number;
  pwm: number | null;
  servo: number | null;
  tone: number;
  analog: number;
}

export interface BoardSpec {
  id: string;
  name: string;
  digital: number;
  analog: number;
  pwm: number[];
  interrupts: number[];
  voltage: number;
  flash: number;
  ram: number;
}

export const BOARDS: Record<string, BoardSpec>;

export class Board {
  spec: BoardSpec;
  pins: Pin[];
  reset(): void;
  pin(id: number): Pin | undefined;
  isPwm(id: number): boolean;
  level(pin: Pin): number;
}

export type ComponentType = 'led' | 'button' | 'pot' | 'servo' | 'buzzer' | 'tmp36' | 'sevenseg';

export interface Terminal { id: string; label?: string }

export interface ComponentDef {
  label: string;
  w: number;
  h: number;
  terminals: Terminal[];
  defaults: Record<string, unknown>;
}

export const COMPONENTS: Record<ComponentType, ComponentDef>;

export interface ComponentState {
  color?: string;
  pressed?: number;
  latching?: number;
  value?: number;
  tempC?: number;
}

export interface CircuitComponent {
  id: string;
  type: ComponentType;
  x: number;
  y: number;
  rot: number;
  state: ComponentState;
}

export interface Wire {
  id: string;
  comp: string;
  term: string;
  pin: number;
  pinName?: string;
}

export interface Project {
  id: string;
  name: string;
  board: string;
  code: string;
  components: CircuitComponent[];
  wires: Wire[];
  createdAt: number;
  updatedAt: number;
  challengeId?: string;
}

export type Circuit = Pick<Project, 'components' | 'wires'>;

export type Severity = 'error' | 'warning' | 'info';
export interface Diagnostic { severity: Severity; message: string; line?: number }
export interface SerialLine { kind: 'out' | 'meta'; text: string; t?: number }
export interface SimEvent { t: number; source: string; detail: string }
export type SimStatus = 'idle' | 'running' | 'paused' | 'error';

export interface ComponentOutput {
  level?: number;
  angle?: number;
  freq?: number;
  segments?: Record<string, boolean>;
  pressed?: number;
  value?: number;
  tempC?: number;
}

export interface Snapshot { pins: Pin[]; micros: number; components: ComponentState[] }

export class Session {
  constructor(project: Project, opts?: { random?: () => number });
  project: Project;
  board: Board;
  status: SimStatus;
  program: unknown | null;
  diagnostics: Diagnostic[];
  serial: SerialLine[];
  events: SimEvent[];
  errorLine: number | null;
  lastOps: number;
  readonly micros: number;
  io: { readInput(pin: Pin): number; readAnalog(pin: Pin): number };
  setBoard(boardId: string): void;
  invalidate(): void;
  compile(src?: string): boolean;
  start(): boolean;
  pause(): void;
  resume(): void;
  reset(): void;
  advance(budgetMicros: number, maxOps?: number): number;
  step(): void;
  setButton(compId: string, pressed: number): void;
  serialSend(text: string): void;
  serialText(): string;
  logEvent(source: string, detail: string): void;
  component(id: string): CircuitComponent | undefined;
  snapshot(): Snapshot;
  restore(snap: Snapshot): void;
}

export const MAX_OPS_PER_FRAME: number;
export function boardSpec(id: string): BoardSpec;
export function seededRandom(seed: number): () => number;
export function wireOf(project: Circuit, compId: string, term: string): number | null;
export function resolveWires(project: Circuit, board: Board): void;
export function checkCircuit(project: Circuit, board: Board): Diagnostic[];
export function componentOutput(project: Circuit, board: Board, c: CircuitComponent): ComponentOutput;

export type RunInput =
  | { atMs: number; action: 'button'; comp: string; pressed: boolean }
  | { atMs: number; action: 'serial'; text: string }
  | { atMs: number; action: 'set'; comp: string; state: ComponentState };

export interface RunSpec {
  project: Pick<Project, 'board' | 'code'> & { components: unknown[]; wires: unknown[] };
  durationMs?: number;
  inputs?: RunInput[];
  samples?: { atMs: number }[];
  seed?: number;
  maxOps?: number;
}

export interface Observation {
  pins: Record<string, { mode: PinMode; value: number; pwm: number | null; servo: number | null; tone: number; volts: number }>;
  components: Record<string, ComponentOutput>;
}

export interface RunResult {
  compiled: boolean;
  status: SimStatus;
  timedOut: boolean;
  micros: number;
  diagnostics: Diagnostic[];
  serial: string;
  events: SimEvent[];
  samples: (Observation & { atMs: number; serial: string })[];
  final: Observation | null;
}

export function runHeadless(spec: RunSpec): RunResult;
