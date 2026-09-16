import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { findMemberByEmail, mapMemberError } from '@/lib/member/service'
import { maskEmail } from '@/lib/member/member'

// ── POST /api/member/lookup — 已有会员只输邮箱识别（PRD 4.2）──────────────────
// 用 POST 而不是 GET：邮箱不落在 URL 与访问日志里。

const LookupSchema = z.object({
  email: z.string().email('请输入有效的邮箱地址').max(100),
})

export async function POST(request: NextRequest) {
  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 })
  }

  const parsed = LookupSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? '参数有误' }, { status: 400 })
  }

  try {
    const admin  = createAdminClient()
    const member = await findMemberByEmail(admin, parsed.data.email)

    if (!member) {
      return NextResponse.json({ error: '这个邮箱还不是会员，请先加入会员' }, { status: 404 })
    }
    if (!member.is_active) {
      return NextResponse.json({ error: mapMemberError('MEMBER_INACTIVE') }, { status: 403 })
    }

    return NextResponse.json({
      member: {
        member_id:    member.member_id,
        display_name: member.display_name,
        email_masked: maskEmail(member.email),
      },
    })

  } catch (err) {
    const code = err instanceof Error ? err.message : ''
    console.error('[POST /api/member/lookup]', code)
    return NextResponse.json({ error: mapMemberError(code) }, { status: 500 })
  }
}
