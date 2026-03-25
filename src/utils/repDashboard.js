/**
 * Format a numeric (or string-numeric) value as a USD currency string.
 * @param {number|string} amount
 * @returns {string} e.g. "$247.50"
 */
export function formatCurrency(amount) {
  return '$' + parseFloat(amount).toFixed(2);
}

/**
 * Get display config for a deal status value.
 * @param {string} status - 'onboarding_sent' | 'setup_in_progress' | 'active' | 'cancelled'
 * @returns {{ label: string, badgeClass: string }}
 */
export function getDealStatusConfig(status) {
  switch (status) {
    case 'onboarding_sent':
      return { label: 'Onboarding Sent', badgeClass: 'bg-yellow-900 text-yellow-300' };
    case 'setup_in_progress':
      return { label: 'Setup in Progress', badgeClass: 'bg-blue-900 text-blue-300' };
    case 'active':
      return { label: 'Active', badgeClass: 'bg-green-900 text-green-300' };
    case 'cancelled':
      return { label: 'Cancelled', badgeClass: 'bg-red-900 text-red-300' };
    default:
      return { label: 'Unknown', badgeClass: 'bg-gray-700 text-gray-300' };
  }
}

/**
 * Get display config for a commission status value.
 * @param {string} status - 'pending' | 'due' | 'paid' | 'voided'
 * @returns {{ label: string, badgeClass: string }}
 */
export function getCommissionStatusConfig(status) {
  switch (status) {
    case 'pending':
      return { label: 'Pending', badgeClass: 'bg-gray-700 text-gray-300' };
    case 'due':
      return { label: 'Due', badgeClass: 'bg-yellow-900 text-yellow-300' };
    case 'paid':
      return { label: 'Paid', badgeClass: 'bg-green-900 text-green-300' };
    case 'voided':
      return { label: 'Voided', badgeClass: 'bg-red-900 text-red-300' };
    default:
      return { label: 'Unknown', badgeClass: 'bg-gray-700 text-gray-300' };
  }
}

/**
 * Calculate running totals across an array of commission records.
 * Voided commissions are excluded from all totals.
 * @param {Array<{ amount: number|string, status: string }>} commissions
 * @returns {{ totalEarned: number, totalDue: number, totalPending: number }}
 */
export function calcCommissionTotals(commissions) {
  let totalEarned = 0;
  let totalDue = 0;
  let totalPending = 0;

  for (const c of commissions) {
    const amount = parseFloat(c.amount);
    if (c.status === 'paid') totalEarned += amount;
    else if (c.status === 'due') totalDue += amount;
    else if (c.status === 'pending') totalPending += amount;
    // voided: excluded from all totals
  }

  return { totalEarned, totalDue, totalPending };
}

/**
 * Format a plan + billing cycle as a human-readable label.
 * @param {string} plan - 'standard' | 'pro'
 * @param {string} billingCycle - 'monthly' | 'annual'
 * @returns {string} e.g. "Standard / Monthly"
 */
export function formatPlanLabel(plan, billingCycle) {
  const planLabel = plan.charAt(0).toUpperCase() + plan.slice(1);
  const cycleLabel = billingCycle.charAt(0).toUpperCase() + billingCycle.slice(1);
  return `${planLabel} / ${cycleLabel}`;
}
