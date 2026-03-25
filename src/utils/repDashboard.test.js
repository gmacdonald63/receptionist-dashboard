import { describe, it, expect } from 'vitest';
import {
  formatCurrency,
  getDealStatusConfig,
  getCommissionStatusConfig,
  calcCommissionTotals,
  formatPlanLabel,
} from './repDashboard.js';

describe('formatCurrency', () => {
  it('formats a whole dollar amount', () => {
    expect(formatCurrency(495)).toBe('$495.00');
  });

  it('formats cents correctly', () => {
    expect(formatCurrency(247.5)).toBe('$247.50');
  });

  it('formats zero', () => {
    expect(formatCurrency(0)).toBe('$0.00');
  });

  it('formats a string-numeric value', () => {
    expect(formatCurrency('69.50')).toBe('$69.50');
  });
});

describe('getDealStatusConfig', () => {
  it('returns yellow config for onboarding_sent', () => {
    const cfg = getDealStatusConfig('onboarding_sent');
    expect(cfg.label).toBe('Onboarding Sent');
    expect(cfg.badgeClass).toContain('yellow');
  });

  it('returns blue config for setup_in_progress', () => {
    const cfg = getDealStatusConfig('setup_in_progress');
    expect(cfg.label).toBe('Setup in Progress');
    expect(cfg.badgeClass).toContain('blue');
  });

  it('returns green config for active', () => {
    const cfg = getDealStatusConfig('active');
    expect(cfg.label).toBe('Active');
    expect(cfg.badgeClass).toContain('green');
  });

  it('returns red config for cancelled', () => {
    const cfg = getDealStatusConfig('cancelled');
    expect(cfg.label).toBe('Cancelled');
    expect(cfg.badgeClass).toContain('red');
  });

  it('returns gray config for unknown status', () => {
    const cfg = getDealStatusConfig('unknown_status');
    expect(cfg.label).toBe('Unknown');
    expect(cfg.badgeClass).toContain('gray');
  });
});

describe('getCommissionStatusConfig', () => {
  it('returns gray config for pending', () => {
    const cfg = getCommissionStatusConfig('pending');
    expect(cfg.label).toBe('Pending');
    expect(cfg.badgeClass).toContain('gray');
  });

  it('returns yellow config for due', () => {
    const cfg = getCommissionStatusConfig('due');
    expect(cfg.label).toBe('Due');
    expect(cfg.badgeClass).toContain('yellow');
  });

  it('returns green config for paid', () => {
    const cfg = getCommissionStatusConfig('paid');
    expect(cfg.label).toBe('Paid');
    expect(cfg.badgeClass).toContain('green');
  });

  it('returns red config for voided', () => {
    const cfg = getCommissionStatusConfig('voided');
    expect(cfg.label).toBe('Voided');
    expect(cfg.badgeClass).toContain('red');
  });
});

describe('calcCommissionTotals', () => {
  const commissions = [
    { amount: '495.00', status: 'paid' },
    { amount: '247.50', status: 'due' },
    { amount: '49.50', status: 'pending' },
    { amount: '49.50', status: 'voided' },
  ];

  it('sums paid commissions as totalEarned', () => {
    const { totalEarned } = calcCommissionTotals(commissions);
    expect(totalEarned).toBe(495.00);
  });

  it('sums due commissions as totalDue', () => {
    const { totalDue } = calcCommissionTotals(commissions);
    expect(totalDue).toBe(247.50);
  });

  it('sums pending commissions as totalPending', () => {
    const { totalPending } = calcCommissionTotals(commissions);
    expect(totalPending).toBe(49.50);
  });

  it('excludes voided commissions from all totals', () => {
    const { totalEarned, totalDue, totalPending } = calcCommissionTotals(commissions);
    expect(totalEarned + totalDue + totalPending).toBe(792.00);
  });

  it('returns zeros for an empty array', () => {
    const { totalEarned, totalDue, totalPending } = calcCommissionTotals([]);
    expect(totalEarned).toBe(0);
    expect(totalDue).toBe(0);
    expect(totalPending).toBe(0);
  });
});

describe('formatPlanLabel', () => {
  it('formats standard monthly', () => {
    expect(formatPlanLabel('standard', 'monthly')).toBe('Standard / Monthly');
  });

  it('formats pro annual', () => {
    expect(formatPlanLabel('pro', 'annual')).toBe('Pro / Annual');
  });

  it('capitalizes the plan name', () => {
    expect(formatPlanLabel('standard', 'annual')).toBe('Standard / Annual');
  });
});
