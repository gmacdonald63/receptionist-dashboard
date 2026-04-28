import { useState, useEffect, useCallback } from 'react'
import { Plus, ChevronRight } from 'lucide-react'
import { supabase } from './supabaseClient'
import EstimateBuilder from './EstimateBuilder'

const STATUS_COLORS = {
  draft: 'bg-gray-700 text-gray-300',
  sent: 'bg-blue-900/50 text-blue-300',
  viewed: 'bg-yellow-900/50 text-yellow-300',
  approved: 'bg-green-900/50 text-green-400',
  declined: 'bg-red-900/50 text-red-400',
  expired: 'bg-gray-700 text-gray-500',
  converted: 'bg-purple-900/50 text-purple-300',
}

function formatCurrency(n) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n ?? 0)
}

function estimateTotal(est) {
  const totals = (est.estimate_options || []).map(o => Number(o.total) || 0)
  if (totals.length === 0) return '—'
  if (totals.length === 1) return formatCurrency(totals[0])
  const min = Math.min(...totals)
  const max = Math.max(...totals)
  if (min === max) return formatCurrency(min)
  return `${formatCurrency(min)} – ${formatCurrency(max)}`
}

export default function EstimatesTab({ clientId, role, taxRate }) {
  const [estimates, setEstimates] = useState([])
  const [loading, setLoading] = useState(true)
  const [showBuilder, setShowBuilder] = useState(false)
  const [editingId, setEditingId] = useState(null)

  const loadEstimates = useCallback(async () => {
    if (!clientId) return
    setLoading(true)
    const { data, error } = await supabase
      .from('estimates')
      .select('id, title, status, created_at, estimate_options(total)')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(100)
    if (!error) setEstimates(data || [])
    setLoading(false)
  }, [clientId])

  useEffect(() => { loadEstimates() }, [loadEstimates])

  function openNew() {
    setEditingId(null)
    setShowBuilder(true)
  }

  function openEdit(id) {
    setEditingId(id)
    setShowBuilder(true)
  }

  function handleClose() {
    setShowBuilder(false)
    setEditingId(null)
    loadEstimates()
  }

  function handleSaved(id) {
    setEditingId(id)
    loadEstimates()
  }

  return (
    <div className="p-4 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold text-white">Estimates</h2>
        <button
          onClick={openNew}
          className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
        >
          <Plus className="w-4 h-4" /> New Estimate
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="text-gray-400 text-sm py-8 text-center">Loading estimates…</div>
      ) : estimates.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="mb-1 text-base">No estimates yet</p>
          <p className="text-sm text-gray-500">Create your first estimate to get started</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-700">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-800 text-gray-300 uppercase text-xs">
              <tr>
                <th className="px-4 py-3 text-left">Title</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3 text-left">Created</th>
                <th className="px-4 py-3 text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700 bg-gray-900">
              {estimates.map(est => (
                <tr
                  key={est.id}
                  className="hover:bg-gray-800 cursor-pointer transition-colors"
                  onClick={() => openEdit(est.id)}
                >
                  <td className="px-4 py-3 text-white font-medium">
                    {est.title || <span className="text-gray-500 italic">Untitled</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[est.status] || STATUS_COLORS.draft}`}>
                      {est.status || 'draft'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-300 tabular-nums">
                    {estimateTotal(est)}
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">
                    {est.created_at
                      ? new Date(est.created_at).toLocaleDateString('en-US', {
                          month: 'short', day: 'numeric', year: 'numeric',
                        })
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-500">
                    <ChevronRight className="w-4 h-4 inline-block" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* EstimateBuilder modal */}
      {showBuilder && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-40 flex items-center justify-center p-4">
          <div className="bg-gray-900 rounded-lg border border-gray-700 w-full max-w-5xl h-[90vh] flex flex-col overflow-hidden">
            <EstimateBuilder
              clientId={clientId}
              estimateId={editingId}
              taxRate={taxRate}
              compact={false}
              onClose={handleClose}
              onSaved={handleSaved}
            />
          </div>
        </div>
      )}
    </div>
  )
}
