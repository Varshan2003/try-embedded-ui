import { useState } from 'react';
import { Inline, Markdown, type Block } from '../md';
import { Progress } from './Hub';
import { usePractice } from './practice';
import { Runnable } from './Runnable';
import { THEORY, THEORY_COUNT, type TheoryQuestion } from './questions';

type Status = 'all' | 'todo' | 'reviewed';

// Complete programs in an answer can be run and edited, as in the guides.
const renderCode = (block: Extract<Block, { kind: 'code' }>) =>
  block.lang === 'c' && block.flags.includes('run') ? <Runnable code={block.code} /> : undefined;

function Question({ q, forceOpen }: { q: TheoryQuestion; forceOpen: boolean }) {
  const practice = usePractice();
  const [open, setOpen] = useState(false);
  const shown = open || forceOpen;
  const reviewed = practice.isReviewed(q.id);
  return (
    <li className={'th-item' + (shown ? ' open' : '')} id={q.id}>
      <button className="th-question" aria-expanded={shown} onClick={() => setOpen(!shown)}>
        <span className={'ec-check' + (reviewed ? ' done' : '')} aria-label={reviewed ? 'Reviewed' : 'Not reviewed'} />
        <span className="th-number">{q.number}</span>
        <span className="th-text"><Inline text={q.question} /></span>
        {q.hasCode && <span className="pw-tag">code</span>}
      </button>
      {/* Answers are rendered only once opened: two hundred of them, some with editors, are costly to build. */}
      {shown && (
        <div className="th-answer">
          <Markdown source={q.answer} renderCode={renderCode} />
          <label className="guide-read">
            <input type="checkbox" checked={reviewed} onChange={e => practice.setReviewed(q.id, e.target.checked)} /> I can answer this
          </label>
        </div>
      )}
    </li>
  );
}

export function TheoryPage() {
  const practice = usePractice();
  const [query, setQuery] = useState('');
  const [section, setSection] = useState('all');
  const [status, setStatus] = useState<Status>('all');
  const [expandAll, setExpandAll] = useState(false);

  const q = query.trim().toLowerCase();
  const all = THEORY.flatMap(s => s.questions);
  const matches = (item: TheoryQuestion) =>
    (status === 'all' || (status === 'reviewed') === practice.isReviewed(item.id))
    && (!q || item.question.toLowerCase().includes(q) || item.answer.toLowerCase().includes(q));
  const sections = THEORY
    .filter(s => section === 'all' || s.id === section)
    .map(s => ({ ...s, visible: s.questions.filter(matches) }))
    .filter(s => s.visible.length > 0);

  return (
    <>
      <a className="guide-back" href="#/learn">← Learn</a>
      <div className="ec-list-head">
        <div>
          <h1 className="ec-title">Top {THEORY_COUNT} Theory Interview Questions</h1>
          <p className="ec-meta">{all.filter(i => practice.isReviewed(i.id)).length} of {THEORY_COUNT} reviewed across {THEORY.length} sections</p>
        </div>
        <button className="btn" onClick={() => setExpandAll(!expandAll)}>{expandAll ? 'Collapse all' : 'Expand all'}</button>
      </div>

      <div className="ec-filters">
        <input type="text" placeholder="Search questions and answers" aria-label="Search questions" value={query} onChange={e => setQuery(e.target.value)} />
        <select aria-label="Section" value={section} onChange={e => setSection(e.target.value)}>
          <option value="all">All sections</option>
          {THEORY.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
        </select>
        <select aria-label="Status" value={status} onChange={e => setStatus(e.target.value as Status)}>
          <option value="all">Reviewed or not</option>
          <option value="todo">Not reviewed</option>
          <option value="reviewed">Reviewed</option>
        </select>
      </div>

      {sections.length === 0 && <p className="ec-empty">No questions match these filters.</p>}
      {sections.map(s => (
        <section key={s.id} className="ec-topic">
          <header className="ec-topic-head">
            <div><h2>{s.title}</h2></div>
            <div className="ec-topic-side">
              <Progress done={s.questions.filter(i => practice.isReviewed(i.id)).length} total={s.questions.length} />
            </div>
          </header>
          <ul className="ec-rows">
            {s.visible.map(item => <Question key={item.id} q={item} forceOpen={expandAll} />)}
          </ul>
        </section>
      ))}
    </>
  );
}
