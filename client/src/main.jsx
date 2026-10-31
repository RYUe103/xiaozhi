import 'regenerator-runtime/runtime';
import { createRoot } from 'react-dom/client';
import './locales/i18n';
import App from './App';
import './style.css';
import './mobile.css';
import { ApiErrorBoundaryProvider } from './hooks/ApiErrorBoundaryContext';
import 'katex/dist/katex.min.css';
import 'katex/dist/contrib/copy-tex.js';

const FRONTEND_RECOVERY_PARAM = '__frontend_recovery__';

try {
  if (typeof window !== 'undefined') {
    const recoveryUrl = new URL(window.location.href);
    if (recoveryUrl.searchParams.has(FRONTEND_RECOVERY_PARAM)) {
      recoveryUrl.searchParams.delete(FRONTEND_RECOVERY_PARAM);
      window.history.replaceState({}, document.title, recoveryUrl.toString());
    }
    if (typeof window.__SANSUO_FRONTEND_RECOVERY_CLEAR__ === 'function') {
      window.__SANSUO_FRONTEND_RECOVERY_CLEAR__();
    }
  }
} catch {}

const container = document.getElementById('root');
const root = createRoot(container);

root.render(
  <ApiErrorBoundaryProvider>
    <App />
  </ApiErrorBoundaryProvider>,
);
