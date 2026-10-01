import { useEffect, useMemo, useState } from 'react';
import { Inline, Markdown, parseMarkdown, type Block } from '../md';
import { GUIDES, QUICK_REFERENCE, guideById } from './guides';
import { usePractice } from './practice';
import { Runnable } from './Runnable';

// ```quiz blocks: "Q:" the question, "-" a wrong option, "*" the right one, "Why:" the explanation.
function Quiz({ source }: { source: string }) {
  const [picked, setPicked] = useState<number | null>(null);
  const quiz = useMemo(() => {
    const lines = source.split('\n').map(l => l.trim()).filter(Boolean);
    const question = lines.find(l => l.startsWith('Q:'))?.slice(2).trim() ?? '';
    const why = lines.find(l => l.startsWith('Why:'))?.slice(4).trim() ?? '';
    const options = lines.filter(l => /^[-*]\s/.test(l)).map(l => ({ text: l.slice(2), right: l[0] === '*' }));
    return { question, why, options };
  }, [source]);
  return (
    <div className="quiz">
      <p className="quiz-q"><span className="quiz-tag">check yourself</span><Inline text={quiz.question} /></p>
      <div className="quiz-options">
        {quiz.options.map((o, i) => {
          const state = picked === null ? '' : o.right ? ' right' : picked === i ? ' wrong' : '';
          return (
            <button key={i} className={'quiz-option' + state} aria-pressed={picked === i} onClick={() => setPicked(i)}>
              <Inline text={o.text} />
            </button>
          );
        })}
      </div>
      {picked !== null && (
        <p className="quiz-why" role="status">
          <strong>{quiz.options[picked].right ? 'Correct.' : 'Not quite.'}</strong> <Inline text={quiz.why} />
        </p>
      )}
    </div>
  );
}

// ```ask blocks: an interview question with its answer folded away.
function Ask({ source }: { source: string }) {
  const split = source.indexOf('\nA:');
  const question = source.slice(0, split < 0 ? undefined : split).replace(/^Q:\s*/, '').trim();
  const answer = split < 0 ? '' : source.slice(split + 3).trim();
  return (
    <details className="ask">
      <summary><span className="quiz-tag">interview</span><Inline text={question} /></summary>
      <Markdown source={answer} />
    </details>
  );
}

function renderCode(block: Extract<Block, { kind: 'code' }>) {
  if (block.lang === 'quiz') return <Quiz source={block.code} />;
  if (block.lang === 'ask') return <Ask source={block.code} />;
  if (block.lang === 'c' && block.flags.includes('run')) return <Runnable code={block.code} />;
  return undefined;
}

export function GuidePage({ id }: { id: string }) {
  const practice = usePractice();
  const guide = id === QUICK_REFERENCE.id ? QUICK_REFERENCE : guideById(id);
  useEffect(() => { void practice.loadCatalogue(); }, [practice]);
  const sections = useMemo(() => (guide ? parseMarkdown(guide.source).filter(b => b.kind === 'heading' && b.level === 2) : []), [guide]);

  if (!guide) {
    return <p className="ec-empty">There is no guide called “{id}”. <a href="#/embedded-c">Back to Embedded C</a></p>;
  }
  const index = GUIDES.indexOf(guide);
  const previous = index > 0 ? GUIDES[index - 1] : null;
  const next = index >= 0 && index < GUIDES.length - 1 ? GUIDES[index + 1] : null;
  const problems = practice.problemsIn(guide.id);
  const read = practice.isRead(guide.id);

  return (
    <div className="guide">
      <nav className="guide-toc" aria-label="On this page">
        <a className="guide-back" href="#/embedded-c">← Embedded C</a>
        <span className="guide-toc-title">On this page</span>
        {sections.map(s => s.kind === 'heading' && (
          <button key={s.id} className="guide-toc-link" onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
            {s.text.replace(/`/g, '')}
          </button>
        ))}
      </nav>
      <article className="guide-body">
        <p className="ec-meta">{index >= 0 ? `Guide ${index + 1} of ${GUIDES.length}` : 'Reference'} · {guide.minutes} min read</p>
        <h1>{guide.title}</h1>
        <p className="guide-lede">{guide.summary}</p>
        <Markdown source={guide.source} renderCode={renderCode} />

        {problems.length > 0 && (
          <section className="guide-practice">
            <h2>Practice this topic</h2>
            <ul className="guide-problems">
              {problems.map(p => (
                <li key={p.id}>
                  <a href={`#/embedded-c/practice/${p.id}`}>
                    <span className={'ec-check' + (practice.isSolved(p.id) ? ' done' : '')} aria-label={practice.isSolved(p.id) ? 'Solved' : 'Not solved'} />
                    <span className="guide-problem-title">{p.title}</span>
                    <span className={`ec-badge ec-${p.difficulty}`}>{p.difficulty}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        {index >= 0 && (
          <footer className="guide-foot">
            <label className="guide-read">
              <input type="checkbox" checked={read} onChange={e => practice.setRead(guide.id, e.target.checked)} /> I have read this guide
            </label>
            <span className="spacer" />
            {previous && <a className="btn" href={`#/embedded-c/learn/${previous.id}`}>← {previous.title}</a>}
            {next && <a className="btn primary" href={`#/embedded-c/learn/${next.id}`}>{next.title} →</a>}
          </footer>
        )}
      </article>
    </div>
  );
}
