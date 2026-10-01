// Tokeniser and preprocessor for the C interpreter.
import { CError } from './types.js';

const OPS = ['...', '<<=', '>>=', '->', '++', '--', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '##',
  '{', '}', '(', ')', '[', ']', ';', ',', '?', ':', '+', '-', '*', '/', '%', '=', '<', '>', '!', '~', '&', '|', '^', '.', '#'];
const utf8 = new TextEncoder();
const ESCAPES = { n: 10, t: 9, r: 13, a: 7, b: 8, f: 12, v: 11, '\\': 92, "'": 39, '"': 34, '?': 63 };

export function lex(src, file = null) {
  const out = [];
  let i = 0, line = 1, nl = true, sp = false;
  const push = (k, v, extra) => { out.push({ k, v, line, file, nl, sp, ...extra }); nl = false; sp = false; };
  const fail = msg => { throw new CError(msg, line, file); };

  // Reads one (possibly escaped) character of a string or character literal as a byte value.
  const readChar = () => {
    if (src[i] !== '\\') return src.charCodeAt(i++) & 0xFF;
    i++;
    const c = src[i];
    if (c === 'x') {
      i++; let h = '';
      while (/[0-9a-fA-F]/.test(src[i] || '')) h += src[i++];
      if (!h) fail('\\x needs hex digits');
      return parseInt(h, 16) & 0xFF;
    }
    if (/[0-7]/.test(c)) {
      let o = '';
      while (o.length < 3 && /[0-7]/.test(src[i] || '')) o += src[i++];
      return parseInt(o, 8) & 0xFF;
    }
    i++;
    if (ESCAPES[c] === undefined) fail(`Unknown escape sequence '\\${c}'`);
    return ESCAPES[c];
  };

  while (i < src.length) {
    const c = src[i];
    if (c === '\n') { line++; i++; nl = true; continue; }
    if (c === '\\' && (src[i + 1] === '\n' || (src[i + 1] === '\r' && src[i + 2] === '\n'))) { i += src[i + 1] === '\n' ? 2 : 3; line++; sp = true; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { i++; sp = true; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') {
      const start = line;
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; }
      if (i >= src.length) throw new CError('Unterminated comment', start, file);
      i += 2; sp = true; continue;
    }
    if (c === '"') {
      i++;
      const bytes = [];
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\n') fail('Unterminated string literal');
        if (src.charCodeAt(i) > 127) {
          // Text outside ASCII is stored as UTF-8, one byte per char, as a C compiler would.
          const point = src.codePointAt(i);
          bytes.push(...utf8.encode(String.fromCodePoint(point)));
          i += point > 0xFFFF ? 2 : 1;
        } else bytes.push(readChar());
      }
      if (i >= src.length) fail('Unterminated string literal');
      i++;
      push('str', bytes);
      continue;
    }
    if (c === "'") {
      i++;
      if (src[i] === "'") fail('Empty character constant');
      const v = readChar();
      if (src[i] !== "'") fail('Unterminated character constant');
      i++;
      push('num', BigInt(v > 127 ? v - 256 : v), { isChar: true });
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      const m = /^(0[xX][0-9a-fA-F]+|0[bB][01]+|(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?)([uUlLfF]*)/.exec(src.slice(i, i + 80));
      const [, body, suffix] = m;
      i += m[0].length;
      if (/[A-Za-z0-9_]/.test(src[i] || '')) fail(`Invalid number '${m[0]}${src[i]}'`);
      const isHex = /^0[xXbB]/.test(body);
      const s = suffix.toLowerCase();
      if (!isHex && (/[.eE]/.test(body) || s.includes('f'))) {
        push('num', parseFloat(body), { isFloat: true, single: s.includes('f') });
      } else {
        const isOctal = !isHex && body.length > 1 && body[0] === '0';
        if (isOctal && /[89]/.test(body)) fail(`Invalid octal constant '${body}'`);
        const v = isOctal ? BigInt('0o' + body.slice(1)) : BigInt(body.replace(/^0B/, '0b'));
        push('num', v, { unsigned: s.includes('u'), longs: (s.match(/l/g) || []).length, based: isHex || isOctal });
      }
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let s = '';
      while (i < src.length && /[A-Za-z0-9_]/.test(src[i])) s += src[i++];
      push('id', s);
      continue;
    }
    const op = OPS.find(o => src.startsWith(o, i));
    if (!op) fail(`Unexpected character '${c}'`);
    i += op.length;
    push('op', op);
  }
  out.push({ k: 'eof', v: null, line, file, nl: true, sp: false });
  return out;
}

const spell = t => t.k === 'str' ? JSON.stringify(String.fromCharCode(...t.v)) : String(t.v);

const PREDEFINED = `
#define NULL ((void *)0)
#define true 1
#define false 0
#define CHAR_BIT 8
#define SCHAR_MIN (-128)
#define SCHAR_MAX 127
#define UCHAR_MAX 255
#define CHAR_MIN (-128)
#define CHAR_MAX 127
#define SHRT_MIN (-32768)
#define SHRT_MAX 32767
#define USHRT_MAX 65535
#define INT_MIN (-2147483647 - 1)
#define INT_MAX 2147483647
#define UINT_MAX 4294967295U
#define LONG_MIN (-2147483647L - 1)
#define LONG_MAX 2147483647L
#define ULONG_MAX 4294967295UL
#define LLONG_MIN (-9223372036854775807LL - 1)
#define LLONG_MAX 9223372036854775807LL
#define ULLONG_MAX 18446744073709551615ULL
#define INT8_MIN (-128)
#define INT8_MAX 127
#define UINT8_MAX 255
#define INT16_MIN (-32768)
#define INT16_MAX 32767
#define UINT16_MAX 65535
#define INT32_MIN (-2147483647 - 1)
#define INT32_MAX 2147483647
#define UINT32_MAX 4294967295U
#define INT64_MIN (-9223372036854775807LL - 1)
#define INT64_MAX 9223372036854775807LL
#define UINT64_MAX 18446744073709551615ULL
#define SIZE_MAX 4294967295U
#define UINT8_C(x) (x)
#define UINT16_C(x) (x)
#define UINT32_C(x) (x ## U)
#define UINT64_C(x) (x ## ULL)
#define PRId8 "d"
#define PRIu8 "u"
#define PRIx8 "x"
#define PRIX8 "X"
#define PRId16 "d"
#define PRIu16 "u"
#define PRIx16 "x"
#define PRIX16 "X"
#define PRId32 "d"
#define PRIu32 "u"
#define PRIx32 "x"
#define PRIX32 "X"
#define PRId64 "lld"
#define PRIu64 "llu"
#define PRIx64 "llx"
#define PRIX64 "llX"
#define EXIT_SUCCESS 0
#define EXIT_FAILURE 1
#define assert(c) __assert((c) != 0, #c)
#define offsetof(t, m) __builtin_offsetof(t, m)
#define static_assert _Static_assert
`;

// Runs the preprocessor over a token stream and returns the tokens the parser sees.
export function preprocess(tokens, macros = new Map()) {
  const out = [];
  const conds = []; // { active, taken, parentActive }
  let delta = 0, fileName = tokens[0]?.file ?? null;
  const active = () => conds.length === 0 || conds[conds.length - 1].active;
  const fail = (msg, t) => { throw new CError(msg, t.line, t.file); };

  // Splits the tokens after a macro name into its comma-separated arguments. `i` points at '('.
  function readArgs(toks, i, name, at) {
    const args = [[]];
    let depth = 0;
    for (i++; i < toks.length; i++) {
      const t = toks[i];
      if (t.k === 'eof') break;
      if (t.k === 'op' && (t.v === '(' || t.v === '[' || t.v === '{')) depth++;
      else if (t.k === 'op' && (t.v === ')' || t.v === ']' || t.v === '}')) {
        if (depth === 0) return { args, end: i };
        depth--;
      } else if (t.k === 'op' && t.v === ',' && depth === 0) { args.push([]); continue; }
      args[args.length - 1].push(t);
    }
    fail(`Unterminated call to macro '${name}'`, at);
  }

  function relex(text, at) {
    const toks = lex(text, at.file);
    toks.pop();
    return toks.map(t => ({ ...t, line: at.line, nl: false }));
  }

  function substitute(m, args, at, hide) {
    const body = m.body, params = m.params || [];
    const result = [];
    for (let j = 0; j < body.length; j++) {
      const t = body[j];
      const pi = t.k === 'id' ? params.indexOf(t.v) : -1;
      if (t.k === 'op' && t.v === '#' && body[j + 1]?.k === 'id' && params.includes(body[j + 1].v)) {
        const arg = args[params.indexOf(body[j + 1].v)];
        const text = arg.map((a, n) => (n && a.sp ? ' ' : '') + spell(a)).join('');
        result.push({ k: 'str', v: [...text].map(ch => ch.charCodeAt(0) & 0xFF), line: at.line, file: at.file });
        j++;
        continue;
      }
      const pasted = (body[j + 1]?.k === 'op' && body[j + 1].v === '##') || (body[j - 1]?.k === 'op' && body[j - 1].v === '##');
      if (pi >= 0) result.push(...(pasted ? args[pi] : expand(args[pi], hide)).map(a => ({ ...a, line: at.line, file: at.file })));
      else result.push({ ...t, line: at.line, file: at.file });
    }
    // Token pasting.
    for (let j = 0; j < result.length; j++) {
      if (result[j].k === 'op' && result[j].v === '##' && j > 0 && j + 1 < result.length) {
        const joined = relex(spell(result[j - 1]) + spell(result[j + 1]), at);
        result.splice(j - 1, 3, ...joined);
        j -= 2;
      }
    }
    return result;
  }

  function expand(toks, hide) {
    const res = [];
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      const m = t.k === 'id' && !hide.has(t.v) ? macros.get(t.v) : undefined;
      if (!m) { res.push(t); continue; }
      const inner = new Set(hide).add(t.v);
      if (!m.params) { res.push(...expand(substitute(m, [], t, hide), inner)); continue; }
      if (!(toks[i + 1]?.k === 'op' && toks[i + 1].v === '(')) { res.push(t); continue; }
      const { args, end } = readArgs(toks, i + 1, t.v, t);
      if (m.params.length === 0 && args.length === 1 && args[0].length === 0) args.length = 0;
      if (args.length !== m.params.length) fail(`Macro '${t.v}' takes ${m.params.length} argument${m.params.length === 1 ? '' : 's'}, but ${args.length} were given`, t);
      res.push(...expand(substitute(m, args, t, hide), inner));
      i = end;
    }
    return res;
  }

  // Evaluates the controlling expression of #if / #elif.
  function evalCondition(toks, at) {
    const resolved = [];
    for (let i = 0; i < toks.length; i++) {
      if (toks[i].k === 'id' && toks[i].v === 'defined') {
        const paren = toks[i + 1]?.v === '(';
        const name = toks[i + (paren ? 2 : 1)];
        if (!name || name.k !== 'id') fail("'defined' needs a macro name", at);
        resolved.push({ k: 'num', v: macros.has(name.v) ? 1n : 0n });
        i += paren ? 3 : 1;
      } else resolved.push(toks[i]);
    }
    const ts = expand(resolved, new Set()).map(t => t.k === 'id' ? { k: 'num', v: 0n } : t);
    let p = 0;
    const peek = () => ts[p];
    const isOp = v => peek() && peek().k === 'op' && peek().v === v;
    const PREC = { '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6, '<': 7, '>': 7, '<=': 7, '>=': 7, '<<': 8, '>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10 };
    const unary = () => {
      const t = ts[p++];
      if (!t) fail('#if needs an expression', at);
      if (t.k === 'num') return typeof t.v === 'bigint' ? t.v : BigInt(Math.trunc(t.v));
      if (t.k === 'op' && t.v === '(') { const v = ternary(); if (!isOp(')')) fail("Missing ')' in #if", at); p++; return v; }
      if (t.k === 'op' && t.v === '!') return unary() === 0n ? 1n : 0n;
      if (t.k === 'op' && t.v === '-') return -unary();
      if (t.k === 'op' && t.v === '+') return unary();
      if (t.k === 'op' && t.v === '~') return ~unary();
      fail(`Unexpected '${spell(t)}' in #if`, at);
    };
    const binary = min => {
      let l = unary();
      for (;;) {
        const t = peek();
        const prec = t && t.k === 'op' ? PREC[t.v] : undefined;
        if (prec === undefined || prec < min) return l;
        p++;
        const r = binary(prec + 1);
        switch (t.v) {
          case '||': l = l !== 0n || r !== 0n ? 1n : 0n; break;
          case '&&': l = l !== 0n && r !== 0n ? 1n : 0n; break;
          case '|': l |= r; break; case '^': l ^= r; break; case '&': l &= r; break;
          case '==': l = l === r ? 1n : 0n; break; case '!=': l = l !== r ? 1n : 0n; break;
          case '<': l = l < r ? 1n : 0n; break; case '>': l = l > r ? 1n : 0n; break;
          case '<=': l = l <= r ? 1n : 0n; break; case '>=': l = l >= r ? 1n : 0n; break;
          case '<<': l <<= r; break; case '>>': l >>= r; break;
          case '+': l += r; break; case '-': l -= r; break; case '*': l *= r; break;
          case '/': case '%': if (r === 0n) fail('Division by zero in #if', at); l = t.v === '/' ? l / r : l % r; break;
        }
      }
    };
    const ternary = () => {
      const c = binary(1);
      if (!isOp('?')) return c;
      p++;
      const a = ternary();
      if (!isOp(':')) fail("Missing ':' in #if", at);
      p++;
      const b = ternary();
      return c !== 0n ? a : b;
    };
    return ternary() !== 0n;
  }

  function directive(line, at) {
    const name = line[0]?.v;
    const rest = line.slice(1);
    switch (name) {
      case 'ifdef': case 'ifndef': {
        const parent = active();
        const defined = macros.has(rest[0]?.v);
        const on = parent && (name === 'ifdef' ? defined : !defined);
        conds.push({ active: on, taken: on, parent });
        return;
      }
      case 'if': {
        const parent = active();
        const on = parent && evalCondition(rest, at);
        conds.push({ active: on, taken: on, parent });
        return;
      }
      case 'elif': case 'else': {
        const c = conds[conds.length - 1];
        if (!c) fail(`#${name} without #if`, at);
        const on = c.parent && !c.taken && (name === 'else' || evalCondition(rest, at));
        c.active = on;
        c.taken = c.taken || on;
        return;
      }
      case 'endif':
        if (!conds.pop()) fail('#endif without #if', at);
        return;
    }
    if (!active()) return;
    switch (name) {
      case undefined: case 'include': return;
      case 'define': {
        const id = rest[0];
        if (!id || id.k !== 'id') fail('#define needs a macro name', at);
        let params = null, bodyStart = 1;
        if (rest[1]?.k === 'op' && rest[1].v === '(' && !rest[1].sp) {
          params = [];
          let j = 2;
          while (j < rest.length && !(rest[j].k === 'op' && rest[j].v === ')')) {
            if (rest[j].k === 'id') params.push(rest[j].v);
            else if (rest[j].v === '...') fail('Variadic macros are not supported', at);
            else if (rest[j].v !== ',') fail(`Unexpected '${spell(rest[j])}' in macro parameter list`, at);
            j++;
          }
          if (j >= rest.length) fail("Missing ')' in macro parameter list", at);
          bodyStart = j + 1;
        }
        macros.set(id.v, { params, body: rest.slice(bodyStart) });
        return;
      }
      case 'undef': macros.delete(rest[0]?.v); return;
      case 'error': return fail(`#error ${rest.map(spell).join(' ')}`, at);
      case 'line': {
        if (rest[0]?.k !== 'num') fail('#line needs a line number', at);
        delta = Number(rest[0].v) - (at.rawLine + 1);
        if (rest[1]?.k === 'str') fileName = String.fromCharCode(...rest[1].v);
        return;
      }
      case 'pragma': {
        if (rest[0]?.v !== 'pack') return;
        const nums = rest.filter(t => t.k === 'num').map(t => Number(t.v));
        const words = rest.filter(t => t.k === 'id').map(t => t.v);
        out.push({ k: 'pack', v: nums[0] ?? 0, push: words.includes('push'), pop: words.includes('pop'), line: at.line, file: at.file });
        return;
      }
      default: fail(`Unknown preprocessor directive '#${name}'`, at);
    }
  }

  let pending = [];
  const flush = () => { if (pending.length) { out.push(...expand(pending, new Set())); pending = []; } };

  for (let i = 0; i < tokens.length; i++) {
    const raw = tokens[i];
    const t = { ...raw, rawLine: raw.line, line: raw.line + delta, file: fileName };
    if (t.k === 'eof') {
      flush();
      if (conds.length) fail('Missing #endif', t);
      out.push(t);
      break;
    }
    if (t.k === 'op' && t.v === '#' && t.nl) {
      flush();
      const line = [];
      while (tokens[i + 1].k !== 'eof' && !tokens[i + 1].nl) line.push(tokens[++i]);
      directive(line, t);
      continue;
    }
    if (active()) pending.push(t);
  }
  return out;
}

export function predefinedMacros() {
  const macros = new Map();
  preprocess(lex(PREDEFINED, '<builtin>'), macros);
  return macros;
}
