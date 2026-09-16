// POST /api/admin/timers  — 创建计时订单
// GET  /api/admin/timers  — 获取计时订单列表（管理员）
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { generateTimerSessionId } from '@/lib/timer/sessionId'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '未授权' }, { status: 401 })

  let body: { bookingId?: string; customerName?: string }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 })
  }

  const { bookingId, customerName } = body

  if (!customerName?.trim() && !bookingId) {
    return NextResponse.json({ error: '请填写顾客姓名或关联预约' }, { status: 400 })
  }

  const admin = createAdminClient()

  // 如果关联了预约，获取顾客姓名和桌号
  let resolvedName = customerName?.trim() ?? ''
  let tableNumber: string | null = null
  if (bookingId && !resolvedName) {
    const { data: booking } = await admin
      .from('bookings')
      .select('customer_name, assigned_table_code')
      .eq('booking_id', bookingId)
      .single()
    resolvedName = booking?.customer_name ?? ''
    tableNumber  = booking?.assigned_table_code ?? null
  } else if (bookingId) {
    const { data: booking } = await admin
      .from('bookings')
      .select('assigned_table_code')
      .eq('booking_id', bookingId)
      .single()
    tableNumber = booking?.assigned_table_code ?? null
  }

  const sessionId = await generateTimerSessionId(admin)

  const { data, error } = await admin
    .from('timer_sessions')
    .insert({
      session_id:    sessionId,
      booking_id:    bookingId ?? null,
      customer_name: resolvedName,
      table_number:  tableNumber,
      status:        'idle',
      created_via:   bookingId ? 'booking' : 'admin',
      created_by:    user.email ?? user.id,
    })
    .select()
    .single()

  if (error) {
    console.error('[POST /api/admin/timers]', error)
    return NextResponse.json({ error: '创建失败，请稍后重试' }, { status: 500 })
  }

  return NextResponse.json({ session: data }, { status: 201 })
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '未授权' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const statusFilter = searchParams.get('status')  // running | paused | completed | all

  const admin = createAdminClient()
  let query = admin
    .from('timer_sessions')
    .select('*, bookings(booking_date, start_time, end_time)')
    .order('created_at', { ascending: false })
    .limit(100)

  if (statusFilter && statusFilter !== 'all') {
    query = query.eq('status', statusFilter)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // 会员信息单独查一次，不做 join：迁移还没上的环境里 timer_sessions 没有 member_id 列，
  // 直接 join members 会让整个列表报错。取到 member_id 才查，取不到就跳过。
  const rows = (data ?? []) as { member_id?: string | null }[]
  const memberIds = [...new Set(rows.map(r => r.member_id).filter((v): v is string => Boolean(v)))]
  const memberById = new Map<string, { display_name: string | null; email: string }>()
  if (memberIds.length > 0) {
    const { data: members } = await admin
      .from('members')
      .select('member_id, display_name, email')
      .in('member_id', memberIds)
    for (const m of members ?? []) {
      memberById.set(m.member_id as string, { display_name: m.display_name as string | null, email: m.email as string })
    }
  }

  return NextResponse.json({
    sessions: rows.map(r => ({ ...r, member: r.member_id ? memberById.get(r.member_id) ?? null : null })),
  })
}
