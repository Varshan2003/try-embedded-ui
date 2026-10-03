import { useEffect } from 'react';
import { GUIDES, TRACKS } from './guides';
import { usePractice } from './practice';
import { THEORY_COUNT } from './questions';

// The figures on the home page, counted from the course itself. Lives here so the home page can
// load it lazily along with the guides it counts.
export function HomeStats() {
  const practice = usePractice();
  useEffect(() => { void practice.loadCatalogue(); }, [practice]);
  const problems = practice.catalogue?.problems.length;
  const stats: [string, string][] = [
    [String(Object.keys(TRACKS).length), 'learning modules'],
    [String(GUIDES.length), 'guides with runnable code'],
    [problems ? String(problems) : '—', 'graded C problems'],
    [String(THEORY_COUNT), 'interview questions'],
  ];
  return (
    <div className="lp-stats">
      {stats.map(([n, label]) => <div key={label}><strong>{n}</strong>{label}</div>)}
    </div>
  );
}
