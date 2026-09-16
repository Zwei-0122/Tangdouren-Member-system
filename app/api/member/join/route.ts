import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { ensureMember, mapMemberError } from '@/lib/member/service'
import { maskEmail } from '@/lib/member/member'

// ── POST /api/member/join — 加入 Tangdouren Club ──────────────────────────────
// 邮箱已经注册过时不报错，直接识别为已有会员并返回（PRD 2.3）。

const JoinSchema = z.object({
  name:    z.string().min(1, '请填写姓名').max(50),
  email:   z.string().email('请输入有效的邮箱地址').max(100),
  consent: z.boolean().refine(v => v === true, '请先勾选同意会员条款'),
})

export async function POST(request: NextRequest) {
  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 })
  }

  const parsed = JoinSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? '参数有误' }, { status: 400 })
  }

  try {
    const admin = createAdminClient()
    const { member, created } = await ensureMember(admin, {
      email:         parsed.data.email,
      displayName:   parsed.data.name,
      consentSource: 'in_store',
    })

    if (!member.is_active) {
      return NextResponse.json({ error: mapMemberError('MEMBER_INACTIVE') }, { status: 403 })
    }

    return NextResponse.json({
      created,
      member: {
        member_id:    member.member_id,
        display_name: member.display_name,
        email_masked: maskEmail(member.email),
      },
    }, { status: created ? 201 : 200 })

  } catch (err) {
    const code = err instanceof Error ? err.message : ''
    console.error('[POST /api/member/join]', code)
    const status = code === 'INVALID_EMAIL' ? 400 : 500
    return NextResponse.json({ error: mapMemberError(code) }, { status })
  }
}
