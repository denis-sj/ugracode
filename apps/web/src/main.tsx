import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import '@ugra/ui/tokens.css';
import '@ugra/ui/styles.css';
import './styles.css';
import { PhoneCallPage } from '../../../modules/voice-call/web/PhoneCallPage';
import { isCallPath } from '../../../modules/voice-call/web/call-flow';
import { api } from './api';

// Телефону нужен только звонок: остальные экраны и их данные загружаем отдельно.
const App = lazy(() => import('./App').then(({ App }) => ({ default: App })));
const callPage = isCallPath(window.location.pathname, window.location.hash);

const container = document.getElementById('root');

if (!container) {
  throw new Error('Не найден корневой элемент #root');
}

createRoot(container).render(
  <StrictMode>
    {callPage ? (
      <div className="app app--call">
        <div className="app__content"><PhoneCallPage api={api} /></div>
      </div>
    ) : (
      <Suspense fallback={<div className="splash">Загружаем диспетчерскую…</div>}><App /></Suspense>
    )}
  </StrictMode>,
);
