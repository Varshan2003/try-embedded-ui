// The Embedded C lessons. Each guide shares its id with a practice topic, so a lesson can list
// the problems that exercise it. The text lives in Markdown files next to this module.
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

export interface Guide {
  id: string;
  title: string;
  summary: string;
  minutes: number;
  source: string;
}

export const GUIDES: Guide[] = [
  { id: 'data-types', title: 'Integers and data types', minutes: 12, source: dataTypes, summary: 'Fixed-width types, integer promotion, overflow and the signed/unsigned rules that bite.' },
  { id: 'bits', title: 'Bit manipulation', minutes: 12, source: bits, summary: 'Masks, shifts, fields and the idioms every register access is built from.' },
  { id: 'registers', title: 'Registers and memory-mapped I/O', minutes: 14, source: registers, summary: 'How C talks to hardware: volatile, register structs and read-modify-write.' },
  { id: 'pointers', title: 'Pointers', minutes: 15, source: pointers, summary: 'Addresses, arithmetic, const, void pointers and object lifetime.' },
  { id: 'arrays-strings', title: 'Arrays and strings', minutes: 12, source: arraysStrings, summary: 'Decay, bounds, safe copying, and parsing and formatting without the heap.' },
  { id: 'structs-unions', title: 'Structs, unions and memory layout', minutes: 14, source: structsUnions, summary: 'Padding, packing, bit-fields, unions and byte order.' },
  { id: 'function-pointers', title: 'Function pointers and state machines', minutes: 12, source: functionPointers, summary: 'Callbacks, dispatch tables and the state-machine patterns firmware is built on.' },
  { id: 'buffers', title: 'Buffers and data structures', minutes: 13, source: buffers, summary: 'Ring buffers, pools, lists and bitmaps on static memory.' },
  { id: 'protocols', title: 'Protocols, framing and checksums', minutes: 14, source: protocols, summary: 'Checksums, CRCs, byte order, framing and parsing a byte stream.' },
  { id: 'fixed-point', title: 'Fixed-point and signal processing', minutes: 13, source: fixedPoint, summary: 'Scaling, rounding, saturation and filters without floating point.' },
  { id: 'timing', title: 'Timing, interrupts and concurrency', minutes: 14, source: timing, summary: 'Rollover-safe time, non-blocking code, ISRs and shared data.' },
];

export const QUICK_REFERENCE: Guide = {
  id: 'reference', title: 'Embedded C quick reference', minutes: 8, source: reference,
  summary: 'The idioms, sizes and rules worth having on one page before an interview.',
};

export const guideById = (id: string) => GUIDES.find(g => g.id === id);
