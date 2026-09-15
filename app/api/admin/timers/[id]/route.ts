// PATCH /api/admin/timers/[id]  — 暂停 / 继续 / 结束计时
// GET   /api/admin/timers/[id]  — 获取单条计时详情（管理员）
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { calcBillingMinutes, calcBill } from '@/lib/timer/pricing'
import { resolveActiveSeatCodeFromValue } from '@/lib/timer/selfService'
import { computeSettlement } from '@/lib/coupon/coupon'
import { loadSettlementContext, mapRpcError } from '@/lib/coupon/service'

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
  return NextResponse.json({ session: data })
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
  const body     = await request.json() as { action: Action; coupon_code?: string; settlement_note?: string; table_number?: string }
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

  // ── 结算（服务端计算金额 + 同一事务内核销优惠券）─────────────────────────────
  if (action === 'settle') {
    const ctx = await loadSettlementContext(admin, id, body.coupon_code)
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status })

    const computed = computeSettlement(ctx.context.session, ctx.context.coupon)
    if (!computed.ok) return NextResponse.json({ error: computed.error }, { status: 400 })

    const { data: settled, error: rpcErr } = await admin.rpc('settle_timer_session', {
      p_session_id:            id,
      p_settled_by:            user.email ?? user.id,
      p_settlement_note:       body.settlement_note ?? null,
      p_coupon_code:           computed.preview.couponCode,
      p_discount_amount_pence: computed.preview.discountAmountPence,
    })

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

    return NextResponse.json({ session: settled, preview: computed.preview })
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
