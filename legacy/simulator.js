const SL = (() => {
const KEYWORDS = new Set(['if','else','for','while','do','return','break','continue','switch','case','default','sizeof']);
const TYPES = new Set(['void','int','long','float','double','char','bool','boolean','byte','unsigned','signed','const','static','volatile','String','word','uint8_t','int8_t','uint16_t','int16_t','uint32_t','int32_t','size_t','Servo']);
const OPS = ['<<=','>>=','&&','||','==','!=','<=','>=','++','--','+=','-=','*=','/=','%=','&=','|=','^=','<<','>>','->','::','{','}','(',')','[',']',';',',','?',':','+','-','*','/','%','=','<','>','!','~','&','|','^','.'];

class CompileError extends Error {
  constructor(msg, line) { super(msg); this.line = line; }
}

function lex(src) {
  const out = []; let i = 0, line = 1;
  const push = (type, value) => out.push({ type, value, line });
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; }
      i += 2; continue;
    }
    if (c === '#') {
      let d = ''; while (i < src.length && src[i] !== '\n') d += src[i++];
      push('directive', d.trim()); continue;
    }
    if (c === '"') {
      i++; let s = '';
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\') { s += unescapeChar(src[i + 1]); i += 2; }
        else s += src[i++];
      }
      i++; push('string', s); continue;
    }
    if (c === "'") {
      i++; let ch;
      if (src[i] === '\\') { ch = unescapeChar(src[i + 1]); i += 2; } else ch = src[i++];
      if (src[i] === "'") i++;
      push('number', ch.charCodeAt(0)); continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      let s = '';
      if (c === '0' && /[xXbB]/.test(src[i + 1] || '')) {
        const base = /[xX]/.test(src[i + 1]) ? 16 : 2;
        i += 2; let digits = '';
        while (i < src.length && /[0-9a-fA-F]/.test(src[i])) digits += src[i++];
        while (i < src.length && /[uUlL]/.test(src[i])) i++;
        push('number', parseInt(digits, base) || 0); continue;
      }
      while (i < src.length && /[0-9.eE]/.test(src[i])) {
        if (/[eE]/.test(src[i]) && !/[0-9+\-]/.test(src[i + 1] || '')) break;
        s += src[i++];
        if (/[eE]/.test(s[s.length - 1]) && /[+\-]/.test(src[i] || '')) s += src[i++];
      }
      while (i < src.length && /[uUlLfF]/.test(src[i])) i++;
      push('number', parseFloat(s)); continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let s = '';
      while (i < src.length && /[A-Za-z0-9_]/.test(src[i])) s += src[i++];
      if (KEYWORDS.has(s)) push('keyword', s);
      else if (s === 'true') push('number', 1);
      else if (s === 'false') push('number', 0);
      else if (TYPES.has(s)) push('type', s);
      else push('ident', s);
      continue;
    }
    const op = OPS.find(o => src.startsWith(o, i));
    if (op) { i += op.length; push('op', op); continue; }
    throw new CompileError(`Unexpected character '${c}'`, line);
  }
  push('eof', null);
  return out;
}

function unescapeChar(c) {
  return ({ n: '\n', t: '\t', r: '\r', '0': '\0', '\\': '\\', '"': '"', "'": "'" })[c] ?? c;
}

const BIN_PREC = {
  '||': 3, '&&': 4, '|': 5, '^': 6, '&': 7,
  '==': 8, '!=': 8, '<': 9, '>': 9, '<=': 9, '>=': 9,
  '<<': 10, '>>': 10, '+': 11, '-': 11, '*': 12, '/': 12, '%': 12,
};
const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=']);

function parse(src) {
  const tk = lex(src);
  let p = 0;
  const peek = (n = 0) => tk[p + n];
  const at = (type, value) => peek().type === type && (value === undefined || peek().value === value);
  const next = () => tk[p++];
  const expect = (type, value) => {
    if (!at(type, value)) throw new CompileError(`Expected ${value || type} but found '${peek().value ?? 'end of file'}'`, peek().line);
    return next();
  };
  const eat = (type, value) => { if (at(type, value)) { next(); return true; } return false; };

  const functions = Object.create(null);
  const globals = [];
  const includes = [];

  function parseType() {
    let name = null;
    while (at('type')) {
      const v = next().value;
      if (!['const', 'static', 'volatile', 'unsigned', 'signed'].includes(v)) name = v;
      else if (v === 'unsigned' && !at('type')) name = 'int';
    }
    while (eat('op', '*')) { }
    return name || 'int';
  }

  function parseVarDecl(typeName, line) {
    const decls = [];
    do {
      const id = expect('ident').value;
      let size = null, init = null;
      if (eat('op', '[')) {
        if (!at('op', ']')) size = parseExpr();
        expect('op', ']');
        if (eat('op', '=')) {
          expect('op', '{');
          init = { kind: 'ArrayLit', items: [] };
          if (!at('op', '}')) do { init.items.push(parseExpr()); } while (eat('op', ','));
          expect('op', '}');
        }
        decls.push({ kind: 'VarDecl', type: typeName, name: id, array: true, size, init, line });
        continue;
      }
      if (eat('op', '=')) init = parseExpr();
      decls.push({ kind: 'VarDecl', type: typeName, name: id, init, line });
    } while (eat('op', ','));
    expect('op', ';');
    return decls.length === 1 ? decls[0] : { kind: 'Multi', body: decls, line };
  }

  function parseBlock() {
    const line = peek().line;
    expect('op', '{');
    const body = [];
    while (!at('op', '}')) {
      if (at('eof')) throw new CompileError('Missing closing brace', line);
      body.push(parseStatement());
    }
    expect('op', '}');
    return { kind: 'Block', body, line };
  }

  function parseStatement() {
    const t = peek(); const line = t.line;
    if (t.type === 'directive') { next(); return { kind: 'Empty', line }; }
    if (at('op', '{')) return parseBlock();
    if (at('op', ';')) { next(); return { kind: 'Empty', line }; }
    if (t.type === 'type' || (t.type === 'ident' && peek(1).type === 'ident')) {
      const typeName = t.type === 'type' ? parseType() : next().value;
      return parseVarDecl(typeName, line);
    }
    if (t.type === 'keyword') {
      switch (t.value) {
        case 'if': {
          next(); expect('op', '('); const test = parseExpr(); expect('op', ')');
          const cons = parseStatement();
          let alt = null;
          if (at('keyword', 'else')) { next(); alt = parseStatement(); }
          return { kind: 'If', test, cons, alt, line };
        }
        case 'while': {
          next(); expect('op', '('); const test = parseExpr(); expect('op', ')');
          return { kind: 'While', test, body: parseStatement(), line };
        }
        case 'do': {
          next(); const body = parseStatement();
          expect('keyword', 'while'); expect('op', '('); const test = parseExpr(); expect('op', ')'); expect('op', ';');
          return { kind: 'DoWhile', test, body, line };
        }
        case 'for': {
          next(); expect('op', '(');
          let init = null;
          if (!at('op', ';')) {
            if (at('type') || (at('ident') && peek(1).type === 'ident')) {
              const typeName = at('type') ? parseType() : next().value;
              init = parseVarDecl(typeName, line);
            } else { init = { kind: 'ExprStmt', expr: parseExpr(), line }; expect('op', ';'); }
          } else next();
          const test = at('op', ';') ? null : parseExpr(); expect('op', ';');
          const update = at('op', ')') ? null : parseExpr(); expect('op', ')');
          return { kind: 'For', init, test, update, body: parseStatement(), line };
        }
        case 'return': {
          next();
          const arg = at('op', ';') ? null : parseExpr();
          expect('op', ';');
          return { kind: 'Return', arg, line };
        }
        case 'break': next(); expect('op', ';'); return { kind: 'Break', line };
        case 'continue': next(); expect('op', ';'); return { kind: 'Continue', line };
        case 'switch': {
          next(); expect('op', '('); const disc = parseExpr(); expect('op', ')'); expect('op', '{');
          const cases = [];
          while (!at('op', '}')) {
            let test = null;
            if (at('keyword', 'case')) { next(); test = parseExpr(); expect('op', ':'); }
            else { expect('keyword', 'default'); expect('op', ':'); }
            const body = [];
            while (!at('op', '}') && !at('keyword', 'case') && !at('keyword', 'default')) body.push(parseStatement());
            cases.push({ test, body });
          }
          expect('op', '}');
          return { kind: 'Switch', disc, cases, line };
        }
      }
    }
    const expr = parseExpr();
    expect('op', ';');
    return { kind: 'ExprStmt', expr, line };
  }

  function parseExpr() { return parseAssign(); }

  function parseAssign() {
    const left = parseTernary();
    if (at('op') && ASSIGN_OPS.has(peek().value)) {
      const op = next().value;
      const right = parseAssign();
      return { kind: 'Assign', op, target: left, value: right, line: left.line };
    }
    return left;
  }

  function parseTernary() {
    const test = parseBinary(0);
    if (eat('op', '?')) {
      const cons = parseAssign(); expect('op', ':');
      const alt = parseAssign();
      return { kind: 'Ternary', test, cons, alt, line: test.line };
    }
    return test;
  }

  function parseBinary(minPrec) {
    let left = parseUnary();
    for (;;) {
      const t = peek();
      if (t.type !== 'op') break;
      const prec = BIN_PREC[t.value];
      if (prec === undefined || prec < minPrec) break;
      next();
      const right = parseBinary(prec + 1);
      left = { kind: 'Binary', op: t.value, left, right, line: t.line };
    }
    return left;
  }

  function parseUnary() {
    const t = peek();
    if (t.type === 'op' && ['-', '!', '~', '+', '++', '--', '&', '*'].includes(t.value)) {
      next();
      if (t.value === '++' || t.value === '--') {
        const arg = parseUnary();
        return { kind: 'Update', op: t.value, prefix: true, target: arg, line: t.line };
      }
      const arg = parseUnary();
      if (t.value === '&' || t.value === '*' || t.value === '+') return arg;
      return { kind: 'Unary', op: t.value, arg, line: t.line };
    }
    if (t.type === 'op' && t.value === '(' && (peek(1).type === 'type') && peek(2).type === 'op' && peek(2).value === ')') {
      next(); const castType = next().value; next();
      return { kind: 'Cast', to: castType, arg: parseUnary(), line: t.line };
    }
    return parsePostfix();
  }

  function parsePostfix() {
    let node = parsePrimary();
    for (;;) {
      if (at('op', '(')) {
        next();
        const args = [];
        if (!at('op', ')')) do { args.push(parseExpr()); } while (eat('op', ','));
        expect('op', ')');
        node = { kind: 'Call', callee: node, args, line: node.line };
      } else if (at('op', '[')) {
        next(); const index = parseExpr(); expect('op', ']');
        node = { kind: 'Index', object: node, index, line: node.line };
      } else if (at('op', '.') || at('op', '->')) {
        next(); const prop = expect('ident').value;
        node = { kind: 'Member', object: node, prop, line: node.line };
      } else if (at('op', '++') || at('op', '--')) {
        const op = next().value;
        node = { kind: 'Update', op, prefix: false, target: node, line: node.line };
      } else break;
    }
    return node;
  }

  function parsePrimary() {
    const t = peek();
    if (t.type === 'number') { next(); return { kind: 'Num', value: t.value, line: t.line }; }
    if (t.type === 'string') { next(); return { kind: 'Str', value: t.value, line: t.line }; }
    if (t.type === 'ident') { next(); return { kind: 'Ident', name: t.value, line: t.line }; }
    if (t.type === 'type') { next(); return { kind: 'Ident', name: t.value, line: t.line }; }
    if (at('op', '(')) { next(); const e = parseExpr(); expect('op', ')'); return e; }
    throw new CompileError(`Unexpected token '${t.value ?? 'end of file'}'`, t.line);
  }

  while (!at('eof')) {
    if (peek().type === 'directive') { includes.push(next().value); continue; }
    if (at('op', ';')) { next(); continue; }
    const line = peek().line;
    if (!at('type') && !(at('ident') && peek(1).type === 'ident')) {
      globals.push(parseStatement());
      continue;
    }
    const typeName = at('type') ? parseType() : next().value;
    const nameTok = expect('ident');
    if (at('op', '(')) {
      next();
      const params = [];
      if (!at('op', ')')) {
        do {
          const ptype = at('type') ? parseType() : next().value;
          const pname = at('ident') ? next().value : '_';
          if (eat('op', '[')) expect('op', ']');
          params.push({ type: ptype, name: pname });
        } while (eat('op', ','));
      }
      expect('op', ')');
      if (eat('op', ';')) continue;
      const body = parseBlock();
      functions[nameTok.value] = { name: nameTok.value, params, body, returns: typeName, line };
    } else {
      p--;
      globals.push(parseVarDecl(typeName, line));
    }
  }
  return { functions, globals, includes };
}

class Env {
  constructor(parent) { this.vars = new Map(); this.parent = parent; }
  lookup(name) {
    let e = this;
    while (e) { if (e.vars.has(name)) return e.vars.get(name); e = e.parent; }
    return undefined;
  }
  has(name) { let e = this; while (e) { if (e.vars.has(name)) return true; e = e.parent; } return false; }
  define(name, cell) { this.vars.set(name, cell); }
  setCell(name, cell) { this.vars.set(name, cell); }
}

const INT_TYPES = new Set(['int', 'long', 'byte', 'word', 'uint8_t', 'int8_t', 'uint16_t', 'int16_t', 'uint32_t', 'int32_t', 'size_t', 'bool', 'boolean', 'char']);

function coerce(type, v) {
  if (typeof v === 'string' || v === null || typeof v === 'object') return v;
  if (INT_TYPES.has(type)) {
    if (type === 'bool' || type === 'boolean') return v ? 1 : 0;
    let n = Math.trunc(Number(v) || 0);
    if (type === 'byte' || type === 'uint8_t') n = ((n % 256) + 256) % 256;
    if (type === 'char' || type === 'int8_t') { n = ((n % 256) + 256) % 256; if (n > 127) n -= 256; }
    if (type === 'int' || type === 'int16_t') { n = ((n % 65536) + 65536) % 65536; if (n > 32767) n -= 65536; }
    if (type === 'word' || type === 'uint16_t') n = ((n % 65536) + 65536) % 65536;
    if (type === 'uint32_t') n = n >>> 0;
    return n;
  }
  return Number(v) || 0;
}

const SIGNAL_RETURN = 'return', SIGNAL_BREAK = 'break', SIGNAL_CONTINUE = 'continue';

class Runtime {
  constructor(board, io) {
    this.board = board;
    this.io = io;
    this.micros = 0;
    this.globalEnv = new Env(null);
    this.program = null;
    this.ops = 0;
    this.interrupts = new Map();
    this.servos = [];
  }

  reset(program) {
    this.program = program;
    this.micros = 0;
    this.ops = 0;
    this.globalEnv = new Env(null);
    this.interrupts.clear();
    this.servos = [];
    this.main = this.run();
  }

  *run() {
    for (const g of this.program.globals) yield* this.execStmt(g, this.globalEnv);
    const setup = this.program.functions.setup;
    if (setup) yield* this.callUser(setup, []);
    const loop = this.program.functions.loop;
    for (;;) {
      if (!loop) { yield { sleep: 100000 }; continue; }
      yield* this.callUser(loop, []);
      yield 1;
    }
  }

  *callUser(fn, args) {
    const env = new Env(this.globalEnv);
    fn.params.forEach((pm, i) => env.define(pm.name, { type: pm.type, value: coerce(pm.type, args[i] ?? 0) }));
    const sig = yield* this.execStmt(fn.body, env);
    if (sig && sig.type === SIGNAL_RETURN) return sig.value;
    return 0;
  }

  *execStmt(node, env) {
    yield 1;
    switch (node.kind) {
      case 'Empty': return;
      case 'Block': {
        const scope = new Env(env);
        for (const s of node.body) {
          const sig = yield* this.execStmt(s, scope);
          if (sig) return sig;
        }
        return;
      }
      case 'Multi': {
        for (const s of node.body) { const sig = yield* this.execStmt(s, env); if (sig) return sig; }
        return;
      }
      case 'VarDecl': {
        if (node.array) {
          let arr;
          if (node.init) {
            arr = [];
            for (const it of node.init.items) arr.push(coerce(node.type, yield* this.evalExpr(it, env)));
          } else {
            const size = node.size ? yield* this.evalExpr(node.size, env) : 0;
            arr = new Array(Math.max(0, Math.trunc(size))).fill(0);
          }
          env.define(node.name, { type: node.type, value: arr, array: true });
          return;
        }
        let v = node.init ? yield* this.evalExpr(node.init, env) : (node.type === 'Servo' ? this.makeServo() : 0);
        if (node.type === 'Servo' && !(v && v.__servo)) v = this.makeServo();
        env.define(node.name, { type: node.type, value: coerce(node.type, v) });
        return;
      }
      case 'ExprStmt': yield* this.evalExpr(node.expr, env); return;
      case 'If': {
        if (truthy(yield* this.evalExpr(node.test, env))) return yield* this.execStmt(node.cons, env);
        if (node.alt) return yield* this.execStmt(node.alt, env);
        return;
      }
      case 'While': {
        for (;;) {
          if (!truthy(yield* this.evalExpr(node.test, env))) return;
          const sig = yield* this.execStmt(node.body, env);
          if (sig) { if (sig.type === SIGNAL_BREAK) return; if (sig.type === SIGNAL_RETURN) return sig; }
        }
      }
      case 'DoWhile': {
        for (;;) {
          const sig = yield* this.execStmt(node.body, env);
          if (sig) { if (sig.type === SIGNAL_BREAK) return; if (sig.type === SIGNAL_RETURN) return sig; }
          if (!truthy(yield* this.evalExpr(node.test, env))) return;
        }
      }
      case 'For': {
        const scope = new Env(env);
        if (node.init) yield* this.execStmt(node.init, scope);
        for (;;) {
          if (node.test && !truthy(yield* this.evalExpr(node.test, scope))) return;
          const sig = yield* this.execStmt(node.body, scope);
          if (sig) { if (sig.type === SIGNAL_BREAK) return; if (sig.type === SIGNAL_RETURN) return sig; }
          if (node.update) yield* this.evalExpr(node.update, scope);
        }
      }
      case 'Switch': {
        const disc = yield* this.evalExpr(node.disc, env);
        const scope = new Env(env);
        let matched = false;
        for (const c of node.cases) {
          if (!matched) {
            if (c.test === null) matched = true;
            else if ((yield* this.evalExpr(c.test, scope)) === disc) matched = true;
          }
          if (matched) {
            for (const s of c.body) {
              const sig = yield* this.execStmt(s, scope);
              if (sig) { if (sig.type === SIGNAL_BREAK) return; return sig; }
            }
          }
        }
        return;
      }
      case 'Return': return { type: SIGNAL_RETURN, value: node.arg ? yield* this.evalExpr(node.arg, env) : 0 };
      case 'Break': return { type: SIGNAL_BREAK };
      case 'Continue': return { type: SIGNAL_CONTINUE };
      default: throw new CompileError(`Cannot execute ${node.kind}`, node.line);
    }
  }

  *resolveTarget(node, env) {
    if (node.kind === 'Ident') {
      let cell = env.lookup(node.name);
      if (!cell) { cell = { type: 'int', value: 0 }; this.globalEnv.define(node.name, cell); }
      return { get: () => cell.value, set: v => { cell.value = coerce(cell.type, v); }, type: cell.type };
    }
    if (node.kind === 'Index') {
      const cell = env.lookup(node.object.name);
      if (!cell) throw new CompileError(`'${node.object.name}' is not declared`, node.line);
      const idx = Math.trunc(yield* this.evalExpr(node.index, env));
      return {
        get: () => (cell.value[idx] ?? 0),
        set: v => { cell.value[idx] = coerce(cell.type, v); },
        type: cell.type,
      };
    }
    throw new CompileError('Invalid assignment target', node.line);
  }

  *evalExpr(node, env) {
    switch (node.kind) {
      case 'Num': return node.value;
      case 'Str': return node.value;
      case 'Ident': {
        if (env.has(node.name)) return env.lookup(node.name).value;
        const analog = /^A(\d+)$/.exec(node.name);
        if (analog) {
          const ap = this.board.pins.find(p => p.name === node.name);
          if (ap) return ap.id;
        }
        const c = CONSTANTS[node.name];
        if (c !== undefined) return c;
        if (node.name === 'Serial' || node.name === 'Wire' || node.name === 'SPI') return { __obj: node.name };
        if (this.program.functions[node.name]) return { __fnName: node.name };
        throw new CompileError(`'${node.name}' is not declared in this scope`, node.line);
      }
      case 'Cast': return coerce(node.to, yield* this.evalExpr(node.arg, env));
      case 'Ternary':
        return truthy(yield* this.evalExpr(node.test, env))
          ? yield* this.evalExpr(node.cons, env)
          : yield* this.evalExpr(node.alt, env);
      case 'Unary': {
        const v = yield* this.evalExpr(node.arg, env);
        if (node.op === '-') return -v;
        if (node.op === '!') return truthy(v) ? 0 : 1;
        if (node.op === '~') return ~Math.trunc(v);
        return v;
      }
      case 'Update': {
        const t = yield* this.resolveTarget(node.target, env);
        const old = Number(t.get()) || 0;
        const nv = node.op === '++' ? old + 1 : old - 1;
        t.set(nv);
        return node.prefix ? t.get() : old;
      }
      case 'Assign': {
        const t = yield* this.resolveTarget(node.target, env);
        const rhs = yield* this.evalExpr(node.value, env);
        if (node.op === '=') { t.set(rhs); return t.get(); }
        const cur = t.get();
        const map = { '+=': '+', '-=': '-', '*=': '*', '/=': '/', '%=': '%', '&=': '&', '|=': '|', '^=': '^', '<<=': '<<', '>>=': '>>' };
        t.set(binop(map[node.op], cur, rhs));
        return t.get();
      }
      case 'Binary': {
        if (node.op === '&&') {
          if (!truthy(yield* this.evalExpr(node.left, env))) return 0;
          return truthy(yield* this.evalExpr(node.right, env)) ? 1 : 0;
        }
        if (node.op === '||') {
          if (truthy(yield* this.evalExpr(node.left, env))) return 1;
          return truthy(yield* this.evalExpr(node.right, env)) ? 1 : 0;
        }
        const l = yield* this.evalExpr(node.left, env);
        const r = yield* this.evalExpr(node.right, env);
        return binop(node.op, l, r);
      }
      case 'Index': {
        const cell = env.lookup(node.object.name);
        if (!cell) throw new CompileError(`'${node.object.name}' is not declared`, node.line);
        const idx = Math.trunc(yield* this.evalExpr(node.index, env));
        if (typeof cell.value === 'string') return cell.value.charCodeAt(idx) || 0;
        return cell.value[idx] ?? 0;
      }
      case 'Member': return { __member: node };
      case 'Call': return yield* this.evalCall(node, env);
      default: throw new CompileError(`Cannot evaluate ${node.kind}`, node.line);
    }
  }

  *evalCall(node, env) {
    const callee = node.callee;
    const args = [];
    for (const a of node.args) args.push(yield* this.evalExpr(a, env));

    if (callee.kind === 'Member') {
      const objNode = callee.object;
      const objName = objNode.kind === 'Ident' ? objNode.name : null;
      if (objName === 'Serial') return this.serialCall(callee.prop, args, node.line, this.isFloatExpr(node.args[0], env));
      if (objName === 'Wire' || objName === 'SPI') return this.busCall(objName, callee.prop, args);
      if (objName && env.has(objName)) {
        const cell = env.lookup(objName);
        if (cell.value && cell.value.__servo) return this.servoCall(cell.value, callee.prop, args);
      }
      throw new CompileError(`Unknown object '${objName}'`, node.line);
    }

    const name = callee.name;
    const user = this.program.functions[name];
    if (user) return yield* this.callUser(user, args);

    const bi = this.builtin(name);
    if (!bi) throw new CompileError(`'${name}' was not declared in this scope`, node.line);
    if (bi.async) {
      const us = bi.fn(args);
      if (us > 0) yield { sleep: us };
      return 0;
    }
    return bi.fn(args) ?? 0;
  }

  makeServo() {
    const s = { __servo: true, pin: -1, angle: 90, attached: false };
    this.servos.push(s);
    return s;
  }

  servoCall(servo, prop, args) {
    switch (prop) {
      case 'attach': servo.pin = Math.trunc(args[0]); servo.attached = true; this.board.setMode(servo.pin, 'OUTPUT'); return 0;
      case 'write': servo.angle = Math.max(0, Math.min(180, Math.trunc(args[0]))); this.board.setServo(servo.pin, servo.angle); return 0;
      case 'writeMicroseconds': servo.angle = Math.max(0, Math.min(180, Math.round((args[0] - 1000) * 180 / 1000))); this.board.setServo(servo.pin, servo.angle); return 0;
      case 'read': return servo.angle;
      case 'detach': servo.attached = false; this.board.setServo(servo.pin, null); return 0;
      default: return 0;
    }
  }

  isFloatExpr(node, env) {
    if (!node) return false;
    switch (node.kind) {
      case 'Num': return !Number.isInteger(node.value);
      case 'Ident': {
        const cell = env.has(node.name) ? env.lookup(node.name) : null;
        return !!cell && (cell.type === 'float' || cell.type === 'double');
      }
      case 'Index': {
        const cell = env.has(node.object.name) ? env.lookup(node.object.name) : null;
        return !!cell && (cell.type === 'float' || cell.type === 'double');
      }
      case 'Cast': return node.to === 'float' || node.to === 'double';
      case 'Unary': return this.isFloatExpr(node.arg, env);
      case 'Assign': return this.isFloatExpr(node.target, env);
      case 'Binary': {
        if (['==', '!=', '<', '>', '<=', '>=', '&&', '||'].includes(node.op)) return false;
        return this.isFloatExpr(node.left, env) || this.isFloatExpr(node.right, env);
      }
      case 'Ternary': return this.isFloatExpr(node.cons, env) || this.isFloatExpr(node.alt, env);
      case 'Call': {
        const fn = node.callee.kind === 'Ident' ? this.program.functions[node.callee.name] : null;
        if (fn) return fn.returns === 'float' || fn.returns === 'double';
        return node.callee.kind === 'Ident' && ['sqrt', 'pow', 'sin', 'cos', 'tan'].includes(node.callee.name);
      }
      default: return false;
    }
  }

  serialCall(prop, args, line, floatHint) {
    switch (prop) {
      case 'begin': this.io.serialBegin(args[0] ?? 9600); return 0;
      case 'end': return 0;
      case 'print': { const s = this.render(args, floatHint); this.io.serialWrite(s); return s.length; }
      case 'println': { const s = this.render(args, floatHint); this.io.serialWrite(s + '\n'); return s.length + 2; }
      case 'write': this.io.serialWrite(typeof args[0] === 'string' ? args[0] : String.fromCharCode(args[0])); return 1;
      case 'available': return this.io.serialAvailable();
      case 'read': return this.io.serialRead();
      case 'readString': case 'readStringUntil': return this.io.serialReadAll();
      case 'parseInt': return parseInt(this.io.serialReadAll(), 10) || 0;
      case 'flush': return 0;
      default: throw new CompileError(`Serial.${prop}() is not supported by this simulator`, line);
    }
  }

  render(args, floatHint) {
    const v = args[0] ?? '';
    if (floatHint && typeof v === 'number') {
      const digits = typeof args[1] === 'number' ? Math.max(0, Math.min(8, Math.trunc(args[1]))) : 2;
      return Number(v).toFixed(digits);
    }
    return fmt(v, args[1]);
  }

  busCall(bus, prop, args) {
    this.io.busEvent(bus, prop, args);
    return 0;
  }

  builtin(name) {
    const b = this.board, io = this.io, rt = this;
    const table = {
      pinMode: { fn: a => b.setMode(a[0], a[1] === 2 ? 'INPUT_PULLUP' : (a[1] === 1 ? 'OUTPUT' : 'INPUT')) },
      digitalWrite: { fn: a => b.digitalWrite(a[0], truthy(a[1]) ? 1 : 0) },
      digitalRead: { fn: a => b.digitalRead(a[0]) },
      analogWrite: { fn: a => b.analogWrite(a[0], Math.max(0, Math.min(255, Math.trunc(a[1])))) },
      analogRead: { fn: a => b.analogRead(a[0]) },
      analogReference: { fn: () => 0 },
      delay: { async: true, fn: a => Math.max(0, Math.trunc(a[0] * 1000)) },
      delayMicroseconds: { async: true, fn: a => Math.max(0, Math.trunc(a[0])) },
      millis: { fn: () => Math.floor(rt.micros / 1000) },
      micros: { fn: () => Math.floor(rt.micros) },
      map: { fn: a => {
        const [x, il, ih, ol, oh] = a;
        if (ih === il) return ol;
        return Math.trunc((x - il) * (oh - ol) / (ih - il) + ol);
      } },
      constrain: { fn: a => Math.min(Math.max(a[0], a[1]), a[2]) },
      min: { fn: a => Math.min(a[0], a[1]) },
      max: { fn: a => Math.max(a[0], a[1]) },
      abs: { fn: a => Math.abs(a[0]) },
      pow: { fn: a => Math.pow(a[0], a[1]) },
      sqrt: { fn: a => Math.sqrt(a[0]) },
      sin: { fn: a => Math.sin(a[0]) }, cos: { fn: a => Math.cos(a[0]) }, tan: { fn: a => Math.tan(a[0]) },
      round: { fn: a => Math.round(a[0]) }, floor: { fn: a => Math.floor(a[0]) }, ceil: { fn: a => Math.ceil(a[0]) },
      random: { fn: a => a.length > 1 ? Math.floor(io.random() * (a[1] - a[0])) + a[0] : Math.floor(io.random() * (a[0] || 1)) },
      randomSeed: { fn: () => 0 },
      tone: { fn: a => b.tone(a[0], Math.trunc(a[1])) },
      noTone: { fn: a => b.tone(a[0], 0) },
      digitalPinToInterrupt: { fn: a => Math.trunc(a[0]) },
      attachInterrupt: { fn: a => {
        const pin = Math.trunc(a[0]);
        const fnName = a[1] && a[1].__fnName;
        if (!fnName || !rt.program.functions[fnName]) { io.warn(`attachInterrupt() needs the name of a function defined in this sketch`); return 0; }
        if (!b.spec.interrupts.includes(pin)) io.warn(`Pin ${pin} has no external interrupt on ${b.spec.name}`);
        rt.interrupts.set(pin, { fn: rt.program.functions[fnName], mode: Math.trunc(a[2] ?? 1) });
        return 0;
      } },
      detachInterrupt: { fn: a => { rt.interrupts.delete(Math.trunc(a[0])); return 0; } },
      interrupts: { fn: () => 0 },
      noInterrupts: { fn: () => 0 },
      pulseIn: { fn: () => 0 },
      shiftOut: { fn: () => 0 },
      yield: { fn: () => 0 },
    };
    return table[name];
  }
}

function truthy(v) {
  if (typeof v === 'string') return v.length > 0;
  return !!v && v !== 0;
}

function fmt(v, spec) {
  if (typeof v === 'string') return v;
  if (v === undefined || v === null) return '';
  if (typeof v === 'object') return '[object]';
  if (Number.isInteger(v)) {
    if (spec === 16) return Math.trunc(v).toString(16).toUpperCase();
    if (spec === 2) return Math.trunc(v).toString(2);
    if (spec === 8) return Math.trunc(v).toString(8);
    return String(v);
  }
  if (typeof spec === 'number' && spec >= 0 && spec <= 8) return Number(v).toFixed(spec);
  return Number(v).toFixed(2);
}

function binop(op, l, r) {
  if (op === '+' && (typeof l === 'string' || typeof r === 'string')) return fmt(l) + fmt(r);
  const a = Number(l) || 0, bb = Number(r) || 0;
  switch (op) {
    case '+': return a + bb;
    case '-': return a - bb;
    case '*': return a * bb;
    case '/': return bb === 0 ? 0 : (Number.isInteger(a) && Number.isInteger(bb) ? Math.trunc(a / bb) : a / bb);
    case '%': return bb === 0 ? 0 : a % bb;
    case '==': return (typeof l === 'string' || typeof r === 'string') ? (fmt(l) === fmt(r) ? 1 : 0) : (a === bb ? 1 : 0);
    case '!=': return a !== bb ? 1 : 0;
    case '<': return a < bb ? 1 : 0;
    case '>': return a > bb ? 1 : 0;
    case '<=': return a <= bb ? 1 : 0;
    case '>=': return a >= bb ? 1 : 0;
    case '&': return Math.trunc(a) & Math.trunc(bb);
    case '|': return Math.trunc(a) | Math.trunc(bb);
    case '^': return Math.trunc(a) ^ Math.trunc(bb);
    case '<<': return Math.trunc(a) << Math.trunc(bb);
    case '>>': return Math.trunc(a) >> Math.trunc(bb);
    default: return 0;
  }
}

const CONSTANTS = {
  HIGH: 1, LOW: 0, INPUT: 0, OUTPUT: 1, INPUT_PULLUP: 2,
  LED_BUILTIN: 13, DEC: 10, HEX: 16, OCT: 8, BIN: 2,
  A0: 14, A1: 15, A2: 16, A3: 17, A4: 18, A5: 19, A6: 20, A7: 21,
  CHANGE: 1, FALLING: 2, RISING: 3, PI: Math.PI, TWO_PI: Math.PI * 2, HALF_PI: Math.PI / 2,
  MSBFIRST: 1, LSBFIRST: 0, DEFAULT: 1, EXTERNAL: 0, INTERNAL: 3,
};

const BOARDS = {
  uno: { id: 'uno', name: 'Arduino Uno', digital: 14, analog: 6, pwm: [3, 5, 6, 9, 10, 11], interrupts: [2, 3], voltage: 5, flash: 32256, ram: 2048 },
  nano: { id: 'nano', name: 'Arduino Nano', digital: 14, analog: 8, pwm: [3, 5, 6, 9, 10, 11], interrupts: [2, 3], voltage: 5, flash: 30720, ram: 2048 },
  mega: { id: 'mega', name: 'Arduino Mega 2560', digital: 24, analog: 16, pwm: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], interrupts: [2, 3, 18, 19, 20, 21], voltage: 5, flash: 253952, ram: 8192 },
};

class Board {
  constructor(spec, io) {
    this.spec = spec;
    this.io = io;
    this.pins = [];
    this.reset();
  }
  reset() {
    const s = this.spec;
    this.pins = [];
    for (let i = 0; i < s.digital; i++) {
      this.pins.push({ id: i, name: `D${i}`, kind: 'digital', mode: 'INPUT', value: 0, pwm: null, servo: null, tone: 0, analog: 0 });
    }
    for (let i = 0; i < s.analog; i++) {
      this.pins.push({ id: s.digital + i, name: `A${i}`, kind: 'analog', mode: 'INPUT', value: 0, pwm: null, servo: null, tone: 0, analog: 0 });
    }
    this.pins.push({ id: 900, name: '5V', kind: 'power', mode: 'POWER', value: 1, pwm: null, servo: null, tone: 0, analog: 1023 });
    this.pins.push({ id: 901, name: '3V3', kind: 'power', mode: 'POWER', value: 1, pwm: null, servo: null, tone: 0, analog: 674 });
    this.pins.push({ id: 902, name: 'GND', kind: 'ground', mode: 'POWER', value: 0, pwm: null, servo: null, tone: 0, analog: 0 });
    this.pins.push({ id: 903, name: 'GND2', kind: 'ground', mode: 'POWER', value: 0, pwm: null, servo: null, tone: 0, analog: 0 });
    this.pins.push({ id: 904, name: 'VIN', kind: 'power', mode: 'POWER', value: 1, pwm: null, servo: null, tone: 0, analog: 1023 });
  }
  pin(id) { return this.pins.find(p => p.id === Math.trunc(id)); }
  isPwm(id) { return this.spec.pwm.includes(Math.trunc(id)); }
  setMode(id, mode) {
    const p = this.pin(id);
    if (!p) { this.io.warn(`pinMode() on pin ${id}, which does not exist on ${this.spec.name}`); return 0; }
    if (p.mode !== mode) { p.mode = mode; this.io.event(p.name, `mode ${mode}`); }
    if (mode === 'INPUT_PULLUP') p.value = 1;
    return 0;
  }
  digitalWrite(id, v) {
    const p = this.pin(id);
    if (!p) { this.io.warn(`digitalWrite() on pin ${id}, which does not exist on ${this.spec.name}`); return 0; }
    if (p.mode !== 'OUTPUT') this.io.warnOnce(`pin-${p.name}-mode`, `${p.name} was written without pinMode(${p.name.replace('D', '')}, OUTPUT)`);
    p.pwm = null;
    if (p.value !== v) { p.value = v; this.io.pinChanged(p); this.io.event(p.name, v ? 'HIGH' : 'LOW'); }
    return 0;
  }
  digitalRead(id) {
    const p = this.pin(id);
    if (!p) return 0;
    if (p.mode === 'OUTPUT') return p.value;
    return this.io.readInput(p);
  }
  analogWrite(id, v) {
    const p = this.pin(id);
    if (!p) return 0;
    if (!this.isPwm(id) && p.kind === 'digital') this.io.warnOnce(`pwm-${p.name}`, `${p.name} has no PWM hardware on ${this.spec.name}; output is on/off only`);
    p.mode = 'OUTPUT';
    p.pwm = v;
    p.value = v > 127 ? 1 : 0;
    this.io.pinChanged(p);
    return 0;
  }
  analogRead(id) {
    const p = this.pin(id);
    if (!p) return 0;
    return this.io.readAnalog(p);
  }
  setServo(id, angle) {
    const p = this.pin(id);
    if (!p) return 0;
    p.servo = angle;
    this.io.pinChanged(p);
    return 0;
  }
  tone(id, freq) {
    const p = this.pin(id);
    if (!p) return 0;
    p.tone = freq;
    this.io.pinChanged(p);
    this.io.event(p.name, freq ? `tone ${freq} Hz` : 'tone off');
    return 0;
  }
  level(p) {
    if (p.kind === 'power') return p.name === '3V3' ? 3.3 : 5;
    if (p.kind === 'ground') return 0;
    if (p.mode === 'OUTPUT') {
      if (p.pwm !== null) return this.spec.voltage * p.pwm / 255;
      return p.value ? this.spec.voltage : 0;
    }
    return this.io.readInput(p) ? this.spec.voltage : 0;
  }
}

return { lex, parse, Runtime, Board, BOARDS, CONSTANTS, CompileError, coerce, fmt, truthy, binop, Env };
})();

if (typeof module !== 'undefined') module.exports = SL;

