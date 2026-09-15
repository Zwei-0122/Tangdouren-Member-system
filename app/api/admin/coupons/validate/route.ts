// POST /api/admin/coupons/validate — 优惠券预验证（只预览，不核销）
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { loadSettlementContext } from '@/lib/coupon/service'
import { computeSettlement } from '@/lib/coupon/coupon'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '未授权' }, { status: 401 })

  let body: { code?: string; sessionId?: string }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 })
  }

  const sessionId = body.sessionId?.trim()
  if (!sessionId) return NextResponse.json({ error: '缺少计时订单号' }, { status: 400 })

  const admin = createAdminClient()
  const ctx   = await loadSettlementContext(admin, sessionId, body.code)
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status })

  // 不锁定、不核销：仅返回服务端计算的优惠预览
  const result = computeSettlement(ctx.context.session, ctx.context.coupon)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })

  return NextResponse.json({ preview: result.preview })
}
