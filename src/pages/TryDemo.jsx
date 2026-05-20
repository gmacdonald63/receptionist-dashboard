import React, { useState } from 'react';
import { LayoutDashboard, ArrowRight } from 'lucide-react';

const SUPABASE_URL = 'https://zmppdmfdhknnwzwdfhwf.supabase.co';

const TryDemo = () => {
  const [loading, setLoading] = useState(false);

  const openDashboard = () => {
    setLoading(true);
    window.location.href = `${SUPABASE_URL}/functions/v1/generate-demo-token`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <div className="mb-8">
          <div className="w-20 h-20 mx-auto mb-4 bg-blue-600 rounded-full flex items-center justify-center">
            <LayoutDashboard className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">Try the Demo Dashboard</h1>
          <p className="text-gray-400">
            See how appointments, calls, and customers come together in one view — bookable,
            callable, completely live.
          </p>
        </div>

        <button
          onClick={openDashboard}
          disabled={loading}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-70 disabled:cursor-wait text-white font-bold text-lg py-5 px-8 rounded-2xl shadow-xl transition-colors flex items-center justify-center gap-3"
        >
          {loading ? (
            <>
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Opening Dashboard…
            </>
          ) : (
            <>
              Open the Dashboard
              <ArrowRight className="w-6 h-6" />
            </>
          )}
        </button>

        <p className="text-xs text-gray-500 mt-8">
          Powered by Reliant Support · This is a live demo
        </p>
      </div>
    </div>
  );
};

export default TryDemo;
