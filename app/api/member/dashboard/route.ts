import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { findMemberByEmail, getMemberDashboard, mapMemberError } from '@/lib/member/service'
import { londonDateOf } from '@/lib/member/member'

// ── POST /api/member/dashboard — 会员首页数据（PRD 12、13、14）───────────────
// 设备上缓存的会员身份不是凭证，每次进页面都按邮箱重新查一遍数据库（PRD 4.3）。

const DashboardSchema = z.object({
  email:      z.string().email('请输入有效的邮箱地址').max(100),
  visitLimit: z.number().int().min(1).max(100).optional(),
})

export async function POST(request: NextRequest) {
  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 })
  }

  const parsed = DashboardSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? '参数有误' }, { status: 400 })
  }

  try {
    const admin  = createAdminClient()
    const member = await findMemberByEmail(admin, parsed.data.email)

    if (!member) return NextResponse.json({ error: '这个邮箱还不是会员' }, { status: 404 })

    const dashboard = await getMemberDashboard(admin, member.member_id, {
      visitLimit:  parsed.data.visitLimit ?? 10,
      londonToday: londonDateOf(new Date()),
    })
    if (!dashboard) return NextResponse.json({ error: '这个邮箱还不是会员' }, { status: 404 })

    return NextResponse.json({ dashboard })

  } catch (err) {
    const code = err instanceof Error ? err.message : ''
    console.error('[POST /api/member/dashboard]', code)
    return NextResponse.json({ error: mapMemberError(code) }, { status: 500 })
  }
}
