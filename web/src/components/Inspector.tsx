import { Fragment } from 'react';
import { COMPONENTS, wireOf } from '@try-embedded/simulator';
import { useStore } from '../store';

const LED_COLORS = ['red', 'green', 'amber', 'cyan'];

// Challenge prompts use a small subset of Markdown: paragraphs, "- " lists and `code` spans.
function Prompt({ text }: { text: string }) {
  const inline = (s: string) => s.split('`').map((part, i) => (i % 2 ? <code key={i}>{part}</code> : <Fragment key={i}>{part}</Fragment>));
  return (
    <>
      {text.split('\n\n').map((block, i) => {
        const lines = block.split('\n');
        if (lines.every(l => l.startsWith('- '))) return <ul key={i}>{lines.map((l, j) => <li key={j}>{inline(l.slice(2))}</li>)}</ul>;
        return <p key={i}>{inline(block)}</p>;
      })}
    </>
  );
}

function ChallengePanel() {
  const store = useStore();
  const challenge = store.challenge;
  if (!store.project.challengeId) return null;
  if (!challenge) return <p className="hint">Loading the challenge…</p>;

  const submission = store.submission?.challengeId === challenge.id ? store.submission.result : null;
  return (
    <section className="challenge">
      <div className="side-head"><span>challenge · {challenge.topic}</span></div>
      <h3 className="inspector-heading">{challenge.title}</h3>
      <div className="challenge-prompt"><Prompt text={challenge.prompt} /></div>
      {challenge.circuit === 'fixed' && <p className="hint">Graded on the wiring shown here; only your code is submitted.</p>}

      <div className="inspector-actions">
        <button className="btn small primary" disabled={store.submitting} onClick={() => store.submit()}>{store.submitting ? 'Grading…' : 'Submit'}</button>
        <button className="btn small" onClick={() => store.restartChallenge()}>Start over</button>
      </div>

      {submission ? (
        <div className="challenge-results" role="status">
          <p className={'challenge-verdict ' + (submission.passed ? 'pass' : 'fail')}>
            {submission.passed ? 'All tests passed' : `${submission.passed_tests} of ${submission.total_tests} tests passed`}
          </p>
          {submission.tests.map((t, i) => (
            <div key={i} className={'challenge-test ' + (t.passed ? 'pass' : 'fail')}>
              <span>{t.passed ? '✓' : '✗'} {t.name}{t.hidden ? ' (hidden)' : ''}</span>
              {t.messages.map((m, j) => <p key={j}>{m}</p>)}
            </div>
          ))}
          {!submission.saved && <p className="hint">Sign in to keep a record of your results.</p>}
        </div>
      ) : (
        <div className="challenge-results">
          {challenge.tests.map((t, i) => <div key={i} className="challenge-test">○ {t.name}{t.hidden ? ' (hidden)' : ''}</div>)}
        </div>
      )}
    </section>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="kv"><span className="kv-k">{k}</span><span className="kv-v">{v}</span></div>;
}

export function Inspector() {
  const store = useStore();
  const { project, session } = store;
  const spec = session.board.spec;
  const selected = project.components.filter(c => store.selection.has(c.id));

  return (
    <aside className="inspector" aria-label="Inspector">
      <ChallengePanel />
      <div className="side-head"><span>inspector</span></div>
      <div id="inspector-body">
        {!selected.length && (
          <>
            <Row k="Board" v={spec.name} />
            <Row k="Digital pins" v={String(spec.digital)} />
            <Row k="Analog inputs" v={String(spec.analog)} />
            <Row k="PWM pins" v={spec.pwm.join(', ')} />
            <Row k="Interrupt pins" v={spec.interrupts.join(', ')} />
            <Row k="Logic level" v={`${spec.voltage} V`} />
            <p className="hint">Select a component on the canvas to inspect and rewire it.</p>
          </>
        )}
        {selected.map(c => {
          const def = COMPONENTS[c.type];
          return (
            <Fragment key={c.id}>
              <h3 className="inspector-heading">{def.label}</h3>
              {c.type === 'led' && (
                <label className="field">
                  <span className="field-label">Colour</span>
                  <select value={c.state.color || 'red'} onChange={e => { c.state.color = e.target.value; store.touchCircuit(); }}>
                    {LED_COLORS.map(col => <option key={col} value={col}>{col}</option>)}
                  </select>
                </label>
              )}
              {c.type === 'button' && (
                <label className="field">
                  <span className="field-label">Latching</span>
                  <input type="checkbox" checked={!!c.state.latching} onChange={e => { c.state.latching = e.target.checked ? 1 : 0; store.touchCircuit(); }} />
                </label>
              )}
              {def.terminals.map(t => (
                <label key={t.id} className="field">
                  <span className="field-label">{t.id}{t.label ? ` (${t.label})` : ''}</span>
                  <select
                    value={wireOf(project, c.id, t.id) ?? ''}
                    onChange={e => store.rewire(c.id, t.id, e.target.value === '' ? null : +e.target.value)}
                  >
                    <option value="">not connected</option>
                    {session.board.pins.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
              ))}
              <div className="inspector-actions">
                <button className="btn small" onClick={() => store.rotateSelection()}>Rotate</button>
                <button className="btn small danger" onClick={() => store.deleteSelection()}>Delete</button>
              </div>
            </Fragment>
          );
        })}
      </div>
    </aside>
  );
}
