// The C type model. The target is a 32-bit little-endian microcontroller (ILP32):
// int, long and pointers are 4 bytes, long long is 8, plain char is signed.

export class CError extends Error {
  constructor(message, line, file) { super(message); this.line = line ?? null; this.file = file ?? null; }
}

// Thrown by exit() to unwind the interpreter.
export class Exit { constructor(code) { this.code = code; } }

const int = (name, size, unsigned) => ({ kind: 'int', name, size, align: size, unsigned });

export const VOID = { kind: 'void', name: 'void', size: 1, align: 1 };
export const BOOL = { kind: 'int', name: '_Bool', size: 1, align: 1, unsigned: true, bool: true };
export const CHAR = int('char', 1, false);
export const SCHAR = int('signed char', 1, false);
export const UCHAR = int('unsigned char', 1, true);
export const SHORT = int('short', 2, false);
export const USHORT = int('unsigned short', 2, true);
export const INT = int('int', 4, false);
export const UINT = int('unsigned int', 4, true);
export const LONG = int('long', 4, false);
export const ULONG = int('unsigned long', 4, true);
export const LLONG = int('long long', 8, false);
export const ULLONG = int('unsigned long long', 8, true);
export const FLOAT = { kind: 'float', name: 'float', size: 4, align: 4 };
export const DOUBLE = { kind: 'float', name: 'double', size: 8, align: 8 };

export const ptr = to => ({ kind: 'ptr', to, size: 4, align: 4 });
export const array = (of, length) => ({ kind: 'array', of, length, size: length === null ? 0 : of.size * length, align: of.align });
export const func = (ret, params, variadic) => ({ kind: 'func', ret, params, variadic, size: 1, align: 1 });

export const isInt = t => t.kind === 'int';
export const isFloat = t => t.kind === 'float';
export const isArith = t => t.kind === 'int' || t.kind === 'float';
export const isPtr = t => t.kind === 'ptr';
export const isScalar = t => isArith(t) || isPtr(t);
export const isRecord = t => t.kind === 'struct' || t.kind === 'union';
// A const-qualified struct is a shallow copy; `base` leads back to the definition that owns the fields.
export const record = t => t.base || t;

export function qualify(t, isConst) {
  if (!isConst || t.const) return t;
  return { ...t, const: true, base: isRecord(t) ? record(t) : undefined };
}

export function typeName(t) {
  const c = t.const ? 'const ' : '';
  switch (t.kind) {
    case 'ptr': return t.to.kind === 'func' ? `${typeName(t.to.ret)} (*)(${paramNames(t.to)})` : `${typeName(t.to)} *${t.const ? 'const' : ''}`;
    case 'array': return `${typeName(t.of)}[${t.length ?? ''}]`;
    case 'struct': case 'union': return `${c}${t.kind} ${record(t).tag || '<anonymous>'}`;
    case 'func': return `${typeName(t.ret)} (${paramNames(t)})`;
    default: return c + t.name;
  }
}
const paramNames = f => f.params.map(p => typeName(p.type)).join(', ') + (f.variadic ? ', ...' : '') || 'void';

export function sameType(a, b) {
  if (a === b) return true;
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'int': return a.size === b.size && a.unsigned === b.unsigned && !!a.bool === !!b.bool;
    case 'float': return a.size === b.size;
    case 'ptr': return sameType(a.to, b.to);
    case 'array': return sameType(a.of, b.of) && (a.length === b.length || a.length === null || b.length === null);
    case 'struct': case 'union': return record(a) === record(b);
    case 'func': return sameType(a.ret, b.ret) && a.params.length === b.params.length && a.params.every((p, i) => sameType(p.type, b.params[i].type));
    default: return true;
  }
}

// Integer promotion: anything narrower than int becomes int.
export function promote(t) {
  if (t.kind === 'int') {
    if (t.size < 4 || t.bool) return INT;
    if (t.size === 4) return t.unsigned ? UINT : INT;
    return t.unsigned ? ULLONG : LLONG;
  }
  if (t.kind === 'float') return t.size === 4 ? FLOAT : DOUBLE;
  return t;
}

// The usual arithmetic conversions.
export function commonType(a, b) {
  if (a.kind === 'float' || b.kind === 'float') {
    return (a.kind === 'float' && a.size === 8) || (b.kind === 'float' && b.size === 8) ? DOUBLE : FLOAT;
  }
  a = promote(a); b = promote(b);
  if (a.size !== b.size) return a.size > b.size ? a : b;
  return a.unsigned ? a : b;
}

export const alignUp = (n, a) => Math.ceil(n / a) * a;

// Lay out a struct or union the way GCC does for a little-endian ARM target.
export function layout(t, members, pack) {
  let bits = 0, end = 0, maxAlign = 1;
  const fields = [];
  const isUnion = t.kind === 'union';
  for (const m of members) {
    const ft = m.type;
    const a = Math.min(ft.align, pack || 16);
    if (m.width !== undefined) {
      const unit = ft.size * 8;
      if (m.width === 0) { bits = alignUp(bits, unit); continue; }
      if (isUnion) bits = 0;
      if (Math.floor(bits / unit) !== Math.floor((bits + m.width - 1) / unit)) bits = alignUp(bits, unit);
      const off = Math.floor(bits / unit) * ft.size;
      if (m.name) fields.push({ name: m.name, type: ft, off, bf: { off: bits % unit, width: m.width } });
      bits += m.width;
      end = Math.max(end, off + ft.size);
      maxAlign = Math.max(maxAlign, a);
      continue;
    }
    const off = isUnion ? 0 : alignUp(Math.ceil(bits / 8), a);
    if (m.name) fields.push({ name: m.name, type: ft, off });
    else for (const f of record(ft).fields) fields.push({ ...f, off: off + f.off }); // anonymous struct/union member
    end = Math.max(end, off + ft.size);
    if (!isUnion) bits = (off + ft.size) * 8;
    maxAlign = Math.max(maxAlign, a);
  }
  t.fields = fields;
  t.align = maxAlign;
  t.size = alignUp(Math.max(end, isUnion ? 0 : Math.ceil(bits / 8)), maxAlign) || 0;
}

// Bring a JS value into the range of a C type.
export function convert(v, to) {
  switch (to.kind) {
    case 'int': {
      if (to.bool) return (typeof v === 'bigint' ? v !== 0n : v !== 0) ? 1 : 0;
      if (to.size === 8) {
        const b = typeof v === 'bigint' ? v : BigInt(Number.isFinite(v) ? Math.trunc(v) : 0);
        return to.unsigned ? BigInt.asUintN(64, b) : BigInt.asIntN(64, b);
      }
      const n = typeof v === 'bigint' ? Number(BigInt.asIntN(32, v)) : Math.trunc(v);
      if (to.size === 4) return to.unsigned ? n >>> 0 : n | 0;
      if (to.size === 2) return to.unsigned ? n & 0xFFFF : (n << 16) >> 16;
      return to.unsigned ? n & 0xFF : (n << 24) >> 24;
    }
    case 'float': {
      const x = Number(v);
      return to.size === 4 ? Math.fround(x) : x;
    }
    case 'ptr': return typeof v === 'bigint' ? Number(BigInt.asUintN(32, v)) : v >>> 0;
    default: return v;
  }
}

const BITS64 = 64;

// Evaluates `a op b` where both operands already have type `t`. Signed overflow wraps, as it does on the target.
export function arith(op, a, b, t) {
  if (t.kind === 'float') {
    const r = op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b : a / b;
    return t.size === 4 ? Math.fround(r) : r;
  }
  if (t.size === 8) {
    let r;
    switch (op) {
      case '+': r = a + b; break;
      case '-': r = a - b; break;
      case '*': r = a * b; break;
      case '/': case '%':
        if (b === 0n) throw new CError('Division by zero');
        r = op === '/' ? a / b : a % b; break;
      case '&': r = a & b; break;
      case '|': r = a | b; break;
      default: r = a ^ b;
    }
    return t.unsigned ? BigInt.asUintN(BITS64, r) : BigInt.asIntN(BITS64, r);
  }
  let r;
  switch (op) {
    case '+': r = a + b; break;
    case '-': r = a - b; break;
    case '*': r = Math.imul(a, b); break;
    case '/': case '%':
      if (b === 0) throw new CError('Division by zero');
      r = op === '/' ? Math.trunc(a / b) : a % b; break;
    case '&': r = a & b; break;
    case '|': r = a | b; break;
    default: r = a ^ b;
  }
  return t.unsigned ? r >>> 0 : r | 0;
}

// Shifting by a negative count, or by the width of the type or more, is undefined behaviour in C.
export function shift(op, a, count, t) {
  const n = Number(count), bits = t.size * 8;
  if (n < 0 || n >= bits) throw new CError(`Shifting a ${bits}-bit value by ${n} is undefined behaviour`);
  if (t.size === 8) {
    const r = op === '<<' ? a << BigInt(n) : a >> BigInt(n);
    return t.unsigned ? BigInt.asUintN(BITS64, r) : BigInt.asIntN(BITS64, r);
  }
  if (op === '<<') return t.unsigned ? (a << n) >>> 0 : a << n;
  return t.unsigned ? a >>> n : a >> n;
}

export function compare(op, a, b) {
  switch (op) {
    case '==': return a === b ? 1 : 0;
    case '!=': return a !== b ? 1 : 0;
    case '<': return a < b ? 1 : 0;
    case '>': return a > b ? 1 : 0;
    case '<=': return a <= b ? 1 : 0;
    default: return a >= b ? 1 : 0;
  }
}
