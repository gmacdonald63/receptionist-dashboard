// src/components/DispatcherMap.jsx
import React, { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, CircleMarker } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';  // Scoped here only — do NOT import in main.jsx
import { supabase } from '../supabaseClient';
import { X, Users } from 'lucide-react';

const STADIA_URL = 'https://tiles.stadiamaps.com/tiles/osm_bright/{z}/{x}/{y}{r}.png';
const STADIA_ATTR = '&copy; <a href="https://stadiamaps.com/">Stadia Maps</a>, &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> &copy; <a href="http://openstreetmap.org">OpenStreetMap</a> contributors';

const STATUS_COLORS = { confirmed: '#EAB308', en_route: '#3B82F6', complete: '#22C55E' };
const minsAgo = (ts) => ts ? Math.floor((Date.now() - new Date(ts).getTime()) / 60000) : null;

const DispatcherMap = ({ clientId, technicians, jobs }) => {
  const [techLocations, setTechLocations] = useState([]);
  const [selectedTechId, setSelectedTechId] = useState(null);
  const [selectedJobId,  setSelectedJobId]  = useState(null);
  const [realtimeOk, setRealtimeOk] = useState(true);
  const [showLegend, setShowLegend] = useState(false);  // collapsed by default
  const realtimeOkRef = useRef(true);  // ref mirror avoids stale closure in setInterval

  // Initial load
  useEffect(() => {
    supabase.from('tech_locations').select('*').eq('client_id', clientId)
      .then(({ data }) => setTechLocations(data || []));
  }, [clientId]);

  // Realtime subscription
  useEffect(() => {
    const ch = supabase
      .channel(`tech-locations:${clientId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tech_locations', filter: `client_id=eq.${clientId}` },
        (payload) => setTechLocations(prev => {
          if (payload.eventType === 'DELETE') {
            return prev.filter(l => l.technician_id !== payload.old?.technician_id);
          }
          if (!payload.new?.technician_id) return prev;
          const idx = prev.findIndex(l => l.technician_id === payload.new.technician_id);
          if (idx >= 0) { const n = [...prev]; n[idx] = payload.new; return n; }
          return [...prev, payload.new];
        })
      )
      .subscribe(s => {
        const ok = s === 'SUBSCRIBED';
        setRealtimeOk(ok);
        realtimeOkRef.current = ok;  // keep ref in sync for poll guard
      });

    // Fallback poll when realtime drops — uses ref to avoid stale closure
    const poll = setInterval(() => {
      if (realtimeOkRef.current) return;
      supabase.from('tech_locations').select('*').eq('client_id', clientId)
        .then(({ data }) => { if (data) setTechLocations(data); });
    }, 30000);

    return () => { supabase.removeChannel(ch); clearInterval(poll); };
  }, [clientId]);

  const techById = Object.fromEntries(technicians.map(t => [t.id, t]));
  const selectedTechLoc = techLocations.find(l => l.technician_id === selectedTechId);
  const selectedTechAge = selectedTechLoc ? minsAgo(selectedTechLoc.received_at) : null;
  const selectedJob = jobs.find(j => j.id === selectedJobId);
  // Active job for the tapped tech — shown in tech detail panel per spec
  const selectedTechJob = jobs.find(j =>
    j.technician_id === selectedTechId &&
    (j.status === 'en_route' || j.status === 'confirmed')
  );

  return (
    <div className="relative h-full w-full">
      {!realtimeOk && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-[1000] bg-amber-600 text-white text-xs px-3 py-1 rounded-full shadow">
          Live updates paused — reconnecting...
        </div>
      )}

      <MapContainer center={[39.5, -98.35]} zoom={5} style={{ height: '100%', width: '100%' }} zoomControl={false}>
        <TileLayer url={STADIA_URL} attribution={STADIA_ATTR} />

        {techLocations.map(loc => {
          const age = minsAgo(loc.received_at);
          const veryStale = age > 15;
          const stale = age > 5;
          const color = veryStale ? '#6B7280' : (stale ? '#9CA3AF' : (techById[loc.technician_id]?.color || '#3B82F6'));
          return (
            <CircleMarker key={loc.technician_id} center={[loc.lat, loc.lng]} radius={10}
              pathOptions={{ color: loc.technician_id === selectedTechId ? '#fff' : color, fillColor: color, fillOpacity: veryStale ? 0.3 : 0.8, weight: loc.technician_id === selectedTechId ? 3 : 1.5 }}
              eventHandlers={{ click: () => { setSelectedTechId(loc.technician_id); setSelectedJobId(null); } }}
            />
          );
        })}

        {jobs.map(apt => apt.job_lat && apt.job_lng ? (
          <CircleMarker key={apt.id} center={[apt.job_lat, apt.job_lng]} radius={8}
            pathOptions={{ color: '#fff', fillColor: STATUS_COLORS[apt.status] || '#EAB308', fillOpacity: 0.9, weight: 1.5 }}
            eventHandlers={{ click: () => { setSelectedJobId(apt.id); setSelectedTechId(null); } }}
          />
        ) : null)}
      </MapContainer>

      {/* Tech detail panel */}
      {selectedTechLoc && (
        <div className="absolute bottom-0 left-0 right-0 bg-gray-800 border-t border-gray-700 p-4 z-[1000]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 rounded-full" style={{ backgroundColor: techById[selectedTechLoc.technician_id]?.color || '#6B7280' }} />
              <div>
                <p className="text-white font-medium">{techById[selectedTechLoc.technician_id]?.name || 'Unknown'}</p>
                {selectedTechLoc.non_job_status && <p className="text-amber-400 text-xs">{selectedTechLoc.non_job_status}</p>}
                <p className="text-gray-500 text-xs">
                  {selectedTechAge != null ? `Updated ${selectedTechAge} min ago` : 'Unknown'}
                </p>
              </div>
            </div>
            <button onClick={() => setSelectedTechId(null)} className="p-2 hover:bg-gray-700 rounded-lg">
              <X className="w-4 h-4 text-gray-400" />
            </button>
          </div>
          {/* Current job info — shown when tech has an active en_route or confirmed job */}
          {selectedTechJob && (
            <div className="mt-2 pt-2 border-t border-gray-700">
              <p className="text-gray-300 text-sm font-medium">{selectedTechJob.caller_name || 'Customer'}</p>
              {(selectedTechJob.address || selectedTechJob.city) && (
                <p className="text-gray-500 text-xs mt-0.5">
                  {[selectedTechJob.address, selectedTechJob.city].filter(Boolean).join(', ')}
                </p>
              )}
              {selectedTechJob.start_time && (
                <p className="text-gray-500 text-xs">
                  {selectedTechJob.start_time.slice(0,5)}{selectedTechJob.end_time ? ` – ${selectedTechJob.end_time.slice(0,5)}` : ''}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Job detail panel with reassign */}
      {selectedJob && (
        <JobPanel job={selectedJob} technicians={technicians} clientId={clientId} onClose={() => setSelectedJobId(null)} />
      )}

      {/* Legend — collapsible, collapsed by default on mobile to preserve map space */}
      {techLocations.length > 0 && (
        <div className="absolute top-2 right-2 z-[1000]">
          <button
            onClick={() => setShowLegend(v => !v)}
            className="bg-gray-800/90 rounded-lg p-2 shadow flex items-center gap-1"
            title={showLegend ? 'Hide legend' : 'Show legend'}
          >
            <Users className="w-4 h-4 text-gray-300" />
            {!showLegend && <span className="text-xs text-gray-400">{techLocations.length}</span>}
          </button>
          {showLegend && (
            <div className="mt-1 bg-gray-800/90 rounded-lg px-3 py-2 shadow">
              {technicians.filter(t => techLocations.find(l => l.technician_id === t.id)).map(t => (
                <div key={t.id} className="flex items-center gap-2 text-xs text-gray-300 py-0.5">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: t.color }} />
                  {t.name}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {techLocations.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[500]">
          <div className="bg-gray-800/90 text-gray-300 text-sm px-4 py-3 rounded-lg text-center max-w-xs">
            No techs currently active
          </div>
        </div>
      )}
    </div>
  );
};

const JobPanel = ({ job, technicians, clientId, onClose }) => {
  const [reassigning, setReassigning] = useState(false);

  const reassign = async (techId) => {
    setReassigning(false);
    await supabase.from('appointments').update({ technician_id: parseInt(techId) }).eq('id', job.id).eq('client_id', clientId);
    onClose();
  };

  return (
    <div className="absolute bottom-0 left-0 right-0 bg-gray-800 border-t border-gray-700 p-4 z-[1000]">
      <div className="flex justify-between items-start mb-3">
        <div>
          <p className="text-white font-medium">{job.caller_name || 'Customer'}</p>
          <p className="text-gray-400 text-sm">{job.start_time?.slice(0,5)}{job.end_time ? ` – ${job.end_time.slice(0,5)}` : ''}</p>
          {job.service_type && <p className="text-gray-500 text-xs">{job.service_type}</p>}
        </div>
        <button onClick={onClose} className="p-2 hover:bg-gray-700 rounded-lg"><X className="w-4 h-4 text-gray-400" /></button>
      </div>
      {reassigning ? (
        <div className="space-y-2">
          <p className="text-xs text-gray-500 uppercase mb-1">Select Tech</p>
          {technicians.filter(t => t.is_active).map(t => (
            <button key={t.id} onClick={() => reassign(t.id)}
              className="w-full py-3 bg-gray-700 text-white rounded-lg text-left px-3 flex items-center gap-2">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: t.color }} />{t.name}
            </button>
          ))}
        </div>
      ) : (
        <button onClick={() => setReassigning(true)} className="w-full py-3 bg-blue-600 text-white rounded-lg font-medium">
          Reassign
        </button>
      )}
    </div>
  );
};

export default DispatcherMap;
