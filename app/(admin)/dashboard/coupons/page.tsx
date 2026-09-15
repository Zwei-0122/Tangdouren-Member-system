'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import Sidebar from '@/components/admin/Sidebar'
import {
  COUPON_STATUS_LABELS,
  MAX_GENERATE_QUANTITY,
  TIME_COUPON_STEP_MINUTES,
  couponStatus,
  describeDiscount,
  londonToday,
  type CouponStatus,
  type DiscountType,
} from '@/lib/coupon/coupon'

interface Coupon {
  coupon_id:           string
  code:                string
  discount_type:       DiscountType
  discount_value:      number
  expires_at:          string | null
  redeemed_at:         string | null
  redeemed_by:         string | null
  redeemed_session_id: string | null
  created_by:          string
  created_at:          string
}

interface CouponStats {
  total:     number
  available: number
  redeemed:  number
  expired:   number
}

const PAGE_SIZE = 50

const statusChip: Record<CouponStatus, string> = {
  unused:   'bg-emerald-50 text-emerald-700 border-emerald-200',
  redeemed: 'bg-stone-100 text-stone-500 border-stone-200',
  expired:  'bg-amber-50 text-amber-700 border-amber-200',
}

const STATUS_FILTERS = [
  { value: 'all',      label: '全部' },
  { value: 'unused',   label: '未使用' },
  { value: 'redeemed', label: '已使用' },
  { value: 'expired',  label: '已过期' },
] as const

function formatLondon(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('zh-CN', { timeZone: 'Europe/London', hour12: false })
}

function expiryLabel(expiresAt: string | null): string {
  return expiresAt ? `截至 ${formatLondon(expiresAt)}` : '永久有效'
}

function csvEscape(value: string | number): string {
  const s = String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export default function CouponsPage() {
  const [coupons, setCoupons]   = useState<Coupon[]>([])
  const [stats, setStats]       = useState<CouponStats>({ total: 0, available: 0, redeemed: 0, expired: 0 })
  const [loading, setLoading]   = useState(true)
  const [page, setPage]         = useState(1)
  const [totalPages, setTotal]  = useState(1)
  const [total, setTotalRows]   = useState(0)
  const [status, setStatus]     = useState<string>('all')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch]     = useState('')
  const [copied, setCopied]     = useState('')

  // 生成弹窗
  const [showForm, setShowForm] = useState(false)
  const [form, setForm]         = useState({
    discountType:  'fixed_amount' as DiscountType,
    discountValue: '2',
    permanent:     true,
    expiresOn:     londonToday(),
    quantity:      '1',
  })
  const [generating, setGenerating] = useState(false)
  const [formError, setFormError]   = useState('')
  const [generated, setGenerated]   = useState<Coupon[] | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({
      page:     String(page),
      pageSize: String(PAGE_SIZE),
      status,
      search,
    })
    const res  = await fetch(`/api/admin/coupons?${params.toString()}`)
    const data = await res.json() as {
      coupons?: Coupon[]; stats?: CouponStats; totalPages?: number; total?: number; error?: string
    }
    if (!res.ok) { alert(data.error ?? '读取优惠券失败'); setLoading(false); return }
    setCoupons(data.coupons ?? [])
    setStats(data.stats ?? { total: 0, available: 0, redeemed: 0, expired: 0 })
    setTotal(data.totalPages ?? 1)
    setTotalRows(data.total ?? 0)
    setLoading(false)
  }, [page, status, search])

  useEffect(() => { load() }, [load]) // eslint-disable-line react-hooks/exhaustive-deps

  function runSearch() {
    setPage(1)
    setSearch(searchInput.trim())
  }

  async function copy(text: string, tag: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(tag)
      setTimeout(() => setCopied(''), 1500)
    } catch {
      alert('复制失败，请手动选择文本')
    }
  }

  function downloadCsv(rows: Coupon[], filename: string) {
    const header = ['code', 'discount_type', 'discount_value', 'expires_at', 'created_at', 'content']
    const lines  = rows.map(c => [
      c.code,
      c.discount_type,
      c.discount_value,
      c.expires_at ?? '',
      c.created_at,
      describeDiscount(c.discount_type, c.discount_value),
    ].map(csvEscape).join(','))
    const csv = '\uFEFF' + [header.join(','), ...lines].join('\n')

    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
    const a   = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  async function generate() {
    setFormError('')
    const value = parseFloat(form.discountValue)
    if (!Number.isFinite(value) || value <= 0) { setFormError('请输入大于 0 的优惠值'); return }
    if (form.discountType === 'time_minutes' && (!Number.isInteger(value) || value % TIME_COUPON_STEP_MINUTES !== 0)) {
      setFormError(`时长减免必须是 ${TIME_COUPON_STEP_MINUTES} 分钟的整数倍`)
      return
    }
    const quantity = parseInt(form.quantity, 10)
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_GENERATE_QUANTITY) {
      setFormError(`生成数量必须是 1 到 ${MAX_GENERATE_QUANTITY} 之间的整数`)
      return
    }
    if (!form.permanent && !form.expiresOn) { setFormError('请选择截止日期'); return }

    setGenerating(true)
    try {
      const res = await fetch('/api/admin/coupons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          discountType:  form.discountType,
          discountValue: value,
          expiresOn:     form.permanent ? null : form.expiresOn,
          quantity,
        }),
      })
      const data = await res.json() as { coupons?: Coupon[]; error?: string }
      if (!res.ok) { setFormError(data.error ?? '生成失败'); return }
      setGenerated(data.coupons ?? [])
      setShowForm(false)
      setPage(1)
      await load()
    } catch {
      setFormError('网络错误，请重试')
    } finally {
      setGenerating(false)
    }
  }

  const inputCls = 'w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-terracotta/30 focus:border-terracotta'
  const unitLabel = form.discountType === 'fixed_amount' ? '英镑（£）'
    : form.discountType === 'percentage_off' ? '减免百分比（%）' : '减免分钟数'

  return (
    <div className="min-h-screen bg-stone-50">
      <Sidebar active="/dashboard/coupons" />
      <div className="md:ml-56 pt-14 md:pt-0">
        <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-5">

          {/* 顶部操作 */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h1 className="text-xl font-bold text-stone-800">优惠券</h1>
              <p className="text-xs text-stone-400 mt-0.5">单次核销，每笔计时订单最多使用一张</p>
            </div>
            <button
              onClick={() => { setGenerated(null); setFormError(''); setShowForm(true) }}
              className="px-4 py-2 bg-terracotta text-white rounded-xl text-sm font-medium hover:bg-terracotta/90 transition shadow-sm"
            >
              ＋ 生成优惠券
            </button>
          </div>

          {/* 简单统计 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {([
              { label: '优惠券总数', value: stats.total,     color: 'text-stone-800' },
              { label: '当前可用',   value: stats.available, color: 'text-emerald-600' },
              { label: '已核销',     value: stats.redeemed,  color: 'text-stone-500' },
              { label: '已过期',     value: stats.expired,   color: 'text-amber-600' },
            ]).map(item => (
              <div key={item.label} className="bg-white rounded-2xl border border-stone-100 shadow-sm px-4 py-3">
                <p className="text-xs text-stone-400">{item.label}</p>
                <p className={`text-2xl font-bold mt-0.5 ${item.color}`}>{item.value}</p>
              </div>
            ))}
          </div>

          {/* 生成结果 */}
          {generated && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-5 py-4">
              <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                <div>
                  <p className="text-sm font-semibold text-emerald-700">
                    已生成 {generated.length} 张 · {generated[0] ? describeDiscount(generated[0].discount_type, generated[0].discount_value) : ''}
                  </p>
                  <p className="text-xs text-emerald-700/70 mt-0.5">{expiryLabel(generated[0]?.expires_at ?? null)}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => copy(generated.map(c => c.code).join('\n'), 'all')}
                    className="px-3 py-1.5 rounded-xl bg-white border border-emerald-200 text-xs font-medium text-emerald-700 hover:bg-emerald-100 transition"
                  >
                    {copied === 'all' ? '已复制 ✓' : '复制全部'}
                  </button>
                  <button
                    onClick={() => downloadCsv(generated, `coupons-${londonToday()}.csv`)}
                    className="px-3 py-1.5 rounded-xl bg-white border border-emerald-200 text-xs font-medium text-emerald-700 hover:bg-emerald-100 transition"
                  >
                    下载 CSV
                  </button>
                  <button onClick={() => setGenerated(null)} className="px-2 py-1.5 text-xs text-stone-400 hover:text-stone-600">
                    关闭
                  </button>
                </div>
              </div>
              <div className="bg-white rounded-xl border border-emerald-100 max-h-56 overflow-y-auto p-3 grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1">
                {generated.map(c => (
                  <button
                    key={c.coupon_id}
                    onClick={() => copy(c.code, c.code)}
                    className="text-left font-mono text-xs text-stone-700 hover:text-terracotta transition"
                    title="点击复制"
                  >
                    {copied === c.code ? `${c.code} ✓` : c.code}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 搜索 + 筛选 */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex gap-2 flex-1 min-w-[220px]">
              <input
                value={searchInput}
                onChange={e => setSearchInput(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && runSearch()}
                placeholder="搜索优惠码"
                className={inputCls + ' font-mono'}
              />
              <button
                onClick={runSearch}
                className="px-4 py-2 bg-stone-800 text-white rounded-xl text-sm font-medium hover:bg-stone-700 transition shrink-0"
              >
                搜索
              </button>
            </div>
            <div className="flex gap-2 flex-wrap">
              {STATUS_FILTERS.map(f => (
                <button
                  key={f.value}
                  onClick={() => { setStatus(f.value); setPage(1) }}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition ${status === f.value ? 'bg-terracotta text-white' : 'bg-white text-stone-500 border border-stone-200 hover:border-terracotta/40'}`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* 列表 */}
          {loading ? (
            <div className="text-center py-12 text-stone-400">加载中…</div>
          ) : coupons.length === 0 ? (
            <div className="text-center py-12 text-stone-400">
              <p className="text-3xl mb-2">🎟</p>
              <p>{status === 'all' && !search ? '还没有优惠券，点上方「生成优惠券」开始' : '没有符合条件的优惠券'}</p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-stone-400 px-1">共 {total} 张</p>
              {coupons.map(c => {
                const st = couponStatus(c)
                return (
                  <div key={c.coupon_id} className="bg-white rounded-2xl border border-stone-100 shadow-sm px-4 py-3">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            onClick={() => copy(c.code, c.code)}
                            className="font-mono text-sm font-semibold text-stone-800 hover:text-terracotta transition"
                            title="点击复制优惠码"
                          >
                            {copied === c.code ? `${c.code} ✓` : c.code}
                          </button>
                          <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${statusChip[st]}`}>
                            {COUPON_STATUS_LABELS[st]}
                          </span>
                        </div>
                        <p className="text-sm text-terracotta font-medium mt-1">
                          {describeDiscount(c.discount_type, c.discount_value)}
                        </p>
                        <p className="text-xs text-stone-400 mt-0.5">
                          {expiryLabel(c.expires_at)} · 生成于 {formatLondon(c.created_at)}
                        </p>
                        <p className="text-xs text-stone-400">
                          {c.redeemed_at ? `核销于 ${formatLondon(c.redeemed_at)}${c.redeemed_by ? ` · ${c.redeemed_by}` : ''}` : '尚未核销'}
                        </p>
                      </div>
                      {c.redeemed_session_id && (
                        <Link
                          href={`/dashboard/timers/${c.redeemed_session_id}`}
                          className="text-xs text-terracotta hover:underline shrink-0 font-mono"
                        >
                          {c.redeemed_session_id} →
                        </Link>
                      )}
                    </div>
                  </div>
                )
              })}

              {/* 分页 */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-3 pt-2">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="px-3 py-1.5 rounded-xl border border-stone-200 bg-white text-xs text-stone-600 disabled:opacity-40"
                  >
                    上一页
                  </button>
                  <span className="text-xs text-stone-400">{page} / {totalPages}</span>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="px-3 py-1.5 rounded-xl border border-stone-200 bg-white text-xs text-stone-600 disabled:opacity-40"
                  >
                    下一页
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 生成弹窗 */}
      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div
            className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto p-5 shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <p className="text-base font-semibold text-stone-800 mb-4">生成优惠券</p>

            {/* 优惠类型 */}
            <p className="text-xs text-stone-400 mb-2">优惠类型</p>
            <div className="grid grid-cols-3 gap-2 mb-4">
              {([
                { value: 'fixed_amount',   label: '固定金额' },
                { value: 'percentage_off', label: '百分比折扣' },
                { value: 'time_minutes',   label: '时长减免' },
              ] as const).map(t => (
                <button
                  key={t.value}
                  onClick={() => setForm(f => ({
                    ...f,
                    discountType:  t.value,
                    discountValue: t.value === 'time_minutes' ? '30' : f.discountValue,
                  }))}
                  className={`px-2 py-2 rounded-xl text-xs font-medium border transition ${form.discountType === t.value ? 'bg-terracotta text-white border-terracotta' : 'bg-white text-stone-600 border-stone-200 hover:border-terracotta/40'}`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* 优惠值 */}
            <div className="mb-4">
              <label className="block text-xs text-stone-400 mb-1">{unitLabel}</label>
              <div className="flex gap-2">
                <input
                  type="number" step={form.discountType === 'time_minutes' ? '30' : '0.01'} min="0"
                  className={inputCls}
                  value={form.discountValue}
                  onChange={e => setForm(f => ({ ...f, discountValue: e.target.value }))}
                />
                {form.discountType === 'time_minutes' && (
                  <button
                    onClick={() => setForm(f => ({ ...f, discountValue: '30' }))}
                    className="px-3 py-2 rounded-xl border border-stone-200 bg-white text-xs text-stone-600 hover:border-terracotta/40 shrink-0"
                  >
                    30 分钟
                  </button>
                )}
              </div>
              {form.discountType === 'time_minutes' && (
                <p className="text-xs text-stone-400 mt-1">按半小时续时价抵扣；首小时不可减免，只能 {TIME_COUPON_STEP_MINUTES} 分钟的整数倍。</p>
              )}
              {form.discountType === 'percentage_off' && (
                <p className="text-xs text-stone-400 mt-1">填 15 表示减免 15%，顾客支付 85%。</p>
              )}
            </div>

            {/* 有效期 */}
            <p className="text-xs text-stone-400 mb-2">有效期</p>
            <div className="flex gap-2 mb-2">
              <button
                onClick={() => setForm(f => ({ ...f, permanent: true }))}
                className={`flex-1 px-3 py-2 rounded-xl text-xs font-medium border transition ${form.permanent ? 'bg-terracotta text-white border-terracotta' : 'bg-white text-stone-600 border-stone-200 hover:border-terracotta/40'}`}
              >
                永久有效
              </button>
              <button
                onClick={() => setForm(f => ({ ...f, permanent: false }))}
                className={`flex-1 px-3 py-2 rounded-xl text-xs font-medium border transition ${!form.permanent ? 'bg-terracotta text-white border-terracotta' : 'bg-white text-stone-600 border-stone-200 hover:border-terracotta/40'}`}
              >
                指定截止日期
              </button>
            </div>
            {!form.permanent && (
              <div className="mb-4">
                <input
                  type="date"
                  className={inputCls}
                  min={londonToday()}
                  value={form.expiresOn}
                  onChange={e => setForm(f => ({ ...f, expiresOn: e.target.value }))}
                />
                <p className="text-xs text-stone-400 mt-1">按伦敦时间当日 23:59:59 结束。</p>
              </div>
            )}

            {/* 数量 */}
            <div className="mb-4 mt-3">
              <label className="block text-xs text-stone-400 mb-1">生成数量</label>
              <input
                type="number" min="1" max={MAX_GENERATE_QUANTITY} step="1"
                className={inputCls}
                value={form.quantity}
                onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))}
              />
              <p className="text-xs text-stone-400 mt-1">单次最多 {MAX_GENERATE_QUANTITY} 张。</p>
            </div>

            {formError && <p className="text-sm text-red-500 mb-3">{formError}</p>}

            <div className="flex gap-2">
              <button
                onClick={() => setShowForm(false)}
                className="flex-1 py-2.5 rounded-xl border border-stone-200 text-sm text-stone-600 hover:bg-stone-50 transition"
              >
                取消
              </button>
              <button
                onClick={generate}
                disabled={generating}
                className="flex-1 py-2.5 rounded-xl bg-terracotta text-white text-sm font-semibold hover:bg-terracotta/90 disabled:opacity-50 transition"
              >
                {generating ? '生成中…' : '生成'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
