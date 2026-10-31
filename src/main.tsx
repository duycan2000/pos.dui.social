import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(<App />);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
// Ask the browser to keep IndexedDB (unsynced orders) even under storage pressure.
navigator.storage?.persist?.().catch(() => {});
