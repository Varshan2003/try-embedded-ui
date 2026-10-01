import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runC, runCTests } from '../src/index.js';

const out = code => {
  const r = runC({ code });
  assert.equal(r.error, null, r.error?.message);
  return r.stdout;
};
const fails = (code, pattern) => {
  const r = runC({ code });
  assert.ok(r.error, 'expected an error');
  assert.match(r.error.message, pattern);
  return r;
};

test('integers follow the 32-bit target: promotion, wrapping and sign', () => {
  assert.equal(out(`int main(void) {
    uint8_t a = 200, b = 100; uint8_t c = a + b;
    int8_t s = (int8_t)0x80; uint32_t u = 0; u--;
    printf("%d %d %d %u %d %d", c, a + b, s >> 1, u, -1 < 1u, -17 % 5);
    return 0; }`), '44 300 -64 4294967295 0 -2');
  assert.equal(out('int main(void) { printf("%u %u %u %u", (unsigned)sizeof(int), (unsigned)sizeof(long), (unsigned)sizeof(void *), (unsigned)sizeof(long long)); return 0; }'), '4 4 4 8');
  assert.equal(out('int main(void) { uint64_t x = 1ULL << 40; printf("%llu %llx", x, x - 1); return 0; }'), '1099511627776 ffffffffff');
});

test('structs are laid out with padding, packing and bit-fields', () => {
  assert.equal(out(`
    typedef struct { uint8_t a; uint32_t b; uint16_t c; } padded_t;
    typedef struct __attribute__((packed)) { uint8_t a; uint32_t b; uint16_t c; } packed_t;
    #pragma pack(push, 1)
    typedef struct { uint8_t a; uint32_t b; } pragma_t;
    #pragma pack(pop)
    typedef union { uint8_t raw; struct { uint8_t en:1; uint8_t mode:3; uint8_t prio:4; } f; } reg_t;
    int main(void) {
      reg_t r = { .raw = 0 }; r.f.en = 1; r.f.mode = 5; r.f.prio = 0xA;
      printf("%u %u %u %u 0x%02X", (unsigned)sizeof(padded_t), (unsigned)offsetof(padded_t, b), (unsigned)sizeof(packed_t), (unsigned)sizeof(pragma_t), r.raw);
      return 0; }`), '12 4 7 5 0xAB');
});

test('pointers, function pointers and memory-mapped registers work', () => {
  assert.equal(out(`
    typedef struct { uint32_t MODER, ODR; } gpio_t;
    #define GPIOA ((gpio_t *)0x40020000)
    static int twice(int x) { return 2 * x; }
    static int apply(int (*f)(int), int v) { return f(v); }
    int main(void) {
      int a[4] = { 1, 2, 3, 4 }; int *p = a + 3; int **pp = &p;
      GPIOA->ODR |= 1u << 5; GPIOA->ODR &= ~(1u << 0);
      uint32_t w = 0x11223344; uint8_t *b = (uint8_t *)&w;
      printf("%d %d %d %x %02x", **pp, (int)(p - a), apply(twice, 21), GPIOA->ODR, b[0]);
      return 0; }`), '4 3 42 20 44');
});

test('the preprocessor handles macros, conditionals, stringify and pasting', () => {
  assert.equal(out(`
    #define MAX(a, b) ((a) > (b) ? (a) : (b))
    #define STR(x) #x
    #define REG(n) reg_##n
    #ifndef MISSING
    #define VALUE 7
    #else
    #define VALUE 9
    #endif
    #if VALUE > 5 && defined(VALUE)
    int reg_1 = 3;
    #endif
    int main(void) { printf("%d %s %d %d", MAX(2, VALUE), STR(a + b), REG(1), (int)UINT8_MAX); return 0; }`), '7 a + b 3 255');
});

test('memory errors are caught and explained', () => {
  fails('int main(void) { int a[4]; a[4] = 1; return 0; }', /past the end of a local variable/);
  fails('int g[2]; int main(void) { g[2] = 1; return 0; }', /past the end of a global variable/);
  fails('int main(void) { int *p = NULL; return *p; }', /Null pointer dereference/);
  fails('int *f(void) { int x = 3; return &x; } int main(void) { return *f(); }', /already returned/);
  fails('int main(void) { int *p = malloc(8); free(p); return p[0]; }', /Use after free/);
  fails('int main(void) { char *p = malloc(4); p[4] = 1; return 0; }', /Heap buffer overflow/);
  fails('int main(void) { char *p = malloc(4); free(p); free(p); return 0; }', /Double free/);
  fails('int main(void) { char *s = "abc"; s[0] = 1; return 0; }', /read-only memory/);
  fails('int main(void) { char a[4]; memcpy(a, "toolong", 8); return 0; }', /past the end of a local variable/);
});

test('undefined behaviour and runaway programs are reported with a line', () => {
  const r = fails('int main(void) {\n  int z = 0;\n  return 10 / z;\n}', /Division by zero/);
  assert.equal(r.error.line, 3);
  fails('int main(void) { int n = 40; return 1 << n; }', /undefined behaviour/);
  fails('int main(void) { for (;;) { } }', /ran for too long/);
  fails('int f(int n) { return f(n + 1); } int main(void) { return f(0); }', /Stack overflow/);
  fails('int f(int n) { if (n) return 1; } int main(void) { return f(0); }', /without returning a value/);
  fails('int main(void) { printf("%d", 1.5); return 0; }', /expects an integer/);
});

test('compile errors point at the right line', () => {
  const r = fails('int main(void) {\n  int x = 1\n  return x;\n}', /Expected ';'/);
  assert.equal(r.error.line, 2);
  assert.equal(r.compiled, false);
  fails('int main(void) { uint8 x = 1; return 0; }', /Unknown type name 'uint8'/);
  fails('int main(void) { return y; }', /'y' is not declared/);
  fails('int main(void) { const int k = 1; k = 2; return 0; }', /it is const/);
  fails('struct p { int x; }; int main(void) { struct p v; return v->x; }', /use '\.' instead/);
});

test('suspicious code compiles with warnings', () => {
  const r = runC({ code: 'int main(void) {\n  int x = 0;\n  if (x = 5) return 1;\n  return 0;\n}' });
  assert.equal(r.exitCode, 1);
  assert.deepEqual(r.diagnostics.map(d => [d.severity, d.line]), [['warning', 3]]);
});

const spec = {
  prelude: 'uint8_t set_bit(uint8_t reg, uint8_t pos);',
  tests: [
    { name: 'sets bit 3', code: 'printf("0x%02X\\n", set_bit(0x00, 3));', expect: '0x08' },
    { name: 'leaves other bits', code: 'printf("0x%02X\\n", set_bit(0x81, 4));', expect: '0x91\n' },
  ],
};

test('tests pass for a correct solution and report output for a wrong one', () => {
  const good = runCTests({ ...spec, code: 'uint8_t set_bit(uint8_t reg, uint8_t pos) { return reg | (1u << pos); }' });
  assert.deepEqual(good.tests.map(t => t.passed), [true, true]);
  const bad = runCTests({ ...spec, code: 'uint8_t set_bit(uint8_t reg, uint8_t pos) { return 1u << pos; }' });
  assert.deepEqual(bad.tests.map(t => t.passed), [true, false]);
  assert.equal(bad.tests[1].stdout, '0x10');
  assert.equal(bad.tests[1].expected, '0x91');
});

test('test results explain compile errors, crashes and missing functions', () => {
  const broken = runCTests({ ...spec, code: 'uint8_t set_bit(uint8_t reg, uint8_t pos) {\n  return reg |\n}' });
  assert.equal(broken.compiled, false);
  assert.equal(broken.diagnostics[0].line, 3);
  assert.ok(broken.tests.every(t => !t.passed));

  const missing = runCTests({ ...spec, prelude: '', code: '' });
  assert.equal(missing.compiled, false);
  assert.match(missing.diagnostics[0].message, /'set_bit' is not declared/);

  const withMain = runCTests({ ...spec, code: 'uint8_t set_bit(uint8_t r, uint8_t p) { return r | (1u << p); }\nint main(void) { return 0; }' });
  assert.match(withMain.diagnostics[0].message, /Remove your main/);

  const crash = runCTests({ ...spec, code: 'uint8_t set_bit(uint8_t reg, uint8_t pos) {\n  uint8_t *p = 0;\n  return *p;\n}' });
  assert.match(crash.tests[0].error, /Null pointer dereference.*line 3/);
});

test('forbidden constructs fail every test without running the code', () => {
  const r = runCTests({
    ...spec,
    forbid: [{ words: ['for', 'while'], message: 'Solve it without a loop' }],
    code: 'uint8_t set_bit(uint8_t reg, uint8_t pos) {\n  for (;;) { }\n}',
  });
  assert.deepEqual(r.diagnostics, [{ severity: 'error', message: 'Solve it without a loop', line: 2 }]);
  assert.ok(r.tests.every(t => !t.passed));
});

test('compiler builtins, alignof and non-ASCII text are supported', () => {
  assert.equal(out('int main(void) { printf("%d %d %d %u %X", __builtin_popcount(0xF0F0), __builtin_clz(1), __builtin_ctz(8), (unsigned)_Alignof(uint32_t), __builtin_bswap32(0x12345678)); return 0; }'), '8 31 3 4 78563412');
  assert.equal(out('int main(void) { const char *s = "24 °C"; printf("%s %u", s, (unsigned)strlen(s)); return 0; }'), '24 °C 6');
  fails('int main(void) { int *p; *p = 1; return 0; }', /Uninitialised pointer/);
});

test('a broken program never throws out of the interpreter', () => {
  for (const code of ['', 'int', 'struct {', '#define X(', '"', 'int main(void) { return 1 +; }', '#if 1\nint main(void) { return 0; }']) {
    const r = runC({ code });
    assert.ok(r.error && r.error.message, code);
  }
});
