import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Phone, PhoneOff, Mic, MicOff, Clock, Link2, RotateCcw, LogOut, X, Copy, Check } from 'lucide-react';
import { RetellWebClient } from 'retell-client-js-sdk';
import { supabase } from './supabaseClient';

const SUPABASE_URL = 'https://zmppdmfdhknnwzwdfhwf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InptcHBkbWZkaGtubnd6d2RmaHdmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4MzQyMDYsImV4cCI6MjA4NTQxMDIwNn0.mXfuz8mEZhizFen78gUaakBDbrzANn4ZM1a7KuDiKJs';

const DemoDashboard = ({ demoClientData, expiresAt, isPublicDemo, demoToken, onExitDemo, onDataRefresh }) => {
  // Call state
  const [callStatus, setCallStatus] = useState('idle'); // idle | connecting | connected | ended
  const [isMuted, setIsMuted] = useState(false);
  const [isAgentTalking, setIsAgentTalking] = useState(false);
  const retellClientRef = useRef(null);

  // Timer state
  const [timeRemaining, setTimeRemaining] = useState(null);
  const [showExpired, setShowExpired] = useState(false);
  const [showWarning, setShowWarning] = useState(false);

  // Link generation
  const [generatingLink, setGeneratingLink] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [resetting, setResetting] = useState(false);

  // Initialize Retell Web Client
  useEffect(() => {
    const client = new RetellWebClient();
    retellClientRef.current = client;

    client.on('call_started', () => {
      setCallStatus('connected');
    });

    client.on('call_ended', () => {
      setCallStatus('ended');
      setIsMuted(false);
      setIsAgentTalking(false);
      // Auto-refresh dashboard data after call ends to show new appointment
      setTimeout(() => {
        if (onDataRefresh) onDataRefresh();
        setCallStatus('idle');
      }, 2000);
    });

    client.on('agent_start_talking', () => {
      setIsAgentTalking(true);
    });

    client.on('agent_stop_talking', () => {
      setIsAgentTalking(false);
    });

    client.on('error', (error) => {
      console.error('Retell call error:', error);
      setCallStatus('idle');
      client.stopCall();
    });

    return () => {
      client.stopCall();
    };
  }, [onDataRefresh]);

  // Countdown timer
  useEffect(() => {
    if (!expiresAt) return;

    const updateTimer = () => {
      const now = new Date();
      const expires = new Date(expiresAt);
      const diff = expires - now;

      if (diff <= 0) {
        setTimeRemaining(0);
        setShowExpired(true);
        handleAutoReset();
        return;
      }

      setTimeRemaining(diff);

      // Warning at 5 minutes
      if (diff <= 5 * 60 * 1000 && !showWarning) {
        setShowWarning(true);
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  // Auto-reset on tab close
  useEffect(() => {
    const handleBeforeUnload = () => {
      const url = `${SUPABASE_URL}/functions/v1/reset-demo-data`;
      navigator.sendBeacon(url, JSON.stringify({}));
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  const handleAutoReset = async () => {
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/reset-demo-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      console.error('Auto-reset failed:', err);
    }
  };

  const handleManualReset = async () => {
    if (!confirm('Reset all demo data? This will clear any changes made during the demo.')) return;
    setResetting(true);
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/reset-demo-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (onDataRefresh) onDataRefresh();
    } catch (err) {
      console.error('Reset failed:', err);
    } finally {
      setResetting(false);
    }
  };

  const startCall = async () => {
    setCallStatus('connecting');
    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/create-web-call`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          agent_id: demoClientData?.retell_agent_id || 'agent_be6189dedb9fa036a84c3dda19',
          demo_token: demoToken || null,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to create web call: ${response.status}`);
      }

      const data = await response.json();

      // Start the call (must happen within 30 seconds of token creation)
      await retellClientRef.current.startCall({
        accessToken: data.access_token,
      });
    } catch (err) {
      console.error('Failed to start call:', err);
      setCallStatus('idle');
      alert('Failed to start call. Please check your microphone permissions and try again.');
    }
  };

  const endCall = () => {
    retellClientRef.current?.stopCall();
    setCallStatus('idle');
    setIsMuted(false);
    setIsAgentTalking(false);
  };

  const toggleMute = () => {
    if (isMuted) {
      retellClientRef.current?.unmute();
    } else {
      retellClientRef.current?.mute();
    }
    setIsMuted(!isMuted);
  };

  const generateDemoLink = async () => {
    setGeneratingLink(true);
    try {
      const { data, error } = await supabase
        .from('demo_tokens')
        .insert([{ created_by: demoClientData?.id || 9999 }])
        .select('id, expires_at')
        .single();

      if (error) throw error;

      const link = `${window.location.origin}?demo=${data.id}`;
      await navigator.clipboard.writeText(link);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 3000);
    } catch (err) {
      console.error('Failed to generate demo link:', err);
      alert('Failed to generate demo link.');
    } finally {
      setGeneratingLink(false);
    }
  };

  const formatTimeRemaining = (ms) => {
    if (ms === null) return '';
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  // Show expired screen
  if (showExpired) {
    return (
      <div className="fixed inset-0 bg-gray-900 flex items-center justify-center z-[100]">
        <div className="text-center p-8">
          <Clock className="w-16 h-16 text-gray-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-white mb-2">Demo Session Ended</h1>
          <p className="text-gray-400 mb-6">This demo session has expired. Contact your sales representative for a new demo link.</p>
          {!isPublicDemo && (
            <button
              onClick={onExitDemo}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
            >
              Back to Dashboard
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Demo Banner */}
      <div className="bg-gradient-to-r from-purple-900/80 to-indigo-900/80 text-white text-center py-2.5 px-4 text-sm flex items-center justify-center gap-3 sticky top-0 z-[60] border-b border-purple-700/50 flex-wrap">
        <span className="font-medium">DEMO — {demoClientData?.company_name || 'Reliant Support Heating & Air'}</span>

        {/* Timer */}
        {timeRemaining !== null && (
          <span className={`px-2 py-0.5 rounded text-xs font-mono ${
            timeRemaining <= 5 * 60 * 1000 ? 'bg-red-600/80 animate-pulse' : 'bg-purple-700/80'
          }`}>
            <Clock className="w-3 h-3 inline mr-1" />
            {formatTimeRemaining(timeRemaining)}
          </span>
        )}

        {/* Call Receptionist button — shown in banner when idle */}
        {callStatus === 'idle' && (
          <button
            onClick={startCall}
            className="flex items-center gap-1.5 px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-medium transition-colors"
          >
            <Phone className="w-3 h-3" />
            Call Receptionist
          </button>
        )}

        {/* Sales rep controls */}
        {!isPublicDemo && (
          <>
            <button
              onClick={generateDemoLink}
              disabled={generatingLink}
              className="flex items-center gap-1 px-3 py-1 bg-purple-700 hover:bg-purple-600 rounded text-xs font-medium disabled:opacity-50"
            >
              {copiedLink ? <Check className="w-3 h-3" /> : <Link2 className="w-3 h-3" />}
              {copiedLink ? 'Copied!' : generatingLink ? 'Generating...' : 'Get Demo Link'}
            </button>
            <button
              onClick={handleManualReset}
              disabled={resetting}
              className="flex items-center gap-1 px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs font-medium disabled:opacity-50"
            >
              <RotateCcw className={`w-3 h-3 ${resetting ? 'animate-spin' : ''}`} />
              Reset
            </button>
            <button
              onClick={onExitDemo}
              className="flex items-center gap-1 px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs font-medium"
            >
              <LogOut className="w-3 h-3" />
              Exit Demo
            </button>
          </>
        )}
      </div>

      {/* 5-minute warning toast */}
      {showWarning && timeRemaining > 0 && timeRemaining <= 5 * 60 * 1000 && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-[70] bg-red-900/90 border border-red-700 rounded-lg px-4 py-3 text-red-200 text-sm shadow-lg flex items-center gap-2">
          <Clock className="w-4 h-4" />
          Demo expires in {formatTimeRemaining(timeRemaining)}
          <button onClick={() => setShowWarning(false)} className="ml-2 p-1 hover:bg-red-800 rounded">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Active Call UI */}
      {(callStatus === 'connecting' || callStatus === 'connected') && (
        <div className="fixed bottom-24 right-4 z-[55] bg-gray-800 border border-gray-700 rounded-2xl shadow-2xl p-4 w-72">
          <div className="text-center mb-3">
            <p className="text-white font-medium text-sm">
              {callStatus === 'connecting' ? 'Connecting...' : 'Reliant Support Heating & Air'}
            </p>
            {callStatus === 'connected' && (
              <p className="text-xs text-gray-400 mt-1">
                {isAgentTalking ? 'Receptionist is speaking...' : 'Listening...'}
              </p>
            )}
          </div>

          {/* Voice indicator */}
          {callStatus === 'connected' && (
            <div className="flex justify-center gap-1 mb-3">
              {[...Array(5)].map((_, i) => (
                <div
                  key={i}
                  className={`w-1 rounded-full transition-all duration-150 ${
                    isAgentTalking
                      ? 'bg-green-500'
                      : 'bg-gray-600'
                  }`}
                  style={{
                    height: isAgentTalking ? `${12 + Math.random() * 16}px` : '4px',
                    animationDelay: `${i * 0.1}s`,
                  }}
                />
              ))}
            </div>
          )}

          {/* Connecting spinner */}
          {callStatus === 'connecting' && (
            <div className="flex justify-center mb-3">
              <div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {/* Call controls */}
          <div className="flex justify-center gap-3">
            {callStatus === 'connected' && (
              <button
                onClick={toggleMute}
                className={`p-3 rounded-full transition-colors ${
                  isMuted ? 'bg-yellow-600 hover:bg-yellow-700' : 'bg-gray-700 hover:bg-gray-600'
                }`}
                title={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted ? <MicOff className="w-5 h-5 text-white" /> : <Mic className="w-5 h-5 text-white" />}
              </button>
            )}
            <button
              onClick={endCall}
              className="p-3 bg-red-600 hover:bg-red-700 rounded-full transition-colors"
              title="End call"
            >
              <PhoneOff className="w-5 h-5 text-white" />
            </button>
          </div>
        </div>
      )}

      {/* Call ended toast */}
      {callStatus === 'ended' && (
        <div className="fixed bottom-24 right-4 z-[55] bg-green-900/90 border border-green-700 rounded-lg px-4 py-3 text-green-200 text-sm shadow-lg">
          Call ended — refreshing dashboard...
        </div>
      )}
    </>
  );
};

export default DemoDashboard;
