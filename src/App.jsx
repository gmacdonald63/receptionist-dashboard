import React, { useState, useEffect, useRef } from 'react';
import { Phone, Calendar, FileText, Clock, DollarSign, Download, Play, Pause, Search, Filter, RefreshCw, ChevronRight, ChevronDown } from 'lucide-react';
import { retellService } from './retellService';
import logo from './assets/RELIANT SUPPORT LOGO.svg';

const App = () => {
  const [activeTab, setActiveTab] = useState('appointments');
  const [selectedCall, setSelectedCall] = useState(null);
  const [playingRecording, setPlayingRecording] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedAppointment, setExpandedAppointment] = useState(null);
  const [currentWeekStart, setCurrentWeekStart] = useState(() => {
    const today = new Date();
    const first = today.getDate() - today.getDay();
    return new Date(today.getFullYear(), today.getMonth(), first);
  });
  const audioRef = useRef(null);
  const todayRef = useRef(null);
  
  // Real data from Retell API
  const [callLogs, setCallLogs] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalCalls: 0,
    appointments: 0,
    totalMinutes: 0,
    monthlyBill: 0
  });

  // Fetch data from Retell API
  useEffect(() => {
    fetchData();
  }, []);

  // Scroll to today when appointments tab is active
  useEffect(() => {
    if (activeTab === 'appointments' && todayRef.current && !loading) {
      setTimeout(() => {
        const element = todayRef.current;
        const yOffset = -80; // Offset to leave space for header and navigation
        const y = element.getBoundingClientRect().top + window.pageYOffset + yOffset;
        window.scrollTo({ top: y, behavior: 'smooth' });
      }, 100);
    }
  }, [activeTab, loading]);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch calls
      const calls = await retellService.getCalls();
      const transformedCalls = calls.map(call => retellService.transformCallData(call));
      setCallLogs(transformedCalls);

      // Get appointments from calls
      const appointmentsList = await retellService.getAppointments();
      setAppointments(appointmentsList);

      // Calculate stats
      const totalMinutes = calls.reduce((sum, call) => sum + (call.call_duration || 0), 0) / 60;
      const monthlyBill = totalMinutes * 0.10;

      setStats({
        totalCalls: calls.length,
        appointments: appointmentsList.length,
        totalMinutes: Math.round(totalMinutes),
        monthlyBill: monthlyBill.toFixed(2)
      });
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Calendar helper functions
  const getWeekDates = (weekStart) => {
    const dates = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(weekStart);
      date.setDate(date.getDate() + i);
      dates.push(date);
    }
    return dates;
  };

  const getAppointmentsForDate = (date) => {
    return appointments.filter(apt => {
      if (!apt.date) return false;
      const aptDate = new Date(apt.date);
      return aptDate.toDateString() === date.toDateString();
    });
  };

  const formatDateForDisplay = (date) => {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const formatDayOfWeek = (date) => {
    return date.toLocaleDateString('en-US', { weekday: 'short' });
  };

  const formatCallTime = (timeString) => {
    // Convert "02/03/2026, 08:01 PM" to "2/3/2026 at 8:01 PM"
    if (!timeString) return '';
    const [datePart, timePart] = timeString.split(', ');
    if (!datePart || !timePart) return timeString;
    const [month, day, year] = datePart.split('/');
    // Remove leading zeros and format time
    const formattedDate = `${parseInt(month)}/${parseInt(day)}/${year}`;
    const formattedTime = timePart.replace(/^0/, '');
    return `${formattedDate} at ${formattedTime}`;
  };

  const formatAppointmentDate = (dateString) => {
    // Convert "2026-02-06" to "2/6/2026"
    if (!dateString) return '';
    const [year, month, day] = dateString.split('-');
    if (!year || !month || !day) return dateString;
    return `${parseInt(month)}/${parseInt(day)}/${year}`;
  };

  const formatAppointmentTime = (timeString) => {
    // Convert "14:00 to 16:00" to "2:00 PM to 4:00 PM"
    if (!timeString) return '';
    
    const convert24to12 = (time24) => {
      const [hours, minutes] = time24.split(':');
      const hour = parseInt(hours);
      const ampm = hour >= 12 ? 'PM' : 'AM';
      const hour12 = hour % 12 || 12;
      return `${hour12}:${minutes} ${ampm}`;
    };
    
    // Handle "HH:MM to HH:MM" format
    if (timeString.includes(' to ')) {
      const [startTime, endTime] = timeString.split(' to ');
      return `${convert24to12(startTime)} to ${convert24to12(endTime)}`;
    }
    
    // Handle single time
    return convert24to12(timeString);
  };

  const goToToday = () => {
    const today = new Date();
    const first = today.getDate() - today.getDay();
    setCurrentWeekStart(new Date(today.getFullYear(), today.getMonth(), first));
  };

  const goPreviousWeek = () => {
    const newDate = new Date(currentWeekStart);
    newDate.setDate(newDate.getDate() - 7);
    setCurrentWeekStart(newDate);
  };

  const goNextWeek = () => {
    const newDate = new Date(currentWeekStart);
    newDate.setDate(newDate.getDate() + 7);
    setCurrentWeekStart(newDate);
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
            <StatCard icon={Clock} label="Total Minutes" value={stats.totalMinutes} color="bg-purple-600" />
            <StatCard icon={DollarSign} label="Monthly Bill" value={`$${stats.monthlyBill}`} color="bg-orange-600" />
          </div>

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
                        <p className="text-sm text-gray-400">{apt.service}</p>
                      </div>
                      <span className={`px-2 py-1 rounded text-xs whitespace-nowrap ${apt.status === 'confirmed' ? 'bg-green-900 text-green-300' : 'bg-yellow-900 text-yellow-300'}`}>
                        {apt.status}
                      </span>
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

  const renderAppointments = () => {
    const weekDates = getWeekDates(currentWeekStart);
    const isCurrentWeek = getWeekDates(new Date())[0].toDateString() === weekDates[0].toDateString();

    return (
      <div className="space-y-4">
        {/* Week Navigation */}
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <button 
              onClick={goPreviousWeek}
              className="px-3 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-700 border border-gray-700 text-sm"
            >
              ← Previous
            </button>
            <button 
              onClick={goToToday}
              className={`px-3 py-2 rounded-lg text-sm font-medium ${
                isCurrentWeek 
                  ? 'bg-blue-600 text-white' 
                  : 'bg-gray-800 text-white hover:bg-gray-700 border border-gray-700'
              }`}
            >
              Today
            </button>
            <button 
              onClick={goNextWeek}
              className="px-3 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-700 border border-gray-700 text-sm"
            >
              Next →
            </button>
          </div>
          <button 
            onClick={fetchData}
            className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
          >
            <RefreshCw className="w-4 h-4" />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>

        {/* Week Display */}
        <div className="text-center mb-4">
          <p className="text-gray-400 text-sm">
            Week of {formatDateForDisplay(weekDates[0])} - {formatDateForDisplay(weekDates[6])}
          </p>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <RefreshCw className="w-8 h-8 animate-spin text-blue-500 mx-auto mb-4" />
            <p className="text-gray-400">Loading appointments...</p>
          </div>
        ) : appointments.length === 0 ? (
          <div className="bg-gray-800 rounded-lg p-8 border border-gray-700 text-center">
            <Calendar className="w-12 h-12 text-gray-600 mx-auto mb-4" />
            <p className="text-gray-400">No appointments booked yet</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-7 gap-3">
            {weekDates.map((date) => {
              const dayAppointments = getAppointmentsForDate(date);
              const isToday = date.toDateString() === new Date().toDateString();

              return (
                <div 
                  key={date.toDateString()}
                  ref={isToday ? todayRef : null}
                  className={`p-3 rounded-lg border min-h-[300px] ${
                    isToday 
                      ? 'border-blue-500 bg-blue-900/20' 
                      : 'border-gray-700 bg-gray-800'
                  }`}
                >
                  {/* Day Header */}
                  <div className="mb-3 pb-3 border-b border-gray-700">
                    <p className="text-gray-400 text-xs font-medium">{formatDayOfWeek(date)}</p>
                    <p className={`text-lg font-semibold ${isToday ? 'text-blue-400' : 'text-white'}`}>
                      {date.getDate()}
                    </p>
                  </div>

                  {/* Appointments for the day */}
                  {dayAppointments.length === 0 ? (
                    <p className="text-gray-500 text-xs text-center py-4">No appointments</p>
                  ) : (
                    <div className="space-y-2">
                      {dayAppointments.map(apt => (
                        <div
                          key={apt.id}
                          className={`p-2 rounded-lg cursor-pointer transition-colors ${
                            expandedAppointment === apt.id
                              ? 'bg-blue-600'
                              : 'bg-gray-750 hover:bg-gray-700'
                          }`}
                          onClick={() => setExpandedAppointment(expandedAppointment === apt.id ? null : apt.id)}
                        >
                          <div className="flex items-start justify-between gap-1">
                            <div className="flex-1 min-w-0">
                              <p className="text-white text-xs font-medium truncate">{apt.name}</p>
                              <p className="text-gray-300 text-xs mt-1">{formatAppointmentTime(apt.time)}</p>
                              {apt.address && (
                                <p className="text-gray-400 text-xs mt-1 truncate">{apt.address}</p>
                              )}
                            </div>
                            {expandedAppointment === apt.id && (
                              <ChevronDown className="w-4 h-4 text-white flex-shrink-0" />
                            )}
                          </div>

                          {/* Expanded Details */}
                          {expandedAppointment === apt.id && (
                            <div className="mt-3 pt-3 border-t border-blue-500/30 space-y-2">
                              {apt.phone && (
                                <div>
                                  <p className="text-xs text-gray-300">Phone</p>
                                  <p className="text-white text-xs font-medium">{apt.phone}</p>
                                </div>
                              )}
                              {apt.summary && (
                                <div>
                                  <p className="text-xs text-gray-300">Summary</p>
                                  <p className="text-white text-xs">{apt.summary}</p>
                                </div>
                              )}
                              {apt.service && (
                                <div>
                                  <p className="text-xs text-gray-300">Service</p>
                                  <p className="text-white text-xs">{apt.service}</p>
                                </div>
                              )}
                              {apt.status && (
                                <div className="pt-1">
                                  <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${
                                    apt.status === 'confirmed' 
                                      ? 'bg-green-900 text-green-300' 
                                      : 'bg-yellow-900 text-yellow-300'
                                  }`}>
                                    {apt.status}
                                  </span>
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
            })}
          </div>
        )}
      </div>
    );
  };

  const filteredCalls = callLogs.filter(call => 
    call.caller.toLowerCase().includes(searchTerm.toLowerCase()) ||
    call.number.includes(searchTerm)
  );

  const renderCallLogs = () => (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search calls..."
            className="w-full pl-10 pr-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <button 
            onClick={fetchData}
            className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-800 border border-gray-700 text-white rounded-lg hover:bg-gray-750"
          >
            <RefreshCw className="w-4 h-4" />
            <span className="hidden sm:inline">Refresh</span>
          </button>
          <button className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Export</span>
          </button>
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
                    <p className="text-white font-medium">{formatAppointmentDate(call.appointment.date)} at {call.appointment.time}</p>
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
          {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].map(day => (
            <div key={day} className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-white font-medium">{day}</p>
                <label className="flex items-center gap-2">
                  <input type="checkbox" className="w-4 h-4" defaultChecked />
                  <span className="text-sm text-gray-400">Open</span>
                </label>
              </div>
              <div className="flex gap-2 items-center">
                <input type="time" className="flex-1 px-3 py-2 bg-gray-750 border border-gray-600 rounded-lg text-white text-sm" defaultValue="09:00" />
                <span className="text-gray-400 text-sm">to</span>
                <input type="time" className="flex-1 px-3 py-2 bg-gray-750 border border-gray-600 rounded-lg text-white text-sm" defaultValue="17:00" />
              </div>
            </div>
          ))}
        </div>
        <button className="mt-4 w-full px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          Save Hours
        </button>
      </div>

      <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <h3 className="text-lg font-semibold mb-4 text-white">Integrations</h3>
        <div className="space-y-3">
          <div className="p-3 bg-gray-750 rounded-lg">
            <div className="flex items-start justify-between mb-2">
              <div className="flex-1">
                <p className="font-medium text-white">Cal.com</p>
                <p className="text-xs text-gray-400 mt-1">Calendar and appointments</p>
              </div>
              <span className="px-2 py-1 bg-green-900 text-green-300 rounded text-xs whitespace-nowrap">Connected</span>
            </div>
            <button className="w-full mt-2 px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 text-sm">
              Configure
            </button>
          </div>
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

  const renderBilling = () => (
    <div className="space-y-4">
      <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <h3 className="text-lg font-semibold mb-4 text-white">Current Usage</h3>
        <div className="grid grid-cols-1 gap-3 mb-4">
          <div className="p-4 bg-gray-750 rounded-lg">
            <p className="text-gray-400 text-xs mb-1">This Month</p>
            <p className="text-3xl font-bold text-white">{stats.totalMinutes}</p>
            <p className="text-gray-400 text-sm">minutes</p>
          </div>
          <div className="p-4 bg-gray-750 rounded-lg">
            <p className="text-gray-400 text-xs mb-1">Rate</p>
            <p className="text-3xl font-bold text-white">$0.10</p>
            <p className="text-gray-400 text-sm">per minute</p>
          </div>
          <div className="p-4 bg-gray-750 rounded-lg">
            <p className="text-gray-400 text-xs mb-1">Current Bill</p>
            <p className="text-3xl font-bold text-white">${stats.monthlyBill}</p>
            <p className="text-gray-400 text-sm">this month</p>
          </div>
        </div>
        <div className="p-3 bg-blue-900/20 border border-blue-800 rounded-lg">
          <p className="text-blue-300 text-sm">Next billing: February 28, 2026</p>
        </div>
      </div>

      <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <h3 className="text-lg font-semibold mb-4 text-white">Billing History</h3>
        <div className="space-y-3">
          {[
            { month: 'Jan 2026', minutes: stats.totalMinutes, amount: `$${stats.monthlyBill}`, status: 'Current' },
            { month: 'Dec 2025', minutes: '1,642', amount: '$164.20', status: 'Paid' },
            { month: 'Nov 2025', minutes: '1,523', amount: '$152.30', status: 'Paid' }
          ].map((bill, idx) => (
            <div key={idx} className="p-3 bg-gray-750 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <p className="font-medium text-white">{bill.month}</p>
                <span className={`px-2 py-1 rounded text-xs ${bill.status === 'Current' ? 'bg-blue-900 text-blue-300' : 'bg-green-900 text-green-300'}`}>
                  {bill.status}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400">{bill.minutes} minutes</span>
                <span className="text-white font-medium">{bill.amount}</span>
              </div>
              {bill.status === 'Paid' && (
                <button className="mt-2 w-full px-3 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 text-sm">
                  Download Invoice
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const navItems = [
    { id: 'overview', label: 'Overview', icon: Phone },
    { id: 'appointments', label: 'Appointments', icon: Calendar },
    { id: 'calls', label: 'Calls', icon: Phone },
    { id: 'billing', label: 'Billing', icon: DollarSign }
  ];

  return (
    <div className="min-h-screen bg-gray-900 pb-20">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700 px-4 sticky top-0 z-50 flex items-center justify-center" style={{ height: '72px' }}>
        <img src={logo} alt="Reliant Solutions" style={{ height: '40px', width: 'auto' }} />
      </header>

      {/* Main Content */}
      <main className="p-4 md:p-6">
        {activeTab === 'overview' && renderOverview()}
        {activeTab === 'appointments' && renderAppointments()}
        {activeTab === 'calls' && renderCallLogs()}
        {activeTab === 'billing' && renderBilling()}
      </main>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-gray-800 border-t border-gray-700 z-30">
        <div className="grid grid-cols-4 gap-1">
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
};

export default App;
