// src/pages/AdminSalesPanel.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Check, DollarSign, Briefcase, Users, ChevronDown } from 'lucide-react';
import { supabase } from '../supabaseClient';
import {
  getDealStatusConfig,
  getCommissionStatusConfig,
  formatCurrency,
  formatPlanLabel,
} from '../utils/repDashboard';
import {
  summarizeRepCommissions,
  formatCommissionType,
  filterDeals,
} from '../utils/adminSales';

const SUPABASE_URL = 'https://zmppdmfdhknnwzwdfhwf.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InptcHBkbWZkaGtubnd6d2RmaHdmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4MzQyMDYsImV4cCI6MjA4NTQxMDIwNn0.mXfuz8mEZhizFen78gUaakBDbrzANn4ZM1a7KuDiKJs';

// ── Reusable badge ───────────────────────────────────────────────────────────
const Badge = ({ config }) => (
  <span className={`px-2 py-1 rounded text-xs font-medium whitespace-nowrap ${config.badgeClass}`}>
    {config.label}
  </span>
);

// ── Section wrapper ──────────────────────────────────────────────────────────
const Section = ({ title, icon: Icon, children }) => (
  <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden mb-6">
    <div className="flex items-center gap-2 p-4 border-b border-gray-700">
      {Icon && <Icon className="w-5 h-5 text-gray-400" />}
      <h2 className="font-semibold text-white">{title}</h2>
    </div>
    <div className="p-4">{children}</div>
  </div>
);

// ── Filter row ───────────────────────────────────────────────────────────────
const FilterSelect = ({ label, value, onChange, children }) => (
  <div className="flex flex-col gap-1">
    <label className="text-gray-400 text-xs">{label}</label>
    <div className="relative">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-2 bg-gray-750 border border-gray-600 rounded-lg text-white text-sm appearance-none focus:outline-none focus:border-blue-500 pr-8"
        style={{ backgroundColor: '#2d3748' }}
      >
        {children}
      </select>
      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
    </div>
  </div>
);

const FilterDate = ({ label, value, onChange }) => (
  <div className="flex flex-col gap-1">
    <label className="text-gray-400 text-xs">{label}</label>
    <input
      type="date"
      value={value}
      onChange={e => onChange(e.target.value)}
      className="px-3 py-2 bg-gray-750 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
      style={{ backgroundColor: '#2d3748' }}
    />
  </div>
);

// ── Main component ───────────────────────────────────────────────────────────
const AdminSalesPanel = ({ session }) => {
  // ── Data ──────────────────────────────────────────────────────────────────
  const [deals, setDeals] = useState([]);
  const [commissions, setCommissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // ── Optimistic paid tracking ───────────────────────────────────────────────
  const [markingPaid, setMarkingPaid] = useState({}); // { [commissionId]: true }
  const [markPaidError, setMarkPaidError] = useState(null);
  const [markPaidSuccess, setMarkPaidSuccess] = useState(null);

  // ── Deal filters ──────────────────────────────────────────────────────────
  const [dealRepFilter, setDealRepFilter] = useState('');
  const [dealStatusFilter, setDealStatusFilter] = useState('all');
  const [dealDateFrom, setDealDateFrom] = useState('');
  const [dealDateTo, setDealDateTo] = useState('');

  // ── Commission filters ─────────────────────────────────────────────────────
  const [commRepFilter, setCommRepFilter] = useState('');
  const [commStatusFilter, setCommStatusFilter] = useState('all');

  // ── Fetch all data ─────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [dealsResult, commissionsResult] = await Promise.all([
        supabase
          .from('deals')
          .select('*, rep:rep_id(id, email, company_name, commission_option)')
          .order('created_at', { ascending: false }),
        supabase
          .from('commissions')
          .select('*, deal:deal_id(client_name, company_name), rep:rep_id(email, company_name, commission_option)')
          .order('created_at', { ascending: false }),
      ]);

      if (dealsResult.error) throw dealsResult.error;
      if (commissionsResult.error) throw commissionsResult.error;

      setDeals(dealsResult.data || []);
      setCommissions(commissionsResult.data || []);
    } catch (err) {
      console.error('AdminSalesPanel fetch error:', err);
      setError('Failed to load sales data. Please refresh.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Clear success/error messages after 5s
  useEffect(() => {
    if (markPaidSuccess) {
      const t = setTimeout(() => setMarkPaidSuccess(null), 5000);
      return () => clearTimeout(t);
    }
  }, [markPaidSuccess]);

  // ── Mark commission as paid ────────────────────────────────────────────────
  const handleMarkPaid = async (commission) => {
    setMarkingPaid(prev => ({ ...prev, [commission.id]: true }));
    setMarkPaidError(null);

    // Optimistic update
    const paidAt = new Date().toISOString();
    setCommissions(prev =>
      prev.map(c =>
        c.id === commission.id ? { ...c, status: 'paid', paid_at: paidAt } : c
      )
    );

    try {
      // 1. Update the commission record in Supabase
      const { error: updateError } = await supabase
        .from('commissions')
        .update({ status: 'paid', paid_at: paidAt })
        .eq('id', commission.id);

      if (updateError) throw updateError;

      // 2. Call send-notification edge function
      let accessToken = session?.access_token;
      if (!accessToken) {
        try {
          const { data: { session: freshSession } } = await supabase.auth.getSession();
          accessToken = freshSession?.access_token;
        } catch { /* ignore */ }
      }
      if (accessToken) {
        try {
          await fetch(`${SUPABASE_URL}/functions/v1/send-notification`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${accessToken}`,
              'apikey': ANON_KEY,
            },
            body: JSON.stringify({
              template: 'commission_paid_rep',
              deal_id: commission.deal_id,
              extra: { commission_id: commission.id },
            }),
          });
        } catch (notifErr) {
          // Non-fatal: notification failure should not roll back the payment
          console.warn('send-notification failed (non-fatal):', notifErr);
        }
      }

      setMarkPaidSuccess(`Commission marked as paid.`);
    } catch (err) {
      console.error('Mark as paid error:', err);
      // Revert optimistic update
      setCommissions(prev =>
        prev.map(c =>
          c.id === commission.id ? { ...c, status: 'due', paid_at: null } : c
        )
      );
      setMarkPaidError('Failed to mark commission as paid. Please try again.');
    } finally {
      setMarkingPaid(prev => {
        const next = { ...prev };
        delete next[commission.id];
        return next;
      });
    }
  };

  // ── Derived: unique reps from deals ───────────────────────────────────────
  const repsFromDeals = Object.values(
    deals.reduce((acc, deal) => {
      if (deal.rep && !acc[deal.rep_id]) {
        acc[deal.rep_id] = {
          id: String(deal.rep_id),
          name: deal.rep.company_name || deal.rep.email || `Rep ${deal.rep_id}`,
        };
      }
      return acc;
    }, {})
  );

  // ── Derived: unique reps from commissions ──────────────────────────────────
  const repsFromCommissions = Object.values(
    commissions.reduce((acc, c) => {
      if (!acc[c.rep_id]) {
        acc[c.rep_id] = {
          id: String(c.rep_id),
          name: c.rep?.company_name || c.rep?.email || `Rep ${c.rep_id}`,
        };
      }
      return acc;
    }, {})
  );

  // ── Filtered deals ─────────────────────────────────────────────────────────
  const filteredDeals = filterDeals(deals, {
    repId: dealRepFilter || undefined,
    status: dealStatusFilter,
    dateFrom: dealDateFrom || undefined,
    dateTo: dealDateTo || undefined,
  });

  // ── Filtered commissions ───────────────────────────────────────────────────
  const filteredCommissions = commissions.filter(c => {
    if (commRepFilter && String(c.rep_id) !== commRepFilter) return false;
    if (commStatusFilter && commStatusFilter !== 'all' && c.status !== commStatusFilter) return false;
    return true;
  });

  // ── Per-rep summaries ──────────────────────────────────────────────────────
  const repSummaries = summarizeRepCommissions(commissions);

  // ── Loading state ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="py-16 text-center">
        <RefreshCw className="w-8 h-8 animate-spin text-blue-500 mx-auto mb-4" />
        <p className="text-gray-400">Loading sales data...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-8 text-center">
        <p className="text-red-400 mb-3">{error}</p>
        <button
          onClick={fetchData}
          className="px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 text-sm"
        >
          Try Again
        </button>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Feedback messages */}
      {markPaidSuccess && (
        <div className="p-3 bg-green-900/50 border border-green-700 rounded-lg flex items-center gap-2">
          <Check className="w-4 h-4 text-green-400 flex-shrink-0" />
          <p className="text-green-300 text-sm">{markPaidSuccess}</p>
        </div>
      )}
      {markPaidError && (
        <div className="p-3 bg-red-900/50 border border-red-700 rounded-lg">
          <p className="text-red-300 text-sm">{markPaidError}</p>
        </div>
      )}

      {/* ── All Deals ──────────────────────────────────────────────────────── */}
      <Section title="All Deals" icon={Briefcase}>
        {/* Filters */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <FilterSelect label="Rep" value={dealRepFilter} onChange={setDealRepFilter}>
            <option value="">All Reps</option>
            {repsFromDeals.map(rep => (
              <option key={rep.id} value={rep.id}>{rep.name}</option>
            ))}
          </FilterSelect>

          <FilterSelect label="Status" value={dealStatusFilter} onChange={setDealStatusFilter}>
            <option value="all">All Statuses</option>
            <option value="onboarding_sent">Onboarding Sent</option>
            <option value="setup_in_progress">Setup in Progress</option>
            <option value="active">Active</option>
            <option value="cancelled">Cancelled</option>
          </FilterSelect>

          <FilterDate label="From" value={dealDateFrom} onChange={setDealDateFrom} />
          <FilterDate label="To" value={dealDateTo} onChange={setDealDateTo} />
        </div>

        {filteredDeals.length === 0 ? (
          <div className="py-10 text-center">
            <Briefcase className="w-10 h-10 text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400 text-sm">No deals match the current filters.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="text-left py-2 pr-4 text-gray-500 font-medium text-xs uppercase tracking-wide">Rep</th>
                  <th className="text-left py-2 pr-4 text-gray-500 font-medium text-xs uppercase tracking-wide">Client / Company</th>
                  <th className="text-left py-2 pr-4 text-gray-500 font-medium text-xs uppercase tracking-wide">Plan</th>
                  <th className="text-left py-2 pr-4 text-gray-500 font-medium text-xs uppercase tracking-wide">Status</th>
                  <th className="text-left py-2 pr-4 text-gray-500 font-medium text-xs uppercase tracking-wide">Setup Fee Paid</th>
                  <th className="text-left py-2 text-gray-500 font-medium text-xs uppercase tracking-wide">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {filteredDeals.map(deal => (
                  <tr key={deal.id} className="hover:bg-gray-750 transition-colors">
                    <td className="py-3 pr-4 text-white">
                      {deal.rep?.company_name || deal.rep?.email || '—'}
                    </td>
                    <td className="py-3 pr-4">
                      <p className="text-white font-medium">{deal.client_name}</p>
                      <p className="text-gray-400 text-xs">{deal.company_name}</p>
                    </td>
                    <td className="py-3 pr-4 text-gray-300">
                      {formatPlanLabel(deal.plan, deal.billing_cycle)}
                    </td>
                    <td className="py-3 pr-4">
                      <Badge config={getDealStatusConfig(deal.status)} />
                    </td>
                    <td className="py-3 pr-4 text-gray-300 text-xs">
                      {deal.stripe_setup_payment_id
                        ? deal.updated_at
                          ? new Date(deal.updated_at).toLocaleDateString()
                          : '—'
                        : '—'}
                    </td>
                    <td className="py-3 text-gray-400 text-xs">
                      {new Date(deal.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ── All Commissions ────────────────────────────────────────────────── */}
      <Section title="All Commissions" icon={DollarSign}>
        {/* Filters */}
        <div className="grid grid-cols-2 gap-3 mb-4 max-w-sm">
          <FilterSelect label="Rep" value={commRepFilter} onChange={setCommRepFilter}>
            <option value="">All Reps</option>
            {repsFromCommissions.map(rep => (
              <option key={rep.id} value={rep.id}>{rep.name}</option>
            ))}
          </FilterSelect>

          <FilterSelect label="Status" value={commStatusFilter} onChange={setCommStatusFilter}>
            <option value="all">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="due">Due</option>
            <option value="paid">Paid</option>
            <option value="voided">Voided</option>
          </FilterSelect>
        </div>

        {filteredCommissions.length === 0 ? (
          <div className="py-10 text-center">
            <DollarSign className="w-10 h-10 text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400 text-sm">No commissions match the current filters.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="text-left py-2 pr-4 text-gray-500 font-medium text-xs uppercase tracking-wide">Rep</th>
                  <th className="text-left py-2 pr-4 text-gray-500 font-medium text-xs uppercase tracking-wide">Client</th>
                  <th className="text-left py-2 pr-4 text-gray-500 font-medium text-xs uppercase tracking-wide">Type</th>
                  <th className="text-left py-2 pr-4 text-gray-500 font-medium text-xs uppercase tracking-wide">Amount</th>
                  <th className="text-left py-2 pr-4 text-gray-500 font-medium text-xs uppercase tracking-wide">Status</th>
                  <th className="text-left py-2 pr-4 text-gray-500 font-medium text-xs uppercase tracking-wide">Due Date</th>
                  <th className="text-left py-2 pr-4 text-gray-500 font-medium text-xs uppercase tracking-wide">Paid Date</th>
                  <th className="text-left py-2 text-gray-500 font-medium text-xs uppercase tracking-wide">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {filteredCommissions.map(c => {
                  const isPaying = !!markingPaid[c.id];
                  return (
                    <tr key={c.id} className="hover:bg-gray-750 transition-colors">
                      <td className="py-3 pr-4 text-white">
                        {c.rep?.company_name || c.rep?.email || '—'}
                      </td>
                      <td className="py-3 pr-4 text-gray-300">
                        {c.deal?.client_name || '—'}
                      </td>
                      <td className="py-3 pr-4 text-gray-300">
                        {formatCommissionType(c)}
                      </td>
                      <td className="py-3 pr-4 text-white font-medium">
                        {formatCurrency(c.amount)}
                      </td>
                      <td className="py-3 pr-4">
                        <Badge config={getCommissionStatusConfig(c.status)} />
                      </td>
                      <td className="py-3 pr-4 text-gray-400 text-xs">
                        {c.due_date || '—'}
                      </td>
                      <td className="py-3 pr-4 text-gray-400 text-xs">
                        {c.paid_at
                          ? new Date(c.paid_at).toLocaleDateString()
                          : '—'}
                      </td>
                      <td className="py-3">
                        {c.status === 'due' ? (
                          <button
                            onClick={() => handleMarkPaid(c)}
                            disabled={isPaying}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-green-700 text-white rounded-lg hover:bg-green-600 disabled:opacity-50 text-xs font-medium whitespace-nowrap"
                          >
                            {isPaying
                              ? <RefreshCw className="w-3 h-3 animate-spin" />
                              : <Check className="w-3 h-3" />
                            }
                            {isPaying ? 'Saving...' : 'Mark as Paid'}
                          </button>
                        ) : c.status === 'paid' && c.paid_at ? (
                          <span className="text-green-400 text-xs">
                            Paid {new Date(c.paid_at).toLocaleDateString()}
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ── Per-Rep Summary Cards ──────────────────────────────────────────── */}
      <Section title="Rep Summaries" icon={Users}>
        {repSummaries.length === 0 ? (
          <div className="py-10 text-center">
            <Users className="w-10 h-10 text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400 text-sm">No commission records yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {repSummaries.map(rep => (
              <div
                key={rep.rep_id}
                className="bg-gray-750 border border-gray-600 rounded-lg p-4 space-y-3"
                style={{ backgroundColor: '#2d3748' }}
              >
                <div>
                  <p className="text-white font-semibold">{rep.rep_name}</p>
                  <p className="text-gray-400 text-xs">
                    {rep.commission_option === 1
                      ? 'Option 1 — Full Upfront'
                      : rep.commission_option === 2
                        ? 'Option 2 — Split + Residual'
                        : 'Commission option not set'}
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-2 pt-1">
                  <div className="text-center p-2 bg-green-900/30 border border-green-800 rounded-lg">
                    <p className="text-green-300 text-xs mb-0.5">Paid</p>
                    <p className="text-white font-bold text-sm">{formatCurrency(rep.total_paid)}</p>
                  </div>
                  <div className="text-center p-2 bg-yellow-900/30 border border-yellow-800 rounded-lg">
                    <p className="text-yellow-300 text-xs mb-0.5">Due</p>
                    <p className="text-white font-bold text-sm">{formatCurrency(rep.total_due)}</p>
                  </div>
                  <div className="text-center p-2 bg-gray-700/50 border border-gray-600 rounded-lg">
                    <p className="text-gray-400 text-xs mb-0.5">Pending</p>
                    <p className="text-white font-bold text-sm">{formatCurrency(rep.total_pending)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
};

export default AdminSalesPanel;
