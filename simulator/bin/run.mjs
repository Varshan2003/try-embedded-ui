#!/usr/bin/env node
// Headless runner: reads a run spec (or an array of them) as JSON on stdin, writes the result(s) as JSON on stdout.
// The API service calls this to grade submissions.
import { runHeadless } from '../src/index.js';

let input = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) input += chunk;

try {
  const spec = JSON.parse(input);
  process.stdout.write(JSON.stringify(Array.isArray(spec) ? spec.map(runHeadless) : runHeadless(spec)));
} catch (e) {
  process.stderr.write(`${e.message}\n`);
  process.exit(2);
}
