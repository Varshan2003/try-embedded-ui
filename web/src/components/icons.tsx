const base = { viewBox: '0 0 24 24', width: 15, height: 15, 'aria-hidden': true } as const;
const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' } as const;

export const PlayIcon = () => <svg {...base}><polygon points="6 3 20 12 6 21 6 3" fill="currentColor" /></svg>;
export const PauseIcon = () => <svg {...base} fill="currentColor"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>;
export const BuildIcon = () => <svg {...base} {...stroke}><path d="M14.7 6.3a4 4 0 0 0 4.6 5.7L21 13l-8 8-1-1-7-7 1-1 1.1 1.7a4 4 0 0 0 5.6-4.6z" /></svg>;
export const ResetIcon = () => <svg {...base} {...stroke}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>;
export const SunIcon = () => <svg {...base} {...stroke}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>;
export const MoonIcon = () => <svg {...base} {...stroke}><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" /></svg>;
export const StepIcon = () => <svg {...base} {...stroke}><path d="M5 4l10 8-10 8z" fill="currentColor" stroke="none" /><path d="M19 4v16" /></svg>;
