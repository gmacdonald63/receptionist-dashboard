import React, { useState, useEffect } from 'react';
import { Users, DollarSign, Plus, X, Search, RefreshCw, LogOut, ChevronRight, Edit, Trash2, Save, Phone, Mail, Building, Calendar, FileText, TrendingUp, Check } from 'lucide-react';
import { supabase } from './supabaseClient';
import logo from './assets/RELIANT SUPPORT LOGO.svg';

const STAGES = ['new', 'contacted', 'demo', 'signed_up', 'lost'];

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

const COMMISSION_STATUS_LABELS = {
  pending: 'Pending',
  owed: 'Owed',
  paid: 'Paid',
};

const EMPTY_FORM = {
  contact_name: '',
  company_name: '',
  email: '',
  phone: '',
  stage: 'new',
  notes: '',
  next_follow_up: '',
};

const formatPhone = (raw) => {
  const digits = raw.replace(/\D/g, '').slice(0, 10);
  if (digits.length < 4) return digits;
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
};

const SalesDashboard = ({ clientData, onLogout }) => {
  const [activeTab, setActiveTab] = useState('pipeline');
  const [leads, setLeads] = useState([]);
  const [commissions, setCommissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stageFilter, setStageFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddLead, setShowAddLead] = useState(false);
  const [editingLead, setEditingLead] = useState(null);
  const [selectedLead, setSelectedLead] = useState(null);
  const [leadForm, setLeadForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  useEffect(() => {
    if (clientData?.id) {
      fetchData();
    }
  }, [clientData]);

  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  const fetchData = async () => {
    setLoading(true);
    try {
      await Promise.all([fetchLeads(), fetchCommissions()]);
    } finally {
      setLoading(false);
    }
  };

  const fetchLeads = async () => {
    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .eq('sales_rep_id', clientData.id)
      .order('created_at', { ascending: false });
    if (!error) setLeads(data || []);
    else console.error('Error fetching leads:', error);
  };

  const fetchCommissions = async () => {
    const { data, error } = await supabase
      .from('commissions')
      .select('*')
      .eq('sales_rep_id', clientData.id)
      .order('created_at', { ascending: false });
    if (!error) setCommissions(data || []);
    else console.error('Error fetching commissions:', error);
  };

  // Stats
  const totalLeads = leads.length;
  const activeLeads = leads.filter(l => !['signed_up', 'lost'].includes(l.stage)).length;
  const conversions = leads.filter(l => l.stage === 'signed_up').length;
  const conversionRate = totalLeads > 0 ? Math.round((conversions / totalLeads) * 100) : 0;
  const pendingCommission = commissions
    .filter(c => c.status === 'pending' || c.status === 'owed')
    .reduce((sum, c) => sum + Number(c.amount), 0);
  const totalEarned = commissions
    .filter(c => c.status === 'paid')
    .reduce((sum, c) => sum + Number(c.amount), 0);

  // Filtered leads
  const filteredLeads = leads.filter(lead => {
    const matchesStage = stageFilter === 'all' || lead.stage === stageFilter;
    const matchesSearch = !searchTerm ||
      (lead.contact_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (lead.company_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (lead.email || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (lead.phone || '').includes(searchTerm);
    return matchesStage && matchesSearch;
  });

  // Lead CRUD
  const openAddLead = () => {
    setLeadForm({ ...EMPTY_FORM });
    setEditingLead(null);
    setShowAddLead(true);
    setError(null);
  };

  const openEditLead = (lead) => {
    setLeadForm({
      contact_name: lead.contact_name || '',
      company_name: lead.company_name || '',
      email: lead.email || '',
      phone: lead.phone || '',
      stage: lead.stage,
      notes: lead.notes || '',
      next_follow_up: lead.next_follow_up || '',
    });
    setEditingLead(lead);
    setShowAddLead(true);
    setError(null);
  };

  const handleSaveLead = async () => {
    if (!leadForm.contact_name.trim()) {
      setError('Contact name is required');
      return;
    }
    setSaving(true);
    setError(null);

    const payload = {
      contact_name: leadForm.contact_name.trim(),
      company_name: leadForm.company_name.trim() || null,
      email: leadForm.email.trim().toLowerCase() || null,
      phone: leadForm.phone.trim() || null,
      stage: leadForm.stage,
      notes: leadForm.notes.trim() || null,
      next_follow_up: leadForm.next_follow_up || null,
      last_contact_date: new Date().toISOString().split('T')[0],
    };

    try {
      if (editingLead) {
        const { error } = await supabase
          .from('leads')
          .update(payload)
          .eq('id', editingLead.id);
        if (error) throw error;
        setSuccessMessage('Lead updated');
      } else {
        payload.sales_rep_id = clientData.id;
        const { error } = await supabase
          .from('leads')
          .insert(payload);
        if (error) throw error;
        setSuccessMessage('Lead added');
      }
      setShowAddLead(false);
      setEditingLead(null);
      await fetchLeads();
    } catch (err) {
      setError(err.message || 'Failed to save lead');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteLead = async (lead) => {
    if (lead.converted_client_id) return; // Can't delete converted leads
    if (!confirm(`Delete lead "${lead.contact_name}"?`)) return;

    const { error } = await supabase
      .from('leads')
      .delete()
      .eq('id', lead.id);

    if (!error) {
      setSuccessMessage('Lead deleted');
      setSelectedLead(null);
      await fetchLeads();
    }
  };

  const handleQuickStageChange = async (leadId, newStage) => {
    const { error } = await supabase
      .from('leads')
      .update({ stage: newStage, last_contact_date: new Date().toISOString().split('T')[0] })
      .eq('id', leadId);

    if (!error) {
      await fetchLeads();
      if (selectedLead?.id === leadId) {
        setSelectedLead(prev => ({ ...prev, stage: newStage }));
      }
    }
  };

  // Stage counts for filter badges
  const stageCounts = {
    all: leads.length,
    ...Object.fromEntries(STAGES.map(s => [s, leads.filter(l => l.stage === s).length])),
  };

  // --- RENDER ---

  const renderStats = () => (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
      {activeTab === 'pipeline' ? (
        <>
          <div className="bg-gray-800 rounded-lg p-3 text-center border border-gray-700">
            <p className="text-xl font-bold text-white">{totalLeads}</p>
            <p className="text-gray-400 text-xs">Total Leads</p>
          </div>
          <div className="bg-gray-800 rounded-lg p-3 text-center border border-gray-700">
            <p className="text-xl font-bold text-blue-400">{activeLeads}</p>
            <p className="text-gray-400 text-xs">Active</p>
          </div>
          <div className="bg-gray-800 rounded-lg p-3 text-center border border-gray-700">
            <p className="text-xl font-bold text-green-400">{conversions}</p>
            <p className="text-gray-400 text-xs">Signed Up</p>
          </div>
          <div className="bg-gray-800 rounded-lg p-3 text-center border border-gray-700">
            <p className="text-xl font-bold text-purple-400">{conversionRate}%</p>
            <p className="text-gray-400 text-xs">Conv. Rate</p>
          </div>
        </>
      ) : (
        <>
          <div className="bg-gray-800 rounded-lg p-3 text-center border border-gray-700">
            <p className="text-xl font-bold text-yellow-400">${commissions.filter(c => c.status === 'pending').reduce((s, c) => s + Number(c.amount), 0).toLocaleString()}</p>
            <p className="text-gray-400 text-xs">Pending</p>
          </div>
          <div className="bg-gray-800 rounded-lg p-3 text-center border border-gray-700">
            <p className="text-xl font-bold text-orange-400">${commissions.filter(c => c.status === 'owed').reduce((s, c) => s + Number(c.amount), 0).toLocaleString()}</p>
            <p className="text-gray-400 text-xs">Owed</p>
          </div>
          <div className="bg-gray-800 rounded-lg p-3 text-center border border-gray-700">
            <p className="text-xl font-bold text-green-400">${totalEarned.toLocaleString()}</p>
            <p className="text-gray-400 text-xs">Paid</p>
          </div>
          <div className="bg-gray-800 rounded-lg p-3 text-center border border-gray-700">
            <p className="text-xl font-bold text-white">${(pendingCommission + totalEarned).toLocaleString()}</p>
            <p className="text-gray-400 text-xs">Lifetime</p>
          </div>
        </>
      )}
    </div>
  );

  const renderStageFilters = () => (
    <div className="flex gap-2 overflow-x-auto pb-2 mb-3 scrollbar-hide">
      {['all', ...STAGES].map(stage => (
        <button
          key={stage}
          onClick={() => setStageFilter(stage)}
          className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
            stageFilter === stage
              ? 'bg-blue-600 text-white'
              : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
          }`}
        >
          {stage === 'all' ? 'All' : STAGE_LABELS[stage]} ({stageCounts[stage]})
        </button>
      ))}
    </div>
  );

  const renderLeadCard = (lead) => (
    <div
      key={lead.id}
      onClick={() => setSelectedLead(lead)}
      className="bg-gray-800 rounded-lg p-4 border border-gray-700 hover:border-gray-600 cursor-pointer transition-colors"
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0">
          <h3 className="text-white font-medium truncate">{lead.contact_name}</h3>
          {lead.company_name && (
            <p className="text-gray-400 text-sm truncate flex items-center gap-1">
              <Building className="w-3 h-3 flex-shrink-0" />
              {lead.company_name}
            </p>
          )}
        </div>
        <span className={`px-2 py-0.5 rounded text-xs font-medium flex-shrink-0 ml-2 ${STAGE_COLORS[lead.stage]}`}>
          {STAGE_LABELS[lead.stage]}
        </span>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
        {lead.email && (
          <span className="flex items-center gap-1 truncate">
            <Mail className="w-3 h-3" /> {lead.email}
          </span>
        )}
        {lead.phone && (
          <span className="flex items-center gap-1">
            <Phone className="w-3 h-3" /> {formatPhone(lead.phone)}
          </span>
        )}
        {lead.next_follow_up && (
          <span className="flex items-center gap-1">
            <Calendar className="w-3 h-3" /> Follow up: {new Date(lead.next_follow_up + 'T00:00:00').toLocaleDateString()}
          </span>
        )}
      </div>
    </div>
  );

  const renderLeadDetail = () => {
    if (!selectedLead) return null;
    const lead = leads.find(l => l.id === selectedLead.id) || selectedLead;

    return (
      <div className="fixed inset-0 bg-black/70 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
        <div className="bg-gray-800 border border-gray-700 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[92vh] overflow-y-auto">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-gray-700 sticky top-0 bg-gray-800 rounded-t-2xl">
            <h2 className="text-lg font-semibold text-white">Lead Details</h2>
            <div className="flex items-center gap-2">
              {!lead.converted_client_id && (
                <>
                  <button
                    onClick={() => { setSelectedLead(null); openEditLead(lead); }}
                    className="p-2 hover:bg-gray-700 rounded-lg"
                    title="Edit"
                  >
                    <Edit className="w-4 h-4 text-gray-400" />
                  </button>
                  <button
                    onClick={() => handleDeleteLead(lead)}
                    className="p-2 hover:bg-gray-700 rounded-lg"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4 text-red-400" />
                  </button>
                </>
              )}
              <button
                onClick={() => setSelectedLead(null)}
                className="p-2 hover:bg-gray-700 rounded-lg"
              >
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>
          </div>

          <div className="p-4 space-y-4">
            {/* Contact info */}
            <div>
              <h3 className="text-xl font-bold text-white">{lead.contact_name}</h3>
              {lead.company_name && (
                <p className="text-gray-400 flex items-center gap-1 mt-1">
                  <Building className="w-4 h-4" /> {lead.company_name}
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 gap-2">
              {lead.email && (
                <a href={`mailto:${lead.email}`} className="flex items-center gap-2 text-blue-400 hover:text-blue-300 text-sm">
                  <Mail className="w-4 h-4" /> {lead.email}
                </a>
              )}
              {lead.phone && (
                <a href={`tel:${lead.phone}`} className="flex items-center gap-2 text-blue-400 hover:text-blue-300 text-sm">
                  <Phone className="w-4 h-4" /> {formatPhone(lead.phone)}
                </a>
              )}
            </div>

            {/* Stage selector */}
            <div>
              <label className="block text-gray-400 text-sm mb-2">Stage</label>
              <div className="flex flex-wrap gap-2">
                {STAGES.map(stage => (
                  <button
                    key={stage}
                    onClick={() => !lead.converted_client_id && handleQuickStageChange(lead.id, stage)}
                    disabled={lead.converted_client_id && stage !== 'signed_up'}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      lead.stage === stage
                        ? STAGE_COLORS[stage] + ' ring-2 ring-white/20'
                        : 'bg-gray-750 text-gray-400 hover:bg-gray-700'
                    } ${lead.converted_client_id ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                  >
                    {STAGE_LABELS[stage]}
                  </button>
                ))}
              </div>
            </div>

            {/* Notes */}
            {lead.notes && (
              <div>
                <label className="block text-gray-400 text-sm mb-1">Notes</label>
                <p className="text-white text-sm bg-gray-750 rounded-lg p-3 whitespace-pre-wrap">{lead.notes}</p>
              </div>
            )}

            {/* Dates */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              {lead.last_contact_date && (
                <div>
                  <span className="text-gray-400">Last Contact</span>
                  <p className="text-white">{new Date(lead.last_contact_date + 'T00:00:00').toLocaleDateString()}</p>
                </div>
              )}
              {lead.next_follow_up && (
                <div>
                  <span className="text-gray-400">Next Follow Up</span>
                  <p className="text-white">{new Date(lead.next_follow_up + 'T00:00:00').toLocaleDateString()}</p>
                </div>
              )}
              <div>
                <span className="text-gray-400">Created</span>
                <p className="text-white">{new Date(lead.created_at).toLocaleDateString()}</p>
              </div>
            </div>

            {/* Conversion info */}
            {lead.converted_client_id && (
              <div className="bg-green-900/30 border border-green-800 rounded-lg p-3">
                <p className="text-green-300 text-sm font-medium flex items-center gap-2">
                  <Check className="w-4 h-4" /> Converted to client on {new Date(lead.converted_at).toLocaleDateString()}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderAddEditModal = () => {
    if (!showAddLead) return null;

    return (
      <div className="fixed inset-0 bg-black/70 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
        <div className="bg-gray-800 border border-gray-700 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[92vh] overflow-y-auto">
          <div className="flex items-center justify-between p-4 border-b border-gray-700 sticky top-0 bg-gray-800 rounded-t-2xl">
            <h2 className="text-lg font-semibold text-white">
              {editingLead ? 'Edit Lead' : 'Add New Lead'}
            </h2>
            <button
              onClick={() => { setShowAddLead(false); setEditingLead(null); setError(null); }}
              className="p-2 hover:bg-gray-700 rounded-lg"
            >
              <X className="w-5 h-5 text-gray-400" />
            </button>
          </div>

          <div className="p-4 space-y-4">
            <div>
              <label className="block text-gray-400 text-sm mb-1">Contact Name *</label>
              <input
                type="text"
                value={leadForm.contact_name}
                onChange={(e) => setLeadForm({ ...leadForm, contact_name: e.target.value })}
                className="w-full px-3 py-2 bg-gray-750 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                placeholder="John Smith"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-gray-400 text-sm mb-1">Company Name</label>
              <input
                type="text"
                value={leadForm.company_name}
                onChange={(e) => setLeadForm({ ...leadForm, company_name: e.target.value })}
                className="w-full px-3 py-2 bg-gray-750 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                placeholder="Acme HVAC"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-gray-400 text-sm mb-1">Email</label>
                <input
                  type="email"
                  value={leadForm.email}
                  onChange={(e) => setLeadForm({ ...leadForm, email: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-750 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                  placeholder="john@acme.com"
                />
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-1">Phone</label>
                <input
                  type="tel"
                  value={leadForm.phone}
                  onChange={(e) => setLeadForm({ ...leadForm, phone: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-750 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                  placeholder="(555) 123-4567"
                />
              </div>
            </div>

            <div>
              <label className="block text-gray-400 text-sm mb-1">Stage</label>
              <select
                value={leadForm.stage}
                onChange={(e) => setLeadForm({ ...leadForm, stage: e.target.value })}
                className="w-full px-3 py-2 bg-gray-750 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
              >
                {STAGES.map(s => (
                  <option key={s} value={s}>{STAGE_LABELS[s]}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-gray-400 text-sm mb-1">Next Follow Up</label>
              <input
                type="date"
                value={leadForm.next_follow_up}
                onChange={(e) => setLeadForm({ ...leadForm, next_follow_up: e.target.value })}
                className="w-full px-3 py-2 bg-gray-750 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-gray-400 text-sm mb-1">Notes</label>
              <textarea
                value={leadForm.notes}
                onChange={(e) => setLeadForm({ ...leadForm, notes: e.target.value })}
                className="w-full px-3 py-2 bg-gray-750 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 resize-none"
                rows={3}
                placeholder="Any notes about this lead..."
              />
            </div>

            {error && (
              <p className="text-red-400 text-sm">{error}</p>
            )}

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => { setShowAddLead(false); setEditingLead(null); setError(null); }}
                className="flex-1 px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveLead}
                disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderPipeline = () => (
    <>
      {/* Search */}
      <div className="relative mb-3">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search leads..."
          className="w-full pl-10 pr-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 text-sm"
        />
      </div>

      {renderStageFilters()}

      {/* Lead list */}
      {filteredLeads.length === 0 ? (
        <div className="text-center py-12">
          <Users className="w-12 h-12 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400">
            {searchTerm || stageFilter !== 'all'
              ? 'No leads match your filters'
              : 'No leads yet — tap + to add your first lead'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredLeads.map(renderLeadCard)}
        </div>
      )}
    </>
  );

  const renderCommissions = () => (
    <>
      {commissions.length === 0 ? (
        <div className="text-center py-12">
          <DollarSign className="w-12 h-12 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400">No commissions yet</p>
          <p className="text-gray-500 text-sm mt-1">Commissions are created automatically when your leads sign up and pay.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {commissions.map(commission => (
            <div
              key={commission.id}
              className="bg-gray-800 rounded-lg p-4 border border-gray-700"
            >
              <div className="flex items-start justify-between mb-2">
                <div>
                  <p className="text-white font-medium">
                    ${Number(commission.amount).toLocaleString()}
                  </p>
                  <p className="text-gray-400 text-sm capitalize">
                    {(commission.plan_type || '').replace(/_/g, ' ')}
                  </p>
                </div>
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${COMMISSION_STATUS_COLORS[commission.status]}`}>
                  {COMMISSION_STATUS_LABELS[commission.status]}
                </span>
              </div>
              <div className="text-xs text-gray-500 flex items-center gap-3">
                <span>{new Date(commission.created_at).toLocaleDateString()}</span>
                {commission.paid_at && (
                  <span className="text-green-400">Paid {new Date(commission.paid_at).toLocaleDateString()}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  const navItems = [
    { id: 'pipeline', label: 'Pipeline', icon: Users },
    { id: 'commissions', label: 'Commissions', icon: DollarSign },
  ];

  return (
    <div className="min-h-screen bg-gray-900 pb-20">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700 px-4 sticky top-0 z-40 flex items-center justify-between" style={{ height: '72px' }}>
        <div className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-blue-400" />
          <span className="text-white font-medium text-sm hidden sm:inline">Sales</span>
        </div>
        <img src={logo} alt="Reliant Support" style={{ height: '40px', width: 'auto' }} />
        <button
          onClick={onLogout}
          className="p-2 hover:bg-gray-700 rounded-lg"
          title="Sign out"
        >
          <LogOut className="w-5 h-5 text-gray-400" />
        </button>
      </header>

      {/* Success toast */}
      {successMessage && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-green-900 border border-green-700 text-green-200 px-4 py-2 rounded-lg text-sm shadow-lg">
          {successMessage}
        </div>
      )}

      {/* Main Content */}
      <main className="p-4 md:p-6 max-w-2xl mx-auto">
        {renderStats()}
        {activeTab === 'pipeline' && renderPipeline()}
        {activeTab === 'commissions' && renderCommissions()}
      </main>

      {/* FAB - Add Lead (pipeline tab only) */}
      {activeTab === 'pipeline' && (
        <button
          onClick={openAddLead}
          className="fixed right-4 bottom-24 z-30 w-14 h-14 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg flex items-center justify-center"
        >
          <Plus className="w-6 h-6" />
        </button>
      )}

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-gray-800 border-t border-gray-700 z-30">
        <div className="flex justify-around items-center h-16 max-w-lg mx-auto">
          {navItems.map(item => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`flex flex-col items-center gap-1 px-4 py-2 transition-colors ${
                  isActive ? 'text-blue-400' : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-xs">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Modals */}
      {renderAddEditModal()}
      {renderLeadDetail()}
    </div>
  );
};

export default SalesDashboard;
