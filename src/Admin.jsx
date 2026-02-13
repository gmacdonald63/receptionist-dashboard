import React, { useState, useEffect } from 'react';
import { Users, Plus, Edit, Trash2, Save, X, RefreshCw, ArrowLeft } from 'lucide-react';
import { supabase } from './supabaseClient';

const Admin = ({ onBack }) => {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingClient, setEditingClient] = useState(null);
  const [formData, setFormData] = useState({
    email: '',
    company_name: '',
    retell_agent_id: '',
    retell_api_key: '',
    cal_com_link: '',
    is_admin: false
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchClients();
  }, []);

  const fetchClients = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setClients(data || []);
    } catch (error) {
      console.error('Error fetching clients:', error);
      setError('Failed to load clients');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({
      email: '',
      company_name: '',
      retell_agent_id: '',
      retell_api_key: '',
      cal_com_link: '',
      is_admin: false
    });
    setEditingClient(null);
    setShowAddForm(false);
    setError(null);
  };

  const handleEdit = (client) => {
    setFormData({
      email: client.email || '',
      company_name: client.company_name || '',
      retell_agent_id: client.retell_agent_id || '',
      retell_api_key: client.retell_api_key || '',
      cal_com_link: client.cal_com_link || '',
      is_admin: client.is_admin || false
    });
    setEditingClient(client);
    setShowAddForm(true);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    try {
      if (editingClient) {
        // Update existing client
        const { error } = await supabase
          .from('clients')
          .update({
            email: formData.email,
            company_name: formData.company_name,
            retell_agent_id: formData.retell_agent_id,
            retell_api_key: formData.retell_api_key,
            cal_com_link: formData.cal_com_link,
            is_admin: formData.is_admin
          })
          .eq('id', editingClient.id);

        if (error) throw error;
      } else {
        // Create new client
        const { error } = await supabase
          .from('clients')
          .insert([{
            email: formData.email,
            company_name: formData.company_name,
            retell_agent_id: formData.retell_agent_id,
            retell_api_key: formData.retell_api_key,
            cal_com_link: formData.cal_com_link,
            is_admin: formData.is_admin
          }]);

        if (error) throw error;
      }

      resetForm();
      fetchClients();
    } catch (error) {
      console.error('Error saving client:', error);
      setError(error.message || 'Failed to save client');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (client) => {
    if (!confirm(`Are you sure you want to delete ${client.company_name || client.email}?`)) {
      return;
    }

    try {
      const { error } = await supabase
        .from('clients')
        .delete()
        .eq('id', client.id);

      if (error) throw error;
      fetchClients();
    } catch (error) {
      console.error('Error deleting client:', error);
      setError('Failed to delete client');
    }
  };

  const createAuthUser = async (email, password) => {
    // This creates a user in Supabase Auth
    // Note: In production, you might want to send an invite email instead
    const { data, error } = await supabase.auth.admin.createUser({
      email: email,
      password: password,
      email_confirm: true
    });
    return { data, error };
  };

  return (
    <div className="min-h-screen bg-gray-900 p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="p-2 hover:bg-gray-800 rounded-lg"
          >
            <ArrowLeft className="w-5 h-5 text-gray-400" />
          </button>
          <div className="flex items-center gap-3">
            <Users className="w-8 h-8 text-blue-500" />
            <h1 className="text-2xl font-bold text-white">Client Management</h1>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={fetchClients}
            className="flex items-center gap-2 px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-700 border border-gray-700"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
          <button
            onClick={() => setShowAddForm(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Add Client</span>
          </button>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="mb-4 p-3 bg-red-900/50 border border-red-700 rounded-lg">
          <p className="text-red-300 text-sm">{error}</p>
        </div>
      )}

      {/* Add/Edit Form Modal */}
      {showAddForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-white">
                {editingClient ? 'Edit Client' : 'Add New Client'}
              </h2>
              <button onClick={resetForm} className="p-1 hover:bg-gray-700 rounded">
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-gray-400 text-sm mb-1">Email *</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-750 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                  placeholder="client@example.com"
                  required
                />
              </div>

              <div>
                <label className="block text-gray-400 text-sm mb-1">Company Name</label>
                <input
                  type="text"
                  value={formData.company_name}
                  onChange={(e) => setFormData({ ...formData, company_name: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-750 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                  placeholder="ABC Company"
                />
              </div>

              <div>
                <label className="block text-gray-400 text-sm mb-1">Retell Agent ID *</label>
                <input
                  type="text"
                  value={formData.retell_agent_id}
                  onChange={(e) => setFormData({ ...formData, retell_agent_id: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-750 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                  placeholder="agent_xxxxx"
                />
              </div>

              <div>
                <label className="block text-gray-400 text-sm mb-1">Retell API Key</label>
                <input
                  type="text"
                  value={formData.retell_api_key}
                  onChange={(e) => setFormData({ ...formData, retell_api_key: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-750 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                  placeholder="key_xxxxx"
                />
              </div>

              <div>
                <label className="block text-gray-400 text-sm mb-1">Cal.com Link</label>
                <input
                  type="text"
                  value={formData.cal_com_link}
                  onChange={(e) => setFormData({ ...formData, cal_com_link: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-750 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                  placeholder="https://cal.com/..."
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="is_admin"
                  checked={formData.is_admin}
                  onChange={(e) => setFormData({ ...formData, is_admin: e.target.checked })}
                  className="w-4 h-4"
                />
                <label htmlFor="is_admin" className="text-gray-400 text-sm">Admin user</label>
              </div>

              {error && (
                <p className="text-red-400 text-sm">{error}</p>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  onClick={resetForm}
                  className="flex-1 px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !formData.email}
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

            {!editingClient && (
              <div className="mt-4 p-3 bg-yellow-900/30 border border-yellow-700 rounded-lg">
                <p className="text-yellow-300 text-xs">
                  Note: After adding a client here, you'll also need to create their login account in Supabase Authentication → Users → Add user
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Clients List */}
      {loading ? (
        <div className="text-center py-12">
          <RefreshCw className="w-8 h-8 animate-spin text-blue-500 mx-auto mb-4" />
          <p className="text-gray-400">Loading clients...</p>
        </div>
      ) : clients.length === 0 ? (
        <div className="bg-gray-800 rounded-lg p-8 border border-gray-700 text-center">
          <Users className="w-12 h-12 text-gray-600 mx-auto mb-4" />
          <p className="text-gray-400">No clients yet</p>
          <button
            onClick={() => setShowAddForm(true)}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Add Your First Client
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {clients.map(client => (
            <div
              key={client.id}
              className="bg-gray-800 rounded-lg border border-gray-700 p-4"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="font-medium text-white">{client.company_name || 'No company name'}</p>
                    {client.is_admin && (
                      <span className="px-2 py-0.5 bg-purple-900 text-purple-300 rounded text-xs">Admin</span>
                    )}
                  </div>
                  <p className="text-sm text-gray-400">{client.email}</p>
                  {client.retell_agent_id && (
                    <p className="text-xs text-gray-500 mt-1">Agent: {client.retell_agent_id}</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleEdit(client)}
                    className="p-2 hover:bg-gray-700 rounded-lg"
                    title="Edit"
                  >
                    <Edit className="w-4 h-4 text-gray-400" />
                  </button>
                  <button
                    onClick={() => handleDelete(client)}
                    className="p-2 hover:bg-gray-700 rounded-lg"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4 text-red-400" />
                  </button>
                </div>
              </div>
              {client.cal_com_link && (
                <p className="text-xs text-gray-500 mt-2 truncate">Cal.com: {client.cal_com_link}</p>
              )}
              <p className="text-xs text-gray-600 mt-2">
                Created: {new Date(client.created_at).toLocaleDateString()}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Admin;
