// Executes a parsed C program against a small model of a microcontroller's memory.
//
// Memory map (32-bit, little-endian):
//   0x0800_0000  flash: functions and string literals, read-only
//   0x2000_0000  64 KB of RAM: globals, then the heap, then the stack growing down from the top
//   0x4000_0000  peripheral registers, readable and writable so register code can be exercised
//   0xE000_0000  system registers
//
// Every byte of RAM has a shadow byte saying whether it may be touched, so out-of-bounds writes,
// use-after-free and pointers to dead locals are reported instead of silently corrupting memory.
import { CError, Exit, UCHAR, USHORT, UINT, ULLONG, isRecord, convert, arith, shift, compare } from './types.js';
import { FUNC_BASE, RODATA_BASE, RAM_BASE, REDZONE } from './parser.js';
import { BUILTINS } from './libc.js';

export const RAM_SIZE = 0x10000;
const STACK_SIZE = 0x4000;
const PAGE = 4096;
const OK = 0, HEAP_FREE = 1, HEAP_FREED = 2, STACK_DEAD = 3, GLOBAL_GAP = 5;
const UNIT = { 1: UCHAR, 2: USHORT, 4: UINT, 8: ULLONG };
const NORMAL = 0, BREAK = 1, CONTINUE = 2, RETURN = 3;

const hex = a => '0x' + (a >>> 0).toString(16).toUpperCase().padStart(8, '0');
const bytes = n => `${n} byte${n === 1 ? '' : 's'}`;

export class Machine {
  constructor(program, { maxOps = 2_000_000, maxOutput = 65536 } = {}) {
    this.program = program;
    this.maxOps = maxOps;
    this.maxOutput = maxOutput;
    this.ops = 0;
    this.out = '';
    this.line = null;
    this.file = null;
    this.ret = 0;
    this.depth = 0;
    this.rodata = program.rodata;
    this.buf = new ArrayBuffer(RAM_SIZE);
    this.ram = new Uint8Array(this.buf);
    this.dv = new DataView(this.buf);
    this.scratch = new Uint8Array(8);
    this.scratchDv = new DataView(this.scratch.buffer);
    this.pages = new Map();
    this.shadow = new Uint8Array(RAM_SIZE);
    this.stackLimit = RAM_SIZE - STACK_SIZE;
    this.sp = RAM_SIZE;
    this.fp = RAM_BASE + RAM_SIZE;
    this.heapStart = program.globalsSize;
    this.heapTop = this.heapStart;
    this.blocks = new Map();
    this.rand = 1;
    if (program.globalsSize > this.stackLimit - 1024) throw new CError('The global variables do not fit in 64 KB of RAM');
    this.shadow.fill(GLOBAL_GAP, 0, this.heapStart);
    for (const [off, size] of program.globals) this.shadow.fill(OK, off, off + size);
    this.shadow.fill(HEAP_FREE, this.heapStart, this.stackLimit);
    this.shadow.fill(STACK_DEAD, this.stackLimit, RAM_SIZE);
  }

  fault(message) { return new CError(message, this.line, this.file); }

  // ---- memory ------------------------------------------------------------------

  shadowFault(addr, size, write, code) {
    const what = `${write ? 'write' : 'read'} of ${bytes(size)} at ${hex(addr)}`;
    switch (code) {
      case HEAP_FREE: return this.fault(`Heap buffer overflow: ${what} is outside any allocated block`);
      case HEAP_FREED: return this.fault(`Use after free: ${what} touches memory that was already freed`);
      case STACK_DEAD: return this.fault(`Invalid stack access: ${what} touches a local variable whose function has already returned (or is beyond the stack)`);
      case GLOBAL_GAP: return this.fault(`Out-of-bounds access: ${what} is past the end of a global variable`);
      default: return this.fault(`Out-of-bounds access: ${what} is past the end of a local variable`);
    }
  }

  busFault(addr, size, write) {
    const what = `${write ? 'write' : 'read'} of ${bytes(size)} at ${hex(addr)}`;
    if (addr >>> 0 < 0x1000) return this.fault(`Null pointer dereference: ${what}`);
    // Fresh stack and heap memory is filled with 0xCD, so a pointer made of that pattern was never set.
    if (addr >>> 0 === 0xCDCDCDCD) return this.fault(`Uninitialised pointer: ${what}; the pointer was never given a value`);
    if (write && addr >= 0x08000000 && addr < 0x08100000) return this.fault(`Write to read-only memory: ${what} is in flash (a string literal or a function)`);
    return this.fault(`Invalid memory access: ${what} is not RAM, flash or a peripheral register`);
  }

  page(addr, create) {
    const key = Math.floor(addr / PAGE);
    let pg = this.pages.get(key);
    if (!pg && create) { pg = new Uint8Array(PAGE); this.pages.set(key, pg); }
    return pg;
  }
  isPeripheral(addr) { return (addr >= 0x40000000 && addr < 0x60000000) || (addr >= 0xE0000000 && addr < 0xE0100000); }

  byteAt(addr, size, base) {
    const r = addr - RODATA_BASE;
    if (r >= 0 && r < this.rodata.length) return this.rodata[r];
    if (this.isPeripheral(addr)) { const pg = this.page(addr, false); return pg ? pg[addr % PAGE] : 0; }
    const o = addr - RAM_BASE;
    if (o >= 0 && o < RAM_SIZE) {
      if (this.shadow[o]) throw this.shadowFault(base, size, false, this.shadow[o]);
      return this.ram[o];
    }
    throw this.busFault(base, size, false);
  }
  setByte(addr, v, size, base) {
    if (this.isPeripheral(addr)) { this.page(addr, true)[addr % PAGE] = v; return; }
    const o = addr - RAM_BASE;
    if (o >= 0 && o < RAM_SIZE) {
      if (this.shadow[o]) throw this.shadowFault(base, size, true, this.shadow[o]);
      this.ram[o] = v;
      return;
    }
    throw this.busFault(base, size, true);
  }

  load(addr, t) {
    const size = t.size;
    let o = addr - RAM_BASE, dv = this.dv;
    if (o >= 0 && o + size <= RAM_SIZE) {
      const s = this.shadow[o] || this.shadow[o + size - 1];
      if (s) throw this.shadowFault(addr, size, false, s);
    } else {
      for (let i = 0; i < size; i++) this.scratch[i] = this.byteAt(addr + i, size, addr);
      dv = this.scratchDv; o = 0;
    }
    if (t.kind === 'int') {
      switch (size) {
        case 1: return t.unsigned ? dv.getUint8(o) : dv.getInt8(o);
        case 2: return t.unsigned ? dv.getUint16(o, true) : dv.getInt16(o, true);
        case 4: return t.unsigned ? dv.getUint32(o, true) : dv.getInt32(o, true);
        default: return t.unsigned ? dv.getBigUint64(o, true) : dv.getBigInt64(o, true);
      }
    }
    if (t.kind === 'float') return size === 4 ? dv.getFloat32(o, true) : dv.getFloat64(o, true);
    return dv.getUint32(o, true);
  }

  store(addr, t, v) {
    const size = t.size;
    let o = addr - RAM_BASE, dv = this.dv;
    const fast = o >= 0 && o + size <= RAM_SIZE;
    if (fast) {
      const s = this.shadow[o] || this.shadow[o + size - 1];
      if (s) throw this.shadowFault(addr, size, true, s);
    } else { dv = this.scratchDv; o = 0; }
    if (t.kind === 'int') {
      switch (size) {
        case 1: dv.setUint8(o, v); break;
        case 2: dv.setUint16(o, v, true); break;
        case 4: dv.setUint32(o, v, true); break;
        default: dv.setBigUint64(o, BigInt.asUintN(64, v), true);
      }
    } else if (t.kind === 'float') { if (size === 4) dv.setFloat32(o, v, true); else dv.setFloat64(o, v, true); }
    else dv.setUint32(o, v, true);
    if (!fast) for (let i = 0; i < size; i++) this.setByte(addr + i, this.scratch[i], size, addr);
  }

  loadBits(addr, n) {
    const unit = UNIT[n.type.size], { off, width } = n.bf;
    const u = this.load(addr, unit);
    if (unit.size === 8) {
      const x = (u >> BigInt(off)) & ((1n << BigInt(width)) - 1n);
      return n.type.unsigned ? x : BigInt.asIntN(width, x);
    }
    const x = width === 32 ? u : (u >>> off) & ((1 << width) - 1);
    if (n.type.unsigned) return x >>> 0;
    return width === 32 ? x | 0 : (x << (32 - width)) >> (32 - width);
  }

  storeBits(addr, n, v) {
    const unit = UNIT[n.type.size], { off, width } = n.bf;
    const u = this.load(addr, unit);
    if (unit.size === 8) {
      const mask = ((1n << BigInt(width)) - 1n) << BigInt(off);
      this.store(addr, unit, (u & ~mask) | ((BigInt.asUintN(64, BigInt(v)) << BigInt(off)) & mask));
    } else {
      const mask = width === 32 ? 0xFFFFFFFF : ((1 << width) - 1) << off;
      this.store(addr, unit, ((u & ~mask) | ((Number(v) << off) & mask)) >>> 0);
    }
    return this.loadBits(addr, n);
  }

  loadRef(n, addr) { return n.bf ? this.loadBits(addr, n) : this.load(addr, n.type); }
  storeRef(n, addr, v) {
    if (n.bf) return this.storeBits(addr, n, v);
    this.store(addr, n.type, v);
    return v;
  }

  // Checks that every byte of [addr, addr + n) may be accessed.
  checkRange(addr, n, write) {
    if (n <= 0) return;
    const o = addr - RAM_BASE;
    if (o >= 0 && o + n <= RAM_SIZE) {
      for (let i = o; i < o + n; i++) if (this.shadow[i]) throw this.shadowFault(addr, n, write, this.shadow[i]);
      return;
    }
    if (n > RAM_SIZE) throw this.busFault(addr, n, write);
    for (let i = 0; i < n; i++) {
      if (write) { if (!this.isPeripheral(addr + i)) throw this.busFault(addr, n, true); } else this.byteAt(addr + i, n, addr);
    }
  }

  readBytes(addr, n) {
    this.checkRange(addr, n, false);
    const o = addr - RAM_BASE;
    if (o >= 0 && o + n <= RAM_SIZE) return this.ram.slice(o, o + n);
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = this.byteAt(addr + i, n, addr);
    return out;
  }

  writeBytes(addr, data) {
    const n = data.length;
    this.checkRange(addr, n, true);
    const o = addr - RAM_BASE;
    if (o >= 0 && o + n <= RAM_SIZE) { this.ram.set(data, o); return; }
    for (let i = 0; i < n; i++) this.setByte(addr + i, data[i], n, addr);
  }

  // Reads a NUL-terminated string as an array of byte values.
  cstr(addr, limit = 65536) {
    const out = [];
    for (let a = addr; out.length < limit; a++) {
      const b = this.byteAt(a, 1, a);
      if (b === 0) return out;
      out.push(b);
    }
    throw this.fault('String is not NUL-terminated');
  }

  malloc(n) {
    const size = Math.max(8, Math.ceil(n / 8) * 8);
    let off = -1;
    if (this.heapTop + size + REDZONE <= this.stackLimit) {
      off = this.heapTop;
      this.heapTop += size + REDZONE;
    } else {
      // The fresh space is used up: reuse a freed block that is large enough.
      for (const [a, b] of this.blocks) if (b.free && b.cap >= size) { off = a - RAM_BASE; break; }
      if (off < 0) return 0;
    }
    const cap = this.blocks.get(RAM_BASE + off)?.cap ?? size;
    this.shadow.fill(HEAP_FREE, off, off + cap);
    this.shadow.fill(OK, off, off + n);
    this.ram.fill(0xCD, off, off + cap);
    this.blocks.set(RAM_BASE + off, { size: n, cap, free: false });
    return RAM_BASE + off;
  }

  free(addr) {
    if (addr === 0) return;
    const b = this.blocks.get(addr);
    if (!b) throw this.fault(`free() of ${hex(addr)}, which is not a pointer returned by malloc`);
    if (b.free) throw this.fault(`Double free of ${hex(addr)}`);
    b.free = true;
    this.shadow.fill(HEAP_FREED, addr - RAM_BASE, addr - RAM_BASE + b.cap);
  }

  write(text) {
    this.out += text;
    if (this.out.length > this.maxOutput) throw this.fault('The program printed too much output');
  }

  // ---- execution ---------------------------------------------------------------

  run() {
    const { program } = this;
    for (const init of program.ginits) {
      this.line = init.line; this.file = init.file;
      this.runItems(this.la(init.base), init.items);
    }
    if (!program.main || !program.main.body) throw new CError("The program has no 'main' function");
    try {
      return Number(this.call(program.main, [], null)) | 0;
    } catch (e) {
      if (e instanceof Exit) return e.code;
      throw e;
    }
  }

  tick() {
    if (++this.ops > this.maxOps) throw this.fault('The program ran for too long; check for a loop that never ends');
  }

  runItems(base, items) {
    for (const it of items) {
      const a = base + it.off;
      if (it.zero !== undefined) this.writeBytes(a, new Uint8Array(it.zero));
      else if (it.str) this.writeBytes(a, Uint8Array.from(it.str));
      else if (isRecord(it.type)) this.writeBytes(a, this.readBytes(this.ev(it.e), it.type.size));
      else if (it.bf) this.storeBits(a, it, this.ev(it.e));
      else this.store(a, it.type, this.ev(it.e));
    }
  }

  call(fn, argNodes, at) {
    if (!fn.body) {
      const impl = fn.builtin ? BUILTINS[fn.name] : null;
      if (!impl) throw this.fault(`'${fn.name}' is declared but never defined`);
      const vals = new Array(argNodes.length);
      for (let i = 0; i < vals.length; i++) vals[i] = this.ev(argNodes[i]);
      return impl(this, vals, argNodes);
    }
    const vals = new Array(argNodes.length);
    for (let i = 0; i < vals.length; i++) vals[i] = this.ev(argNodes[i]);
    this.tick();
    const newSp = this.sp - fn.frameSize;
    if (newSp < this.stackLimit || this.depth > 2000) throw this.fault(`Stack overflow while calling '${fn.name}': the recursion is too deep or never stops`);
    const { fp, sp, line, file } = this;
    this.shadow.set(fn.shadow, newSp);
    this.ram.fill(0xCD, newSp, sp);
    this.sp = newSp;
    this.fp = RAM_BASE + newSp;
    for (let i = 0; i < fn.params.length; i++) {
      const pm = fn.params[i];
      if (isRecord(pm.type)) {
        // The argument lives in the caller's frame, which is still intact above the new one.
        const src = vals[i] - RAM_BASE;
        if (src >= 0 && src + pm.type.size <= RAM_SIZE) this.ram.copyWithin(newSp + pm.off, src, src + pm.type.size);
        else this.writeBytes(this.fp + pm.off, this.readBytes(vals[i], pm.type.size));
      } else this.store(this.fp + pm.off, pm.type, vals[i] ?? convert(0, pm.type));
    }
    this.depth++;
    const how = this.exec(fn.body);
    this.depth--;
    let ret = this.ret;
    const rt = fn.type.ret;
    if (how !== RETURN) {
      if (rt.kind !== 'void' && fn.name !== 'main') {
        this.line = fn.line; this.file = fn.file;
        throw this.fault(`'${fn.name}' reached its closing brace without returning a value`);
      }
      ret = 0;
    } else if (isRecord(rt)) {
      const data = this.readBytes(ret, rt.size);
      ret = fp + at.tmp;
      this.ram.set(data, ret - RAM_BASE);
    }
    this.shadow.fill(STACK_DEAD, newSp, sp);
    this.sp = sp; this.fp = fp; this.line = line; this.file = file;
    return ret;
  }

  exec(s) {
    this.tick();
    this.line = s.line; this.file = s.file;
    switch (s.k) {
      case 'expr': this.ev(s.e); return NORMAL;
      case 'decl': this.runItems(this.la(s.base), s.items); return NORMAL;
      case 'block': {
        const body = s.body;
        for (let i = 0; i < body.length; i++) { const r = this.exec(body[i]); if (r) return r; }
        return NORMAL;
      }
      case 'if':
        if (truthy(this.ev(s.c))) return this.exec(s.a);
        return s.b ? this.exec(s.b) : NORMAL;
      case 'while':
        while (truthy(this.ev(s.c))) {
          const r = this.exec(s.body);
          if (r === BREAK) break;
          if (r === RETURN) return r;
          this.line = s.line;
        }
        return NORMAL;
      case 'dowhile':
        do {
          const r = this.exec(s.body);
          if (r === BREAK) break;
          if (r === RETURN) return r;
          this.line = s.line;
        } while (truthy(this.ev(s.c)));
        return NORMAL;
      case 'for':
        if (s.init) this.exec(s.init);
        while (!s.c || truthy(this.ev(s.c))) {
          const r = this.exec(s.body);
          if (r === BREAK) break;
          if (r === RETURN) return r;
          this.line = s.line;
          if (s.step) this.ev(s.step);
        }
        return NORMAL;
      case 'switch': {
        let i = s.cases.get(String(this.ev(s.e)));
        if (i === undefined) i = s.def;
        if (i === undefined) return NORMAL;
        for (; i < s.body.length; i++) {
          const r = this.exec(s.body[i]);
          if (r === BREAK) return NORMAL;
          if (r) return r;
        }
        return NORMAL;
      }
      case 'return': this.ret = s.e ? this.ev(s.e) : 0; return RETURN;
      case 'break': return BREAK;
      case 'continue': return CONTINUE;
      default: return NORMAL;
    }
  }

  // The address of an lvalue (or of a struct value, which always lives in memory).
  la(n) {
    switch (n.k) {
      case 'lvar': return this.fp + n.off;
      case 'gvar': case 'str': return n.addr;
      case 'deref': return this.ev(n.e);
      case 'member': return this.ev(n.e) + n.off;
      case 'complit': { const a = this.la(n.base); this.runItems(a, n.items); return a; }
      default: return this.ev(n);
    }
  }

  ev(n) {
    switch (n.k) {
      case 'num': return n.v;
      case 'lvar': {
        const k = n.type.kind;
        if (k === 'struct' || k === 'union' || k === 'array') return this.fp + n.off;
        return this.load(this.fp + n.off, n.type);
      }
      case 'gvar': case 'deref': case 'member': case 'str': case 'complit': {
        const a = this.la(n), k = n.type.kind;
        if (k === 'struct' || k === 'union' || k === 'array') return a;
        return n.bf ? this.loadBits(a, n) : this.load(a, n.type);
      }
      case 'decay': case 'addr': return this.la(n.e);
      case 'fptr': return n.fn.addr;
      case 'cast': { const v = this.ev(n.e); return n.type.kind === 'void' ? 0 : convert(v, n.type); }
      case 'bin': return arith(n.op, this.ev(n.l), this.ev(n.r), n.type);
      case 'shift': return shift(n.op, this.ev(n.l), this.ev(n.r), n.type);
      case 'cmp': return compare(n.op, this.ev(n.l), this.ev(n.r));
      case 'padd': return (this.ev(n.p) + n.sign * Number(this.ev(n.i)) * n.scale) >>> 0;
      case 'pdiff': return Math.trunc(((this.ev(n.l) - this.ev(n.r)) | 0) / n.scale);
      case 'neg': { const v = this.ev(n.e), t = n.type; return t.kind === 'float' ? -v : arith('-', t.size === 8 ? 0n : 0, v, t); }
      case 'bnot': return convert(~this.ev(n.e), n.type);
      case 'lnot': return truthy(this.ev(n.e)) ? 0 : 1;
      case 'land': return truthy(this.ev(n.l)) && truthy(this.ev(n.r)) ? 1 : 0;
      case 'lor': return truthy(this.ev(n.l)) || truthy(this.ev(n.r)) ? 1 : 0;
      case 'cond': return truthy(this.ev(n.c)) ? this.ev(n.a) : this.ev(n.b);
      case 'comma': this.ev(n.l); return this.ev(n.r);
      case 'assign': {
        const l = n.l;
        if (isRecord(l.type)) {
          const src = this.ev(n.r), dst = this.la(l);
          this.writeBytes(dst, this.readBytes(src, l.type.size));
          return dst;
        }
        const v = this.ev(n.r);
        return this.storeRef(l, this.la(l), v);
      }
      case 'opassign': {
        const l = n.l, a = this.la(l), cur = this.loadRef(l, a);
        if (n.scale) return this.storeRef(l, a, (cur + (n.op === '+' ? 1 : -1) * Number(this.ev(n.r)) * n.scale) >>> 0);
        const ct = n.ct, c = convert(cur, ct), r = this.ev(n.r);
        const res = n.op === '<<' || n.op === '>>' ? shift(n.op, c, r, ct) : arith(n.op, c, r, ct);
        return this.storeRef(l, a, convert(res, n.type));
      }
      case 'incdec': {
        const e = n.e, a = this.la(e), old = this.loadRef(e, a), t = n.type;
        const nv = t.kind === 'ptr' ? (old + n.delta) >>> 0 : typeof old === 'bigint' ? convert(old + BigInt(n.delta), t) : convert(old + n.delta, t);
        const stored = this.storeRef(e, a, nv);
        return n.prefix ? stored : old;
      }
      case 'call': return this.call(n.fn, n.args, n);
      case 'icall': {
        const addr = this.ev(n.e);
        const fn = this.program.functions[(addr - FUNC_BASE) / 4];
        if (!fn) throw this.fault(addr === 0 ? 'Call through a NULL function pointer' : `Call through an invalid function pointer (${hex(addr)})`);
        return this.call(fn, n.args, n);
      }
      default: throw this.fault(`Cannot evaluate '${n.k}'`);
    }
  }
}

function truthy(v) { return typeof v === 'bigint' ? v !== 0n : v !== 0; }
