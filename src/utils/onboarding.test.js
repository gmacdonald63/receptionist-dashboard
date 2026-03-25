// src/utils/onboarding.test.js
import { describe, it, expect } from 'vitest';
import { parseOnboardingToken, validateOnboardingForm } from './onboarding.js';

describe('parseOnboardingToken', () => {
  it('returns token from URL with ?token= param', () => {
    expect(parseOnboardingToken('https://app.reliantsupport.net/onboard?token=abc-123')).toBe('abc-123');
  });

  it('returns token from bare query string', () => {
    expect(parseOnboardingToken('?token=xyz-789')).toBe('xyz-789');
  });

  it('returns null when no token param', () => {
    expect(parseOnboardingToken('https://app.reliantsupport.net/onboard')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseOnboardingToken('')).toBeNull();
  });
});

describe('validateOnboardingForm', () => {
  const validForm = {
    business_name: 'Acme HVAC',
    address: '123 Main St',
    city: 'Calgary',
    province: 'AB',
    postal_code: 'T2P 1J9',
    services: 'HVAC installation and maintenance',
    special_instructions: '',
    hours: {
      monday: { is_open: true, open_time: '08:00', close_time: '17:00' },
    },
  };

  it('returns no errors for a valid form', () => {
    expect(validateOnboardingForm(validForm)).toEqual({});
  });

  it('returns error when business_name is empty', () => {
    const errors = validateOnboardingForm({ ...validForm, business_name: '' });
    expect(errors.business_name).toBeDefined();
  });

  it('returns error when address is empty', () => {
    const errors = validateOnboardingForm({ ...validForm, address: '' });
    expect(errors.address).toBeDefined();
  });

  it('returns error when services is empty', () => {
    const errors = validateOnboardingForm({ ...validForm, services: '' });
    expect(errors.services).toBeDefined();
  });

  it('returns error when city is empty', () => {
    const errors = validateOnboardingForm({ ...validForm, city: '' });
    expect(errors.city).toBeDefined();
  });

  it('returns multiple errors at once', () => {
    const errors = validateOnboardingForm({ ...validForm, business_name: '', address: '' });
    expect(Object.keys(errors).length).toBeGreaterThanOrEqual(2);
  });
});
