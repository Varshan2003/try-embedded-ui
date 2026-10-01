#!/usr/bin/env node
// Headless runner: reads a run spec (or an array of them) as JSON on stdin, writes the result(s) as JSON on stdout.
// A spec with kind 'c' is a set of C tests; anything else is a simulated Arduino project.
// The API service calls this to grade submissions.
import { runCTests, runHeadless } from '../src/index.js';

const run = spec => (spec.kind === 'c' ? runCTests(spec) : runHeadless(spec));

let input = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) input += chunk;

try {
  const spec = JSON.parse(input);
  process.stdout.write(JSON.stringify(Array.isArray(spec) ? spec.map(run) : run(spec)));
} catch (e) {
  process.stderr.write(`${e.message}\n`);
  process.exit(2);
}
