import { describe, it, expect } from 'vitest';
import {
  summarizeRepCommissions,
  formatCommissionType,
  filterDeals,
} from './adminSales.js';

// ── summarizeRepCommissions ──────────────────────────────────────────────────

describe('summarizeRepCommissions', () => {
  const makeCommission = (repId, status, amount, repMeta = {}) => ({
    rep_id: repId,
    amount: String(amount),
    status,
    rep: {
      email: repMeta.email || `rep${repId}@example.com`,
      company_name: repMeta.company_name || `Rep ${repId}`,
      commission_option: repMeta.commission_option ?? 1,
    },
  });

  it('returns an empty array for empty input', () => {
    expect(summarizeRepCommissions([])).toEqual([]);
  });

  it('returns one summary entry per rep', () => {
    const commissions = [
      makeCommission('rep-1', 'paid', 495),
      makeCommission('rep-1', 'due', 247.5),
      makeCommission('rep-2', 'paid', 695),
    ];
    const result = summarizeRepCommissions(commissions);
    expect(result).toHaveLength(2);
  });

  it('sums total_paid correctly', () => {
    const commissions = [
      makeCommission('rep-1', 'paid', 495),
      makeCommission('rep-1', 'paid', 200),
    ];
    const result = summarizeRepCommissions(commissions);
    expect(result[0].total_paid).toBeCloseTo(695);
  });

  it('sums total_due correctly', () => {
    const commissions = [
      makeCommission('rep-1', 'due', 247.5),
      makeCommission('rep-1', 'due', 49.5),
    ];
    const result = summarizeRepCommissions(commissions);
    expect(result[0].total_due).toBeCloseTo(297);
  });

  it('sums total_pending correctly', () => {
    const commissions = [
      makeCommission('rep-1', 'pending', 49.5),
      makeCommission('rep-1', 'pending', 49.5),
    ];
    const result = summarizeRepCommissions(commissions);
    expect(result[0].total_pending).toBeCloseTo(99);
  });

  it('excludes voided commissions from all totals', () => {
    const commissions = [
      makeCommission('rep-1', 'voided', 495),
    ];
    const result = summarizeRepCommissions(commissions);
    expect(result[0].total_paid).toBe(0);
    expect(result[0].total_due).toBe(0);
    expect(result[0].total_pending).toBe(0);
  });

  it('preserves rep metadata (name, email, commission_option)', () => {
    const commissions = [
      makeCommission('rep-1', 'paid', 100, {
        company_name: 'Jane Smith',
        email: 'jane@example.com',
        commission_option: 2,
      }),
    ];
    const result = summarizeRepCommissions(commissions);
    expect(result[0].rep_name).toBe('Jane Smith');
    expect(result[0].rep_email).toBe('jane@example.com');
    expect(result[0].commission_option).toBe(2);
  });

  it('uses email as rep_name when company_name is missing', () => {
    const commissions = [
      {
        rep_id: 'rep-x',
        amount: '100',
        status: 'paid',
        rep: { email: 'noname@example.com', company_name: null, commission_option: 1 },
      },
    ];
    const result = summarizeRepCommissions(commissions);
    expect(result[0].rep_name).toBe('noname@example.com');
  });

  it('handles null rep field gracefully', () => {
    const commissions = [
      { rep_id: 'rep-z', amount: '100', status: 'paid', rep: null },
    ];
    const result = summarizeRepCommissions(commissions);
    expect(result[0].rep_name).toBe('Unknown');
    expect(result[0].commission_option).toBeNull();
  });

  it('accumulates across multiple reps independently', () => {
    const commissions = [
      makeCommission('rep-1', 'paid', 500),
      makeCommission('rep-2', 'paid', 300),
      makeCommission('rep-1', 'due', 100),
    ];
    const result = summarizeRepCommissions(commissions);
    const rep1 = result.find(r => r.rep_id === 'rep-1');
    const rep2 = result.find(r => r.rep_id === 'rep-2');
    expect(rep1.total_paid).toBe(500);
    expect(rep1.total_due).toBe(100);
    expect(rep2.total_paid).toBe(300);
  });
});

// ── formatCommissionType ─────────────────────────────────────────────────────

describe('formatCommissionType', () => {
  it('returns "Upfront" for upfront type', () => {
    expect(formatCommissionType({ type: 'upfront', month_number: null })).toBe('Upfront');
  });

  it('returns "Residual Month 1" for residual month 1', () => {
    expect(formatCommissionType({ type: 'residual', month_number: 1 })).toBe('Residual Month 1');
  });

  it('returns "Residual Month 12" for residual month 12', () => {
    expect(formatCommissionType({ type: 'residual', month_number: 12 })).toBe('Residual Month 12');
  });

  it('returns "Residual" for residual with null month_number', () => {
    expect(formatCommissionType({ type: 'residual', month_number: null })).toBe('Residual');
  });

  it('returns "Unknown" for unrecognized type', () => {
    expect(formatCommissionType({ type: 'bonus', month_number: null })).toBe('Unknown');
  });
});

// ── filterDeals ──────────────────────────────────────────────────────────────

describe('filterDeals', () => {
  const deals = [
    { id: '1', rep_id: 'rep-1', status: 'active',           created_at: '2026-01-15T10:00:00Z' },
    { id: '2', rep_id: 'rep-1', status: 'onboarding_sent',  created_at: '2026-02-01T10:00:00Z' },
    { id: '3', rep_id: 'rep-2', status: 'active',           created_at: '2026-03-01T10:00:00Z' },
    { id: '4', rep_id: 'rep-2', status: 'cancelled',        created_at: '2026-03-10T10:00:00Z' },
  ];

  it('returns all deals when no filters are provided', () => {
    expect(filterDeals(deals, {})).toHaveLength(4);
  });

  it('filters by repId', () => {
    const result = filterDeals(deals, { repId: 'rep-1' });
    expect(result).toHaveLength(2);
    result.forEach(d => expect(d.rep_id).toBe('rep-1'));
  });

  it('filters by status', () => {
    const result = filterDeals(deals, { status: 'active' });
    expect(result).toHaveLength(2);
    result.forEach(d => expect(d.status).toBe('active'));
  });

  it('treats status "all" as no status filter', () => {
    const result = filterDeals(deals, { status: 'all' });
    expect(result).toHaveLength(4);
  });

  it('filters by dateFrom (inclusive)', () => {
    const result = filterDeals(deals, { dateFrom: '2026-03-01' });
    expect(result).toHaveLength(2);
    expect(result.map(d => d.id)).toEqual(expect.arrayContaining(['3', '4']));
  });

  it('filters by dateTo (inclusive)', () => {
    const result = filterDeals(deals, { dateTo: '2026-01-31' });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });

  it('filters by both dateFrom and dateTo', () => {
    const result = filterDeals(deals, { dateFrom: '2026-02-01', dateTo: '2026-02-28' });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('2');
  });

  it('combines repId and status filters', () => {
    const result = filterDeals(deals, { repId: 'rep-2', status: 'active' });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('3');
  });

  it('returns empty array when no deals match', () => {
    const result = filterDeals(deals, { repId: 'rep-99' });
    expect(result).toHaveLength(0);
  });

  it('handles empty deals array gracefully', () => {
    expect(filterDeals([], { repId: 'rep-1' })).toEqual([]);
  });
});
