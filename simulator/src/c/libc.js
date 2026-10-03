// The slice of the C standard library the interpreter provides. PROTOTYPES is parsed ahead of
// every program; BUILTINS implements each function against the machine's memory.
import { CError, Exit, CHAR, SHORT, INT, LLONG, FLOAT, DOUBLE, typeName } from './types.js';

export const PROTOTYPES = `
typedef signed char int8_t;
typedef unsigned char uint8_t;
typedef short int16_t;
typedef unsigned short uint16_t;
typedef int int32_t;
typedef unsigned int uint32_t;
typedef long long int64_t;
typedef unsigned long long uint64_t;
typedef unsigned int size_t;
typedef int ssize_t;
typedef int ptrdiff_t;
typedef int intptr_t;
typedef unsigned int uintptr_t;
typedef long long intmax_t;
typedef unsigned long long uintmax_t;
typedef _Bool bool;
typedef unsigned int va_list;

int printf(const char *format, ...);
int sprintf(char *dest, const char *format, ...);
int snprintf(char *dest, size_t size, const char *format, ...);
int vprintf(const char *format, va_list ap);
int vsprintf(char *dest, const char *format, va_list ap);
int vsnprintf(char *dest, size_t size, const char *format, va_list ap);
int puts(const char *s);
int putchar(int c);
int getchar(void);
char *fgets(char *dest, int size, void *stream);
int scanf(const char *format, ...);
int sscanf(const char *text, const char *format, ...);

void *memcpy(void *dest, const void *src, size_t n);
void *memmove(void *dest, const void *src, size_t n);
void *memset(void *dest, int value, size_t n);
int memcmp(const void *a, const void *b, size_t n);
size_t strlen(const char *s);
char *strcpy(char *dest, const char *src);
char *strncpy(char *dest, const char *src, size_t n);
char *strcat(char *dest, const char *src);
char *strncat(char *dest, const char *src, size_t n);
int strcmp(const char *a, const char *b);
int strncmp(const char *a, const char *b, size_t n);
char *strchr(const char *s, int c);
char *strrchr(const char *s, int c);
char *strstr(const char *haystack, const char *needle);

void *malloc(size_t size);
void *calloc(size_t count, size_t size);
void *realloc(void *p, size_t size);
void free(void *p);
int abs(int x);
long labs(long x);
int atoi(const char *s);
long strtol(const char *s, char **end, int base);
unsigned long strtoul(const char *s, char **end, int base);
int rand(void);
void srand(unsigned int seed);
void exit(int code);
void abort(void);
void __assert(int ok, const char *text);

int isdigit(int c);
int isalpha(int c);
int isalnum(int c);
int isspace(int c);
int isupper(int c);
int islower(int c);
int isxdigit(int c);
int isprint(int c);
int ispunct(int c);
int toupper(int c);
int tolower(int c);

double sqrt(double x);
double fabs(double x);
double pow(double x, double y);
double floor(double x);
double ceil(double x);
double round(double x);
double fmod(double x, double y);
double sin(double x);
double cos(double x);
float sqrtf(float x);
float fabsf(float x);

int __builtin_popcount(unsigned int x);
int __builtin_clz(unsigned int x);
int __builtin_ctz(unsigned int x);
unsigned short __builtin_bswap16(unsigned short x);
unsigned int __builtin_bswap32(unsigned int x);
long __builtin_expect(long value, long expected);
`;

const text = b => String.fromCharCode(...b);
const big = v => (typeof v === 'bigint' ? v : BigInt(Number.isFinite(v) ? Math.trunc(v) : 0));
const LENGTH_BITS = { hh: 8, h: 16, '': 32, l: 32, ll: 64, z: 32, t: 32, j: 64 };

// printf-style formatting. `args` are the values after the format string and `nodes` their typed expressions.
function format(m, fmtAddr, args, nodes) {
  const fmt = m.cstr(fmtAddr);
  let out = '', ai = 0;
  const take = spec => {
    if (ai >= args.length) throw m.fault(`printf: the format needs a value for '${spec}', but no argument is left`);
    return { v: args[ai], type: nodes[ai++].type };
  };
  for (let i = 0; i < fmt.length; i++) {
    if (fmt[i] !== 37) { out += String.fromCharCode(fmt[i]); continue; }
    const start = i++;
    let flags = '';
    while ('-+ 0#'.includes(String.fromCharCode(fmt[i] ?? 0)) && fmt[i] !== undefined) flags += String.fromCharCode(fmt[i++]);
    const number = () => {
      if (fmt[i] === 42) { i++; return Number(take('*').v); }
      let s = '';
      while (fmt[i] >= 48 && fmt[i] <= 57) s += String.fromCharCode(fmt[i++]);
      return s === '' ? null : Number(s);
    };
    let width = number(), precision = null;
    if (width !== null && width < 0) { flags += '-'; width = -width; }
    if (fmt[i] === 46) { i++; precision = number() ?? 0; }
    let length = '';
    while (fmt[i] !== undefined && 'hlzjt'.includes(String.fromCharCode(fmt[i]))) length += String.fromCharCode(fmt[i++]);
    if (fmt[i] === undefined) throw m.fault('printf: the format string ends in the middle of a conversion');
    const conv = String.fromCharCode(fmt[i]);
    const spec = text(fmt.slice(start, i + 1));
    const bits = LENGTH_BITS[length] ?? 32;
    let body = '', sign = '', numeric = true;

    if (conv === '%') { out += '%'; continue; }
    if ('diuxXob'.includes(conv)) {
      const { v, type } = take(spec);
      if (type.kind === 'float') throw m.fault(`printf: '${spec}' expects an integer, but the argument is a ${type.name}`);
      if (type.kind === 'int' && type.size === 8 && bits !== 64) throw m.fault(`printf: '${spec}' expects a 32-bit value, but the argument is 64-bit; use '%ll${conv}'`);
      let n;
      if (conv === 'd' || conv === 'i') {
        n = BigInt.asIntN(bits, big(v));
        if (n < 0n) { sign = '-'; n = -n; } else if (flags.includes('+')) sign = '+'; else if (flags.includes(' ')) sign = ' ';
        body = n.toString();
      } else {
        n = BigInt.asUintN(bits, big(v));
        const base = conv === 'u' ? 10 : conv === 'o' ? 8 : conv === 'b' ? 2 : 16;
        body = n.toString(base);
        if (conv === 'X') body = body.toUpperCase();
        if (flags.includes('#') && n !== 0n) sign = conv === 'x' ? '0x' : conv === 'X' ? '0X' : conv === 'b' ? '0b' : conv === 'o' ? '0' : '';
      }
      if (precision !== null) body = precision === 0 && n === 0n ? '' : body.padStart(precision, '0');
    } else if ('fFeEgG'.includes(conv)) {
      const { v, type } = take(spec);
      if (type.kind !== 'float') throw m.fault(`printf: '${spec}' expects a floating-point value, but the argument is '${type.kind === 'ptr' ? 'a pointer' : type.name}'; cast it to double`);
      let x = Number(v);
      if (x < 0 || Object.is(x, -0)) { sign = '-'; x = -x; } else if (flags.includes('+')) sign = '+'; else if (flags.includes(' ')) sign = ' ';
      const p = precision ?? 6;
      if (!Number.isFinite(x)) body = Number.isNaN(x) ? 'nan' : 'inf';
      else if (conv === 'f' || conv === 'F') body = fixed(x, p);
      else if (conv === 'e' || conv === 'E') body = x.toExponential(p).replace(/e([+-])(\d)$/, 'e$10$2');
      else {
        const exp = x === 0 ? 0 : Math.floor(Math.log10(x));
        const digits = p === 0 ? 1 : p;
        body = exp < -4 || exp >= digits ? x.toExponential(digits - 1).replace(/e([+-])(\d)$/, 'e$10$2') : x.toFixed(Math.max(0, digits - 1 - exp));
        if (!flags.includes('#') && body.includes('.')) body = body.replace(/\.?0+(e|$)/, '$1');
      }
      if (conv === 'E' || conv === 'G') body = body.toUpperCase();
    } else if (conv === 'c') {
      body = String.fromCharCode(Number(take(spec).v) & 0xFF);
      numeric = false;
    } else if (conv === 's') {
      const { v, type } = take(spec);
      if (type.kind !== 'ptr') throw m.fault(`printf: '%s' expects a string (char *), but the argument is '${type.name}'`);
      body = v === 0 ? '(null)' : text(precision === null ? m.cstr(v) : cstrn(m, v, precision));
      numeric = false;
    } else if (conv === 'p') {
      body = '0x' + (Number(take(spec).v) >>> 0).toString(16);
      numeric = false;
    } else throw m.fault(`printf: unknown conversion '${spec}'`);

    const total = sign.length + body.length;
    if (width !== null && total < width) {
      if (flags.includes('-')) out += sign + body + ' '.repeat(width - total);
      else if (flags.includes('0') && numeric && !('diuxXob'.includes(conv) && precision !== null)) out += sign + '0'.repeat(width - total) + body;
      else out += ' '.repeat(width - total) + sign + body;
    } else out += sign + body;
  }
  return out;
}

// At most `n` bytes of a string that need not be NUL-terminated within them.
function cstrn(m, addr, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const b = m.byteAt(addr + i, 1, addr + i);
    if (b === 0) break;
    out.push(b);
  }
  return out;
}

// toFixed that rounds exact ties to even, as C's printf does.
function fixed(x, p) {
  const extra = Math.min(100, p + 40);
  const long = x.toFixed(extra);
  const cut = long.length - (extra - p);
  if (!/^50*$/.test(long.slice(cut))) return x.toFixed(p);
  const head = long.slice(0, cut).replace(/\.$/, '');
  return '02468'.includes(head[head.length - 1]) ? head : x.toFixed(p);
}

const latin1 = s => Uint8Array.from(s, c => c.charCodeAt(0) & 0xFF);

function parseInteger(m, addr, endPtr, base, unsigned) {
  const s = m.cstr(addr);
  let i = 0;
  while (s[i] === 32 || (s[i] >= 9 && s[i] <= 13)) i++;
  let negative = false;
  if (s[i] === 43 || s[i] === 45) negative = s[i++] === 45;
  const isHexPrefix = s[i] === 48 && (s[i + 1] === 120 || s[i + 1] === 88);
  if ((base === 0 || base === 16) && isHexPrefix) { base = 16; i += 2; }
  else if (base === 0) base = s[i] === 48 ? 8 : 10;
  let n = 0n, any = false;
  for (; i < s.length; i++) {
    const c = s[i];
    const d = c >= 48 && c <= 57 ? c - 48 : c >= 97 && c <= 122 ? c - 87 : c >= 65 && c <= 90 ? c - 55 : 99;
    if (d >= base) break;
    n = n * BigInt(base) + BigInt(d);
    any = true;
  }
  if (endPtr) m.store(endPtr, { kind: 'ptr', size: 4 }, any ? addr + i : addr);
  if (negative) n = -n;
  if (unsigned) return Number(BigInt.asUintN(32, n > 0xFFFFFFFFn ? 0xFFFFFFFFn : n));
  const clamped = n > 0x7FFFFFFFn ? 0x7FFFFFFFn : n < -0x80000000n ? -0x80000000n : n;
  return Number(clamped);
}

// printf for a va_list: formats the arguments its owner has not consumed yet.
function vformat(m, fmtAddr, handle, what) {
  const list = m.vaList(handle, what);
  const rest = list.args.slice(list.pos);
  return format(m, fmtAddr, rest.map(x => x.v), rest);
}

const isSpace = c => c === 32 || (c >= 9 && c <= 13);
const SCAN_INT = { hh: CHAR, h: SHORT, '': INT, l: INT, ll: LLONG, z: INT, t: INT, j: LLONG };

// scanf-style parsing of `src` ({ bytes, pos }). Returns how many values were stored, or EOF (-1)
// when the input ran out before the first one.
function scan(m, src, fmtAddr, args, nodes, what) {
  const fmt = m.cstr(fmtAddr);
  const { bytes } = src;
  let stored = 0, ai = 0;
  const skipSpace = () => { while (src.pos < bytes.length && isSpace(bytes[src.pos])) src.pos++; };
  // Where the next value goes, after checking that the pointer is to an object of the size being written.
  const target = (spec, type) => {
    if (ai >= args.length) throw m.fault(`${what}: the format needs a pointer for '${spec}', but no argument is left`);
    const node = nodes[ai], addr = args[ai++];
    if (node.type.kind !== 'ptr') throw m.fault(`${what}: '${spec}' needs a pointer to store into, but the argument is '${typeName(node.type)}'; did you forget '&'?`);
    const to = node.type.to;
    if (type && to.kind !== 'void' && to.size !== type.size) {
      throw m.fault(`${what}: '${spec}' stores ${type.size} byte${type.size === 1 ? '' : 's'}, but the argument points to '${typeName(to)}', which is ${to.size}`);
    }
    return addr;
  };
  for (let i = 0; i < fmt.length; i++) {
    if (isSpace(fmt[i])) { skipSpace(); continue; }
    if (fmt[i] !== 37) {
      if (bytes[src.pos] !== fmt[i]) break;
      src.pos++;
      continue;
    }
    const start = i++;
    const suppress = fmt[i] === 42;
    if (suppress) i++;
    let width = '';
    while (fmt[i] >= 48 && fmt[i] <= 57) width += String.fromCharCode(fmt[i++]);
    const limit = width === '' ? Infinity : Number(width);
    let length = '';
    while (fmt[i] !== undefined && 'hlzjt'.includes(String.fromCharCode(fmt[i]))) length += String.fromCharCode(fmt[i++]);
    if (fmt[i] === undefined) throw m.fault(`${what}: the format string ends in the middle of a conversion`);
    const conv = String.fromCharCode(fmt[i]);
    const spec = text(fmt.slice(start, i + 1));
    if (conv === '%') {
      skipSpace();
      if (bytes[src.pos] !== 37) break;
      src.pos++;
      continue;
    }
    if (conv === 'c') {
      const n = width === '' ? 1 : limit;
      if (src.pos + n > bytes.length) { if (!stored && src.pos >= bytes.length) return -1; break; }
      if (!suppress) { m.writeBytes(target(spec, null), bytes.slice(src.pos, src.pos + n)); stored++; }
      src.pos += n;
      continue;
    }
    skipSpace();
    if (src.pos >= bytes.length) return stored || -1;
    const from = src.pos;
    const take = ok => { while (src.pos < bytes.length && src.pos - from < limit && ok(bytes[src.pos])) src.pos++; };
    const digit = base => c => (c >= 48 && c <= 57 ? c - 48 : (c | 32) >= 97 && (c | 32) <= 122 ? (c | 32) - 87 : 99) < base;
    if (conv === 's') {
      take(c => !isSpace(c));
      if (!suppress) { m.writeBytes(target(spec, null), Uint8Array.from([...bytes.slice(from, src.pos), 0])); stored++; }
    } else if ('diuxXo'.includes(conv)) {
      const type = SCAN_INT[length];
      if (!type) throw m.fault(`${what}: unknown conversion '${spec}'`);
      let negative = false;
      if (src.pos - from < limit && (bytes[src.pos] === 43 || bytes[src.pos] === 45)) negative = bytes[src.pos++] === 45;
      let base = conv === 'o' ? 8 : conv === 'x' || conv === 'X' ? 16 : 10;
      const hexPrefix = bytes[src.pos] === 48 && (bytes[src.pos + 1] | 32) === 120 && digit(16)(bytes[src.pos + 2]);
      if ((base === 16 || conv === 'i') && hexPrefix) { src.pos += 2; base = 16; }
      else if (conv === 'i' && bytes[src.pos] === 48) base = 8;
      const digits = src.pos;
      take(digit(base));
      if (src.pos === digits) { src.pos = from; break; }
      let value = BigInt((base === 16 ? '0x' : base === 8 ? '0o' : '') + text(bytes.slice(digits, src.pos)));
      if (negative) value = -value;
      if (!suppress) { m.store(target(spec, type), type, type.size === 8 ? BigInt.asIntN(64, value) : Number(BigInt.asIntN(32, value))); stored++; }
    } else if ('fFeEgG'.includes(conv)) {
      const type = length === 'l' ? DOUBLE : FLOAT;
      const match = /^[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/.exec(text(bytes.slice(from, Math.min(bytes.length, from + Math.min(limit, 64)))));
      if (!match) break;
      src.pos = from + match[0].length;
      if (!suppress) { m.store(target(spec, type), type, type.size === 4 ? Math.fround(parseFloat(match[0])) : parseFloat(match[0])); stored++; }
    } else throw m.fault(`${what}: the conversion '${spec}' is not supported here`);
  }
  return stored;
}

const inRange = (c, lo, hi) => c >= lo && c <= hi;
const flag = b => (b ? 1 : 0);

export const BUILTINS = {
  printf(m, a, n) { const s = format(m, a[0], a.slice(1), n.slice(1)); m.write(s); return s.length; },
  sprintf(m, a, n) {
    const s = format(m, a[1], a.slice(2), n.slice(2));
    m.writeBytes(a[0], latin1(s + '\0'));
    return s.length;
  },
  snprintf(m, a, n) {
    const s = format(m, a[2], a.slice(3), n.slice(3));
    if (a[1] > 0) m.writeBytes(a[0], latin1(s.slice(0, a[1] - 1) + '\0'));
    return s.length;
  },
  vprintf(m, a) { const s = vformat(m, a[0], a[1], 'vprintf'); m.write(s); return s.length; },
  vsprintf(m, a) {
    const s = vformat(m, a[1], a[2], 'vsprintf');
    m.writeBytes(a[0], latin1(s + '\0'));
    return s.length;
  },
  vsnprintf(m, a) {
    const s = vformat(m, a[2], a[3], 'vsnprintf');
    if (a[1] > 0) m.writeBytes(a[0], latin1(s.slice(0, a[1] - 1) + '\0'));
    return s.length;
  },
  puts(m, a) { m.write(text(m.cstr(a[0])) + '\n'); return 1; },
  getchar(m) { return m.inputPos < m.input.length ? m.input[m.inputPos++] : -1; },
  fgets(m, a) {
    const [dest, size] = a;
    if (size <= 0 || m.inputPos >= m.input.length) return 0;
    const line = [];
    while (line.length < size - 1 && m.inputPos < m.input.length) {
      const c = m.input[m.inputPos++];
      line.push(c);
      if (c === 10) break;
    }
    m.writeBytes(dest, Uint8Array.from([...line, 0]));
    return dest;
  },
  scanf(m, a, n) {
    const src = { bytes: m.input, pos: m.inputPos };
    const count = scan(m, src, a[0], a.slice(1), n.slice(1), 'scanf');
    m.inputPos = src.pos;
    return count;
  },
  sscanf(m, a, n) { return scan(m, { bytes: Uint8Array.from(m.cstr(a[0])), pos: 0 }, a[1], a.slice(2), n.slice(2), 'sscanf'); },
  putchar(m, a) { m.write(String.fromCharCode(a[0] & 0xFF)); return a[0] & 0xFF; },

  memcpy(m, a) {
    const [dst, src, n] = a;
    if (n > 0 && dst < src + n && src < dst + n && dst !== src) throw m.fault('memcpy: the source and destination overlap, which is undefined behaviour; use memmove');
    m.copy(dst, src, n);
    return dst;
  },
  memmove(m, a) { m.copy(a[0], a[1], a[2]); return a[0]; },
  memset(m, a) { m.writeBytes(a[0], new Uint8Array(a[2]).fill(a[1] & 0xFF)); return a[0]; },
  memcmp(m, a) {
    const x = m.readBytes(a[0], a[2]), y = m.readBytes(a[1], a[2]);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
    return 0;
  },
  strlen(m, a) { return m.cstr(a[0]).length; },
  strcpy(m, a) { m.writeBytes(a[0], Uint8Array.from([...m.cstr(a[1]), 0])); return a[0]; },
  strncpy(m, a) {
    const src = cstrn(m, a[1], a[2]);
    const out = new Uint8Array(a[2]);
    out.set(src);
    m.writeBytes(a[0], out);
    return a[0];
  },
  strcat(m, a) { m.writeBytes(a[0] + m.cstr(a[0]).length, Uint8Array.from([...m.cstr(a[1]), 0])); return a[0]; },
  strncat(m, a) { m.writeBytes(a[0] + m.cstr(a[0]).length, Uint8Array.from([...cstrn(m, a[1], a[2]), 0])); return a[0]; },
  strcmp(m, a) {
    for (let i = 0; ; i++) {
      const x = m.byteAt(a[0] + i, 1, a[0] + i), y = m.byteAt(a[1] + i, 1, a[1] + i);
      if (x !== y || x === 0) return x - y;
    }
  },
  strncmp(m, a) {
    for (let i = 0; i < a[2]; i++) {
      const x = m.byteAt(a[0] + i, 1, a[0] + i), y = m.byteAt(a[1] + i, 1, a[1] + i);
      if (x !== y || x === 0) return x - y;
    }
    return 0;
  },
  strchr(m, a) {
    const s = m.cstr(a[0]), c = a[1] & 0xFF;
    const i = c === 0 ? s.length : s.indexOf(c);
    return i < 0 ? 0 : a[0] + i;
  },
  strrchr(m, a) {
    const s = m.cstr(a[0]), c = a[1] & 0xFF;
    const i = c === 0 ? s.length : s.lastIndexOf(c);
    return i < 0 ? 0 : a[0] + i;
  },
  strstr(m, a) {
    const i = text(m.cstr(a[0])).indexOf(text(m.cstr(a[1])));
    return i < 0 ? 0 : a[0] + i;
  },

  malloc(m, a) { return m.malloc(a[0]); },
  calloc(m, a) {
    const n = a[0] * a[1];
    const p = m.malloc(n);
    if (p) m.writeBytes(p, new Uint8Array(n));
    return p;
  },
  realloc(m, a) {
    if (a[0] === 0) return m.malloc(a[1]);
    const old = m.blocks.get(a[0]);
    if (!old || old.free) throw m.fault('realloc() of a pointer that is not a live allocation');
    const p = m.malloc(a[1]);
    if (!p) return 0;
    m.copy(p, a[0], Math.min(old.size, a[1]));
    m.free(a[0]);
    return p;
  },
  free(m, a) { m.free(a[0]); return 0; },
  abs(m, a) { return Math.abs(a[0]) | 0; },
  labs(m, a) { return Math.abs(a[0]) | 0; },
  atoi(m, a) { return parseInteger(m, a[0], 0, 10, false); },
  strtol(m, a) { return parseInteger(m, a[0], a[1], a[2], false); },
  strtoul(m, a) { return parseInteger(m, a[0], a[1], a[2], true); },
  rand(m) { m.rand = (Math.imul(m.rand, 1103515245) + 12345) >>> 0; return (m.rand >>> 16) & 0x7FFF; },
  srand(m, a) { m.rand = a[0] >>> 0; return 0; },
  exit(m, a) { throw new Exit(a[0] | 0); },
  abort(m) { throw m.fault('abort() was called'); },
  __assert(m, a) {
    if (!a[0]) throw new CError(`Assertion failed: ${text(m.cstr(a[1]))}`, m.line, m.file);
    return 0;
  },

  isdigit: (m, a) => flag(inRange(a[0], 48, 57)),
  isalpha: (m, a) => flag(inRange(a[0] | 32, 97, 122)),
  isalnum: (m, a) => flag(inRange(a[0], 48, 57) || inRange(a[0] | 32, 97, 122)),
  isspace: (m, a) => flag(a[0] === 32 || inRange(a[0], 9, 13)),
  isupper: (m, a) => flag(inRange(a[0], 65, 90)),
  islower: (m, a) => flag(inRange(a[0], 97, 122)),
  isxdigit: (m, a) => flag(inRange(a[0], 48, 57) || inRange(a[0] | 32, 97, 102)),
  isprint: (m, a) => flag(inRange(a[0], 32, 126)),
  ispunct: (m, a) => flag(inRange(a[0], 33, 126) && !inRange(a[0], 48, 57) && !inRange(a[0] | 32, 97, 122)),
  toupper: (m, a) => (inRange(a[0], 97, 122) ? a[0] - 32 : a[0]),
  tolower: (m, a) => (inRange(a[0], 65, 90) ? a[0] + 32 : a[0]),

  sqrt: (m, a) => Math.sqrt(a[0]),
  fabs: (m, a) => Math.abs(a[0]),
  pow: (m, a) => Math.pow(a[0], a[1]),
  floor: (m, a) => Math.floor(a[0]),
  ceil: (m, a) => Math.ceil(a[0]),
  round: (m, a) => Math.sign(a[0]) * Math.round(Math.abs(a[0])),
  fmod: (m, a) => a[0] % a[1],
  sin: (m, a) => Math.sin(a[0]),
  cos: (m, a) => Math.cos(a[0]),
  sqrtf: (m, a) => Math.fround(Math.sqrt(a[0])),
  fabsf: (m, a) => Math.fround(Math.abs(a[0])),

  // The GCC and Clang bit builtins that firmware commonly uses.
  __builtin_popcount(m, a) { let n = 0; for (let x = a[0] >>> 0; x; x &= x - 1) n++; return n; },
  __builtin_clz(m, a) {
    if (a[0] === 0) throw m.fault('__builtin_clz(0) is undefined');
    return Math.clz32(a[0]);
  },
  __builtin_ctz(m, a) {
    if (a[0] === 0) throw m.fault('__builtin_ctz(0) is undefined');
    return 31 - Math.clz32(a[0] & -a[0]);
  },
  __builtin_bswap16: (m, a) => ((a[0] & 0xFF) << 8) | ((a[0] >> 8) & 0xFF),
  __builtin_bswap32: (m, a) => (((a[0] & 0xFF) << 24) | ((a[0] & 0xFF00) << 8) | ((a[0] >>> 8) & 0xFF00) | (a[0] >>> 24)) >>> 0,
  __builtin_expect: (m, a) => a[0],
};
