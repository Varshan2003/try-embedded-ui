const base = { viewBox: '0 0 24 24', width: 15, height: 15, 'aria-hidden': true } as const;
const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' } as const;

export const PlayIcon = () => <svg {...base}><polygon points="6 3 20 12 6 21 6 3" fill="currentColor" /></svg>;
export const PauseIcon = () => <svg {...base} fill="currentColor"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>;
export const BuildIcon = () => <svg {...base} {...stroke}><path d="M14.7 6.3a4 4 0 0 0 4.6 5.7L21 13l-8 8-1-1-7-7 1-1 1.1 1.7a4 4 0 0 0 5.6-4.6z" /></svg>;
export const ResetIcon = () => <svg {...base} {...stroke}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>;
export const StepIcon = () => <svg {...base} {...stroke}><path d="M5 4l10 8-10 8z" fill="currentColor" stroke="none" /><path d="M19 4v16" /></svg>;
