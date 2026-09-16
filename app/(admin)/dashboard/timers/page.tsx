'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { calcBill, calcBillingMinutes, formatHMS } from '@/lib/timer/pricing'
import Sidebar from '@/components/admin/Sidebar'

interface TimerSession {
  session_id:      string
  customer_name:   string
  status:          'idle' | 'running' | 'paused' | 'completed'
  started_at:      string | null
  paused_at:       string | null
  total_paused_ms: number
  stopped_at:      string | null
  elapsed_minutes: number | null
  amount_gbp:      number | null
  booking_id:      string | null
  table_number:    string | null
  created_via:     'admin' | 'booking' | 'self_service' | null
  member?:         { display_name: string | null; email: string } | null
}

function calcLiveElapsed(s: TimerSession): number {
  if (s.status === 'idle') return 0
  if (s.status === 'completed' && s.elapsed_minutes !== null) return s.elapsed_minutes * 60
  if (!s.started_at) return 0
  const started = new Date(s.started_at).getTime()
  const totalPaused = s.total_paused_ms ?? 0
  if (s.status === 'paused' && s.paused_at) {
    return Math.max(0, (new Date(s.paused_at).getTime() - started - totalPaused) / 1000)
  }
  return Math.max(0, (Date.now() - started - totalPaused) / 1000)
}

const statusMeta: Record<string, { label: string; color: string }> = {
  idle:      { label: '未开始', color: 'bg-stone-100 text-stone-500' },
  running:   { label: '计时中', color: 'bg-emerald-100 text-emerald-700' },
  paused:    { label: '已暂停', color: 'bg-amber-100 text-amber-700' },
  completed: { label: '已完成', color: 'bg-stone-100 text-stone-500' },
}

const sourceLabels: Record<string, string> = {
  admin: '后台',
  booking: '预约',
  self_service: '自助',
}

export default function TimersListPage() {
  const router = useRouter()
  const [sessions, setSessions]   = useState<TimerSession[]>([])
  const [loading, setLoading]     = useState(true)
  const [filter, setFilter]       = useState<'all' | 'idle' | 'running' | 'paused' | 'completed'>('all')
  const [creating, setCreating]   = useState(false)
  const [form, setForm]           = useState({ customerName: '' })
  const [selected, setSelected]   = useState<Set<string>>(new Set())
  const [deleting, setDeleting]   = useState(false)

  async function load() {
    setLoading(true)
    const res  = await fetch(`/api/admin/timers?status=${filter}`)
    const data = await res.json() as { sessions: TimerSession[] }
    setSessions(data.sessions ?? [])
    setSelected(new Set())
    setLoading(false)
  }

  useEffect(() => { load() }, [filter]) // eslint-disable-line react-hooks/exhaustive-deps

  async function createTimer() {
    if (!form.customerName.trim()) { alert('请填写顾客姓名'); return }
    setCreating(true)
    const res  = await fetch('/api/admin/timers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customerName: form.customerName }),
    })
    const data = await res.json() as { session?: { session_id: string }; error?: string }
    if (!res.ok) { alert(data.error ?? '创建失败'); setCreating(false); return }
    router.push(`/dashboard/timers/${data.session!.session_id}`)
  }

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (selected.size === sessions.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(sessions.map(s => s.session_id)))
    }
  }

  async function deleteSelected() {
    if (selected.size === 0) return
    const hasActive = sessions.some(s => selected.has(s.session_id) && s.status === 'running')
    const msg = hasActive
      ? `其中有 ${[...selected].filter(id => sessions.find(s => s.session_id === id)?.status === 'running').length} 个正在计时中。确认删除选中的 ${selected.size} 条记录？`
      : `确认删除选中的 ${selected.size} 条记录？此操作不可撤销。`
    if (!confirm(msg)) return

    setDeleting(true)
    await Promise.all([...selected].map(id =>
      fetch(`/api/admin/timers/${id}`, { method: 'DELETE' })
    ))
    setDeleting(false)
    await load()
  }

  const allChecked = sessions.length > 0 && selected.size === sessions.length
  const someChecked = selected.size > 0 && !allChecked
  const active = sessions.filter(s => s.status !== 'completed')

  return (
    <div className="min-h-screen bg-stone-50">
      <Sidebar active="/dashboard/timers" />
      <div className="md:ml-56 pt-14 md:pt-0">
        <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold text-stone-800">拼豆计时</h1>
            <span className="text-xs text-stone-400">{active.length} 个进行中</span>
          </div>

          {/* 快速创建 */}
          <div className="bg-white rounded-2xl border border-stone-100 shadow-sm px-5 py-4">
            <p className="text-sm font-medium text-stone-700 mb-3">新建独立计时订单</p>
            <div className="flex gap-2">
              <input
                value={form.customerName}
                onChange={e => setForm({ customerName: e.target.value })}
                onKeyDown={e => e.key === 'Enter' && createTimer()}
                placeholder="顾客姓名"
                className="flex-1 border border-stone-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta/30"
              />
              <button
                onClick={createTimer}
                disabled={creating}
                className="px-4 py-2 bg-terracotta text-white rounded-xl text-sm font-medium hover:bg-terracotta/90 disabled:opacity-50 transition"
              >
                {creating ? '创建中…' : '⏱ 开始计时'}
              </button>
            </div>
            <p className="text-xs text-stone-400 mt-2">* 也可在预约管理页找到具体预约后点击「计时」按钮</p>
          </div>

          {/* Filter + 批量操作 */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex gap-2 flex-wrap">
              {(['all', 'idle', 'running', 'paused', 'completed'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition ${filter === f ? 'bg-terracotta text-white' : 'bg-white text-stone-500 border border-stone-200 hover:border-terracotta/40'}`}
                >
                  {{ all: '全部', idle: '未开始', running: '计时中', paused: '已暂停', completed: '已完成' }[f]}
                </button>
              ))}
            </div>
            {selected.size > 0 && (
              <button
                onClick={deleteSelected}
                disabled={deleting}
                className="px-3 py-1 rounded-full text-xs font-medium bg-red-50 text-red-500 border border-red-200 hover:bg-red-100 disabled:opacity-50 transition"
              >
                {deleting ? '删除中…' : `删除已选 (${selected.size})`}
              </button>
            )}
          </div>

          {/* List */}
          {loading ? (
            <div className="text-center py-12 text-stone-400">加载中…</div>
          ) : sessions.length === 0 ? (
            <div className="text-center py-12 text-stone-400">
              <p className="text-3xl mb-2">⏱</p>
              <p>暂无计时订单</p>
            </div>
          ) : (
            <div className="space-y-2">
              {/* 全选栏 */}
              <div className="flex items-center gap-2 px-1 pb-1">
                <input
                  type="checkbox"
                  checked={allChecked}
                  ref={el => { if (el) el.indeterminate = someChecked }}
                  onChange={toggleSelectAll}
                  className="w-4 h-4 accent-terracotta cursor-pointer"
                />
                <span className="text-xs text-stone-400">
                  {selected.size > 0 ? `已选 ${selected.size} 条` : `全选（共 ${sessions.length} 条）`}
                </span>
              </div>

              {sessions.map(s => {
                const meta        = statusMeta[s.status]
                const liveElapsed = calcLiveElapsed(s)
                const isSelected  = selected.has(s.session_id)
                return (
                  <div
                    key={s.session_id}
                    className={`flex items-center gap-3 bg-white rounded-2xl border px-4 py-3 transition ${isSelected ? 'border-terracotta/40 bg-terracotta/5' : 'border-stone-100 hover:border-terracotta/30 hover:shadow-sm'}`}
                  >
                    {/* Checkbox */}
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(s.session_id)}
                      onClick={e => e.stopPropagation()}
                      className="w-4 h-4 accent-terracotta cursor-pointer shrink-0"
                    />
                    {/* Row content */}
                    <button
                      className="flex-1 flex items-center justify-between text-left min-w-0"
                      onClick={() => router.push(`/dashboard/timers/${s.session_id}`)}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="font-medium text-stone-800 text-sm truncate">{s.customer_name}</span>
                          {s.table_number && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 font-medium shrink-0">
                              {s.table_number}
                            </span>
                          )}
                          {s.member && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-medium shrink-0 truncate max-w-[9rem]">
                              {s.member.display_name ?? s.member.email}
                            </span>
                          )}
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${meta.color}`}>
                            {meta.label}
                          </span>
                        </div>
                        <p className="text-xs text-stone-400">
                          {s.session_id} · {sourceLabels[s.created_via ?? 'admin'] ?? '后台'}
                        </p>
                      </div>
                      <div className="text-right shrink-0 ml-3">
                        <p className="font-mono text-base font-semibold text-stone-700">
                          {s.status === 'idle' ? '--:--:--' : formatHMS(liveElapsed)}
                        </p>
                        {s.status === 'completed' && s.amount_gbp != null && (
                          <p className="text-xs font-bold text-terracotta">£{s.amount_gbp.toFixed(2)}</p>
                        )}
                        {s.status !== 'completed' && s.status !== 'idle' && (
                          <p className="text-xs font-bold text-terracotta">
                            £{calcBill(calcBillingMinutes(Math.floor(liveElapsed / 60))).totalGbp.toFixed(2)} 预估
                          </p>
                        )}
                      </div>
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
