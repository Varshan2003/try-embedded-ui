// Checks the Embedded C guides: every runnable example must compile and run cleanly in the
// interpreter (or fail, if it is marked `fails`), and every quiz must have exactly one right
// answer. Pass --print to see the output.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runC } from '@try-embedded/simulator';

const dir = fileURLToPath(new URL('../src/content/guides/', import.meta.url));
const print = process.argv.includes('--print');
let examples = 0, quizzes = 0, failures = 0;

const fail = (file, line, message) => { failures++; console.error(`${file}:${line}: ${message}`); };

for (const file of readdirSync(dir).filter(f => f.endsWith('.md')).sort()) {
  const lines = readFileSync(dir + file, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const fence = /^```(\S*)\s*(.*)$/.exec(lines[i]);
    if (!fence) continue;
    const start = i + 1;
    const body = [];
    for (i++; i < lines.length && !lines[i].startsWith('```'); i++) body.push(lines[i]);
    if (i >= lines.length) { fail(file, start, 'unterminated code fence'); break; }
    const [, lang, flags] = fence;

    if (lang === 'c' && flags.split(/\s+/).includes('run')) {
      examples++;
      const r = runC({ code: body.join('\n') });
      // An example marked `fails` exists to show an error message, so it must produce one.
      const shouldFail = flags.split(/\s+/).includes('fails');
      if (shouldFail && !r.error) fail(file, start, 'example is marked `fails` but ran cleanly');
      else if (shouldFail) { if (print) console.log(`--- ${file}:${start}\n[expected error] ${r.error.message} (line ${r.error.line})\n`); }
      else if (r.error) fail(file, start, `example fails: ${r.error.message} (line ${r.error.line})`);
      else if (print) console.log(`--- ${file}:${start}\n${r.stdout}${r.diagnostics.map(d => `[${d.severity}] ${d.message}\n`).join('')}`);
    } else if (lang === 'quiz') {
      quizzes++;
      const right = body.filter(l => l.trim().startsWith('* ')).length;
      const wrong = body.filter(l => l.trim().startsWith('- ')).length;
      if (right !== 1 || wrong < 1) fail(file, start, `a quiz needs one right answer and at least one wrong one (found ${right} and ${wrong})`);
      if (!body.some(l => l.startsWith('Q:')) || !body.some(l => l.startsWith('Why:'))) fail(file, start, 'a quiz needs a Q: line and a Why: line');
    } else if (lang === 'ask') {
      if (!body[0]?.startsWith('Q:') || !body.some(l => l.startsWith('A:'))) fail(file, start, 'an interview question needs a Q: line and an A: line');
    } else if (!['c', 'text', ''].includes(lang)) fail(file, start, `unknown block type '${lang}'`);
  }
}

console.log(`${examples} runnable examples and ${quizzes} quizzes checked, ${failures} problem${failures === 1 ? '' : 's'}`);
process.exit(failures ? 1 : 0);
