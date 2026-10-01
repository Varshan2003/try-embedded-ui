import { useEffect, useState } from 'react';
import { guideById } from './guides';
import { Progress } from './Hub';
import { usePractice } from './practice';

type Status = 'all' | 'todo' | 'solved';

export function PracticeList() {
  const practice = usePractice();
  const [query, setQuery] = useState('');
  const [difficulty, setDifficulty] = useState('all');
  const [topic, setTopic] = useState('all');
  const [status, setStatus] = useState<Status>('all');
  useEffect(() => { void practice.loadCatalogue(); }, [practice]);

  const catalogue = practice.catalogue;
  const q = query.trim().toLowerCase();
  const visible = (catalogue?.problems ?? []).filter(p =>
    (difficulty === 'all' || p.difficulty === difficulty)
    && (topic === 'all' || p.topic === topic)
    && (status === 'all' || (status === 'solved') === practice.isSolved(p.id))
    && (!q || [p.title, p.summary, ...p.tags].some(t => t.toLowerCase().includes(q))));

  if (!catalogue) {
    return (
      <>
        <a className="guide-back" href="#/embedded-c">← Embedded C</a>
        <h1 className="ec-title">Practice</h1>
        {practice.error
          ? <div className="ec-notice" role="alert"><p>{practice.error}</p><button className="btn" onClick={() => void practice.loadCatalogue(true)}>Try again</button></div>
          : <p className="ec-empty">Loading the problem list…</p>}
      </>
    );
  }

  const next = catalogue.problems.find(p => !practice.isSolved(p.id));
  return (
    <>
      <a className="guide-back" href="#/embedded-c">← Embedded C</a>
      <div className="ec-list-head">
        <div>
          <h1 className="ec-title">Practice</h1>
          <p className="ec-meta">{practice.solvedCount(catalogue.problems)} of {catalogue.problems.length} solved across {catalogue.topics.length} topics</p>
        </div>
        {next && <a className="btn primary" href={`#/embedded-c/practice/${next.id}`}>Continue: {next.title} →</a>}
      </div>

      <div className="ec-filters">
        <input type="text" placeholder="Search problems and tags" aria-label="Search problems" value={query} onChange={e => setQuery(e.target.value)} />
        <select aria-label="Topic" value={topic} onChange={e => setTopic(e.target.value)}>
          <option value="all">All topics</option>
          {catalogue.topics.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
        </select>
        <select aria-label="Difficulty" value={difficulty} onChange={e => setDifficulty(e.target.value)}>
          <option value="all">Any difficulty</option>
          <option value="easy">Easy</option>
          <option value="medium">Medium</option>
          <option value="hard">Hard</option>
        </select>
        <select aria-label="Status" value={status} onChange={e => setStatus(e.target.value as Status)}>
          <option value="all">Solved or not</option>
          <option value="todo">Not solved</option>
          <option value="solved">Solved</option>
        </select>
      </div>

      {visible.length === 0 && <p className="ec-empty">No problems match these filters.</p>}
      {catalogue.topics.map(t => {
        const rows = visible.filter(p => p.topic === t.id);
        if (!rows.length) return null;
        const all = practice.problemsIn(t.id);
        return (
          <section key={t.id} className="ec-topic">
            <header className="ec-topic-head">
              <div>
                <h2>{t.title}</h2>
                <p>{t.summary}</p>
              </div>
              <div className="ec-topic-side">
                <Progress done={practice.solvedCount(all)} total={all.length} />
                {guideById(t.id) && <a href={`#/embedded-c/learn/${t.id}`}>Read the guide</a>}
              </div>
            </header>
            <ul className="ec-rows">
              {rows.map(p => (
                <li key={p.id}>
                  <a className="ec-row" href={`#/embedded-c/practice/${p.id}`}>
                    <span className={'ec-check' + (practice.isSolved(p.id) ? ' done' : '')} aria-label={practice.isSolved(p.id) ? 'Solved' : 'Not solved'} />
                    <span className="ec-row-text">
                      <span className="ec-row-title">{p.title}</span>
                      <span className="ec-row-summary">{p.summary}</span>
                    </span>
                    <span className="ec-row-tags">{p.tags.slice(0, 2).map(tag => <span key={tag}>{tag}</span>)}</span>
                    <span className={`ec-badge ec-${p.difficulty}`}>{p.difficulty}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}
