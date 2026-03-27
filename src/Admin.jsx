import React, { useState, useEffect } from 'react';
import { Users, Plus, Edit, Trash2, Save, X, RefreshCw, ArrowLeft, Mail, Check, UserPlus, TrendingUp } from 'lucide-react';
import { supabase } from './supabaseClient';
import AdminSalesPanel from './pages/AdminSalesPanel';

const Admin = ({ onBack, session }) => {
  const [adminTab, setAdminTab] = useState('clients');

  // Shared state
  const [allRecords, setAllRecords] = useState([]); // all clients table rows
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const [sendingInvite, setSendingInvite] = useState(null);
  const [activationSending, setActivationSending] = useState({});
  const [activationStatus, setActivationStatus] = useState({});

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
    company_name: '', email: '', phone: '', commission_option: 1
  });

  // Derived lists
  const clientsOnly = allRecords.filter(c => c.role !== 'sales_rep' && c.role !== 'admin');
  const repsOnly = allRecords.filter(c => c.role === 'sales_rep');

  useEffect(() => {
    fetchAllRecords();
  }, []);

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
        setSuccessMessage("Client added successfully.");
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
      commission_option: rep.commission_option || 1,
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
            commission_option: repForm.commission_option,
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
            is_sales_rep: true,
            commission_option: repForm.commission_option,
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

  const handleSendRepInvite = async (record) => {
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

  const handleResendRepInvite = async (record) => {
    if (!confirm(`Resend invite to ${record.email}?`)) return;
    await handleSendRepInvite(record);
  };

  const handleResendOnboardingLink = async (client) => {
    setSendingInvite(client.id);
    setError(null);
    try {
      const { data: deal, error: dealError } = await supabase
        .from('deals')
        .select('id')
        .eq('client_email', client.email)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (dealError || !deal) {
        setError(`No onboarding deal found for ${client.email}`);
        return;
      }

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL || 'https://zmppdmfdhknnwzwdfhwf.supabase.co'}/functions/v1/send-notification`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ template: 'onboarding_link_client', deal_id: deal.id }),
        }
      );
      if (!res.ok) throw new Error('Failed to resend onboarding link');

      await supabase
        .from('clients')
        .update({ invite_sent: true, invite_sent_at: new Date().toISOString() })
        .eq('id', client.id);

      setSuccessMessage(`Onboarding link resent to ${client.email}`);
      fetchAllRecords();
    } catch (err) {
      console.error('Error resending onboarding link:', err);
      setError(err.message || 'Failed to resend onboarding link');
    } finally { setSendingInvite(null); }
  };

  const handleSendActivationInvite = async (client) => {
    if (client.setup_complete) {
      if (!window.confirm(`Resend activation invite to ${client.email}?`)) return;
    }
    setActivationSending(prev => ({ ...prev, [client.id]: true }));
    setActivationStatus(prev => ({ ...prev, [client.id]: null }));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL || 'https://zmppdmfdhknnwzwdfhwf.supabase.co'}/functions/v1/send-activation-invite`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ client_id: client.id }),
        }
      );
      const data = await res.json();
      if (data.sent) {
        setActivationStatus(prev => ({ ...prev, [client.id]: 'sent' }));
        fetchAllRecords();
      } else if (data.error === 'setup_fee_not_paid') {
        setActivationStatus(prev => ({ ...prev, [client.id]: 'fee_not_paid' }));
      } else {
        setActivationStatus(prev => ({ ...prev, [client.id]: 'error' }));
      }
    } catch (err) {
      console.error('Activation invite error:', err);
      setActivationStatus(prev => ({ ...prev, [client.id]: 'error' }));
    } finally {
      setActivationSending(prev => ({ ...prev, [client.id]: false }));
    }
  };

  // ==================== RENDER HELPERS ====================

  const renderInviteButton = (record, type = 'rep') => {
    if (type === 'client') {
      return (
        <button
          onClick={() => handleResendOnboardingLink(record)}
          disabled={sendingInvite === record.id}
          className="flex items-center gap-1 px-3 py-2 bg-blue-700 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 text-sm"
          title="Resend Onboarding Link"
        >
          {sendingInvite === record.id ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
          <span className="hidden sm:inline">Resend Onboarding Link</span>
        </button>
      );
    }
    // Rep invite
    return !record.invite_sent ? (
      <button
        onClick={() => handleSendRepInvite(record)}
        disabled={sendingInvite === record.id}
        className="flex items-center gap-1 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 text-sm"
        title="Send Invite"
      >
        {sendingInvite === record.id ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
        <span className="hidden sm:inline">Send Invite</span>
      </button>
    ) : (
      <button
        onClick={() => handleResendRepInvite(record)}
        disabled={sendingInvite === record.id}
        className="flex items-center gap-1 px-3 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-500 disabled:opacity-50 text-sm"
        title="Resend Invite"
      >
        {sendingInvite === record.id ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
        <span className="hidden sm:inline">Resend Invite</span>
      </button>
    );
  };

  const renderActivationButton = (client) => (
    <div className="mt-2">
      {!client.setup_complete ? (
        <button
          onClick={() => handleSendActivationInvite(client)}
          disabled={activationSending[client.id]}
          className="px-3 py-1 text-sm bg-green-700 hover:bg-green-600 text-white rounded disabled:opacity-50"
        >
          {activationSending[client.id] ? 'Sending...' : 'Send Activation Invite'}
        </button>
      ) : (
        <button
          onClick={() => handleSendActivationInvite(client)}
          disabled={activationSending[client.id]}
          className="px-3 py-1 text-sm bg-gray-700 hover:bg-gray-600 text-gray-300 rounded disabled:opacity-50"
        >
          {activationSending[client.id] ? 'Sending...' : 'Resend Activation'}
        </button>
      )}
      {activationStatus[client.id] === 'sent' && (
        <span className="text-green-400 text-xs ml-2">Invite sent!</span>
      )}
      {activationStatus[client.id] === 'fee_not_paid' && (
        <span className="text-red-400 text-xs ml-2">Setup fee not yet paid</span>
      )}
      {activationStatus[client.id] === 'error' && (
        <span className="text-red-400 text-xs ml-2">Error — try again</span>
      )}
    </div>
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
        </div>
      </div>

      {/* Tab Navigation */}
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
            adminTab === 'sales' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'
          }`}
        >
          <TrendingUp className="w-4 h-4" /> Sales
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
                <p className="text-blue-300 text-xs">After adding the client, use "Resend Onboarding Link" to resend their onboarding email if needed.</p>
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
              <div>
                <label className="block text-gray-400 text-sm mb-1">Commission Option *</label>
                <select
                  value={repForm.commission_option}
                  onChange={(e) => setRepForm({ ...repForm, commission_option: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 bg-gray-750 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                >
                  <option value={1}>Option 1 — Full Upfront</option>
                  <option value={2}>Option 2 — Split + Residual</option>
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  Option 1: rep receives full monthly plan price as a one-time payment.
                  Option 2: 50% upfront + 10% residual for 12 months.
                </p>
              </div>
              {error && <p className="text-red-400 text-sm">{error}</p>}
              <div className="flex gap-3 pt-2">
                <button onClick={resetRepForm} className="flex-1 px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600">Cancel</button>
                <button onClick={handleSaveRep} disabled={saving || !repForm.email || !repForm.company_name || !repForm.commission_option}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50">
                  {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
            {!editingRep && (
              <div className="mt-4 p-3 bg-teal-900/30 border border-teal-700 rounded-lg">
                <p className="text-teal-300 text-xs">After adding the rep, click "Send Invite" to email them a link to set their password and access the demo dashboard.</p>
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
                  {renderInviteButton(client, 'client')}
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
              {renderActivationButton(client)}
            </div>
          ))}
        </div>
      ))}

      {/* ==================== SALES TAB ==================== */}
      {adminTab === 'sales' && (
        <AdminSalesPanel session={session} />
      )}

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
          <p className="text-gray-500 text-sm mb-4">Add a rep and send them an invite. They'll get access to the demo dashboard to show prospects.</p>
          <button onClick={() => setShowRepForm(true)}
            className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700">
            Add Your First Rep
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {repsOnly.map(rep => (
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
          ))}
        </div>
      ))}
    </div>
  );
};

export default Admin;
