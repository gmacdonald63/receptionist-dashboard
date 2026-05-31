import React, { useState, useEffect, useRef } from 'react';
import { Phone, PhoneOff, Mic, MicOff } from 'lucide-react';
import { RetellWebClient } from 'retell-client-js-sdk';

const SUPABASE_URL = 'https://zmppdmfdhknnwzwdfhwf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InptcHBkbWZkaGtubnd6d2RmaHdmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4MzQyMDYsImV4cCI6MjA4NTQxMDIwNn0.mXfuz8mEZhizFen78gUaakBDbrzANn4ZM1a7KuDiKJs';
const VOICES = [
  { agentId: 'agent_c48b68df1da80f01e2c1eea6aa', label: 'Kate' },
  { agentId: 'agent_320fc02880a375cc8ce443ee89', label: 'Jason' },
];

const CallReceptionist = () => {
  const [callStatus, setCallStatus] = useState('idle'); // idle | connecting | connected | ended
  const [isMuted, setIsMuted] = useState(false);
  const [isAgentTalking, setIsAgentTalking] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState(VOICES[0].agentId);
  const retellClientRef = useRef(null);

  useEffect(() => {
    const client = new RetellWebClient();
    retellClientRef.current = client;

    client.on('call_started', () => setCallStatus('connected'));
    client.on('call_ended', () => {
      setCallStatus('ended');
      setIsMuted(false);
      setIsAgentTalking(false);
    });
    client.on('agent_start_talking', () => setIsAgentTalking(true));
    client.on('agent_stop_talking', () => setIsAgentTalking(false));
    client.on('error', (err) => {
      console.error('Retell call error:', err);
      setCallStatus('idle');
      client.stopCall();
    });

    return () => {
      client.stopCall();
    };
  }, []);

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
        body: JSON.stringify({ agent_id: selectedVoice }),
      });

      if (!response.ok) {
        throw new Error(`Failed to create web call: ${response.status}`);
      }

      const data = await response.json();
      await retellClientRef.current.startCall({ accessToken: data.access_token });
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
    if (isMuted) retellClientRef.current?.unmute();
    else retellClientRef.current?.mute();
    setIsMuted(!isMuted);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <div className="mb-8">
          <div className="w-20 h-20 mx-auto mb-4 bg-green-600 rounded-full flex items-center justify-center">
            <Phone className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">Talk to the AI Receptionist</h1>
          <p className="text-gray-400">
            Experience a real conversation with our AI receptionist — book an appointment, ask
            questions, hear the voice quality for yourself.
          </p>
        </div>

        {callStatus === 'idle' && (
          <div className="space-y-5">
            <div>
              <p className="text-sm font-medium text-gray-400 mb-3">Choose your receptionist</p>
              <div className="inline-flex bg-gray-800 border border-gray-700 rounded-xl p-1 gap-1">
                {VOICES.map((voice) => (
                  <button
                    key={voice.id}
                    onClick={() => setSelectedVoice(voice.agentId)}
                    className={`px-8 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                      selectedVoice === voice.agentId
                        ? 'bg-green-600 text-white shadow'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    {voice.label}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={startCall}
              className="w-full bg-green-600 hover:bg-green-700 text-white font-bold text-lg py-5 px-8 rounded-2xl shadow-xl transition-colors flex items-center justify-center gap-3"
            >
              <Phone className="w-6 h-6" />
              Start the Call
            </button>
          </div>
        )}

        {callStatus === 'connecting' && (
          <div className="bg-gray-800 border border-gray-700 rounded-2xl p-8">
            <div className="w-12 h-12 mx-auto mb-4 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-white font-medium">Connecting...</p>
          </div>
        )}

        {callStatus === 'connected' && (
          <div className="bg-gray-800 border border-gray-700 rounded-2xl p-8">
            <p className="text-white font-medium mb-2">Connected</p>
            <p className="text-sm text-gray-400 mb-6">
              {isAgentTalking ? 'Receptionist is speaking…' : 'Listening…'}
            </p>

            <div className="flex justify-center gap-1 mb-6 h-8 items-center">
              {[...Array(7)].map((_, i) => (
                <div
                  key={i}
                  className={`w-1.5 rounded-full transition-all duration-150 ${
                    isAgentTalking ? 'bg-green-500' : 'bg-gray-600'
                  }`}
                  style={{
                    height: isAgentTalking ? `${12 + Math.random() * 20}px` : '6px',
                  }}
                />
              ))}
            </div>

            <div className="flex justify-center gap-4">
              <button
                onClick={toggleMute}
                className={`p-4 rounded-full transition-colors ${
                  isMuted ? 'bg-yellow-600 hover:bg-yellow-700' : 'bg-gray-700 hover:bg-gray-600'
                }`}
                title={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted ? (
                  <MicOff className="w-6 h-6 text-white" />
                ) : (
                  <Mic className="w-6 h-6 text-white" />
                )}
              </button>
              <button
                onClick={endCall}
                className="p-4 bg-red-600 hover:bg-red-700 rounded-full transition-colors"
                title="End call"
              >
                <PhoneOff className="w-6 h-6 text-white" />
              </button>
            </div>
          </div>
        )}

        {callStatus === 'ended' && (
          <div className="bg-gray-800 border border-gray-700 rounded-2xl p-8">
            <p className="text-white font-medium mb-4">Call ended</p>
            <button
              onClick={startCall}
              className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-4 px-6 rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              <Phone className="w-5 h-5" />
              Call Again
            </button>
          </div>
        )}

        <p className="text-xs text-gray-500 mt-8">
          Powered by Reliant Support · This is a live demo
        </p>
      </div>
    </div>
  );
};

export default CallReceptionist;
