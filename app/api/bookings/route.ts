import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { createBooking, BookingError } from '@/lib/booking/bookingService'
import { BUSINESS_CONFIG as cfg } from '@/lib/booking/config'
import { TABLE_TYPE_DISPLAY } from '@/lib/booking/config'
import { PAYMENT_ENABLED } from '@/lib/payment/depositConfig'
import { sendEmail } from '@/lib/email/sender'
import { buildConfirmationEmail } from '@/lib/email/templates/confirmation'
import { generateCancelToken, buildCancelUrl } from '@/lib/token/cancelToken'
import { notifyAdminNewBooking } from '@/lib/email/notifyAdmin'
import { ensureMember } from '@/lib/member/service'

// ── POST /api/bookings — 提交新预约 ───────────────────────────────────────────

const BookingSchema = z.object({
  date:            z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式错误'),
  partySize:       z.number().int().min(1).max(4),
  acceptsSharing:  z.boolean(),
  startTime:       z.string().regex(/^\d{2}:\d{2}$/, '开始时间格式错误'),
  durationMinutes: z.number().int()
    .min(cfg.minDurationMinutes)
    .max(cfg.maxDurationMinutes)
    .refine(d => (d - cfg.minDurationMinutes) % cfg.durationStepMinutes === 0, '时长必须按30分钟递增'),
  customerName:    z.string().min(1, '请填写姓名').max(50),
  email:           z.string().email('请输入有效的邮箱地址').max(100),
  remark:          z.string().max(500).optional(),
  lang:            z.enum(['zh', 'en']).optional().default('zh'),
  // 勾选「加入糖豆人会员」：随预约一起建会员，不等支付结果（PRD 2.3）
  joinClub:        z.boolean().optional().default(false),
})

export async function POST(request: NextRequest) {
  try {
    const body   = await request.json()
    const parsed = BookingSchema.safeParse(body)

    if (!parsed.success) {
      const msg = parsed.error.errors[0]?.message ?? '请求参数有误'
      return NextResponse.json({ error: msg }, { status: 400 })
    }

    const supabase = createAdminClient()
    // joinClub 只用于会员，不进 bookings 表
    const { joinClub, ...bookingInput } = parsed.data
    const result   = await createBooking(bookingInput, supabase)

    // 勾选了加入会员就在这里建，失败也不连累预约本身。
    // 英文版暂不开放会员制度（业主 2026-09-17）：英文提交即使带上 joinClub 也不建会员。
    let memberJoined = false
    if (joinClub && parsed.data.lang === 'zh') {
      try {
        const { member } = await ensureMember(supabase, {
          email:         parsed.data.email,
          displayName:   parsed.data.customerName,
          consentSource: 'booking',
        })
        memberJoined = member.is_active
      } catch (memberErr) {
        console.error('[POST /api/bookings] 加入会员失败:', memberErr instanceof Error ? memberErr.message : memberErr)
      }
    }

    // ── 支付关闭：直接确认预约，发送确认邮件 ──────────────────────────────────
    if (!PAYMENT_ENABLED) {
      // 更新状态为 confirmed
      await supabase
        .from('bookings')
        .update({ status: 'confirmed', deposit_amount: 0 })
        .eq('booking_id', result.bookingId)

      // 生成取消 token
      const { token, hash, expiresAt } = generateCancelToken()
      await supabase
        .from('bookings')
        .update({ cancel_token_hash: hash, cancel_token_expires_at: expiresAt.toISOString() })
        .eq('booking_id', result.bookingId)

      // 发送确认邮件
      const tableDisplay = `${TABLE_TYPE_DISPLAY[result.assignedTableType as keyof typeof TABLE_TYPE_DISPLAY] ?? result.assignedTableType} · ${result.assignedTableCode}`
      const { subject, html } = buildConfirmationEmail({
        customerName:  parsed.data.customerName,
        bookingDate:   parsed.data.date,
        startTime:     parsed.data.startTime,
        endTime:       result.endTime,
        tableDisplay,
        partySize:     parsed.data.partySize,
        depositAmount: 0,
        cancelUrl:     buildCancelUrl(token),
        studioName:    parsed.data.lang === 'en' ? 'Jelly Bean Studio' : (process.env.NEXT_PUBLIC_STUDIO_NAME ?? '糖豆人手工工作室'),
        studioAddress: 'Unit 226, 65-75 Whitechapel Road, London E1 1DU',
        studioEmail:   process.env.NEXT_PUBLIC_STUDIO_EMAIL ?? 'hello@tangdouren.co.uk',
        lang:          parsed.data.lang,
        memberJoined,
      })
      const emailResult = await sendEmail({ to: parsed.data.email, subject, html })
      if (!emailResult.ok) {
        console.error('[POST /api/bookings] 确认邮件发送失败:', emailResult.error)
      }

      // 通知管理员
      await notifyAdminNewBooking({
        bookingId:    result.bookingId,
        customerName: parsed.data.customerName,
        email:        parsed.data.email,
        bookingDate:  parsed.data.date,
        startTime:    parsed.data.startTime,
        endTime:      result.endTime,
        tableCode:    result.assignedTableCode,
        tableType:    result.assignedTableType,
        partySize:    parsed.data.partySize,
        remark:       parsed.data.remark,
        source:       '顾客在线预约',
      })

      return NextResponse.json({ ...result, confirmed: true, depositAmount: 0, memberJoined }, { status: 201 })
    }

    return NextResponse.json({ ...result, memberJoined }, { status: 201 })

  } catch (err: unknown) {
    if (err instanceof BookingError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode })
    }
    const detail = err instanceof Error ? err.message : String(err)
    console.error('[POST /api/bookings]', detail)
    return NextResponse.json({ error: '服务器错误，请稍后重试' }, { status: 500 })
  }
}

// ── GET /api/bookings — 后台预约列表（需登录） ────────────────────────────────

// confirmed 预约超过结束时间 2 小时后自动标记为 completed
async function autoCompleteExpired(admin: ReturnType<typeof createAdminClient>) {
  try {
    // 伦敦当前时间（用于比较）
    const londonNow = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Europe/London',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).format(new Date()).replace(' ', 'T')

    // 取所有 confirmed 预约（只取需要的字段）
    const { data: confirmed } = await admin
      .from('bookings')
      .select('booking_id, booking_date, end_time')
      .eq('status', 'confirmed')

    if (!confirmed || confirmed.length === 0) return

    const toComplete: string[] = []
    for (const b of confirmed) {
      // 拼成完整时间字符串并加 2 小时
      const endStr = `${b.booking_date}T${b.end_time.slice(0, 5)}:00`
      const endMs  = new Date(endStr).getTime() + 2 * 60 * 60 * 1000
      if (new Date(londonNow).getTime() >= endMs) {
        toComplete.push(b.booking_id)
      }
    }

    if (toComplete.length === 0) return

    await admin
      .from('bookings')
      .update({ status: 'completed' })
      .in('booking_id', toComplete)
  } catch (e) {
    console.error('[autoCompleteExpired]', e)
  }
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: '未授权' }, { status: 401 })

    const adminSb = createAdminClient()
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const date   = searchParams.get('date')

    let query = adminSb
      .from('bookings')
      .select(`
        booking_id, booking_date, customer_name, email,
        party_size, accepts_sharing, start_time, end_time,
        assigned_table_code, assigned_table_type,
        booking_mode, seat_group_type,
        status, remark, created_at, deposit_amount
      `)
      .order('created_at', { ascending: false })

    if (status && status !== 'all') query = query.eq('status', status)
    if (date)                        query = query.eq('booking_date', date)

    const { data, error } = await query
    if (error) throw error

    // 惰性自动完成：confirmed 且 end_time + 2小时 < 当前伦敦时间 → 转为 completed
    void autoCompleteExpired(adminSb)

    return NextResponse.json(data ?? [])
  } catch (err) {
    console.error('[GET /api/bookings]', err)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}
