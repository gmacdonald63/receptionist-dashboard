// src/pages/ActivationPage.jsx
import { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://zmppdmfdhknnwzwdfhwf.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InptcHBkbWZkaGtubnd6d2RmaHdmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4MzQyMDYsImV4cCI6MjA4NTQxMDIwNn0.mXfuz8mEZhizFen78gUaakBDbrzANn4ZM1a7KuDiKJs';

async function callFunction(name, body) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
    body: JSON.stringify(body),
  });
  return res.json();
}

export default function ActivationPage({ activationToken, paid }) {
  const [accountData, setAccountData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState(null);

  // Password form state
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Call get-activation-data on every mount (needed for both steps)
  useEffect(() => {
    callFunction('get-activation-data', { activation_token: activationToken })
      .then(data => {
        if (data.error === 'token_expired') {
          setLoadError('This activation link has expired. Please contact support@reliantsupport.net to resend your activation.');
        } else if (data.error) {
          setLoadError(data.error);
        } else {
          setAccountData(data);
        }
      })
      .catch(() => setLoadError('Failed to load account data.'))
      .finally(() => setLoading(false));
  }, [activationToken]);

  const handleSetUpSubscription = async () => {
    setActionLoading(true);
    setActionError(null);
    try {
      const data = await callFunction('create-subscription-checkout', {
        activation_token: activationToken,
      });
      if (data.url) {
        window.location.href = data.url;
      } else {
        setActionError(
          data.error ||
          "We couldn't start your subscription checkout. Please try again or contact support@reliantsupport.net."
        );
      }
    } catch {
      setActionError("We couldn't start your subscription checkout. Please try again or contact support@reliantsupport.net.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleSetPassword = async (e) => {
    e.preventDefault();
    if (password.length < 8) {
      setActionError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setActionError('Passwords do not match.');
      return;
    }
    setActionLoading(true);
    setActionError(null);
    try {
      const data = await callFunction('verify-activation', {
        activation_token: activationToken,
        password,
      });
      if (data.error === 'token_expired') {
        setActionError(
          'This activation link has expired. Please contact support@reliantsupport.net to resend your activation.'
        );
        return;
      }
      if (data.access_token && data.refresh_token) {
        await supabase.auth.setSession({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
        });
        // onAuthStateChange will fire → resolveRole() → redirect to dashboard
      } else {
        setActionError(data.error || 'Something went wrong. Please try again.');
      }
    } catch {
      setActionError('Something went wrong. Please try again.');
    } finally {
      setActionLoading(false);
    }
  };

  // ── Loading state ────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  // ── Error: invalid/consumed token ────────────────────────────
  if (loadError) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center px-4">
        <div className="max-w-md text-center">
          <p className="text-red-400 mb-2">{loadError}</p>
          <p className="text-gray-500 text-sm">
            If you need help, contact{' '}
            <a href="mailto:support@reliantsupport.net" className="text-blue-400 underline">
              support@reliantsupport.net
            </a>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center px-4">
      <div className="max-w-md w-full">

        {/* ── Step 1: Set Up Subscription ─────────────────────── */}
        {!paid && (
          <div>
            <h1 className="text-2xl font-bold text-white mb-2">
              Welcome, {accountData.company_name}!
            </h1>
            <p className="text-gray-400 mb-6">
              Your AI receptionist account is fully configured. Set up your subscription
              to activate your account.
            </p>
            <div className="bg-gray-800 rounded-lg p-4 mb-6">
              <p className="text-white font-medium">{accountData.plan_name}</p>
              <p className="text-gray-400 text-sm">
                ${accountData.monthly_price}/mo ·{' '}
                {accountData.billing_cycle === 'annual' ? 'Billed annually' : 'Billed monthly'}
              </p>
            </div>
            {actionError && (
              <p className="text-red-400 text-sm mb-4">{actionError}</p>
            )}
            <button
              onClick={handleSetUpSubscription}
              disabled={actionLoading}
              className="w-full py-3 px-6 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg disabled:opacity-50"
            >
              {actionLoading ? 'Redirecting...' : 'Set Up Subscription'}
            </button>
          </div>
        )}

        {/* ── Step 2: Set Password ─────────────────────────────── */}
        {paid && (
          <form onSubmit={handleSetPassword}>
            <h1 className="text-2xl font-bold text-white mb-2">
              Subscription active — set your password
            </h1>
            <p className="text-gray-400 mb-6">
              One last step. Create a password to access your dashboard.
            </p>
            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Email</label>
                <input
                  type="email"
                  value={accountData.email}
                  readOnly
                  className="w-full px-3 py-2 bg-gray-700 text-gray-400 rounded-lg border border-gray-600 cursor-not-allowed"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Minimum 8 characters"
                  className="w-full px-3 py-2 bg-gray-800 text-white rounded-lg border border-gray-600 focus:outline-none focus:border-blue-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Confirm Password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter your password"
                  className="w-full px-3 py-2 bg-gray-800 text-white rounded-lg border border-gray-600 focus:outline-none focus:border-blue-500"
                  required
                />
              </div>
            </div>
            {actionError && (
              <p className="text-red-400 text-sm mb-4">{actionError}</p>
            )}
            <button
              type="submit"
              disabled={actionLoading}
              className="w-full py-3 px-6 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg disabled:opacity-50"
            >
              {actionLoading ? 'Setting up...' : 'Access My Dashboard'}
            </button>
          </form>
        )}

      </div>
    </div>
  );
}
