import { useEffect, useState } from 'react';

export type Page = 'home' | 'learn' | 'practice' | 'lab';
// `path` holds the segments after the page, e.g. #/practice/set-bit -> ['set-bit'].
export interface Route { page: Page; path: string[] }

// Links from before Learn and Practice were split out of #/embedded-c keep working.
function legacy(segments: string[]): string[] | null {
  if (segments[0] !== 'embedded-c') return null;
  const [section, id] = segments.slice(1);
  if (section === 'practice') return id ? ['practice', id] : ['practice'];
  if (section === 'learn' && id) return ['learn', id];
  if (section === 'reference' || section === 'theory' || section === 'playground') return ['learn', section];
  return ['learn'];
}

function parse(hash: string): Route {
  // Shared sketch links (#p=...) open straight in the lab.
  if (hash === '#/lab' || hash.startsWith('#p=')) return { page: 'lab', path: [] };
  let segments = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(s => {
    try { return decodeURIComponent(s); } catch { return s; }
  });
  const moved = legacy(segments);
  if (moved) {
    segments = moved;
    history.replaceState(null, '', '#/' + moved.map(encodeURIComponent).join('/'));
  }
  if (segments[0] === 'learn' || segments[0] === 'practice') return { page: segments[0], path: segments.slice(1) };
  return { page: 'home', path: [] };
}

// Read at import time: store.boot() strips a shared-sketch hash before the first render.
const initial = parse(location.hash);

export function useRoute(): Route {
  const [route, setRoute] = useState(initial);
  useEffect(() => {
    if (initial.page === 'lab' && location.hash !== '#/lab') history.replaceState(null, '', '#/lab');
    const onChange = () => setRoute(parse(location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
