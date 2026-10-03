// The Embedded C lessons. Each guide shares its id with a practice topic, so a lesson can list
// the problems that exercise it. The text lives in Markdown files next to this module.
import firstSteps from '../content/guides/first-steps.md?raw';
import variables from '../content/guides/variables.md?raw';
import controlFlow from '../content/guides/control-flow.md?raw';
import functions from '../content/guides/functions.md?raw';
import numberSystems from '../content/guides/number-systems.md?raw';
import arraysIntro from '../content/guides/arrays-intro.md?raw';
import pointersIntro from '../content/guides/pointers-intro.md?raw';
import dataTypes from '../content/guides/data-types.md?raw';
import bits from '../content/guides/bits.md?raw';
import registers from '../content/guides/registers.md?raw';
import pointers from '../content/guides/pointers.md?raw';
import arraysStrings from '../content/guides/arrays-strings.md?raw';
import structsUnions from '../content/guides/structs-unions.md?raw';
import functionPointers from '../content/guides/function-pointers.md?raw';
import buffers from '../content/guides/buffers.md?raw';
import protocols from '../content/guides/protocols.md?raw';
import fixedPoint from '../content/guides/fixed-point.md?raw';
import timing from '../content/guides/timing.md?raw';
import reference from '../content/guides/quick-reference.md?raw';

// 'foundations' assumes no programming experience; 'core' assumes the foundations.
export type Track = 'foundations' | 'core';

export const TRACKS: Record<Track, { title: string; note: string }> = {
  foundations: { title: 'Learn C from Zero', note: 'No programming experience needed. Work through these in order.' },
  core: { title: 'Embedded C', note: 'The C that firmware is built from. Assumes the track above, or that you already know basic C.' },
};

export interface Guide {
  id: string;
  track: Track;
  title: string;
  summary: string;
  minutes: number;
  source: string;
}

export const GUIDES: Guide[] = [
  { id: 'first-steps', track: 'foundations', title: 'Microcontrollers and your first program', minutes: 10, source: firstSteps, summary: 'What a microcontroller is, how code gets onto it, and the parts of a C program.' },
  { id: 'variables', track: 'foundations', title: 'Variables and operators', minutes: 10, source: variables, summary: 'Storing values, doing arithmetic, comparing, and the two surprises of integer maths.' },
  { id: 'control-flow', track: 'foundations', title: 'Decisions and loops', minutes: 11, source: controlFlow, summary: 'Choosing with if and switch, repeating with while and for, and the loop that never ends.' },
  { id: 'functions', track: 'foundations', title: 'Functions', minutes: 11, source: functions, summary: 'Splitting a program into named pieces, passing values in and getting results back.' },
  { id: 'number-systems', track: 'foundations', title: 'Binary and hexadecimal', minutes: 11, source: numberSystems, summary: 'Bits, bytes, hex digits and negative numbers, the way hardware actually stores values.' },
  { id: 'arrays-intro', track: 'foundations', title: 'Arrays and text', minutes: 11, source: arraysIntro, summary: 'Many values under one name, looping over them safely, and strings.' },
  { id: 'pointers-intro', track: 'foundations', title: 'A first look at pointers', minutes: 10, source: pointersIntro, summary: 'Addresses, and how a function reaches a variable that belongs to its caller.' },
  { id: 'data-types', track: 'core', title: 'Integers and data types', minutes: 12, source: dataTypes, summary: 'Fixed-width types, integer promotion, overflow and the signed/unsigned rules that bite.' },
  { id: 'bits', track: 'core', title: 'Bit manipulation', minutes: 12, source: bits, summary: 'Masks, shifts, fields and the idioms every register access is built from.' },
  { id: 'registers', track: 'core', title: 'Registers and memory-mapped I/O', minutes: 14, source: registers, summary: 'How C talks to hardware: volatile, register structs and read-modify-write.' },
  { id: 'pointers', track: 'core', title: 'Pointers', minutes: 15, source: pointers, summary: 'Addresses, arithmetic, const, void pointers and object lifetime.' },
  { id: 'arrays-strings', track: 'core', title: 'Arrays and strings', minutes: 12, source: arraysStrings, summary: 'Decay, bounds, safe copying, and parsing and formatting without the heap.' },
  { id: 'structs-unions', track: 'core', title: 'Structs, unions and memory layout', minutes: 14, source: structsUnions, summary: 'Padding, packing, bit-fields, unions and byte order.' },
  { id: 'function-pointers', track: 'core', title: 'Function pointers and state machines', minutes: 12, source: functionPointers, summary: 'Callbacks, dispatch tables and the state-machine patterns firmware is built on.' },
  { id: 'buffers', track: 'core', title: 'Buffers and data structures', minutes: 13, source: buffers, summary: 'Ring buffers, pools, lists and bitmaps on static memory.' },
  { id: 'protocols', track: 'core', title: 'Protocols, framing and checksums', minutes: 14, source: protocols, summary: 'Checksums, CRCs, byte order, framing and parsing a byte stream.' },
  { id: 'fixed-point', track: 'core', title: 'Fixed-point and signal processing', minutes: 13, source: fixedPoint, summary: 'Scaling, rounding, saturation and filters without floating point.' },
  { id: 'timing', track: 'core', title: 'Timing, interrupts and concurrency', minutes: 14, source: timing, summary: 'Rollover-safe time, non-blocking code, ISRs and shared data.' },
];

export const QUICK_REFERENCE: Guide = {
  id: 'reference', track: 'core', title: 'Embedded C quick reference', minutes: 8, source: reference,
  summary: 'The idioms, sizes and rules worth having on one page before an interview.',
};

export const guideById = (id: string) => GUIDES.find(g => g.id === id);

// A problem belongs to the track of the guide that shares its topic id.
export const problemTrack = (p: { topic: string }): Track => guideById(p.topic)?.track ?? 'core';
