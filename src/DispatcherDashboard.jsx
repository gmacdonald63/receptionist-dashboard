import React, { useState, useEffect, useRef } from 'react';
import { Phone, Calendar, FileText, Clock, DollarSign, Download, Play, Pause, Search, RefreshCw, ChevronRight, LogOut, Settings, Plus, X, Users, MapPin } from 'lucide-react';
import { retellService } from './retellService';
import { supabase } from './supabaseClient';
import Customers from './Customers';
import DemoDashboard from './DemoDashboard';
import TeamTab from './TeamTab';
import InstallPrompt from './InstallPrompt';
import UpdatePrompt from './UpdatePrompt';
import AppointmentCalendar from './AppointmentCalendar';
import DispatcherMap from './components/DispatcherMap.jsx';
import logo from './assets/RELIANT SUPPORT LOGO.svg';

const SUPABASE_FUNCTIONS_URL = 'https://zmppdmfdhknnwzwdfhwf.supabase.co/functions/v1';

const formatPhone = (raw) => {
  const digits = raw.replace(/\D/g, '').slice(0, 10);
  if (digits.length < 4) return digits;
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
};

const DispatcherDashboard = ({
  user,
  clientData,
  role,
  demoMode,
  demoClientData,
  isPublicDemo,
  demoToken,
  demoExpiresAt,
  // Additional props for callbacks into App
  onLogout,
  onShowAdmin,
  onExitDemo,
  onSetClientData,
}) => {
  // The effective client data — uses demo client when in demo mode
  const effectiveClientData = demoMode && demoClientData ? demoClientData : clientData;

  const getTodayStr = () => new Date().toISOString().split('T')[0];
  const [todayStr, setTodayStr] = useState(getTodayStr);

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
        setTodayStr(getTodayStr());
        scheduleMidnightReset();
      }, msUntilMidnight());
    };
    scheduleMidnightReset();
    return () => clearTimeout(timeoutId);
  }, []);

  const [activeTab, setActiveTab] = useState('appointments');
  const [selectedCall, setSelectedCall] = useState(null);
  const [playingRecording, setPlayingRecording] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentWeekStart, setCurrentWeekStart] = useState(() => {
    const today = new Date();
    const first = today.getDate() - today.getDay();
    return new Date(today.getFullYear(), today.getMonth(), first);
  });
  const audioRef = useRef(null);

  // Real data from Retell API
  const [callLogs, setCallLogs] = useState([]);
  // Single appointments array from Supabase
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalCalls: 0,
    appointments: 0,
    totalMinutes: 0,
    monthlyBill: 0
  });

  // Business hours and technicians
  const [businessHours, setBusinessHours] = useState([]);
  const [technicians, setTechnicians] = useState([]);
  const [serviceTypes, setServiceTypes] = useState([]);
  const [reminderCount, setReminderCount] = useState(0);

  // Business hours settings form state
  const [settingsHoursForm, setSettingsHoursForm] = useState([]);
  const [savingHours, setSavingHours] = useState(false);

  // Billing / Stripe state
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingAction, setBillingAction] = useState(null); // 'checkout' | 'portal'
  const [awaitingSubscription, setAwaitingSubscription] = useState(false);
  const [showBillingPortal, setShowBillingPortal] = useState(false);

  // After Stripe checkout redirect, poll for subscription activation (webhook may be slightly delayed)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('billing') === 'success' && user) {
      window.history.replaceState({}, '', window.location.pathname);
      setAwaitingSubscription(true);
      setActiveTab('billing');

      const pollSubscription = async (attempt = 0) => {
        const { data } = await supabase
          .from('clients')
          .select('*')
          .eq('email', user.email)
          .single();

        if (data) {
          if (onSetClientData) onSetClientData(data);
          if (['active', 'trialing'].includes(data.subscription_status)) {
            setAwaitingSubscription(false);
          } else if (attempt < 5) {
            setTimeout(() => pollSubscription(attempt + 1), 2000);
          } else {
            setAwaitingSubscription(false);
          }
        }
      };

      pollSubscription();
    }
  }, [user]);

  // Fetch data from Retell API and Supabase (for authenticated dashboard users OR demo mode)
  useEffect(() => {
    if (demoMode && demoClientData) {
      fetchData();
    } else if (user && clientData) {
      const hasAccess = clientData.is_admin || ['active', 'trialing'].includes(clientData.subscription_status);
      if (hasAccess) {
        fetchData();
      }
    }
  }, [user, clientData, demoMode, demoClientData]);

  // Sync business hours settings form whenever businessHours data loads
  useEffect(() => {
    const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const form = DAY_NAMES.map((name, dow) => {
      const bh = businessHours.find(h => h.day_of_week === dow);
      return {
        day_of_week: dow,
        name,
        is_open: bh ? bh.is_open : (dow >= 1 && dow <= 5),
        open_time: bh ? (bh.open_time || '').slice(0, 5) : '08:00',
        close_time: bh ? (bh.close_time || '').slice(0, 5) : '18:00',
      };
    });
    setSettingsHoursForm(form);
  }, [businessHours]);

  const handleDemoDataRefresh = () => {
    fetchData();
  };

  // Fetch all appointments from the unified Supabase table
  const fetchAppointments = async () => {
    const cid = effectiveClientData?.id;
    if (!cid) return;
    try {
      const { data, error } = await supabase
        .from('appointments')
        .select('*')
        .eq('client_id', cid)
        .neq('status', 'cancelled')
        .order('date', { ascending: true });

      if (error) {
        console.error('Error fetching appointments:', error);
        return;
      }

      if (data) {
        setAppointments(data.map(apt => ({
          id: apt.id,
          name: apt.first_name && apt.last_name
            ? `${apt.first_name} ${apt.last_name}`
            : apt.caller_name,
          first_name: apt.first_name || '',
          last_name: apt.last_name || '',
          caller_name: apt.caller_name || '',
          date: apt.date,
          start_time: apt.start_time,
          end_time: apt.end_time || null,
          time: apt.end_time
            ? `${apt.start_time} to ${apt.end_time}`
            : apt.start_time,
          address: apt.address || '',
          city: apt.city || '',
          state: apt.state || '',
          zip: apt.zip || '',
          phone: apt.caller_number || '',
          notes: apt.notes || '',
          summary: apt.notes || '', // kept for backward compat (call log uses this)
          status: apt.status,
          duration: apt.duration || null,
          source: apt.source, // 'ai' or 'manual'
          technician_id: apt.technician_id || null,
          service_type: apt.service_type || null,
        })));
      }
    } catch (err) {
      console.error('Could not load appointments:', err);
    }
  };

  const fetchBusinessHours = async () => {
    const cid = effectiveClientData?.id;
    if (!cid) return;
    try {
      const { data, error } = await supabase
        .from('business_hours')
        .select('day_of_week, is_open, open_time, close_time')
        .eq('client_id', cid)
        .order('day_of_week', { ascending: true });
      if (!error && data) setBusinessHours(data);
    } catch (err) {
      console.error('Could not load business hours:', err);
    }
  };

  const handleSaveBusinessHours = async () => {
    const cid = effectiveClientData?.id;
    if (!cid) return;
    setSavingHours(true);
    try {
      const rows = settingsHoursForm.map(h => ({
        client_id: cid,
        day_of_week: h.day_of_week,
        is_open: h.is_open,
        open_time: h.open_time,
        close_time: h.close_time,
      }));
      const { error } = await supabase
        .from('business_hours')
        .upsert(rows, { onConflict: 'client_id,day_of_week' });
      if (error) throw error;
      await fetchBusinessHours();
    } catch (err) {
      console.error('Failed to save business hours:', err);
      alert('Failed to save hours. Please try again.');
    } finally {
      setSavingHours(false);
    }
  };

  const fetchTechnicians = async () => {
    const cid = effectiveClientData?.id;
    if (!cid) return;
    try {
      const { data, error } = await supabase
        .from('technicians')
        .select('*')
        .eq('client_id', cid)
        .order('name', { ascending: true });
      if (!error && data) setTechnicians(data);
    } catch (err) {
      console.error('Could not load technicians:', err);
    }
  };

  const fetchServiceTypes = async () => {
    const cid = effectiveClientData?.id;
    if (!cid) return;
    try {
      const { data, error } = await supabase
        .from('service_types')
        .select('id, name, category, duration_minutes')
        .eq('client_id', cid)
        .eq('is_active', true)
        .order('sort_order', { ascending: true });
      if (!error && data) setServiceTypes(data);
    } catch (err) {
      console.error('Could not load service types:', err);
    }
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      // Get the agent_id from effective client data (demo or real)
      const agentId = effectiveClientData?.retell_agent_id || null;

      let transformedCalls = [];
      let rawCallsForStats = [];

      if (demoMode) {
        // Demo mode: fetch calls from Supabase (controllable, resetable)
        const { data: supabaseCalls, error: callsError } = await supabase
          .from('calls')
          .select('*')
          .eq('agent_id', agentId)
          .order('created_at', { ascending: false });

        if (callsError) console.error('Error fetching demo calls:', callsError);

        // Deduplicate by call_id (keep the one with the most data)
        const callMap = new Map();
        (supabaseCalls || []).forEach(call => {
          const existing = callMap.get(call.call_id);
          if (!existing || (call.caller_name && !existing.caller_name)) {
            callMap.set(call.call_id, call);
          }
        });

        transformedCalls = Array.from(callMap.values()).map(call => ({
          id: call.call_id,
          caller: call.caller_name || 'Unknown',
          number: call.caller_number || 'N/A',
          duration: call.duration_seconds ? `${Math.floor(call.duration_seconds / 60)}:${String(Math.floor(call.duration_seconds % 60)).padStart(2, '0')}` : '0:00',
          time: call.created_at ? new Date(call.created_at).toLocaleString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true }) : 'N/A',
          outcome: call.appointment_booked ? 'Appointment Booked' : 'Call Completed',
          hasRecording: !!call.recording_url,
          hasTranscript: !!call.transcript,
          recording_url: call.recording_url,
          transcript: call.transcript,
          call_summary: call.summary || '',
          appointment: {}
        }));

        rawCallsForStats = supabaseCalls || [];
      } else {
        // Normal mode: fetch calls from Retell API
        const calls = await retellService.getCalls(100, agentId);
        transformedCalls = calls.map(call => retellService.transformCallData(call));
        rawCallsForStats = calls;
      }

      setCallLogs(transformedCalls);

      // Fetch all appointments, business hours, and technicians from Supabase
      await Promise.all([fetchAppointments(), fetchBusinessHours(), fetchTechnicians(), fetchServiceTypes()]);

      // Calculate stats — filter to current billing period
      let periodStart = null;
      if (effectiveClientData?.current_period_end) {
        const periodEnd = new Date(effectiveClientData.current_period_end);
        periodStart = new Date(periodEnd);
        periodStart.setMonth(periodStart.getMonth() - 1);
      }

      const totalMinutes = demoMode
        ? rawCallsForStats.reduce((sum, call) => sum + (call.duration_seconds || 0), 0) / 60
        : rawCallsForStats.reduce((sum, call) => sum + (call.call_duration || 0), 0) / 60;

      setStats({
        totalCalls: rawCallsForStats.length,
        appointments: appointments.length,
        totalMinutes: Math.round(totalMinutes),
      });
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Calculate end time from start time + duration in minutes
  const calculateEndTime = (startTime, durationMinutes) => {
    const [hours, minutes] = startTime.split(':').map(Number);
    const totalMinutes = hours * 60 + minutes + durationMinutes;
    const endHours = Math.floor(totalMinutes / 60);
    const endMinutes = totalMinutes % 60;
    return `${String(endHours).padStart(2, '0')}:${String(endMinutes).padStart(2, '0')}`;
  };

  // Find the least-busy free technician for a given date/time/duration
  const findLeastBusyTech = async (date, startTime, duration) => {
    const activeTechs = technicians.filter(t => t.is_active);
    if (activeTechs.length === 0) return null;

    // Fetch all non-cancelled appointments for that day
    const { data: dayAppts } = await supabase
      .from('appointments')
      .select('start_time, end_time, technician_id')
      .eq('client_id', effectiveClientData.id)
      .eq('date', date)
      .neq('status', 'cancelled');

    const appts = dayAppts || [];
    const BUFFER = 30; // 30-min travel buffer, same as edge functions
    const toMins = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
    const slotStart = toMins(startTime);
    const slotEnd = slotStart + (duration || 60);

    // Check which techs are free at this slot
    const freeTechs = activeTechs.filter(tech => {
      const techAppts = appts.filter(a => a.technician_id === tech.id);
      return techAppts.every(a => {
        const aStart = toMins(a.start_time);
        const aEnd = a.end_time && a.end_time !== a.start_time ? toMins(a.end_time) : aStart + 60;
        return !(slotStart < aEnd + BUFFER && slotEnd + BUFFER > aStart);
      });
    });

    if (freeTechs.length === 0) return null;

    // Pick the one with fewest appointments today, ties broken by name
    freeTechs.sort((a, b) => {
      const countA = appts.filter(ap => ap.technician_id === a.id).length;
      const countB = appts.filter(ap => ap.technician_id === b.id).length;
      return countA - countB || (a.name || '').localeCompare(b.name || '');
    });

    return freeTechs[0].id;
  };

  const handleAddAppointment = async (formData) => {
    const fullName = `${formData.firstName.trim()} ${formData.lastName.trim()}`.trim();
    const endTime = calculateEndTime(formData.time, formData.duration || 60);

    // Resolve technician: auto-assign picks least busy, explicit pick uses selected ID
    let resolvedTechId = null;
    if (formData.technicianId === 'auto') {
      resolvedTechId = await findLeastBusyTech(formData.date, formData.time, formData.duration || 60);
    } else if (formData.technicianId) {
      resolvedTechId = parseInt(formData.technicianId, 10);
    }

    let savedAptId = null;

    if (formData.appointmentId) {
      // UPDATE existing appointment
      const { error } = await supabase
        .from('appointments')
        .update({
          caller_name: fullName,
          first_name: formData.firstName.trim(),
          last_name: formData.lastName.trim(),
          caller_number: formData.phone,
          date: formData.date,
          start_time: formData.time,
          end_time: endTime,
          address: formData.address,
          city: formData.city,
          state: formData.state,
          zip: formData.zip,
          notes: formData.notes || null,
          service_type: formData.serviceType || null,
          technician_id: resolvedTechId,
          duration: formData.duration || 60,
        })
        .eq('id', formData.appointmentId);

      if (error) throw error;
      savedAptId = formData.appointmentId;
    } else {
      // INSERT new appointment
      const { data: insertedRows, error } = await supabase
        .from('appointments')
        .insert({
          client_id: effectiveClientData.id,
          caller_name: fullName,
          first_name: formData.firstName.trim(),
          last_name: formData.lastName.trim(),
          caller_number: formData.phone,
          date: formData.date,
          start_time: formData.time,
          end_time: endTime,
          address: formData.address,
          city: formData.city,
          state: formData.state,
          zip: formData.zip,
          notes: formData.notes || null,
          service_type: formData.serviceType || null,
          source: 'manual',
          status: 'confirmed',
          technician_id: resolvedTechId,
          duration: formData.duration || 60,
        })
        .select('id');

      if (error) throw error;
      savedAptId = insertedRows?.[0]?.id ?? null;
    }

    // Fire-and-forget geocoding — don't await, don't block the UX
    if (savedAptId) {
      supabase.auth.getSession().then(({ data: { session } }) => {
        fetch(`${SUPABASE_FUNCTIONS_URL}/geocode-appointments`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token}`,
            'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InptcHBkbWZkaGtubnd6d2RmaHdmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4MzQyMDYsImV4cCI6MjA4NTQxMDIwNn0.mXfuz8mEZhizFen78gUaakBDbrzANn4ZM1a7KuDiKJs',
          },
          body: JSON.stringify({ appointment_id: savedAptId }),
        }).catch(() => {});
      }).catch(() => {});
    }

    // Navigate to the week of the appointment
    const [year, month, day] = formData.date.split('-');
    const aptDate = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    const first = aptDate.getDate() - aptDate.getDay();
    setCurrentWeekStart(new Date(aptDate.getFullYear(), aptDate.getMonth(), first));

    // Re-fetch to show updated appointments
    await fetchAppointments();
  };

  const formatCallTime = (timeString) => {
    if (!timeString) return '';
    const [datePart, timePart] = timeString.split(', ');
    if (!datePart || !timePart) return timeString;
    const [month, day, year] = datePart.split('/');
    const formattedDate = `${parseInt(month)}/${parseInt(day)}/${year}`;
    const formattedTime = timePart.replace(/^0/, '');
    return `${formattedDate} at ${formattedTime}`;
  };

  const formatAppointmentDate = (dateString) => {
    if (!dateString) return '';
    const [year, month, day] = dateString.split('-');
    if (!year || !month || !day) return dateString;
    return `${parseInt(month)}/${parseInt(day)}/${year}`;
  };

  const formatAppointmentTime = (timeString) => {
    if (!timeString) return '';

    if (timeString.toUpperCase().includes('AM') || timeString.toUpperCase().includes('PM')) {
      return timeString;
    }

    const convert24to12 = (time24) => {
      const [hours, minutes] = time24.split(':');
      const hour = parseInt(hours);
      if (isNaN(hour)) return time24;
      const ampm = hour >= 12 ? 'PM' : 'AM';
      const hour12 = hour % 12 || 12;
      return `${hour12}:${minutes} ${ampm}`;
    };

    if (timeString.includes(' to ')) {
      const [startTime, endTime] = timeString.split(' to ');
      return `${convert24to12(startTime)} to ${convert24to12(endTime)}`;
    }

    return convert24to12(timeString);
  };

  const StatCard = ({ icon: Icon, label, value, color }) => (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <p className="text-gray-400 text-xs mb-1">{label}</p>
          <p className="text-xl md:text-2xl font-bold text-white">{value}</p>
        </div>
        <div className={`p-2 md:p-3 rounded-lg ${color}`}>
          <Icon className="w-5 h-5 md:w-6 md:h-6 text-white" />
        </div>
      </div>
    </div>
  );

  const renderOverview = () => (
    <div className="space-y-4 md:space-y-6">
      {loading ? (
        <div className="text-center py-12">
          <RefreshCw className="w-8 h-8 animate-spin text-blue-500 mx-auto mb-4" />
          <p className="text-gray-400">Loading data...</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:gap-6">
            <StatCard icon={Phone} label="Total Calls" value={stats.totalCalls} color="bg-blue-600" />
            <StatCard icon={Calendar} label="Appointments" value={stats.appointments} color="bg-green-600" />
          </div>

          {/* Plan minutes usage */}
          {(() => {
            const planKey = clientData?.stripe_price_id ? getPlanFromPriceId(clientData.stripe_price_id) : null;
            const plan = planKey ? PLANS[planKey] : null;
            const includedMinutes = plan?.minutes || 0;
            const used = stats.totalMinutes || 0;
            const remaining = Math.max(0, includedMinutes - used);
            const pct = includedMinutes > 0 ? Math.min(100, (used / includedMinutes) * 100) : 0;
            const isOver = used > includedMinutes;
            const periodEnd = clientData?.current_period_end ? new Date(clientData.current_period_end) : null;

            return includedMinutes > 0 ? (
              <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="p-2 rounded-lg bg-purple-600">
                      <Clock className="w-5 h-5 text-white" />
                    </div>
                    <span className="text-sm font-medium text-gray-400">Plan Minutes</span>
                  </div>
                  {periodEnd && (
                    <span className="text-xs text-gray-500">
                      Renews {periodEnd.toLocaleDateString()}
                    </span>
                  )}
                </div>
                <div className="flex items-baseline gap-1 mb-2">
                  <span className="text-2xl font-bold text-white">{used}</span>
                  <span className="text-gray-500 text-sm">/ {includedMinutes.toLocaleString()} min used</span>
                </div>
                <div className="w-full bg-gray-700 rounded-full h-2.5">
                  <div
                    className={`h-2.5 rounded-full transition-all ${isOver ? 'bg-red-500' : pct > 80 ? 'bg-yellow-500' : 'bg-purple-500'}`}
                    style={{ width: `${Math.min(100, pct)}%` }}
                  />
                </div>
                <div className="flex justify-between mt-1.5">
                  <span className={`text-xs ${isOver ? 'text-red-400' : 'text-gray-500'}`}>
                    {isOver ? `${used - includedMinutes} min over limit` : `${remaining.toLocaleString()} min remaining`}
                  </span>
                  <span className="text-xs text-gray-500">{Math.round(pct)}%</span>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 md:gap-6">
                <StatCard icon={Clock} label="Total Minutes" value={stats.totalMinutes} color="bg-purple-600" />
              </div>
            );
          })()}

          <div className="bg-gray-800 rounded-lg p-4 md:p-6 border border-gray-700">
            <h3 className="text-lg md:text-xl font-semibold mb-4 text-white">Recent Appointments</h3>
            {appointments.length === 0 ? (
              <p className="text-gray-400 text-center py-8">No appointments booked yet</p>
            ) : (
              <div className="space-y-3">
                {appointments.slice(0, 5).map(apt => (
                  <div key={apt.id} className="p-3 bg-gray-750 rounded-lg">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <p className="font-medium text-white">{apt.name}</p>
                        {apt.summary && <p className="text-sm text-gray-400 truncate">{apt.summary}</p>}
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <p className="text-gray-400">{apt.date}</p>
                      <p className="text-white">{apt.time}</p>
                    </div>
                    {apt.address && (
                      <p className="text-xs text-gray-500 mt-1">{apt.address}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-gray-800 rounded-lg p-4 md:p-6 border border-gray-700">
            <h3 className="text-lg md:text-xl font-semibold mb-4 text-white">Recent Calls</h3>
            {callLogs.length === 0 ? (
              <p className="text-gray-400 text-center py-8">No calls yet</p>
            ) : (
              <div className="space-y-3">
                {callLogs.slice(0, 5).map(call => (
                  <div key={call.id} className="p-3 bg-gray-750 rounded-lg">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <p className="font-medium text-white">{call.caller}</p>
                        <p className="text-sm text-gray-400">{call.number}</p>
                      </div>
                      <p className="text-sm text-white">{call.duration}</p>
                    </div>
                    <p className="text-sm text-gray-400">{call.outcome}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );

  const filteredCalls = callLogs.filter(call =>
    call.caller.toLowerCase().includes(searchTerm.toLowerCase()) ||
    call.number.includes(searchTerm)
  );

  const renderCallLogs = (headerLeft, headerRight) => (
    <div className="space-y-4">
      {/* Header row: logo, search, actions, app controls — all one line */}
      <div className="flex items-center gap-6">
        <div className="flex-shrink-0">{headerLeft}</div>
        <div className="relative w-96 flex-shrink-0">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search calls…"
            className="w-full pl-9 pr-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 text-sm"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={fetchData}
            className="flex items-center gap-2 px-3 py-2 bg-gray-800 border border-gray-700 text-white rounded-lg hover:bg-gray-750 text-sm"
          >
            <RefreshCw className="w-4 h-4" />
            <span className="hidden sm:inline">Refresh</span>
          </button>
          <button className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm">
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Export</span>
          </button>
          {headerRight}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12">
          <RefreshCw className="w-8 h-8 animate-spin text-blue-500 mx-auto mb-4" />
          <p className="text-gray-400">Loading calls...</p>
        </div>
      ) : filteredCalls.length === 0 ? (
        <div className="bg-gray-800 rounded-lg p-8 border border-gray-700 text-center">
          <Phone className="w-12 h-12 text-gray-600 mx-auto mb-4" />
          <p className="text-gray-400">
            {searchTerm ? 'No calls match your search' : 'No calls yet'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredCalls.map(call => (
            <div
              key={call.id}
              className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden"
              onClick={() => setSelectedCall(selectedCall === call.id ? null : call.id)}
            >
              <div className="p-4 cursor-pointer">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-start gap-3 flex-1">
                    <Phone className="w-5 h-5 text-blue-400 mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-white truncate">{call.caller}</p>
                      <p className="text-sm text-gray-400">{call.number}</p>
                    </div>
                  </div>
                  <ChevronRight className={`w-5 h-5 text-gray-400 transition-transform flex-shrink-0 ${selectedCall === call.id ? 'rotate-90' : ''}`} />
                </div>
                <p className="text-xs text-gray-500 mt-1">{formatCallTime(call.time)}</p>
                {call.call_summary && (
                  <p className="text-sm text-gray-300 mt-2">{call.call_summary}</p>
                )}
                {call.appointment && call.appointment.date && call.appointment.time && (
                  <div className="bg-gray-900 border border-gray-700 rounded-lg p-3 mt-3" onClick={(e) => e.stopPropagation()}>
                    <p className="text-xs text-gray-400 mb-1">Appointment Booked</p>
                    <p className="text-white font-medium">{formatAppointmentDate(call.appointment.date)} at {formatAppointmentTime(call.appointment.time)}</p>
                    {call.appointment.address && (
                      <p className="text-sm text-gray-300 mt-1">{call.appointment.address}</p>
                    )}
                  </div>
                )}
              </div>

              {selectedCall === call.id && (
                <div className="px-4 pb-4 border-t border-gray-700 bg-gray-750 space-y-3 pt-4">
                  {call.hasRecording && call.recording_url && (
                    <div className="bg-gray-800 p-3 rounded-lg">
                      <p className="text-xs text-gray-400 mb-2">Recording</p>
                      {playingRecording === call.id ? (
                        <div className="space-y-2">
                          <audio
                            ref={audioRef}
                            src={call.recording_url}
                            autoPlay
                            controls
                            className="w-full"
                            onEnded={() => setPlayingRecording(null)}
                          />
                          <button
                            onClick={() => {
                              if (audioRef.current) {
                                audioRef.current.pause();
                              }
                              setPlayingRecording(null);
                            }}
                            className="w-full px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 text-sm"
                          >
                            Close Player
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setPlayingRecording(call.id);
                          }}
                          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 w-full justify-center"
                        >
                          <Play className="w-4 h-4" />
                          Play Recording
                        </button>
                      )}
                    </div>
                  )}

                  {call.hasTranscript && call.transcript && (
                    <div className="bg-gray-800 p-3 rounded-lg">
                      <p className="text-xs text-gray-400 mb-2">Transcript</p>
                      <div className="p-3 rounded-lg bg-gray-750 max-h-[200px] overflow-y-auto">
                        <p className="text-white text-sm leading-relaxed whitespace-pre-wrap">{call.transcript}</p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderTranscripts = () => {
    const currentCall = callLogs.find(call => call.id === selectedCall) || callLogs[0];

    if (!currentCall || !currentCall.transcript) {
      return (
        <div className="bg-gray-800 rounded-lg p-8 border border-gray-700 text-center">
          <FileText className="w-12 h-12 text-gray-600 mx-auto mb-4" />
          <p className="text-gray-400">No transcript available</p>
          <button
            onClick={() => setActiveTab('calls')}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Go to Calls
          </button>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-white">Call Transcript</h3>
            <button className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              <Download className="w-4 h-4" />
            </button>
          </div>

          <div className="mb-4 p-3 bg-gray-750 rounded-lg space-y-2">
            <div>
              <p className="text-xs text-gray-400">Caller</p>
              <p className="text-white font-medium">{currentCall.caller}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Phone</p>
              <p className="text-white">{currentCall.number}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Date & Time</p>
              <p className="text-white">{currentCall.time}</p>
            </div>
          </div>

          <div className="space-y-3 max-h-[60vh] overflow-y-auto">
            <div className="p-3 rounded-lg bg-gray-750">
              <p className="text-white text-sm leading-relaxed whitespace-pre-wrap">{currentCall.transcript}</p>
            </div>
          </div>

          {currentCall.call_summary && (
            <div className="mt-4 p-4 bg-blue-900/20 border border-blue-800 rounded-lg">
              <p className="text-xs text-blue-400 font-semibold mb-2">CALL SUMMARY</p>
              <p className="text-white text-sm leading-relaxed">{currentCall.call_summary}</p>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderSettings = () => (
    <div className="space-y-4">
      <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <h3 className="text-lg font-semibold mb-4 text-white">Greeting Message</h3>
        <textarea
          className="w-full h-32 p-3 bg-gray-750 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 text-sm"
          placeholder="Enter your custom greeting message..."
          defaultValue="Thank you for calling ABC Medical Services. How may I help you today?"
        />
        <button className="mt-3 w-full px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          Save Changes
        </button>
      </div>

      <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <h3 className="text-lg font-semibold mb-4 text-white">Business Hours</h3>
        <div className="space-y-3">
          {settingsHoursForm.map((dayRow, idx) => (
            <div key={dayRow.day_of_week} className="space-y-2">
              <div className="flex items-center justify-between">
                <p className={`font-medium ${dayRow.is_open ? 'text-white' : 'text-gray-500'}`}>{dayRow.name}</p>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="w-4 h-4 accent-blue-500"
                    checked={dayRow.is_open}
                    onChange={e => setSettingsHoursForm(f => f.map((d, i) => i === idx ? { ...d, is_open: e.target.checked } : d))}
                  />
                  <span className="text-sm text-gray-400">Open</span>
                </label>
              </div>
              {dayRow.is_open && (
                <div className="flex gap-2 items-center">
                  <input
                    type="time"
                    className="flex-1 px-3 py-2 bg-gray-750 border border-gray-600 rounded-lg text-white text-sm"
                    value={dayRow.open_time}
                    onChange={e => setSettingsHoursForm(f => f.map((d, i) => i === idx ? { ...d, open_time: e.target.value } : d))}
                  />
                  <span className="text-gray-400 text-sm">to</span>
                  <input
                    type="time"
                    className="flex-1 px-3 py-2 bg-gray-750 border border-gray-600 rounded-lg text-white text-sm"
                    value={dayRow.close_time}
                    onChange={e => setSettingsHoursForm(f => f.map((d, i) => i === idx ? { ...d, close_time: e.target.value } : d))}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
        <button
          onClick={handleSaveBusinessHours}
          disabled={savingHours}
          className="mt-4 w-full px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {savingHours ? 'Saving...' : 'Save Hours'}
        </button>
      </div>

      <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <h3 className="text-lg font-semibold mb-4 text-white">Integrations</h3>
        <div className="space-y-3">
          <div className="p-3 bg-gray-750 rounded-lg">
            <div className="flex items-start justify-between mb-2">
              <div className="flex-1">
                <p className="font-medium text-white">Retell AI</p>
                <p className="text-xs text-gray-400 mt-1">Voice AI platform</p>
              </div>
              <span className="px-2 py-1 bg-green-900 text-green-300 rounded text-xs whitespace-nowrap">Connected</span>
            </div>
            <button className="w-full mt-2 px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 text-sm">
              Configure
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  // Plan definitions — priceId is the live monthly price (used for new subscriptions via billing tab)
  const PLANS = {
    standard: { name: 'Standard Plan', price: 495, priceId: 'price_1TFLt6J9Bes3rv7O0fWvfB3c', minutes: 1000 },
    pro: { name: 'Pro Plan', price: 695, priceId: 'price_1TFLwtJ9Bes3rv7ObtuStIhj', minutes: 2000 },
  };

  // Recognizes live monthly, live annual, and test mode price IDs
  const PRICE_ID_TO_PLAN = {
    'price_1TFLt6J9Bes3rv7O0fWvfB3c': 'standard', // live monthly
    'price_1TFLvoJ9Bes3rv7OjDasoy0A': 'standard', // live annual
    'price_1TFNy4J9Bes3rv7OFFJPMWGh': 'standard', // test monthly
    'price_1TFLwtJ9Bes3rv7ObtuStIhj': 'pro',       // live monthly
    'price_1TFLyBJ9Bes3rv7OsQeTPkyI': 'pro',       // live annual
  };

  const getPlanFromPriceId = (priceId) => {
    if (!priceId) return null;
    return PRICE_ID_TO_PLAN[priceId] || null;
  };

  const handleStripeCheckout = async (plan = 'standard') => {
    setBillingAction(plan);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/create-checkout-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InptcHBkbWZkaGtubnd6d2RmaHdmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4MzQyMDYsImV4cCI6MjA4NTQxMDIwNn0.mXfuz8mEZhizFen78gUaakBDbrzANn4ZM1a7KuDiKJs',
        },
        body: JSON.stringify({ return_url: window.location.origin, plan }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert(data.error || 'Failed to create checkout session');
      }
    } catch (err) {
      console.error('Checkout error:', err);
      alert('Failed to start checkout. Please try again.');
    } finally {
      setBillingAction(null);
    }
  };

  const handleBillingPortal = async () => {
    setBillingAction('portal');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/create-billing-portal`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InptcHBkbWZkaGtubnd6d2RmaHdmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4MzQyMDYsImV4cCI6MjA4NTQxMDIwNn0.mXfuz8mEZhizFen78gUaakBDbrzANn4ZM1a7KuDiKJs',
        },
        body: JSON.stringify({ return_url: window.location.origin }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert(data.error || 'Failed to open billing portal');
      }
    } catch (err) {
      console.error('Billing portal error:', err);
      alert('Failed to open billing portal. Please try again.');
    } finally {
      setBillingAction(null);
    }
  };

  const renderBilling = () => {
    // Demo mode: show a realistic billing page as if on Standard Plan
    if (demoMode) {
      const nextBilling = new Date();
      nextBilling.setDate(nextBilling.getDate() + 22);
      const nextBillingStr = nextBilling.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

      // Fake 3 months of payment history
      const invoices = [];
      for (let i = 0; i < 3; i++) {
        const d = new Date();
        d.setMonth(d.getMonth() - i);
        d.setDate(8);
        invoices.push({
          date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
          amount: '$495.00',
          status: 'Paid',
        });
      }

      const usedMins = stats.totalMinutes || 0;
      const includedMins = 1000;
      const remaining = Math.max(0, includedMins - usedMins);
      const pct = Math.min(100, (usedMins / includedMins) * 100);

      return (
        <div className="space-y-4">
          <div className="bg-gray-800 rounded-lg p-4 border border-blue-500">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-lg font-semibold text-white">Standard Plan</h4>
              <span className="px-2 py-1 bg-green-900 text-green-300 rounded text-xs">Active</span>
            </div>
            <p className="text-3xl font-bold text-white mb-1">
              $495.00<span className="text-base font-normal text-gray-400">/mo</span>
            </p>
            <p className="text-gray-400 text-sm mb-4">AI Receptionist Service</p>
            <div className="p-3 bg-gray-750 rounded-lg mb-4">
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Next billing date</span>
                <span className="text-white">{nextBillingStr}</span>
              </div>
            </div>
            <button
              onClick={() => setShowBillingPortal(true)}
              className="w-full py-3 bg-gray-700 text-white rounded-lg hover:bg-gray-600 font-medium text-sm"
            >
              Manage Subscription
            </button>
          </div>

          {/* Usage */}
          <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
            <h3 className="text-lg font-semibold mb-4 text-white">Usage This Month</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="p-4 bg-gray-750 rounded-lg text-center">
                <p className="text-2xl font-bold text-white">{stats.totalCalls}</p>
                <p className="text-gray-400 text-sm">Calls</p>
              </div>
              <div className="p-4 bg-gray-750 rounded-lg text-center">
                <p className="text-2xl font-bold text-white">{usedMins}</p>
                <p className="text-gray-400 text-sm">Minutes</p>
              </div>
            </div>
            <div className="w-full bg-gray-700 rounded-full h-2 mt-3">
              <div className="h-2 rounded-full bg-purple-500 transition-all" style={{ width: `${pct}%` }} />
            </div>
            <p className="text-xs mt-2 text-center text-gray-500">
              {remaining.toLocaleString()} of {includedMins.toLocaleString()} min remaining
            </p>
          </div>

          {/* Payment History */}
          <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
            <h3 className="text-lg font-semibold mb-4 text-white">Payment History</h3>
            <div className="space-y-2">
              {invoices.map((inv, i) => (
                <div key={i} className="flex items-center justify-between p-3 bg-gray-750 rounded-lg">
                  <div>
                    <p className="text-white text-sm">{inv.date}</p>
                    <p className="text-gray-400 text-xs">Standard Plan — Monthly</p>
                  </div>
                  <div className="text-right">
                    <p className="text-white text-sm font-medium">{inv.amount}</p>
                    <span className="text-xs text-green-400">{inv.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Billing Portal */}
          <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
            <h3 className="text-lg font-semibold mb-4 text-white">Payment & Invoices</h3>
            <p className="text-gray-400 text-sm mb-3">
              Update your payment method, view invoices, or cancel your subscription through the Stripe billing portal.
            </p>
            <button
              onClick={() => setShowBillingPortal(true)}
              className="w-full py-3 bg-gray-700 text-white rounded-lg hover:bg-gray-600 font-medium text-sm"
            >
              Open Billing Portal
            </button>
          </div>
        </div>
      );
    }

    const subStatus = clientData?.subscription_status || 'inactive';
    const isActive = subStatus === 'active' || subStatus === 'trialing';
    const isPastDue = subStatus === 'past_due';
    const currentPlan = getPlanFromPriceId(clientData?.stripe_price_id);
    const currentPlanInfo = currentPlan ? PLANS[currentPlan] : null;
    const periodEnd = clientData?.current_period_end
      ? new Date(clientData.current_period_end).toLocaleDateString('en-US', {
          month: 'long', day: 'numeric', year: 'numeric'
        })
      : null;

    const getStatusBadge = (status) => {
      switch(status) {
        case 'active':
        case 'trialing':
          return <span className="px-2 py-1 bg-green-900 text-green-300 rounded text-xs">Active</span>;
        case 'past_due':
          return <span className="px-2 py-1 bg-red-900 text-red-300 rounded text-xs">Past Due</span>;
        case 'canceled':
        case 'cancelled':
          return <span className="px-2 py-1 bg-gray-700 text-gray-300 rounded text-xs">Cancelled</span>;
        default:
          return <span className="px-2 py-1 bg-yellow-900 text-yellow-300 rounded text-xs">No Subscription</span>;
      }
    };

    // Plan card component used for both the selection view and the active view
    const renderPlanCard = (planKey, plan, isCurrent) => (
      <div key={planKey} className={`bg-gray-800 rounded-lg p-4 border ${isCurrent ? 'border-blue-500' : 'border-gray-700'}`}>
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-lg font-semibold text-white">{plan.name}</h4>
          {isCurrent && getStatusBadge(subStatus)}
        </div>
        <p className="text-3xl font-bold text-white mb-1">
          ${plan.price.toFixed(2)}<span className="text-base font-normal text-gray-400">/mo</span>
        </p>
        <p className="text-gray-400 text-sm mb-4">AI Receptionist Service</p>

        {/* Active subscriber info */}
        {isCurrent && isActive && periodEnd && (
          <div className="p-3 bg-gray-750 rounded-lg mb-4">
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Next billing date</span>
              <span className="text-white">{periodEnd}</span>
            </div>
          </div>
        )}

        {isCurrent && isPastDue && (
          <div className="p-3 bg-red-900/30 border border-red-800/50 rounded-lg mb-4">
            <p className="text-red-300 text-sm">Your payment failed. Please update your payment method to avoid service interruption.</p>
          </div>
        )}

        {/* Button logic */}
        {isCurrent && (isActive || isPastDue) ? (
          <button
            onClick={handleBillingPortal}
            disabled={billingAction === 'portal'}
            className="w-full py-3 bg-gray-700 text-white rounded-lg hover:bg-gray-600 font-medium disabled:opacity-50"
          >
            {billingAction === 'portal' ? 'Opening...' : 'Manage Subscription'}
          </button>
        ) : !isActive && !isPastDue ? (
          <button
            onClick={() => handleStripeCheckout(planKey)}
            disabled={!!billingAction}
            className={`w-full py-3 text-white rounded-lg font-medium disabled:opacity-50 ${
              planKey === 'pro' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-600 hover:bg-gray-500'
            }`}
          >
            {billingAction === planKey ? 'Redirecting to Stripe...' : `Subscribe — $${plan.price}/mo`}
          </button>
        ) : null}
      </div>
    );

    return (
      <div className="space-y-4">
        {/* Plan Selection or Current Plan */}
        {isActive || isPastDue ? (
          <>
            {currentPlanInfo ? (
              renderPlanCard(currentPlan, currentPlanInfo, true)
            ) : (
              /* Fallback if price ID doesn't match known plans (e.g., legacy subscriber) */
              <div className="bg-gray-800 rounded-lg p-4 border border-blue-500">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-lg font-semibold text-white">AI Receptionist Service</h4>
                  {getStatusBadge(subStatus)}
                </div>
                {isActive && periodEnd && (
                  <div className="p-3 bg-gray-750 rounded-lg mb-4">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Next billing date</span>
                      <span className="text-white">{periodEnd}</span>
                    </div>
                  </div>
                )}
                {isPastDue && (
                  <div className="p-3 bg-red-900/30 border border-red-800/50 rounded-lg mb-4">
                    <p className="text-red-300 text-sm">Your payment failed. Please update your payment method to avoid service interruption.</p>
                  </div>
                )}
                <button
                  onClick={handleBillingPortal}
                  disabled={billingAction === 'portal'}
                  className="w-full py-3 bg-gray-700 text-white rounded-lg hover:bg-gray-600 font-medium disabled:opacity-50"
                >
                  {billingAction === 'portal' ? 'Opening...' : 'Manage Subscription'}
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <h3 className="text-lg font-semibold text-white">Choose Your Plan</h3>
            <div className="space-y-3">
              {Object.entries(PLANS).map(([key, plan]) => renderPlanCard(key, plan, false))}
            </div>
          </>
        )}

        {/* Usage - only show for active/past_due subscribers */}
        {(isActive || isPastDue) && (
          <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
            <h3 className="text-lg font-semibold mb-4 text-white">Usage This Month</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="p-4 bg-gray-750 rounded-lg text-center">
                <p className="text-2xl font-bold text-white">{stats.totalCalls}</p>
                <p className="text-gray-400 text-sm">Calls</p>
              </div>
              <div className="p-4 bg-gray-750 rounded-lg text-center">
                <p className="text-2xl font-bold text-white">{stats.totalMinutes}</p>
                <p className="text-gray-400 text-sm">Minutes</p>
              </div>
            </div>
            {(() => {
              const planKey = clientData?.stripe_price_id ? getPlanFromPriceId(clientData.stripe_price_id) : null;
              const plan = planKey ? PLANS[planKey] : null;
              const includedMinutes = plan?.minutes || 0;
              const used = stats.totalMinutes || 0;
              const remaining = Math.max(0, includedMinutes - used);
              const pct = includedMinutes > 0 ? Math.min(100, (used / includedMinutes) * 100) : 0;
              const isOver = used > includedMinutes;
              return includedMinutes > 0 ? (
                <>
                  <div className="w-full bg-gray-700 rounded-full h-2 mt-3">
                    <div
                      className={`h-2 rounded-full transition-all ${isOver ? 'bg-red-500' : pct > 80 ? 'bg-yellow-500' : 'bg-purple-500'}`}
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                  </div>
                  <p className={`text-xs mt-2 text-center ${isOver ? 'text-red-400' : 'text-gray-500'}`}>
                    {isOver
                      ? `${used - includedMinutes} min over your ${includedMinutes.toLocaleString()} min limit`
                      : `${remaining.toLocaleString()} of ${includedMinutes.toLocaleString()} min remaining`
                    }
                  </p>
                </>
              ) : (
                <p className="text-gray-500 text-xs mt-3 text-center">All minutes included in your monthly plan</p>
              );
            })()}
          </div>
        )}

        {/* Payment Method / Billing Portal - only show for active/past_due subscribers */}
        {(isActive || isPastDue) && (
          <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
            <h3 className="text-lg font-semibold mb-4 text-white">Payment & Invoices</h3>
            <div className="space-y-3">
              <p className="text-gray-400 text-sm">
                Update your payment method, view invoices, or cancel your subscription through the Stripe billing portal.
              </p>
              <button
                onClick={handleBillingPortal}
                disabled={billingAction === 'portal'}
                className="w-full py-3 bg-gray-700 text-white rounded-lg hover:bg-gray-600 font-medium disabled:opacity-50 text-sm"
              >
                {billingAction === 'portal' ? 'Opening...' : 'Open Billing Portal'}
              </button>
            </div>
          </div>
        )}

      </div>
    );
  };

  // Demo nav — unchanged (used by the isPublicDemo render block above)
  const navItems = [
    { id: 'appointments', label: 'Appointments', icon: Calendar },
    { id: 'customers', label: 'Customers', icon: Users },
    { id: 'calls', label: 'Calls', icon: Phone },
    { id: 'billing', label: 'Billing', icon: DollarSign },
    { id: 'settings', label: 'Settings', icon: Settings }
  ];

  // Authenticated nav — owner gets 6 tabs, dispatcher gets 4 tabs
  const teamTab = { id: 'team', label: 'Team', icon: Users };

  const ownerNavItems = [
    { id: 'appointments', label: 'Appointments', icon: Calendar },
    { id: 'customers', label: 'Customers', icon: Users },
    { id: 'calls', label: 'Calls', icon: Phone },
    teamTab,
    { id: 'map', label: 'Map', icon: MapPin },
    { id: 'billing', label: 'Billing', icon: DollarSign },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  const dispatcherNavItems = [
    { id: 'appointments', label: 'Appointments', icon: Calendar },
    { id: 'customers', label: 'Customers', icon: Users },
    { id: 'calls', label: 'Calls', icon: Phone },
    teamTab,
    { id: 'map', label: 'Map', icon: MapPin },
  ];

  const activeNavItems = role === 'dispatcher' ? dispatcherNavItems : ownerNavItems;

  // Public demo mode — no login required
  if (isPublicDemo && demoMode && demoClientData) {
    return (
      <div className="min-h-screen bg-gray-900 pb-20">
        <DemoDashboard
          demoClientData={demoClientData}
          expiresAt={demoExpiresAt}
          isPublicDemo={true}
          demoToken={demoToken}
          onExitDemo={onExitDemo}
          onDataRefresh={handleDemoDataRefresh}
        />

        {/* Main Content */}
        <main className="p-4 md:p-6">
          {activeTab === 'appointments' && (
            <AppointmentCalendar
              appointments={appointments}
              businessHours={businessHours}
              technicians={technicians}
              serviceTypes={serviceTypes}
              currentWeekStart={currentWeekStart}
              onWeekChange={setCurrentWeekStart}
              onSaveAppointment={handleAddAppointment}
              onRefresh={fetchData}
              loading={loading}
              clientId={effectiveClientData?.id}
              headerLeft={<img src={logo} alt="Reliant Support" style={{ height: '26px', width: 'auto' }} />}
            />
          )}
          {activeTab === 'customers' && (
            <Customers
              clientData={effectiveClientData}
              appointments={appointments}
              onReminderCountChange={setReminderCount}
              headerLeft={<img src={logo} alt="Reliant Support" style={{ height: '26px', width: 'auto' }} />}
            />
          )}
          {activeTab === 'calls' && renderCallLogs(
            <img src={logo} alt="Reliant Support" style={{ height: '26px', width: 'auto' }} />
          )}
          {activeTab === 'billing' && (
            <>
              <div className="flex items-center mb-3">
                <img src={logo} alt="Reliant Support" style={{ height: '26px', width: 'auto' }} />
              </div>
              {renderBilling()}
            </>
          )}
          {activeTab === 'settings' && (
            <>
              <div className="flex items-center mb-3">
                <img src={logo} alt="Reliant Support" style={{ height: '26px', width: 'auto' }} />
              </div>
              {renderSettings()}
            </>
          )}
        </main>

        {/* Stripe Billing Portal Demo Modal */}
        {showBillingPortal && (() => {
          const now = new Date();
          const renewsDate = new Date(now);
          renewsDate.setMonth(renewsDate.getMonth() + 1);
          const renewsStr = renewsDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
          const invoices = [0, 1, 2].map(i => {
            const d = new Date(now);
            d.setMonth(d.getMonth() - i);
            return {
              label: d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
              date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
            };
          });
          return (
            <div
              className="fixed inset-0 bg-black/70 z-[90] flex items-center justify-center p-4"
              onClick={() => setShowBillingPortal(false)}
            >
              <div
                className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto text-gray-900"
                onClick={e => e.stopPropagation()}
              >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
                  <div>
                    <div className="flex items-center gap-2 mb-0.5">
                      <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold">RS</div>
                      <span className="font-semibold text-gray-900 text-sm">{effectiveClientData?.company_name || 'Reliant Support Heating & Air'}</span>
                    </div>
                    <p className="text-xs text-gray-400 ml-9">Powered by <span className="font-semibold text-indigo-500">stripe</span></p>
                  </div>
                  <button
                    onClick={() => setShowBillingPortal(false)}
                    className="text-gray-400 hover:text-gray-600 transition-colors p-1"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {/* Subscription */}
                <div className="px-6 py-5 border-b border-gray-100">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Current Plan</h3>
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold text-gray-900">Standard Plan</p>
                      <p className="text-sm text-gray-500 mt-0.5">$495.00 / month</p>
                      <p className="text-xs text-gray-400 mt-1">Renews {renewsStr}</p>
                    </div>
                    <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-medium rounded-full">Active</span>
                  </div>
                  <button
                    onClick={() => alert('To cancel your subscription, please contact your account representative.')}
                    className="mt-3 text-xs text-red-500 hover:text-red-700 underline"
                  >
                    Cancel plan
                  </button>
                </div>

                {/* Payment Method */}
                <div className="px-6 py-5 border-b border-gray-100">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Payment Method</h3>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-7 bg-gray-100 border border-gray-200 rounded flex items-center justify-center">
                        <svg viewBox="0 0 38 24" className="w-8 h-5">
                          <rect width="38" height="24" rx="4" fill="#1A1F71"/>
                          <path d="M15.8 15.5H13.9L15.1 8.5H17L15.8 15.5ZM12 8.5L10.2 13.1L9.98 12L9.3 9.1C9.3 9.1 9.21 8.5 8.47 8.5H5.5L5.47 8.65C5.47 8.65 6.38 8.85 7.44 9.5L9.08 15.5H11.1L14.1 8.5H12ZM27 15.5H28.8L27.3 8.5H25.7C25.07 8.5 24.91 8.97 24.91 8.97L22.1 15.5H24.12L24.52 14.4H26.97L27 15.5ZM25.09 12.9L26.1 10.2L26.67 12.9H25.09ZM22.1 10.1L22.4 8.72C22.4 8.72 21.55 8.4 20.66 8.4C19.7 8.4 17.4 8.84 17.4 10.89C17.4 12.82 20.05 12.85 20.05 13.87C20.05 14.89 17.68 14.68 16.87 14.02L16.55 15.44C16.55 15.44 17.41 15.82 18.7 15.82C19.99 15.82 22.09 15.17 22.09 13.29C22.09 11.33 19.42 11.16 19.42 10.28C19.42 9.4 21.28 9.52 22.1 10.1Z" fill="white"/>
                        </svg>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">Visa ending in 4242</p>
                        <p className="text-xs text-gray-400">Expires 12/26</p>
                      </div>
                    </div>
                    <button
                      onClick={() => alert('To update your payment method, please contact your account representative.')}
                      className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                    >
                      Update
                    </button>
                  </div>
                </div>

                {/* Invoice History */}
                <div className="px-6 py-5 border-b border-gray-100">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Invoice History</h3>
                  <div className="space-y-3">
                    {invoices.map((inv, i) => (
                      <div key={i} className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-gray-900">{inv.label}</p>
                          <p className="text-xs text-gray-400">{inv.date}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-sm text-gray-700">$495.00</span>
                          <button
                            onClick={() => alert('Invoice download is not available in the demo environment.')}
                            className="text-xs text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                            </svg>
                            PDF
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 text-center">
                  <p className="text-xs text-gray-400">
                    <svg className="w-3.5 h-3.5 inline mr-1 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                    Secured by <span className="font-semibold text-indigo-500">Stripe</span> · This is a demo environment
                  </p>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Bottom Navigation */}
        <nav className="fixed bottom-0 left-0 right-0 bg-gray-800 border-t border-gray-700 z-30">
          <div className="grid grid-cols-5 gap-1">
            {navItems.map(item => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`flex flex-col items-center gap-1 py-3 ${
                  activeTab === item.id ? 'text-blue-500' : 'text-gray-400'
                }`}
              >
                <item.icon className="w-5 h-5" />
                <span className="text-xs">{item.label}</span>
              </button>
            ))}
          </div>
        </nav>
      </div>
    );
  }

  // Subscription gate — admins and sales reps bypass, non-subscribers see only billing
  const isSubscriptionActive = clientData?.is_admin ||
    clientData?.role === 'sales_rep' ||
    ['active', 'trialing'].includes(clientData?.subscription_status);

  if (!isSubscriptionActive && clientData) {
    const isPastDue = clientData?.subscription_status === 'past_due';

    return (
      <div className="min-h-screen bg-gray-900">
        <InstallPrompt />
        <UpdatePrompt />

        {/* Gated Content */}
        <main className="p-4 md:p-6 max-w-lg mx-auto">
          {/* Compact app bar */}
          <div className="flex items-center justify-between mb-4">
            <img src={logo} alt="Reliant Support" style={{ height: '26px', width: 'auto' }} />
            <button
              onClick={onLogout}
              className="p-2 hover:bg-gray-700 rounded-lg"
              title="Sign out"
            >
              <LogOut className="w-5 h-5 text-gray-400" />
            </button>
          </div>
          {awaitingSubscription ? (
            <div className="text-center py-12">
              <RefreshCw className="w-8 h-8 animate-spin text-blue-500 mx-auto mb-4" />
              <h1 className="text-xl font-bold text-white mb-2">Setting up your subscription...</h1>
              <p className="text-gray-400">This may take a moment. Please wait.</p>
            </div>
          ) : (
            <>
              <div className="text-center mb-6 pt-4">
                <h1 className="text-2xl font-bold text-white mb-2">
                  {isPastDue ? 'Payment Required' : `Welcome${clientData?.company_name ? ', ' + clientData.company_name : ''}!`}
                </h1>
                <p className="text-gray-400">
                  {isPastDue
                    ? 'Your payment has failed. Please update your payment method to restore access to your dashboard.'
                    : 'Complete your subscription to activate your AI receptionist dashboard.'}
                </p>
              </div>

              {renderBilling()}
            </>
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 pb-20">
      <InstallPrompt />
      <UpdatePrompt />

      {/* Demo overlay for authenticated sales reps */}
      {demoMode && !isPublicDemo && (
        <DemoDashboard
          demoClientData={demoClientData}
          expiresAt={demoExpiresAt}
          isPublicDemo={false}
          demoToken={demoToken}
          onExitDemo={onExitDemo}
          onDataRefresh={handleDemoDataRefresh}
        />
      )}

      {/* Main Content */}
      <main className="p-4 md:p-6">
        {activeTab === 'overview' && (
          <>
            <div className="flex items-center justify-between mb-3">
              <img src={logo} alt="Reliant Support" style={{ height: '26px', width: 'auto' }} />
              <div className="flex items-center gap-1">
                {clientData?.is_admin && (
                  <button onClick={onShowAdmin} className="p-2 hover:bg-gray-700 rounded-lg" title="Admin Dashboard">
                    <Settings className="w-5 h-5 text-gray-400" />
                  </button>
                )}
                <button onClick={onLogout} className="p-2 hover:bg-gray-700 rounded-lg" title="Sign out">
                  <LogOut className="w-5 h-5 text-gray-400" />
                </button>
              </div>
            </div>
            {renderOverview()}
          </>
        )}
        {activeTab === 'appointments' && (
          <AppointmentCalendar
            appointments={appointments}
            businessHours={businessHours}
            technicians={technicians}
            serviceTypes={serviceTypes}
            currentWeekStart={currentWeekStart}
            onWeekChange={setCurrentWeekStart}
            onSaveAppointment={handleAddAppointment}
            onRefresh={fetchData}
            loading={loading}
            clientId={effectiveClientData?.id}
            headerLeft={<img src={logo} alt="Reliant Support" style={{ height: '26px', width: 'auto' }} />}
            headerRight={
              <div className="flex items-center gap-1">
                {clientData?.is_admin && (
                  <button onClick={onShowAdmin} className="p-2 hover:bg-gray-700 rounded-lg" title="Admin Dashboard">
                    <Settings className="w-5 h-5 text-gray-400" />
                  </button>
                )}
                <button onClick={onLogout} className="p-2 hover:bg-gray-700 rounded-lg" title="Sign out">
                  <LogOut className="w-5 h-5 text-gray-400" />
                </button>
              </div>
            }
          />
        )}
        {activeTab === 'customers' && (
          <Customers
            clientData={effectiveClientData}
            appointments={appointments}
            onReminderCountChange={setReminderCount}
            headerLeft={<img src={logo} alt="Reliant Support" style={{ height: '26px', width: 'auto' }} />}
            headerRight={
              <div className="flex items-center gap-1">
                {clientData?.is_admin && (
                  <button onClick={onShowAdmin} className="p-2 hover:bg-gray-700 rounded-lg" title="Admin Dashboard">
                    <Settings className="w-5 h-5 text-gray-400" />
                  </button>
                )}
                <button onClick={onLogout} className="p-2 hover:bg-gray-700 rounded-lg" title="Sign out">
                  <LogOut className="w-5 h-5 text-gray-400" />
                </button>
              </div>
            }
          />
        )}
        {activeTab === 'calls' && renderCallLogs(
          <img src={logo} alt="Reliant Support" style={{ height: '26px', width: 'auto' }} />,
          <div className="flex items-center gap-1">
            {clientData?.is_admin && (
              <button onClick={onShowAdmin} className="p-2 hover:bg-gray-700 rounded-lg" title="Admin Dashboard">
                <Settings className="w-5 h-5 text-gray-400" />
              </button>
            )}
            <button onClick={onLogout} className="p-2 hover:bg-gray-700 rounded-lg" title="Sign out">
              <LogOut className="w-5 h-5 text-gray-400" />
            </button>
          </div>
        )}
        {activeTab === 'billing' && role !== 'dispatcher' && (
          <>
            <div className="flex items-center justify-between mb-3">
              <img src={logo} alt="Reliant Support" style={{ height: '26px', width: 'auto' }} />
              <div className="flex items-center gap-1">
                {clientData?.is_admin && (
                  <button onClick={onShowAdmin} className="p-2 hover:bg-gray-700 rounded-lg" title="Admin Dashboard">
                    <Settings className="w-5 h-5 text-gray-400" />
                  </button>
                )}
                <button onClick={onLogout} className="p-2 hover:bg-gray-700 rounded-lg" title="Sign out">
                  <LogOut className="w-5 h-5 text-gray-400" />
                </button>
              </div>
            </div>
            {renderBilling()}
          </>
        )}
        {activeTab === 'settings' && role !== 'dispatcher' && (
          <>
            <div className="flex items-center justify-between mb-3">
              <img src={logo} alt="Reliant Support" style={{ height: '26px', width: 'auto' }} />
              <div className="flex items-center gap-1">
                {clientData?.is_admin && (
                  <button onClick={onShowAdmin} className="p-2 hover:bg-gray-700 rounded-lg" title="Admin Dashboard">
                    <Settings className="w-5 h-5 text-gray-400" />
                  </button>
                )}
                <button onClick={onLogout} className="p-2 hover:bg-gray-700 rounded-lg" title="Sign out">
                  <LogOut className="w-5 h-5 text-gray-400" />
                </button>
              </div>
            </div>
            {renderSettings()}
          </>
        )}
        {activeTab === 'team' && (
          <>
            <div className="flex items-center justify-between mb-3">
              <img src={logo} alt="Reliant Support" style={{ height: '26px', width: 'auto' }} />
              <div className="flex items-center gap-1">
                {clientData?.is_admin && (
                  <button onClick={onShowAdmin} className="p-2 hover:bg-gray-700 rounded-lg" title="Admin Dashboard">
                    <Settings className="w-5 h-5 text-gray-400" />
                  </button>
                )}
                <button onClick={onLogout} className="p-2 hover:bg-gray-700 rounded-lg" title="Sign out">
                  <LogOut className="w-5 h-5 text-gray-400" />
                </button>
              </div>
            </div>
            <TeamTab clientData={clientData} role={role} />
          </>
        )}
        {activeTab === 'map' && effectiveClientData?.id && (
          <div style={{ height: 'calc(100vh - 56px - 56px)' }}>
            <DispatcherMap
              clientId={effectiveClientData.id}
              technicians={technicians}
              jobs={appointments.filter(a => a.date === todayStr)}
            />
          </div>
        )}
      </main>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-gray-800 border-t border-gray-700 z-30">
        <div className={`grid gap-1 ${role === 'dispatcher' ? 'grid-cols-5' : 'grid-cols-7'}`}>
          {activeNavItems.map(item => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`flex flex-col items-center gap-1 py-3 ${
                activeTab === item.id ? 'text-blue-500' : 'text-gray-400'
              }`}
            >
              <item.icon className="w-5 h-5" />
              <span className="text-xs">{item.label}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
};

export default DispatcherDashboard;
