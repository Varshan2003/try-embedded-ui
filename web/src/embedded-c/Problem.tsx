import { useEffect, useRef, useState } from 'react';
import { runCTests, type CDiagnostic } from '@try-embedded/simulator';
import { api, ApiError, type Problem, type ProblemReview, type ProblemTestResult } from '../api';
import { CodeEditor } from '../components/CodeEditor';
import { CodeBlock, Inline, Markdown } from '../md';
import { store } from '../store';
import { problemTrack } from './guides';
import { describeError, usePractice } from './practice';

type Tab = 'description' | 'hints' | 'solution';

// The outcome of running the examples in the browser or of a graded submission, in one shape.
interface Results {
  source: 'run' | 'submit';
  passed: boolean;
  diagnostics: CDiagnostic[];
  tests: ProblemTestResult[];
  saved: boolean;
}

function runExamples(problem: Problem, code: string): Results {
  const visible = problem.tests.filter(t => !t.hidden);
  const run = runCTests({
    code,
    prelude: problem.prelude,
    support: problem.support,
    forbid: problem.forbid,
    limits: problem.limits && { ops: problem.limits.ops, stackBytes: problem.limits.stack_bytes, heapBytes: problem.limits.heap_bytes },
    tests: visible.map(t => ({ name: t.name, code: t.code ?? '', expect: t.expect ?? '', stdin: t.stdin ?? '' })),
  });
  const tests = run.tests.map(t => ({
    name: t.name, hidden: false, passed: t.passed, stdout: t.stdout, expected: t.expected,
    ops: t.ops, stack_bytes: t.stackBytes, heap_bytes: t.heapBytes,
    messages: t.passed ? [] : [t.error ?? 'The output did not match what was expected'],
  }));
  return { source: 'run', passed: tests.every(t => t.passed), diagnostics: run.diagnostics, tests, saved: false };
}

function TestRow({ test }: { test: ProblemTestResult }) {
  const showOutput = !test.passed && !test.hidden && test.expected !== null;
  return (
    <li className={'pw-test ' + (test.passed ? 'pass' : 'fail')}>
      <span className="pw-test-name">
        <span aria-hidden="true">{test.passed ? '✓' : '✗'}</span> {test.name}{test.hidden && <span className="pw-hidden">hidden</span>}
        {test.ops > 0 && (
          <span className="pw-cost" title="Measured on the simulated chip, including the test's own main()">
            {test.ops.toLocaleString('en-US')} steps · {test.stack_bytes.toLocaleString('en-US')} B stack{test.heap_bytes > 0 && ` · ${test.heap_bytes.toLocaleString('en-US')} B heap`}
          </span>
        )}
      </span>
      {test.messages.map((m, i) => <p key={i}>{m}</p>)}
      {showOutput && (
        <dl className="pw-diff">
          <dt>expected</dt><dd><pre>{test.expected || '(nothing)'}</pre></dd>
          <dt>your output</dt><dd><pre>{test.stdout || '(nothing)'}</pre></dd>
        </dl>
      )}
    </li>
  );
}

function ResultsPanel({ results, hiddenCount, native, onLine }: { results: Results | null; hiddenCount: number; native: boolean; onLine: (line: number) => void }) {
  if (!results) {
    return (
      <p className="pw-idle">
        Run checks your code against the examples, here in the browser. Submit grades it against {hiddenCount} more hidden test{hiddenCount === 1 ? '' : 's'}
        {native ? ', compiled with GCC, so the warnings and errors you see then are the real compiler’s.' : '.'}
      </p>
    );
  }
  const passed = results.tests.filter(t => t.passed).length;
  const verdict = results.source === 'run'
    ? (results.passed ? 'Examples pass. Submit to run the hidden tests.' : `${passed} of ${results.tests.length} examples pass`)
    : (results.passed ? 'Accepted: every test passes' : `${passed} of ${results.tests.length} tests pass`);
  return (
    <div role="status">
      <p className={'pw-verdict ' + (results.passed ? 'pass' : 'fail')}>{verdict}</p>
      {results.diagnostics.map((d, i) => (
        <div key={i} className={`diag diag-${d.severity}`}>
          <span className="diag-sev">{d.severity}</span>
          {d.line !== null && <button className="diag-line" onClick={() => onLine(d.line!)}>line {d.line}</button>}
          <span>{d.message}</span>
        </div>
      ))}
      <ul className="pw-tests">{results.tests.map((t, i) => <TestRow key={i} test={t} />)}</ul>
      {results.source === 'submit' && !results.saved && results.passed && !store.user && (
        <p className="pw-note">Solved. This is recorded in this browser; sign in from the lab to keep progress on your account.</p>
      )}
    </div>
  );
}

function Workspace({ problem }: { problem: Problem }) {
  const practice = usePractice();
  const [code, setCode] = useState(() => practice.draft(problem.id) ?? problem.starter);
  const [tab, setTab] = useState<Tab>('description');
  const [hints, setHints] = useState(0);
  const [results, setResults] = useState<Results | null>(null);
  const [review, setReview] = useState<ProblemReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [focusLine, setFocusLine] = useState<{ line: number; tick: number } | null>(null);
  const tick = useRef(0);

  const solved = practice.isSolved(problem.id);
  const track = problemTrack(problem);
  // Previous and next follow the order of the Practice list, which holds every problem.
  const catalogue = practice.catalogue?.problems ?? [];
  const position = catalogue.findIndex(p => p.id === problem.id);
  const previous = position > 0 ? catalogue[position - 1] : null;
  const next = position >= 0 && position < catalogue.length - 1 ? catalogue[position + 1] : null;
  const topic = practice.catalogue?.topics.find(t => t.id === problem.topic);
  const examples = problem.tests.filter(t => !t.hidden);
  const hiddenCount = problem.tests.length - examples.length;
  const errorLine = results?.diagnostics.find(d => d.severity === 'error')?.line ?? null;
  const limits = [
    problem.limits?.ops != null && `at most ${problem.limits.ops.toLocaleString('en-US')} steps`,
    problem.limits?.stack_bytes != null && `at most ${problem.limits.stack_bytes.toLocaleString('en-US')} bytes of stack`,
    problem.limits?.heap_bytes != null && (problem.limits.heap_bytes === 0 ? 'no heap' : `at most ${problem.limits.heap_bytes.toLocaleString('en-US')} bytes of heap`),
  ].filter((l): l is string => typeof l === 'string');

  const edit = (value: string) => {
    setCode(value);
    practice.setDraft(problem.id, value === problem.starter ? null : value);
  };
  const run = () => { setFailure(null); setResults(runExamples(problem, code)); };
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      const r = await api.submitProblem(problem.id, code, store.token);
      setResults({ source: 'submit', passed: r.passed, diagnostics: r.diagnostics, tests: r.tests, saved: r.saved });
      if (r.passed) practice.markSolved(problem.id);
      if (r.review) setReview(r.review);
    } catch (e) {
      // A rejected token should not block grading: retry as a guest next time.
      if (e instanceof ApiError && e.status === 401) store.signOut();
      setFailure(describeError(e));
    } finally {
      setBusy(false);
    }
  };
  const reset = () => {
    if (code !== problem.starter && !confirm('Discard your code and go back to the starter?')) return;
    edit(problem.starter);
    setResults(null);
  };
  const reveal = async () => {
    if (!confirm('Show the reference solution? Working it out yourself is where the learning happens.')) return;
    try { setReview(await api.problemSolution(problem.id)); } catch (e) { setFailure(describeError(e)); }
  };

  return (
    <div className="pw" role="main">
      <section className="pw-side" aria-label="Problem">
        <div className="pw-head">
          <p className="pw-crumbs">
            <a href="#/practice">Practice</a>
            {topic && <> / <a href={`#/learn/${topic.id}`}>{topic.title}</a></>}
          </p>
          <h1>{problem.title}{solved && <span className="pw-solved">solved</span>}</h1>
          <p className="pw-tags">
            <span className={`ec-badge ec-${problem.difficulty}`}>{problem.difficulty}</span>
            {problem.tags.map(t => <span key={t} className="pw-tag">{t}</span>)}
          </p>
        </div>
        <div className="tabbar" role="tablist">
          {(['description', 'hints', 'solution'] as const).map(t => (
            <button key={t} className="tab" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
              {t === 'hints' ? `Hints (${problem.hints.length})` : t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        <div className="pw-scroll">
          {tab === 'description' && (
            <>
              <Markdown source={problem.prompt} />
              {problem.forbid.length > 0 && (
                <aside className="md-callout md-callout-pitfall">
                  <span className="md-callout-label">Rules</span>
                  {problem.forbid.map((f, i) => <p key={i}>{f.message}</p>)}
                </aside>
              )}
              {limits.length > 0 && (
                <>
                  <h3 className="pw-sub">Limits</h3>
                  <p className="pw-help">Per test, measured on the simulated chip: {limits.join(', ')}.</p>
                </>
              )}
              {problem.prelude.trim() && (
                <>
                  <h3 className="pw-sub">Provided</h3>
                  <p className="pw-help">These declarations are already compiled in front of your code.</p>
                  <CodeBlock code={problem.prelude.trim()} />
                </>
              )}
              <h3 className="pw-sub">Examples</h3>
              <p className="pw-help">Each test runs this code in <code>main</code> and compares what it prints.</p>
              {examples.map((t, i) => (
                <div key={i} className="pw-example">
                  <p className="pw-example-name">{t.name}</p>
                  <CodeBlock code={(t.code ?? '').trimEnd()} />
                  {t.stdin && <pre className="pw-expect"><span>input</span>{t.stdin.trimEnd()}</pre>}
                  <pre className="pw-expect"><span>prints</span>{(t.expect ?? '').trimEnd()}</pre>
                </div>
              ))}
            </>
          )}
          {tab === 'hints' && (
            <>
              <p className="pw-help">Hints go from a nudge to nearly the answer. Open them one at a time.</p>
              <ol className="pw-hints">
                {problem.hints.slice(0, hints).map((h, i) => <li key={i}><Inline text={h} /></li>)}
              </ol>
              {hints < problem.hints.length
                ? <button className="btn" onClick={() => setHints(hints + 1)}>Show hint {hints + 1} of {problem.hints.length}</button>
                : <p className="pw-help">That is every hint for this problem.</p>}
            </>
          )}
          {tab === 'solution' && (review ? (
            <>
              <h3 className="pw-sub">Reference solution</h3>
              <CodeBlock code={review.solution.trimEnd()} />
              {review.notes.trim() && (
                <aside className="md-callout md-callout-interview">
                  <span className="md-callout-label">{track === 'foundations' ? 'Worth knowing' : 'In an interview'}</span>
                  <p><Inline text={review.notes.trim()} /></p>
                </aside>
              )}
            </>
          ) : (
            <>
              <p className="pw-help">The reference solution and the interview notes unlock when your submission passes every test.</p>
              <button className="btn" onClick={reveal}>Show it anyway</button>
            </>
          ))}
        </div>
        <div className="pw-nav">
          {previous ? <a className="btn small" href={`#/practice/${previous.id}`}>← Previous</a> : <span />}
          {position >= 0 && <span className="ec-meta">{position + 1} / {catalogue.length}</span>}
          {next ? <a className="btn small" href={`#/practice/${next.id}`}>Next →</a> : <span />}
        </div>
      </section>

      <section className="pw-main" aria-label="Your solution">
        <div className="pane-head">
          <span>solution.c</span>
          <span className="spacer" />
          <button className="btn small" onClick={reset}>Reset</button>
          <button className="btn small" onClick={run} title="Run the examples (Ctrl+Enter)">Run</button>
          <button className="btn small primary" onClick={submit} disabled={busy} title="Submit to the hidden tests (Ctrl+Shift+Enter)">{busy ? 'Grading…' : 'Submit'}</button>
        </div>
        <CodeEditor value={code} onChange={edit} label="Your solution" errorLine={errorLine} focusLine={focusLine} onRun={run} onSubmit={submit} />
        <div className="pw-results">
          {failure && <p className="pw-verdict fail" role="alert">{failure}</p>}
          <ResultsPanel results={results} hiddenCount={hiddenCount} native={problem.grader === 'native'} onLine={line => setFocusLine({ line, tick: ++tick.current })} />
          {results?.source === 'submit' && results.passed && (
            <p className="pw-after">
              <button className="btn small" onClick={() => setTab('solution')}>Compare with the reference solution</button>
              {next && <a className="btn small primary" href={`#/practice/${next.id}`}>Next: {next.title} →</a>}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

export function ProblemPage({ id }: { id: string }) {
  const practice = usePractice();
  const [state, setState] = useState<{ id: string; problem?: Problem; error?: string }>({ id });
  useEffect(() => {
    let current = true;
    setState({ id });
    void practice.loadCatalogue();
    practice.loadProblem(id)
      .then(problem => { if (current) setState({ id, problem }); })
      .catch(e => { if (current) setState({ id, error: e instanceof ApiError && e.status === 404 ? `There is no problem called “${id}”.` : describeError(e) }); });
    return () => { current = false; };
  }, [id, practice]);

  if (state.id === id && state.problem) return <Workspace key={id} problem={state.problem} />;
  return (
    <div className="home-body" role="main">
      <div className="home-inner">
        <a className="guide-back" href="#/practice">← Practice</a>
        {state.error ? <div className="ec-notice" role="alert"><p>{state.error}</p></div> : <p className="ec-empty">Loading…</p>}
      </div>
    </div>
  );
}
