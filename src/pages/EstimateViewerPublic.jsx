// src/pages/EstimateViewerPublic.jsx
import React, { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp, CheckCircle } from 'lucide-react';

const SUPABASE_FUNCTIONS_URL = 'https://zmppdmfdhknnwzwdfhwf.supabase.co/functions/v1';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InptcHBkbWZkaGtubnd6d2RmaHdmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4MzQyMDYsImV4cCI6MjA4NTQxMDIwNn0.mXfuz8mEZhizFen78gUaakBDbrzANn4ZM1a7KuDiKJs';

const DEFAULT_LEGAL_TEXT =
  "By approving this estimate, you authorize the work described above to proceed at the quoted price. " +
  "Final invoice may vary if additional work is required and approved on-site.";

const formatCurrency = (n) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n ?? 0);

// ─────────────────────────────────────────
// OptionCard
// ─────────────────────────────────────────
const OptionCard = ({ option, isSelected, onSelect, disabled }) => {
  const [expanded, setExpanded] = useState(false);

  const lineItems = [...(option.estimate_line_items ?? [])].sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
  );

  return (
    <div
      className={`rounded-xl border-2 transition-all flex flex-col ${
        isSelected
          ? 'border-green-500 bg-green-950/30'
          : 'border-gray-700 bg-gray-800'
      }`}
    >
      {/* Header */}
      <div className="p-5 flex-1">
        <div className="flex items-start justify-between gap-3 mb-1">
          <span className="text-white font-semibold text-lg leading-tight">
            {option.label}
          </span>
          <div className="text-right flex-shrink-0">
            <div className="text-green-400 font-bold text-xl">
              {formatCurrency(option.total)}
            </div>
            {(option.tax_amount ?? 0) > 0 && (
              <div className="text-gray-500 text-xs">
                incl. {formatCurrency(option.tax_amount)} tax
              </div>
            )}
          </div>
        </div>

        {/* Collapsible line items */}
        <button
          onClick={() => setExpanded(v => !v)}
          className="flex items-center gap-1 text-gray-400 hover:text-gray-200 text-xs mt-3 transition-colors"
        >
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          {expanded ? 'Hide details' : 'Show details'}
        </button>

        {expanded && lineItems.length > 0 && (
          <div className="mt-3 space-y-0">
            {lineItems.map((item, idx) => (
              <div key={item.id ?? idx}>
                {idx > 0 && <div className="border-t border-gray-700 my-2" />}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <span className="text-white text-sm">{item.name}</span>
                    {item.description && (
                      <span className="text-gray-500 text-xs ml-2">{item.description}</span>
                    )}
                  </div>
                  <div className="text-gray-300 text-sm flex-shrink-0">
                    {(item.quantity ?? 1) !== 1
                      ? `${item.quantity} × ${formatCurrency(item.unit_price)}`
                      : formatCurrency(item.unit_price)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Select button */}
      {!disabled && (
        <div className="px-5 pb-5">
          {isSelected ? (
            <button
              disabled
              className="w-full py-2.5 bg-green-600 text-white font-medium rounded-lg cursor-default text-sm"
            >
              ✓ Selected
            </button>
          ) : (
            <button
              onClick={onSelect}
              className="w-full py-2.5 bg-gray-700 hover:bg-blue-600 text-white font-medium rounded-lg transition-colors text-sm"
            >
              Select this option
            </button>
          )}
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────
// EstimateViewerPublic
// ─────────────────────────────────────────
const EstimateViewerPublic = ({ token }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [estimate, setEstimate] = useState(null);
  const [options, setOptions] = useState([]);
  const [client, setClient] = useState({});
  const [selectedOptionId, setSelectedOptionId] = useState(null);
  const [approving, setApproving] = useState(false);
  const [approved, setApproved] = useState(false);
  const [approvalError, setApprovalError] = useState('');
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  useEffect(() => {
    fetch(`${SUPABASE_FUNCTIONS_URL}/get-estimate?token=${encodeURIComponent(token)}`, {
      headers: { apikey: ANON_KEY },
    })
      .then(r => r.json())
      .then(data => {
        if (data.error) { setError(data.error); return; }
        setEstimate(data.estimate);
        setOptions(data.options ?? []);
        setClient(data.client ?? {});
        if (data.estimate?.accepted_option_id) {
          setSelectedOptionId(data.estimate.accepted_option_id);
          setApproved(data.estimate.status === 'approved');
        }
      })
      .catch(() => setError('Failed to load estimate'))
      .finally(() => setLoading(false));
  }, [token]);

  const handleApprove = () => {
    if (!selectedOptionId) { setApprovalError('Please select an option first.'); return; }
    if (!agreedToTerms) { setApprovalError('Please agree to the terms to continue.'); return; }
    setApproving(true);
    setApprovalError('');
    fetch(`${SUPABASE_FUNCTIONS_URL}/approve-estimate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
      body: JSON.stringify({ token, option_id: selectedOptionId }),
    })
      .then(r => r.json())
      .then(data => {
        if (!data.ok) throw new Error(data.error || 'Approval failed');
        setApproved(true);
        setEstimate(prev => ({ ...prev, status: 'approved' }));
      })
      .catch(err => setApprovalError(err.message))
      .finally(() => setApproving(false));
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-gray-600 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !estimate) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center text-center px-4">
        <div>
          <h1 className="text-white text-xl font-semibold mb-2">Estimate unavailable</h1>
          <p className="text-gray-400 text-sm">{error || 'This estimate could not be found.'}</p>
        </div>
      </div>
    );
  }

  const isReadOnly = ['approved', 'declined', 'expired', 'converted'].includes(estimate?.status);
  const legalText = client?.legal_text ?? DEFAULT_LEGAL_TEXT;
  const expiresStr = estimate?.expires_at
    ? new Date(estimate.expires_at).toLocaleDateString()
    : null;
  const optionCount = options.length;

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header bar */}
      <div className="bg-gray-900 border-b border-gray-800 px-4 py-4">
        <div className="max-w-4xl mx-auto">
          {client.business_name && (
            <div className="text-sm text-gray-500 mb-1">{client.business_name}</div>
          )}
          <h1 className="text-xl font-semibold">{estimate.title}</h1>
          <div className="flex flex-wrap gap-4 mt-2 text-xs text-gray-500">
            {expiresStr && <span>Valid until {expiresStr}</span>}
            {estimate.status === 'approved' && (
              <span className="text-green-400 font-medium">✓ Approved</span>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-4">
        {/* Approved banner */}
        {(approved || estimate.status === 'approved') && (
          <div className="bg-green-950/50 border border-green-800 rounded-xl p-5 mb-6 flex items-start gap-4">
            <CheckCircle className="w-8 h-8 text-green-400 flex-shrink-0 mt-0.5" />
            <div>
              <h2 className="text-green-300 font-semibold text-lg mb-1">Estimate Approved</h2>
              <p className="text-gray-300 text-sm">
                Thank you! We'll be in touch to schedule the work. If you have questions,
                contact {client.business_name || 'us'} directly.
              </p>
            </div>
          </div>
        )}

        {/* Options grid — static classes only (no template literals) */}
        {options.length > 0 && (
          <div
            className={
              optionCount === 1
                ? 'grid grid-cols-1 gap-4 mb-6'
                : optionCount === 2
                ? 'grid grid-cols-1 md:grid-cols-2 gap-4 mb-6'
                : 'grid grid-cols-1 md:grid-cols-3 gap-4 mb-6'
            }
          >
            {options.map(option => (
              <OptionCard
                key={option.id}
                option={option}
                isSelected={selectedOptionId === option.id}
                onSelect={() => {
                  setSelectedOptionId(option.id);
                  setApprovalError('');
                }}
                disabled={isReadOnly}
              />
            ))}
          </div>
        )}

        {/* Approval section */}
        {selectedOptionId && !isReadOnly && (
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-5 mt-2">
            <h3 className="text-white font-semibold mb-3">Approve Estimate</h3>
            <p className="text-gray-400 text-sm mb-4">{legalText}</p>
            <label className="flex items-start gap-3 mb-4 cursor-pointer">
              <input
                type="checkbox"
                checked={agreedToTerms}
                onChange={e => setAgreedToTerms(e.target.checked)}
                className="mt-0.5 rounded border-gray-600"
              />
              <span className="text-gray-300 text-sm">
                I have read and agree to the above terms and authorize this work to proceed.
              </span>
            </label>
            {approvalError && (
              <p className="text-red-400 text-sm mb-3">{approvalError}</p>
            )}
            <button
              onClick={handleApprove}
              disabled={approving || !agreedToTerms}
              className="w-full py-3 bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors text-lg"
            >
              {approving ? 'Approving…' : 'Approve Estimate'}
            </button>
          </div>
        )}

        {/* Notes */}
        {estimate.notes && (
          <div className="mt-6 bg-gray-800 border border-gray-700 rounded-xl p-5">
            <h3 className="text-gray-400 text-xs font-semibold uppercase tracking-wide mb-2">
              Notes
            </h3>
            <p className="text-gray-300 text-sm whitespace-pre-wrap">{estimate.notes}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default EstimateViewerPublic;
