import { useState } from 'react';

export type Theme = 'dark' | 'light';

const KEY = 'siliconlab:theme';

function read(): Theme {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch { /* storage unavailable */ }
  return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function applyTheme(theme: Theme = read()) {
  document.documentElement.dataset.theme = theme;
}

export function useTheme() {
  const [theme, setTheme] = useState(read);
  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(KEY, next); } catch { /* storage unavailable */ }
    applyTheme(next);
    setTheme(next);
  };
  return [theme, toggle] as const;
}
