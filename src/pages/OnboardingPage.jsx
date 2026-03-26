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
  // Determine initial step from URL
  const params = new URLSearchParams(window.location.search);
  const isPaid = params.has('success'); // Stripe redirects back with ?success=true

  const [step, setStep] = useState(isPaid ? 'form' : 'payment');
  // step: 'payment' | 'form' | 'thankyou' | 'loading' | 'error'

  const [dealData, setDealData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [formErrors, setFormErrors] = useState({});

  const [formData, setFormData] = useState({
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
    if (!token) return;

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
          setStep('error');
          return;
        }
        setDealData(data);
        setFormData(f => ({ ...f, business_name: data.company_name || '' }));
      } catch (e) {
        setError('Could not load onboarding details. Please try again.');
        setStep('error');
      }
    }
    loadDeal();
  }, [token]);

  function setField(field, value) {
    setFormData(f => ({ ...f, [field]: value }));
    if (formErrors[field]) setFormErrors(e => ({ ...e, [field]: undefined }));
  }

  function setHours(day, field, value) {
    setFormData(f => ({
      ...f,
      hours: { ...f.hours, [day]: { ...f.hours[day], [field]: value } },
    }));
  }

  const handlePaySetupFee = async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `${SUPABASE_URL}/functions/v1/create-onboarding-checkout`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY },
          body: JSON.stringify({ token }),
        }
      );
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setError(data.error || 'Failed to start payment. Please try again.');
        setLoading(false);
      }
    } catch (err) {
      setError('Something went wrong. Please try again.');
      setLoading(false);
    }
  };

  const handleSubmitForm = async (e) => {
    e.preventDefault();
    const errors = validateOnboardingForm(formData);
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(
        `${SUPABASE_URL}/functions/v1/save-onboarding-data`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY },
          body: JSON.stringify({ token, onboarding_data: formData }),
        }
      );
      const data = await res.json();
      if (data.error === 'already_submitted') {
        setStep('thankyou'); // Already submitted — show success
      } else if (data.saved) {
        setStep('thankyou');
      } else {
        setError(data.error || 'Failed to save. Please try again.');
      }
    } catch (err) {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // ── Error screen ────────────────────────────────────────────
  if (step === 'error') {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
        <div className="bg-gray-800 rounded-xl border border-red-700 p-8 max-w-md w-full text-center">
          <h1 className="text-xl font-bold text-red-400 mb-3">Link Unavailable</h1>
          <p className="text-gray-400">{error || 'This onboarding link is invalid or has already been used.'}</p>
        </div>
      </div>
    );
  }

  // ── Step 1: Payment ──────────────────────────────────────────
  if (step === 'payment') {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
        <div className="max-w-lg mx-auto px-4 py-12 w-full">
          <h1 className="text-2xl font-bold text-white mb-2">Complete Your Account Setup</h1>
          <p className="text-gray-400 mb-6">
            To get started, a one-time setup fee of $395 is required. This covers your
            AI receptionist configuration.
          </p>
          {dealData && (
            <p className="text-gray-300 mb-8 font-medium">{dealData.company_name}</p>
          )}
          {error && (
            <div className="bg-red-900/30 rounded border border-red-700 p-3 mb-4">
              <p className="text-red-300 text-sm">{error}</p>
            </div>
          )}
          <button
            onClick={handlePaySetupFee}
            disabled={loading}
            className="w-full py-3 px-6 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg disabled:opacity-50"
          >
            {loading ? 'Redirecting to payment...' : 'Pay Setup Fee — $395'}
          </button>
        </div>
      </div>
    );
  }

  // ── Step 3: Thank You ────────────────────────────────────────
  if (step === 'thankyou') {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
        <div className="max-w-lg mx-auto px-4 py-12 text-center">
          <div className="text-5xl mb-6">✓</div>
          <h1 className="text-2xl font-bold text-white mb-4">
            Thank You — Your Setup is Now in Progress!
          </h1>
          <p className="text-gray-400">
            We've received your setup information. You'll receive an email from us
            once your account is ready to activate.
          </p>
        </div>
      </div>
    );
  }

  // ── Step 2: Business Info Form ───────────────────────────────
  return (
    <div className="min-h-screen bg-gray-900 py-10 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">Reliant Support</h1>
          <p className="text-gray-400">Complete your AI receptionist setup for <strong className="text-white">{dealData?.company_name}</strong></p>
        </div>

        <form onSubmit={handleSubmitForm} className="space-y-6">

          {/* Business Info */}
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-white">Business Information</h2>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Business Name *</label>
              <input
                type="text"
                value={formData.business_name}
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
                value={formData.address}
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
                  value={formData.city}
                  onChange={e => setField('city', e.target.value)}
                  className={`w-full px-3 py-2 bg-gray-700 border rounded text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 ${formErrors.city ? 'border-red-500' : 'border-gray-600'}`}
                />
                {formErrors.city && <p className="text-red-400 text-xs mt-1">{formErrors.city}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Province / State *</label>
                <input
                  type="text"
                  value={formData.province}
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
                value={formData.postal_code}
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
                value={formData.services}
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
                value={formData.special_instructions}
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
                      checked={formData.hours[day].is_open}
                      onChange={e => setHours(day, 'is_open', e.target.checked)}
                      className="rounded"
                    />
                    <span className="text-sm text-gray-300">Open</span>
                  </label>
                  {formData.hours[day].is_open && (
                    <div className="flex items-center gap-2 ml-2">
                      <input
                        type="time"
                        value={formData.hours[day].open_time}
                        onChange={e => setHours(day, 'open_time', e.target.value)}
                        className="px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                      />
                      <span className="text-gray-500">-</span>
                      <input
                        type="time"
                        value={formData.hours[day].close_time}
                        onChange={e => setHours(day, 'close_time', e.target.value)}
                        className="px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                      />
                    </div>
                  )}
                  {!formData.hours[day].is_open && (
                    <span className="text-sm text-gray-500 ml-2">Closed</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {error && (
            <div className="bg-red-900/30 rounded border border-red-700 p-3">
              <p className="text-red-300 text-sm">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 px-6 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors"
          >
            {loading ? 'Saving...' : 'Send My Setup Information'}
          </button>
        </form>
      </div>
    </div>
  );
}
