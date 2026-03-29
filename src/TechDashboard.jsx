// src/TechDashboard.jsx
import React, { useState, useEffect } from 'react';
import { MapPin, CheckCircle, Navigation, RefreshCw, LogOut, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { supabase } from './supabaseClient';
import logo from './assets/RELIANT SUPPORT LOGO.svg';
import locationService from './utils/locationService.js';

const SUPABASE_FUNCTIONS_URL = 'https://zmppdmfdhknnwzwdfhwf.supabase.co/functions/v1';

const STATUS_CONFIG = {
  confirmed: { label: 'PENDING',   color: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30' },
  en_route:  { label: 'EN ROUTE',  color: 'bg-blue-500/20 text-blue-400 border border-blue-500/30' },
  complete:  { label: 'COMPLETE',  color: 'bg-green-500/20 text-green-400 border border-green-500/30' },
};

// Phase 1 features default on when row is absent; Phase 2 features default off
const PHASE2_FEATURES = [
  'gps_tracking', 'customer_sms', 'customer_tracking_link',
  'view_customer_history', 'view_customer_notes',
  'view_call_transcript', 'view_call_recording',
];
const isAllowed = (permissions, feature) => {
  const row = permissions.find(p => p.feature === feature);
  if (row) return row.enabled;
  return !PHASE2_FEATURES.includes(feature);
};

const buildMapsUrl = (apt) => {
  const addr = [apt.address, apt.city, apt.state, apt.zip].filter(Boolean).join(' ');
  return `https://maps.google.com/?daddr=${encodeURIComponent(addr)}`;
};

// Customer history: last 5 prior appointments for this customer
const CustomerHistorySection = ({ apt }) => {
  const [history, setHistory] = useState(null);
  useEffect(() => {
    if (!apt.caller_name) return;
    supabase
      .from('appointments')
      .select('date, start_time, service_type, status')
      .eq('client_id', apt.client_id)
      .eq('caller_name', apt.caller_name)
      .neq('id', apt.id)
      .order('date', { ascending: false })
      .limit(5)
      .then(({ data }) => setHistory(data || []));
  }, [apt.id]);
  if (!history || history.length === 0) return null;
  return (
    <div className="mb-5">
      <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Prior Visits</p>
      <div className="space-y-1">
        {history.map((h, i) => (
          <div key={i} className="flex justify-between text-xs text-gray-400 bg-gray-900 rounded px-3 py-2">
            <span>{h.date} {h.start_time?.slice(0, 5)}</span>
            <span className="text-gray-500">{h.service_type || '—'}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

// Fetches notes from customer_notes table (not apt.notes — that's job_notes' responsibility)
const CustomerNotesSection = ({ apt }) => {
  const [notes, setNotes] = useState(null);
  useEffect(() => {
    if (!apt.caller_name) return;
    supabase
      .from('customers')
      .select('id')
      .eq('client_id', apt.client_id)
      .ilike('name', apt.caller_name)
      .limit(1)
      .single()
      .then(({ data: customer }) => {
        if (!customer) { setNotes([]); return; }
        return supabase
          .from('customer_notes')
          .select('note, created_at')
          .eq('customer_id', customer.id)
          .order('created_at', { ascending: false })
          .limit(5);
      })
      .then(res => setNotes(res?.data || []));
  }, [apt.id]);
  if (!notes || notes.length === 0) return null;
  return (
    <div className="mb-5">
      <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Customer Notes</p>
      <div className="space-y-2">
        {notes.map((n, i) => (
          <p key={i} className="text-gray-300 text-sm bg-gray-900 rounded-lg px-3 py-2 border border-gray-600">
            {n.note}
          </p>
        ))}
      </div>
    </div>
  );
};

const CallTranscriptSection = ({ callId }) => {
  const [transcript, setTranscript] = useState(null);
  useEffect(() => {
    supabase.from('calls').select('transcript').eq('call_id', callId).single()
      .then(({ data }) => setTranscript(data?.transcript || null));
  }, [callId]);
  if (!transcript) return null;
  return (
    <div className="mb-5">
      <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Call Transcript</p>
      <p className="text-gray-300 text-sm bg-gray-900 rounded-lg p-3 border border-gray-600 max-h-40 overflow-y-auto whitespace-pre-wrap">
        {transcript}
      </p>
    </div>
  );
};

const CallRecordingSection = ({ callId }) => {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    supabase.from('calls').select('recording_url').eq('call_id', callId).single()
      .then(({ data }) => setUrl(data?.recording_url || null));
  }, [callId]);
  if (!url) return null;
  return (
    <div className="mb-5">
      <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Call Recording</p>
      <audio controls src={url} className="w-full" />
    </div>
  );
};

// ── Job Detail Bottom Sheet ──────────────────────────────────────────────────
const JobDetail = ({ apt, permissions, updatingId, onClose, onUpdateStatus, isPastDay }) => {
  const sc = STATUS_CONFIG[apt.status] || STATUS_CONFIG.confirmed;
  const canOnMyWay  = isAllowed(permissions, 'on_my_way');
  const canComplete = isAllowed(permissions, 'mark_complete');
  const canNotes    = isAllowed(permissions, 'job_notes');

  return (
    <div className="fixed inset-0 bg-black/80 z-40 flex flex-col justify-end">
      <div className="bg-gray-800 rounded-t-2xl p-5 max-h-[85vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Job Detail</h3>
          <button onClick={onClose} className="p-2 hover:bg-gray-700 rounded-lg">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* Status badge */}
        <span className={`inline-block text-xs font-medium px-2 py-1 rounded-full mb-4 ${sc.color}`}>
          {sc.label}
        </span>

        {/* Customer / job info */}
        <div className="space-y-3 mb-5">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Customer</p>
            <p className="text-white font-medium">{apt.caller_name || 'Customer'}</p>
          </div>
          {apt.service_type && (
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Service Type</p>
              <p className="text-white font-medium">{apt.service_type}</p>
            </div>
          )}
          {(apt.address || apt.city) && (
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Address</p>
              {apt.address && <p className="text-gray-300 text-sm">{apt.address}</p>}
              {(apt.city || apt.state || apt.zip) && (
                <p className="text-gray-400 text-xs mt-0.5">
                  {[apt.city, apt.state, apt.zip].filter(Boolean).join(', ')}
                </p>
              )}
            </div>
          )}
          {(apt.start_time || apt.end_time) && (
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Time</p>
              <p className="text-gray-300 text-sm">
                {apt.start_time?.slice(0, 5)}{apt.end_time ? ` – ${apt.end_time.slice(0, 5)}` : ''}
              </p>
            </div>
          )}
        </div>

        {/* Job notes — only if permitted and notes exist */}
        {canNotes && apt.notes && (
          <div className="mb-5">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Job Notes</p>
            <p className="text-gray-300 text-sm bg-gray-900 rounded-lg p-3 border border-gray-600">
              {apt.notes}
            </p>
          </div>
        )}

        {/* Permission-gated sub-sections */}
        {isAllowed(permissions, 'view_customer_history') && (
          <CustomerHistorySection apt={apt} />
        )}
        {isAllowed(permissions, 'view_customer_notes') && (
          <CustomerNotesSection apt={apt} />
        )}
        {isAllowed(permissions, 'view_call_transcript') && apt.call_id && (
          <CallTranscriptSection callId={apt.call_id} />
        )}
        {isAllowed(permissions, 'view_call_recording') && apt.call_id && (
          <CallRecordingSection callId={apt.call_id} />
        )}

        {/* Action buttons */}
        {isPastDay ? (
          <div className="text-center py-3">
            <span className="text-xs text-gray-500 bg-gray-700 px-3 py-1 rounded-full">View Only</span>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Navigate — always shown */}
            <a
              href={buildMapsUrl(apt)}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-2 w-full py-4 bg-blue-600 text-white rounded-xl font-medium text-base min-h-[56px]"
            >
              <Navigation className="w-5 h-5" />
              Navigate
            </a>

            {/* On My Way — shown if permitted AND status is confirmed */}
            {canOnMyWay && apt.status === 'confirmed' && (
              <button
                onClick={() => onUpdateStatus(apt, 'en_route')}
                disabled={updatingId === apt.id}
                className="flex items-center justify-center gap-2 w-full py-4 bg-amber-600 text-white rounded-xl font-medium text-base min-h-[56px] disabled:opacity-50"
              >
                {updatingId === apt.id
                  ? <RefreshCw className="w-5 h-5 animate-spin" />
                  : <MapPin className="w-5 h-5" />}
                On My Way
              </button>
            )}

            {/* Mark Complete — shown if permitted AND not already complete */}
            {canComplete && apt.status !== 'complete' && (
              <button
                onClick={() => onUpdateStatus(apt, 'complete')}
                disabled={updatingId === apt.id}
                className="flex items-center justify-center gap-2 w-full py-4 bg-green-600 text-white rounded-xl font-medium text-base min-h-[56px] disabled:opacity-50"
              >
                {updatingId === apt.id
                  ? <RefreshCw className="w-5 h-5 animate-spin" />
                  : <CheckCircle className="w-5 h-5" />}
                Mark Complete
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ── Main TechDashboard ───────────────────────────────────────────────────────
const TechDashboard = ({ techData }) => {
  const [jobs, setJobs]             = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);
  const [selectedJob, setSelectedJob] = useState(null);
  const [updatingId, setUpdatingId] = useState(null);
  const [toast, setToast]           = useState(null);
  const [destinations, setDestinations] = useState([]);
  const [showStatusModal, setShowStatusModal] = useState(false);

  const getTodayISO = () => new Date().toISOString().split('T')[0];
  const [todayISO, setTodayISO] = useState(getTodayISO);

  // Refresh todayISO at midnight so the "today" indicator stays accurate
  useEffect(() => {
    const msUntilMidnight = () => {
      const now = new Date();
      const midnight = new Date(now);
      midnight.setHours(24, 0, 0, 0);
      return midnight - now;
    };
    let timeoutId;
    const scheduleMidnightReset = () => {
      timeoutId = setTimeout(() => {
        setTodayISO(getTodayISO());
        scheduleMidnightReset(); // reschedule for the next midnight
      }, msUntilMidnight());
    };
    scheduleMidnightReset();
    return () => clearTimeout(timeoutId);
  }, []);

  const [selectedDate, setSelectedDate] = useState(getTodayISO);

  const formatDisplayDate = (iso) =>
    new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  const isPastDate = selectedDate < todayISO;
  const shiftDate = (days) => {
    const d = new Date(selectedDate + 'T00:00:00');
    d.setDate(d.getDate() + days);
    setSelectedDate(d.toISOString().split('T')[0]);
  };

  const fetchJobs = async () => {
    setError(null);
    try {
      const [jobsRes, permsRes] = await Promise.all([
        supabase
          .from('appointments')
          .select('*')
          .eq('client_id', techData.client_id)   // defense-in-depth; RLS also filters
          .eq('technician_id', techData.id)
          .eq('date', selectedDate)
          .in('status', ['confirmed', 'en_route', 'complete'])
          .order('start_time', { ascending: true }),
        supabase
          .from('technician_permissions')
          .select('feature, enabled')
          .eq('technician_id', techData.id),
      ]);
      if (jobsRes.error) throw jobsRes.error;
      setJobs(jobsRes.data || []);
      setPermissions(permsRes.data || []);
    } catch (err) {
      console.error('TechDashboard fetch error:', err);
      setError('Could not load your jobs. Tap Retry to try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchJobs(); }, [selectedDate]);

  useEffect(() => {
    supabase
      .from('client_destinations')
      .select('id, label, sort_order')
      .eq('client_id', techData.client_id)
      .eq('is_active', true)
      .order('sort_order')
      .then(({ data }) => setDestinations(data || []));
  }, []);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const updateStatus = async (apt, newStatus) => {
    setUpdatingId(apt.id);
    try {
      const { error } = await supabase
        .from('appointments')
        .update({ status: newStatus })
        .eq('id', apt.id);
      if (error) throw error;

      // Optimistic update — don't wait for a re-fetch
      setJobs(prev => prev.map(j => j.id === apt.id ? { ...j, status: newStatus } : j));
      if (selectedJob?.id === apt.id) setSelectedJob(prev => ({ ...prev, status: newStatus }));

      if (newStatus === 'en_route') {
        locationService.startTracking(techData.id, techData.client_id);
        // Token generation wired in Task 17
        showToast("Status updated — on your way!");
      }
      if (newStatus === 'complete') {
        locationService.stopTracking();
        // Revoke any active tracking token for this appointment
        // RLS policy (Task 3 migration) allows authenticated techs to set revoked=true on their own rows
        supabase.from('tracking_tokens')
          .update({ revoked: true })
          .eq('technician_id', techData.id)
          .eq('appointment_id', apt.id)
          .eq('revoked', false)
          .then(() => {});  // fire-and-forget
        showToast('Job marked complete!');
      }
    } catch (err) {
      console.error('Status update error:', err);
      showToast('Failed to update status. Please try again.');
    } finally {
      setUpdatingId(null);
    }
  };

  const setNonJobStatus = async (label) => {
    setShowStatusModal(false);
    // Use a recorded_at 2 minutes in the past so the upsert guard does not block
    // the first real GPS fix when the tech later taps "On My Way".
    const pastTimestamp = new Date(Date.now() - 120000).toISOString();
    await supabase.rpc('upsert_tech_location', {
      p_technician_id:  techData.id,
      p_client_id:      techData.client_id,
      p_lat:            0,
      p_lng:            0,
      p_accuracy:       null,
      p_heading:        null,
      p_speed_kmh:      null,
      p_non_job_status: label,
      p_recorded_at:    pastTimestamp,
    });
    showToast(`Status: ${label}`);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    // onAuthStateChange SIGNED_OUT in App.jsx clears all state and renders Login
  };

  // ── Loading skeleton ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 p-4">
        <div className="flex items-center justify-between mb-6">
          <img src={logo} alt="Reliant Support" style={{ height: '26px', width: 'auto' }} />
        </div>
        {[1, 2, 3].map(i => (
          <div key={i} className="bg-gray-800 rounded-lg p-4 mb-3 animate-pulse">
            <div className="h-4 bg-gray-700 rounded w-3/4 mb-2" />
            <div className="h-3 bg-gray-700 rounded w-1/2" />
          </div>
        ))}
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-4">
        <p className="text-gray-400 text-center mb-4">{error}</p>
        <button
          onClick={() => { setLoading(true); fetchJobs(); }}
          className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 pb-6">
      {/* Toast notification */}
      {toast && (
        <div className="fixed top-4 left-4 right-4 z-50 bg-gray-700 text-white px-4 py-3 rounded-lg shadow-lg text-sm text-center">
          {toast}
        </div>
      )}

      {/* Job detail bottom sheet */}
      {selectedJob && (
        <JobDetail
          apt={selectedJob}
          permissions={permissions}
          updatingId={updatingId}
          onClose={() => setSelectedJob(null)}
          onUpdateStatus={updateStatus}
          isPastDay={isPastDate}
        />
      )}

      {/* Sticky header */}
      <div className="sticky top-0 bg-gray-900 border-b border-gray-700 px-4 py-3 z-10">
        <div className="flex items-center justify-between">
          <div>
            <img src={logo} alt="Reliant Support" style={{ height: '26px', width: 'auto' }} />
            <div className="flex items-center gap-1 mt-1">
              <button
                onClick={() => shiftDate(-1)}
                className="p-2 hover:bg-gray-700 rounded-lg min-w-[48px] min-h-[48px] flex items-center justify-center"
                aria-label="Previous day"
              >
                <ChevronLeft className="w-5 h-5 text-gray-400" />
              </button>
              <button
                onClick={() => document.getElementById('tech-date-picker').showPicker?.()}
                className="flex-1 text-center text-sm text-gray-300 py-2"
                aria-label={`Open date picker, currently ${formatDisplayDate(selectedDate)}`}
              >
                {formatDisplayDate(selectedDate)}
                {selectedDate === todayISO && (
                  <span className="ml-1 inline-block w-1.5 h-1.5 bg-blue-500 rounded-full align-middle" />
                )}
                {isPastDate && <span className="ml-1 text-gray-500 text-xs">(past)</span>}
              </button>
              <input
                id="tech-date-picker"
                type="date"
                value={selectedDate}
                onChange={e => setSelectedDate(e.target.value)}
                className="sr-only"
              />
              <button
                onClick={() => shiftDate(1)}
                className="p-2 hover:bg-gray-700 rounded-lg min-w-[48px] min-h-[48px] flex items-center justify-center"
                aria-label="Next day"
              >
                <ChevronRight className="w-5 h-5 text-gray-400" />
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setLoading(true); fetchJobs(); }}
              className="p-2 hover:bg-gray-700 rounded-lg"
              title="Refresh"
            >
              <RefreshCw className="w-5 h-5 text-gray-400" />
            </button>
            <button onClick={handleLogout} className="p-2 hover:bg-gray-700 rounded-lg" title="Sign out">
              <LogOut className="w-5 h-5 text-gray-400" />
            </button>
          </div>
        </div>
      </div>

      {/* Jobs list */}
      <div className="p-4">
        <h2 className="text-lg font-semibold text-white mb-3">
          {techData.name} — {selectedDate === todayISO ? "Today's Jobs" : formatDisplayDate(selectedDate)}
        </h2>

        {jobs.length === 0 ? (
          <div className="bg-gray-800 rounded-lg p-8 text-center border border-gray-700">
            <CheckCircle className="w-10 h-10 text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400">No jobs scheduled for {selectedDate === todayISO ? 'today' : formatDisplayDate(selectedDate)}.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {jobs.map(apt => {
              const sc = STATUS_CONFIG[apt.status] || STATUS_CONFIG.confirmed;
              return (
                <button
                  key={apt.id}
                  onClick={() => setSelectedJob(apt)}
                  className="w-full bg-gray-800 rounded-lg p-4 border border-gray-700 text-left hover:border-gray-500 transition-colors active:bg-gray-750"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-medium truncate">{apt.caller_name || 'Customer'}</p>
                      {apt.service_type && (
                        <p className="text-blue-400 text-xs mt-0.5 truncate">{apt.service_type}</p>
                      )}
                      <p className="text-gray-400 text-sm mt-1">
                        {apt.start_time ? apt.start_time.slice(0, 5) : '—'}
                        {apt.end_time   ? ` – ${apt.end_time.slice(0, 5)}` : ''}
                      </p>
                      {(apt.address || apt.city) && (
                        <p className="text-gray-500 text-xs mt-1 truncate">
                          <MapPin className="w-3 h-3 inline mr-1" />
                          {[apt.address, apt.city].filter(Boolean).join(', ')}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`text-xs font-medium px-2 py-1 rounded-full ${sc.color}`}>
                        {sc.label}
                      </span>
                      <ChevronRight className="w-4 h-4 text-gray-500" />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {destinations.length > 0 && (
          <div className="mt-4">
            <button
              onClick={() => setShowStatusModal(true)}
              className="w-full py-3 bg-gray-700 text-gray-300 rounded-xl text-sm border border-gray-600"
            >
              Set Status
            </button>
          </div>
        )}
      </div>

      {showStatusModal && (
        <div className="fixed inset-0 bg-black/80 z-40 flex flex-col justify-end">
          <div className="bg-gray-800 rounded-t-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">Set Status</h3>
              <button onClick={() => setShowStatusModal(false)} className="p-2 hover:bg-gray-700 rounded-lg">
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>
            <div className="space-y-2">
              {destinations.map(d => (
                <button
                  key={d.id}
                  onClick={() => setNonJobStatus(d.label)}
                  className="w-full py-4 bg-gray-700 text-white rounded-xl font-medium text-left px-4"
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TechDashboard;
