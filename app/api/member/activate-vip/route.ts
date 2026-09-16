import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { activateVipMonth, findMemberByEmail, mapMemberError } from '@/lib/member/service'

// ── POST /api/member/activate-vip — 会员自己激活 VIP Month（PRD 11.1）─────────
// 解锁不自动激活，会员点 Activate 才生效；同一时间只能有一张生效（PRD 11.6），
// 这个判断在数据库函数里靠行锁完成，应用层只负责核对奖励确实属于这个人。

const ActivateSchema = z.object({
  email:     z.string().email('请输入有效的邮箱地址').max(100),
  reward_id: z.string().uuid('奖励参数有误'),
})

export async function POST(request: NextRequest) {
  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 })
  }

  const parsed = ActivateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? '参数有误' }, { status: 400 })
  }

  try {
    const admin  = createAdminClient()
    const member = await findMemberByEmail(admin, parsed.data.email)
    if (!member) return NextResponse.json({ error: '这个邮箱还不是会员' }, { status: 404 })
    if (!member.is_active) {
      return NextResponse.json({ error: mapMemberError('MEMBER_INACTIVE') }, { status: 403 })
    }

    // 奖励必须属于这个会员，否则任何人都能拿别人的 reward_id 来激活
    const { data: reward } = await admin
      .from('member_rewards')
      .select('reward_id, reward_type, member_id')
      .eq('reward_id', parsed.data.reward_id)
      .maybeSingle()

    if (!reward || reward.member_id !== member.member_id) {
      return NextResponse.json({ error: mapMemberError('MEMBER_REWARD_NOT_FOUND') }, { status: 404 })
    }

    const result = await activateVipMonth(admin, parsed.data.reward_id, 'member')
    if (!result.ok) {
      return NextResponse.json({ error: mapMemberError(result.error) }, { status: 409 })
    }

    return NextResponse.json({ benefit: result.benefit })

  } catch (err) {
    const code = err instanceof Error ? err.message : ''
    console.error('[POST /api/member/activate-vip]', code)
    return NextResponse.json({ error: mapMemberError(code) }, { status: 500 })
  }
}
