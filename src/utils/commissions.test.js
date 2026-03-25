import { describe, it, expect } from 'vitest';
import { calculateCommissions } from './commissions.js';

// Fixed base date for deterministic due_date assertions
const BASE_DATE = new Date('2026-03-24');

const mockDeal = (plan, billing_cycle) => ({
  id: 'deal-uuid-123',
  rep_id: 42,
  plan,
  billing_cycle,
});

describe('calculateCommissions', () => {

  // ── Option 1: Full Upfront ────────────────────────────────────────────────

  describe('Option 1 — Full Upfront', () => {

    it('Standard monthly: returns 1 record', () => {
      const records = calculateCommissions(mockDeal('standard', 'monthly'), 1, BASE_DATE);
      expect(records).toHaveLength(1);
    });

    it('Standard monthly: $495 upfront, status due', () => {
      const records = calculateCommissions(mockDeal('standard', 'monthly'), 1, BASE_DATE);
      expect(records[0]).toMatchObject({
        deal_id: 'deal-uuid-123',
        rep_id: 42,
        type: 'upfront',
        month_number: null,
        amount: 495,
        status: 'due',
        due_date: '2026-03-24',
      });
    });

    it('Pro monthly: $695 upfront', () => {
      const records = calculateCommissions(mockDeal('pro', 'monthly'), 1, BASE_DATE);
      expect(records[0].amount).toBe(695);
    });

    it('Standard annual: $495 + $200 bonus = $695 upfront', () => {
      const records = calculateCommissions(mockDeal('standard', 'annual'), 1, BASE_DATE);
      expect(records).toHaveLength(1);
      expect(records[0].amount).toBe(695);
    });

    it('Pro annual: $695 + $200 bonus = $895 upfront', () => {
      const records = calculateCommissions(mockDeal('pro', 'annual'), 1, BASE_DATE);
      expect(records).toHaveLength(1);
      expect(records[0].amount).toBe(895);
    });

  });

  // ── Option 2: Split + Residual ────────────────────────────────────────────

  describe('Option 2 — Split + Residual', () => {

    it('Standard monthly: returns 13 records (1 upfront + 12 residuals)', () => {
      const records = calculateCommissions(mockDeal('standard', 'monthly'), 2, BASE_DATE);
      expect(records).toHaveLength(13);
    });

    it('Standard monthly upfront: 50% of $495 = $247.50, status due', () => {
      const records = calculateCommissions(mockDeal('standard', 'monthly'), 2, BASE_DATE);
      const upfront = records.find(r => r.type === 'upfront');
      expect(upfront).toMatchObject({
        type: 'upfront',
        amount: 247.50,
        status: 'due',
        month_number: null,
        due_date: '2026-03-24',
      });
    });

    it('Pro monthly upfront: 50% of $695 = $347.50', () => {
      const records = calculateCommissions(mockDeal('pro', 'monthly'), 2, BASE_DATE);
      const upfront = records.find(r => r.type === 'upfront');
      expect(upfront.amount).toBe(347.50);
    });

    it('Standard monthly: 12 residual records', () => {
      const records = calculateCommissions(mockDeal('standard', 'monthly'), 2, BASE_DATE);
      const residuals = records.filter(r => r.type === 'residual');
      expect(residuals).toHaveLength(12);
    });

    it('Standard monthly residuals: 10% of $495 = $49.50 each', () => {
      const records = calculateCommissions(mockDeal('standard', 'monthly'), 2, BASE_DATE);
      const residuals = records.filter(r => r.type === 'residual');
      residuals.forEach(r => expect(r.amount).toBe(49.50));
    });

    it('Pro monthly residuals: 10% of $695 = $69.50 each', () => {
      const records = calculateCommissions(mockDeal('pro', 'monthly'), 2, BASE_DATE);
      const residuals = records.filter(r => r.type === 'residual');
      residuals.forEach(r => expect(r.amount).toBe(69.50));
    });

    it('Standard annual upfront: 50% of $495 + $200 bonus = $447.50', () => {
      const records = calculateCommissions(mockDeal('standard', 'annual'), 2, BASE_DATE);
      const upfront = records.find(r => r.type === 'upfront');
      expect(upfront.amount).toBe(447.50);
    });

    it('Pro annual upfront: 50% of $695 + $200 bonus = $547.50', () => {
      const records = calculateCommissions(mockDeal('pro', 'annual'), 2, BASE_DATE);
      const upfront = records.find(r => r.type === 'upfront');
      expect(upfront.amount).toBe(547.50);
    });

    it('month 1 residual is due same date as upfront', () => {
      const records = calculateCommissions(mockDeal('standard', 'monthly'), 2, BASE_DATE);
      const upfront = records.find(r => r.type === 'upfront');
      const month1 = records.find(r => r.type === 'residual' && r.month_number === 1);
      expect(month1.due_date).toBe(upfront.due_date);
      expect(month1.status).toBe('due');
    });

    it('month 2 residual is due 1 month after baseDate', () => {
      const records = calculateCommissions(mockDeal('standard', 'monthly'), 2, BASE_DATE);
      const month2 = records.find(r => r.type === 'residual' && r.month_number === 2);
      expect(month2.due_date).toBe('2026-04-24');
      expect(month2.status).toBe('pending');
    });

    it('month 12 residual is due 11 months after baseDate', () => {
      const records = calculateCommissions(mockDeal('standard', 'monthly'), 2, BASE_DATE);
      const month12 = records.find(r => r.type === 'residual' && r.month_number === 12);
      expect(month12.due_date).toBe('2027-02-24');
      expect(month12.status).toBe('pending');
    });

    it('residuals months 2–12 have status pending', () => {
      const records = calculateCommissions(mockDeal('standard', 'monthly'), 2, BASE_DATE);
      const laterResiduals = records.filter(r => r.type === 'residual' && r.month_number > 1);
      expect(laterResiduals).toHaveLength(11);
      laterResiduals.forEach(r => expect(r.status).toBe('pending'));
    });

    it('residuals are numbered 1 through 12', () => {
      const records = calculateCommissions(mockDeal('standard', 'monthly'), 2, BASE_DATE);
      const residuals = records.filter(r => r.type === 'residual');
      const monthNumbers = residuals.map(r => r.month_number).sort((a, b) => a - b);
      expect(monthNumbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    });

    it('all records have correct deal_id and rep_id', () => {
      const records = calculateCommissions(mockDeal('standard', 'monthly'), 2, BASE_DATE);
      records.forEach(r => {
        expect(r.deal_id).toBe('deal-uuid-123');
        expect(r.rep_id).toBe(42);
      });
    });

  });

});
