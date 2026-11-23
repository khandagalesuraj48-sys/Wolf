import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { syncClock } from './lib/fmt';
import './styles/app.css';

// (23-11-2026) the server's clock: the meal of now follows it, not the phone's own time; taken again every 10 minutes
void syncClock();
setInterval(() => { void syncClock(); }, 10 * 60 * 1000);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
