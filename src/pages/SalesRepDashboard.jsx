// src/pages/SalesRepDashboard.jsx
import React, { useState, useEffect } from 'react';
import {
  Plus, RefreshCw, LogOut, ChevronDown, ChevronUp,
  DollarSign, Link, Briefcase, TrendingUp, Play
} from 'lucide-react';
import { supabase } from '../supabaseClient';
import {
  formatCurrency,
  getDealStatusConfig,
  getCommissionStatusConfig,
  calcCommissionTotals,
  formatPlanLabel,
} from '../utils/repDashboard';

const SUPABASE_URL = 'https://zmppdmfdhknnwzwdfhwf.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InptcHBkbWZkaGtubnd6d2RmaHdmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4MzQyMDYsImV4cCI6MjA4NTQxMDIwNn0.mXfuz8mEZhizFen78gUaakBDbrzANn4ZM1a7KuDiKJs';

// ── Section toggle component ────────────────────────────────────
const Section = ({ title, icon: Icon, children, defaultOpen = true }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
      <button
        className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-750"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-2">
          {Icon && <Icon className="w-5 h-5 text-gray-400" />}
          <span className="font-semibold text-white">{title}</span>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>
      {open && <div className="p-4 pt-0 border-t border-gray-700">{children}</div>}
    </div>
  );
};

// ── Status badge ────────────────────────────────────────────────
const Badge = ({ config }) => (
  <span className={`px-2 py-1 rounded text-xs font-medium ${config.badgeClass}`}>
    {config.label}
  </span>
);

// ── Commission option label helper ──────────────────────────────
const commissionOptionLabel = (option) => {
  if (option === 1) return 'Option 1 — Full Upfront';
  if (option === 2) return 'Option 2 — Split + Residual';
  return 'Not set';
};

// ── Main component ──────────────────────────────────────────────
const SalesRepDashboard = ({ clientData, onLogout, onShowDemo }) => {
  // ── Form state ──────────────────────────────────────────────
  const [form, setForm] = useState({
    client_name: '',
    client_email: '',
    client_phone: '',
    company_name: '',
    plan: 'standard',
    billing_cycle: 'monthly',
  });
  const [formError, setFormError] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [linkSent, setLinkSent] = useState(false);

  // ── Data state ──────────────────────────────────────────────
  const [deals, setDeals] = useState([]);
  const [commissions, setCommissions] = useState([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState(null);

  // ── Expanded deal in commissions section ────────────────────
  const [expandedDealId, setExpandedDealId] = useState(null);

  // ── Load deals and commissions on mount ─────────────────────
  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setDataLoading(true);
    setDataError(null);
    try {
      const [dealsResult, commissionsResult] = await Promise.all([
        supabase
          .from('deals')
          .select('*')
          .order('created_at', { ascending: false }),
        supabase
          .from('commissions')
          .select('*')
          .order('month_number', { ascending: true }),
      ]);

      if (dealsResult.error) throw dealsResult.error;
      if (commissionsResult.error) throw commissionsResult.error;

      setDeals(dealsResult.data || []);
      setCommissions(commissionsResult.data || []);
    } catch (err) {
      console.error('Failed to fetch rep data:', err);
      setDataError('Failed to load your data. Please refresh.');
    } finally {
      setDataLoading(false);
    }
  };

  // ── Form field update ────────────────────────────────────────
  const setField = (key, value) => setForm(f => ({ ...f, [key]: value }));

  // ── Validate form before submit ──────────────────────────────
  const validateForm = () => {
    if (!form.client_name.trim()) return 'Client name is required.';
    if (!form.client_email.trim()) return 'Client email is required.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.client_email.trim())) return 'Enter a valid email address.';
    if (!form.company_name.trim()) return 'Company name is required.';
    return null;
  };

  // ── Generate onboarding link ─────────────────────────────────
  const handleGenerateLink = async () => {
    const validationError = validateForm();
    if (validationError) { setFormError(validationError); return; }

    setFormError(null);
    setGenerating(true);
    setLinkSent(false);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Not authenticated');

      const res = await fetch(`${SUPABASE_URL}/functions/v1/create-deal`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': ANON_KEY,
        },
        body: JSON.stringify({
          client_name: form.client_name.trim(),
          client_email: form.client_email.trim().toLowerCase(),
          client_phone: form.client_phone.trim() || undefined,
          company_name: form.company_name.trim(),
          plan: form.plan,
          billing_cycle: form.billing_cycle,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create deal');

      setLinkSent(true);
      // Reset form
      setForm({ client_name: '', client_email: '', client_phone: '', company_name: '', plan: 'standard', billing_cycle: 'monthly' });
      // Refresh deals list
      fetchData();
    } catch (err) {
      console.error('Generate link error:', err);
      setFormError(err.message || 'Failed to generate link. Please try again.');
    } finally {
      setGenerating(false);
    }
  };


  // ── Commissions grouped by deal ──────────────────────────────
  const commissionsByDeal = deals.reduce((acc, deal) => {
    acc[deal.id] = commissions.filter(c => c.deal_id === deal.id);
    return acc;
  }, {});

  const dealsWithCommissions = deals.filter(d => (commissionsByDeal[d.id] || []).length > 0);

  // ── Running totals across ALL commissions ────────────────────
  const { totalEarned, totalDue, totalPending } = calcCommissionTotals(commissions);

  // ── Render ───────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-900 pb-12">
      {/* Header */}
      <header className="bg-gray-900 border-b border-gray-700 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <p className="text-white font-semibold text-sm">
              {clientData?.company_name || 'Sales Rep Dashboard'}
            </p>
            <p className="text-gray-500 text-xs">{clientData?.email}</p>
          </div>
          <div className="flex items-center gap-2">
            {/* Show Demo button */}
            <button
              onClick={onShowDemo}
              className="flex items-center gap-1.5 px-3 py-2 bg-purple-700 text-white rounded-lg hover:bg-purple-600 text-sm font-medium"
              title="Preview the client dashboard demo"
            >
              <Play className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Show Demo</span>
            </button>
            <button
              onClick={onLogout}
              className="p-2 hover:bg-gray-800 rounded-lg"
              title="Sign out"
            >
              <LogOut className="w-5 h-5 text-gray-400" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-4">

        {/* ── Section A: New Deal Form ──────────────────────── */}
        <Section title="New Deal" icon={Plus} defaultOpen={true}>
          <div className="space-y-4 pt-4">
            {/* Commission option shown read-only */}
            <div className="p-3 bg-gray-750 rounded-lg border border-gray-600">
              <p className="text-xs text-gray-400 mb-0.5">Your commission</p>
              <p className="text-white text-sm font-medium">
                {commissionOptionLabel(clientData?.commission_option)}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-gray-400 text-sm mb-1">Client Name *</label>
                <input
                  type="text"
                  value={form.client_name}
                  onChange={e => setField('client_name', e.target.value)}
                  placeholder="Jane Smith"
                  className="w-full px-3 py-2 bg-gray-750 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 text-sm"
                />
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-1">Client Email *</label>
                <input
                  type="email"
                  value={form.client_email}
                  onChange={e => setField('client_email', e.target.value)}
                  placeholder="jane@acmehvac.com"
                  className="w-full px-3 py-2 bg-gray-750 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 text-sm"
                />
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-1">Client Phone</label>
                <input
                  type="tel"
                  value={form.client_phone}
                  onChange={e => setField('client_phone', e.target.value)}
                  placeholder="(555) 123-4567"
                  className="w-full px-3 py-2 bg-gray-750 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 text-sm"
                />
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-1">Company Name *</label>
                <input
                  type="text"
                  value={form.company_name}
                  onChange={e => setField('company_name', e.target.value)}
                  placeholder="Acme HVAC"
                  className="w-full px-3 py-2 bg-gray-750 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 text-sm"
                />
              </div>
            </div>

            {/* Plan selector */}
            <div>
              <label className="block text-gray-400 text-sm mb-1">Plan *</label>
              <select
                value={form.plan}
                onChange={e => setField('plan', e.target.value)}
                className="w-full px-3 py-2 bg-gray-750 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500 text-sm"
              >
                <option value="standard">Standard — $495/mo</option>
                <option value="pro">Pro — $695/mo</option>
              </select>
            </div>

            {/* Billing cycle radio */}
            <div>
              <label className="block text-gray-400 text-sm mb-2">Billing Cycle *</label>
              <div className="flex gap-3">
                {['monthly', 'annual'].map(cycle => (
                  <label key={cycle} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="billing_cycle"
                      value={cycle}
                      checked={form.billing_cycle === cycle}
                      onChange={() => setField('billing_cycle', cycle)}
                      className="accent-blue-500"
                    />
                    <span className="text-white text-sm capitalize">
                      {cycle}
                      {cycle === 'annual' && (
                        <span className="ml-1 text-xs text-green-400">+$200 bonus</span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {formError && (
              <p className="text-red-400 text-sm">{formError}</p>
            )}

            <button
              onClick={handleGenerateLink}
              disabled={generating}
              className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg disabled:opacity-50 font-medium ${
                linkSent
                  ? 'bg-gray-600 text-gray-300 hover:bg-gray-500'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              {generating
                ? <><RefreshCw className="w-4 h-4 animate-spin" /> Sending...</>
                : linkSent
                  ? <><Link className="w-4 h-4" /> Resend Onboarding Link</>
                  : <><Link className="w-4 h-4" /> Send Onboarding Link</>
              }
            </button>
          </div>
        </Section>

        {/* ── Section B: My Deals Pipeline ─────────────────────── */}
        <Section title="My Deals" icon={Briefcase} defaultOpen={true}>
          {dataLoading ? (
            <div className="py-6 text-center">
              <RefreshCw className="w-6 h-6 animate-spin text-blue-500 mx-auto mb-2" />
              <p className="text-gray-400 text-sm">Loading deals...</p>
            </div>
          ) : dataError ? (
            <div className="py-6 text-center">
              <p className="text-red-400 text-sm">{dataError}</p>
              <button onClick={fetchData} className="mt-2 text-blue-400 text-sm underline">Try again</button>
            </div>
          ) : deals.length === 0 ? (
            <div className="py-8 text-center">
              <Briefcase className="w-10 h-10 text-gray-600 mx-auto mb-3" />
              <p className="text-gray-400 text-sm">No deals yet.</p>
              <p className="text-gray-500 text-xs mt-1">Use the New Deal form above to create your first deal.</p>
            </div>
          ) : (
            <div className="pt-4 space-y-2">
              {/* Column headers — desktop only */}
              <div className="hidden sm:grid grid-cols-[2fr_2fr_1fr_1fr_1fr] gap-3 px-1 pb-1 border-b border-gray-700">
                <p className="text-gray-500 text-xs uppercase tracking-wide">Client</p>
                <p className="text-gray-500 text-xs uppercase tracking-wide">Company</p>
                <p className="text-gray-500 text-xs uppercase tracking-wide">Plan</p>
                <p className="text-gray-500 text-xs uppercase tracking-wide">Status</p>
                <p className="text-gray-500 text-xs uppercase tracking-wide">Created</p>
              </div>

              {deals.map(deal => {
                const statusCfg = getDealStatusConfig(deal.status);
                const createdDate = new Date(deal.created_at).toLocaleDateString('en-CA');
                return (
                  <div key={deal.id} className="bg-gray-750 rounded-lg p-3 border border-gray-600">
                    {/* Mobile layout: stacked */}
                    <div className="sm:hidden space-y-1">
                      <div className="flex items-center justify-between">
                        <p className="text-white font-medium text-sm">{deal.client_name}</p>
                        <Badge config={statusCfg} />
                      </div>
                      <p className="text-gray-400 text-xs">{deal.company_name}</p>
                      <div className="flex items-center justify-between">
                        <p className="text-gray-300 text-xs">{formatPlanLabel(deal.plan, deal.billing_cycle)}</p>
                        <p className="text-gray-500 text-xs">{createdDate}</p>
                      </div>
                    </div>

                    {/* Desktop layout: grid */}
                    <div className="hidden sm:grid grid-cols-[2fr_2fr_1fr_1fr_1fr] gap-3 items-center">
                      <p className="text-white text-sm font-medium truncate">{deal.client_name}</p>
                      <p className="text-gray-300 text-sm truncate">{deal.company_name}</p>
                      <p className="text-gray-300 text-sm">{formatPlanLabel(deal.plan, deal.billing_cycle)}</p>
                      <Badge config={statusCfg} />
                      <p className="text-gray-500 text-xs">{createdDate}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Section>

        {/* ── Section C: My Commissions ─────────────────────────── */}
        <Section title="My Commissions" icon={DollarSign} defaultOpen={true}>
          {/* Running totals */}
          <div className="grid grid-cols-3 gap-3 pt-4 mb-4">
            <div className="bg-green-900/30 border border-green-800 rounded-lg p-3 text-center">
              <p className="text-green-300 text-xs mb-1">Total Earned</p>
              <p className="text-white font-bold text-lg">{formatCurrency(totalEarned)}</p>
            </div>
            <div className="bg-yellow-900/30 border border-yellow-800 rounded-lg p-3 text-center">
              <p className="text-yellow-300 text-xs mb-1">Total Due</p>
              <p className="text-white font-bold text-lg">{formatCurrency(totalDue)}</p>
            </div>
            <div className="bg-gray-700/50 border border-gray-600 rounded-lg p-3 text-center">
              <p className="text-gray-400 text-xs mb-1">Pending</p>
              <p className="text-white font-bold text-lg">{formatCurrency(totalPending)}</p>
            </div>
          </div>

          {dataLoading ? (
            <div className="py-4 text-center">
              <RefreshCw className="w-5 h-5 animate-spin text-blue-500 mx-auto" />
            </div>
          ) : dealsWithCommissions.length === 0 ? (
            <div className="py-6 text-center">
              <TrendingUp className="w-10 h-10 text-gray-600 mx-auto mb-3" />
              <p className="text-gray-400 text-sm">No commissions yet.</p>
              <p className="text-gray-500 text-xs mt-1">Commissions are recorded when a client goes live.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {dealsWithCommissions.map(deal => {
                const dealCommissions = commissionsByDeal[deal.id] || [];
                const upfront = dealCommissions.find(c => c.type === 'upfront');
                const residuals = dealCommissions
                  .filter(c => c.type === 'residual')
                  .sort((a, b) => (a.month_number || 0) - (b.month_number || 0));
                const isExpanded = expandedDealId === deal.id;

                return (
                  <div key={deal.id} className="bg-gray-750 rounded-lg border border-gray-600 overflow-hidden">
                    {/* Deal header row */}
                    <button
                      className="w-full flex items-center justify-between p-3 hover:bg-gray-700 text-left"
                      onClick={() => setExpandedDealId(isExpanded ? null : deal.id)}
                    >
                      <div>
                        <p className="text-white font-medium text-sm">{deal.client_name}</p>
                        <p className="text-gray-400 text-xs">{deal.company_name} — {formatPlanLabel(deal.plan, deal.billing_cycle)}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {upfront && (
                          <div className="text-right">
                            <p className="text-white text-sm font-medium">{formatCurrency(upfront.amount)}</p>
                            <p className="text-gray-500 text-xs">upfront</p>
                          </div>
                        )}
                        {isExpanded
                          ? <ChevronUp className="w-4 h-4 text-gray-400" />
                          : <ChevronDown className="w-4 h-4 text-gray-400" />
                        }
                      </div>
                    </button>

                    {/* Expanded commission details */}
                    {isExpanded && (
                      <div className="border-t border-gray-600 p-3 space-y-3">
                        {/* Upfront commission */}
                        {upfront && (
                          <div className="flex items-center justify-between py-2 border-b border-gray-700">
                            <div>
                              <p className="text-gray-300 text-sm">Upfront Commission</p>
                              {upfront.due_date && (
                                <p className="text-gray-500 text-xs">Due: {upfront.due_date}</p>
                              )}
                              {upfront.paid_at && (
                                <p className="text-gray-500 text-xs">
                                  Paid: {new Date(upfront.paid_at).toLocaleDateString('en-CA')}
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <p className="text-white font-medium">{formatCurrency(upfront.amount)}</p>
                              <Badge config={getCommissionStatusConfig(upfront.status)} />
                            </div>
                          </div>
                        )}

                        {/* Residual schedule (Option 2 only) */}
                        {residuals.length > 0 && (
                          <div>
                            <p className="text-gray-400 text-xs uppercase tracking-wide mb-2">Residual Schedule</p>
                            <div className="space-y-1.5">
                              {/* Column headers */}
                              <div className="grid grid-cols-[auto_1fr_1fr_1fr] gap-2 px-1">
                                <p className="text-gray-600 text-xs w-12">Month</p>
                                <p className="text-gray-600 text-xs">Amount</p>
                                <p className="text-gray-600 text-xs">Due Date</p>
                                <p className="text-gray-600 text-xs">Status</p>
                              </div>
                              {residuals.map(r => (
                                <div
                                  key={r.id}
                                  className={`grid grid-cols-[auto_1fr_1fr_1fr] gap-2 px-1 py-1 rounded ${
                                    r.status === 'paid' ? 'opacity-60' : ''
                                  }`}
                                >
                                  <p className="text-gray-400 text-xs w-12">Month {r.month_number}</p>
                                  <p className="text-white text-xs">{formatCurrency(r.amount)}</p>
                                  <p className="text-gray-400 text-xs">{r.due_date || '—'}</p>
                                  <Badge config={getCommissionStatusConfig(r.status)} />
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Section>

      </main>
    </div>
  );
};

export default SalesRepDashboard;
