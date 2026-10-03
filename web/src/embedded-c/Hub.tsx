import { useEffect } from 'react';
import { GUIDES, TRACKS, type Track } from './guides';
import { usePractice } from './practice';
import { THEORY, THEORY_COUNT } from './questions';

export function Progress({ done, total }: { done: number; total: number }) {
  const percent = total ? Math.round((done / total) * 100) : 0;
  return (
    <span className="ec-progress" role="img" aria-label={`${done} of ${total} solved`}>
      <span className="ec-progress-bar"><span style={{ width: `${percent}%` }} /></span>
      <span className="ec-progress-text">{done}/{total}</span>
    </span>
  );
}

// One track: its guides in order, each with the problems that exercise it.
function TrackSection({ track, number }: { track: Track; number: number }) {
  const practice = usePractice();
  const guides = GUIDES.filter(g => g.track === track);
  const read = guides.filter(g => practice.isRead(g.id)).length;

  // The path through the track: read a guide, solve its problems, move to the next guide.
  let next: { href: string; label: string; detail: string } | null = null;
  for (const g of guides) {
    if (!practice.isRead(g.id)) {
      next = { href: `#/learn/${g.id}`, label: read === 0 ? 'Start' : 'Continue', detail: `Read: ${g.title}` };
      break;
    }
    const todo = practice.problemsIn(g.id).find(p => !practice.isSolved(p.id));
    if (todo) {
      next = { href: `#/practice/${todo.id}`, label: 'Continue', detail: `Practise: ${todo.title}` };
      break;
    }
  }

  return (
    <section className="learn-track" id={track}>
      <div className="ec-list-head">
        <div>
          <span className="learn-step">Module {String(number).padStart(2, '0')}</span>
          <h2 className="learn-track-title">{TRACKS[track].title}</h2>
          <p className="ec-track-note">{TRACKS[track].note}</p>
          <p className="ec-meta">{read} of {guides.length} guides read</p>
        </div>
        {next && (
          <a className="ec-next" href={next.href}>
            <span className="ec-next-label">{next.label} →</span>
            <span className="ec-next-detail">{next.detail}</span>
          </a>
        )}
      </div>

      <div className="ec-grid">
        {guides.map((g, i) => {
          const set = practice.problemsIn(g.id);
          return (
            <a key={g.id} className="ec-card" href={`#/learn/${g.id}`}>
              <span className="ec-card-index">{String(i + 1).padStart(2, '0')}{practice.isRead(g.id) && <span className="ec-read"> · read</span>}</span>
              <h3>{g.title}</h3>
              <p>{g.summary}</p>
              <span className="ec-card-foot">
                <span>{g.minutes} min</span>
                {set.length > 0 && <Progress done={practice.solvedCount(set)} total={set.length} />}
              </span>
            </a>
          );
        })}
      </div>
    </section>
  );
}

// Learn: every module in order, then the interview material that sits beside them.
export function LearnPage() {
  const practice = usePractice();
  useEffect(() => { void practice.loadCatalogue(); }, [practice]);
  const reviewed = THEORY.reduce((n, s) => n + s.questions.filter(q => practice.isReviewed(q.id)).length, 0);
  const problems = practice.catalogue?.problems ?? [];

  return (
    <>
      <div className="ec-hero">
        <span className="learn-step">Embedded C</span>
        <h1>Learn</h1>
        <p>Short guides with examples you can run and edit. Your code runs on a simulated 32-bit microcontroller that explains your mistakes instead of crashing. Start at module 01 if you have never programmed.</p>
      </div>

      <TrackSection track="foundations" number={1} />
      <TrackSection track="core" number={2} />

      <section className="learn-track">
        <span className="learn-step">Interview prep</span>
        <h2 className="learn-track-title">Revise and try things out</h2>
        <div className="ec-grid">
          <a className="ec-card" href="#/learn/theory">
            <span className="ec-card-index">{THEORY.length} sections</span>
            <h3>Top {THEORY_COUNT} theory interview questions</h3>
            <p>The questions interviewers ask out loud, from <code>volatile</code> to priority inversion, each with a short answer and code where it helps.</p>
            <span className="ec-card-foot"><span>Reviewed</span><Progress done={reviewed} total={THEORY_COUNT} /></span>
          </a>
          <a className="ec-card" href="#/learn/reference">
            <span className="ec-card-index">reference</span>
            <h3>Quick reference</h3>
            <p>Bit idioms, type sizes, operator precedence and the undefined-behaviour list on one page.</p>
          </a>
          <a className="ec-card" href="#/learn/playground">
            <span className="ec-card-index">sandbox</span>
            <h3>Playground</h3>
            <p>A scratch file with the C interpreter attached. Try an idea, print the result, break things safely.</p>
          </a>
          <a className="ec-card" href="#/practice">
            <span className="ec-card-index">practice</span>
            <h3>All practice problems</h3>
            <p>Write a function, run it against the examples, then submit it to the hidden tests.</p>
            {problems.length > 0 && <span className="ec-card-foot"><span>Solved</span><Progress done={practice.solvedCount(problems)} total={problems.length} /></span>}
          </a>
        </div>
      </section>
    </>
  );
}
