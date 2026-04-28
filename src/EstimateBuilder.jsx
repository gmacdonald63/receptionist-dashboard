import { useState, useEffect, useRef } from 'react'
import { X, Plus, Trash2, ChevronDown, Send, Check, AlertCircle } from 'lucide-react'
import { supabase } from './supabaseClient'

const SUPABASE_FUNCTIONS_URL = 'https://zmppdmfdhknnwzwdfhwf.supabase.co/functions/v1'
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InptcHBkbWZkaGtubnd6d2RmaHdmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4MzQyMDYsImV4cCI6MjA4NTQxMDIwNn0.mXfuz8mEZhizFen78gUaakBDbrzANn4ZM1a7KuDiKJs'
const INPUT_CLS = 'w-full px-2.5 py-1.5 bg-gray-750 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 text-sm'
const BTN_PRIMARY = 'px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors'
const BTN_SECONDARY = 'px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium rounded-lg transition-colors'
const BTN_DANGER = 'px-3 py-1.5 bg-red-900/40 hover:bg-red-900/60 text-red-400 text-xs rounded-lg transition-colors border border-red-800/40'
const UNIT_TYPES = ['each', 'hour', 'pound', 'foot', 'sqft', 'ton', 'trip']
const STATUS_COLORS = {
  draft: 'bg-gray-700 text-gray-300',
  sent: 'bg-blue-900/50 text-blue-300',
  viewed: 'bg-yellow-900/50 text-yellow-300',
  approved: 'bg-green-900/50 text-green-400',
  declined: 'bg-red-900/50 text-red-400',
  expired: 'bg-gray-700 text-gray-500',
  converted: 'bg-purple-900/50 text-purple-300',
}

function calcOptionTotals(lines, taxRate) {
  let subtotal = 0
  let tax_amount = 0
  for (const line of lines) {
    const qty = Number(line.quantity) || 0
    const price = Number(line.unit_price) || 0
    const lineTotal = qty * price
    subtotal += lineTotal
    if (line.taxable) {
      tax_amount += lineTotal * (Number(taxRate) || 0)
    }
  }
  return { subtotal, tax_amount, total: subtotal + tax_amount }
}

function formatCurrency(n) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n ?? 0)
}

// ── CatalogPicker ────────────────────────────────────────────────────────────
function CatalogPicker({ clientId, onSelect, onClose }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const ref = useRef(null)

  useEffect(() => {
    supabase
      .from('pricing_catalog')
      .select('id, name, description, category, unit_type, unit_price, taxable')
      .eq('client_id', clientId)
      .eq('is_active', true)
      .order('sort_order')
      .then(({ data }) => { setItems(data || []); setLoading(false) })
  }, [clientId])

  // Close on outside click
  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose()
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])

  const q = query.trim().toLowerCase()
  const visible = q
    ? items.filter(it => `${it.name} ${it.category || ''}`.toLowerCase().includes(q))
    : items

  return (
    <div
      ref={ref}
      className="absolute top-full left-0 mt-1 z-50 bg-gray-800 border border-gray-600 rounded-lg shadow-xl w-72 max-h-64 overflow-y-auto"
    >
      <div className="p-2 border-b border-gray-700 sticky top-0 bg-gray-800">
        <input
          autoFocus
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search catalog…"
          className={INPUT_CLS}
        />
      </div>
      {loading && <div className="p-3 text-gray-400 text-sm text-center">Loading…</div>}
      {!loading && visible.length === 0 && (
        <div className="p-3 text-gray-500 text-sm text-center">No items found</div>
      )}
      {!loading && visible.map(item => (
        <button
          key={item.id}
          onClick={() => { onSelect(item); onClose() }}
          className="w-full text-left px-3 py-2 hover:bg-gray-700 transition-colors border-b border-gray-700/50 last:border-0"
        >
          <div className="text-sm text-white font-medium truncate">{item.name}</div>
          <div className="text-xs text-gray-400 flex items-center gap-2 mt-0.5">
            <span>{formatCurrency(item.unit_price)} / {item.unit_type}</span>
            {item.category && <span className="text-gray-500">· {item.category}</span>}
          </div>
        </button>
      ))}
    </div>
  )
}

// ── LineItemRow ──────────────────────────────────────────────────────────────
function LineItemRow({ line, onChange, onDelete, compact, readOnly }) {
  if (compact) {
    return (
      <div className="bg-gray-900/50 rounded-lg p-2 mb-2 border border-gray-700/50">
        <div className="flex items-center gap-2 mb-2">
          <input
            type="text"
            value={line.name}
            onChange={e => onChange({ ...line, name: e.target.value })}
            placeholder="Item name"
            className={`${INPUT_CLS} flex-1`}
            readOnly={readOnly}
          />
          {!readOnly && (
            <button onClick={onDelete} className="text-red-400 hover:text-red-300 p-1">
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 mb-2">
          <input
            type="number"
            value={line.quantity}
            onChange={e => onChange({ ...line, quantity: e.target.value })}
            placeholder="Qty"
            min="0"
            step="any"
            className={`${INPUT_CLS} w-20`}
            readOnly={readOnly}
          />
          <select
            value={line.unit_type}
            onChange={e => onChange({ ...line, unit_type: e.target.value })}
            className={`${INPUT_CLS} flex-1`}
            disabled={readOnly}
          >
            {UNIT_TYPES.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
          <input
            type="number"
            value={line.unit_price}
            onChange={e => onChange({ ...line, unit_price: e.target.value })}
            placeholder="Price"
            min="0"
            step="0.01"
            className={`${INPUT_CLS} w-28`}
            readOnly={readOnly}
          />
        </div>
        <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={!!line.taxable}
            onChange={e => onChange({ ...line, taxable: e.target.checked })}
            disabled={readOnly}
          />
          Taxable
        </label>
        {line.description !== undefined && (
          <input
            type="text"
            value={line.description || ''}
            onChange={e => onChange({ ...line, description: e.target.value })}
            placeholder="Notes (optional)"
            className={`${INPUT_CLS} mt-2`}
            readOnly={readOnly}
          />
        )}
      </div>
    )
  }

  // Desktop: 12-col grid — name(4) notes(2) qty(1) unit(1) price(2) taxable(1) delete(1)
  return (
    <div className="grid grid-cols-12 gap-1 items-center mb-1">
      <div className="col-span-4">
        <input
          type="text"
          value={line.name}
          onChange={e => onChange({ ...line, name: e.target.value })}
          placeholder="Item name"
          className={INPUT_CLS}
          readOnly={readOnly}
        />
      </div>
      <div className="col-span-2">
        <input
          type="text"
          value={line.description || ''}
          onChange={e => onChange({ ...line, description: e.target.value })}
          placeholder="Notes"
          className={INPUT_CLS}
          readOnly={readOnly}
        />
      </div>
      <div className="col-span-1">
        <input
          type="number"
          value={line.quantity}
          onChange={e => onChange({ ...line, quantity: e.target.value })}
          placeholder="Qty"
          min="0"
          step="any"
          className={INPUT_CLS}
          readOnly={readOnly}
        />
      </div>
      <div className="col-span-1">
        <select
          value={line.unit_type}
          onChange={e => onChange({ ...line, unit_type: e.target.value })}
          className={INPUT_CLS}
          disabled={readOnly}
        >
          {UNIT_TYPES.map(u => <option key={u} value={u}>{u}</option>)}
        </select>
      </div>
      <div className="col-span-2">
        <input
          type="number"
          value={line.unit_price}
          onChange={e => onChange({ ...line, unit_price: e.target.value })}
          placeholder="0.00"
          min="0"
          step="0.01"
          className={INPUT_CLS}
          readOnly={readOnly}
        />
      </div>
      <div className="col-span-1 flex justify-center">
        <input
          type="checkbox"
          checked={!!line.taxable}
          onChange={e => onChange({ ...line, taxable: e.target.checked })}
          disabled={readOnly}
          className="w-4 h-4"
        />
      </div>
      <div className="col-span-1 flex justify-center">
        {!readOnly && (
          <button onClick={onDelete} className="text-red-400 hover:text-red-300 p-1">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}

// ── OptionPanel ──────────────────────────────────────────────────────────────
function OptionPanel({ option, lines, taxRate, clientId, onLabelChange, onLineChange, onLineAdd, onLineDelete, onDelete, compact, isOnly, readOnly }) {
  const [showCatalog, setShowCatalog] = useState(false)
  const totals = calcOptionTotals(lines, taxRate)

  function handleCatalogSelect(item) {
    onLineAdd({
      _id: crypto.randomUUID(),
      id: null,
      catalog_item_id: item.id,
      name: item.name,
      description: item.description || '',
      unit_type: item.unit_type,
      quantity: 1,
      unit_price: item.unit_price,
      taxable: item.taxable,
      sort_order: lines.length,
    })
  }

  function handleAddCustomLine() {
    onLineAdd({
      _id: crypto.randomUUID(),
      id: null,
      catalog_item_id: null,
      name: '',
      description: '',
      unit_type: 'each',
      quantity: 1,
      unit_price: 0,
      taxable: true,
      sort_order: lines.length,
    })
  }

  return (
    <div className="bg-gray-900/60 rounded-lg border border-gray-700 p-3 mb-3">
      {/* Option header */}
      <div className="flex items-center gap-2 mb-3">
        <input
          type="text"
          value={option.label}
          onChange={e => onLabelChange(e.target.value)}
          placeholder="Option label"
          className={`${INPUT_CLS} flex-1 font-medium`}
          readOnly={readOnly}
        />
        {!isOnly && !readOnly && (
          <button onClick={onDelete} className={BTN_DANGER}>
            Remove option
          </button>
        )}
      </div>

      {/* Column headers (desktop only) */}
      {!compact && (
        <div className="grid grid-cols-12 gap-1 mb-1 text-xs text-gray-500 uppercase tracking-wide px-0.5">
          <div className="col-span-4">Item</div>
          <div className="col-span-2">Notes</div>
          <div className="col-span-1">Qty</div>
          <div className="col-span-1">Unit</div>
          <div className="col-span-2">Unit Price</div>
          <div className="col-span-1 text-center">Tax</div>
          <div className="col-span-1"></div>
        </div>
      )}

      {/* Line items */}
      {lines.length === 0 && (
        <div className="text-gray-500 text-sm text-center py-4 border border-dashed border-gray-700 rounded-lg mb-2">
          No line items yet. Add from catalog or create a custom line.
        </div>
      )}
      {lines.map(line => (
        <LineItemRow
          key={line._id}
          line={line}
          onChange={updated => onLineChange(line._id, updated)}
          onDelete={() => onLineDelete(line._id)}
          compact={compact}
          readOnly={readOnly}
        />
      ))}

      {/* Add buttons */}
      {!readOnly && (
        <div className="flex items-center gap-2 mt-2 relative">
          <div className="relative">
            <button
              onClick={() => setShowCatalog(v => !v)}
              className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> From catalog
              <ChevronDown className="w-3 h-3" />
            </button>
            {showCatalog && (
              <CatalogPicker
                clientId={clientId}
                onSelect={handleCatalogSelect}
                onClose={() => setShowCatalog(false)}
              />
            )}
          </div>
          <span className="text-gray-600 text-xs">·</span>
          <button
            onClick={handleAddCustomLine}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-300 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Custom line
          </button>
        </div>
      )}

      {/* Totals */}
      <div className="mt-3 pt-3 border-t border-gray-700/50 flex justify-end">
        <div className="text-right space-y-0.5 min-w-[140px]">
          <div className="flex justify-between gap-4 text-sm text-gray-400">
            <span>Subtotal</span>
            <span className="tabular-nums">{formatCurrency(totals.subtotal)}</span>
          </div>
          {totals.tax_amount > 0 && (
            <div className="flex justify-between gap-4 text-sm text-gray-400">
              <span>Tax ({((Number(taxRate) || 0) * 100).toFixed(1)}%)</span>
              <span className="tabular-nums">{formatCurrency(totals.tax_amount)}</span>
            </div>
          )}
          <div className="flex justify-between gap-4 text-base font-semibold text-green-400">
            <span>Total</span>
            <span className="tabular-nums">{formatCurrency(totals.total)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── SendModal ────────────────────────────────────────────────────────────────
function SendModal({ estimate, onClose, onSent }) {
  const [customerName, setCustomerName] = useState('')
  const [phone, setPhone] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [portalUrl, setPortalUrl] = useState('')
  const [error, setError] = useState('')

  async function handleSend(e) {
    e.preventDefault()
    if (!phone.trim()) { setError('Phone number is required.'); return }
    setSending(true)
    setError('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/send-estimate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token || ''}`,
          'apikey': ANON_KEY,
        },
        body: JSON.stringify({
          estimate_id: estimate.id,
          phone: phone.trim(),
          customer_name: customerName.trim() || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      setPortalUrl(json.portal_url || '')
      setSent(true)
      onSent?.()
    } catch (err) {
      setError(err.message || 'Failed to send. Please try again.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-gray-800 rounded-lg border border-gray-700 w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Send Estimate via SMS</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        {sent ? (
          <div className="text-center py-4">
            <div className="w-12 h-12 bg-green-900/50 rounded-full flex items-center justify-center mx-auto mb-3">
              <Check className="w-6 h-6 text-green-400" />
            </div>
            <p className="text-green-400 font-medium mb-1">Estimate sent!</p>
            {portalUrl && (
              <p className="text-xs text-gray-400 break-all mb-4">{portalUrl}</p>
            )}
            <button onClick={onClose} className={BTN_PRIMARY}>Done</button>
          </div>
        ) : (
          <form onSubmit={handleSend} className="space-y-4">
            {error && (
              <div className="flex items-start gap-2 p-3 bg-red-900/40 border border-red-800 rounded-lg text-red-300 text-sm">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                {error}
              </div>
            )}
            <div>
              <label className="text-sm text-gray-300 block mb-1">Customer Name <span className="text-gray-500">(optional)</span></label>
              <input
                type="text"
                value={customerName}
                onChange={e => setCustomerName(e.target.value)}
                placeholder="e.g. John Smith"
                className={INPUT_CLS}
              />
            </div>
            <div>
              <label className="text-sm text-gray-300 block mb-1">Phone Number <span className="text-red-400">*</span></label>
              <input
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="+15035551234"
                className={INPUT_CLS}
                autoFocus
              />
              <p className="text-xs text-gray-500 mt-1">Include country code, e.g. +15035551234</p>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button type="button" onClick={onClose} className={BTN_SECONDARY} disabled={sending}>Cancel</button>
              <button type="submit" className={BTN_PRIMARY} disabled={sending}>
                {sending ? 'Sending…' : (
                  <span className="flex items-center gap-1.5"><Send className="w-4 h-4" /> Send SMS</span>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

// ── EstimateBuilder (main export) ────────────────────────────────────────────
export default function EstimateBuilder({
  clientId,
  appointmentId,
  customerId,
  estimateId,
  taxRate: taxRateProp,
  compact = false,
  onClose,
  onSaved,
}) {
  const [loading, setLoading] = useState(!!estimateId)
  const [saving, setSaving] = useState(false)
  const [showSend, setShowSend] = useState(false)
  const [error, setError] = useState('')

  const [estimateDbId, setEstimateDbId] = useState(estimateId || null)
  const [status, setStatus] = useState('draft')
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [taxRate, setTaxRate] = useState(taxRateProp ?? 0)

  const [options, setOptions] = useState([
    { _id: crypto.randomUUID(), id: null, label: 'Standard', lines: [] },
  ])

  // Track which option db IDs were removed so we can delete them on save
  const removedOptionIds = useRef([])

  // Load tax rate from DB if not provided as prop
  useEffect(() => {
    if (taxRateProp !== undefined) return
    if (!clientId) return
    supabase
      .from('clients')
      .select('default_tax_rate')
      .eq('id', clientId)
      .single()
      .then(({ data }) => {
        if (data?.default_tax_rate != null) setTaxRate(Number(data.default_tax_rate))
      })
  }, [clientId, taxRateProp])

  // Load existing estimate if estimateId provided
  useEffect(() => {
    if (!estimateId) return
    setLoading(true)
    Promise.all([
      supabase
        .from('estimates')
        .select('*')
        .eq('id', estimateId)
        .single(),
      supabase
        .from('estimate_options')
        .select('*')
        .eq('estimate_id', estimateId)
        .order('sort_order'),
      supabase
        .from('estimate_line_items')
        .select('*')
        .eq('estimate_id', estimateId)
        .order('sort_order'),
    ]).then(([estRes, optRes, lineRes]) => {
      const est = estRes.data
      const opts = optRes.data || []
      const lineItems = lineRes.data || []

      if (est) {
        setStatus(est.status || 'draft')
        setTitle(est.title || '')
        setNotes(est.notes || '')
        setExpiresAt(est.expires_at ? est.expires_at.slice(0, 10) : '')
      }

      if (opts.length > 0) {
        setOptions(opts.map(opt => ({
          _id: opt.id,
          id: opt.id,
          label: opt.label || 'Standard',
          lines: lineItems
            .filter(l => l.option_id === opt.id)
            .map(l => ({ ...l, _id: l.id })),
        })))
      }
      setLoading(false)
    })
  }, [estimateId])

  const isReadOnly = ['approved', 'converted'].includes(status)

  // Option label cycling for "Add option"
  const OPTION_LABELS = ['Standard', 'Good', 'Better', 'Best']
  function nextLabel() {
    const used = options.map(o => o.label)
    return OPTION_LABELS.find(l => !used.includes(l)) || `Option ${options.length + 1}`
  }

  function addOption() {
    if (options.length >= 3) return
    setOptions(prev => [...prev, { _id: crypto.randomUUID(), id: null, label: nextLabel(), lines: [] }])
  }

  function removeOption(optId) {
    setOptions(prev => {
      const opt = prev.find(o => o._id === optId)
      if (opt?.id) removedOptionIds.current.push(opt.id)
      return prev.filter(o => o._id !== optId)
    })
  }

  function setOptionLabel(optId, label) {
    setOptions(prev => prev.map(o => o._id === optId ? { ...o, label } : o))
  }

  function addLine(optId, line) {
    setOptions(prev => prev.map(o =>
      o._id === optId ? { ...o, lines: [...o.lines, line] } : o
    ))
  }

  function changeLine(optId, lineId, updated) {
    setOptions(prev => prev.map(o =>
      o._id === optId
        ? { ...o, lines: o.lines.map(l => l._id === lineId ? updated : l) }
        : o
    ))
  }

  function deleteLine(optId, lineId) {
    setOptions(prev => prev.map(o =>
      o._id === optId
        ? { ...o, lines: o.lines.filter(l => l._id !== lineId) }
        : o
    ))
  }

  async function handleSave() {
    if (!title.trim()) { setError('Title is required.'); return }
    setError('')
    setSaving(true)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const userEmail = session?.user?.email || null

      let estId = estimateDbId

      if (!estId) {
        // INSERT new estimate
        const { data, error: insertErr } = await supabase
          .from('estimates')
          .insert({
            client_id: clientId,
            appointment_id: appointmentId || null,
            customer_id: customerId || null,
            title: title.trim(),
            notes: notes.trim() || null,
            expires_at: expiresAt || null,
            status: 'draft',
            created_by_email: userEmail,
          })
          .select('id')
          .single()
        if (insertErr) throw insertErr
        estId = data.id
        setEstimateDbId(estId)
      } else {
        // UPDATE existing estimate
        const { error: updateErr } = await supabase
          .from('estimates')
          .update({
            title: title.trim(),
            notes: notes.trim() || null,
            expires_at: expiresAt || null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', estId)
        if (updateErr) throw updateErr
      }

      // Delete removed options
      if (removedOptionIds.current.length > 0) {
        await supabase
          .from('estimate_line_items')
          .delete()
          .in('option_id', removedOptionIds.current)
        await supabase
          .from('estimate_options')
          .delete()
          .in('id', removedOptionIds.current)
        removedOptionIds.current = []
      }

      // Upsert options + lines
      for (let i = 0; i < options.length; i++) {
        const opt = options[i]
        const totals = calcOptionTotals(opt.lines, taxRate)

        let optDbId = opt.id
        if (!optDbId) {
          const { data: optData, error: optErr } = await supabase
            .from('estimate_options')
            .insert({
              estimate_id: estId,
              label: opt.label,
              sort_order: i,
              subtotal: totals.subtotal,
              tax_amount: totals.tax_amount,
              total: totals.total,
            })
            .select('id')
            .single()
          if (optErr) throw optErr
          optDbId = optData.id
          // Update local state with db id
          setOptions(prev => prev.map(o => o._id === opt._id ? { ...o, id: optDbId } : o))
        } else {
          const { error: optUpdateErr } = await supabase
            .from('estimate_options')
            .update({
              label: opt.label,
              sort_order: i,
              subtotal: totals.subtotal,
              tax_amount: totals.tax_amount,
              total: totals.total,
              updated_at: new Date().toISOString(),
            })
            .eq('id', optDbId)
          if (optUpdateErr) throw optUpdateErr
        }

        // Delete all existing line items for this option, then re-insert
        await supabase.from('estimate_line_items').delete().eq('option_id', optDbId)
        if (opt.lines.length > 0) {
          const lineRows = opt.lines.map((line, idx) => ({
            estimate_id: estId,
            option_id: optDbId,
            catalog_item_id: line.catalog_item_id || null,
            name: line.name || '',
            description: line.description || null,
            unit_type: line.unit_type || 'each',
            quantity: Number(line.quantity) || 0,
            unit_price: Number(line.unit_price) || 0,
            taxable: !!line.taxable,
            sort_order: idx,
          }))
          const { error: lineErr } = await supabase.from('estimate_line_items').insert(lineRows)
          if (lineErr) throw lineErr
        }
      }

      onSaved?.(estId)
    } catch (err) {
      setError(err.message || 'Save failed. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-400 text-sm">Loading estimate…</div>
      </div>
    )
  }

  const isNew = !estimateDbId

  return (
    <div className="flex flex-col h-full bg-gray-900">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-800 border-b border-gray-700 shrink-0">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-white">
            {isNew ? 'New Estimate' : 'Edit Estimate'}
          </h2>
          {estimateDbId && (
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[status] || STATUS_COLORS.draft}`}>
              {status}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!isReadOnly && (
            <>
              <button
                onClick={handleSave}
                disabled={saving}
                className={`${BTN_SECONDARY} disabled:opacity-50`}
              >
                {saving ? 'Saving…' : 'Save Draft'}
              </button>
              {estimateDbId && (
                <button
                  onClick={() => setShowSend(true)}
                  className={BTN_PRIMARY}
                >
                  <span className="flex items-center gap-1.5">
                    <Send className="w-4 h-4" /> Send via SMS
                  </span>
                </button>
              )}
            </>
          )}
          <button onClick={onClose} className="text-gray-400 hover:text-white p-1.5 rounded-lg hover:bg-gray-700 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-4 mt-3 flex items-start gap-2 p-3 bg-red-900/40 border border-red-800 rounded-lg text-red-300 text-sm shrink-0">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4">
        {/* Header fields */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          <div className="md:col-span-2">
            <label className="text-sm text-gray-300 block mb-1">
              Title <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. HVAC Repair — 123 Main St"
              className={INPUT_CLS}
              readOnly={isReadOnly}
            />
          </div>
          <div>
            <label className="text-sm text-gray-300 block mb-1">Valid Until</label>
            <input
              type="date"
              value={expiresAt}
              onChange={e => setExpiresAt(e.target.value)}
              className={INPUT_CLS}
              readOnly={isReadOnly}
            />
          </div>
          <div className="md:col-span-3">
            <label className="text-sm text-gray-300 block mb-1">
              Notes <span className="text-gray-500 font-normal">(internal — not shown to customer)</span>
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Internal notes…"
              rows={2}
              className={`${INPUT_CLS} resize-none`}
              readOnly={isReadOnly}
            />
          </div>
        </div>

        {/* Options */}
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">
            {options.length === 1 ? 'Line Items' : 'Options'}
          </h3>
          {!isReadOnly && options.length < 3 && (
            <button
              onClick={addOption}
              className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Add option
            </button>
          )}
        </div>

        {options.map(opt => (
          <OptionPanel
            key={opt._id}
            option={opt}
            lines={opt.lines}
            taxRate={taxRate}
            clientId={clientId}
            onLabelChange={label => setOptionLabel(opt._id, label)}
            onLineChange={(lineId, updated) => changeLine(opt._id, lineId, updated)}
            onLineAdd={line => addLine(opt._id, line)}
            onLineDelete={lineId => deleteLine(opt._id, lineId)}
            onDelete={() => removeOption(opt._id)}
            compact={compact}
            isOnly={options.length === 1}
            readOnly={isReadOnly}
          />
        ))}
      </div>

      {/* Send Modal */}
      {showSend && (
        <SendModal
          estimate={{ id: estimateDbId }}
          onClose={() => setShowSend(false)}
          onSent={() => setStatus('sent')}
        />
      )}
    </div>
  )
}
