import React, { useState, useEffect } from 'react';
import { Users, Plus, Edit, Trash2, Save, X, RefreshCw, ArrowLeft, Mail, Check, DollarSign, TrendingUp, Building, Phone as PhoneIcon, UserPlus } from 'lucide-react';
import { supabase } from './supabaseClient';

const STAGE_LABELS = {
  new: 'New',
  contacted: 'Contacted',
  demo: 'Demo',
  signed_up: 'Signed Up',
  lost: 'Lost',
};

const STAGE_COLORS = {
  new: 'bg-blue-900/60 text-blue-300',
  contacted: 'bg-yellow-900/60 text-yellow-300',
  demo: 'bg-purple-900/60 text-purple-300',
  signed_up: 'bg-green-900/60 text-green-300',
  lost: 'bg-red-900/60 text-red-300',
};

const COMMISSION_STATUS_COLORS = {
  pending: 'bg-yellow-900/60 text-yellow-300',
  owed: 'bg-orange-900/60 text-orange-300',
  paid: 'bg-green-900/60 text-green-300',
};

const Admin = ({ onBack }) => {
  const [adminTab, setAdminTab] = useState('clients');

  // Shared state
  const [allRecords, setAllRecords] = useState([]); // all clients table rows
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const [sendingInvite, setSendingInvite] = useState(null);

  // Client form state
  const [showClientForm, setShowClientForm] = useState(false);
  const [editingClient, setEditingClient] = useState(null);
  const [clientForm, setClientForm] = useState({
    company_name: '', email: '', phone: '', retell_agent_id: '', retell_api_key: ''
  });

  // Rep form state
  const [showRepForm, setShowRepForm] = useState(false);
  const [editingRep, setEditingRep] = useState(null);
  const [repForm, setRepForm] = useState({
    company_name: '', email: '', phone: ''
  });

  // Sales data state
  const [allLeads, setAllLeads] = useState([]);
  const [allCommissions, setAllCommissions] = useState([]);
  const [salesLoading, setSalesLoading] = useState(false);
  const [repFilter, setRepFilter] = useState('all');
  const [editingLead, setEditingLead] = useState(null);
  const [editLeadForm, setEditLeadForm] = useState({});

  // Derived lists
  const clientsOnly = allRecords.filter(c => c.role !== 'sales_rep' && c.role !== 'admin');
  const repsOnly = allRecords.filter(c => c.role === 'sales_rep');
  const repNameMap = Object.fromEntries(allRecords.map(c => [c.id, c.company_name || c.email]));

  useEffect(() => {
    fetchAllRecords();
  }, []);

  useEffect(() => {
    if (adminTab === 'sales') {
      fetchSalesData();
    }
  }, [adminTab]);

  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  const fetchAllRecords = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setAllRecords(data || []);
    } catch (err) {
      console.error('Error fetching records:', err);
      setError('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  // ==================== CLIENT HANDLERS ====================

  const resetClientForm = () => {
    setClientForm({ company_name: '', email: '', phone: '', retell_agent_id: '', retell_api_key: '' });
    setEditingClient(null);
    setShowClientForm(false);
    setError(null);
  };

  const handleEditClient = (client) => {
    setClientForm({
      company_name: client.company_name || '',
      email: client.email || '',
      phone: client.phone || '',
      retell_agent_id: client.retell_agent_id || '',
      retell_api_key: client.retell_api_key || '',
    });
    setEditingClient(client);
    setShowClientForm(true);
  };

  const handleSaveClient = async () => {
    setSaving(true);
    setError(null);
    try {
      if (editingClient) {
        const { error } = await supabase
          .from('clients')
          .update({
            company_name: clientForm.company_name,
            phone: clientForm.phone,
            retell_agent_id: clientForm.retell_agent_id,
            retell_api_key: clientForm.retell_api_key,
          })
          .eq('id', editingClient.id);
        if (error) throw error;
        setSuccessMessage('Client updated successfully');
      } else {
        const { data: existing } = await supabase
          .from('clients')
          .select('id')
          .eq('email', clientForm.email.trim().toLowerCase())
          .maybeSingle();
        if (existing) { setError('A user with this email already exists.'); setSaving(false); return; }

        const { error } = await supabase
          .from('clients')
          .insert([{
            email: clientForm.email.trim().toLowerCase(),
            company_name: clientForm.company_name,
            phone: clientForm.phone,
            retell_agent_id: clientForm.retell_agent_id,
            retell_api_key: clientForm.retell_api_key,
            role: 'client',
            is_admin: false,
            invite_sent: false,
          }]);
        if (error) throw error;
        setSuccessMessage("Client added! Click 'Send Invite' to email them.");
      }
      resetClientForm();
      fetchAllRecords();
    } catch (err) {
      console.error('Error saving client:', err);
      setError(err.message || 'Failed to save');
    } finally { setSaving(false); }
  };

  // ==================== REP HANDLERS ====================

  const resetRepForm = () => {
    setRepForm({ company_name: '', email: '', phone: '' });
    setEditingRep(null);
    setShowRepForm(false);
    setError(null);
  };

  const handleEditRep = (rep) => {
    setRepForm({
      company_name: rep.company_name || '',
      email: rep.email || '',
      phone: rep.phone || '',
    });
    setEditingRep(rep);
    setShowRepForm(true);
  };

  const handleSaveRep = async () => {
    setSaving(true);
    setError(null);
    try {
      if (editingRep) {
        const { error } = await supabase
          .from('clients')
          .update({
            company_name: repForm.company_name,
            phone: repForm.phone,
          })
          .eq('id', editingRep.id);
        if (error) throw error;
        setSuccessMessage('Rep updated successfully');
      } else {
        const { data: existing } = await supabase
          .from('clients')
          .select('id')
          .eq('email', repForm.email.trim().toLowerCase())
          .maybeSingle();
        if (existing) { setError('A user with this email already exists.'); setSaving(false); return; }

        const { error } = await supabase
          .from('clients')
          .insert([{
            email: repForm.email.trim().toLowerCase(),
            company_name: repForm.company_name,
            phone: repForm.phone,
            role: 'sales_rep',
            is_admin: false,
            invite_sent: false,
          }]);
        if (error) throw error;
        setSuccessMessage("Sales rep added! Click 'Send Invite' to email them.");
      }
      resetRepForm();
      fetchAllRecords();
    } catch (err) {
      console.error('Error saving rep:', err);
      setError(err.message || 'Failed to save');
    } finally { setSaving(false); }
  };

  // ==================== SHARED HANDLERS ====================

  const handleDelete = async (record) => {
    const label = record.role === 'sales_rep' ? 'sales rep' : 'client';
    if (!confirm(`Are you sure you want to delete ${record.company_name || record.email}?`)) return;
    try {
      const { error } = await supabase.from('clients').delete().eq('id', record.id);
      if (error) throw error;
      setSuccessMessage(`${label.charAt(0).toUpperCase() + label.slice(1)} deleted`);
      fetchAllRecords();
    } catch (err) {
      console.error('Error deleting:', err);
      setError('Failed to delete');
    }
  };

  const handleSendInvite = async (record) => {
    setSendingInvite(record.id);
    setError(null);
    try {
      const tempPassword = Math.random().toString(36).slice(-12) + 'A1!';
      const { error: signUpError } = await supabase.auth.signUp({
        email: record.email,
        password: tempPassword,
        options: { data: { company_name: record.company_name } }
      });
      if (signUpError && !signUpError.message.includes('already registered')) throw signUpError;

      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        record.email,
        { redirectTo: `${window.location.origin}/reset-password` }
      );
      if (resetError) throw resetError;

      await supabase
        .from('clients')
        .update({ invite_sent: true, invite_sent_at: new Date().toISOString() })
        .eq('id', record.id);

      setSuccessMessage(`Invite sent to ${record.email}`);
      fetchAllRecords();
    } catch (err) {
      console.error('Error sending invite:', err);
      setError(err.message || 'Failed to send invite');
    } finally { setSendingInvite(null); }
  };

  const handleResendInvite = async (record) => {
    if (!confirm(`Resend invite to ${record.email}?`)) return;
    await handleSendInvite(record);
  };

  // ==================== SALES DATA HANDLERS ====================

  const fetchSalesData = async () => {
    setSalesLoading(true);
    try {
      const [leadsRes, commissionsRes] = await Promise.all([
        supabase.from('leads').select('*').order('created_at', { ascending: false }),
        supabase.from('commissions').select('*').order('created_at', { ascending: false }),
      ]);
      if (!leadsRes.error) setAllLeads(leadsRes.data || []);
      if (!commissionsRes.error) setAllCommissions(commissionsRes.data || []);
    } finally { setSalesLoading(false); }
  };

  const filteredSalesLeads = repFilter === 'all'
    ? allLeads
    : allLeads.filter(l => l.sales_rep_id === parseInt(repFilter));

  const filteredCommissions = repFilter === 'all'
    ? allCommissions
    : allCommissions.filter(c => c.sales_rep_id === parseInt(repFilter));

  const salesStats = {
    totalReps: repsOnly.length,
    totalLeads: allLeads.length,
    totalConversions: allLeads.filter(l => l.stage === 'signed_up').length,
    commissionsOwed: allCommissions.filter(c => c.status === 'pending' || c.status === 'owed').reduce((s, c) => s + Number(c.amount), 0),
    commissionsPaid: allCommissions.filter(c => c.status === 'paid').reduce((s, c) => s + Number(c.amount), 0),
  };

  const handleCommissionStatusChange = async (commissionId, newStatus) => {
    const updates = { status: newStatus };
    if (newStatus === 'paid') updates.paid_at = new Date().toISOString();
    const { error } = await supabase.from('commissions').update(updates).eq('id', commissionId);
    if (!error) { setSuccessMessage(`Commission marked as ${newStatus}`); fetchSalesData(); }
  };

  const handleAdminEditLead = async (leadId) => {
    if (!editLeadForm.contact_name?.trim()) return;
    setSaving(true);
    const { error } = await supabase
      .from('leads')
      .update({
        contact_name: editLeadForm.contact_name,
        company_name: editLeadForm.company_name || null,
        email: editLeadForm.email || null,
        phone: editLeadForm.phone || null,
        stage: editLeadForm.stage,
        notes: editLeadForm.notes || null,
        next_follow_up: editLeadForm.next_follow_up || null,
      })
      .eq('id', leadId);
    if (!error) { setSuccessMessage('Lead updated'); setEditingLead(null); fetchSalesData(); }
    setSaving(false);
  };

  // ==================== RENDER HELPERS ====================

  const renderInviteButton = (record) => (
    !record.invite_sent ? (
      <button
        onClick={() => handleSendInvite(record)}
        disabled={sendingInvite === record.id}
        className="flex items-center gap-1 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 text-sm"
        title="Send Invite"
      >
        {sendingInvite === record.id ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
        <span className="hidden sm:inline">Send Invite</span>
      </button>
    ) : (
      <button
        onClick={() => handleResendInvite(record)}
        disabled={sendingInvite === record.id}
        className="flex items-center gap-1 px-3 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-500 disabled:opacity-50 text-sm"
        title="Resend Invite"
      >
        {sendingInvite === record.id ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
        <span className="hidden sm:inline">Resend</span>
      </button>
    )
  );

  // ==================== MAIN RENDER ====================

  return (
    <div className="min-h-screen bg-gray-900 p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 hover:bg-gray-800 rounded-lg">
            <ArrowLeft className="w-5 h-5 text-gray-400" />
          </button>
          <h1 className="text-2xl font-bold text-white">Admin</h1>
        </div>
        <div className="flex gap-2">
          {adminTab === 'clients' && (
            <>
              <button
                onClick={fetchAllRecords}
                className="flex items-center gap-2 px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-700 border border-gray-700"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                <span className="hidden sm:inline">Refresh</span>
              </button>
              <button
                onClick={() => setShowClientForm(true)}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                <Plus className="w-4 h-4" />
                <span className="hidden sm:inline">Add Client</span>
              </button>
            </>
          )}
          {adminTab === 'reps' && (
            <>
              <button
                onClick={fetchAllRecords}
                className="flex items-center gap-2 px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-700 border border-gray-700"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                <span className="hidden sm:inline">Refresh</span>
              </button>
              <button
                onClick={() => setShowRepForm(true)}
                className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700"
              >
                <UserPlus className="w-4 h-4" />
                <span className="hidden sm:inline">Add Rep</span>
              </button>
            </>
          )}
          {adminTab === 'sales' && (
            <button
              onClick={fetchSalesData}
              className="flex items-center gap-2 px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-700 border border-gray-700"
            >
              <RefreshCw className={`w-4 h-4 ${salesLoading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          )}
        </div>
      </div>

      {/* Tab Navigation — 3 tabs */}
      <div className="flex gap-1 mb-6 bg-gray-800 rounded-lg p-1 border border-gray-700">
        <button
          onClick={() => setAdminTab('clients')}
          className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
            adminTab === 'clients' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
          }`}
        >
          <Users className="w-4 h-4" /> Clients
        </button>
        <button
          onClick={() => setAdminTab('reps')}
          className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
            adminTab === 'reps' ? 'bg-teal-600 text-white' : 'text-gray-400 hover:text-white'
          }`}
        >
          <UserPlus className="w-4 h-4" /> Reps
        </button>
        <button
          onClick={() => setAdminTab('sales')}
          className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
            adminTab === 'sales' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
          }`}
        >
          <TrendingUp className="w-4 h-4" /> Sales Data
        </button>
      </div>

      {/* Success / Error Messages */}
      {successMessage && (
        <div className="mb-4 p-3 bg-green-900/50 border border-green-700 rounded-lg flex items-center gap-2">
          <Check className="w-4 h-4 text-green-400" />
          <p className="text-green-300 text-sm">{successMessage}</p>
        </div>
      )}
      {error && (
        <div className="mb-4 p-3 bg-red-900/50 border border-red-700 rounded-lg">
          <p className="text-red-300 text-sm">{error}</p>
        </div>
      )}

      {/* ==================== CLIENT ADD/EDIT MODAL ==================== */}
      {showClientForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-white">
                {editingClient ? 'Edit Client' : 'Add New Client'}
              </h2>
              <button onClick={resetClientForm} className="p-1 hover:bg-gray-700 rounded">
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-gray-400 text-sm mb-1">Company Name</label>
                <input type="text" value={clientForm.company_name}
                  onChange={(e) => setClientForm({ ...clientForm, company_name: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-750 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                  placeholder="ABC Company" />
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-1">Email *</label>
                <input type="email" value={clientForm.email}
                  onChange={(e) => setClientForm({ ...clientForm, email: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-750 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                  placeholder="client@example.com" required disabled={!!editingClient} />
                {editingClient && <p className="text-xs text-gray-500 mt-1">Email cannot be changed after creation</p>}
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-1">Phone Number</label>
                <input type="tel" value={clientForm.phone}
                  onChange={(e) => setClientForm({ ...clientForm, phone: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-750 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                  placeholder="(555) 123-4567" />
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-1">Retell Agent ID</label>
                <input type="text" value={clientForm.retell_agent_id}
                  onChange={(e) => setClientForm({ ...clientForm, retell_agent_id: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-750 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                  placeholder="agent_xxxxx" />
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-1">Retell API Key</label>
                <input type="text" value={clientForm.retell_api_key}
                  onChange={(e) => setClientForm({ ...clientForm, retell_api_key: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-750 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                  placeholder="key_xxxxx" />
              </div>
              {error && <p className="text-red-400 text-sm">{error}</p>}
              <div className="flex gap-3 pt-2">
                <button onClick={resetClientForm} className="flex-1 px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600">Cancel</button>
                <button onClick={handleSaveClient} disabled={saving || !clientForm.email}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                  {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
            {!editingClient && (
              <div className="mt-4 p-3 bg-blue-900/30 border border-blue-700 rounded-lg">
                <p className="text-blue-300 text-xs">After adding the client, click "Send Invite" to email them a link to set their password.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================== REP ADD/EDIT MODAL ==================== */}
      {showRepForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-white">
                {editingRep ? 'Edit Sales Rep' : 'Add New Sales Rep'}
              </h2>
              <button onClick={resetRepForm} className="p-1 hover:bg-gray-700 rounded">
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-gray-400 text-sm mb-1">Full Name *</label>
                <input type="text" value={repForm.company_name}
                  onChange={(e) => setRepForm({ ...repForm, company_name: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-750 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                  placeholder="Jane Smith" />
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-1">Email *</label>
                <input type="email" value={repForm.email}
                  onChange={(e) => setRepForm({ ...repForm, email: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-750 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                  placeholder="jane@example.com" required disabled={!!editingRep} />
                {editingRep && <p className="text-xs text-gray-500 mt-1">Email cannot be changed after creation</p>}
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-1">Phone Number</label>
                <input type="tel" value={repForm.phone}
                  onChange={(e) => setRepForm({ ...repForm, phone: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-750 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                  placeholder="(555) 123-4567" />
              </div>
              {error && <p className="text-red-400 text-sm">{error}</p>}
              <div className="flex gap-3 pt-2">
                <button onClick={resetRepForm} className="flex-1 px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600">Cancel</button>
                <button onClick={handleSaveRep} disabled={saving || !repForm.email || !repForm.company_name}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50">
                  {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
            {!editingRep && (
              <div className="mt-4 p-3 bg-teal-900/30 border border-teal-700 rounded-lg">
                <p className="text-teal-300 text-xs">After adding the rep, click "Send Invite" to email them a link to set their password and access the sales dashboard.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================== CLIENTS TAB ==================== */}
      {adminTab === 'clients' && (loading ? (
        <div className="text-center py-12">
          <RefreshCw className="w-8 h-8 animate-spin text-blue-500 mx-auto mb-4" />
          <p className="text-gray-400">Loading clients...</p>
        </div>
      ) : clientsOnly.length === 0 ? (
        <div className="bg-gray-800 rounded-lg p-8 border border-gray-700 text-center">
          <Users className="w-12 h-12 text-gray-600 mx-auto mb-4" />
          <p className="text-gray-400">No clients yet</p>
          <button onClick={() => setShowClientForm(true)}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
            Add Your First Client
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {clientsOnly.map(client => (
            <div key={client.id} className="bg-gray-800 rounded-lg border border-gray-700 p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <p className="font-medium text-white">{client.company_name || 'No company name'}</p>
                    {(client.role === 'admin' || client.is_admin) && (
                      <span className="px-2 py-0.5 bg-purple-900 text-purple-300 rounded text-xs">Admin</span>
                    )}
                    {/* Account status badge */}
                    {(() => {
                      const status = client.subscription_status;
                      if (status === 'active' || status === 'trialing')
                        return <span className="px-2 py-0.5 bg-blue-900 text-blue-300 rounded text-xs">Active</span>;
                      if (status === 'past_due')
                        return <span className="px-2 py-0.5 bg-red-900 text-red-300 rounded text-xs">Past Due</span>;
                      if (status === 'canceled' || status === 'cancelled')
                        return <span className="px-2 py-0.5 bg-red-900 text-red-300 rounded text-xs">Canceled</span>;
                      if (client.invite_sent)
                        return <span className="px-2 py-0.5 bg-green-900 text-green-300 rounded text-xs">Invited</span>;
                      return <span className="px-2 py-0.5 bg-yellow-900 text-yellow-300 rounded text-xs">Not Invited</span>;
                    })()}
                    {/* Plan tier badge */}
                    {client.stripe_price_id && (
                      client.stripe_price_id === 'price_1T7BLkJVgG4IIGoFRdPuSpS9'
                        ? <span className="px-2 py-0.5 bg-amber-900 text-amber-300 rounded text-xs">Pro</span>
                        : <span className="px-2 py-0.5 bg-cyan-900 text-cyan-300 rounded text-xs">Standard</span>
                    )}
                    {client.subscription_status && client.subscription_status !== 'inactive' && (
                      <span className="text-xs text-gray-500">
                        {client.current_period_end && (
                          <>
                            {client.subscription_status === 'canceled' || client.subscription_status === 'cancelled'
                              ? `Expires: ${new Date(client.current_period_end).toLocaleDateString()}`
                              : client.subscription_status === 'past_due'
                                ? `Due: ${new Date(client.current_period_end).toLocaleDateString()}`
                                : `Renews: ${new Date(client.current_period_end).toLocaleDateString()}`}
                          </>
                        )}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-400">{client.email}</p>
                  {client.phone && <p className="text-xs text-gray-500 mt-1">{client.phone}</p>}
                  {client.retell_agent_id && <p className="text-xs text-gray-500 mt-1">Agent: {client.retell_agent_id}</p>}
                </div>
                <div className="flex gap-2">
                  {renderInviteButton(client)}
                  <button onClick={() => handleEditClient(client)} className="p-2 hover:bg-gray-700 rounded-lg" title="Edit">
                    <Edit className="w-4 h-4 text-gray-400" />
                  </button>
                  <button onClick={() => handleDelete(client)} className="p-2 hover:bg-gray-700 rounded-lg" title="Delete">
                    <Trash2 className="w-4 h-4 text-red-400" />
                  </button>
                </div>
              </div>
              <div className="flex gap-4 mt-2">
                <p className="text-xs text-gray-600">Created: {new Date(client.created_at).toLocaleDateString()}</p>
                {client.invite_sent_at && (
                  <p className="text-xs text-gray-600">Invited: {new Date(client.invite_sent_at).toLocaleDateString()}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      ))}

      {/* ==================== REPS TAB ==================== */}
      {adminTab === 'reps' && (loading ? (
        <div className="text-center py-12">
          <RefreshCw className="w-8 h-8 animate-spin text-teal-500 mx-auto mb-4" />
          <p className="text-gray-400">Loading sales reps...</p>
        </div>
      ) : repsOnly.length === 0 ? (
        <div className="bg-gray-800 rounded-lg p-8 border border-gray-700 text-center">
          <UserPlus className="w-12 h-12 text-gray-600 mx-auto mb-4" />
          <p className="text-gray-400 mb-2">No sales reps yet</p>
          <p className="text-gray-500 text-sm mb-4">Add a rep and send them an invite. They'll get their own sales dashboard to track leads and commissions.</p>
          <button onClick={() => setShowRepForm(true)}
            className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700">
            Add Your First Rep
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {repsOnly.map(rep => {
            const repLeads = allLeads.filter(l => l.sales_rep_id === rep.id);
            const repCommissions = allCommissions.filter(c => c.sales_rep_id === rep.id);
            const activeLeads = repLeads.filter(l => !['signed_up', 'lost'].includes(l.stage)).length;
            const conversions = repLeads.filter(l => l.stage === 'signed_up').length;
            const totalOwed = repCommissions.filter(c => c.status === 'pending' || c.status === 'owed').reduce((s, c) => s + Number(c.amount), 0);
            const totalPaid = repCommissions.filter(c => c.status === 'paid').reduce((s, c) => s + Number(c.amount), 0);

            return (
              <div key={rep.id} className="bg-gray-800 rounded-lg border border-gray-700 p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <p className="font-medium text-white">{rep.company_name || 'No name'}</p>
                      <span className="px-2 py-0.5 bg-teal-900 text-teal-300 rounded text-xs">Sales Rep</span>
                      {!rep.invite_sent
                        ? <span className="px-2 py-0.5 bg-yellow-900 text-yellow-300 rounded text-xs">Not Invited</span>
                        : <span className="px-2 py-0.5 bg-green-900 text-green-300 rounded text-xs">Invited</span>
                      }
                    </div>
                    <p className="text-sm text-gray-400">{rep.email}</p>
                    {rep.phone && <p className="text-xs text-gray-500 mt-1">{rep.phone}</p>}

                    {/* Rep stats row */}
                    <div className="flex flex-wrap gap-3 mt-2">
                      <span className="text-xs text-gray-500">
                        <span className="text-blue-400 font-medium">{repLeads.length}</span> leads
                      </span>
                      <span className="text-xs text-gray-500">
                        <span className="text-yellow-400 font-medium">{activeLeads}</span> active
                      </span>
                      <span className="text-xs text-gray-500">
                        <span className="text-green-400 font-medium">{conversions}</span> conversions
                      </span>
                      {totalOwed > 0 && (
                        <span className="text-xs text-orange-400 font-medium">${totalOwed.toLocaleString()} owed</span>
                      )}
                      {totalPaid > 0 && (
                        <span className="text-xs text-green-400 font-medium">${totalPaid.toLocaleString()} paid</span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {renderInviteButton(rep)}
                    <button onClick={() => handleEditRep(rep)} className="p-2 hover:bg-gray-700 rounded-lg" title="Edit">
                      <Edit className="w-4 h-4 text-gray-400" />
                    </button>
                    <button onClick={() => handleDelete(rep)} className="p-2 hover:bg-gray-700 rounded-lg" title="Delete">
                      <Trash2 className="w-4 h-4 text-red-400" />
                    </button>
                  </div>
                </div>
                <div className="flex gap-4 mt-2">
                  <p className="text-xs text-gray-600">Added: {new Date(rep.created_at).toLocaleDateString()}</p>
                  {rep.invite_sent_at && (
                    <p className="text-xs text-gray-600">Invited: {new Date(rep.invite_sent_at).toLocaleDateString()}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}

      {/* ==================== SALES DATA TAB ==================== */}
      {adminTab === 'sales' && (
        salesLoading ? (
          <div className="text-center py-12">
            <RefreshCw className="w-8 h-8 animate-spin text-blue-500 mx-auto mb-4" />
            <p className="text-gray-400">Loading sales data...</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Sales Stats */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div className="bg-gray-800 rounded-lg p-3 text-center border border-gray-700">
                <p className="text-xl font-bold text-white">{salesStats.totalReps}</p>
                <p className="text-gray-400 text-xs">Reps</p>
              </div>
              <div className="bg-gray-800 rounded-lg p-3 text-center border border-gray-700">
                <p className="text-xl font-bold text-blue-400">{salesStats.totalLeads}</p>
                <p className="text-gray-400 text-xs">Total Leads</p>
              </div>
              <div className="bg-gray-800 rounded-lg p-3 text-center border border-gray-700">
                <p className="text-xl font-bold text-green-400">{salesStats.totalConversions}</p>
                <p className="text-gray-400 text-xs">Conversions</p>
              </div>
              <div className="bg-gray-800 rounded-lg p-3 text-center border border-gray-700">
                <p className="text-xl font-bold text-orange-400">${salesStats.commissionsOwed.toLocaleString()}</p>
                <p className="text-gray-400 text-xs">Owed</p>
              </div>
              <div className="bg-gray-800 rounded-lg p-3 text-center border border-gray-700">
                <p className="text-xl font-bold text-green-400">${salesStats.commissionsPaid.toLocaleString()}</p>
                <p className="text-gray-400 text-xs">Paid</p>
              </div>
            </div>

            {/* Rep Filter */}
            {repsOnly.length > 0 && (
              <div>
                <label className="block text-gray-400 text-sm mb-1">Filter by Rep</label>
                <select value={repFilter} onChange={(e) => setRepFilter(e.target.value)}
                  className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-blue-500 text-sm">
                  <option value="all">All Reps</option>
                  {repsOnly.map(rep => (
                    <option key={rep.id} value={rep.id}>{rep.company_name || rep.email}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Leads Section */}
            <div>
              <h2 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                <Users className="w-5 h-5 text-blue-400" /> Leads ({filteredSalesLeads.length})
              </h2>
              {filteredSalesLeads.length === 0 ? (
                <div className="bg-gray-800 rounded-lg p-6 border border-gray-700 text-center">
                  <p className="text-gray-400">No leads yet</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredSalesLeads.map(lead => (
                    <div key={lead.id} className="bg-gray-800 rounded-lg border border-gray-700 p-4">
                      {editingLead === lead.id ? (
                        <div className="space-y-3">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <input type="text" value={editLeadForm.contact_name || ''}
                              onChange={(e) => setEditLeadForm({ ...editLeadForm, contact_name: e.target.value })}
                              placeholder="Contact name"
                              className="px-3 py-2 bg-gray-750 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500" />
                            <input type="text" value={editLeadForm.company_name || ''}
                              onChange={(e) => setEditLeadForm({ ...editLeadForm, company_name: e.target.value })}
                              placeholder="Company"
                              className="px-3 py-2 bg-gray-750 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500" />
                            <input type="email" value={editLeadForm.email || ''}
                              onChange={(e) => setEditLeadForm({ ...editLeadForm, email: e.target.value })}
                              placeholder="Email"
                              className="px-3 py-2 bg-gray-750 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500" />
                            <input type="tel" value={editLeadForm.phone || ''}
                              onChange={(e) => setEditLeadForm({ ...editLeadForm, phone: e.target.value })}
                              placeholder="Phone"
                              className="px-3 py-2 bg-gray-750 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500" />
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <select value={editLeadForm.stage}
                              onChange={(e) => setEditLeadForm({ ...editLeadForm, stage: e.target.value })}
                              className="px-3 py-2 bg-gray-750 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500">
                              {Object.entries(STAGE_LABELS).map(([k, v]) => (
                                <option key={k} value={k}>{v}</option>
                              ))}
                            </select>
                            <input type="date" value={editLeadForm.next_follow_up || ''}
                              onChange={(e) => setEditLeadForm({ ...editLeadForm, next_follow_up: e.target.value })}
                              className="px-3 py-2 bg-gray-750 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500" />
                          </div>
                          <textarea value={editLeadForm.notes || ''}
                            onChange={(e) => setEditLeadForm({ ...editLeadForm, notes: e.target.value })}
                            placeholder="Notes" rows={2}
                            className="w-full px-3 py-2 bg-gray-750 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500 resize-none" />
                          <div className="flex gap-2">
                            <button onClick={() => setEditingLead(null)}
                              className="px-3 py-1.5 bg-gray-700 text-white rounded-lg text-sm hover:bg-gray-600">Cancel</button>
                            <button onClick={() => handleAdminEditLead(lead.id)} disabled={saving}
                              className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1">
                              {saving ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                              Save
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <span className="text-white font-medium">{lead.contact_name}</span>
                              {lead.company_name && (
                                <span className="text-gray-400 text-sm flex items-center gap-1">
                                  <Building className="w-3 h-3" /> {lead.company_name}
                                </span>
                              )}
                              <span className={`px-2 py-0.5 rounded text-xs font-medium ${STAGE_COLORS[lead.stage]}`}>
                                {STAGE_LABELS[lead.stage]}
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                              {lead.email && <span>{lead.email}</span>}
                              {lead.phone && <span>{lead.phone}</span>}
                              <span>Rep: {repNameMap[lead.sales_rep_id] || 'Unknown'}</span>
                              <span>{new Date(lead.created_at).toLocaleDateString()}</span>
                            </div>
                            {lead.notes && <p className="text-gray-500 text-xs mt-1 truncate">{lead.notes}</p>}
                          </div>
                          <button
                            onClick={() => {
                              setEditLeadForm({
                                contact_name: lead.contact_name || '', company_name: lead.company_name || '',
                                email: lead.email || '', phone: lead.phone || '', stage: lead.stage,
                                notes: lead.notes || '', next_follow_up: lead.next_follow_up || '',
                              });
                              setEditingLead(lead.id);
                            }}
                            className="p-2 hover:bg-gray-700 rounded-lg flex-shrink-0" title="Edit Lead">
                            <Edit className="w-4 h-4 text-gray-400" />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Commissions Section */}
            <div>
              <h2 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-green-400" /> Commissions ({filteredCommissions.length})
              </h2>
              {filteredCommissions.length === 0 ? (
                <div className="bg-gray-800 rounded-lg p-6 border border-gray-700 text-center">
                  <p className="text-gray-400">No commissions yet</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredCommissions.map(commission => {
                    const repName = repNameMap[commission.sales_rep_id] || 'Unknown';
                    return (
                      <div key={commission.id} className="bg-gray-800 rounded-lg border border-gray-700 p-4">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <span className="text-white font-medium">${Number(commission.amount).toLocaleString()}</span>
                              <span className="text-gray-400 text-sm capitalize">{(commission.plan_type || '').replace(/_/g, ' ')}</span>
                              <span className={`px-2 py-0.5 rounded text-xs font-medium ${COMMISSION_STATUS_COLORS[commission.status]}`}>
                                {commission.status.charAt(0).toUpperCase() + commission.status.slice(1)}
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                              <span>Rep: {repName}</span>
                              <span>{new Date(commission.created_at).toLocaleDateString()}</span>
                              {commission.paid_at && (
                                <span className="text-green-400">Paid {new Date(commission.paid_at).toLocaleDateString()}</span>
                              )}
                            </div>
                          </div>
                          <div className="flex gap-2 flex-shrink-0">
                            {commission.status === 'pending' && (
                              <button onClick={() => handleCommissionStatusChange(commission.id, 'owed')}
                                className="px-3 py-1.5 bg-orange-600 text-white rounded-lg text-xs hover:bg-orange-700">
                                Mark Owed
                              </button>
                            )}
                            {(commission.status === 'pending' || commission.status === 'owed') && (
                              <button onClick={() => handleCommissionStatusChange(commission.id, 'paid')}
                                className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs hover:bg-green-700">
                                Mark Paid
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )
      )}
    </div>
  );
};

export default Admin;
