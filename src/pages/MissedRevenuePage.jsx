import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../supabaseClient';

const WORK_DAYS = 24;
const AVG_CALL_MIN = 5;

const SUPABASE_URL = 'https://zmppdmfdhknnwzwdfhwf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InptcHBkbWZkaGtubnd6d2RmaHdmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4MzQyMDYsImV4cCI6MjA4NTQxMDIwNn0.mXfuz8mEZhizFen78gUaakBDbrzANn4ZM1a7KuDiKJs';

function calcResults(missedPerDay, avgJobValue, bookingRate) {
  const missedCallsPerMonth = Math.round(missedPerDay * WORK_DAYS);
  const lostJobsPerMonth = Math.round(missedCallsPerMonth * (bookingRate / 100));
  const lostRevenuePerMonth = lostJobsPerMonth * avgJobValue;
  const aiMinutesNeeded = missedCallsPerMonth * AVG_CALL_MIN;
  return { missedCallsPerMonth, lostJobsPerMonth, lostRevenuePerMonth, aiMinutesNeeded };
}

function fmtCurrency(n) {
  return '$' + Math.round(n).toLocaleString('en-US');
}

function fmtNumber(n) {
  return Math.round(n).toLocaleString('en-US');
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function validatePhone(phone) {
  return /^\+?1?\s?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}$/.test(phone.trim());
}

export default function MissedRevenuePage() {
  const [missedPerDay, setMissedPerDay] = useState(5);
  const [avgJobValue, setAvgJobValue] = useState(350);
  const [bookingRate, setBookingRate] = useState(35);

  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const utmRef = useRef({});

  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex,nofollow';
    document.head.appendChild(meta);

    const prevTitle = document.title;
    document.title = 'How Much Revenue Are You Losing? | Reliant Support';

    const params = new URLSearchParams(window.location.search);
    utmRef.current = {
      utm_source: params.get('utm_source') || null,
      utm_medium: params.get('utm_medium') || null,
      utm_campaign: params.get('utm_campaign') || null,
    };

    return () => {
      document.head.removeChild(meta);
      document.title = prevTitle;
    };
  }, []);

  const results = calcResults(missedPerDay, avgJobValue, bookingRate);

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError('');

    if (!name.trim() || !company.trim() || !email.trim() || !phone.trim()) {
      setFormError('All fields are required.');
      return;
    }
    if (!validateEmail(email)) {
      setFormError('Please enter a valid email address.');
      return;
    }
    if (!validatePhone(phone)) {
      setFormError('Please enter a valid US phone number.');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        name: name.trim(),
        company: company.trim(),
        email: email.trim(),
        phone: phone.trim(),
        missed_calls_per_day: Math.round(missedPerDay),
        avg_job_value: avgJobValue,
        booking_rate: bookingRate,
        lost_revenue_per_month: results.lostRevenuePerMonth,
        lost_jobs_per_month: results.lostJobsPerMonth,
        missed_calls_per_month: results.missedCallsPerMonth,
        landing_page: 'missed-revenue',
        utm_source: utmRef.current.utm_source,
        utm_medium: utmRef.current.utm_medium,
        utm_campaign: utmRef.current.utm_campaign,
        user_agent: navigator.userAgent,
        referrer: document.referrer || null,
      };

      const { data, error } = await supabase
        .from('landing_page_leads')
        .insert(payload)
        .select('id')
        .single();

      if (error) throw error;

      // Fire-and-forget: notify Greg
      fetch(`${SUPABASE_URL}/functions/v1/notify-new-lead`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ lead_id: data.id }),
      }).catch(err => console.error('notify-new-lead failed:', err));

      setSubmitted(true);
    } catch (err) {
      console.error('Form submission error:', err);
      setFormError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const logo = new URL('../assets/RELIANT SUPPORT LOGO.svg', import.meta.url).href;

  const inputCls =
    'w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-blue-500 placeholder-gray-600';

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Hero */}
      <div className="max-w-3xl mx-auto px-6 pt-10 pb-2">
        <img src={logo} alt="Reliant Support" className="h-8 w-auto mb-10" />
        <h1 className="text-3xl md:text-4xl font-bold leading-tight mb-4">
          How much money is your HVAC business losing to missed calls?
        </h1>
        <p className="text-gray-400 text-lg mb-3">
          Most owners are shocked when they see the real number. Run the 30-second calculator
          below — your inputs, your math, your number.
        </p>
        <p className="text-sm text-gray-500 mb-8">Built by a former HVAC owner. No fluff.</p>
      </div>

      {/* Calculator */}
      <div className="max-w-3xl mx-auto px-6 pb-16">
        {/* Inputs */}
        <div className="mb-8">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">
            Your Numbers
          </p>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Missed calls/day</label>
              <input
                type="number"
                value={missedPerDay}
                min="0"
                onChange={e => setMissedPerDay(Math.max(0, Number(e.target.value) || 0))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Avg job value</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                <input
                  type="number"
                  value={avgJobValue}
                  min="0"
                  onChange={e => setAvgJobValue(Math.max(0, Number(e.target.value) || 0))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-7 pr-3 py-2.5 text-white text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Booking rate</label>
              <div className="relative">
                <input
                  type="number"
                  value={bookingRate}
                  min="0"
                  max="100"
                  onChange={e =>
                    setBookingRate(Math.max(0, Math.min(100, Number(e.target.value) || 0)))
                  }
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 pr-8 py-2.5 text-white text-sm focus:outline-none focus:border-blue-500"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">%</span>
              </div>
            </div>
          </div>
          <p className="text-xs text-gray-600 mt-2">
            Based on a 6-day work week (24 days/mo) and 5-minute average call
          </p>
        </div>

        {/* Output cards */}
        <div className="mb-6">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">
            What You're Losing Today
          </p>
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-red-400">
                {fmtNumber(results.missedCallsPerMonth)}
              </p>
              <p className="text-gray-400 text-xs mt-1">Missed calls/mo</p>
            </div>
            <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-red-400">
                {fmtNumber(results.lostJobsPerMonth)}
              </p>
              <p className="text-gray-400 text-xs mt-1">Lost jobs/mo</p>
            </div>
            <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-red-400">
                {fmtCurrency(results.lostRevenuePerMonth)}
              </p>
              <p className="text-gray-400 text-xs mt-1">Lost revenue/mo</p>
            </div>
          </div>
        </div>

        {/* AI minutes callout */}
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 flex items-start gap-3 mb-10">
          <span className="text-xl mt-0.5">📞</span>
          <div>
            <p className="text-sm font-medium text-white">
              You'd need ~{fmtNumber(results.aiMinutesNeeded)} AI minutes/mo to cover those calls
            </p>
            <p className="text-xs text-gray-400 mt-0.5">
              {fmtNumber(results.missedCallsPerMonth)} calls × {AVG_CALL_MIN} min avg ={' '}
              {fmtNumber(results.aiMinutesNeeded)} min
            </p>
          </div>
        </div>

        {/* Lead capture form */}
        <div className="bg-gray-800 border border-blue-500/20 rounded-xl p-6 shadow-lg shadow-blue-900/10">
          <h2 className="text-xl font-bold text-white mb-2">Want this in writing?</h2>
          <p className="text-gray-400 text-sm mb-6">
            We'll email you a personalized PDF report with your exact numbers, plus a 7-step
            playbook on how HVAC owners are plugging this leak. Greg (the founder, former HVAC
            owner) may also reach out personally — no pressure, no sales pitch.
          </p>

          {submitted ? (
            <div className="text-center py-8">
              <div className="w-16 h-16 rounded-full bg-green-900/40 border border-green-700 flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-white mb-2">Your report is on the way</h3>
              <p className="text-gray-400 text-sm max-w-sm mx-auto">
                Check your email in the next few minutes. If you don't see it, check your spam
                folder. Greg may also reach out personally over the next day or two — keep an eye
                on your phone.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} noValidate>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Name</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="John Smith"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Company Name</label>
                  <input
                    type="text"
                    required
                    value={company}
                    onChange={e => setCompany(e.target.value)}
                    placeholder="Smith HVAC LLC"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Email</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="john@smithhvac.com"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Phone</label>
                  <input
                    type="tel"
                    required
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    placeholder="(555) 123-4567"
                    className={inputCls}
                  />
                </div>
              </div>

              {formError && (
                <p className="text-red-400 text-sm mb-3">{formError}</p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold rounded-lg transition-colors"
              >
                {submitting ? 'Sending...' : 'Send My Report'}
              </button>
              <p className="text-center text-xs text-gray-600 mt-3">
                We'll never sell your info. You can unsubscribe anytime.
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
