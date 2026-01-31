import React, { useState } from 'react';
import { Phone, Calendar, FileText, Clock, DollarSign, Settings, Download, Play, Pause, Search, Filter, RefreshCw, Menu, X, ChevronRight, ChevronDown } from 'lucide-react';

const Dashboard = () => {
  const [activeTab, setActiveTab] = useState('overview');
  const [selectedCall, setSelectedCall] = useState(null);
  const [playingRecording, setPlayingRecording] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [expandedAppointment, setExpandedAppointment] = useState(null);

  // Sample data
  const stats = {
    totalCalls: 247,
    appointments: 43,
    totalMinutes: 1847,
    monthlyBill: 184.70
  };

  const recentAppointments = [
    { id: 1, name: 'Sarah Johnson', date: '2026-02-03', time: '10:00 AM', service: 'Consultation', status: 'confirmed', phone: '(555) 123-4567' },
    { id: 2, name: 'Michael Chen', date: '2026-02-03', time: '2:30 PM', service: 'Follow-up', status: 'confirmed', phone: '(555) 246-8135' },
    { id: 3, name: 'Emily Rodriguez', date: '2026-02-04', time: '9:00 AM', service: 'Initial Visit', status: 'pending', phone: '(555) 369-2580' },
    { id: 4, name: 'David Park', date: '2026-02-04', time: '11:30 AM', service: 'Consultation', status: 'confirmed', phone: '(555) 159-7530' },
    { id: 5, name: 'Jessica Williams', date: '2026-02-05', time: '1:00 PM', service: 'Review', status: 'pending', phone: '(555) 753-9514' }
  ];

  const callLogs = [
    { id: 1, caller: 'Sarah Johnson', number: '(555) 123-4567', duration: '4:32', time: '2026-01-29 09:15 AM', outcome: 'Appointment Booked', hasRecording: true, hasTranscript: true },
    { id: 2, caller: 'Unknown', number: '(555) 987-6543', duration: '2:18', time: '2026-01-29 08:45 AM', outcome: 'Information Request', hasRecording: true, hasTranscript: true },
    { id: 3, caller: 'Michael Chen', number: '(555) 246-8135', duration: '6:12', time: '2026-01-28 04:30 PM', outcome: 'Appointment Booked', hasRecording: true, hasTranscript: true },
    { id: 4, caller: 'Emily Rodriguez', number: '(555) 369-2580', duration: '3:45', time: '2026-01-28 02:15 PM', outcome: 'Appointment Booked', hasRecording: true, hasTranscript: true },
    { id: 5, caller: 'David Park', number: '(555) 159-7530', duration: '5:20', time: '2026-01-28 11:00 AM', outcome: 'Rescheduled', hasRecording: true, hasTranscript: true },
    { id: 6, caller: 'Jessica Williams', number: '(555) 753-9514', duration: '2:55', time: '2026-01-27 03:45 PM', outcome: 'Appointment Booked', hasRecording: true, hasTranscript: true },
    { id: 7, caller: 'Robert Anderson', number: '(555) 852-4163', duration: '1:30', time: '2026-01-27 10:20 AM', outcome: 'Voicemail Left', hasRecording: true, hasTranscript: false }
  ];

  const sampleTranscript = {
    caller: 'Sarah Johnson',
    date: '2026-01-29 09:15 AM',
    transcript: [
      { speaker: 'AI', text: 'Thank you for calling ABC Medical Services. How may I help you today?' },
      { speaker: 'Caller', text: 'Hi, I\'d like to schedule an appointment with Dr. Smith.' },
      { speaker: 'AI', text: 'I\'d be happy to help you schedule an appointment with Dr. Smith. May I have your name please?' },
      { speaker: 'Caller', text: 'Yes, it\'s Sarah Johnson.' },
      { speaker: 'AI', text: 'Thank you, Sarah. What type of appointment would you like to schedule?' },
      { speaker: 'Caller', text: 'I need a consultation for a new patient visit.' },
      { speaker: 'AI', text: 'Perfect. I have availability on February 3rd at 10:00 AM or February 5th at 2:00 PM. Which works better for you?' },
      { speaker: 'Caller', text: 'February 3rd at 10 AM works great.' },
      { speaker: 'AI', text: 'Excellent. I\'ve scheduled you for February 3rd at 10:00 AM with Dr. Smith. Can I have a phone number where we can reach you?' },
      { speaker: 'Caller', text: 'Sure, it\'s 555-123-4567.' },
      { speaker: 'AI', text: 'Perfect. You\'re all set, Sarah. You\'ll receive a confirmation text shortly. Is there anything else I can help you with?' },
      { speaker: 'Caller', text: 'No, that\'s all. Thank you!' },
      { speaker: 'AI', text: 'You\'re welcome! Have a great day.' }
    ]
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
      <div className="grid grid-cols-2 gap-3 md:gap-6">
        <StatCard icon={Phone} label="Total Calls" value={stats.totalCalls} color="bg-blue-600" />
        <StatCard icon={Calendar} label="Appointments" value={stats.appointments} color="bg-green-600" />
        <StatCard icon={Clock} label="Total Minutes" value={stats.totalMinutes} color="bg-purple-600" />
        <StatCard icon={DollarSign} label="Monthly Bill" value={`$${stats.monthlyBill}`} color="bg-orange-600" />
      </div>

      <div className="bg-gray-800 rounded-lg p-4 md:p-6 border border-gray-700">
        <h3 className="text-lg md:text-xl font-semibold mb-4 text-white">Recent Appointments</h3>
        <div className="space-y-3">
          {recentAppointments.slice(0, 5).map(apt => (
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
            </div>
          ))}
        </div>
      </div>

      <div className="bg-gray-800 rounded-lg p-4 md:p-6 border border-gray-700">
        <h3 className="text-lg md:text-xl font-semibold mb-4 text-white">Recent Calls</h3>
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
      </div>
    </div>
  );

  const renderAppointments = () => (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg md:text-xl font-semibold text-white">All Appointments</h3>
        <button className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm">
          <Download className="w-4 h-4" />
          <span className="hidden sm:inline">Export</span>
        </button>
      </div>
      
      {recentAppointments.map(apt => (
        <div key={apt.id} className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
          <div 
            className="p-4 cursor-pointer"
            onClick={() => setExpandedAppointment(expandedAppointment === apt.id ? null : apt.id)}
          >
            <div className="flex items-start justify-between mb-2">
              <div className="flex-1">
                <p className="font-medium text-white text-lg">{apt.name}</p>
                <p className="text-sm text-gray-400 mt-1">{apt.service}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`px-2 py-1 rounded text-xs ${apt.status === 'confirmed' ? 'bg-green-900 text-green-300' : 'bg-yellow-900 text-yellow-300'}`}>
                  {apt.status}
                </span>
                {expandedAppointment === apt.id ? <ChevronDown className="w-5 h-5 text-gray-400" /> : <ChevronRight className="w-5 h-5 text-gray-400" />}
              </div>
            </div>
            <div className="flex items-center justify-between text-sm">
              <p className="text-gray-300">{apt.date}</p>
              <p className="text-white font-medium">{apt.time}</p>
            </div>
          </div>
          
          {expandedAppointment === apt.id && (
            <div className="px-4 pb-4 pt-2 border-t border-gray-700 bg-gray-750">
              <div className="space-y-2">
                <div>
                  <p className="text-xs text-gray-400">Phone</p>
                  <p className="text-white">{apt.phone}</p>
                </div>
                <div className="flex gap-2 mt-3">
                  <button className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm">
                    Call Patient
                  </button>
                  <button className="flex-1 px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 text-sm">
                    Reschedule
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
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
          <button className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-800 border border-gray-700 text-white rounded-lg hover:bg-gray-750">
            <Filter className="w-4 h-4" />
            <span className="hidden sm:inline">Filter</span>
          </button>
          <button className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Export</span>
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {callLogs.map(call => (
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
              <div className="flex items-center justify-between text-sm mt-2">
                <span className="text-gray-400">{call.duration}</span>
                <span className="text-white font-medium">{call.outcome}</span>
              </div>
              <p className="text-xs text-gray-500 mt-1">{call.time}</p>
            </div>

            {selectedCall === call.id && (
              <div className="px-4 pb-4 border-t border-gray-700 bg-gray-750 space-y-3">
                <div className="pt-4 space-y-2">
                  <div>
                    <p className="text-xs text-gray-400 mb-1">Duration</p>
                    <p className="text-white">{call.duration}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 mb-1">Outcome</p>
                    <p className="text-white">{call.outcome}</p>
                  </div>
                </div>
                
                {call.hasRecording && (
                  <div className="bg-gray-800 p-3 rounded-lg">
                    <p className="text-xs text-gray-400 mb-2">Recording</p>
                    <div className="flex items-center gap-3">
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          setPlayingRecording(playingRecording === call.id ? null : call.id);
                        }}
                        className="p-2 bg-blue-600 rounded-full hover:bg-blue-700"
                      >
                        {playingRecording === call.id ? 
                          <Pause className="w-4 h-4 text-white" /> : 
                          <Play className="w-4 h-4 text-white" />
                        }
                      </button>
                      <div className="flex-1 h-2 bg-gray-600 rounded-full">
                        <div className="h-full w-1/3 bg-blue-500 rounded-full"></div>
                      </div>
                      <span className="text-xs text-gray-400 whitespace-nowrap">1:32</span>
                    </div>
                  </div>
                )}

                {call.hasTranscript && (
                  <button 
                    onClick={() => setActiveTab('transcripts')}
                    className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center justify-center gap-2"
                  >
                    <FileText className="w-4 h-4" />
                    View Transcript
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  const renderTranscripts = () => (
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
            <p className="text-white font-medium">{sampleTranscript.caller}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400">Date & Time</p>
            <p className="text-white">{sampleTranscript.date}</p>
          </div>
        </div>

        <div className="space-y-3 max-h-[60vh] overflow-y-auto">
          {sampleTranscript.transcript.map((line, idx) => (
            <div key={idx} className={`p-3 rounded-lg ${line.speaker === 'AI' ? 'bg-blue-900/30 ml-4' : 'bg-gray-750 mr-4'}`}>
              <p className="text-xs font-semibold mb-1 text-gray-400">{line.speaker}</p>
              <p className="text-white text-sm leading-relaxed">{line.text}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-2">
        <button className="flex-1 px-4 py-3 bg-gray-800 border border-gray-700 text-white rounded-lg hover:bg-gray-750">
          Previous
        </button>
        <button className="flex-1 px-4 py-3 bg-gray-800 border border-gray-700 text-white rounded-lg hover:bg-gray-750">
          Next
        </button>
      </div>
    </div>
  );

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
            { month: 'Dec 2025', minutes: '1,642', amount: '$164.20', status: 'Paid' },
            { month: 'Nov 2025', minutes: '1,523', amount: '$152.30', status: 'Paid' },
            { month: 'Oct 2025', minutes: '1,789', amount: '$178.90', status: 'Paid' }
          ].map((bill, idx) => (
            <div key={idx} className="p-3 bg-gray-750 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <p className="font-medium text-white">{bill.month}</p>
                <span className="px-2 py-1 bg-green-900 text-green-300 rounded text-xs">
                  {bill.status}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400">{bill.minutes} minutes</span>
                <span className="text-white font-medium">{bill.amount}</span>
              </div>
              <button className="mt-2 w-full px-3 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 text-sm">
                Download Invoice
              </button>
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
    { id: 'transcripts', label: 'Transcripts', icon: FileText },
    { id: 'billing', label: 'Billing', icon: DollarSign },
    { id: 'settings', label: 'Settings', icon: Settings }
  ];

  return (
    <div className="min-h-screen bg-gray-900 pb-20 md:pb-0">
      {/* Mobile Header */}
      <header className="bg-gray-800 border-b border-gray-700 px-4 py-3 sticky top-0 z-50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Phone className="w-6 h-6 md:w-8 md:h-8 text-blue-500" />
            <h1 className="text-lg md:text-2xl font-bold text-white">AI Receptionist</h1>
          </div>
          <div className="flex items-center gap-3">
            <button className="p-2 hover:bg-gray-700 rounded-lg hidden md:block">
              <RefreshCw className="w-5 h-5 text-gray-400" />
            </button>
            <button 
              className="p-2 hover:bg-gray-700 rounded-lg md:hidden"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <X className="w-6 h-6 text-white" /> : <Menu className="w-6 h-6 text-white" />}
            </button>
            <div className="w-8 h-8 md:w-10 md:h-10 bg-blue-600 rounded-full flex items-center justify-center text-white font-semibold text-sm">
              AC
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Drawer Menu */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-40 md:hidden" onClick={() => setMobileMenuOpen(false)}>
          <div 
            className="absolute right-0 top-0 bottom-0 w-64 bg-gray-800 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-gray-700">
              <p className="text-white font-semibold">Menu</p>
            </div>
            <nav className="p-2">
              {navItems.map(item => (
                <button
                  key={item.id}
                  onClick={() => {
                    setActiveTab(item.id);
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg mb-1 ${
                    activeTab === item.id
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-400 hover:bg-gray-750 hover:text-white'
                  }`}
                >
                  <item.icon className="w-5 h-5" />
                  {item.label}
                </button>
              ))}
            </nav>
          </div>
        </div>
      )}

      {/* Desktop Navigation */}
      <nav className="bg-gray-800 border-b border-gray-700 px-6 hidden md:block">
        <div className="flex gap-1 overflow-x-auto">
          {navItems.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-500'
                  : 'border-transparent text-gray-400 hover:text-gray-300'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>
      </nav>

      {/* Main Content */}
      <main className="p-4 md:p-6">
        {activeTab === 'overview' && renderOverview()}
        {activeTab === 'appointments' && renderAppointments()}
        {activeTab === 'calls' && renderCallLogs()}
        {activeTab === 'transcripts' && renderTranscripts()}
        {activeTab === 'billing' && renderBilling()}
        {activeTab === 'settings' && renderSettings()}
      </main>

      {/* Mobile Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-gray-800 border-t border-gray-700 md:hidden z-30">
        <div className="grid grid-cols-5 gap-1">
          {navItems.slice(0, 5).map(item => (
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

export default Dashboard;
