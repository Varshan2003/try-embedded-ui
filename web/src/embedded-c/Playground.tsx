import { useState } from 'react';
import { runC, type CRunResult } from '@try-embedded/simulator';
import { CodeEditor } from '../components/CodeEditor';
import { practice } from './practice';
import { RunOutput } from './Runnable';

const DRAFT = '__playground';
const STARTER = `#include <stdio.h>
#include <stdint.h>

typedef struct {
  uint8_t id;
  uint32_t value;
} reading_t;

int main(void) {
  reading_t r = { 7, 0xDEADBEEF };
  const uint8_t *bytes = (const uint8_t *)&r;

  printf("sizeof(reading_t) = %u\\n", (unsigned)sizeof r);
  for (size_t i = 0; i < sizeof r; i++) printf("%02X ", bytes[i]);
  printf("\\n");
  return 0;
}
`;

// A scratch file: any complete C program, run in the same interpreter that grades the problems.
export function Playground() {
  const [code, setCode] = useState(() => practice.draft(DRAFT) ?? STARTER);
  const [result, setResult] = useState<CRunResult | null>(null);
  const edit = (value: string) => { setCode(value); practice.setDraft(DRAFT, value === STARTER ? null : value); };
  const run = () => setResult(runC({ code }));
  return (
    <div className="pw pw-single" role="main">
      <section className="pw-main" aria-label="Playground">
        <div className="pane-head">
          <a href="#/embedded-c">← Embedded C</a>
          <span>playground.c</span>
          <span className="spacer" />
          <button className="btn small" onClick={() => { edit(STARTER); setResult(null); }}>Reset</button>
          <button className="btn small primary" onClick={run} title="Run (Ctrl+Enter)">Run</button>
        </div>
        <CodeEditor value={code} onChange={edit} label="Playground code" errorLine={result?.error?.line} onRun={run} />
        <div className="pw-results">
          {result
            ? <RunOutput result={result} />
            : <p className="pw-idle">The target is a 32-bit little-endian microcontroller: <code>int</code>, <code>long</code> and pointers are 4 bytes. RAM starts at 0x20000000, peripheral registers at 0x40000000 are readable and writable, and out-of-bounds accesses are reported instead of corrupting memory.</p>}
        </div>
      </section>
    </div>
  );
}
