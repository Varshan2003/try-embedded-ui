import { useEffect } from 'react';
import { GUIDES } from './guides';
import { usePractice } from './practice';

export function Progress({ done, total }: { done: number; total: number }) {
  const percent = total ? Math.round((done / total) * 100) : 0;
  return (
    <span className="ec-progress" role="img" aria-label={`${done} of ${total} solved`}>
      <span className="ec-progress-bar"><span style={{ width: `${percent}%` }} /></span>
      <span className="ec-progress-text">{done}/{total}</span>
    </span>
  );
}

const TRACKS = [
  { id: 'foundations', title: 'Start here: C from zero', note: 'No programming experience needed. Work through these in order.' },
  { id: 'core', title: 'Embedded C', note: 'The C that firmware is built from. Assumes the track above, or that you already know basic C.' },
] as const;

export function Hub() {
  const practice = usePractice();
  useEffect(() => { void practice.loadCatalogue(); }, [practice]);
  const problems = practice.catalogue?.problems ?? [];
  const solved = practice.solvedCount(problems);
  const read = GUIDES.filter(g => practice.isRead(g.id)).length;
  const levels = (['easy', 'medium', 'hard'] as const).map(level => {
    const set = problems.filter(p => p.difficulty === level);
    return { level, total: set.length, done: practice.solvedCount(set) };
  });

  // The path through the course: read a guide, solve its problems, move to the next guide.
  let next: { href: string; label: string; detail: string } | null = null;
  for (const g of GUIDES) {
    if (!practice.isRead(g.id)) {
      next = { href: `#/embedded-c/learn/${g.id}`, label: read === 0 && solved === 0 ? 'Start the course' : 'Continue', detail: `Read: ${g.title}` };
      break;
    }
    const todo = practice.problemsIn(g.id).find(p => !practice.isSolved(p.id));
    if (todo) {
      next = { href: `#/embedded-c/practice/${todo.id}`, label: 'Continue', detail: `Practise: ${todo.title}` };
      break;
    }
  }

  return (
    <>
      <div className="ec-hero">
        <h1>Embedded C</h1>
        <p>Go from never having written a line of code to writing the C that firmware is built from. Read a short guide, run and change its examples, then solve the problems for that guide. Your code runs on a simulated 32-bit microcontroller that explains your mistakes instead of crashing.</p>
        {next && (
          <a className="ec-next" href={next.href}>
            <span className="ec-next-label">{next.label} →</span>
            <span className="ec-next-detail">{next.detail}</span>
          </a>
        )}
      </div>

      {TRACKS.map(track => (
        <section key={track.id}>
          <div className="ec-section-head">
            <h2 className="home-section-title">{track.title}</h2>
            {track.id === 'foundations' && <span className="ec-meta">{read} of {GUIDES.length} guides read</span>}
          </div>
          <p className="ec-track-note">{track.note}</p>
          <div className="ec-grid">
            {GUIDES.filter(g => g.track === track.id).map(g => {
              const set = practice.problemsIn(g.id);
              return (
                <a key={g.id} className="ec-card" href={`#/embedded-c/learn/${g.id}`}>
                  <span className="ec-card-index">{String(GUIDES.indexOf(g) + 1).padStart(2, '0')}{practice.isRead(g.id) && <span className="ec-read"> · read</span>}</span>
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
      ))}

      <div className="ec-section-head"><h2 className="home-section-title">Practice</h2></div>
      <a className="home-card" href="#/embedded-c/practice">
        <div className="home-card-text">
          <h2>{problems.length ? `${problems.length} problems` : 'Practice problems'}</h2>
          {problems.length > 0
            ? <p>{solved} solved. Write a function, run it against the examples in your browser, then submit it to the hidden tests.</p>
            : <p>{practice.error ?? 'Loading the problem list…'}</p>}
          {problems.length > 0 && (
            <div className="ec-levels">
              {levels.map(l => <span key={l.level} className={`ec-badge ec-${l.level}`}>{l.level} {l.done}/{l.total}</span>)}
            </div>
          )}
        </div>
        <span className="home-card-go">Start practising →</span>
      </a>

      <div className="ec-section-head"><h2 className="home-section-title">Tools</h2></div>
      <div className="ec-grid ec-grid-2">
        <a className="ec-card" href="#/embedded-c/reference">
          <h3>Quick reference</h3>
          <p>Bit idioms, type sizes, operator precedence and the undefined-behaviour list on one page.</p>
        </a>
        <a className="ec-card" href="#/embedded-c/playground">
          <h3>Playground</h3>
          <p>A scratch file with the C interpreter attached. Try an idea, print the result, break things safely.</p>
        </a>
      </div>
    </>
  );
}
