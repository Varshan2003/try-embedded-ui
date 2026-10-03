// Parser and type checker for the C interpreter. It turns preprocessed tokens straight into a typed
// tree: every expression node carries its C type, variables are resolved to storage, and implicit
// conversions are made explicit, so the machine never has to reason about types while running.
import {
  CError, VOID, BOOL, CHAR, SCHAR, UCHAR, SHORT, USHORT, INT, UINT, LONG, ULONG, LLONG, ULLONG, FLOAT, DOUBLE,
  ptr, array, func, isInt, isArith, isPtr, isScalar, isRecord, record, qualify, typeName, sameType, promote,
  commonType, alignUp, layout, convert, arith, shift, compare,
} from './types.js';

export const FUNC_BASE = 0x08000100;
export const RODATA_BASE = 0x08010000;
export const RAM_BASE = 0x20000000;
export const REDZONE = 8;

const KEYWORDS = new Set(['if', 'else', 'for', 'while', 'do', 'return', 'break', 'continue', 'switch', 'case', 'default', 'sizeof', 'goto',
  'void', 'char', 'short', 'int', 'long', 'signed', 'unsigned', 'float', 'double', '_Bool', 'struct', 'union', 'enum',
  'const', 'volatile', 'static', 'extern', 'typedef', 'register', 'inline', 'auto', 'restrict']);
const TYPE_WORDS = new Set(['void', 'char', 'short', 'int', 'long', 'signed', 'unsigned', 'float', 'double', '_Bool', 'struct', 'union', 'enum',
  'const', 'volatile', 'static', 'extern', 'typedef', 'register', 'inline', 'auto', 'restrict', '__attribute__', '__inline', '__volatile__', '__restrict', '_Noreturn']);
const SKIPPED = new Set(['inline', '__inline', '_Noreturn', 'volatile', '__volatile__', 'restrict', '__restrict']);
const STORAGE = new Set(['typedef', 'static', 'extern', 'register', 'auto']);
const ASSIGN = new Set(['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=']);
const PREC = {
  '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6, '<': 7, '>': 7, '<=': 7, '>=': 7,
  '<<': 8, '>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10,
};

class Scope {
  constructor(parent) { this.syms = new Map(); this.tags = new Map(); this.parent = parent; }
  find(name) { for (let s = this; s; s = s.parent) { const v = s.syms.get(name); if (v) return v; } return undefined; }
  findTag(name) { for (let s = this; s; s = s.parent) { const v = s.tags.get(name); if (v) return v; } return undefined; }
}

const isCharType = t => t.kind === 'int' && t.size === 1 && !t.bool;
const isZero = e => e.k === 'num' && Number(e.v) === 0;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export class Parser {
  constructor(tokens) {
    this.toks = tokens;
    this.p = 0;
    this.global = new Scope(null);
    this.scope = this.global;
    this.fn = null;          // the function being parsed, or null at file scope
    this.gtop = 0;           // next free byte of static storage
    this.globals = [];       // [offset, size] of every static object, for the memory checker
    this.ginits = [];        // initialisers of static objects, run before main
    this.rodata = [];
    this.strings = new Map();
    this.functions = [];
    this.warnings = [];
    this.packStack = [];
    this.pack = 0;
    this.loops = 0;
    this.breakable = 0;
    this.paramDepth = 0;     // above zero while a parameter list is being parsed
  }

  // ---- token helpers -----------------------------------------------------------

  peek(n = 0) { return this.toks[Math.min(this.p + n, this.toks.length - 1)]; }
  next() { return this.toks[this.p++]; }
  isOp(v, n = 0) { const t = this.peek(n); return t.k === 'op' && t.v === v; }
  isId(v, n = 0) { const t = this.peek(n); return t.k === 'id' && t.v === v; }
  eatOp(v) { if (this.isOp(v)) { this.p++; return true; } return false; }
  eatId(v) { if (this.isId(v)) { this.p++; return true; } return false; }
  err(msg, t = this.peek()) { throw new CError(msg, t.line, t.file); }
  warn(msg, t) { this.warnings.push({ message: msg, line: t.line, file: t.file }); }
  describe(t = this.peek()) {
    if (t.k === 'eof') return 'the end of the code';
    if (t.k === 'str') return 'a string';
    return `'${t.v}'`;
  }
  expectOp(v) {
    if (!this.isOp(v)) {
      const prev = this.toks[this.p - 1];
      // A missing ';' is reported where it belongs, on the line that needed it.
      if (v === ';' && prev) throw new CError(`Expected ';' after ${this.describe(prev)}`, prev.line, prev.file);
      this.err(`Expected '${v}' but found ${this.describe()}`);
    }
    return this.next();
  }
  expectId() {
    const t = this.peek();
    if (t.k !== 'id' || KEYWORDS.has(t.v)) this.err(`Expected a name but found ${this.describe()}`);
    return this.next();
  }
  isTypeStart(t = this.peek()) {
    if (t.k !== 'id') return false;
    if (TYPE_WORDS.has(t.v)) return true;
    const sym = this.scope.find(t.v);
    return !!sym && sym.kind === 'typedef';
  }

  // ---- storage -----------------------------------------------------------------

  allocGlobal(type) {
    const off = alignUp(this.gtop, Math.max(type.align, 1));
    this.gtop = off + type.size + REDZONE;
    this.globals.push([off, type.size]);
    return { k: 'gvar', addr: RAM_BASE + off, type, lv: true };
  }
  allocLocal(type) {
    const off = alignUp(this.fn.top, Math.max(type.align, 1));
    this.fn.top = off + type.size + REDZONE;
    this.fn.locals.push([off, type.size]);
    return { k: 'lvar', off, type, lv: true };
  }
  alloc(type) { return this.fn ? this.allocLocal(type) : this.allocGlobal(type); }

  intern(bytes) {
    const key = bytes.join(',');
    let off = this.strings.get(key);
    if (off === undefined) {
      off = this.rodata.length;
      this.rodata.push(...bytes, 0);
      this.strings.set(key, off);
    }
    return RODATA_BASE + off;
  }

  // ---- program -----------------------------------------------------------------

  parseProgram() {
    while (this.peek().k !== 'eof') {
      if (this.pragma() || this.eatOp(';')) continue;
      if (this.isId('_Static_assert')) { this.staticAssert(); continue; }
      const t = this.peek();
      if (!this.isTypeStart(t)) {
        if (t.k === 'id' && !KEYWORDS.has(t.v) && this.peek(1).k === 'id') this.err(`Unknown type name '${t.v}'`);
        if (t.k === 'id' && !KEYWORDS.has(t.v) && this.isOp('(', 1)) this.err(`'${t.v}' needs a return type, and statements must be inside a function`);
        this.err(`Expected a declaration but found ${this.describe()}; statements must be inside a function`);
      }
      this.declaration();
    }
    for (const fn of this.functions) {
      if (!fn.body && !fn.builtin && fn.used) throw new CError(`'${fn.name}' is declared but never defined`, fn.used.line, fn.used.file);
    }
    return {
      functions: this.functions,
      globalsSize: alignUp(this.gtop, 8),
      globals: this.globals,
      ginits: this.ginits,
      rodata: Uint8Array.from(this.rodata),
      warnings: this.warnings,
      main: this.global.syms.get('main')?.fn ?? null,
    };
  }

  pragma() {
    const t = this.peek();
    if (t.k !== 'pack') return false;
    this.next();
    if (t.push) this.packStack.push(this.pack);
    if (t.pop) this.pack = this.packStack.pop() ?? 0;
    else this.pack = t.v;
    return true;
  }

  staticAssert() {
    const t = this.next();
    this.expectOp('(');
    const ok = this.constInt();
    let msg = 'static assertion failed';
    if (this.eatOp(',')) msg = String.fromCharCode(...this.stringBytes());
    this.expectOp(')');
    this.expectOp(';');
    if (!ok) this.err(`Static assertion failed: ${msg}`, t);
  }

  attributes() {
    let packed = false;
    while (this.isId('__attribute__')) {
      this.next();
      this.expectOp('(');
      let depth = 1;
      while (depth > 0) {
        const t = this.next();
        if (t.k === 'eof') this.err("Unterminated '__attribute__'", t);
        if (t.k === 'op' && t.v === '(') depth++;
        if (t.k === 'op' && t.v === ')') depth--;
        if (t.k === 'id' && (t.v === 'packed' || t.v === '__packed__')) packed = true;
      }
    }
    return packed;
  }

  // ---- declarations ------------------------------------------------------------

  declSpec() {
    const start = this.peek();
    let storage = null, isConst = false, base = null, sign = null, longs = 0, short = false, word = null;
    for (;;) {
      const t = this.peek();
      if (t.k !== 'id') break;
      const v = t.v;
      if (STORAGE.has(v)) { storage = v; this.next(); continue; }
      if (SKIPPED.has(v)) { this.next(); continue; }
      if (v === 'const') { isConst = true; this.next(); continue; }
      if (v === '__attribute__') { this.attributes(); continue; }
      if (v === 'signed' || v === 'unsigned') { sign = v; this.next(); continue; }
      if (v === 'short') { short = true; this.next(); continue; }
      if (v === 'long') { longs++; this.next(); continue; }
      if (v === 'void' || v === 'char' || v === 'int' || v === 'float' || v === 'double' || v === '_Bool') {
        if (word || base) this.err(`Two types in one declaration ('${word || typeName(base)}' and '${v}')`);
        word = v; this.next(); continue;
      }
      if (v === 'struct' || v === 'union') { base = this.recordSpec(); continue; }
      if (v === 'enum') { base = this.enumSpec(); continue; }
      if (!word && !base && !sign && !short && !longs) {
        const sym = this.scope.find(v);
        if (sym && sym.kind === 'typedef') { base = sym.type; this.next(); continue; }
      }
      break;
    }
    let type = base;
    if (!type) {
      const u = sign === 'unsigned';
      if (word === 'void') type = VOID;
      else if (word === 'float') type = FLOAT;
      else if (word === 'double') type = DOUBLE;
      else if (word === '_Bool') type = BOOL;
      else if (word === 'char') type = sign === 'unsigned' ? UCHAR : sign === 'signed' ? SCHAR : CHAR;
      else if (short) type = u ? USHORT : SHORT;
      else if (longs >= 2) type = u ? ULLONG : LLONG;
      else if (longs === 1) type = u ? ULONG : LONG;
      else if (word === 'int' || sign) type = u ? UINT : INT;
      else if (storage || isConst) { this.warn("Type defaults to 'int'", start); type = INT; }
      else this.err(`Expected a type but found ${this.describe(start)}`, start);
    }
    return { type: qualify(type, isConst), storage };
  }

  recordSpec() {
    const kw = this.next();
    let packed = this.attributes();
    const tagTok = this.peek().k === 'id' && !KEYWORDS.has(this.peek().v) && !this.isId('__attribute__') ? this.next() : null;
    const tag = tagTok ? tagTok.v : null;
    if (!this.isOp('{')) {
      if (!tag) this.err(`Expected a ${kw.v} name or '{'`);
      let t = this.scope.findTag(tag);
      if (t && t.kind !== kw.v) this.err(`'${tag}' was declared as a ${t.kind}, not a ${kw.v}`, tagTok);
      if (!t) { t = { kind: kw.v, tag, fields: null, size: 0, align: 1 }; this.scope.tags.set(tag, t); }
      return t;
    }
    let t = tag ? this.scope.tags.get(tag) : null;
    if (t && t.fields) this.err(`Redefinition of '${kw.v} ${tag}'`, tagTok);
    if (!t) { t = { kind: kw.v, tag, fields: null, size: 0, align: 1 }; if (tag) this.scope.tags.set(tag, t); }
    this.expectOp('{');
    const members = [];
    while (!this.isOp('}')) {
      if (this.pragma()) continue;
      if (this.peek().k === 'eof') this.err(`Missing '}' at the end of ${kw.v} ${tag || ''}`, kw);
      if (!this.isTypeStart()) this.err(`Expected a member declaration but found ${this.describe()}`);
      const spec = this.declSpec();
      if (this.isOp(';')) {
        // An anonymous struct or union: its members belong to the enclosing type.
        if (!isRecord(spec.type) || !record(spec.type).fields) this.err('Declaration does not declare a member');
        members.push({ name: null, type: spec.type });
        this.next();
        continue;
      }
      do {
        if (this.isOp(':')) { // unnamed bit-field, used for padding
          this.next();
          members.push({ name: null, type: spec.type, width: this.constInt() });
          continue;
        }
        const d = this.declarator(spec.type);
        if (!d.name) this.err('Expected a member name');
        if (members.some(m => m.name === d.name)) this.err(`Duplicate member '${d.name}'`, d.tok);
        if (d.type.kind === 'func') this.err(`Member '${d.name}' is a function; use a function pointer`, d.tok);
        if (d.type.vlaLen) this.err(`Member '${d.name}' needs a constant size: a struct cannot hold a variable-length array`, d.tok);
        if (d.type.kind === 'void' || (isRecord(d.type) && !record(d.type).fields)) this.err(`Member '${d.name}' has an incomplete type`, d.tok);
        const m = { name: d.name, type: d.type };
        if (this.eatOp(':')) {
          if (!isInt(d.type)) this.err(`Bit-field '${d.name}' must have an integer type`, d.tok);
          m.width = this.constInt();
          if (m.width < 0 || m.width > d.type.size * 8) this.err(`Width of bit-field '${d.name}' exceeds its type`, d.tok);
          if (m.width === 0) this.err(`Named bit-field '${d.name}' cannot have zero width`, d.tok);
        }
        members.push(m);
      } while (this.eatOp(','));
      this.attributes();
      this.expectOp(';');
    }
    this.expectOp('}');
    packed = this.attributes() || packed;
    layout(t, members, packed ? 1 : this.pack);
    return t;
  }

  enumSpec() {
    this.next();
    if (this.peek().k === 'id' && !KEYWORDS.has(this.peek().v)) this.next();
    if (!this.eatOp('{')) return INT;
    let value = 0;
    while (!this.isOp('}')) {
      const name = this.expectId();
      if (this.eatOp('=')) value = this.constInt();
      if (this.scope.syms.has(name.v)) this.err(`Redefinition of '${name.v}'`, name);
      this.scope.syms.set(name.v, { kind: 'enum', value });
      value++;
      if (!this.eatOp(',')) break;
    }
    this.expectOp('}');
    return INT;
  }

  // Parses one declarator on top of `base`. The name is optional, so this also handles casts and prototypes.
  declarator(base) {
    while (this.eatOp('*')) {
      base = ptr(base);
      let isConst = false;
      while (this.peek().k === 'id' && (this.peek().v === 'const' || SKIPPED.has(this.peek().v))) isConst = this.next().v === 'const' || isConst;
      base = qualify(base, isConst);
    }
    let name = null, tok = null, inner = -1;
    if (this.isOp('(') && (this.isOp('*', 1) || this.isOp('(', 1) || (this.peek(1).k === 'id' && !this.isTypeStart(this.peek(1))))) {
      inner = this.p;
      let depth = 0;
      do {
        const t = this.next();
        if (t.k === 'eof') this.err("Missing ')'", this.toks[inner]);
        if (t.k === 'op' && t.v === '(') depth++;
        if (t.k === 'op' && t.v === ')') depth--;
      } while (depth > 0);
    } else if (this.peek().k === 'id' && !KEYWORDS.has(this.peek().v)) {
      tok = this.next();
      name = tok.v;
    }
    const suffixes = [];
    for (;;) {
      if (this.eatOp('[')) {
        while (this.peek().k === 'id' && (STORAGE.has(this.peek().v) || this.peek().v === 'const' || SKIPPED.has(this.peek().v))) this.next();
        const size = this.isOp(']') ? { length: null } : this.arrayLength();
        this.expectOp(']');
        suffixes.push(size);
      } else if (this.isOp('(')) {
        this.next();
        suffixes.push(this.paramList());
      } else break;
    }
    let type = base;
    for (let i = suffixes.length - 1; i >= 0; i--) {
      const s = suffixes[i];
      if ('length' in s) {
        if (type.kind === 'func') this.err('An array of functions is not allowed; use function pointers');
        if (type.kind === 'void' || (isRecord(type) && !record(type).fields)) this.err('Array element type is incomplete');
        if (type.vlaLen) this.err('Only a one-dimensional array can take its size from a variable');
        type = array(type, s.length);
        if (s.vla) type.vlaLen = s.vla;
      } else {
        if (type.kind === 'func' || type.kind === 'array') this.err('A function cannot return a function or an array');
        type = func(type, s.params, s.variadic);
        type.unspecified = s.unspecified;
      }
    }
    if (inner >= 0) {
      const end = this.p;
      this.p = inner + 1;
      const d = this.declarator(type);
      this.expectOp(')');
      this.p = end;
      return d;
    }
    return { name, type, tok: tok || this.peek() };
  }

  paramList() {
    const params = [];
    if (this.eatOp(')')) return { params, variadic: false, unspecified: true };
    if (this.isId('void') && this.isOp(')', 1)) { this.p += 2; return { params, variadic: false }; }
    let variadic = false;
    this.paramDepth++;
    do {
      if (this.eatOp('...')) { variadic = true; break; }
      if (!this.isTypeStart()) this.err(this.peek().k === 'id' ? `Unknown type name '${this.peek().v}'` : `Expected a parameter type but found ${this.describe()}`);
      const spec = this.declSpec();
      const d = this.declarator(spec.type);
      let type = d.type;
      if (type.kind === 'array') type = ptr(type.of);
      else if (type.kind === 'func') type = ptr(type);
      else if (type.kind === 'void') this.err("'void' must be the only parameter", d.tok);
      params.push({ name: d.name, type, tok: d.tok });
    } while (this.eatOp(','));
    this.paramDepth--;
    if (variadic && !params.length) this.err("A function that takes '...' needs at least one named parameter before it");
    this.expectOp(')');
    return { params, variadic };
  }

  typeName() {
    const spec = this.declSpec();
    if (spec.storage) this.err('A storage class is not allowed here');
    const d = this.declarator(spec.type);
    if (d.name) this.err(`Unexpected name '${d.name}' in a type`, d.tok);
    if (d.type.vlaLen) this.err('A variable-length array type is only supported in the declaration of a local array', d.tok);
    return d.type;
  }

  // Parses a declaration and returns the statements that initialise its local variables.
  declaration() {
    const spec = this.declSpec();
    const stmts = [];
    if (this.eatOp(';')) return stmts;
    for (let first = true; ; first = false) {
      const d = this.declarator(spec.type);
      if (!d.name) this.err(`Expected a name but found ${this.describe()}`);
      this.attributes();
      if (spec.storage === 'typedef') {
        const t = d.type;
        if (t.vlaLen) this.err('A typedef cannot name a variable-length array', d.tok);
        // Keep the alias so messages can say 'uint8_t' rather than 'unsigned char'.
        this.scope.syms.set(d.name, { kind: 'typedef', type: isArith(t) && !t.const ? { ...t, name: d.name } : t });
      } else if (d.type.kind === 'func') {
        const fn = this.declareFunction(d);
        if (first && this.isOp('{')) { this.functionBody(fn, d); return stmts; }
      } else {
        stmts.push(...this.variable(d, spec.storage));
      }
      if (!this.eatOp(',')) break;
    }
    this.expectOp(';');
    return stmts;
  }

  declareFunction(d) {
    const builtin = d.tok.file === '<builtin>';
    const sym = this.global.syms.get(d.name);
    if (sym) {
      if (sym.kind !== 'func') this.err(`'${d.name}' was already declared as something else`, d.tok);
      const fn = sym.fn;
      if (!fn.builtin && !fn.type.unspecified && !d.type.unspecified && !sameType(fn.type, d.type)) {
        this.err(`Conflicting types for '${d.name}': it was declared as '${typeName(fn.type)}'`, d.tok);
      }
      if (!d.type.unspecified || fn.type.unspecified) fn.type = d.type;
      return fn;
    }
    const fn = { name: d.name, type: d.type, body: null, builtin, addr: FUNC_BASE + this.functions.length * 4, frameSize: 0, params: [], shadow: null, used: null };
    this.functions.push(fn);
    this.global.syms.set(d.name, { kind: 'func', fn });
    return fn;
  }

  functionBody(fn, d) {
    if (this.fn) this.err('A function cannot be defined inside another function', d.tok);
    if (fn.body) this.err(`Redefinition of '${d.name}'`, d.tok);
    fn.builtin = false;
    fn.type = d.type;
    fn.line = d.tok.line;
    fn.file = d.tok.file;
    this.fn = { top: 0, locals: [], ret: d.type.ret, name: d.name, variadic: d.type.variadic, labels: new Map(), gotos: [] };
    this.scope = new Scope(this.scope);
    fn.params = d.type.params.map(pm => {
      if (!pm.name) this.err('Parameter name omitted', pm.tok);
      if (isRecord(pm.type) && !record(pm.type).fields) this.err(`Parameter '${pm.name}' has an incomplete type`, pm.tok);
      const node = this.allocLocal(pm.type);
      this.scope.syms.set(pm.name, { kind: 'var', node });
      return { off: node.off, type: pm.type };
    });
    fn.body = this.compound(false);
    this.scope = this.scope.parent;
    for (const g of this.fn.gotos) if (!this.fn.labels.has(g.v)) this.err(`'goto ${g.v}' has no label '${g.v}:' to jump to in '${d.name}'`, g);
    if (this.fn.labels.size) labelsIn(fn.body);
    fn.frameSize = alignUp(this.fn.top, 8);
    fn.shadow = new Uint8Array(fn.frameSize).fill(SHADOW_STACK_GAP);
    // A local may be written but holds no value yet; the machine reports a read that comes first.
    for (const [off, size] of this.fn.locals) fn.shadow.fill(SHADOW_UNINIT, off, off + size);
    this.fn = null;
  }

  variable(d, storage) {
    let type = d.type;
    const name = d.name;
    if (type.kind === 'void') this.err(`Variable '${name}' is declared void`, d.tok);
    const isStatic = !this.fn || storage === 'static' || storage === 'extern';
    if (type.vlaLen) return [this.vlaVariable(d, isStatic)];
    const scope = storage === 'extern' ? this.global : this.scope;
    const existing = scope.syms.get(name);
    if (existing && (this.fn && storage !== 'extern' || existing.kind !== 'var' || !sameType(existing.node.type, type))) {
      this.err(`Redefinition of '${name}'`, d.tok);
    }
    const complete = t => !(t.kind === 'array' && t.length === null) && !(isRecord(t) && !record(t).fields);
    const define = () => {
      const node = isStatic ? this.allocGlobal(type) : this.allocLocal(type);
      node.name = name;
      scope.syms.set(name, { kind: 'var', node, initialised: false });
      return node;
    };
    // A variable is in scope inside its own initialiser (`int *p = malloc(sizeof *p)`), so give it
    // storage first whenever its size is already known.
    let node = existing ? existing.node : complete(type) ? define() : null;
    let items = null;
    if (this.isOp('=')) {
      if (storage === 'extern') this.err(`'${name}' is declared extern and cannot be initialised here`, d.tok);
      if (existing && existing.initialised) this.err(`Redefinition of '${name}'`, d.tok);
      this.next();
      ({ type, items } = this.initializer(type));
    }
    if (!node) {
      if (isRecord(type)) this.err(`Variable '${name}' has an incomplete type '${typeName(type)}'`, d.tok);
      if (type.length === null) {
        if (storage !== 'extern') this.err(`Array '${name}' needs a size or an initialiser`, d.tok);
        type = array(type.of, 0);
      }
      node = define();
    }
    if (items) scope.syms.get(name).initialised = true;
    if (storage === 'extern' && this.fn) this.scope.syms.set(name, scope.syms.get(name));
    if (!items) return [];
    const stmt = { k: 'decl', base: node, items, line: d.tok.line, file: d.tok.file };
    if (isStatic) { this.ginits.push(stmt); return []; }
    return [stmt];
  }

  // A local array whose length is only known when the declaration runs. Its storage is taken from
  // the stack at that moment; two hidden locals remember where it is and how big it turned out.
  vlaVariable(d, isStatic) {
    const name = d.name, type = d.type;
    if (isStatic) this.err(`'${name}' cannot be static: a variable-length array lives on the stack`, d.tok);
    if (this.scope.syms.has(name)) this.err(`Redefinition of '${name}'`, d.tok);
    if (this.isOp('=')) this.err(`'${name}' cannot have an initialiser: its size is not known until the program runs. Fill it with a loop or memset`, d.tok);
    this.warn(`'${name}' is a variable-length array: its stack use depends on a run-time value, which most firmware coding standards forbid`, d.tok);
    const ptrOff = this.allocLocal(UINT).off, sizeOff = this.allocLocal(UINT).off;
    const vla = array(type.of, null);
    vla.vla = { sizeOff };
    this.scope.syms.set(name, { kind: 'var', node: { k: 'vlavar', off: ptrOff, type: vla, lv: true, name }, initialised: false });
    return { k: 'vla', name, ptrOff, sizeOff, count: type.vlaLen, elem: type.of.size, line: d.tok.line, file: d.tok.file };
  }

  // ---- initialisers ------------------------------------------------------------

  stringBytes() {
    if (this.peek().k !== 'str') this.err(`Expected a string but found ${this.describe()}`);
    const bytes = [];
    while (this.peek().k === 'str') bytes.push(...this.next().v);
    return bytes;
  }

  initializer(type) {
    const items = [];
    if (this.isOp('{') || (type.kind === 'array' && isCharType(type.of) && this.peek().k === 'str')) {
      const done = this.initItem(type, 0, items);
      return { type: done, items: [{ off: 0, zero: done.size }, ...items] };
    }
    if (type.kind === 'array') this.err('An array must be initialised with a brace-enclosed list');
    const at = this.peek();
    items.push({ off: 0, type, e: this.assignConv(this.rv(this.assignExpr()), type, 'initialisation', at) });
    return { type, items };
  }

  scalarInit(type, off, items, bf) {
    const at = this.peek();
    items.push({ off, type, bf, e: this.assignConv(this.rv(this.assignExpr()), type, 'initialisation', at) });
  }

  initItem(type, off, items) {
    if (type.kind === 'array' && isCharType(type.of)) {
      const braced = this.isOp('{') && this.peek(1).k === 'str';
      if (braced || this.peek().k === 'str') {
        const at = this.peek();
        if (braced) this.next();
        const bytes = this.stringBytes();
        if (braced) { this.eatOp(','); this.expectOp('}'); }
        const length = type.length ?? bytes.length + 1;
        if (bytes.length > length) this.err(`String of ${bytes.length} characters does not fit in an array of ${length}`, at);
        items.push({ off, str: bytes });
        return array(type.of, length);
      }
    }
    if (this.isOp('{')) {
      this.next();
      if (isScalar(type)) {
        this.scalarInit(type, off, items);
        this.eatOp(',');
        this.expectOp('}');
        return type;
      }
      const done = this.initBraced(type, off, items);
      this.expectOp('}');
      return done;
    }
    if (isScalar(type)) { this.scalarInit(type, off, items); return type; }
    if (isRecord(type)) {
      const save = this.p;
      const e = this.assignExpr();
      if (isRecord(e.type) && record(e.type) === record(type)) { items.push({ off, type, e }); return type; }
      this.p = save;
    }
    return this.initElided(type, off, items);
  }

  initMember(type, off, items, idx) {
    if (isRecord(type)) {
      const f = record(type).fields[idx];
      if (f.bf) this.scalarInit(f.type, off + f.off, items, f.bf);
      else this.initItem(f.type, off + f.off, items);
    } else this.initItem(type.of, off + idx * type.of.size, items);
  }

  // Parses one designator (`.name` or `[index]`) and returns the member index it selects in `type`.
  designator(type, at) {
    if (isRecord(type)) {
      const rec = record(type);
      if (!rec.fields) this.err(`Cannot initialise the incomplete type '${typeName(type)}'`, at);
      if (!this.eatOp('.')) this.err(`Expected '.member' to select part of '${typeName(type)}'`);
      const name = this.expectId();
      const idx = rec.fields.findIndex(f => f.name === name.v);
      if (idx < 0) this.err(`'${typeName(type)}' has no member named '${name.v}'`, name);
      return idx;
    }
    if (type.kind !== 'array' || !this.eatOp('[')) this.err(`A designator cannot be applied to '${typeName(type)}'`, at);
    const idx = this.constInt();
    this.expectOp(']');
    if (idx < 0 || (type.length !== null && idx >= type.length)) this.err(`Index ${idx} is outside an array of ${type.length}`, at);
    return idx;
  }

  memberAt(type, off, idx) {
    if (isRecord(type)) {
      const f = record(type).fields[idx];
      return { type: f.type, off: off + f.off, bf: f.bf };
    }
    return { type: type.of, off: off + idx * type.of.size };
  }

  initBraced(type, off, items) {
    const rec = isRecord(type) ? record(type) : null;
    if (rec && !rec.fields) this.err(`Cannot initialise the incomplete type '${typeName(type)}'`);
    let idx = 0, count = 0;
    while (!this.isOp('}')) {
      const at = this.peek();
      let nested = null;
      if ((rec && this.isOp('.')) || (!rec && this.isOp('['))) {
        idx = this.designator(type, at);
        // A designator may reach into nested aggregates: `.data.button.id = 2` or `[1].x = 3`.
        let cur = this.memberAt(type, off, idx);
        while (this.isOp('.') || this.isOp('[')) {
          cur = this.memberAt(cur.type, cur.off, this.designator(cur.type, at));
          nested = cur;
        }
        this.expectOp('=');
      }
      const limit = rec ? rec.fields.length : type.length;
      if (limit !== null && idx >= limit) this.err(rec ? `Too many initialisers for '${typeName(type)}'` : `Too many initialisers for an array of ${limit}`, at);
      if (!nested) this.initMember(type, off, items, idx);
      else if (nested.bf) this.scalarInit(nested.type, nested.off, items, nested.bf);
      else this.initItem(nested.type, nested.off, items);
      idx = type.kind === 'union' ? rec.fields.length : idx + 1;
      count = Math.max(count, idx);
      if (!this.eatOp(',')) break;
    }
    return type.kind === 'array' && type.length === null ? array(type.of, count) : type;
  }

  // Initialises an aggregate whose braces were left out, as in `int m[2][2] = {1, 2, 3, 4}`.
  initElided(type, off, items) {
    const rec = isRecord(type) ? record(type) : null;
    if (!rec && type.length === null) this.err('Cannot work out the size of this array');
    const n = rec ? (type.kind === 'union' ? 1 : rec.fields.length) : type.length;
    for (let i = 0; i < n; i++) {
      if (i > 0) {
        if (!this.isOp(',') || this.isOp('}', 1) || this.isOp('.', 1) || this.isOp('[', 1)) break;
        this.next();
      }
      this.initMember(type, off, items, i);
    }
    return type;
  }

  // ---- statements --------------------------------------------------------------

  compound(newScope = true) {
    const open = this.expectOp('{');
    if (newScope) this.scope = new Scope(this.scope);
    const body = [];
    while (!this.isOp('}')) {
      if (this.peek().k === 'eof') this.err("Missing '}' to close this block", open);
      body.push(this.statement());
    }
    this.next();
    if (newScope) this.scope = this.scope.parent;
    return { k: 'block', body, line: open.line, file: open.file };
  }

  condition() {
    this.expectOp('(');
    const at = this.peek();
    const e = this.rv(this.expr());
    if (!isScalar(e.type)) this.err(`A condition must be a number or a pointer, not '${typeName(e.type)}'`, at);
    if (e.k === 'assign' && !e.parens) this.warn("Assignment used as a condition; did you mean '=='?", at);
    this.expectOp(')');
    return e;
  }

  statement() {
    const t = this.peek();
    const at = { line: t.line, file: t.file };
    if (this.pragma()) return { k: 'empty', ...at };
    if (t.k === 'op' && t.v === '{') return this.compound();
    if (t.k === 'op' && t.v === ';') { this.next(); return { k: 'empty', ...at }; }
    if (t.k === 'id') {
      switch (t.v) {
        case 'if': {
          this.next();
          const c = this.condition();
          if (this.isOp(';')) this.warn("This 'if' has an empty body; remove the ';'", this.peek());
          const a = this.statement();
          const b = this.eatId('else') ? this.statement() : null;
          return { k: 'if', c, a, b, ...at };
        }
        case 'while': {
          this.next();
          const c = this.condition();
          return { k: 'while', c, body: this.loopBody(), ...at };
        }
        case 'do': {
          this.next();
          const body = this.loopBody();
          if (!this.eatId('while')) this.err(`Expected 'while' after the body of 'do' but found ${this.describe()}`);
          const c = this.condition();
          this.expectOp(';');
          return { k: 'dowhile', c, body, ...at };
        }
        case 'for': {
          this.next();
          this.expectOp('(');
          this.scope = new Scope(this.scope);
          let init = null;
          if (this.isTypeStart()) init = { k: 'block', body: this.declaration(), ...at };
          else if (!this.eatOp(';')) { init = { k: 'expr', e: this.expr(), ...at }; this.expectOp(';'); }
          let c = null;
          if (!this.isOp(';')) {
            c = this.rv(this.expr());
            if (!isScalar(c.type)) this.err(`A condition must be a number or a pointer, not '${typeName(c.type)}'`, t);
          }
          this.expectOp(';');
          const step = this.isOp(')') ? null : this.expr();
          this.expectOp(')');
          const body = this.loopBody();
          this.scope = this.scope.parent;
          return { k: 'for', init, c, step, body, ...at };
        }
        case 'switch': return this.switchStatement();
        case 'return': {
          this.next();
          const ret = this.fn.ret;
          let e = null;
          if (!this.isOp(';')) {
            e = this.rv(this.expr());
            if (ret.kind === 'void') {
              if (e.type.kind !== 'void') this.err(`'${this.fn.name}' returns void, so it cannot return a value`, t);
            } else e = this.assignConv(e, ret, 'return', t);
          } else if (ret.kind !== 'void') this.err(`'${this.fn.name}' must return a value of type '${typeName(ret)}'`, t);
          this.expectOp(';');
          return { k: 'return', e, ...at };
        }
        case 'break':
          this.next();
          if (!this.breakable) this.err("'break' is only allowed inside a loop or a switch", t);
          this.expectOp(';');
          return { k: 'break', ...at };
        case 'continue':
          this.next();
          if (!this.loops) this.err("'continue' is only allowed inside a loop", t);
          this.expectOp(';');
          return { k: 'continue', ...at };
        case 'case': case 'default':
          this.err(`'${t.v}' labels must sit directly inside the braces of a switch`);
          break;
        case 'else': this.err("'else' without a matching 'if'"); break;
        case 'goto': {
          this.next();
          const label = this.expectId();
          this.expectOp(';');
          this.fn.gotos.push(label);
          return { k: 'goto', name: label.v, ...at };
        }
        case '_Static_assert': this.staticAssert(); return { k: 'empty', ...at };
        default:
          if (!KEYWORDS.has(t.v) && this.isOp(':', 1)) {
            this.p += 2;
            if (this.fn.labels.has(t.v)) this.err(`Label '${t.v}' is already defined in this function`, t);
            this.fn.labels.set(t.v, t);
            // A label names a statement; one at the very end of a block names an empty one.
            const body = this.isOp('}') ? { k: 'empty', ...at } : this.statement();
            return { k: 'label', name: t.v, body, ...at };
          }
          if (this.isTypeStart(t)) {
            const stmts = this.declaration();
            return stmts.length === 1 ? stmts[0] : { k: 'block', body: stmts, ...at };
          }
          if (!KEYWORDS.has(t.v) && this.peek(1).k === 'id' && !this.scope.find(t.v)) this.err(`Unknown type name '${t.v}'`);
      }
    }
    const e = this.expr();
    if (e.k === 'cmp' && e.op === '==') this.warn("This '==' comparison has no effect; did you mean '='?", t);
    this.expectOp(';');
    return { k: 'expr', e, ...at };
  }

  loopBody() {
    this.loops++; this.breakable++;
    if (this.isOp(';') && !this.peek(1).nl && this.isOp('{', 1)) this.warn("This loop has an empty body; remove the ';'", this.peek());
    const body = this.statement();
    this.loops--; this.breakable--;
    return body;
  }

  switchStatement() {
    const t = this.next();
    this.expectOp('(');
    let e = this.rv(this.expr());
    if (!isInt(e.type)) this.err(`A switch needs an integer, not '${typeName(e.type)}'`, t);
    e = this.cast(e, promote(e.type));
    this.expectOp(')');
    if (!this.isOp('{')) this.err("Expected '{' after switch (...)");
    this.next();
    this.scope = new Scope(this.scope);
    this.breakable++;
    const body = [], cases = new Map();
    let def;
    while (!this.isOp('}')) {
      const at = this.peek();
      if (at.k === 'eof') this.err("Missing '}' to close this switch", t);
      if (this.eatId('case')) {
        const key = String(convert(this.constValue(), e.type));
        this.expectOp(':');
        if (cases.has(key)) this.err(`Duplicate case value ${key}`, at);
        cases.set(key, body.length);
      } else if (this.eatId('default')) {
        this.expectOp(':');
        if (def !== undefined) this.err("A switch can have only one 'default'", at);
        def = body.length;
      } else {
        if (!cases.size && def === undefined) this.err("Statements in a switch must come after a 'case' or 'default' label", at);
        body.push(this.statement());
      }
    }
    this.next();
    this.breakable--;
    this.scope = this.scope.parent;
    return { k: 'switch', e, body, cases, def, line: t.line, file: t.file };
  }

  // ---- expressions -------------------------------------------------------------

  num(v, type, t) { return { k: 'num', v: convert(v, type), type, line: t.line, file: t.file }; }

  // Value conversions: an array becomes a pointer to its first element.
  rv(e) {
    if (e.type.kind === 'array') return { k: 'decay', e, type: ptr(e.type.of), line: e.line, file: e.file };
    return e;
  }

  cast(e, type) {
    if (sameType(e.type, type) && !!e.type.const === !!type.const) return e;
    if (e.k === 'num' && isScalar(type)) return { ...e, v: convert(e.v, type), type };
    return { k: 'cast', e, type, line: e.line, file: e.file };
  }

  // Converts `e` to `to` as an assignment would, complaining about the conversions a compiler would flag.
  assignConv(e, to, what, t) {
    const from = e.type;
    if (from.kind === 'void') this.err(`A void expression has no value to use in ${what}`, t);
    if (isArith(to) && isArith(from)) return this.cast(e, to);
    if (to.kind === 'int' && to.bool && isPtr(from)) return this.cast(e, to);
    if (isPtr(to)) {
      if (isPtr(from)) {
        const a = to.to, b = from.to;
        if (a.kind !== 'void' && b.kind !== 'void' && !sameType(a, b) && !(a.kind === 'func' && b.kind === 'func')) {
          this.warn(`${cap(what)} from incompatible pointer type: '${typeName(from)}' used as '${typeName(to)}'`, t);
        } else if (b.const && !a.const && b.kind !== 'func') {
          this.warn(`${cap(what)} discards the 'const' qualifier of '${typeName(from)}'`, t);
        }
        return this.cast(e, to);
      }
      if (isInt(from)) {
        if (!isZero(e)) this.warn(`${cap(what)} makes a pointer from an integer without a cast`, t);
        return this.cast(e, to);
      }
    }
    if (isInt(to) && isPtr(from)) {
      this.warn(`${cap(what)} makes an integer from a pointer without a cast`, t);
      return this.cast(e, to);
    }
    if (isRecord(to) && isRecord(from) && record(to) === record(from)) return e;
    this.err(`Incompatible types in ${what}: cannot use '${typeName(from)}' as '${typeName(to)}'`, t);
  }

  constValue(message) {
    const at = this.peek();
    const e = this.condExpr();
    const v = fold(e);
    if (v === undefined || !isInt(e.type)) this.err(message || 'Expected a constant integer expression', at);
    return v;
  }
  constInt(message) { return Number(this.constValue(message)); }

  // The length between '[' and ']' of an array declarator: a constant, or for a local array an
  // expression worked out when the declaration runs (a variable-length array).
  arrayLength() {
    const at = this.peek();
    if (this.paramDepth) {
      // `int a[n]` in a parameter list is just a pointer, and `n` may be an earlier parameter.
      const save = this.p;
      try {
        const length = this.constInt();
        if (length < 0) this.err('Array size is negative', at);
        return { length };
      } catch (e) {
        if (!(e instanceof CError) || /negative/.test(e.message)) throw e;
        this.p = save;
        for (let depth = 0; !(depth === 0 && this.isOp(']')); ) {
          const t = this.next();
          if (t.k === 'eof') this.err("Missing ']'", at);
          if (t.k === 'op' && t.v === '[') depth++;
          if (t.k === 'op' && t.v === ']') depth--;
        }
        return { length: null };
      }
    }
    const e = this.rv(this.assignExpr());
    const v = fold(e);
    if (!isInt(e.type)) this.err(`An array size must be an integer, not '${typeName(e.type)}'`, at);
    if (v !== undefined) {
      if (Number(v) < 0) this.err('Array size is negative', at);
      return { length: Number(v) };
    }
    if (!this.fn) this.err('The size of an array outside a function must be a constant', at);
    return { length: null, vla: this.cast(e, INT) };
  }

  expr() {
    let e = this.assignExpr();
    while (this.isOp(',')) {
      const t = this.next();
      const r = this.rv(this.assignExpr());
      e = { k: 'comma', l: e, r, type: r.type, line: t.line, file: t.file };
    }
    return e;
  }

  assignExpr() {
    const l = this.condExpr();
    const t = this.peek();
    if (t.k !== 'op' || !ASSIGN.has(t.v)) return l;
    this.next();
    const r = this.rv(this.assignExpr());
    this.assignable(l, t);
    const at = { line: t.line, file: t.file };
    if (t.v === '=') return { k: 'assign', l, r: this.assignConv(r, l.type, 'assignment', t), type: l.type, ...at };
    const op = t.v.slice(0, -1);
    if (isPtr(l.type) && (op === '+' || op === '-') && isInt(r.type)) {
      return { k: 'opassign', op, l, r: this.cast(r, promote(r.type)), scale: this.pointeeSize(l.type, t), type: l.type, ...at };
    }
    this.checkOperands(op, l, r, t);
    const isShift = op === '<<' || op === '>>';
    const ct = isShift ? promote(l.type) : commonType(l.type, r.type);
    return { k: 'opassign', op, l, r: this.cast(r, isShift ? promote(r.type) : ct), ct, type: l.type, ...at };
  }

  assignable(l, t) {
    if (!l.lv) this.err('The left side of this assignment is not something that can be assigned to', t);
    if (l.type.kind === 'array') this.err('An array cannot be assigned to; copy its elements instead', t);
    if (l.type.const) this.err(`Cannot modify ${l.name ? `'${l.name}'` : 'this object'}: it is const`, t);
  }

  pointeeSize(type, t) {
    const to = type.to;
    if (to.kind === 'func') this.err('Arithmetic on a function pointer is not allowed', t);
    if (isRecord(to) && !record(to).fields) this.err(`Arithmetic on a pointer to the incomplete type '${typeName(to)}'`, t);
    return to.kind === 'void' ? 1 : to.size;
  }

  condExpr() {
    const c = this.binary(1);
    if (!this.isOp('?')) return c;
    const t = this.next();
    const cond = this.rv(c);
    if (!isScalar(cond.type)) this.err(`A condition must be a number or a pointer, not '${typeName(cond.type)}'`, t);
    let a = this.rv(this.expr());
    this.expectOp(':');
    let b = this.rv(this.condExpr());
    let type;
    if (isArith(a.type) && isArith(b.type)) { type = commonType(a.type, b.type); a = this.cast(a, type); b = this.cast(b, type); }
    else if (isPtr(a.type) && (isPtr(b.type) || isZero(b))) { type = isPtr(b.type) && a.type.to.kind === 'void' ? b.type : a.type; a = this.cast(a, type); b = this.cast(b, type); }
    else if (isPtr(b.type) && isZero(a)) { type = b.type; a = this.cast(a, type); }
    else if (a.type.kind === 'void' && b.type.kind === 'void') type = VOID;
    else if (isRecord(a.type) && isRecord(b.type) && record(a.type) === record(b.type)) type = a.type;
    else this.err(`The two results of '?:' have incompatible types ('${typeName(a.type)}' and '${typeName(b.type)}')`, t);
    return { k: 'cond', c: cond, a, b, type, line: t.line, file: t.file };
  }

  binary(min) {
    let l = this.castExpr();
    for (;;) {
      const t = this.peek();
      const prec = t.k === 'op' ? PREC[t.v] : undefined;
      if (prec === undefined || prec < min) return l;
      this.next();
      const r = this.binary(prec + 1);
      l = this.makeBinary(t, l, r);
    }
  }

  checkOperands(op, l, r, t) {
    const intOnly = op === '%' || op === '&' || op === '|' || op === '^' || op === '<<' || op === '>>';
    const ok = intOnly ? isInt(l.type) && isInt(r.type) : isArith(l.type) && isArith(r.type);
    if (!ok) this.err(`Invalid operands to '${op}' ('${typeName(l.type)}' and '${typeName(r.type)}')`, t);
  }

  makeBinary(t, l, r) {
    l = this.rv(l); r = this.rv(r);
    const op = t.v, at = { line: t.line, file: t.file };
    const lt = l.type, rt = r.type;
    if (lt.kind === 'void' || rt.kind === 'void') this.err(`A void expression has no value to use with '${op}'`, t);
    if (op === '&&' || op === '||') {
      if (!isScalar(lt) || !isScalar(rt)) this.err(`Invalid operands to '${op}' ('${typeName(lt)}' and '${typeName(rt)}')`, t);
      return { k: op === '&&' ? 'land' : 'lor', l, r, type: INT, ...at };
    }
    if (op === '+' || op === '-') {
      if (isPtr(lt) && isInt(rt)) return { k: 'padd', p: l, i: this.cast(r, promote(rt)), scale: this.pointeeSize(lt, t), sign: op === '+' ? 1 : -1, type: lt, ...at };
      if (op === '+' && isInt(lt) && isPtr(rt)) return { k: 'padd', p: r, i: this.cast(l, promote(lt)), scale: this.pointeeSize(rt, t), sign: 1, type: rt, ...at };
      if (op === '-' && isPtr(lt) && isPtr(rt)) return { k: 'pdiff', l, r, scale: this.pointeeSize(lt, t), type: INT, ...at };
    }
    if (op === '==' || op === '!=' || op === '<' || op === '>' || op === '<=' || op === '>=') {
      if (isPtr(lt) || isPtr(rt)) {
        if (!(isPtr(lt) || isInt(lt)) || !(isPtr(rt) || isInt(rt))) this.err(`Invalid operands to '${op}' ('${typeName(lt)}' and '${typeName(rt)}')`, t);
        if ((isInt(lt) && !isZero(l)) || (isInt(rt) && !isZero(r))) this.warn('Comparison between a pointer and an integer', t);
        return { k: 'cmp', op, l: this.cast(l, UINT), r: this.cast(r, UINT), type: INT, ...at };
      }
      this.checkOperands(op, l, r, t);
      const ct = commonType(lt, rt);
      if (ct.kind === 'int' && ct.unsigned && op !== '==' && op !== '!=') {
        // A narrower unsigned operand is promoted to int but can never be negative, so it is harmless.
        const negative = e => !e.type.unsigned && !(e.k === 'num' && Number(e.v) >= 0);
        if (negative(l) || negative(r)) this.warn(`Comparison between signed and unsigned values: the signed one is converted to '${typeName(ct)}' first`, t);
      }
      return { k: 'cmp', op, l: this.cast(l, ct), r: this.cast(r, ct), type: INT, ...at };
    }
    this.checkOperands(op, l, r, t);
    if (op === '<<' || op === '>>') {
      const type = promote(lt);
      const node = { k: 'shift', op, l: this.cast(l, type), r: this.cast(r, promote(rt)), type, ...at };
      if (r.k === 'num' && (Number(r.v) < 0 || Number(r.v) >= type.size * 8)) this.warn(`Shift count ${r.v} is out of range for a ${type.size * 8}-bit value (undefined behaviour)`, t);
      return node;
    }
    const type = commonType(lt, rt);
    return { k: 'bin', op, l: this.cast(l, type), r: this.cast(r, type), type, ...at };
  }

  castExpr() {
    if (this.isOp('(') && this.isTypeStart(this.peek(1))) {
      const t = this.next();
      const type = this.typeName();
      this.expectOp(')');
      if (this.isOp('{')) return this.postfix(this.compoundLiteral(type, t));
      const e = this.rv(this.castExpr());
      const at = { line: t.line, file: t.file };
      if (type.kind === 'void') return { k: 'cast', e, type: VOID, ...at };
      if (!isScalar(type)) this.err(`Cannot cast to '${typeName(type)}'; only numbers and pointers can be cast`, t);
      if (!isScalar(e.type)) this.err(`Cannot cast '${typeName(e.type)}' to '${typeName(type)}'`, t);
      if ((isPtr(type) && e.type.kind === 'float') || (type.kind === 'float' && isPtr(e.type))) this.err('Cannot convert between a pointer and a floating-point value', t);
      const node = this.cast(e, type);
      return node === e ? { ...e, type } : node;
    }
    return this.unary();
  }

  compoundLiteral(type, t) {
    const { type: done, items } = this.initializer(type);
    const base = this.alloc(done);
    return { k: 'complit', base, items, type: done, lv: true, line: t.line, file: t.file };
  }

  unary() {
    const t = this.peek();
    const at = { line: t.line, file: t.file };
    if (t.k === 'op') {
      switch (t.v) {
        case '++': case '--': {
          this.next();
          const e = this.unary();
          return this.incdec(e, t, true);
        }
        case '&': {
          this.next();
          const e = this.castExpr();
          if (e.k === 'fptr') return e;
          if (!e.lv) this.err("'&' needs something with an address, such as a variable", t);
          if (e.bf) this.err('Cannot take the address of a bit-field', t);
          return { k: 'addr', e, type: ptr(e.type), ...at };
        }
        case '*': {
          this.next();
          return this.deref(this.rv(this.castExpr()), t);
        }
        case '-': case '+': {
          this.next();
          const e = this.rv(this.castExpr());
          if (!isArith(e.type)) this.err(`Invalid operand to unary '${t.v}' ('${typeName(e.type)}')`, t);
          const type = promote(e.type);
          const c = this.cast(e, type);
          if (t.v === '+') return c === e ? { ...e } : c;
          if (c.k === 'num') return this.num(type.kind === 'float' ? -c.v : arith('-', convert(0, type), c.v, type), type, t);
          return { k: 'neg', e: c, type, ...at };
        }
        case '~': {
          this.next();
          const e = this.rv(this.castExpr());
          if (!isInt(e.type)) this.err(`'~' needs an integer, not '${typeName(e.type)}'`, t);
          const type = promote(e.type);
          return { k: 'bnot', e: this.cast(e, type), type, ...at };
        }
        case '!': {
          this.next();
          const e = this.rv(this.castExpr());
          if (!isScalar(e.type)) this.err(`'!' needs a number or a pointer, not '${typeName(e.type)}'`, t);
          return { k: 'lnot', e, type: INT, ...at };
        }
      }
    }
    if (t.k === 'id' && t.v === 'sizeof') {
      this.next();
      let type;
      if (this.isOp('(') && this.isTypeStart(this.peek(1))) {
        this.next();
        type = this.typeName();
        this.expectOp(')');
      } else {
        const e = this.unary();
        if (e.bf) this.err('sizeof cannot be applied to a bit-field', t);
        type = e.type;
        // The one sizeof that is worked out while the program runs.
        if (type.vla) return { k: 'vlasize', off: type.vla.sizeOff, type: UINT, ...at };
      }
      if (type.kind === 'func') this.err('sizeof cannot be applied to a function', t);
      if ((isRecord(type) && !record(type).fields) || (type.kind === 'array' && type.length === null)) this.err(`sizeof cannot be applied to the incomplete type '${typeName(type)}'`, t);
      return this.num(type.size, UINT, t);
    }
    if (t.k === 'id' && (t.v === '_Alignof' || t.v === 'alignof' || t.v === '__alignof__')) {
      this.next();
      this.expectOp('(');
      const type = this.typeName();
      this.expectOp(')');
      return this.num(type.align, UINT, t);
    }
    return this.postfix(this.primary());
  }

  deref(e, t) {
    if (!isPtr(e.type)) this.err(`Cannot dereference '${typeName(e.type)}': it is not a pointer`, t);
    const to = e.type.to;
    if (to.kind === 'func') return e;
    if (to.kind === 'void') this.err("Cannot dereference a 'void *': cast it to a concrete pointer type first", t);
    if (isRecord(to) && !record(to).fields) this.err(`Cannot dereference a pointer to the incomplete type '${typeName(to)}'`, t);
    return { k: 'deref', e, type: to, lv: true, line: t.line, file: t.file };
  }

  incdec(e, t, prefix) {
    this.assignable(e, t);
    if (!isScalar(e.type)) this.err(`'${t.v}' needs a number or a pointer, not '${typeName(e.type)}'`, t);
    const scale = isPtr(e.type) ? this.pointeeSize(e.type, t) : 1;
    return { k: 'incdec', e, delta: t.v === '++' ? scale : -scale, prefix, type: e.type, line: t.line, file: t.file };
  }

  member(e, t) {
    const name = this.expectId();
    let base = e;
    if (t.v === '->') {
      base = this.rv(e);
      if (!isPtr(base.type) || !isRecord(base.type.to)) {
        this.err(isRecord(base.type) ? `'${name.v}' is reached through a struct, not a pointer: use '.' instead of '->'` : `'->' needs a pointer to a struct or union, not '${typeName(base.type)}'`, t);
      }
      base = this.deref(base, t);
    } else if (!isRecord(e.type)) {
      this.err(isPtr(e.type) && isRecord(e.type.to) ? `'${name.v}' is reached through a pointer: use '->' instead of '.'` : `'.' needs a struct or union, not '${typeName(e.type)}'`, t);
    }
    const rec = record(base.type);
    if (!rec.fields) this.err(`'${typeName(base.type)}' is an incomplete type`, t);
    const f = rec.fields.find(x => x.name === name.v);
    if (!f) this.err(`'${typeName(base.type)}' has no member named '${name.v}'`, name);
    return { k: 'member', e: base, off: f.off, bf: f.bf, type: qualify(f.type, !!base.type.const), lv: !!base.lv, name: name.v, line: t.line, file: t.file };
  }

  call(callee, t) {
    const args = [];
    if (!this.isOp(')')) do { args.push({ e: this.rv(this.assignExpr()), at: this.toks[this.p - 1] }); } while (this.eatOp(','));
    this.expectOp(')');
    let fn = null, ft, name = 'the function';
    if (callee.k === 'fptr') { fn = callee.fn; ft = fn.type; name = `'${fn.name}'`; fn.used = fn.used || t; }
    else {
      callee = this.rv(callee);
      if (!isPtr(callee.type) || callee.type.to.kind !== 'func') this.err(`This is not a function, so it cannot be called (it has type '${typeName(callee.type)}')`, t);
      ft = callee.type.to;
    }
    const n = ft.params.length;
    if (!ft.unspecified && (args.length < n || (args.length > n && !ft.variadic))) {
      this.err(`${cap(name)} takes ${plural(n, 'argument')}, but ${args.length} ${args.length === 1 ? 'was' : 'were'} given`, t);
    }
    const converted = args.map(({ e, at }, i) => {
      if (i < n) return this.assignConv(e, ft.params[i].type, `argument ${i + 1} of ${name}`, at);
      if (e.type.kind === 'void') this.err('A void expression cannot be passed as an argument', at);
      return isArith(e.type) ? this.cast(e, e.type.kind === 'float' ? DOUBLE : promote(e.type)) : e;
    });
    const node = { k: fn ? 'call' : 'icall', fn, e: callee, args: converted, type: ft.ret, line: t.line, file: t.file };
    if (isRecord(ft.ret)) {
      if (!this.fn) this.err('A function returning a struct cannot be called in a global initialiser', t);
      node.tmp = this.allocLocal(ft.ret).off;
    }
    return node;
  }

  postfix(e) {
    for (;;) {
      const t = this.peek();
      if (t.k !== 'op') return e;
      if (t.v === '[') {
        this.next();
        const index = this.expr();
        this.expectOp(']');
        const l = this.rv(e), r = this.rv(index);
        if (!(isPtr(l.type) && isInt(r.type)) && !(isInt(l.type) && isPtr(r.type))) {
          this.err(isPtr(l.type) ? `An array index must be an integer, not '${typeName(r.type)}'` : `'[]' needs an array or a pointer, not '${typeName(l.type)}'`, t);
        }
        e = this.deref(this.makeBinary({ ...t, v: '+' }, l, r), t);
      } else if (t.v === '(') {
        this.next();
        e = this.call(e, t);
      } else if (t.v === '.' || t.v === '->') {
        this.next();
        e = this.member(e, t);
      } else if (t.v === '++' || t.v === '--') {
        this.next();
        e = this.incdec(e, t, false);
      } else return e;
    }
  }

  primary() {
    const t = this.next();
    const at = { line: t.line, file: t.file };
    if (t.k === 'num') {
      if (t.isFloat) return { k: 'num', v: t.single ? Math.fround(t.v) : t.v, type: t.single ? FLOAT : DOUBLE, ...at };
      if (t.isChar) return this.num(t.v, INT, t);
      const v = t.v;
      if (v > 0xFFFFFFFFFFFFFFFFn) this.err('Integer constant is too large for any type', t);
      let type;
      if (t.unsigned) type = t.longs >= 2 || v > 0xFFFFFFFFn ? ULLONG : UINT;
      else if (t.longs >= 2) type = v > 0x7FFFFFFFFFFFFFFFn ? ULLONG : LLONG;
      else if (v <= 0x7FFFFFFFn) type = INT;
      else if (v <= 0xFFFFFFFFn && t.based) type = UINT;
      else if (v <= 0x7FFFFFFFFFFFFFFFn) type = LLONG;
      else type = ULLONG;
      return this.num(v, type, t);
    }
    if (t.k === 'str') {
      this.p--;
      const bytes = this.stringBytes();
      return { k: 'str', addr: this.intern(bytes), type: array(CHAR, bytes.length + 1), lv: true, ...at };
    }
    if (t.k === 'op' && t.v === '(') {
      const e = this.expr();
      this.expectOp(')');
      return e.k === 'assign' ? { ...e, parens: true } : e;
    }
    if (t.k === 'id') {
      if (t.v === '__builtin_offsetof') return this.offsetOf(t);
      if (t.v.startsWith('__builtin_va_')) return this.vaBuiltin(t);
      if (t.v === '__func__' || t.v === '__FUNCTION__') {
        const bytes = [...(this.fn ? this.fn.name : '')].map(c => c.charCodeAt(0));
        return { k: 'str', addr: this.intern(bytes), type: array(CHAR, bytes.length + 1), lv: true, ...at };
      }
      if (t.v === '__LINE__') return this.num(t.line, INT, t);
      if (KEYWORDS.has(t.v)) this.err(`Unexpected '${t.v}'`, t);
      const sym = this.scope.find(t.v);
      if (!sym) {
        this.err(this.isOp('(') ? `'${t.v}' is not declared; define it (or add a prototype) before this call` : `'${t.v}' is not declared`, t);
      }
      if (sym.kind === 'var') return { ...sym.node, ...at };
      if (sym.kind === 'enum') return this.num(sym.value, INT, t);
      if (sym.kind === 'func') return { k: 'fptr', fn: sym.fn, type: ptr(sym.fn.type), ...at };
      this.err(`'${t.v}' is a type, not a value`, t);
    }
    this.err(`Expected an expression but found ${this.describe(t)}`, t);
  }

  // va_start, va_arg, va_end and va_copy. They take a type or need the enclosing function, so they
  // are parsed here instead of being declared as library functions.
  vaBuiltin(t) {
    const at = { line: t.line, file: t.file };
    const what = t.v.replace('__builtin_', '');
    if (!['va_start', 'va_arg', 'va_end', 'va_copy'].includes(what)) this.err(`'${t.v}' is not declared`, t);
    this.expectOp('(');
    const list = () => {
      const e = this.assignExpr();
      if (!isInt(e.type) || e.type.name !== 'va_list') this.err(`${what} needs a va_list, not '${typeName(e.type)}'`, t);
      return e;
    };
    const ap = list();
    let node;
    if (what === 'va_start') {
      if (!this.fn || !this.fn.variadic) this.err("va_start can only be used in a function whose parameter list ends in '...'", t);
      if (!ap.lv) this.err('va_start needs a va_list variable', t);
      this.expectOp(',');
      this.assignExpr(); // the last named parameter; nothing here depends on which one it is
      node = { k: 'vastart', ap, type: VOID, ...at };
    } else if (what === 'va_arg') {
      this.expectOp(',');
      const type = this.typeName();
      if (isInt(type) && (type.size < 4 || type.bool)) this.err(`va_arg(ap, ${typeName(type)}) can never be right: a '${typeName(type)}' argument is promoted to 'int' when it is passed through '...'. Use va_arg(ap, int)`, t);
      if (type.kind === 'float' && type.size === 4) this.err("va_arg(ap, float) can never be right: a 'float' argument is promoted to 'double' when it is passed through '...'. Use va_arg(ap, double)", t);
      if (!isScalar(type) && !(isRecord(type) && record(type).fields)) this.err(`va_arg cannot fetch a '${typeName(type)}'`, t);
      node = { k: 'vaarg', ap, type, ...at };
    } else if (what === 'va_copy') {
      if (!ap.lv) this.err('va_copy needs a va_list variable as its destination', t);
      this.expectOp(',');
      node = { k: 'vacopy', ap, src: list(), type: VOID, ...at };
    } else node = { k: 'vaend', ap, type: VOID, ...at };
    this.expectOp(')');
    return node;
  }

  offsetOf(t) {
    this.expectOp('(');
    let type = this.typeName();
    this.expectOp(',');
    let off = 0;
    do {
      const name = this.expectId();
      if (!isRecord(type) || !record(type).fields) this.err(`offsetof needs a complete struct or union, not '${typeName(type)}'`, t);
      const f = record(type).fields.find(x => x.name === name.v);
      if (!f) this.err(`'${typeName(type)}' has no member named '${name.v}'`, name);
      if (f.bf) this.err('offsetof cannot be applied to a bit-field', name);
      off += f.off;
      type = f.type;
      while (this.eatOp('[')) {
        if (type.kind !== 'array') this.err('Only an array can be indexed in offsetof', t);
        off += this.constInt() * type.of.size;
        type = type.of;
        this.expectOp(']');
      }
    } while (this.eatOp('.'));
    this.expectOp(')');
    return this.num(off, UINT, t);
  }
}

const cap = s => s[0].toUpperCase() + s.slice(1);

// The value written into the shadow memory between local variables; see machine.js.
export const SHADOW_STACK_GAP = 6;
// The value for memory that may be written but has not been given a value yet.
export const SHADOW_UNINIT = 8;

// Records which labels each statement contains, so a goto can find its way to one: `labels` on every
// statement with a label inside it, and on blocks and switches `labelIdx`, the child that leads there.
function labelsIn(s) {
  let found = null;
  const add = names => { if (names) { found = found || new Set(); for (const n of names) found.add(n); } };
  switch (s.k) {
    case 'label': add([s.name]); add(labelsIn(s.body)); break;
    case 'block': case 'switch':
      s.body.forEach((child, i) => {
        const inside = labelsIn(child);
        if (!inside) return;
        s.labelIdx = s.labelIdx || new Map();
        for (const n of inside) s.labelIdx.set(n, i);
        add(inside);
      });
      break;
    case 'if': add(labelsIn(s.a)); if (s.b) add(labelsIn(s.b)); break;
    case 'while': case 'dowhile': case 'for': add(labelsIn(s.body)); break;
  }
  if (found) s.labels = found;
  return found;
}

// Constant folding for array sizes, case labels, enum values and static assertions.
// Returns undefined when the expression is not a compile-time constant.
export function fold(e) {
  const t = e.type;
  switch (e.k) {
    case 'num': return e.v;
    case 'cast': { const v = fold(e.e); return v === undefined || !isScalar(t) ? undefined : convert(v, t); }
    case 'neg': { const v = fold(e.e); return v === undefined ? undefined : t.kind === 'float' ? -v : arith('-', convert(0, t), v, t); }
    case 'bnot': { const v = fold(e.e); return v === undefined ? undefined : convert(~v, t); }
    case 'lnot': { const v = fold(e.e); return v === undefined ? undefined : (Number(v) === 0 ? 1 : 0); }
    case 'bin': case 'shift': case 'cmp': {
      const l = fold(e.l), r = fold(e.r);
      if (l === undefined || r === undefined) return undefined;
      if (e.k === 'bin') return arith(e.op, l, r, t);
      if (e.k === 'shift') return shift(e.op, l, r, t);
      return compare(e.op, l, r);
    }
    case 'land': case 'lor': {
      const l = fold(e.l);
      if (l === undefined) return undefined;
      const lt = Number(l) !== 0;
      if (e.k === 'land' ? !lt : lt) return lt ? 1 : 0;
      const r = fold(e.r);
      return r === undefined ? undefined : (Number(r) !== 0 ? 1 : 0);
    }
    case 'cond': {
      const c = fold(e.c);
      if (c === undefined) return undefined;
      return fold(Number(c) !== 0 ? e.a : e.b);
    }
    default: return undefined;
  }
}
