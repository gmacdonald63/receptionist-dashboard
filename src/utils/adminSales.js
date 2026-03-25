/**
 * Pure helper functions for the Admin Sales Panel.
 * No Supabase imports — all functions are deterministic and easily testable.
 */

/**
 * Group commission records by rep and compute per-rep totals.
 *
 * @param {Array<{
 *   rep_id: string,
 *   amount: number|string,
 *   status: string,
 *   rep: { email: string, company_name: string, commission_option: number } | null
 * }>} commissions
 * @returns {Array<{
 *   rep_id: string,
 *   rep_name: string,
 *   rep_email: string,
 *   commission_option: number|null,
 *   total_paid: number,
 *   total_due: number,
 *   total_pending: number,
 * }>}
 */
export function summarizeRepCommissions(commissions) {
  const byRep = {};

  for (const c of commissions) {
    const repId = c.rep_id;
    if (!byRep[repId]) {
      byRep[repId] = {
        rep_id: repId,
        rep_name: c.rep?.company_name || c.rep?.email || 'Unknown',
        rep_email: c.rep?.email || '',
        commission_option: c.rep?.commission_option ?? null,
        total_paid: 0,
        total_due: 0,
        total_pending: 0,
      };
    }

    const amount = parseFloat(c.amount) || 0;
    if (c.status === 'paid') byRep[repId].total_paid += amount;
    else if (c.status === 'due') byRep[repId].total_due += amount;
    else if (c.status === 'pending') byRep[repId].total_pending += amount;
    // voided: excluded from all totals
  }

  return Object.values(byRep);
}

/**
 * Format a commission record's type as a human-readable string.
 *
 * @param {{ type: string, month_number: number|null }} commission
 * @returns {string} e.g. "Upfront" or "Residual Month 3"
 */
export function formatCommissionType(commission) {
  if (commission.type === 'upfront') return 'Upfront';
  if (commission.type === 'residual') {
    const n = commission.month_number;
    return n != null ? `Residual Month ${n}` : 'Residual';
  }
  return 'Unknown';
}

/**
 * Filter deals array client-side by rep, status, and date range.
 *
 * @param {Array<{
 *   rep_id: string,
 *   status: string,
 *   created_at: string,
 *   rep?: { id: string } | null,
 * }>} deals
 * @param {{
 *   repId?: string,
 *   status?: string,
 *   dateFrom?: string,
 *   dateTo?: string,
 * }} filters
 * @returns {Array} Filtered deals
 */
export function filterDeals(deals, filters = {}) {
  const { repId, status, dateFrom, dateTo } = filters;

  return deals.filter(deal => {
    // Filter by rep
    if (repId && String(deal.rep_id) !== String(repId)) return false;

    // Filter by status
    if (status && status !== 'all' && deal.status !== status) return false;

    // Filter by date range (created_at)
    if (dateFrom) {
      const dealDate = deal.created_at ? deal.created_at.slice(0, 10) : '';
      if (dealDate < dateFrom) return false;
    }
    if (dateTo) {
      const dealDate = deal.created_at ? deal.created_at.slice(0, 10) : '';
      if (dealDate > dateTo) return false;
    }

    return true;
  });
}
