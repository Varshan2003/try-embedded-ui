import { lazy, Suspense } from 'react';
import logo from '../assets/logo.svg';
import type { Route } from '../route';
import { ThemeToggle } from './ThemeToggle';

// Loaded on demand: the guides and the C interpreter are not needed to open the lab.
const EmbeddedC = lazy(() => import('../embedded-c/EmbeddedC').then(m => ({ default: m.EmbeddedC })));

function Overview() {
  return (
    <>
      <div className="home-hero">
        <img src={logo} alt="" />
        <h1>Learn embedded systems by building, breaking and debugging</h1>
        <p>Try Embedded is an interview-first learning platform: guided lessons, realistic hardware simulation and timed challenges in one browser workspace.</p>
      </div>
      <h2 className="home-section-title">Start here</h2>
      <a className="home-card" href="#/lab">
        <div className="home-card-text">
          <h2>SiliconLab simulator</h2>
          <p>Write Arduino-style C/C++, wire up a circuit and run it live. Includes starter sketches and graded challenges.</p>
        </div>
        <span className="home-card-go">Open the lab →</span>
      </a>
      <a className="home-card" href="#/embedded-c">
        <div className="home-card-text">
          <h2>Embedded C</h2>
          <p>A course that starts from zero. Short guides with examples you can run, and graded practice problems, from your first function to ring buffers, CRCs and state machines.</p>
        </div>
        <span className="home-card-go">Learn and practise →</span>
      </a>
    </>
  );
}

export function Home({ route }: { route: Route }) {
  const page = route.page;
  return (
    <>
      <header className="home-nav" role="banner">
        <a className="home-brand" href="#/"><img src={logo} alt="" />Try Embedded</a>
        <nav className="home-tabs" aria-label="Sections">
          <a className="tab" href="#/" aria-current={page === 'home' ? 'page' : undefined}>Home</a>
          <a className="tab" href="#/embedded-c" aria-current={page === 'embedded-c' ? 'page' : undefined}>Embedded C</a>
        </nav>
        <span className="spacer" />
        <ThemeToggle />
      </header>
      {page === 'embedded-c' ? (
        <Suspense fallback={<div className="home-body" role="main"><div className="home-inner"><p className="ec-empty">Loading…</p></div></div>}>
          <EmbeddedC path={route.path} />
        </Suspense>
      ) : (
        <div className="home-body" role="main">
          <div className="home-inner"><Overview /></div>
        </div>
      )}
    </>
  );
}
