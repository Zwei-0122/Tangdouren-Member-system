'use client'

// 后台会员详情（PRD 16）：能挂订单、核销/转赠、代激活 VIP、停用；
// 不能手动加减 Visit、不能直接改 Reward Progress、不能改邮箱、不能删历史。

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Crown, Gift, Link2 } from 'lucide-react'
import Sidebar from '@/components/admin/Sidebar'
import MemberProgressBar from '@/components/member/MemberProgressBar'
import type { MemberDashboard, MemberRewardEntry } from '@/lib/member/service'
import type { RewardType } from '@/lib/member/member'

interface MemberRow {
  member_id:    string
  email:        string
  display_name: string | null
  joined_at:    string
  is_active:    boolean
}

const rewardLabels: Record<RewardType, string> = {
  TWO_POUND:       '£2 抵用券',
  FIVE_POUND:      '£5 抵用券',
  PERSONAL_15_OFF: '本人 85 折',
  FRIEND_10_OFF:   '朋友 9 折',
  VIP_MONTH:       'VIP Month',
}

const stateLabels: Record<string, string> = {
  available:     '可用',
  used:          '已使用',
  paused_by_vip: 'VIP 结束后可用',
  transferred:   '已转赠给朋友',
}

export default function MemberDetailPage() {
  const { id }  = useParams<{ id: string }>()
  const router  = useRouter()

  const [member, setMember]       = useState<MemberRow | null>(null)
  const [dashboard, setDashboard] = useState<MemberDashboard | null>(null)
  const [loading, setLoading]     = useState(true)
  const [busy, setBusy]           = useState('')
  const [error, setError]         = useState('')
  const [notice, setNotice]       = useState('')
  const [nameEdit, setNameEdit]   = useState('')
  const [sessionId, setSessionId] = useState('')
  const [couponCode, setCouponCode] = useState('')
  const [couponFor, setCouponFor]   = useState('')

  const load = useCallback(async () => {
    try {
      const res  = await fetch(`/api/admin/members/${id}`)
      const data = await res.json() as { member?: MemberRow; dashboard?: MemberDashboard; error?: string }
      if (!res.ok || !data.member) { setError(data.error ?? '找不到该会员'); return }
      setMember(data.member)
      setDashboard(data.dashboard ?? null)
      setNameEdit(data.member.display_name ?? '')
    } catch {
      setError('网络错误，请重试')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { void load() }, [load])

  async function act(action: string, payload: Record<string, unknown>, key: string) {
    setBusy(key)
    setError('')
    setNotice('')
    try {
      const res  = await fetch(`/api/admin/members/${id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action, ...payload }),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok) { setError(data.error ?? '操作失败'); return false }
      await load()
      return true
    } catch {
      setError('网络错误，请重试')
      return false
    } finally {
      setBusy('')
    }
  }

  const fmt = (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleString('zh-CN', { timeZone: 'Europe/London' }) : '—'

  const readyVip    = (dashboard?.rewards ?? []).filter(r => r.reward.reward_type === 'VIP_MONTH' && !r.benefit?.activated_on)
  const friendOpen  = (dashboard?.rewards ?? []).filter(r => r.reward.reward_type === 'FRIEND_10_OFF' && !r.reward.coupon_id && !r.reward.used_at)

  return (
    <div className="min-h-screen bg-stone-50">
      <Sidebar active="/dashboard/members" />
      <div className="md:ml-56 pt-14 md:pt-0">
        <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-5">
          <button onClick={() => router.push('/dashboard/members')} className="text-sm text-stone-500 hover:text-stone-700 flex items-center gap-1">
            <ArrowLeft size={14} /> 返回会员列表
          </button>

          {loading && <div className="text-center py-12 text-stone-400">加载中…</div>}
          {error && <p className="text-sm text-red-500 bg-red-50 border border-red-100 rounded-xl px-4 py-3">{error}</p>}
          {notice && <p className="text-sm text-emerald-600 bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3">{notice}</p>}

          {member && (
            <>
              {/* ── 身份 ─────────────────────────────────────────────── */}
              <div className="bg-white rounded-2xl border border-stone-100 shadow-sm px-5 py-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h1 className="text-xl font-bold text-stone-800">{member.display_name ?? '（未填姓名）'}</h1>
                    <p className="text-sm text-stone-500">{member.email}</p>
                    <p className="text-xs text-stone-400 mt-1">加入于 {fmt(member.joined_at)}</p>
                  </div>
                  <button
                    onClick={() => act(member.is_active ? 'disable' : 'enable', {}, 'active')}
                    disabled={busy === 'active'}
                    className={member.is_active
                      ? 'px-3 py-1.5 rounded-xl border border-red-200 bg-red-50 text-red-500 text-xs font-medium hover:bg-red-100 transition shrink-0'
                      : 'px-3 py-1.5 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-600 text-xs font-medium hover:bg-emerald-100 transition shrink-0'}
                  >
                    {busy === 'active' ? '处理中…' : member.is_active ? '停用会员' : '恢复会员'}
                  </button>
                </div>
                <div className="flex gap-2">
                  <input
                    value={nameEdit}
                    onChange={e => setNameEdit(e.target.value)}
                    placeholder="会员姓名"
                    className="flex-1 border border-stone-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta/30"
                  />
                  <button
                    onClick={async () => { if (await act('update_name', { display_name: nameEdit }, 'name')) setNotice('姓名已更新') }}
                    disabled={busy === 'name'}
                    className="px-4 py-2 rounded-xl bg-stone-800 text-white text-sm font-medium hover:bg-stone-700 disabled:opacity-50 transition shrink-0"
                  >
                    {busy === 'name' ? '保存中…' : '保存姓名'}
                  </button>
                </div>
                <p className="text-xs text-stone-400">邮箱不提供修改（PRD 2.2）。姓名由会员自己也能改。</p>
              </div>

              {/* ── 进度 ─────────────────────────────────────────────── */}
              {dashboard && (
                <MemberProgressBar
                  cells={dashboard.progress_cells}
                  cycleProgress={dashboard.cycle_progress}
                  nextReward={dashboard.next_reward}
                  lifetimeVisits={dashboard.lifetime_visits}
                  lang="zh"
                />
              )}

              {/* ── VIP Month ────────────────────────────────────────── */}
              <div className="bg-white rounded-2xl border border-stone-100 shadow-sm px-5 py-4 space-y-3">
                <h2 className="text-sm font-semibold text-stone-700 flex items-center gap-2"><Crown size={15} /> VIP Month</h2>
                <p className="text-sm text-stone-600">
                  {dashboard?.vip.active_expires_on
                    ? `生效中，有效期至 ${dashboard.vip.active_expires_on}`
                    : '当前没有生效中的 VIP Month'}
                </p>
                <p className="text-xs text-stone-400">
                  未激活 {dashboard?.vip.ready_to_activate ?? 0} 张 · 已激活过 {dashboard?.vip.activated ?? 0} 张
                  （同一时间只能有一张生效，到期后不会自动续）
                </p>
                {readyVip.length > 0 && (
                  <button
                    onClick={() => act('activate_vip', { reward_id: readyVip[0].reward.reward_id }, 'vip')}
                    disabled={busy === 'vip' || Boolean(dashboard?.vip.active_expires_on)}
                    className="px-4 py-2 rounded-xl bg-terracotta text-white text-sm font-medium hover:bg-terracotta/90 disabled:opacity-50 transition"
                  >
                    {busy === 'vip' ? '激活中…' : '代为激活这张 VIP Month'}
                  </button>
                )}
              </div>

              {/* ── 奖励 ─────────────────────────────────────────────── */}
              <div className="bg-white rounded-2xl border border-stone-100 shadow-sm px-5 py-4 space-y-3">
                <h2 className="text-sm font-semibold text-stone-700 flex items-center gap-2"><Gift size={15} /> 奖励与记录</h2>
                <ul className="space-y-2">
                  {(dashboard?.rewards ?? []).map((entry: MemberRewardEntry) => (
                    <li key={entry.reward.reward_id} className="rounded-xl border border-stone-100 px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm text-stone-700">{rewardLabels[entry.reward.reward_type]}</span>
                        <span className="text-xs text-stone-500">{stateLabels[entry.state] ?? entry.state}</span>
                      </div>
                      <p className="text-xs text-stone-400 mt-0.5">
                        第 {entry.cycle_index} 轮 · {fmt(entry.reward.unlocked_at)} 解锁
                        {entry.reward.used_at && ` · ${fmt(entry.reward.used_at)} 使用`}
                        {entry.benefit?.activated_on && ` · VIP ${entry.benefit.activated_on} 至 ${entry.benefit.expires_on}`}
                        {entry.coupon_code && ` · 内部券 ${entry.coupon_code}`}
                      </p>
                    </li>
                  ))}
                  {(dashboard?.rewards ?? []).length === 0 && <li className="text-sm text-stone-400">还没有解锁奖励。</li>}
                </ul>

                {friendOpen.length > 0 && (
                  <div className="rounded-xl border border-stone-100 bg-stone-50 px-3 py-3 space-y-2">
                    <p className="text-xs text-stone-500">
                      转赠朋友 9 折：先在优惠券页生成一张 10% OFF 的普通券，再把券码填在这里关联。关联后这张奖励不能再直接使用。
                    </p>
                    <div className="flex gap-2">
                      <input
                        value={couponFor === friendOpen[0].reward.reward_id ? couponCode : ''}
                        onChange={e => { setCouponFor(friendOpen[0].reward.reward_id); setCouponCode(e.target.value.toUpperCase()) }}
                        placeholder="TDXXXXXXXX"
                        className="flex-1 border border-stone-200 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-terracotta/30"
                      />
                      <button
                        onClick={async () => {
                          const ok = await act('associate_friend_coupon', { reward_id: friendOpen[0].reward.reward_id, coupon_code: couponCode }, 'coupon')
                          if (ok) { setNotice('已关联到该优惠券'); setCouponCode(''); setCouponFor('') }
                        }}
                        disabled={busy === 'coupon' || !couponCode.trim()}
                        className="px-4 py-2 rounded-xl bg-stone-800 text-white text-sm font-medium hover:bg-stone-700 disabled:opacity-50 transition shrink-0"
                      >
                        {busy === 'coupon' ? '关联中…' : '关联优惠券'}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* ── 挂订单 ───────────────────────────────────────────── */}
              <div className="bg-white rounded-2xl border border-stone-100 shadow-sm px-5 py-4 space-y-3">
                <h2 className="text-sm font-semibold text-stone-700 flex items-center gap-2"><Link2 size={15} /> 把订单关联到该会员</h2>
                <p className="text-xs text-stone-400">
                  顾客开始计时时忘了以会员身份登录时用。只能挂**尚未结算**的订单；已经结算的要先撤销结算，否则等于绕过结算台账改数字。
                </p>
                <div className="flex gap-2">
                  <input
                    value={sessionId}
                    onChange={e => setSessionId(e.target.value)}
                    placeholder="计时订单号，如 PB-20260916-001"
                    className="flex-1 border border-stone-200 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-terracotta/30"
                  />
                  <button
                    onClick={async () => {
                      const ok = await act('link_session', { session_id: sessionId.trim() }, 'link')
                      if (ok) { setNotice('订单已关联到该会员'); setSessionId('') }
                    }}
                    disabled={busy === 'link' || !sessionId.trim()}
                    className="px-4 py-2 rounded-xl bg-stone-800 text-white text-sm font-medium hover:bg-stone-700 disabled:opacity-50 transition shrink-0"
                  >
                    {busy === 'link' ? '关联中…' : '关联'}
                  </button>
                </div>
              </div>

              {/* ── 到店记录 ─────────────────────────────────────────── */}
              <div className="bg-white rounded-2xl border border-stone-100 shadow-sm px-5 py-4 space-y-3">
                <h2 className="text-sm font-semibold text-stone-700">到店记录</h2>
                <ul className="space-y-1.5">
                  {(dashboard?.visit_history ?? []).map(v => (
                    <li key={v.session_id} className="flex items-center justify-between text-sm border border-stone-100 rounded-xl px-3 py-2">
                      <span className="text-stone-700">{v.visit_date}</span>
                      <span className={v.counted_for_progress ? 'text-emerald-600 text-xs' : 'text-amber-600 text-xs'}>
                        {v.progress_paused ? 'VIP 期间，进度暂停' : '计入进度'}
                      </span>
                    </li>
                  ))}
                  {(dashboard?.visit_history ?? []).length === 0 && <li className="text-sm text-stone-400">还没有已结算的到店记录。</li>}
                </ul>
              </div>

              {/* ── 禁止动作 ─────────────────────────────────────────── */}
              <div className="rounded-2xl border border-amber-100 bg-amber-50 px-5 py-4">
                <p className="text-xs font-semibold text-amber-700 mb-1">后台不能做的事</p>
                <p className="text-xs leading-5 text-amber-700">
                  手动加减到店次数、直接改奖励进度、手动补发奖励、修改邮箱、删除到店或奖励历史。
                  会员进度必须来自真实结算记录。金额也只在结算面板由服务端计算，后台改不了数字。
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
