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
// A byte that may be written but has never been given a value is marked too, so reading an
// uninitialised variable is reported instead of yielding whatever the memory last held.
import { CError, Exit, UCHAR, USHORT, UINT, ULLONG, isRecord, record, typeName, convert, arith, shift, compare } from './types.js';
import { FUNC_BASE, RODATA_BASE, RAM_BASE, REDZONE, SHADOW_STACK_GAP, SHADOW_UNINIT } from './parser.js';
import { BUILTINS } from './libc.js';

export const RAM_SIZE = 0x10000;
const STACK_SIZE = 0x4000;
const PAGE = 4096;
const OK = 0, HEAP_FREE = 1, HEAP_FREED = 2, STACK_DEAD = 3, GLOBAL_GAP = 5;
// The codes above (and SHADOW_STACK_GAP) forbid any access and fit in the low three bits.
// SHADOW_UNINIT allows a write, which clears it, and forbids a read.
const NO_ACCESS = 7, UNINIT = SHADOW_UNINIT;
const UNIT = { 1: UCHAR, 2: USHORT, 4: UINT, 8: ULLONG };
// GOTO travels up like RETURN until a block that contains the label picks it up.
const NORMAL = 0, BREAK = 1, CONTINUE = 2, RETURN = 3, GOTO = 4;

const hex = a => '0x' + (a >>> 0).toString(16).toUpperCase().padStart(8, '0');
const bytes = n => `${n} byte${n === 1 ? '' : 's'}`;

export class Machine {
  constructor(program, { maxOps = 2_000_000, maxOutput = 65536, stdin = '' } = {}) {
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
    // What the run cost: the lowest the stack pointer went and the most heap that was live at once.
    this.minSp = RAM_SIZE;
    this.heapLive = 0;
    this.heapPeak = 0;
    // goto: `target` is the label being jumped to, `seek` is set while execution skips forward to it.
    this.target = null;
    this.seek = null;
    // The arguments passed through '...' to the function that is running, and the va_lists made from them.
    this.va = null;
    this.vaLists = [];
    this.input = new TextEncoder().encode(String(stdin ?? ''));
    this.inputPos = 0;
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
      case UNINIT: return this.uninitFault(addr, size);
      default: return this.fault(`Out-of-bounds access: ${what} is past the end of a local variable`);
    }
  }

  // `node` is the variable being read, when the read is of a named variable.
  uninitFault(addr, size, node) {
    if (node && node.name) {
      if (node.k === 'member') return this.fault(`Uninitialised member: '.${node.name}' is read before it has been given a value`);
      if (node.type.kind === 'ptr') return this.fault(`Uninitialised pointer: '${node.name}' is used before it has been given a value`);
      return this.fault(`Uninitialised variable: '${node.name}' is read before it has been given a value`);
    }
    return this.fault(`Uninitialised memory: read of ${bytes(size)} at ${hex(addr)}, which ${size === 1 ? 'was' : 'were'} never given a value`);
  }

  // The first shadow code in [o, o + size) that forbids the access.
  blocked(o, size, write) {
    const pass = write ? NO_ACCESS : 0xFF;
    for (let i = o; i < o + size; i++) if (this.shadow[i] & pass) return this.shadow[i] & NO_ACCESS ? this.shadow[i] : UNINIT;
    return 0;
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
      if (this.shadow[o] & NO_ACCESS) throw this.shadowFault(base, size, true, this.shadow[o]);
      this.shadow[o] = OK;
      this.ram[o] = v;
      return;
    }
    throw this.busFault(base, size, true);
  }

  // `node` names the variable for the error message; `raw` skips the initialised check (see storeBits).
  load(addr, t, node, raw) {
    const size = t.size;
    let o = addr - RAM_BASE, dv = this.dv;
    if (o >= 0 && o + size <= RAM_SIZE) {
      const sh = this.shadow;
      let s = sh[o] | sh[o + size - 1];
      if (size > 2) { s |= sh[o + 1] | sh[o + 2]; if (size === 8) s |= sh[o + 3] | sh[o + 4] | sh[o + 5] | sh[o + 6]; }
      if (s && !(raw && !(s & NO_ACCESS))) {
        const code = this.blocked(o, size, false);
        throw code === UNINIT ? this.uninitFault(addr, size, node) : this.shadowFault(addr, size, false, code);
      }
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
      const sh = this.shadow;
      // Objects are separated by red zones, so checking the two ends is enough to catch a stray write.
      const s = (sh[o] | sh[o + size - 1]) & NO_ACCESS;
      if (s) throw this.shadowFault(addr, size, true, this.blocked(o, size, true));
      if (size === 4) { sh[o] = 0; sh[o + 1] = 0; sh[o + 2] = 0; sh[o + 3] = 0; }
      else if (size === 1) sh[o] = 0;
      else sh.fill(0, o, o + size);
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
    // Writing one bit-field rewrites the whole storage unit, so the rest of it need not be initialised yet.
    const u = this.load(addr, unit, null, true);
    if (unit.size === 8) {
      const mask = ((1n << BigInt(width)) - 1n) << BigInt(off);
      this.store(addr, unit, (u & ~mask) | ((BigInt.asUintN(64, BigInt(v)) << BigInt(off)) & mask));
    } else {
      const mask = width === 32 ? 0xFFFFFFFF : ((1 << width) - 1) << off;
      this.store(addr, unit, ((u & ~mask) | ((Number(v) << off) & mask)) >>> 0);
    }
    return this.loadBits(addr, n);
  }

  loadRef(n, addr) { return n.bf ? this.loadBits(addr, n) : this.load(addr, n.type, n); }
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
      const code = this.blocked(o, n, write);
      if (code) throw this.shadowFault(addr, n, write, code);
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
    if (o >= 0 && o + n <= RAM_SIZE) { this.ram.set(data, o); this.shadow.fill(OK, o, o + n); return; }
    for (let i = 0; i < n; i++) this.setByte(addr + i, data[i], n, addr);
  }

  // Copies an object byte for byte, as memcpy and struct assignment do. Bytes that were never given a
  // value (padding, members not set yet) may be copied; they stay marked, so only using them is an error.
  copy(dst, src, n) {
    if (n <= 0) return;
    const d = dst - RAM_BASE, s = src - RAM_BASE;
    if (d >= 0 && d + n <= RAM_SIZE && s >= 0 && s + n <= RAM_SIZE) {
      let code = this.blocked(s, n, true);
      if (code) throw this.shadowFault(src, n, false, code);
      code = this.blocked(d, n, true);
      if (code) throw this.shadowFault(dst, n, true, code);
      this.ram.copyWithin(d, s, s + n);
      this.shadow.copyWithin(d, s, s + n);
      return;
    }
    this.writeBytes(dst, this.readBytes(src, n));
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
    this.shadow.fill(UNINIT, off, off + n);
    this.ram.fill(0xCD, off, off + cap);
    this.blocks.set(RAM_BASE + off, { size: n, cap, free: false });
    this.heapLive += n;
    if (this.heapLive > this.heapPeak) this.heapPeak = this.heapLive;
    return RAM_BASE + off;
  }

  free(addr) {
    if (addr === 0) return;
    const b = this.blocks.get(addr);
    if (!b) throw this.fault(`free() of ${hex(addr)}, which is not a pointer returned by malloc`);
    if (b.free) throw this.fault(`Double free of ${hex(addr)}`);
    b.free = true;
    this.heapLive -= b.size;
    this.shadow.fill(HEAP_FREED, addr - RAM_BASE, addr - RAM_BASE + b.cap);
  }

  write(text) {
    this.out += text;
    if (this.out.length > this.maxOutput) throw this.fault('The program printed too much output');
  }

  // The va_list behind a handle made by va_start.
  vaList(handle, what) {
    const list = this.vaLists[handle - 1];
    if (!list) throw this.fault(`${what}: this va_list was never set up with va_start`);
    if (list.ended) throw this.fault(`${what}: this va_list was already closed with va_end`);
    return list;
  }

  // Gives memory taken from the stack by variable-length arrays back when their block ends.
  releaseStack(sp) {
    this.shadow.fill(STACK_DEAD, this.sp, sp);
    this.sp = sp;
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
      else if (isRecord(it.type)) this.copy(a, this.ev(it.e), it.type.size);
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
    const { fp, sp, line, file, va } = this;
    this.shadow.set(fn.shadow, newSp);
    this.ram.fill(0xCD, newSp, sp);
    this.sp = newSp;
    if (newSp < this.minSp) this.minSp = newSp;
    this.fp = RAM_BASE + newSp;
    for (let i = 0; i < fn.params.length; i++) {
      const pm = fn.params[i];
      // A struct argument lives in the caller's frame, which is still intact above the new one.
      if (isRecord(pm.type)) this.copy(this.fp + pm.off, vals[i], pm.type.size);
      else this.store(this.fp + pm.off, pm.type, vals[i] ?? convert(0, pm.type));
    }
    if (fn.type.variadic) {
      this.va = [];
      for (let i = fn.params.length; i < vals.length; i++) this.va.push({ v: vals[i], type: argNodes[i].type });
    }
    this.depth++;
    const how = this.exec(fn.body);
    this.depth--;
    // A switch that declares a variable-length array has no block to release it.
    if (this.sp !== newSp) this.releaseStack(newSp);
    let ret = this.ret;
    const rt = fn.type.ret;
    if (how !== RETURN) {
      if (rt.kind !== 'void' && fn.name !== 'main') {
        this.line = fn.line; this.file = fn.file;
        throw this.fault(`'${fn.name}' reached its closing brace without returning a value`);
      }
      ret = 0;
    } else if (isRecord(rt)) {
      this.copy(fp + at.tmp, ret, rt.size);
      ret = fp + at.tmp;
    }
    this.shadow.fill(STACK_DEAD, newSp, sp);
    this.sp = sp; this.fp = fp; this.line = line; this.file = file; this.va = va;
    return ret;
  }

  exec(s) {
    this.tick();
    this.line = s.line; this.file = s.file;
    switch (s.k) {
      case 'expr': this.ev(s.e); return NORMAL;
      case 'decl': this.runItems(this.la(s.base), s.items); return NORMAL;
      case 'block': {
        const body = s.body, sp = this.sp;
        // While seeking a label, start at the statement that contains it.
        let i = this.seek === null ? 0 : s.labelIdx.get(this.seek);
        let r = NORMAL;
        for (; i < body.length; i++) {
          r = this.exec(body[i]);
          if (r === NORMAL) continue;
          if (r === GOTO && this.jumpIndex(s) !== undefined) { i = this.jumpIndex(s) - 1; this.seek = this.target; r = NORMAL; continue; }
          break;
        }
        if (this.sp !== sp) this.releaseStack(sp);
        return r;
      }
      case 'if':
        if (this.seek !== null) return this.exec(s.a.labels && s.a.labels.has(this.seek) ? s.a : s.b);
        if (truthy(this.ev(s.c))) return this.exec(s.a);
        return s.b ? this.exec(s.b) : NORMAL;
      case 'while':
        // A jump into the body skips the test once, as it would on the real machine.
        while (this.seek !== null || truthy(this.ev(s.c))) {
          const r = this.exec(s.body);
          if (r === BREAK) break;
          if (r >= RETURN) return r;
          this.line = s.line;
        }
        return NORMAL;
      case 'dowhile':
        do {
          const r = this.exec(s.body);
          if (r === BREAK) break;
          if (r >= RETURN) return r;
          this.line = s.line;
        } while (truthy(this.ev(s.c)));
        return NORMAL;
      case 'for':
        if (s.init && this.seek === null) this.exec(s.init);
        while (this.seek !== null || !s.c || truthy(this.ev(s.c))) {
          const r = this.exec(s.body);
          if (r === BREAK) break;
          if (r >= RETURN) return r;
          this.line = s.line;
          if (s.step) this.ev(s.step);
        }
        return NORMAL;
      case 'switch': {
        let i;
        if (this.seek !== null) i = s.labelIdx.get(this.seek);
        else {
          i = s.cases.get(String(this.ev(s.e)));
          if (i === undefined) i = s.def;
          if (i === undefined) return NORMAL;
        }
        for (; i < s.body.length; i++) {
          const r = this.exec(s.body[i]);
          if (r === NORMAL) continue;
          if (r === BREAK) return NORMAL;
          if (r === GOTO && this.jumpIndex(s) !== undefined) { i = this.jumpIndex(s) - 1; this.seek = this.target; continue; }
          return r;
        }
        return NORMAL;
      }
      case 'return': this.ret = s.e ? this.ev(s.e) : 0; return RETURN;
      case 'break': return BREAK;
      case 'continue': return CONTINUE;
      case 'goto': this.target = s.name; return GOTO;
      case 'label':
        if (this.seek === s.name) this.seek = null;
        return this.exec(s.body);
      case 'vla': {
        const count = Number(this.ev(s.count));
        if (count <= 0) throw this.fault(`The size of variable-length array '${s.name}' must be positive, but it is ${count}`);
        const size = count * s.elem;
        const sp = this.sp - Math.ceil((size + REDZONE) / 8) * 8;
        if (sp < this.stackLimit) throw this.fault(`Stack overflow: variable-length array '${s.name}' needs ${bytes(size)}, more than the stack has left`);
        this.shadow.fill(SHADOW_STACK_GAP, sp, this.sp);
        this.shadow.fill(UNINIT, sp, sp + size);
        this.ram.fill(0xCD, sp, this.sp);
        this.sp = sp;
        if (sp < this.minSp) this.minSp = sp;
        this.store(this.fp + s.ptrOff, UINT, RAM_BASE + sp);
        this.store(this.fp + s.sizeOff, UINT, size);
        return NORMAL;
      }
      default: return NORMAL;
    }
  }

  // Where in block or switch `s` the label of the pending goto lives, if it is inside `s` at all.
  jumpIndex(s) { return s.labelIdx === undefined ? undefined : s.labelIdx.get(this.target); }

  // The address of an lvalue (or of a struct value, which always lives in memory).
  la(n) {
    switch (n.k) {
      case 'lvar': return this.fp + n.off;
      case 'vlavar': return this.load(this.fp + n.off, UINT);
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
        return this.load(this.fp + n.off, n.type, n);
      }
      case 'gvar': case 'deref': case 'member': case 'str': case 'complit': {
        const a = this.la(n), k = n.type.kind;
        if (k === 'struct' || k === 'union' || k === 'array') return a;
        return n.bf ? this.loadBits(a, n) : this.load(a, n.type, n);
      }
      case 'vlavar': return this.la(n);
      case 'vlasize': return this.load(this.fp + n.off, UINT);
      case 'vastart':
        this.vaLists.push({ args: this.va, pos: 0, ended: false });
        this.store(this.la(n.ap), UINT, this.vaLists.length);
        return 0;
      case 'vaend': this.vaList(this.ev(n.ap), 'va_end').ended = true; return 0;
      case 'vacopy': {
        const from = this.vaList(this.ev(n.src), 'va_copy');
        this.vaLists.push({ args: from.args, pos: from.pos, ended: false });
        this.store(this.la(n.ap), UINT, this.vaLists.length);
        return 0;
      }
      case 'vaarg': return this.vaArg(n);
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
          this.copy(dst, src, l.type.size);
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

// How a value travels through '...': the four shapes an argument can have after the default promotions.
function passedAs(t) {
  if (t.kind === 'float') return 'a floating-point value';
  if (t.kind === 'ptr' || t.kind === 'array') return 'a pointer';
  if (isRecord(t)) return `a ${typeName(t)}`;
  return t.size === 8 ? 'a 64-bit integer' : 'a 32-bit integer';
}

// Fetches the next argument of a va_list. Asking for the wrong type is undefined behaviour in C and
// reads rubbish on real hardware, so it is reported here.
Machine.prototype.vaArg = function vaArg(n) {
  const list = this.vaList(this.ev(n.ap), 'va_arg');
  if (list.pos >= list.args.length) throw this.fault(`va_arg: there is no argument left to read (${list.args.length} ${list.args.length === 1 ? 'was' : 'were'} passed through '...')`);
  const arg = list.args[list.pos++];
  const want = passedAs(n.type), got = passedAs(arg.type);
  const nullAsPointer = n.type.kind === 'ptr' && arg.type.kind === 'int' && arg.type.size === 4 && arg.v === 0;
  const sameRecord = isRecord(n.type) && isRecord(arg.type) && record(n.type) === record(arg.type);
  if (want !== got && !nullAsPointer && !sameRecord) {
    throw this.fault(`va_arg: asked for '${typeName(n.type)}' (${want}), but argument ${list.pos} passed through '...' is '${typeName(arg.type)}' (${got})`);
  }
  return isRecord(n.type) ? arg.v : convert(arg.v, n.type);
};
