// Public API of the C interpreter: run a program, or run a learner's code against a set of tests.
import { lex, preprocess, predefinedMacros } from './lexer.js';
import { Parser } from './parser.js';
import { Machine } from './machine.js';
import { PROTOTYPES } from './libc.js';
import { CError } from './types.js';

export { CError } from './types.js';
export { RAM_SIZE } from './machine.js';

const SOLUTION = 'solution', PROVIDED = 'provided', TESTS = 'tests';
const decoder = new TextDecoder('utf-8');

// Program output is collected one byte per character; turn it back into text.
const decode = s => decoder.decode(Uint8Array.from(s, c => c.charCodeAt(0)));

function compile(parts) {
  const macros = predefinedMacros();
  const tokens = [];
  for (const [file, src] of [['<builtin>', PROTOTYPES], ...parts]) {
    const toks = preprocess(lex(src, file), macros);
    toks.pop();
    tokens.push(...toks);
  }
  const last = parts[parts.length - 1];
  tokens.push({ k: 'eof', v: null, line: last[1].split('\n').length, file: last[0], nl: true });
  return new Parser(tokens).parseProgram();
}

function describe(e, machine) {
  if (e instanceof CError) return { message: e.message, line: e.line ?? machine?.line ?? null, file: e.file ?? machine?.file ?? null };
  if (e instanceof RangeError) return { message: 'Stack overflow: the recursion is too deep or never stops', line: machine?.line ?? null, file: machine?.file ?? null };
  // A defect in the interpreter itself. Report it as a failed run rather than taking the page or the grader down.
  return { message: `The interpreter could not handle this code (${e?.message ?? e}). Please report it.`, line: machine?.line ?? null, file: machine?.file ?? null };
}

function execute(parts, options) {
  const result = { compiled: false, stdout: '', exitCode: null, error: null, warnings: [], ops: 0 };
  let program;
  try {
    program = compile(parts);
  } catch (e) {
    result.error = { ...describe(e), phase: 'compile' };
    return result;
  }
  result.compiled = true;
  result.warnings = program.warnings;
  let machine;
  try {
    machine = new Machine(program, options);
    result.exitCode = machine.run();
  } catch (e) {
    result.error = { ...describe(e, machine), phase: 'run' };
  }
  if (machine) {
    result.stdout = decode(machine.out);
    result.ops = machine.ops;
  }
  return result;
}

const diagnostic = (severity, d) => ({ severity, message: d.message, line: d.line ?? null });

// Runs a complete program (one that defines main) and returns what it printed.
export function runC({ code, maxOps } = {}) {
  const r = execute([[SOLUTION, String(code ?? '')]], { maxOps });
  const diagnostics = r.warnings.map(w => diagnostic('warning', w));
  if (r.error) diagnostics.unshift(diagnostic('error', r.error));
  return { compiled: r.compiled, stdout: r.stdout, exitCode: r.exitCode, error: r.error, diagnostics, ops: r.ops };
}

const normalise = s => s.replace(/\r/g, '').split('\n').map(l => l.trimEnd()).join('\n').replace(/\n+$/, '');

function forbidden(code, rules) {
  if (!rules?.length) return [];
  let tokens;
  try { tokens = lex(code, SOLUTION); } catch { return []; }
  const out = [];
  for (const rule of rules) {
    const hit = tokens.find(t => (t.k === 'id' || t.k === 'op') && rule.words.includes(t.v));
    if (hit) out.push({ severity: 'error', message: rule.message, line: hit.line });
  }
  return out;
}

// An error that surfaces in the hidden harness is still the learner's to fix; say so in their terms.
function explain(error) {
  if (error.file !== TESTS && error.file !== PROVIDED) return error;
  const m = error.message;
  if (/^Redefinition of 'main'/.test(m)) return { ...error, line: null, message: "Remove your main(): the tests supply their own and call your function directly" };
  if (error.phase === 'compile') {
    return { ...error, line: null, message: `The tests could not be built against your code: ${m}. Check that the required function exists with the signature from the starter code, and that every '{' has its '}'` };
  }
  return { ...error, line: null, message: `${m} (while the test was running)` };
}

// Runs a learner's code against tests. Each test supplies the body of main() and the output it must print.
//   spec: { code, prelude?, support?, tests: [{ name, code, expect }], forbid?, maxOps? }
export function runCTests(spec) {
  const code = String(spec.code ?? '');
  const result = { compiled: true, diagnostics: forbidden(code, spec.forbid), tests: [] };
  const blocked = result.diagnostics.length > 0;
  let warned = false;
  for (const test of spec.tests) {
    const outcome = { name: test.name, passed: false, stdout: '', expected: normalise(test.expect ?? ''), error: null };
    result.tests.push(outcome);
    if (blocked) { outcome.error = result.diagnostics[0].message; continue; }
    const harness = `${spec.support ?? ''}\nint main(void) {\n${test.code}\n  return 0;\n}\n`;
    const r = execute([[PROVIDED, spec.prelude ?? ''], [SOLUTION, code], [TESTS, harness]], { maxOps: spec.maxOps });
    if (!warned) {
      result.diagnostics.push(...r.warnings.filter(w => w.file === SOLUTION).map(w => diagnostic('warning', w)));
      warned = true;
    }
    if (!r.compiled) {
      const error = explain(r.error);
      result.compiled = false;
      result.diagnostics.unshift(diagnostic('error', error));
      for (const t of spec.tests.slice(result.tests.length)) result.tests.push({ name: t.name, passed: false, stdout: '', expected: normalise(t.expect ?? ''), error: null });
      for (const t of result.tests) t.error = 'The code did not compile';
      return result;
    }
    outcome.stdout = normalise(r.stdout);
    if (r.error) {
      const error = explain(r.error);
      outcome.error = error.line ? `${error.message} (line ${error.line})` : error.message;
      outcome.line = error.line;
    } else outcome.passed = outcome.stdout === outcome.expected;
  }
  return result;
}
