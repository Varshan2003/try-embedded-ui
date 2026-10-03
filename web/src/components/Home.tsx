import { lazy, Suspense } from 'react';
import type { Route } from '../route';
import { Logo, Wordmark } from './Logo';
import { ThemeToggle } from './ThemeToggle';

// Loaded on demand: the guides and the C interpreter are not needed to open the lab.
const EmbeddedC = lazy(() => import('../embedded-c/EmbeddedC').then(m => ({ default: m.EmbeddedC })));
const HomeStats = lazy(() => import('../embedded-c/Stats').then(m => ({ default: m.HomeStats })));

// A highlighted snippet for the hero. Each line is a list of [class, text] runs.
const SNIPPET: [string, string][][] = [
  [['c', '// Blink the on-board LED on pin 13']],
  [['k', '#define'], ['', ' LED_BIT  ('], ['n', '1u'], ['', ' << '], ['n', '5'], ['', ')']],
  [],
  [['k', 'void'], ['', ' loop('], ['k', 'void'], ['', ') {']],
  [['', '  PORTB ^= LED_BIT;   '], ['c', '// toggle']],
  [['', '  delay('], ['n', '500'], ['', ');']],
  [['', '}']],
];

function Overview() {
  return (
    <>
      <section className="lp-hero">
        <div className="lp-hero-text">
          <span className="lp-eyebrow">Try Embedded</span>
          <h1>Your journey from <em>Zero</em> to Embedded Engineer.</h1>
          <p>Learn Embedded C, solve real problems and simulate hardware in your browser. One platform, one path.</p>
          <div className="lp-actions">
            <a className="lp-btn" href="#/learn">Start learning free</a>
            <a className="lp-btn ghost" href="#/practice">Browse problems</a>
          </div>
        </div>
        <div className="lp-editor" aria-hidden="true">
          <div className="lp-editor-tab"><b>main.c</b><span className="spacer" /><span className="lp-chip">simulation running</span></div>
          <pre>
            {SNIPPET.map((line, i) => (
              <span key={i} className="lp-line">
                <span className="lp-ln">{i + 1}</span>
                {line.map(([cls, text], j) => <span key={j} className={cls && `lp-${cls}`}>{text}</span>)}
                {'\n'}
              </span>
            ))}
          </pre>
          <div className="lp-board">
            <span className="lp-led" />
            <span>PB5 · LED</span>
            <span className="spacer" />
            <span className="lp-out">toggling every 500 ms</span>
          </div>
        </div>
      </section>

      <Suspense fallback={<div className="lp-stats" />}><HomeStats /></Suspense>

      <h2 className="lp-section-title">One path, three steps</h2>
      <div className="lp-paths">
        <a className="lp-path" href="#/learn">
          <span className="lp-path-no">01</span>
          <h3>Learn</h3>
          <p>Two modules: Learn C from Zero for complete beginners, then the Embedded C that firmware is built from. Plus the top theory interview questions and a quick reference.</p>
          <span className="lp-path-go">Open Learn →</span>
        </a>
        <a className="lp-path" href="#/practice">
          <span className="lp-path-no">02</span>
          <h3>Practice</h3>
          <p>Every problem in one list, from returning your first value to ring buffers, CRCs and state machines. Run against the examples, then submit to hidden tests.</p>
          <span className="lp-path-go">Open Practice →</span>
        </a>
        <a className="lp-path" href="#/lab">
          <span className="lp-path-no">03</span>
          <h3>Simulate</h3>
          <p>SiliconLab: write Arduino-style C/C++, wire up a circuit and run it live, with starter sketches and graded challenges.</p>
          <span className="lp-path-go">Open the lab →</span>
        </a>
      </div>

      <footer className="lp-foot">
        <Logo size={20} cut="var(--bg)" />
        <span>Try Embedded · learn by building, breaking and debugging</span>
      </footer>
    </>
  );
}

export function Home({ route }: { route: Route }) {
  const page = route.page;
  const current = (p: Route['page']) => (page === p ? 'page' as const : undefined);
  return (
    <>
      <header className="home-nav" role="banner">
        <a className="home-brand" href="#/" aria-label="Try Embedded home"><Wordmark size={21} /></a>
        <span className="spacer" />
        <nav className="home-tabs" aria-label="Sections">
          <a className="tab" href="#/learn" aria-current={current('learn')}>Learn</a>
          <a className="tab" href="#/practice" aria-current={current('practice')}>Practice</a>
          <a className="tab" href="#/lab">Simulate</a>
        </nav>
        <ThemeToggle />
        {page === 'home' && <a className="lp-btn small" href="#/learn">Start free</a>}
      </header>
      {page === 'learn' || page === 'practice' ? (
        <Suspense fallback={<div className="home-body" role="main"><div className="home-inner"><p className="ec-empty">Loading…</p></div></div>}>
          <EmbeddedC section={page} id={route.path[0]} />
        </Suspense>
      ) : (
        <div className="home-body" role="main">
          <div className="home-inner lp"><Overview /></div>
        </div>
      )}
    </>
  );
}
