import React, { useState, useEffect } from 'react';
import { RefreshCw, X } from 'lucide-react';

const UpdatePrompt = () => {
  const [showUpdate, setShowUpdate] = useState(false);

  useEffect(() => {
    const handler = () => setShowUpdate(true);
    window.addEventListener('pwa-update-available', handler);
    return () => window.removeEventListener('pwa-update-available', handler);
  }, []);

  const handleUpdate = () => {
    if (window.__pwaUpdateSW) {
      window.__pwaUpdateSW(true);
    }
  };

  const handleDismiss = () => {
    setShowUpdate(false);
  };

  if (!showUpdate) return null;

  return (
    <div className="fixed bottom-24 left-4 right-4 z-50 max-w-md mx-auto">
      <div className="bg-blue-900 border border-blue-700 rounded-xl p-4 shadow-2xl flex items-center gap-3">
        <div className="flex-shrink-0 w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
          <RefreshCw className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white text-sm font-medium">Update Available</p>
          <p className="text-blue-300 text-xs">A new version is ready to install</p>
        </div>
        <button
          onClick={handleUpdate}
          className="flex-shrink-0 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
        >
          Update
        </button>
        <button
          onClick={handleDismiss}
          className="flex-shrink-0 p-1 text-blue-400 hover:text-white"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

export default UpdatePrompt;
