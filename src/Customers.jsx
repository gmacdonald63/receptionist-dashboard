import React, { useState, useEffect, useRef } from 'react';
import {
  Search, Plus, X, ChevronLeft, Phone, Mail, MapPin, Tag, Clock,
  FileText, Calendar, Bell, Check, Trash2, Edit3, User, RefreshCw,
  ChevronDown, ChevronRight, AlertCircle
} from 'lucide-react';
import { supabase } from './supabaseClient';
import {
  normalizeAddress,
  normalizeForDisplay,
  normalizePhone,
  filterCustomers,
  syncCustomersFromAppointments,
} from './utils/addressNormalization';

const TAG_COLORS = [
  { bg: 'bg-blue-900/60', text: 'text-blue-300', border: 'border-blue-700' },
  { bg: 'bg-green-900/60', text: 'text-green-300', border: 'border-green-700' },
  { bg: 'bg-purple-900/60', text: 'text-purple-300', border: 'border-purple-700' },
  { bg: 'bg-orange-900/60', text: 'text-orange-300', border: 'border-orange-700' },
  { bg: 'bg-pink-900/60', text: 'text-pink-300', border: 'border-pink-700' },
  { bg: 'bg-teal-900/60', text: 'text-teal-300', border: 'border-teal-700' },
  { bg: 'bg-yellow-900/60', text: 'text-yellow-300', border: 'border-yellow-700' },
  { bg: 'bg-red-900/60', text: 'text-red-300', border: 'border-red-700' },
];

const SYSTEM_TAGS = new Set(['From Call', 'From Appointment']);

const getTagColor = (tag) => {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = tag.charCodeAt(i) + ((hash << 5) - hash);
  }
  return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length];
};

const Customers = ({ clientData, appointments, onReminderCountChange }) => {
  const [customers, setCustomers] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [activeProfileTab, setActiveProfileTab] = useState('overview');

  // Add/Edit customer modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [customerForm, setCustomerForm] = useState({
    name: '', phone: '', email: '', address: '', tags: []
  });
  const [tagInput, setTagInput] = useState('');
  const [saving, setSaving] = useState(false);

  // Notes
  const [notes, setNotes] = useState([]);
  const [newNote, setNewNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  // Reminders
  const [reminders, setReminders] = useState([]);
  const [allReminders, setAllReminders] = useState([]);
  const [showAddReminder, setShowAddReminder] = useState(false);
  const [reminderForm, setReminderForm] = useState({
    title: '', note: '', due_date: '', due_time: ''
  });
  const [savingReminder, setSavingReminder] = useState(false);
  const [showRemindersPanel, setShowRemindersPanel] = useState(false);
  const [filterTag, setFilterTag] = useState('');

  // Load customers on mount
  useEffect(() => {
    if (clientData?.id) {
      fetchCustomers();
      fetchAllReminders();
    }
  }, [clientData]);

  // Sync customers from appointments (not call logs)
  useEffect(() => {
    if (clientData?.id && appointments.length > 0) {
      handleSyncCustomers();
    }
  }, [appointments, clientData]);

  // Update reminder count badge for parent
  useEffect(() => {
    if (onReminderCountChange) {
      const today = new Date().toISOString().split('T')[0];
      const dueCount = allReminders.filter(r => !r.completed && r.due_date <= today).length;
      onReminderCountChange(dueCount);
    }
  }, [allReminders, onReminderCountChange]);

  // Restore draft note from sessionStorage on mount
  useEffect(() => {
    const draft = sessionStorage.getItem('customer-note-draft');
    if (draft) setNewNote(draft);
  }, []);

  // Persist draft note to sessionStorage on every keystroke
  useEffect(() => {
    if (newNote) {
      sessionStorage.setItem('customer-note-draft', newNote);
    } else {
      sessionStorage.removeItem('customer-note-draft');
    }
  }, [newNote]);

  const fetchCustomers = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('customers')
        .select('*')
        .eq('client_id', clientData.id)
        .order('created_at', { ascending: false });

      if (!error && data) {
        setCustomers(data);
      }
    } catch (err) {
      console.error('Error fetching customers:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchAllReminders = async () => {
    try {
      const { data, error } = await supabase
        .from('follow_up_reminders')
        .select('*, customers(name)')
        .eq('client_id', clientData.id)
        .order('due_date', { ascending: true });

      if (!error && data) {
        setAllReminders(data);
      }
    } catch (err) {
      console.error('Error fetching reminders:', err);
    }
  };

  const handleSyncCustomers = async () => {
    try {
      const { data: existingCustomers } = await supabase
        .from('customers')
        .select('id, phone, address')
        .eq('client_id', clientData.id);

      const didSync = await syncCustomersFromAppointments(
        appointments,
        existingCustomers || [],
        clientData.id,
        supabase
      );

      if (didSync) {
        fetchCustomers();
      }
    } catch (err) {
      console.error('Error syncing customers:', err);
    }
  };

  const fetchCustomerNotes = async (customerId) => {
    try {
      const { data, error } = await supabase
        .from('customer_notes')
        .select('*')
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false });

      if (!error) setNotes(data || []);
    } catch (err) {
      console.error('Error fetching notes:', err);
    }
  };

  const fetchCustomerReminders = async (customerId) => {
    try {
      const { data, error } = await supabase
        .from('follow_up_reminders')
        .select('*')
        .eq('customer_id', customerId)
        .order('due_date', { ascending: true });

      if (!error) setReminders(data || []);
    } catch (err) {
      console.error('Error fetching reminders:', err);
    }
  };

  const openCustomerProfile = (customer) => {
    setSelectedCustomer(customer);
    setActiveProfileTab('overview');
    fetchCustomerNotes(customer.id);
    fetchCustomerReminders(customer.id);
  };

  const handleSaveCustomer = async (e) => {
    e.preventDefault();
    if (!customerForm.name.trim()) return;
    setSaving(true);

    try {
      if (editingCustomer) {
        const { error } = await supabase
          .from('customers')
          .update({
            name: customerForm.name.trim(),
            phone: customerForm.phone.trim(),
            email: customerForm.email.trim(),
            address: customerForm.address.trim(),
            tags: customerForm.tags
          })
          .eq('id', editingCustomer.id);

        if (error) throw error;

        setCustomers(prev => prev.map(c =>
          c.id === editingCustomer.id
            ? { ...c, name: customerForm.name.trim(), phone: customerForm.phone.trim(), email: customerForm.email.trim(), address: customerForm.address.trim(), tags: customerForm.tags }
            : c
        ));

        if (selectedCustomer?.id === editingCustomer.id) {
          setSelectedCustomer(prev => ({
            ...prev,
            name: customerForm.name.trim(),
            phone: customerForm.phone.trim(),
            email: customerForm.email.trim(),
            address: customerForm.address.trim(),
            tags: customerForm.tags
          }));
        }
      } else {
        const { data, error } = await supabase
          .from('customers')
          .insert({
            client_id: clientData.id,
            name: customerForm.name.trim(),
            phone: customerForm.phone.trim(),
            email: customerForm.email.trim(),
            address: customerForm.address.trim(),
            tags: customerForm.tags
          })
          .select()
          .single();

        if (error) throw error;
        setCustomers(prev => [data, ...prev]);
      }

      closeModal();
    } catch (err) {
      console.error('Error saving customer:', err);
      alert('Failed to save customer.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCustomer = async (customerId) => {
    if (!confirm('Delete this customer and all their notes and reminders?')) return;
    try {
      const { error } = await supabase.from('customers').delete().eq('id', customerId);
      if (error) throw error;
      setCustomers(prev => prev.filter(c => c.id !== customerId));
      setSelectedCustomer(null);
      fetchAllReminders();
    } catch (err) {
      console.error('Error deleting customer:', err);
    }
  };

  const handleAddNote = async () => {
    if (!newNote.trim() || !selectedCustomer) return;
    setSavingNote(true);
    try {
      const { data, error } = await supabase
        .from('customer_notes')
        .insert({
          customer_id: selectedCustomer.id,
          client_id: clientData.id,
          note: newNote.trim()
        })
        .select()
        .single();

      if (error) throw error;
      setNotes(prev => [data, ...prev]);
      setNewNote('');
      sessionStorage.removeItem('customer-note-draft');
    } catch (err) {
      console.error('Error adding note:', err);
    } finally {
      setSavingNote(false);
    }
  };

  const handleDeleteNote = async (noteId) => {
    try {
      await supabase.from('customer_notes').delete().eq('id', noteId);
      setNotes(prev => prev.filter(n => n.id !== noteId));
    } catch (err) {
      console.error('Error deleting note:', err);
    }
  };

  const handleAddReminder = async (e) => {
    e.preventDefault();
    if (!reminderForm.title.trim() || !reminderForm.due_date) return;
    setSavingReminder(true);
    try {
      const { data, error } = await supabase
        .from('follow_up_reminders')
        .insert({
          customer_id: selectedCustomer.id,
          client_id: clientData.id,
          title: reminderForm.title.trim(),
          note: reminderForm.note.trim(),
          due_date: reminderForm.due_date,
          due_time: reminderForm.due_time || null
        })
        .select()
        .single();

      if (error) throw error;
      setReminders(prev => [...prev, data].sort((a, b) => a.due_date.localeCompare(b.due_date)));
      setAllReminders(prev => [...prev, { ...data, customers: { name: selectedCustomer.name } }]);
      setReminderForm({ title: '', note: '', due_date: '', due_time: '' });
      setShowAddReminder(false);
    } catch (err) {
      console.error('Error adding reminder:', err);
    } finally {
      setSavingReminder(false);
    }
  };

  const handleToggleReminder = async (reminder) => {
    const newCompleted = !reminder.completed;
    try {
      const { error } = await supabase
        .from('follow_up_reminders')
        .update({
          completed: newCompleted,
          completed_at: newCompleted ? new Date().toISOString() : null
        })
        .eq('id', reminder.id);

      if (error) throw error;
      setReminders(prev => prev.map(r => r.id === reminder.id ? { ...r, completed: newCompleted } : r));
      setAllReminders(prev => prev.map(r => r.id === reminder.id ? { ...r, completed: newCompleted } : r));
    } catch (err) {
      console.error('Error toggling reminder:', err);
    }
  };

  const handleDeleteReminder = async (reminderId) => {
    try {
      await supabase.from('follow_up_reminders').delete().eq('id', reminderId);
      setReminders(prev => prev.filter(r => r.id !== reminderId));
      setAllReminders(prev => prev.filter(r => r.id !== reminderId));
    } catch (err) {
      console.error('Error deleting reminder:', err);
    }
  };

  const closeModal = () => {
    setShowAddModal(false);
    setEditingCustomer(null);
    setCustomerForm({ name: '', phone: '', email: '', address: '', tags: [] });
    setTagInput('');
  };

  const openEditModal = (customer) => {
    setEditingCustomer(customer);
    setCustomerForm({
      name: customer.name || '',
      phone: customer.phone || '',
      email: customer.email || '',
      address: customer.address || '',
      tags: customer.tags || []
    });
    setShowAddModal(true);
  };

  const handleAddTag = () => {
    const tag = tagInput.trim();
    if (tag && !customerForm.tags.includes(tag)) {
      setCustomerForm(f => ({ ...f, tags: [...f.tags, tag] }));
    }
    setTagInput('');
  };

  const handleRemoveTag = (tag) => {
    setCustomerForm(f => ({ ...f, tags: f.tags.filter(t => t !== tag) }));
  };

  // Get customer's appointments — phone-first match, address as fallback
  const getCustomerAppointments = (customer) => {
    const custPhone = normalizePhone(customer.phone);
    const custAddr = normalizeAddress(customer.address);
    if (!custPhone && !custAddr) return [];
    return appointments.filter(apt => {
      if (custPhone) {
        const aptPhone = normalizePhone(apt.phone);
        if (aptPhone && aptPhone === custPhone) return true;
      }
      if (custAddr) {
        const aptAddr = normalizeAddress(apt.address);
        if (aptAddr && aptAddr === custAddr) return true;
      }
      return false;
    });
  };

  // Get all user-defined tags (excludes auto-generated system tags)
  const getAllTags = () => {
    const tags = new Set();
    customers.forEach(c => (c.tags || []).forEach(t => {
      if (!SYSTEM_TAGS.has(t)) tags.add(t);
    }));
    return Array.from(tags).sort();
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const formatTime = (timeStr) => {
    if (!timeStr) return '';
    const [h, m] = timeStr.split(':');
    const hour = parseInt(h);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const hour12 = hour % 12 || 12;
    return `${hour12}:${m} ${ampm}`;
  };

  const formatTimestamp = (ts) => {
    if (!ts) return '';
    const date = new Date(ts);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  };

  // Build last-appointment-date lookup for client-side sort
  // Phone-primary, address-secondary — mirrors the dedup logic
  const lastAptByPhone = new Map();
  const lastAptByAddr = new Map();
  for (const apt of appointments) {
    if (apt.date) {
      const phone = normalizePhone(apt.phone);
      if (phone) {
        const cur = lastAptByPhone.get(phone);
        if (!cur || apt.date > cur) lastAptByPhone.set(phone, apt.date);
      }
      const addr = normalizeAddress(apt.address);
      if (addr) {
        const cur = lastAptByAddr.get(addr);
        if (!cur || apt.date > cur) lastAptByAddr.set(addr, apt.date);
      }
    }
  }

  const getLastAptDate = (customer) => {
    const phone = normalizePhone(customer.phone);
    const addr = normalizeAddress(customer.address);
    return (phone && lastAptByPhone.get(phone)) || (addr && lastAptByAddr.get(addr)) || null;
  };

  // Filter customers by name/phone, apply tag filter, sort by most recent appointment
  const filteredCustomers = filterCustomers(customers, searchTerm)
    .filter(c => !filterTag || (c.tags || []).includes(filterTag))
    .sort((a, b) => {
      const dateA = getLastAptDate(a);
      const dateB = getLastAptDate(b);
      if (dateA && dateB) return dateB.localeCompare(dateA); // most recent first
      if (dateA) return -1; // a has appointments, b doesn't → a first
      if (dateB) return 1;  // b has appointments, a doesn't → b first
      return (a.name || '').localeCompare(b.name || ''); // both no appointments → alphabetical
    });

  // Reminders panel
  const today = new Date().toISOString().split('T')[0];
  const dueReminders = allReminders.filter(r => !r.completed && r.due_date <= today);
  const upcomingReminders = allReminders.filter(r => !r.completed && r.due_date > today);
  const completedReminders = allReminders.filter(r => r.completed);

  // ============ RENDER: Reminders Panel ============
  const renderRemindersPanel = () => (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setShowRemindersPanel(false)}
          className="flex items-center gap-2 text-gray-400 hover:text-white text-sm"
        >
          <ChevronLeft className="w-4 h-4" />
          Back to Customers
        </button>
      </div>

      <h2 className="text-xl font-semibold text-white flex items-center gap-2">
        <Bell className="w-5 h-5" />
        Follow-Up Reminders
        {dueReminders.length > 0 && (
          <span className="px-2 py-0.5 bg-red-600 text-white rounded-full text-xs font-bold">
            {dueReminders.length}
          </span>
        )}
      </h2>

      {dueReminders.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-red-400 flex items-center gap-1">
            <AlertCircle className="w-4 h-4" />
            Due / Overdue
          </h3>
          {dueReminders.map(r => renderReminderCard(r, true))}
        </div>
      )}

      {upcomingReminders.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-blue-400">Upcoming</h3>
          {upcomingReminders.map(r => renderReminderCard(r, false))}
        </div>
      )}

      {completedReminders.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-gray-500">Completed</h3>
          {completedReminders.slice(0, 10).map(r => renderReminderCard(r, false))}
        </div>
      )}

      {allReminders.length === 0 && (
        <div className="text-center py-12">
          <Bell className="w-10 h-10 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">No reminders yet</p>
          <p className="text-gray-500 text-xs mt-1">Add reminders from a customer's profile</p>
        </div>
      )}
    </div>
  );

  const renderReminderCard = (reminder, isDue) => (
    <div
      key={reminder.id}
      className={`p-3 rounded-lg border ${
        reminder.completed
          ? 'bg-gray-800/50 border-gray-700/50'
          : isDue
            ? 'bg-red-900/20 border-red-800/50'
            : 'bg-gray-800 border-gray-700'
      }`}
    >
      <div className="flex items-start gap-3">
        <button
          onClick={() => handleToggleReminder(reminder)}
          className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
            reminder.completed
              ? 'bg-green-600 border-green-600'
              : isDue
                ? 'border-red-500 hover:bg-red-900/30'
                : 'border-gray-500 hover:bg-gray-700'
          }`}
        >
          {reminder.completed && <Check className="w-3 h-3 text-white" />}
        </button>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium ${reminder.completed ? 'text-gray-500 line-through' : 'text-white'}`}>
            {reminder.title}
          </p>
          {reminder.customers?.name && (
            <p className="text-xs text-blue-400 mt-0.5">{reminder.customers.name}</p>
          )}
          {reminder.note && (
            <p className="text-xs text-gray-400 mt-1">{reminder.note}</p>
          )}
          <p className={`text-xs mt-1 ${isDue && !reminder.completed ? 'text-red-400' : 'text-gray-500'}`}>
            {formatDate(reminder.due_date)}
            {reminder.due_time && ` at ${formatTime(reminder.due_time)}`}
          </p>
        </div>
        <button
          onClick={() => handleDeleteReminder(reminder.id)}
          className="p-1 hover:bg-gray-700 rounded text-gray-500 hover:text-red-400 flex-shrink-0"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );

  // ============ RENDER: Customer Profile ============
  const renderCustomerProfile = () => {
    const customerAppointments = getCustomerAppointments(selectedCustomer);
    // Filter system tags from profile display
    const displayTags = (selectedCustomer.tags || []).filter(t => !SYSTEM_TAGS.has(t));

    const profileTabs = [
      { id: 'overview', label: 'Overview' },
      { id: 'notes', label: 'Notes', count: notes.length },
      { id: 'reminders', label: 'Reminders', count: reminders.filter(r => !r.completed).length },
      { id: 'appointments', label: 'Appts', count: customerAppointments.length },
    ];

    return (
      <div className="space-y-4">
        {/* Back button */}
        <button
          onClick={() => setSelectedCustomer(null)}
          className="flex items-center gap-2 text-gray-400 hover:text-white text-sm"
        >
          <ChevronLeft className="w-4 h-4" />
          Back to Customers
        </button>

        {/* Customer Header */}
        <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0">
                <span className="text-white font-semibold text-lg">
                  {selectedCustomer.name?.charAt(0)?.toUpperCase() || '?'}
                </span>
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">{selectedCustomer.name}</h2>
                <p className="text-gray-400 text-xs">
                  Customer since {formatDate(selectedCustomer.created_at)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => openEditModal(selectedCustomer)}
                className="p-2 hover:bg-gray-700 rounded-lg"
                title="Edit customer"
              >
                <Edit3 className="w-4 h-4 text-gray-400" />
              </button>
              <button
                onClick={() => handleDeleteCustomer(selectedCustomer.id)}
                className="p-2 hover:bg-gray-700 rounded-lg"
                title="Delete customer"
              >
                <Trash2 className="w-4 h-4 text-gray-400 hover:text-red-400" />
              </button>
            </div>
          </div>

          {/* Contact Info */}
          <div className="space-y-2 mb-3">
            {selectedCustomer.phone && (
              <div className="flex items-center gap-2 text-sm">
                <Phone className="w-4 h-4 text-gray-500" />
                <span className="text-white">{selectedCustomer.phone}</span>
              </div>
            )}
            {selectedCustomer.email && (
              <div className="flex items-center gap-2 text-sm">
                <Mail className="w-4 h-4 text-gray-500" />
                <span className="text-white">{selectedCustomer.email}</span>
              </div>
            )}
            {selectedCustomer.address && (
              <div className="flex items-center gap-2 text-sm">
                <MapPin className="w-4 h-4 text-gray-500" />
                <span className="text-white">{normalizeForDisplay(selectedCustomer.address)}</span>
              </div>
            )}
          </div>

          {/* User-defined tags only (system tags hidden) */}
          {displayTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {displayTags.map(tag => {
                const color = getTagColor(tag);
                return (
                  <span
                    key={tag}
                    className={`px-2 py-0.5 rounded text-xs ${color.bg} ${color.text} border ${color.border}`}
                  >
                    {tag}
                  </span>
                );
              })}
            </div>
          )}
        </div>

        {/* Profile Tabs */}
        <div className="flex gap-1 overflow-x-auto pb-1">
          {profileTabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveProfileTab(tab.id)}
              className={`px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap flex items-center gap-1.5 ${
                activeProfileTab === tab.id
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              {tab.label}
              {tab.count > 0 && (
                <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                  activeProfileTab === tab.id ? 'bg-blue-500' : 'bg-gray-700'
                }`}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeProfileTab === 'overview' && renderOverviewTab(customerAppointments)}
        {activeProfileTab === 'notes' && renderNotesTab()}
        {activeProfileTab === 'reminders' && renderRemindersTab()}
        {activeProfileTab === 'appointments' && renderAppointmentsTab(customerAppointments)}
      </div>
    );
  };

  const renderOverviewTab = (customerAppointments) => {
    // Most recent appointment — find the one with the latest date
    const sortedApts = [...customerAppointments].sort((a, b) =>
      (b.date || '').localeCompare(a.date || '')
    );
    const mostRecentApt = sortedApts[0] || null;

    return (
      <div className="space-y-3">
        {/* Most Recent Appointment — visible without scrolling */}
        {mostRecentApt && (
          <div className="bg-gray-800 rounded-lg p-3 border border-blue-800/50">
            <p className="text-xs text-blue-400 font-medium mb-1">Most Recent Appointment</p>
            <p className="text-white text-sm font-medium">{mostRecentApt.service || 'Appointment'}</p>
            <p className="text-gray-300 text-xs mt-0.5">
              {formatDate(mostRecentApt.date)}
              {mostRecentApt.time ? ` · ${mostRecentApt.time}` : ''}
            </p>
            {mostRecentApt.address && (
              <p className="text-gray-400 text-xs mt-0.5">{normalizeForDisplay(mostRecentApt.address)}</p>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="bg-gray-800 rounded-lg p-3 border border-gray-700 text-center">
            <p className="text-xl font-bold text-white">{customerAppointments.length}</p>
            <p className="text-gray-400 text-xs">Appts</p>
          </div>
          <div className="bg-gray-800 rounded-lg p-3 border border-gray-700 text-center">
            <p className="text-xl font-bold text-white">{notes.length}</p>
            <p className="text-gray-400 text-xs">Notes</p>
          </div>
        </div>

        {/* Quick Add Note */}
        <div className="bg-gray-800 rounded-lg p-3 border border-gray-700">
          <p className="text-sm font-medium text-white mb-2">Quick Note</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={newNote}
              onChange={e => setNewNote(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAddNote()}
              placeholder="Add a note..."
              className="flex-1 px-3 py-2 bg-gray-750 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 text-sm"
            />
            <button
              onClick={handleAddNote}
              disabled={!newNote.trim() || savingNote}
              className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm"
            >
              Add
            </button>
          </div>
        </div>

        {/* Pending Reminders */}
        {reminders.filter(r => !r.completed).length > 0 && (
          <div className="bg-gray-800 rounded-lg p-3 border border-gray-700">
            <p className="text-sm font-medium text-white mb-2 flex items-center gap-2">
              <Bell className="w-4 h-4 text-yellow-400" />
              Pending Reminders
            </p>
            <div className="space-y-2">
              {reminders.filter(r => !r.completed).slice(0, 3).map(r => (
                <div key={r.id} className="flex items-center gap-2 text-sm">
                  <button
                    onClick={() => handleToggleReminder(r)}
                    className="w-4 h-4 rounded border-2 border-gray-500 flex-shrink-0 hover:bg-gray-700"
                  />
                  <span className="text-white text-xs flex-1">{r.title}</span>
                  <span className={`text-xs ${r.due_date <= today ? 'text-red-400' : 'text-gray-500'}`}>
                    {formatDate(r.due_date)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent Notes */}
        {notes.length > 0 && (
          <div className="bg-gray-800 rounded-lg p-3 border border-gray-700">
            <p className="text-sm font-medium text-white mb-2">Recent Notes</p>
            <div className="space-y-2">
              {notes.slice(0, 3).map(note => (
                <div key={note.id} className="p-2 bg-gray-750 rounded text-xs">
                  <p className="text-white">{note.note}</p>
                  <p className="text-gray-500 mt-1">{formatTimestamp(note.created_at)}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderNotesTab = () => (
    <div className="space-y-3">
      {/* Add Note */}
      <div className="bg-gray-800 rounded-lg p-3 border border-gray-700">
        <textarea
          value={newNote}
          onChange={e => setNewNote(e.target.value)}
          placeholder="Write a note about this customer..."
          rows={3}
          className="w-full px-3 py-2 bg-gray-750 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 text-sm resize-none"
        />
        <button
          onClick={handleAddNote}
          disabled={!newNote.trim() || savingNote}
          className="mt-2 w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm"
        >
          {savingNote ? 'Saving...' : 'Add Note'}
        </button>
      </div>

      {/* Notes List */}
      {notes.length === 0 ? (
        <div className="text-center py-8">
          <FileText className="w-8 h-8 text-gray-600 mx-auto mb-2" />
          <p className="text-gray-400 text-sm">No notes yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {notes.map(note => (
            <div key={note.id} className="bg-gray-800 rounded-lg p-3 border border-gray-700">
              <div className="flex items-start justify-between gap-2">
                <p className="text-white text-sm flex-1">{note.note}</p>
                <button
                  onClick={() => handleDeleteNote(note.id)}
                  className="p-1 hover:bg-gray-700 rounded text-gray-500 hover:text-red-400 flex-shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className="text-gray-500 text-xs mt-2">{formatTimestamp(note.created_at)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderRemindersTab = () => (
    <div className="space-y-3">
      <button
        onClick={() => setShowAddReminder(true)}
        className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm"
      >
        <Plus className="w-4 h-4" />
        Add Reminder
      </button>

      {/* Add Reminder Form */}
      {showAddReminder && (
        <form onSubmit={handleAddReminder} className="bg-gray-800 rounded-lg p-3 border border-blue-700 space-y-3">
          <input
            type="text"
            required
            value={reminderForm.title}
            onChange={e => setReminderForm(f => ({ ...f, title: e.target.value }))}
            placeholder="Reminder title (e.g., Follow up on deck quote)"
            className="w-full px-3 py-2 bg-gray-750 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 text-sm"
          />
          <textarea
            value={reminderForm.note}
            onChange={e => setReminderForm(f => ({ ...f, note: e.target.value }))}
            placeholder="Additional notes..."
            rows={2}
            className="w-full px-3 py-2 bg-gray-750 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 text-sm resize-none"
          />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-gray-400 text-xs mb-1">Due Date *</label>
              <input
                type="date"
                required
                value={reminderForm.due_date}
                onChange={e => setReminderForm(f => ({ ...f, due_date: e.target.value }))}
                className="w-full px-3 py-2 bg-gray-750 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500 text-sm"
                style={{ colorScheme: 'dark' }}
              />
            </div>
            <div>
              <label className="block text-gray-400 text-xs mb-1">Time (optional)</label>
              <input
                type="time"
                value={reminderForm.due_time}
                onChange={e => setReminderForm(f => ({ ...f, due_time: e.target.value }))}
                className="w-full px-3 py-2 bg-gray-750 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500 text-sm"
                style={{ colorScheme: 'dark' }}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowAddReminder(false)}
              className="flex-1 px-3 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={savingReminder}
              className="flex-1 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 text-sm"
            >
              {savingReminder ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      )}

      {/* Reminders List */}
      {reminders.length === 0 ? (
        <div className="text-center py-8">
          <Bell className="w-8 h-8 text-gray-600 mx-auto mb-2" />
          <p className="text-gray-400 text-sm">No reminders</p>
        </div>
      ) : (
        <div className="space-y-2">
          {reminders.map(r => {
            const isDue = !r.completed && r.due_date <= today;
            return (
              <div
                key={r.id}
                className={`p-3 rounded-lg border ${
                  r.completed
                    ? 'bg-gray-800/50 border-gray-700/50'
                    : isDue
                      ? 'bg-red-900/20 border-red-800/50'
                      : 'bg-gray-800 border-gray-700'
                }`}
              >
                <div className="flex items-start gap-3">
                  <button
                    onClick={() => handleToggleReminder(r)}
                    className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center ${
                      r.completed
                        ? 'bg-green-600 border-green-600'
                        : isDue
                          ? 'border-red-500 hover:bg-red-900/30'
                          : 'border-gray-500 hover:bg-gray-700'
                    }`}
                  >
                    {r.completed && <Check className="w-3 h-3 text-white" />}
                  </button>
                  <div className="flex-1">
                    <p className={`text-sm font-medium ${r.completed ? 'text-gray-500 line-through' : 'text-white'}`}>
                      {r.title}
                    </p>
                    {r.note && <p className="text-xs text-gray-400 mt-1">{r.note}</p>}
                    <p className={`text-xs mt-1 ${isDue ? 'text-red-400' : 'text-gray-500'}`}>
                      {formatDate(r.due_date)}
                      {r.due_time && ` at ${formatTime(r.due_time)}`}
                    </p>
                  </div>
                  <button
                    onClick={() => handleDeleteReminder(r.id)}
                    className="p-1 hover:bg-gray-700 rounded text-gray-500 hover:text-red-400"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  const renderAppointmentsTab = (customerAppointments) => (
    <div className="space-y-2">
      {customerAppointments.length === 0 ? (
        <div className="text-center py-8">
          <Calendar className="w-8 h-8 text-gray-600 mx-auto mb-2" />
          <p className="text-gray-400 text-sm">No appointments</p>
        </div>
      ) : (
        customerAppointments.map(apt => (
          <div key={apt.id} className="bg-gray-800 rounded-lg p-3 border border-gray-700">
            <div className="flex items-start justify-between mb-1">
              <p className="text-white text-sm font-medium">{apt.service || 'Appointment'}</p>
              <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                apt.source === 'manual' ? 'bg-green-700 text-green-200' : 'bg-blue-700 text-blue-200'
              }`}>
                {apt.source === 'manual' ? 'Manual' : 'AI'}
              </span>
            </div>
            <p className="text-gray-300 text-xs">{formatDate(apt.date)} • {apt.time}</p>
            {apt.address && <p className="text-gray-500 text-xs mt-1">{normalizeForDisplay(apt.address)}</p>}
          </div>
        ))
      )}
    </div>
  );

  // ============ RENDER: Customer List ============
  const renderCustomerList = () => (
    <div className="space-y-4">
      {/* Header with Reminders button */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-white">Customers</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowRemindersPanel(true)}
            className="relative flex items-center gap-1.5 px-3 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-700 border border-gray-700 text-sm"
          >
            <Bell className="w-4 h-4" />
            <span className="hidden sm:inline">Reminders</span>
            {dueReminders.length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-600 text-white rounded-full text-[10px] font-bold flex items-center justify-center">
                {dueReminders.length}
              </span>
            )}
          </button>
          <button
            onClick={fetchCustomers}
            className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
          >
            <RefreshCw className="w-4 h-4" />
            <span className="hidden sm:inline">Refresh</span>
          </button>
          <button
            onClick={() => { closeModal(); setShowAddModal(true); }}
            className="flex items-center gap-1.5 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Add</span>
          </button>
        </div>
      </div>

      {/* Due Reminders Banner */}
      {dueReminders.length > 0 && (
        <div
          onClick={() => setShowRemindersPanel(true)}
          className="p-3 bg-red-900/30 border border-red-800/50 rounded-lg cursor-pointer hover:bg-red-900/40 transition-colors"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
            <p className="text-red-300 text-sm font-medium">
              {dueReminders.length} follow-up{dueReminders.length > 1 ? 's' : ''} due today or overdue
            </p>
            <ChevronRight className="w-4 h-4 text-red-400 ml-auto flex-shrink-0" />
          </div>
          <div className="mt-1.5 space-y-1">
            {dueReminders.slice(0, 2).map(r => (
              <p key={r.id} className="text-red-200/70 text-xs ml-6">
                • {r.title} {r.customers?.name && `— ${r.customers.name}`}
              </p>
            ))}
            {dueReminders.length > 2 && (
              <p className="text-red-200/50 text-xs ml-6">
                + {dueReminders.length - 2} more
              </p>
            )}
          </div>
        </div>
      )}

      {/* Search and Tag Filter */}
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search by name or phone…"
            className="w-full pl-9 pr-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 text-sm"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </div>
        {getAllTags().length > 0 && (
          <select
            value={filterTag}
            onChange={e => setFilterTag(e.target.value)}
            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
            style={{ colorScheme: 'dark' }}
          >
            <option value="">All Tags</option>
            {getAllTags().map(tag => (
              <option key={tag} value={tag}>{tag}</option>
            ))}
          </select>
        )}
      </div>

      {/* Customer Count */}
      <p className="text-gray-500 text-xs">{filteredCustomers.length} customer{filteredCustomers.length !== 1 ? 's' : ''}</p>

      {/* Customer List */}
      {loading ? (
        <div className="text-center py-12">
          <RefreshCw className="w-8 h-8 animate-spin text-blue-500 mx-auto mb-4" />
          <p className="text-gray-400">Loading customers...</p>
        </div>
      ) : filteredCustomers.length === 0 ? (
        <div className="text-center py-12">
          <User className="w-10 h-10 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">
            {searchTerm || filterTag ? 'No customers match your search' : 'No customers yet'}
          </p>
          {!searchTerm && !filterTag && (
            <p className="text-gray-500 text-xs mt-1">
              Customers are automatically created from appointments
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filteredCustomers.map(customer => {
            const customerApts = getCustomerAppointments(customer);
            const aptCount = customerApts.length;
            const lastAptDate = getLastAptDate(customer);
            // Filter system tags from card display
            const displayTags = (customer.tags || []).filter(t => !SYSTEM_TAGS.has(t));

            return (
              <div
                key={customer.id}
                onClick={() => openCustomerProfile(customer)}
                className="bg-gray-800 rounded-lg p-3 border border-gray-700 cursor-pointer hover:bg-gray-750 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium truncate">{customer.name}</p>
                    {customer.address && (
                      <p className="text-gray-300 text-xs truncate mt-0.5">
                        {normalizeForDisplay(customer.address)}
                      </p>
                    )}
                    {customer.phone && (
                      <p className="text-gray-400 text-xs mt-0.5">{customer.phone}</p>
                    )}
                    <div className="flex items-center gap-1.5 mt-1">
                      {lastAptDate && (
                        <p className="text-blue-400 text-xs">
                          Last appt: {formatDate(lastAptDate)}
                        </p>
                      )}
                      {aptCount > 0 && (
                        <p className="text-gray-500 text-xs">
                          · {aptCount} appt{aptCount !== 1 ? 's' : ''}
                        </p>
                      )}
                    </div>
                    {displayTags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {displayTags.slice(0, 3).map(tag => {
                          const color = getTagColor(tag);
                          return (
                            <span
                              key={tag}
                              className={`px-1.5 py-0.5 rounded text-[10px] ${color.bg} ${color.text}`}
                            >
                              {tag}
                            </span>
                          );
                        })}
                        {displayTags.length > 3 && (
                          <span className="text-gray-500 text-[10px]">+{displayTags.length - 3}</span>
                        )}
                      </div>
                    )}
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-500 flex-shrink-0" />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  // ============ RENDER: Add/Edit Customer Modal ============
  const renderModal = () => (
    showAddModal && (
      <div className="fixed inset-0 bg-black/70 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
        <div className="bg-gray-800 border border-gray-700 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[92vh] overflow-y-auto">
          <div className="flex items-center justify-between p-4 border-b border-gray-700 sticky top-0 bg-gray-800 rounded-t-2xl">
            <h2 className="text-lg font-semibold text-white">
              {editingCustomer ? 'Edit Customer' : 'Add Customer'}
            </h2>
            <button onClick={closeModal} className="p-2 hover:bg-gray-700 rounded-lg">
              <X className="w-5 h-5 text-gray-400" />
            </button>
          </div>

          <form onSubmit={handleSaveCustomer} className="p-4 space-y-4">
            <div>
              <label className="block text-gray-400 text-sm mb-1">Name <span className="text-red-400">*</span></label>
              <input
                type="text"
                required
                value={customerForm.name}
                onChange={e => setCustomerForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Full name"
                className="w-full px-3 py-2 bg-gray-750 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 text-sm"
              />
            </div>
            <div>
              <label className="block text-gray-400 text-sm mb-1">Phone</label>
              <input
                type="tel"
                value={customerForm.phone}
                onChange={e => setCustomerForm(f => ({ ...f, phone: e.target.value }))}
                placeholder="(555) 555-5555"
                className="w-full px-3 py-2 bg-gray-750 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 text-sm"
              />
            </div>
            <div>
              <label className="block text-gray-400 text-sm mb-1">Email</label>
              <input
                type="email"
                value={customerForm.email}
                onChange={e => setCustomerForm(f => ({ ...f, email: e.target.value }))}
                placeholder="email@example.com"
                className="w-full px-3 py-2 bg-gray-750 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 text-sm"
              />
            </div>
            <div>
              <label className="block text-gray-400 text-sm mb-1">Address</label>
              <input
                type="text"
                value={customerForm.address}
                onChange={e => setCustomerForm(f => ({ ...f, address: e.target.value }))}
                placeholder="Full address"
                className="w-full px-3 py-2 bg-gray-750 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 text-sm"
              />
            </div>

            {/* Tags */}
            <div>
              <label className="block text-gray-400 text-sm mb-1">Tags</label>
              <div className="flex gap-2 mb-2">
                <input
                  type="text"
                  value={tagInput}
                  onChange={e => setTagInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddTag(); } }}
                  placeholder="Add tag..."
                  className="flex-1 px-3 py-2 bg-gray-750 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 text-sm"
                />
                <button
                  type="button"
                  onClick={handleAddTag}
                  className="px-3 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 text-sm"
                >
                  Add
                </button>
              </div>
              {customerForm.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {customerForm.tags.map(tag => {
                    const color = getTagColor(tag);
                    return (
                      <span
                        key={tag}
                        className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs ${color.bg} ${color.text} border ${color.border}`}
                      >
                        {tag}
                        <button
                          type="button"
                          onClick={() => handleRemoveTag(tag)}
                          className="hover:opacity-70"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={closeModal}
                className="flex-1 px-4 py-3 bg-gray-700 text-white rounded-lg hover:bg-gray-600 text-sm font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex-1 px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium disabled:opacity-50"
              >
                {saving ? 'Saving...' : editingCustomer ? 'Save Changes' : 'Add Customer'}
              </button>
            </div>
          </form>
        </div>
      </div>
    )
  );

  // ============ MAIN RENDER ============
  return (
    <div>
      {showRemindersPanel
        ? renderRemindersPanel()
        : selectedCustomer
          ? renderCustomerProfile()
          : renderCustomerList()
      }
      {renderModal()}
    </div>
  );
};

export default Customers;
