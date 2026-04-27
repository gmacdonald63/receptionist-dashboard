import { useState, useEffect, useMemo } from 'react'
import { Search, Plus, Download, Upload, Edit2, Trash2 } from 'lucide-react'
import { supabase } from './supabaseClient'

// Tailwind class strings reused across inputs (matches AppointmentSidePanel.jsx:35-37 pattern)
const INPUT_CLS = 'w-full px-2.5 py-1.5 bg-gray-750 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 text-sm'

export default function PricingCatalog({ clientId }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Filter / search state
  const [searchQuery, setSearchQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [activeOnly, setActiveOnly] = useState(true)

  // Write-side state
  const [showForm, setShowForm] = useState(false)
  const [editingItem, setEditingItem] = useState(null)
  const [formError, setFormError] = useState(null)
  const [saving, setSaving] = useState(false)

  // CSV import state
  const [importPreview, setImportPreview] = useState(null)
  const [importing, setImporting] = useState(false)

  // Service types for the optional link dropdown
  const [serviceTypes, setServiceTypes] = useState([])
  useEffect(() => {
    if (!clientId) return
    supabase
      .from('service_types')
      .select('id, name, category')
      .eq('client_id', clientId)
      .eq('is_active', true)
      .order('category').order('name')
      .then(({ data }) => setServiceTypes(data || []))
  }, [clientId])

  // Load catalog on mount + when clientId changes
  useEffect(() => {
    if (!clientId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    supabase
      .from('pricing_catalog')
      .select('id, name, description, category, unit_type, unit_price, taxable, tier, tier_group, service_type_id, is_active, sort_order, created_at, updated_at')
      .eq('client_id', clientId)
      .order('category', { ascending: true, nullsFirst: false })
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          setError(error.message)
          setItems([])
        } else {
          setItems(data || [])
        }
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [clientId])

  // Derived: distinct category list
  const categories = useMemo(() => {
    const seen = new Set()
    items.forEach(it => { if (it.category) seen.add(it.category) })
    return Array.from(seen).sort()
  }, [items])

  // Derived: filtered list
  const visibleItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return items.filter(it => {
      if (activeOnly && !it.is_active) return false
      if (categoryFilter !== 'all' && it.category !== categoryFilter) return false
      if (q) {
        const hay = `${it.name} ${it.description || ''} ${it.category || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [items, searchQuery, categoryFilter, activeOnly])

  async function handleDelete(item) {
    if (!confirm(`Delete "${item.name}"? This cannot be undone.\n\nIf this item is referenced by future estimates or invoices, consider marking it Hidden instead.`)) {
      return
    }
    const { error } = await supabase.from('pricing_catalog').delete().eq('id', item.id)
    if (error) {
      if (error.code === '23503') {
        alert(`"${item.name}" is referenced by existing estimates or invoices and cannot be deleted.\n\nMark it Hidden via Edit instead to remove it from future selections.`)
      } else {
        alert(`Delete failed: ${error.message}`)
      }
      return
    }
    setItems(prev => prev.filter(it => it.id !== item.id))
  }

  async function handleExport() {
    const Papa = (await import('papaparse')).default
    const rows = visibleItems.map(it => ({
      name: it.name,
      description: it.description || '',
      category: it.category || '',
      unit_type: it.unit_type,
      unit_price: it.unit_price,
      taxable: it.taxable ? 'true' : 'false',
      tier: it.tier || '',
      tier_group: it.tier_group || '',
      is_active: it.is_active ? 'true' : 'false',
      sort_order: it.sort_order,
    }))
    const csv = Papa.unparse(rows)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const today = new Date().toISOString().slice(0, 10)
    a.download = `pricing-catalog-${today}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  async function handleImportFile(file) {
    if (!file) return
    const Papa = (await import('papaparse')).default
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: h => h.trim(),
      complete: ({ data }) => {
        const rows = data.map(raw => parseCsvRow(raw))
        const validCount = rows.filter(r => r.errors.length === 0).length
        setImportPreview({ rows, validCount, invalidCount: rows.length - validCount })
      },
      error: (err) => alert(`Failed to parse CSV: ${err.message}`),
    })
  }

  async function commitImport() {
    if (!importPreview) return
    const validRows = importPreview.rows.filter(r => r.errors.length === 0).map(r => ({ ...r.parsed, client_id: clientId }))
    if (validRows.length === 0) { alert('No valid rows to import.'); return }
    setImporting(true)
    const { data, error } = await supabase.from('pricing_catalog').insert(validRows).select()
    setImporting(false)
    if (error) {
      alert(`Import failed: ${error.message}`)
      return
    }
    setItems(prev => [...prev, ...(data || [])])
    setImportPreview(null)
  }

  if (loading) {
    return <div className="p-6 text-gray-400">Loading pricing catalog…</div>
  }
  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-900/50 border border-red-700 text-red-300 rounded-lg p-4">
          Failed to load catalog: {error}
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-2xl font-bold text-white">Pricing Catalog</h2>
          <p className="text-sm text-gray-400 mt-1">
            {items.length} {items.length === 1 ? 'item' : 'items'}
            {visibleItems.length !== items.length && ` (${visibleItems.length} shown)`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 px-3 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 cursor-pointer">
            <Upload className="w-4 h-4" /> Import CSV
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={e => { handleImportFile(e.target.files[0]); e.target.value = '' }}
              className="hidden"
            />
          </label>
          <button
            onClick={handleExport}
            disabled={visibleItems.length === 0}
            className="flex items-center gap-2 px-3 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download className="w-4 h-4" /> Export
          </button>
          <button
            onClick={() => { setEditingItem(null); setFormError(null); setShowForm(true) }}
            className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" /> Add Item
          </button>
        </div>
      </div>

      {/* Filter row */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search by name, description, category…"
            className={`${INPUT_CLS} pl-9`}
          />
        </div>
        <select
          value={categoryFilter}
          onChange={e => setCategoryFilter(e.target.value)}
          className={`${INPUT_CLS} w-auto`}
        >
          <option value="all">All categories</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm text-gray-300 select-none cursor-pointer">
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={e => setActiveOnly(e.target.checked)}
            className="rounded"
          />
          Active only
        </label>
      </div>

      {/* List */}
      {visibleItems.length === 0 ? (
        <EmptyState hasItems={items.length > 0} onClearFilters={() => {
          setSearchQuery(''); setCategoryFilter('all'); setActiveOnly(true)
        }} />
      ) : (
        <CatalogTable
          items={visibleItems}
          onEdit={(item) => { setEditingItem(item); setFormError(null); setShowForm(true) }}
          onDelete={handleDelete}
        />
      )}

      {/* Import preview modal */}
      {importPreview && (
        <ImportPreviewModal
          preview={importPreview}
          importing={importing}
          onCommit={commitImport}
          onCancel={() => setImportPreview(null)}
        />
      )}

      {/* Add/Edit modal */}
      {showForm && (
        <CatalogItemForm
          item={editingItem}
          serviceTypes={serviceTypes}
          clientId={clientId}
          error={formError}
          setError={setFormError}
          saving={saving}
          setSaving={setSaving}
          onCancel={() => { setShowForm(false); setEditingItem(null); setFormError(null) }}
          onSaved={(saved, wasEdit) => {
            setShowForm(false); setEditingItem(null); setFormError(null)
            setItems(prev => {
              const updated = wasEdit
                ? prev.map(it => it.id === saved.id ? saved : it)
                : [...prev, saved]
              return [...updated].sort((a, b) =>
                (a.sort_order - b.sort_order) || a.name.localeCompare(b.name)
              )
            })
          }}
        />
      )}
    </div>
  )
}

function EmptyState({ hasItems, onClearFilters }) {
  if (hasItems) {
    return (
      <div className="text-center py-16 text-gray-400">
        <p className="mb-2">No items match the current filters.</p>
        <button onClick={onClearFilters} className="text-blue-400 hover:text-blue-300 underline text-sm">
          Clear filters
        </button>
      </div>
    )
  }
  return (
    <div className="text-center py-16 text-gray-400">
      <p className="mb-2">Your pricing catalog is empty.</p>
      <p className="text-sm">Add items individually or import a CSV to get started.</p>
    </div>
  )
}

function CatalogTable({ items, onEdit, onDelete }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-700">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-800 text-gray-300 uppercase text-xs">
          <tr>
            <th className="px-4 py-3 text-left">Name</th>
            <th className="px-4 py-3 text-left">Category</th>
            <th className="px-4 py-3 text-left">Unit</th>
            <th className="px-4 py-3 text-right">Price</th>
            <th className="px-4 py-3 text-center">Tax</th>
            <th className="px-4 py-3 text-center">Status</th>
            <th className="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-700 bg-gray-900">
          {items.map(it => (
            <tr key={it.id} className="hover:bg-gray-800">
              <td className="px-4 py-3 text-white">
                <div className="font-medium">{it.name}</div>
                {it.description && <div className="text-xs text-gray-400 mt-0.5 truncate max-w-md">{it.description}</div>}
              </td>
              <td className="px-4 py-3 text-gray-300">{it.category || <span className="text-gray-500">—</span>}</td>
              <td className="px-4 py-3 text-gray-300">{it.unit_type}</td>
              <td className="px-4 py-3 text-right text-white tabular-nums">
                ${Number(it.unit_price).toFixed(2)}
              </td>
              <td className="px-4 py-3 text-center">
                {it.taxable
                  ? <span className="text-green-400" title="Taxable">●</span>
                  : <span className="text-gray-500" title="Not taxable">○</span>}
              </td>
              <td className="px-4 py-3 text-center">
                {it.is_active
                  ? <span className="text-xs px-2 py-0.5 rounded bg-green-900/50 text-green-300 border border-green-800">Active</span>
                  : <span className="text-xs px-2 py-0.5 rounded bg-gray-700 text-gray-400 border border-gray-600">Hidden</span>}
              </td>
              <td className="px-4 py-3 text-right">
                <button onClick={() => onEdit(it)} className="p-1.5 text-gray-300 hover:text-blue-400" title="Edit">
                  <Edit2 className="w-4 h-4" />
                </button>
                <button onClick={() => onDelete(it)} className="p-1.5 text-gray-300 hover:text-red-400" title="Delete">
                  <Trash2 className="w-4 h-4" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CatalogItemForm({ item, serviceTypes, clientId, onSaved, onCancel, error, setError, saving, setSaving }) {
  const [form, setForm] = useState(() => ({
    name: item?.name || '',
    description: item?.description || '',
    category: item?.category || '',
    unit_type: item?.unit_type || 'each',
    unit_price: item?.unit_price != null ? String(item.unit_price) : '',
    taxable: item?.taxable ?? true,
    tier: item?.tier || '',
    tier_group: item?.tier_group || '',
    service_type_id: item?.service_type_id || '',
    is_active: item?.is_active ?? true,
    sort_order: item?.sort_order ?? 0,
  }))

  function update(field, value) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  function validate() {
    if (!form.name.trim()) return 'Name is required.'
    if (!form.unit_type.trim()) return 'Unit type is required.'
    const price = Number(form.unit_price)
    if (Number.isNaN(price) || price < 0) return 'Unit price must be a non-negative number.'
    return null
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const v = validate()
    if (v) { setError(v); return }

    setSaving(true)
    setError(null)

    const payload = {
      client_id: clientId,
      name: form.name.trim(),
      description: form.description.trim() || null,
      category: form.category.trim() || null,
      unit_type: form.unit_type.trim(),
      unit_price: Number(form.unit_price),
      taxable: !!form.taxable,
      tier: form.tier.trim() || null,
      tier_group: form.tier_group.trim() || null,
      service_type_id: form.service_type_id ? Number(form.service_type_id) : null,
      is_active: !!form.is_active,
      sort_order: Number(form.sort_order) || 0,
    }

    let result
    if (item) {
      result = await supabase.from('pricing_catalog').update(payload).eq('id', item.id).select().single()
    } else {
      result = await supabase.from('pricing_catalog').insert(payload).select().single()
    }

    setSaving(false)
    if (result.error) {
      setError(result.error.message)
      return
    }
    onSaved(result.data, !!item)
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg border border-gray-700 p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <h3 className="text-xl font-bold text-white mb-4">
          {item ? 'Edit pricing item' : 'Add pricing item'}
        </h3>

        {error && (
          <div className="mb-4 p-3 bg-red-900/50 border border-red-700 text-red-300 rounded-lg text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name + Category row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Name" required>
              <input type="text" value={form.name} onChange={e => update('name', e.target.value)} className={INPUT_CLS} autoFocus />
            </Field>
            <Field label="Category">
              <input type="text" value={form.category} onChange={e => update('category', e.target.value)} className={INPUT_CLS} placeholder="e.g. Diagnostics, Parts, Labor" />
            </Field>
          </div>

          <Field label="Description">
            <textarea value={form.description} onChange={e => update('description', e.target.value)} className={`${INPUT_CLS} min-h-[60px]`} rows={2} />
          </Field>

          {/* Pricing row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="Unit type" required>
              <select value={form.unit_type} onChange={e => update('unit_type', e.target.value)} className={INPUT_CLS}>
                <option value="each">each</option>
                <option value="hour">hour (T&amp;M / labor)</option>
                <option value="pound">pound</option>
                <option value="foot">foot</option>
                <option value="gallon">gallon</option>
                <option value="unit">unit</option>
              </select>
            </Field>
            <Field label="Unit price ($)" required>
              <input type="number" min="0" step="0.01" value={form.unit_price} onChange={e => update('unit_price', e.target.value)} className={INPUT_CLS} />
            </Field>
            <Field label="Taxable">
              <label className="flex items-center gap-2 mt-2 text-sm text-gray-300 cursor-pointer">
                <input type="checkbox" checked={form.taxable} onChange={e => update('taxable', e.target.checked)} />
                Apply default tax rate
              </label>
            </Field>
          </div>

          {/* Advanced section */}
          <details className="rounded border border-gray-700 p-3 bg-gray-900/40">
            <summary className="cursor-pointer text-sm text-gray-300">Advanced — tier, link to service, sort order</summary>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Tier (Phase 2 good/better/best)">
                <input type="text" value={form.tier} onChange={e => update('tier', e.target.value)} className={INPUT_CLS} placeholder="good | better | best | (blank)" />
              </Field>
              <Field label="Tier group">
                <input type="text" value={form.tier_group} onChange={e => update('tier_group', e.target.value)} className={INPUT_CLS} placeholder="Groups multi-tier rows together" />
              </Field>
              <Field label="Linked service type (optional)">
                <select value={form.service_type_id} onChange={e => update('service_type_id', e.target.value)} className={INPUT_CLS}>
                  <option value="">— none —</option>
                  {serviceTypes.map(s => (
                    <option key={s.id} value={s.id}>{s.category} — {s.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Sort order">
                <input type="number" value={form.sort_order} onChange={e => update('sort_order', e.target.value)} className={INPUT_CLS} />
              </Field>
            </div>
          </details>

          <Field label="Status">
            <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
              <input type="checkbox" checked={form.is_active} onChange={e => update('is_active', e.target.checked)} />
              Active (visible in estimate/invoice builders)
            </label>
          </Field>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-4 border-t border-gray-700">
            <button type="button" onClick={onCancel} disabled={saving} className="px-4 py-2 text-gray-300 hover:text-white">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60">
              {saving ? 'Saving…' : (item ? 'Save changes' : 'Add item')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function parseCsvRow(raw) {
  const errors = []
  const name = String(raw.name || '').trim()
  if (!name) errors.push('name required')
  const unit_type = String(raw.unit_type || 'each').trim() || 'each'
  const priceStr = String(raw.unit_price || '0').trim()
  const unit_price = Number(priceStr)
  if (Number.isNaN(unit_price) || unit_price < 0) errors.push('unit_price invalid')
  const taxable = parseBool(raw.taxable, true)
  const is_active = parseBool(raw.is_active, true)
  const sort_order = Number(raw.sort_order) || 0

  if (errors.length) return { raw, parsed: null, errors }
  return {
    raw,
    parsed: {
      name,
      description: String(raw.description || '').trim() || null,
      category: String(raw.category || '').trim() || null,
      unit_type,
      unit_price,
      taxable,
      tier: String(raw.tier || '').trim() || null,
      tier_group: String(raw.tier_group || '').trim() || null,
      is_active,
      sort_order,
    },
    errors: [],
  }
}

function parseBool(value, defaultVal) {
  if (value === undefined || value === null || value === '') return defaultVal
  const s = String(value).trim().toLowerCase()
  if (['true', 't', 'yes', 'y', '1'].includes(s)) return true
  if (['false', 'f', 'no', 'n', '0'].includes(s)) return false
  return defaultVal
}

function ImportPreviewModal({ preview, importing, onCommit, onCancel }) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg border border-gray-700 p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        <h3 className="text-xl font-bold text-white mb-2">Import preview</h3>
        <p className="text-sm text-gray-400 mb-4">
          {preview.validCount} valid {preview.validCount === 1 ? 'row' : 'rows'},{' '}
          <span className={preview.invalidCount > 0 ? 'text-red-400' : 'text-gray-500'}>
            {preview.invalidCount} invalid
          </span>
          . Only valid rows will be imported.
        </p>

        <div className="overflow-x-auto rounded border border-gray-700 mb-4 max-h-[50vh]">
          <table className="min-w-full text-xs">
            <thead className="bg-gray-900 text-gray-300 uppercase sticky top-0">
              <tr>
                <th className="px-2 py-2 text-left">Status</th>
                <th className="px-2 py-2 text-left">Name</th>
                <th className="px-2 py-2 text-left">Category</th>
                <th className="px-2 py-2 text-left">Unit</th>
                <th className="px-2 py-2 text-right">Price</th>
                <th className="px-2 py-2 text-left">Issues</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700 bg-gray-900/40">
              {preview.rows.map((r, i) => (
                <tr key={i}>
                  <td className="px-2 py-1.5">
                    {r.errors.length === 0
                      ? <span className="text-green-400">✓</span>
                      : <span className="text-red-400">✗</span>}
                  </td>
                  <td className="px-2 py-1.5 text-gray-200">{r.raw.name || <span className="text-red-400 italic">(missing)</span>}</td>
                  <td className="px-2 py-1.5 text-gray-300">{r.raw.category || ''}</td>
                  <td className="px-2 py-1.5 text-gray-300">{r.raw.unit_type || ''}</td>
                  <td className="px-2 py-1.5 text-right text-gray-300 tabular-nums">{r.raw.unit_price || ''}</td>
                  <td className="px-2 py-1.5 text-red-400">{r.errors.join('; ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-700">
          <button onClick={onCancel} disabled={importing} className="px-4 py-2 text-gray-300 hover:text-white">
            Cancel
          </button>
          <button
            onClick={onCommit}
            disabled={importing || preview.validCount === 0}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60"
          >
            {importing ? 'Importing…' : `Import ${preview.validCount} ${preview.validCount === 1 ? 'row' : 'rows'}`}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, required, children }) {
  return (
    <label className="block">
      <span className="text-sm text-gray-300 mb-1 block">
        {label} {required && <span className="text-red-400">*</span>}
      </span>
      {children}
    </label>
  )
}
