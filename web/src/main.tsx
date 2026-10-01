import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, CrashBoundary } from './App';
import { store } from './store';
import { applyTheme } from './theme';
import './styles.css';

applyTheme();
store.boot();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CrashBoundary>
      <App />
    </CrashBoundary>
  </StrictMode>,
);
