import { useEffect, useRef } from 'react';
import { GuidePage } from './Guide';
import { LearnPage } from './Hub';
import { Playground } from './Playground';
import { PracticeList } from './PracticeList';
import { ProblemPage } from './Problem';
import { TheoryPage } from './Theory';

// The Learn and Practice sections. `id` is the segment after the section, e.g. #/learn/bits -> 'bits'.
export function EmbeddedC({ section, id }: { section: 'learn' | 'practice'; id?: string }) {
  const body = useRef<HTMLDivElement>(null);
  // Each page starts at its top, whatever the scroll position of the page before it.
  useEffect(() => { body.current?.scrollTo(0, 0); }, [section, id]);
  // Pages built around an editor fill the window; the rest sit in a reading column.
  if (section === 'practice' && id) return <ProblemPage id={id} />;
  if (section === 'learn' && id === 'playground') return <Playground />;

  let page = section === 'practice' ? <PracticeList /> : <LearnPage />;
  if (section === 'learn' && id === 'theory') page = <TheoryPage />;
  else if (section === 'learn' && id) page = <GuidePage id={id} />;
  return (
    <div className="home-body" role="main" ref={body}>
      <div className="home-inner wide">{page}</div>
    </div>
  );
}
