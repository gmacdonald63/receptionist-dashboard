// src/pages/OnboardingPage.jsx
import { useState, useEffect } from 'react';
import { validateOnboardingForm } from '../utils/onboarding.js';

const SUPABASE_URL = 'https://zmppdmfdhknnwzwdfhwf.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InptcHBkbWZkaGtubnd6d2RmaHdmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4MzQyMDYsImV4cCI6MjA4NTQxMDIwNn0.mXfuz8mEZhizFen78gUaakBDbrzANn4ZM1a7KuDiKJs';

const DAYS = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
const DAY_LABELS = { monday:'Mon', tuesday:'Tue', wednesday:'Wed', thursday:'Thu', friday:'Fri', saturday:'Sat', sunday:'Sun' };

function defaultHours() {
  const h = {};
  DAYS.forEach(d => {
    h[d] = { is_open: ['monday','tuesday','wednesday','thursday','friday'].includes(d), open_time: '08:00', close_time: '17:00' };
  });
  return h;
}

export default function OnboardingPage({ token }) {
  const params = new URLSearchParams(window.location.search);
  const isSuccess = params.get('success') === 'true';

  const [phase, setPhase] = useState(isSuccess ? 'success' : 'loading');
  const [deal, setDeal] = useState(null);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [formErrors, setFormErrors] = useState({});

  const [form, setForm] = useState({
    business_name: '',
    address: '',
    city: '',
    province: '',
    postal_code: '',
    services: '',
    special_instructions: '',
    hours: defaultHours(),
  });

  // Load deal details on mount
  useEffect(() => {
    if (isSuccess || !token) return;

    async function loadDeal() {
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/get-onboarding-deal`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': ANON_KEY,
          },
          body: JSON.stringify({ token }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || 'Invalid onboarding link.');
          setPhase('error');
          return;
        }
        setDeal(data);
        setForm(f => ({ ...f, business_name: data.company_name || '' }));
        setPhase('form');
      } catch (e) {
        setError('Could not load onboarding details. Please try again.');
        setPhase('error');
      }
    }
    loadDeal();
  }, [token]);

  function setField(field, value) {
    setForm(f => ({ ...f, [field]: value }));
    if (formErrors[field]) setFormErrors(e => ({ ...e, [field]: undefined }));
  }

  function setHours(day, field, value) {
    setForm(f => ({
      ...f,
      hours: { ...f.hours, [day]: { ...f.hours[day], [field]: value } },
    }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const errors = validateOnboardingForm(form);
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/create-onboarding-checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': ANON_KEY,
        },
        body: JSON.stringify({ token, onboarding_data: form }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not start payment. Please try again.');
        setSubmitting(false);
        return;
      }
      // Redirect to Stripe
      window.location.href = data.url;
    } catch (e) {
      setError('Could not connect to payment service. Please try again.');
      setSubmitting(false);
    }
  }

  // ── Success screen ──────────────────────────────────────────
  if (phase === 'success') {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
        <div className="bg-gray-800 rounded-xl border border-gray-700 p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white mb-3">Setup Request Received</h1>
          <p className="text-gray-300">
            Your setup request has been received. Greg will be in touch shortly with your account access link.
          </p>
        </div>
      </div>
    );
  }

  // ── Error screen ────────────────────────────────────────────
  if (phase === 'error') {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
        <div className="bg-gray-800 rounded-xl border border-red-700 p-8 max-w-md w-full text-center">
          <h1 className="text-xl font-bold text-red-400 mb-3">Link Unavailable</h1>
          <p className="text-gray-400">{error || 'This onboarding link is invalid or has already been used.'}</p>
        </div>
      </div>
    );
  }

  // ── Loading screen ──────────────────────────────────────────
  if (phase === 'loading') {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-gray-400 text-lg">Loading your setup form...</div>
      </div>
    );
  }

  // ── Form ────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-900 py-10 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">Reliant Support</h1>
          <p className="text-gray-400">Complete your AI receptionist setup for <strong className="text-white">{deal?.company_name}</strong></p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">

          {/* Business Info */}
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-white">Business Information</h2>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Business Name *</label>
              <input
                type="text"
                value={form.business_name}
                onChange={e => setField('business_name', e.target.value)}
                className={`w-full px-3 py-2 bg-gray-700 border rounded text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 ${formErrors.business_name ? 'border-red-500' : 'border-gray-600'}`}
                placeholder="Acme HVAC Services"
              />
              {formErrors.business_name && <p className="text-red-400 text-xs mt-1">{formErrors.business_name}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Street Address *</label>
              <input
                type="text"
                value={form.address}
                onChange={e => setField('address', e.target.value)}
                className={`w-full px-3 py-2 bg-gray-700 border rounded text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 ${formErrors.address ? 'border-red-500' : 'border-gray-600'}`}
                placeholder="123 Main Street"
              />
              {formErrors.address && <p className="text-red-400 text-xs mt-1">{formErrors.address}</p>}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">City *</label>
                <input
                  type="text"
                  value={form.city}
                  onChange={e => setField('city', e.target.value)}
                  className={`w-full px-3 py-2 bg-gray-700 border rounded text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 ${formErrors.city ? 'border-red-500' : 'border-gray-600'}`}
                />
                {formErrors.city && <p className="text-red-400 text-xs mt-1">{formErrors.city}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Province / State *</label>
                <input
                  type="text"
                  value={form.province}
                  onChange={e => setField('province', e.target.value)}
                  className={`w-full px-3 py-2 bg-gray-700 border rounded text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 ${formErrors.province ? 'border-red-500' : 'border-gray-600'}`}
                  placeholder="AB"
                />
                {formErrors.province && <p className="text-red-400 text-xs mt-1">{formErrors.province}</p>}
              </div>
            </div>

            <div className="w-1/2">
              <label className="block text-sm font-medium text-gray-300 mb-1">Postal / ZIP Code</label>
              <input
                type="text"
                value={form.postal_code}
                onChange={e => setField('postal_code', e.target.value)}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="T2P 1J9"
              />
            </div>
          </div>

          {/* Services */}
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-white">Services & Instructions</h2>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Services Offered *</label>
              <textarea
                value={form.services}
                onChange={e => setField('services', e.target.value)}
                rows={3}
                className={`w-full px-3 py-2 bg-gray-700 border rounded text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 ${formErrors.services ? 'border-red-500' : 'border-gray-600'}`}
                placeholder="e.g. HVAC installation, furnace repair, AC maintenance, emergency service"
              />
              {formErrors.services && <p className="text-red-400 text-xs mt-1">{formErrors.services}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Special Instructions for AI Receptionist</label>
              <textarea
                value={form.special_instructions}
                onChange={e => setField('special_instructions', e.target.value)}
                rows={3}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. Always ask for the customer's address and best contact number. Do not book same-day appointments."
              />
            </div>
          </div>

          {/* Hours of Operation */}
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
            <h2 className="text-lg font-semibold text-white mb-4">Hours of Operation</h2>
            <div className="space-y-3">
              {DAYS.map(day => (
                <div key={day} className="flex items-center gap-3">
                  <div className="w-10 text-sm text-gray-400">{DAY_LABELS[day]}</div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.hours[day].is_open}
                      onChange={e => setHours(day, 'is_open', e.target.checked)}
                      className="rounded"
                    />
                    <span className="text-sm text-gray-300">Open</span>
                  </label>
                  {form.hours[day].is_open && (
                    <div className="flex items-center gap-2 ml-2">
                      <input
                        type="time"
                        value={form.hours[day].open_time}
                        onChange={e => setHours(day, 'open_time', e.target.value)}
                        className="px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                      />
                      <span className="text-gray-500">-</span>
                      <input
                        type="time"
                        value={form.hours[day].close_time}
                        onChange={e => setHours(day, 'close_time', e.target.value)}
                        className="px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                      />
                    </div>
                  )}
                  {!form.hours[day].is_open && (
                    <span className="text-sm text-gray-500 ml-2">Closed</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Setup Fee Notice */}
          <div className="bg-blue-900/30 rounded-xl border border-blue-700 p-4">
            <p className="text-blue-300 text-sm">
              <strong>Next step:</strong> After submitting this form, you'll be taken to a secure payment page to complete your <strong>$395 setup fee</strong>. Your AI receptionist will be configured within 1-2 business days.
            </p>
          </div>

          {error && (
            <div className="bg-red-900/30 rounded border border-red-700 p-3">
              <p className="text-red-300 text-sm">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 px-6 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors"
          >
            {submitting ? 'Redirecting to payment...' : 'Continue to Payment ->'}
          </button>
        </form>
      </div>
    </div>
  );
}
