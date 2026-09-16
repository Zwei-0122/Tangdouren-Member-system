// PATCH /api/admin/timers/[id]  — 暂停 / 继续 / 结束计时
// GET   /api/admin/timers/[id]  — 获取单条计时详情（管理员）
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { calcBillingMinutes, calcBill } from '@/lib/timer/pricing'
import { resolveActiveSeatCodeFromValue } from '@/lib/timer/selfService'
import { computeSettlement } from '@/lib/coupon/coupon'
import { loadSettlementContext, mapRpcError } from '@/lib/coupon/service'
import { computeMemberDiscount, londonDateOf, type DiscountSource, type RewardType } from '@/lib/member/member'
import { getMemberSettleInfo, mapMemberError } from '@/lib/member/service'

type Action = 'start' | 'pause' | 'resume' | 'stop' | 'settle' | 'unsettle' | 'update_table'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '未授权' }, { status: 401 })

  const { id } = await params
  const admin   = createAdminClient()

  const { data, error } = await admin
    .from('timer_sessions')
    .select('*, bookings(customer_name, booking_date, start_time, end_time)')
    .eq('session_id', id)
    .single()

  if (error || !data) return NextResponse.json({ error: '计时订单不存在' }, { status: 404 })

  // 结算台要显示这个订单的会员是谁：邮箱没有验证过，店员核对柜台前的人是目前唯一的防线
  let member = null
  if (data.member_id) {
    const info = await getMemberSettleInfo(admin, data.member_id as string, londonDateOf(new Date()))
    if (info) {
      member = {
        member_id:           info.member.member_id,
        display_name:        info.member.display_name,
        email:               info.member.email,
        vip_active:          info.vipActive,
        vip_expires_on:      info.vipExpiresOn,
        usable_reward_types: info.usableTypes,
      }
    }
  }

  return NextResponse.json({ session: data, member })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '未授权' }, { status: 401 })

  const { id } = await params
  const admin  = createAdminClient()

  const { error } = await admin
    .from('timer_sessions')
    .delete()
    .eq('session_id', id)

  if (error) {
    console.error('[DELETE /api/admin/timers]', error.message)
    // 已核销优惠券的订单受外键约束保护（coupons.redeemed_session_id → ON DELETE RESTRICT）
    if (error.code === '23503') {
      return NextResponse.json({ error: '该订单已核销优惠券，请先撤销结算再删除' }, { status: 409 })
    }
    return NextResponse.json({ error: '删除失败' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '未授权' }, { status: 401 })

  const { id }   = await params
  // 注意：结算金额一律由服务端计算，客户端传入的 actual_amount_gbp / 折扣字段会被忽略
  const body     = await request.json() as {
    action:           Action
    coupon_code?:     string
    settlement_note?: string
    table_number?:    string
    discount_source?: DiscountSource
    member_id?:       string   // 朋友用券时，折扣出自另一位会员（PRD 10.3）
    reward_type?:     RewardType
  }
  const { action } = body

  if (!['start', 'pause', 'resume', 'stop', 'settle', 'unsettle', 'update_table'].includes(action)) {
    return NextResponse.json({ error: '无效操作' }, { status: 400 })
  }

  const admin = createAdminClient()

  const { data: session, error: fetchErr } = await admin
    .from('timer_sessions')
    .select('*')
    .eq('session_id', id)
    .single()

  if (fetchErr || !session) return NextResponse.json({ error: '计时订单不存在' }, { status: 404 })
  if (session.status !== 'completed' && action === 'settle') {
    return NextResponse.json({ error: '请先结束计时再结算' }, { status: 409 })
  }
  if (action === 'update_table') {
    const tableNumber = body.table_number ? await resolveActiveSeatCodeFromValue(admin, body.table_number) : null
    if (!tableNumber) return NextResponse.json({ error: '请输入有效座位号' }, { status: 400 })

    const { data: updated, error: updateErr } = await admin
      .from('timer_sessions')
      .update({ table_number: tableNumber })
      .eq('session_id', id)
      .select()
      .single()

    if (updateErr) {
      console.error('[update_table /api/admin/timers]', updateErr)
      return NextResponse.json({ error: '桌号更新失败' }, { status: 500 })
    }
    return NextResponse.json({ session: updated })
  }
  if (session.status === 'completed' && action !== 'settle' && action !== 'unsettle') {
    return NextResponse.json({ error: '计时已结束' }, { status: 409 })
  }

  const now    = new Date()
  let update: Record<string, unknown> = {}

  // ── 结算（服务端计算金额 + 同一事务内核销优惠券或会员奖励）────────────────────
  if (action === 'settle') {
    const ctx = await loadSettlementContext(admin, id, body.coupon_code)
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status })

    const sessionMemberId = (session.member_id as string | null) ?? null
    // 朋友用券时折扣出自另一位会员，所以「奖励的拥有者」可能不等于本单的归属人
    const sponsorMemberId = body.member_id ?? sessionMemberId
    const memberInfo = sponsorMemberId
      ? await getMemberSettleInfo(admin, sponsorMemberId, londonDateOf(new Date()))
      : null

    // 没显式指定来源时：本单会员有生效中的 VIP 就强制走 VIP（PRD 11.4），
    // 否则按有没有券码决定用券还是不用优惠。
    const source: DiscountSource = body.discount_source
      ?? (memberInfo?.vipActive && sponsorMemberId === sessionMemberId ? 'vip_month'
        : body.coupon_code ? 'coupon'
        : 'none')

    let discountPence: number
    let preview: unknown
    let couponCode: string | null = null

    if (source === 'coupon') {
      const computed = computeSettlement(ctx.context.session, ctx.context.coupon)
      if (!computed.ok) return NextResponse.json({ error: computed.error }, { status: 400 })
      discountPence = computed.preview.discountAmountPence
      couponCode    = computed.preview.couponCode
      preview       = computed.preview
    } else {
      const computed = computeMemberDiscount(source, {
        amountGbp:  ctx.context.session.amount_gbp,
        vipActive:  Boolean(memberInfo?.vipActive),
        rewardType: body.reward_type ?? null,
      })
      if (!computed.ok) return NextResponse.json({ error: mapMemberError(computed.error) }, { status: 400 })
      discountPence = computed.preview.discountAmountPence
      preview       = computed.preview
    }

    // 金额一律服务端算好传进去，数据库再拿自己的记录复核一遍，对不上就报错。
    // 会员参数只在真的用到会员折扣时传：迁移还没上的环境里旧版函数只有五个参数，
    // 多传参数会让店员连普通结算都做不了。
    const rpcParams: Record<string, unknown> = {
      p_session_id:            id,
      p_settled_by:            user.email ?? user.id,
      p_settlement_note:       body.settlement_note ?? null,
      p_coupon_code:           couponCode,
      p_discount_amount_pence: discountPence,
    }
    if (source === 'member_reward' || source === 'vip_month') {
      rpcParams.p_discount_source = source
      rpcParams.p_member_id       = source === 'member_reward' ? sponsorMemberId : sessionMemberId
      rpcParams.p_reward_type     = source === 'member_reward' ? (body.reward_type ?? null) : null
    }

    const { data: settled, error: rpcErr } = await admin.rpc('settle_timer_session', rpcParams)

    if (rpcErr) {
      console.error('[settle /api/admin/timers]', rpcErr.message)
      return NextResponse.json({ error: mapRpcError(rpcErr.message) }, { status: 409 })
    }

    // 如果关联了预约，自动标记为已完成
    if (session.booking_id) {
      const bookingAdmin = createAdminClient()
      await bookingAdmin
        .from('bookings')
        .update({ status: 'completed' })
        .eq('booking_id', session.booking_id)
        .in('status', ['confirmed', 'payment_pending'])
    }

    return NextResponse.json({ session: settled, preview, discount_source: source })
  }

  // ── 撤销结算（同一事务内恢复优惠券）─────────────────────────────────────────
  if (action === 'unsettle') {
    const { data: unsettled, error: rpcErr } = await admin.rpc('unsettle_timer_session', {
      p_session_id: id,
    })

    if (rpcErr) {
      console.error('[unsettle /api/admin/timers]', rpcErr.message)
      return NextResponse.json({ error: mapRpcError(rpcErr.message) }, { status: 409 })
    }

    // 关联预约的状态保持不动（撤销结算不回退预约）
    return NextResponse.json({ session: unsettled })
  }

  if (action === 'start') {
    if (session.status !== 'idle') return NextResponse.json({ error: '计时已开始' }, { status: 409 })
    update = { status: 'running', started_at: now.toISOString() }

  } else if (action === 'pause') {
    if (session.status !== 'running') return NextResponse.json({ error: '当前不在计时中' }, { status: 409 })
    update = { status: 'paused', paused_at: now.toISOString() }

  } else if (action === 'resume') {
    if (session.status !== 'paused') return NextResponse.json({ error: '当前未处于暂停状态' }, { status: 409 })
    const pausedAt       = new Date(session.paused_at as string)
    const pauseDurationMs = now.getTime() - pausedAt.getTime()
    update = {
      status:          'running',
      paused_at:       null,
      total_paused_ms: (session.total_paused_ms ?? 0) + pauseDurationMs,
    }

  } else {
    // stop
    if (session.status === 'idle') return NextResponse.json({ error: '计时尚未开始' }, { status: 409 })
    // 计算实际用时（扣除暂停时间）
    let totalPausedMs = session.total_paused_ms ?? 0
    if (session.status === 'paused' && session.paused_at) {
      totalPausedMs += now.getTime() - new Date(session.paused_at as string).getTime()
    }
    const startedAt      = new Date(session.started_at as string)
    const totalElapsedMs = now.getTime() - startedAt.getTime() - totalPausedMs
    const elapsedMinutes = Math.floor(totalElapsedMs / 60000)
    const billingMinutes = calcBillingMinutes(elapsedMinutes)
    const bill           = calcBill(billingMinutes)

    // 获取实时汇率（GBP → CNY）
    let exchangeRate: number | null = null
    let amountCny:    number | null = null
    try {
      const rateRes  = await fetch('https://api.frankfurter.app/latest?from=GBP&to=CNY', { next: { revalidate: 3600 } })
      const rateData = await rateRes.json() as { rates: { CNY: number } }
      exchangeRate   = rateData.rates.CNY
      amountCny      = parseFloat((bill.totalGbp * exchangeRate).toFixed(2))
    } catch {
      console.warn('[timer stop] 汇率获取失败，跳过人民币换算')
    }

    update = {
      status:          'completed',
      stopped_at:      now.toISOString(),
      paused_at:       null,
      total_paused_ms: totalPausedMs,
      elapsed_minutes: elapsedMinutes,
      billing_minutes: billingMinutes,
      amount_gbp:      bill.totalGbp,
      amount_cny:      amountCny,
      exchange_rate:   exchangeRate,
      bill_breakdown:  bill.lines,
    }
  }

  const { data: updated, error: updateErr } = await admin
    .from('timer_sessions')
    .update(update)
    .eq('session_id', id)
    .select()
    .single()

  if (updateErr) {
    console.error('[PATCH /api/admin/timers]', updateErr)
    return NextResponse.json({ error: '操作失败' }, { status: 500 })
  }

  return NextResponse.json({ session: updated })
}
