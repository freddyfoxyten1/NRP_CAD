// ─────────────────────────────────────────────────────────────────────────────
// main.tsx  —  React entry point
//
// Mounts the root <App /> component into the #root div defined in index.html.
// ─────────────────────────────────────────────────────────────────────────────
import { createRoot } from 'react-dom/client';

import App from './App';
import { installApiOrigin } from './lib/api-origin';

import './index.css';

installApiOrigin();

try {
  localStorage.removeItem('dojcad-appearance');
} catch {
  /* ignore */
}

createRoot(document.getElementById('root')!).render(<App />);
