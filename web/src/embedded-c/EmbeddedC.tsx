import { useEffect, useRef } from 'react';
import { GuidePage } from './Guide';
import { Hub } from './Hub';
import { Playground } from './Playground';
import { PracticeList } from './PracticeList';
import { ProblemPage } from './Problem';

export function EmbeddedC({ path }: { path: string[] }) {
  const [section, id] = path;
  const body = useRef<HTMLDivElement>(null);
  // Each page starts at its top, whatever the scroll position of the page before it.
  useEffect(() => { body.current?.scrollTo(0, 0); }, [section, id]);
  // Pages built around an editor fill the window; the rest sit in a reading column.
  if (section === 'practice' && id) return <ProblemPage id={id} />;
  if (section === 'playground') return <Playground />;

  let page = <Hub />;
  if (section === 'learn' && id) page = <GuidePage id={id} />;
  else if (section === 'reference') page = <GuidePage id="reference" />;
  else if (section === 'practice') page = <PracticeList />;
  const wide = section === 'learn' || section === 'reference' || section === 'practice';
  return (
    <div className="home-body" role="main" ref={body}>
      <div className={'home-inner' + (wide ? ' wide' : '')}>{page}</div>
    </div>
  );
}
