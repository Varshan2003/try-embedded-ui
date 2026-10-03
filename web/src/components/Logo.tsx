// The Try Embedded mark: an ink "t" and an orange "e" whose crossbar runs out into a circuit trace.
// Drawn inline so the ink follows the theme; `cut` is the colour behind it, which separates the letters.
export function Logo({ size = 28, cut = 'var(--panel)' }: { size?: number; cut?: string }) {
  return (
    <svg className="logo-mark" viewBox="0 0 72 56" width={size * 72 / 56} height={size} aria-hidden="true" fill="none">
      <path d="M10 7L19 2V14H27V22H19V38Q19 43 24 43H28V52H24Q10 52 10 38V22H4V14H10Z" fill="currentColor" stroke="none" />
      <path d="M53 33A14 14 0 1 0 49.5 43" stroke={cut} strokeWidth="15" />
      <path d="M53 33A14 14 0 1 0 49.5 43" stroke="var(--brand)" strokeWidth="8.5" />
      <path d="M26 33h29l3 3h5" stroke="var(--brand)" strokeWidth="5" strokeLinejoin="round" />
      <circle cx="66.5" cy="36" r="3.5" stroke="var(--brand)" strokeWidth="3" />
    </svg>
  );
}

export function Wordmark({ size = 30, cut }: { size?: number; cut?: string }) {
  return (
    <span className="wordmark" style={{ fontSize: size }}>
      <Logo size={size * 1.25} cut={cut} />
      <span className="wordmark-text"><b>try</b><span>embedded</span></span>
    </span>
  );
}
