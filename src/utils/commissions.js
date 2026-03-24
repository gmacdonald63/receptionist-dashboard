/**
 * Commission calculation utilities for the sales rep commission system.
 *
 * These are pure functions — no Supabase calls, no side effects.
 * All commission records returned are ready to insert into the commissions table.
 *
 * Commission Options:
 *   Option 1 — Full Upfront: one-time payment equal to the monthly plan price
 *              (+ $200 bonus if the client is on an annual plan)
 *   Option 2 — Split + Residual: 50% upfront + 10%/month for 12 months
 *              Month 1 residual is due the same day as the upfront payment.
 *              (+ $200 bonus added to upfront if annual)
 */

/** Monthly subscription prices by plan */
const PLAN_PRICES = {
  standard: 495,
  pro: 695,
};

/** Bonus added to upfront commission when client pays annually */
const ANNUAL_BONUS = 200;

/**
 * Calculate all commission records for a newly activated deal.
 *
 * @param {Object} deal
 * @param {string}           deal.id           - Deal UUID
 * @param {number}           deal.rep_id       - Rep's BIGINT client ID
 * @param {'standard'|'pro'} deal.plan         - Subscription plan
 * @param {'monthly'|'annual'} deal.billing_cycle - Billing cycle
 * @param {1|2} commissionOption               - Rep's commission option (from clients.commission_option)
 * @param {Date} [baseDate=new Date()]          - Base date for due_date calculation (injectable for tests)
 * @returns {Array<Object>}                     - Records ready to insert into commissions table
 */
export function calculateCommissions(deal, commissionOption, baseDate = new Date()) {
  const monthlyPrice = PLAN_PRICES[deal.plan];
  if (!monthlyPrice) {
    throw new Error(`Unknown plan: ${deal.plan}. Must be 'standard' or 'pro'.`);
  }

  const isAnnual = deal.billing_cycle === 'annual';

  if (commissionOption === 1) {
    return _calculateOption1(deal, monthlyPrice, isAnnual, baseDate);
  }
  if (commissionOption === 2) {
    return _calculateOption2(deal, monthlyPrice, isAnnual, baseDate);
  }
  throw new Error(`Unknown commission option: ${commissionOption}. Must be 1 or 2.`);
}

/**
 * Option 1: Single upfront payment equal to monthly plan price (+ $200 if annual).
 * @private
 */
function _calculateOption1(deal, monthlyPrice, isAnnual, baseDate) {
  return [
    {
      deal_id: deal.id,
      rep_id: deal.rep_id,
      type: 'upfront',
      month_number: null,
      amount: monthlyPrice + (isAnnual ? ANNUAL_BONUS : 0),
      status: 'due',
      due_date: _formatDate(baseDate),
    },
  ];
}

/**
 * Option 2: 50% upfront (+ $200 if annual) + 10%/month × 12 months.
 * Month 1 residual is due the same day as the upfront.
 * Months 2–12 are scheduled monthly and start as 'pending'.
 * @private
 */
function _calculateOption2(deal, monthlyPrice, isAnnual, baseDate) {
  const upfrontAmount = (monthlyPrice * 0.5) + (isAnnual ? ANNUAL_BONUS : 0);
  const residualAmount = monthlyPrice * 0.1;

  const records = [
    {
      deal_id: deal.id,
      rep_id: deal.rep_id,
      type: 'upfront',
      month_number: null,
      amount: upfrontAmount,
      status: 'due',
      due_date: _formatDate(baseDate),
    },
  ];

  // 12 monthly residuals — month 1 due same day as upfront
  for (let month = 1; month <= 12; month++) {
    records.push({
      deal_id: deal.id,
      rep_id: deal.rep_id,
      type: 'residual',
      month_number: month,
      amount: residualAmount,
      status: month === 1 ? 'due' : 'pending',
      due_date: _formatDate(_addMonths(baseDate, month - 1)),
    });
  }

  return records;
}

/**
 * Format a Date as an ISO date string (YYYY-MM-DD).
 * Note: uses UTC date to ensure consistency regardless of server timezone.
 * @param {Date} date
 * @returns {string}
 */
function _formatDate(date) {
  return date.toISOString().split('T')[0];
}

/**
 * Return a new Date with N months added.
 * Uses day-of-month clamping (e.g., Jan 31 + 1 month = Feb 28).
 * @param {Date} date
 * @param {number} months
 * @returns {Date}
 */
function _addMonths(date, months) {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}
