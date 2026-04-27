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

  // Derived: distinct category list (for the filter dropdown)
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
          {/* Buttons (handlers added in Chunk 3 / 4) */}
          <button
            disabled
            title="Coming in Chunk 4"
            className="flex items-center gap-2 px-3 py-2 bg-gray-700 text-gray-300 rounded-lg opacity-60 cursor-not-allowed"
          >
            <Upload className="w-4 h-4" /> Import CSV
          </button>
          <button
            disabled
            title="Coming in Chunk 4"
            className="flex items-center gap-2 px-3 py-2 bg-gray-700 text-gray-300 rounded-lg opacity-60 cursor-not-allowed"
          >
            <Download className="w-4 h-4" /> Export
          </button>
          <button
            disabled
            title="Coming in Chunk 3"
            className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg opacity-60 cursor-not-allowed"
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
        <CatalogTable items={visibleItems} />
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

function CatalogTable({ items }) {
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
                <button disabled title="Coming in Chunk 3" className="p-1.5 text-gray-500 cursor-not-allowed">
                  <Edit2 className="w-4 h-4" />
                </button>
                <button disabled title="Coming in Chunk 3" className="p-1.5 text-gray-500 cursor-not-allowed">
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
