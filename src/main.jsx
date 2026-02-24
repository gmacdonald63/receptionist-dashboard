import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Register PWA service worker
if ('serviceWorker' in navigator) {
  import('virtual:pwa-register').then(({ registerSW }) => {
    // Store the update callback globally so UpdatePrompt can access it
    window.__pwaUpdateSW = registerSW({
      onNeedRefresh() {
        // Dispatch custom event for UpdatePrompt component
        window.dispatchEvent(new CustomEvent('pwa-update-available'));
      },
      onOfflineReady() {
        console.log('PWA: App ready for offline use');
      },
    });
  });
}
