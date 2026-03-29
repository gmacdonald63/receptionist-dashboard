// src/pages/TrackingPage.jsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, CircleMarker, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';  // Must import here — TrackingPage renders without DispatcherMap in the tree
import { CheckCircle } from 'lucide-react';
import logo from '../assets/RELIANT SUPPORT LOGO.svg';

const FN_URL = 'https://zmppdmfdhknnwzwdfhwf.supabase.co/functions/v1';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InptcHBkbWZkaGtubnd6d2RmaHdmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4MzQyMDYsImV4cCI6MjA4NTQxMDIwNn0.mXfuz8mEZhizFen78gUaakBDbrzANn4ZM1a7KuDiKJs';
const STADIA = `https://tiles.stadiamaps.com/tiles/osm_bright/{z}/{x}/{y}{r}.png?api_key=${import.meta.env.VITE_STADIA_API_KEY || ''}`;

if (import.meta.env.DEV && !import.meta.env.VITE_STADIA_API_KEY) {
  console.warn('TrackingPage: VITE_STADIA_API_KEY is not set — map tiles will fail');
}

// Re-centers the map when the tech's location updates
const Recenter = ({ lat, lng }) => {
  const map = useMap();
  useEffect(() => { map.setView([lat, lng], map.getZoom()); }, [lat, lng]);
  return null;
};

const TrackingPage = ({ token }) => {
  const [status, setStatus] = useState('loading'); // loading | en_route | complete | error
  const [data, setData] = useState(null);
  const pollRef = useRef(null);

  const fetch_ = useCallback(async () => {
    if (!token) { setStatus('error'); return; }
    try {
      // apikey header required by Supabase API gateway even on --no-verify-jwt functions
      const res = await fetch(`${FN_URL}/get-tracking-data?token=${token}`, {
        headers: { 'apikey': SUPABASE_ANON_KEY },
      });
      // 4xx = invalid/expired token — stop polling
      if (res.status === 403 || res.status === 404) {
        setStatus('error');
        clearInterval(pollRef.current);
        return;
      }
      // 5xx / network error = transient — keep polling, don't surface error to customer
      if (!res.ok) return;
      const d = await res.json();
      if (d.status === 'complete') { setStatus('complete'); clearInterval(pollRef.current); return; }
      setData(d); setStatus('en_route');
    } catch { setStatus('error'); }
  }, [token]);

  useEffect(() => {
    fetch_();
    pollRef.current = setInterval(fetch_, 30000);
    return () => clearInterval(pollRef.current);
  }, [token]);

  if (status === 'loading') return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center">
      <div className="text-center text-gray-400">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p>Loading tracking information...</p>
      </div>
    </div>
  );

  if (status === 'error') return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-6">
      <div className="text-center">
        <img src={logo} alt="Reliant Support" className="h-8 mx-auto mb-6" />
        <p className="text-gray-300 text-lg mb-2">This tracking link has expired.</p>
        <p className="text-gray-500 text-sm">The technician has arrived, or this link is no longer valid.</p>
      </div>
    </div>
  );

  if (status === 'complete') return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-6">
      <div className="text-center">
        <img src={logo} alt="Reliant Support" className="h-8 mx-auto mb-6" />
        <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
        <p className="text-white text-xl font-semibold mb-2">Service Complete</p>
        <p className="text-gray-400">Thank you for choosing Reliant Support.</p>
      </div>
    </div>
  );

  // en_route
  if (!data) return null; // guards against future regressions — data is always set before status='en_route'
  const { tech, appointment } = data;
  const hasLoc = tech?.lat != null && tech?.lng != null;

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      <div className="bg-gray-800 border-b border-gray-700 px-4 py-3 flex items-center gap-3">
        <img src={logo} alt="Reliant Support" className="h-6" />
        <div>
          <p className="text-white text-sm font-medium">{tech?.first_name || 'Your technician'} is on the way!</p>
          {appointment?.start_time && (
            <p className="text-gray-400 text-xs">
              Scheduled: {appointment.start_time.slice(0,5)}{appointment.end_time ? ` – ${appointment.end_time.slice(0,5)}` : ''}
            </p>
          )}
        </div>
        <div className="ml-auto w-4 h-4 rounded-full" style={{ backgroundColor: tech?.color || '#3B82F6' }} />
      </div>
      <div className="flex-1" style={{ minHeight: 0 }}>
        {hasLoc ? (
          <MapContainer center={[tech.lat, tech.lng]} zoom={13} style={{ height: '100%', width: '100%' }} zoomControl={false}>
            <TileLayer url={STADIA} />
            <Recenter lat={tech.lat} lng={tech.lng} />
            <CircleMarker center={[tech.lat, tech.lng]} radius={12}
              pathOptions={{ color: '#fff', fillColor: tech.color, fillOpacity: 0.9, weight: 2 }} />
          </MapContainer>
        ) : (
          <div className="h-full flex items-center justify-center text-gray-500 text-sm">
            Waiting for location update...
          </div>
        )}
      </div>
    </div>
  );
};

export default TrackingPage;
