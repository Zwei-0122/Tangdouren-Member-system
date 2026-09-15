// GET  /api/admin/coupons  — 优惠券列表（分页 + 搜索 + 状态筛选 + 简单统计）
// POST /api/admin/coupons  — 批量生成优惠券
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { londonEndOfDayToUtcIso, validateGenerateInput } from '@/lib/coupon/coupon'
import { generateCouponCodes } from '@/lib/coupon/code'

const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE     = 200
const STATUS_FILTERS    = ['all', 'unused', 'redeemed', 'expired'] as const
type StatusFilter = typeof STATUS_FILTERS[number]

// ── 列表 ────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '未授权' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const statusParam = searchParams.get('status') ?? 'all'
  const status = (STATUS_FILTERS as readonly string[]).includes(statusParam)
    ? statusParam as StatusFilter
    : 'all'
  const search   = (searchParams.get('search') ?? '').trim().toUpperCase()
  const page     = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1)
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(searchParams.get('pageSize') ?? String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE))

  const now   = new Date().toISOString()
  const admin = createAdminClient()

  let query = admin
    .from('coupons')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })

  if (search) query = query.ilike('code', `%${search}%`)

  if (status === 'unused') {
    query = query.is('redeemed_at', null).or(`expires_at.is.null,expires_at.gte.${now}`)
  } else if (status === 'redeemed') {
    query = query.not('redeemed_at', 'is', null)
  } else if (status === 'expired') {
    query = query.is('redeemed_at', null).lt('expires_at', now)
  }

  const from = (page - 1) * pageSize
  const { data, error, count } = await query.range(from, from + pageSize - 1)

  if (error) {
    console.error('[GET /api/admin/coupons]', error.message)
    return NextResponse.json({ error: '读取优惠券失败，请重试' }, { status: 500 })
  }

  // 简单统计（不受分页/筛选影响，覆盖全表）
  const [totalRes, redeemedRes, expiredRes] = await Promise.all([
    admin.from('coupons').select('*', { count: 'exact', head: true }),
    admin.from('coupons').select('*', { count: 'exact', head: true }).not('redeemed_at', 'is', null),
    admin.from('coupons').select('*', { count: 'exact', head: true }).is('redeemed_at', null).lt('expires_at', now),
  ])

  const total    = totalRes.count    ?? 0
  const redeemed = redeemedRes.count ?? 0
  const expired  = expiredRes.count  ?? 0
  const available = Math.max(0, total - redeemed - expired)

  return NextResponse.json({
    coupons:   data ?? [],
    page,
    pageSize,
    total:     count ?? 0,
    totalPages: Math.max(1, Math.ceil((count ?? 0) / pageSize)),
    stats:     { total, available, redeemed, expired },
  })
}

// ── 生成 ────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '未授权' }, { status: 401 })

  let body: { discountType?: unknown; discountValue?: unknown; expiresOn?: unknown; quantity?: unknown }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 })
  }

  const validation = validateGenerateInput(body)
  if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 400 })
  const { discountType, discountValue, expiresOn, quantity } = validation.value

  let expiresAt: string | null = null
  if (expiresOn) {
    expiresAt = londonEndOfDayToUtcIso(expiresOn)
    if (!expiresAt) return NextResponse.json({ error: '截止日期格式不正确' }, { status: 400 })
  }

  const admin    = createAdminClient()
  const createdBy = user.email ?? user.id

  // 随机码碰撞概率极低，但仍以数据库唯一约束兜底：冲突时换一批重试
  for (let attempt = 0; attempt < 3; attempt++) {
    const codes = generateCouponCodes(quantity)
    const { data, error } = await admin
      .from('coupons')
      .insert(codes.map(code => ({
        code,
        discount_type:  discountType,
        discount_value: discountValue,
        expires_at:     expiresAt,
        created_by:     createdBy,
      })))
      .select()

    if (!error) {
      return NextResponse.json({ coupons: data ?? [], generated: data?.length ?? 0 }, { status: 201 })
    }
    if (error.code !== '23505') {
      console.error('[POST /api/admin/coupons]', error.message)
      return NextResponse.json({ error: '生成优惠券失败，请重试' }, { status: 500 })
    }
  }

  console.error('[POST /api/admin/coupons] 优惠码重复，重试后仍失败')
  return NextResponse.json({ error: '生成优惠券失败，请重试' }, { status: 500 })
}
