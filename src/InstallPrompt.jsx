import React, { useState, useEffect } from 'react';
import { Download, X, Share } from 'lucide-react';

const DISMISSED_KEY = 'pwa-install-dismissed';
const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const isIosSafari = () => {
  const ua = navigator.userAgent;
  const isIos = /iphone|ipad|ipod/i.test(ua);
  // Exclude Chrome on iOS (it uses CriOS) — those get the standard prompt
  const isSafari = /safari/i.test(ua) && !/crios|fxios|opios/i.test(ua);
  return isIos && isSafari;
};

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  window.navigator.standalone === true;

const wasDismissedRecently = () => {
  const ts = localStorage.getItem(DISMISSED_KEY);
  return ts && Date.now() - Number(ts) < COOLDOWN_MS;
};

const InstallPrompt = () => {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showIosPrompt, setShowIosPrompt] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (isStandalone() || wasDismissedRecently()) {
      setDismissed(true);
      return;
    }

    if (isIosSafari()) {
      setShowIosPrompt(true);
      return;
    }

    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleAndroidInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
    }
  };

  const handleDismiss = () => {
    localStorage.setItem(DISMISSED_KEY, String(Date.now()));
    setDismissed(true);
    setDeferredPrompt(null);
    setShowIosPrompt(false);
  };

  if (dismissed) return null;

  // iOS Safari — manual install instructions
  if (showIosPrompt) {
    return (
      <div className="fixed top-20 left-4 right-4 z-50 max-w-md mx-auto">
        <div className="bg-gray-800 border border-gray-600 rounded-xl p-4 shadow-2xl">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center mt-0.5">
              <Share className="w-5 h-5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm font-medium mb-1">Install App</p>
              <p className="text-gray-400 text-xs leading-relaxed">
                Tap the{' '}
                <span className="inline-flex items-center gap-0.5 text-white font-medium">
                  Share
                </span>{' '}
                button at the bottom of your browser, then tap{' '}
                <span className="text-white font-medium">"Add to Home Screen"</span>
              </p>
            </div>
            <button
              onClick={handleDismiss}
              className="flex-shrink-0 p-1 text-gray-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Android / Chrome — native install prompt
  if (!deferredPrompt) return null;

  return (
    <div className="fixed top-20 left-4 right-4 z-50 max-w-md mx-auto">
      <div className="bg-gray-800 border border-gray-600 rounded-xl p-4 shadow-2xl flex items-center gap-3">
        <div className="flex-shrink-0 w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
          <Download className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white text-sm font-medium">Install App</p>
          <p className="text-gray-400 text-xs">Add to home screen for quick access</p>
        </div>
        <button
          onClick={handleAndroidInstall}
          className="flex-shrink-0 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
        >
          Install
        </button>
        <button
          onClick={handleDismiss}
          className="flex-shrink-0 p-1 text-gray-400 hover:text-white"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

export default InstallPrompt;
