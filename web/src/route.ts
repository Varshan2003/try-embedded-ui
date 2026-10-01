import { useEffect, useState } from 'react';

export type Page = 'home' | 'embedded-c' | 'lab';
// `path` holds the segments after the page, e.g. #/embedded-c/practice/set-bit -> ['practice', 'set-bit'].
export interface Route { page: Page; path: string[] }

function parse(hash: string): Route {
  // Shared sketch links (#p=...) open straight in the lab.
  if (hash === '#/lab' || hash.startsWith('#p=')) return { page: 'lab', path: [] };
  const segments = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(s => {
    try { return decodeURIComponent(s); } catch { return s; }
  });
  if (segments[0] === 'embedded-c') return { page: 'embedded-c', path: segments.slice(1) };
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
