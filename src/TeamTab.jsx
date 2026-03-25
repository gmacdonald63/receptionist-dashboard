// src/TeamTab.jsx
import React, { useState, useEffect } from 'react';
import { Plus, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase } from './supabaseClient';

const SUPABASE_FUNCTIONS_URL = 'https://zmppdmfdhknnwzwdfhwf.supabase.co/functions/v1';

const TECH_COLORS = [
  { hex: '#3B82F6', name: 'Blue'   },
  { hex: '#10B981', name: 'Green'  },
  { hex: '#F59E0B', name: 'Amber'  },
  { hex: '#EF4444', name: 'Red'    },
  { hex: '#8B5CF6', name: 'Purple' },
  { hex: '#EC4899', name: 'Pink'   },
  { hex: '#06B6D4', name: 'Cyan'   },
  { hex: '#F97316', name: 'Orange' },
];

// Phase 1 permission features shown in the toggle panel
const PHASE1_FEATURES = [
  { key: 'job_notes',     label: 'Job Notes',     description: 'Can view job notes on device' },
  { key: 'on_my_way',     label: 'On My Way',     description: 'Can set status to En Route'   },
  { key: 'mark_complete', label: 'Mark Complete', description: 'Can mark jobs complete'        },
];

const formatPhone = (raw) => {
  const digits = raw.replace(/\D/g, '').slice(0, 10);
  if (digits.length < 4) return digits;
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
};

const callInviteFunction = async (email, name, role) => {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/invite-user`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ email, name, role }),
  });
  return res.json();
};

const TeamTab = ({ clientData, role }) => {
  const [technicians, setTechnicians]   = useState([]);
  const [staff, setStaff]               = useState([]);
  const [loading, setLoading]           = useState(true);

  // Tech form state
  const [showTechForm, setShowTechForm]     = useState(false);
  const [editingTechId, setEditingTechId]   = useState(null);
  const [techForm, setTechForm]             = useState({ name: '', phone: '', color: '#3B82F6', email: '', sendInvite: true });
  const [savingTech, setSavingTech]         = useState(false);
  const [techFormError, setTechFormError]   = useState(null);

  // Dispatcher form state
  const [showStaffForm, setShowStaffForm]   = useState(false);
  const [staffForm, setStaffForm]           = useState({ name: '', email: '' });
  const [savingStaff, setSavingStaff]       = useState(false);
  const [staffFormError, setStaffFormError] = useState(null);

  // Permission panel state
  const [expandedTechId, setExpandedTechId]       = useState(null);
  const [permissions, setPermissions]               = useState({});  // { [techId]: [{feature, enabled}] }
  const [savingPermTechId, setSavingPermTechId]     = useState(null);

  const isOwner = role === 'owner' || role === 'admin';

  // ── Data fetching ──────────────────────────────────────────────────────────
  const fetchAll = async () => {
    setLoading(true);
    const [techRes, staffRes] = await Promise.all([
      supabase.from('technicians').select('*').eq('client_id', clientData.id).order('name'),
      supabase.from('client_staff').select('*').eq('client_id', clientData.id).order('name'),
    ]);
    setTechnicians(techRes.data || []);
    setStaff(staffRes.data || []);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, [clientData.id]);

  // ── Permission helpers ─────────────────────────────────────────────────────
  const fetchPermissions = async (techId) => {
    const { data } = await supabase
      .from('technician_permissions')
      .select('feature, enabled')
      .eq('technician_id', techId);
    setPermissions(prev => ({ ...prev, [techId]: data || [] }));
  };

  const handleToggleExpand = async (techId) => {
    if (expandedTechId === techId) { setExpandedTechId(null); return; }
    setExpandedTechId(techId);
    if (!permissions[techId]) await fetchPermissions(techId);
  };

  const handleTogglePermission = async (techId, feature, currentEnabled) => {
    setSavingPermTechId(techId);
    try {
      await supabase
        .from('technician_permissions')
        .upsert(
          { technician_id: techId, client_id: clientData.id, feature, enabled: !currentEnabled },
          { onConflict: 'technician_id,feature' }
        );
      setPermissions(prev => ({
        ...prev,
        [techId]: (prev[techId] || []).map(p =>
          p.feature === feature ? { ...p, enabled: !currentEnabled } : p
        ),
      }));
    } catch (err) {
      console.error('Permission toggle error:', err);
    } finally {
      setSavingPermTechId(null);
    }
  };

  // ── Tech form handlers ─────────────────────────────────────────────────────
  const resetTechForm = () => {
    setTechForm({ name: '', phone: '', color: '#3B82F6', email: '', sendInvite: true });
    setShowTechForm(false);
    setEditingTechId(null);
    setTechFormError(null);
  };

  const handleEditTech = (tech) => {
    setTechForm({ name: tech.name, phone: tech.phone || '', color: tech.color || '#3B82F6', email: tech.email || '', sendInvite: false });
    setEditingTechId(tech.id);
    setShowTechForm(true);
    setTechFormError(null);
  };

  const handleSaveTech = async () => {
    setTechFormError(null);
    if (!techForm.name.trim()) { setTechFormError('Name is required.'); return; }
    if (!editingTechId && !techForm.email.trim()) { setTechFormError('Email is required for new technicians.'); return; }

    setSavingTech(true);
    try {
      let techId = editingTechId;

      if (editingTechId) {
        // Update existing tech
        const updateData = { name: techForm.name.trim(), phone: techForm.phone.trim() || null, color: techForm.color };
        if (techForm.email.trim()) updateData.email = techForm.email.trim().toLowerCase();
        const { error } = await supabase.from('technicians').update(updateData).eq('id', editingTechId);
        if (error) throw error;
      } else {
        // Insert new tech
        const { data, error } = await supabase
          .from('technicians')
          .insert({
            client_id: clientData.id,
            name: techForm.name.trim(),
            phone: techForm.phone.trim() || null,
            color: techForm.color,
            email: techForm.email.trim().toLowerCase(),
          })
          .select('id')
          .single();
        if (error) throw error;
        techId = data.id;

        // Insert default permissions for all 6 features
        await supabase.from('technician_permissions').insert([
          { technician_id: techId, client_id: clientData.id, feature: 'job_notes',              enabled: true  },
          { technician_id: techId, client_id: clientData.id, feature: 'on_my_way',              enabled: true  },
          { technician_id: techId, client_id: clientData.id, feature: 'mark_complete',          enabled: true  },
          { technician_id: techId, client_id: clientData.id, feature: 'gps_tracking',           enabled: false },
          { technician_id: techId, client_id: clientData.id, feature: 'customer_sms',           enabled: false },
          { technician_id: techId, client_id: clientData.id, feature: 'customer_tracking_link', enabled: false },
        ]);
      }

      // Fire invite (non-blocking — DB row is already saved)
      if (techForm.sendInvite && techForm.email.trim()) {
        try {
          const result = await callInviteFunction(techForm.email.trim().toLowerCase(), techForm.name.trim(), 'tech');
          if (result.existing) {
            alert('Tech saved. An account with this email already exists — they can log in immediately.');
          }
        } catch (inviteErr) {
          console.error('Invite failed (non-fatal):', inviteErr);
          alert('Tech saved, but the invite email could not be sent. You can resend it by editing the tech.');
        }
      }

      await fetchAll();
      resetTechForm();
    } catch (err) {
      console.error('Save tech error:', err);
      setTechFormError(err.message || 'Failed to save technician.');
    } finally {
      setSavingTech(false);
    }
  };

  const handleToggleTechActive = async (tech) => {
    try {
      await supabase.from('technicians').update({ is_active: !tech.is_active }).eq('id', tech.id);
      setTechnicians(prev => prev.map(t => t.id === tech.id ? { ...t, is_active: !tech.is_active } : t));
    } catch (err) {
      console.error('Toggle tech active error:', err);
    }
  };

  // ── Staff (dispatcher) form handlers ──────────────────────────────────────
  const resetStaffForm = () => {
    setStaffForm({ name: '', email: '' });
    setShowStaffForm(false);
    setStaffFormError(null);
  };

  const handleSaveStaff = async () => {
    setStaffFormError(null);
    if (!staffForm.name.trim()) { setStaffFormError('Name is required.'); return; }
    if (!staffForm.email.trim()) { setStaffFormError('Email is required.'); return; }

    setSavingStaff(true);
    try {
      const { error } = await supabase.from('client_staff').insert({
        client_id: clientData.id,
        name: staffForm.name.trim(),
        email: staffForm.email.trim().toLowerCase(),
        role: 'dispatcher',
      });
      if (error) throw error;

      // Always send invite for dispatchers (no checkbox — always required for login)
      try {
        const result = await callInviteFunction(staffForm.email.trim().toLowerCase(), staffForm.name.trim(), 'dispatcher');
        if (result.existing) {
          alert('Dispatcher saved. An account with this email already exists — they can log in immediately.');
        }
      } catch (inviteErr) {
        console.error('Dispatcher invite failed (non-fatal):', inviteErr);
        alert('Dispatcher saved, but the invite email could not be sent. Contact them to set up their account manually.');
      }

      await fetchAll();
      resetStaffForm();
    } catch (err) {
      console.error('Save staff error:', err);
      setStaffFormError(err.message || 'Failed to save dispatcher.');
    } finally {
      setSavingStaff(false);
    }
  };

  const handleToggleStaffActive = async (staffMember) => {
    try {
      await supabase.from('client_staff').update({ active: !staffMember.active }).eq('id', staffMember.id);
      setStaff(prev => prev.map(s => s.id === staffMember.id ? { ...s, active: !staffMember.active } : s));
    } catch (err) {
      console.error('Toggle staff active error:', err);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="w-6 h-6 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="space-y-4">

      {/* ── Technicians section ── */}
      <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Technicians</h3>
          {isOwner && !showTechForm && (
            <button
              onClick={() => { resetTechForm(); setShowTechForm(true); }}
              className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm"
            >
              <Plus className="w-4 h-4" /> Add Tech
            </button>
          )}
        </div>

        {/* Add / Edit form (owner only) */}
        {isOwner && showTechForm && (
          <div className="mb-4 p-3 bg-gray-900 rounded-lg border border-gray-600 space-y-3">
            <p className="text-sm font-medium text-gray-300">
              {editingTechId ? 'Edit Technician' : 'New Technician'}
            </p>
            {techFormError && <p className="text-red-400 text-sm">{techFormError}</p>}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-gray-400 text-xs mb-1">Name <span className="text-red-400">*</span></label>
                <input
                  type="text"
                  value={techForm.name}
                  onChange={e => setTechForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Tech name"
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 text-sm"
                />
              </div>
              <div>
                <label className="block text-gray-400 text-xs mb-1">Phone</label>
                <input
                  type="tel"
                  value={techForm.phone}
                  onChange={e => setTechForm(f => ({ ...f, phone: formatPhone(e.target.value) }))}
                  placeholder="(555) 123-4567"
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-gray-400 text-xs mb-1">
                Email {!editingTechId && <span className="text-red-400">*</span>}
                {editingTechId && <span className="text-gray-500 ml-1">(leave blank to keep existing)</span>}
              </label>
              <input
                type="email"
                value={techForm.email}
                onChange={e => setTechForm(f => ({ ...f, email: e.target.value }))}
                placeholder="tech@example.com"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 text-sm"
              />
            </div>

            <div>
              <label className="block text-gray-400 text-xs mb-1">Calendar Color</label>
              <div className="flex gap-2 flex-wrap">
                {TECH_COLORS.map(c => (
                  <button
                    key={c.hex}
                    type="button"
                    onClick={() => setTechForm(f => ({ ...f, color: c.hex }))}
                    className={`w-8 h-8 rounded-full border-2 transition-all ${techForm.color === c.hex ? 'border-white scale-110' : 'border-transparent hover:border-gray-500'}`}
                    style={{ backgroundColor: c.hex }}
                    title={c.name}
                  />
                ))}
              </div>
            </div>

            {!editingTechId && (
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={techForm.sendInvite}
                  onChange={e => setTechForm(f => ({ ...f, sendInvite: e.target.checked }))}
                  className="w-4 h-4 accent-blue-500"
                />
                <span className="text-sm text-gray-300">Send invite email to tech</span>
              </label>
            )}

            <div className="flex gap-2">
              <button onClick={resetTechForm} className="flex-1 px-3 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 text-sm">
                Cancel
              </button>
              <button
                onClick={handleSaveTech}
                disabled={savingTech || !techForm.name.trim()}
                className="flex-1 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm disabled:opacity-50"
              >
                {savingTech ? 'Saving...' : editingTechId ? 'Update' : 'Add'}
              </button>
            </div>
          </div>
        )}

        {/* Tech list */}
        {technicians.length === 0 ? (
          <p className="text-gray-500 text-sm text-center py-4">No technicians added yet.</p>
        ) : (
          <div className="space-y-2">
            {technicians.map(tech => {
              const isExpanded = expandedTechId === tech.id;
              const techPerms  = permissions[tech.id] || [];
              return (
                <div
                  key={tech.id}
                  className={`rounded-lg border ${tech.is_active ? 'bg-gray-750 border-gray-600' : 'bg-gray-750/50 border-gray-700'}`}
                >
                  <div className="flex items-center gap-3 p-3">
                    <div className="w-4 h-4 rounded-full flex-shrink-0" style={{ backgroundColor: tech.color || '#3B82F6' }} />
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${tech.is_active ? 'text-white' : 'text-gray-500 line-through'}`}>
                        {tech.name}
                      </p>
                      {tech.phone && <p className="text-xs text-gray-400">{tech.phone}</p>}
                      {tech.email && <p className="text-xs text-gray-500">{tech.email}</p>}
                    </div>
                    {isOwner && (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => handleEditTech(tech)}
                          className="px-2 py-1 text-xs text-gray-400 hover:text-white hover:bg-gray-700 rounded"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleToggleTechActive(tech)}
                          className={`px-2 py-1 text-xs rounded ${tech.is_active ? 'text-amber-400 hover:bg-amber-900/30' : 'text-green-400 hover:bg-green-900/30'}`}
                        >
                          {tech.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                        <button
                          onClick={() => handleToggleExpand(tech.id)}
                          className="px-2 py-1 text-xs text-blue-400 hover:bg-blue-900/30 rounded flex items-center gap-0.5"
                        >
                          Perms {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Permission toggles — owner only, shown when expanded */}
                  {isOwner && isExpanded && (
                    <div className="border-t border-gray-600 px-3 py-3 space-y-3">
                      <p className="text-xs text-gray-500 uppercase tracking-wide">Permissions</p>
                      {PHASE1_FEATURES.map(feat => {
                        const permRow = techPerms.find(p => p.feature === feat.key);
                        const enabled = permRow ? permRow.enabled : true; // Phase 1 default on
                        return (
                          <div key={feat.key} className="flex items-center justify-between gap-3">
                            <div className="flex-1">
                              <p className="text-sm text-white">{feat.label}</p>
                              <p className="text-xs text-gray-500">{feat.description}</p>
                            </div>
                            <button
                              onClick={() => handleTogglePermission(tech.id, feat.key, enabled)}
                              disabled={savingPermTechId === tech.id}
                              className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none ${enabled ? 'bg-blue-600' : 'bg-gray-600'} disabled:opacity-50`}
                            >
                              <span
                                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`}
                              />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Dispatchers section (owner only) ── */}
      {isOwner && (
        <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-white">Dispatchers</h3>
            {!showStaffForm && (
              <button
                onClick={() => { resetStaffForm(); setShowStaffForm(true); }}
                className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm"
              >
                <Plus className="w-4 h-4" /> Add Dispatcher
              </button>
            )}
          </div>

          {showStaffForm && (
            <div className="mb-4 p-3 bg-gray-900 rounded-lg border border-gray-600 space-y-3">
              <p className="text-sm font-medium text-gray-300">New Dispatcher</p>
              {staffFormError && <p className="text-red-400 text-sm">{staffFormError}</p>}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-gray-400 text-xs mb-1">Name <span className="text-red-400">*</span></label>
                  <input
                    type="text"
                    value={staffForm.name}
                    onChange={e => setStaffForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="Dispatcher name"
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-gray-400 text-xs mb-1">Email <span className="text-red-400">*</span></label>
                  <input
                    type="email"
                    value={staffForm.email}
                    onChange={e => setStaffForm(f => ({ ...f, email: e.target.value }))}
                    placeholder="dispatcher@example.com"
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 text-sm"
                  />
                </div>
              </div>
              <p className="text-xs text-gray-500">An invite email will be sent automatically.</p>
              <div className="flex gap-2">
                <button onClick={resetStaffForm} className="flex-1 px-3 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 text-sm">
                  Cancel
                </button>
                <button
                  onClick={handleSaveStaff}
                  disabled={savingStaff || !staffForm.name.trim() || !staffForm.email.trim()}
                  className="flex-1 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm disabled:opacity-50"
                >
                  {savingStaff ? 'Saving...' : 'Add & Invite'}
                </button>
              </div>
            </div>
          )}

          {staff.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-4">No dispatchers added yet.</p>
          ) : (
            <div className="space-y-2">
              {staff.map(s => (
                <div
                  key={s.id}
                  className={`flex items-center gap-3 p-3 rounded-lg border ${s.active ? 'bg-gray-750 border-gray-600' : 'bg-gray-750/50 border-gray-700'}`}
                >
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${s.active ? 'text-white' : 'text-gray-500 line-through'}`}>{s.name}</p>
                    <p className="text-xs text-gray-400">{s.email}</p>
                    <p className="text-xs text-gray-600 capitalize">{s.role}</p>
                  </div>
                  <button
                    onClick={() => handleToggleStaffActive(s)}
                    className={`px-2 py-1 text-xs rounded flex-shrink-0 ${s.active ? 'text-amber-400 hover:bg-amber-900/30' : 'text-green-400 hover:bg-green-900/30'}`}
                  >
                    {s.active ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

    </div>
  );
};

export default TeamTab;
