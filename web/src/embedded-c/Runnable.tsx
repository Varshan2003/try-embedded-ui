import { useState } from 'react';
import { runC, type CRunResult } from '@try-embedded/simulator';
import { CodeEditor } from '../components/CodeEditor';

// What a run printed, plus any compiler or runtime message.
export function RunOutput({ result }: { result: CRunResult }) {
  const warnings = result.diagnostics.filter(d => d.severity === 'warning');
  return (
    <div className="run-output" role="status">
      {result.stdout && <pre className="run-stdout">{result.stdout}</pre>}
      {!result.stdout && !result.error && <p className="run-empty">The program printed nothing.</p>}
      {result.error && (
        <p className="run-error">
          <span className="run-tag">{result.error.phase === 'compile' ? 'compile error' : 'runtime error'}</span>
          {result.error.message}{result.error.line ? ` (line ${result.error.line})` : ''}
        </p>
      )}
      {warnings.map((w, i) => (
        <p key={i} className="run-warning"><span className="run-tag">warning</span>{w.message}{w.line ? ` (line ${w.line})` : ''}</p>
      ))}
    </div>
  );
}

// An editable example in a lesson: change the code, run it, see what it prints.
export function Runnable({ code }: { code: string }) {
  const [source, setSource] = useState(code);
  const [result, setResult] = useState<CRunResult | null>(null);
  const run = () => setResult(runC({ code: source }));
  const changed = source !== code;
  return (
    <div className="runnable">
      <div className="runnable-head">
        <span>try it</span>
        <span className="spacer" />
        {changed && <button className="btn small" onClick={() => { setSource(code); setResult(null); }}>Reset</button>}
        <button className="btn small primary" onClick={run} title="Run (Ctrl+Enter)">Run</button>
      </div>
      <CodeEditor value={source} onChange={setSource} label="Example code" maxLines={24} errorLine={result?.error?.line} onRun={run} />
      {result && <RunOutput result={result} />}
    </div>
  );
}
