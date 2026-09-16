// ============================================================
// 优惠券服务端辅助：读取结算上下文、预验证、错误文案映射
// 由 /api/admin/coupons/validate 与 /api/admin/timers/[id]（settle / unsettle）共用
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  normalizeCouponCode,
  type CouponForPreview, type SessionForPreview,
} from './coupon.ts'

export interface SettlementContext {
  session: SessionForPreview & { booking_id: string | null }
  coupon:  CouponForPreview | null
}

export type ContextResult =
  | { ok: true;  context: SettlementContext }
  | { ok: false; status: number; error: string }

/**
 * 读取订单与优惠码（如有）。只做读取与存在性校验，
 * 优惠与金额判定交给 computeSettlement。
 */
export async function loadSettlementContext(
  admin: SupabaseClient,
  sessionId: string,
  rawCode: string | null | undefined,
): Promise<ContextResult> {
  const { data: session, error: sessionErr } = await admin
    .from('timer_sessions')
    .select('session_id, status, is_settled, billing_minutes, amount_gbp, booking_id')
    .eq('session_id', sessionId)
    .maybeSingle()

  if (sessionErr) {
    console.error('[coupon] 读取计时订单失败', sessionErr.message)
    return { ok: false, status: 500, error: '读取订单失败，请重试' }
  }
  if (!session) {
    return { ok: false, status: 404, error: '计时订单不存在' }
  }

  const code = normalizeCouponCode(rawCode)
  if (!code) {
    return { ok: true, context: { session, coupon: null } }
  }

  const { data: coupon, error: couponErr } = await admin
    .from('coupons')
    .select('code, discount_type, discount_value, expires_at, redeemed_at')
    .eq('code', code)
    .maybeSingle()

  if (couponErr) {
    console.error('[coupon] 读取优惠券失败', couponErr.message)
    return { ok: false, status: 500, error: '读取优惠券失败，请重试' }
  }
  if (!coupon) {
    return { ok: false, status: 404, error: '优惠码不存在' }
  }

  return { ok: true, context: { session, coupon } }
}

/** 把数据库 RPC 抛出的标记转换成中文提示，不向前端暴露原始数据库错误 */
export function mapRpcError(message: string | undefined | null): string {
  const raw = message ?? ''
  if (raw.includes('COUPON_ALREADY_USED'))         return '该优惠券已被使用'
  if (raw.includes('COUPON_EXPIRED'))              return '该优惠券已过期'
  if (raw.includes('COUPON_NOT_FOUND'))            return '优惠码不存在'
  if (raw.includes('SESSION_ALREADY_HAS_COUPON'))  return '该订单已使用过优惠券'
  if (raw.includes('SESSION_ALREADY_SETTLED'))     return '该订单已结算'
  if (raw.includes('SESSION_NOT_SETTLED'))         return '该订单尚未结算'
  if (raw.includes('SESSION_NOT_COMPLETED'))       return '请先结束计时再结算'
  if (raw.includes('SESSION_NOT_FOUND'))           return '计时订单不存在'
  if (raw.includes('COUPON_TIME_NOT_APPLICABLE'))  return '当前订单没有可减免的续时时长'
  if (raw.includes('COUPON_DISCOUNT_MISMATCH'))    return '优惠金额校验未通过，请重新验证优惠码'
  if (raw.includes('COUPON_REDEMPTION_MISMATCH'))  return '优惠券核销状态异常，请刷新页面后重试'
  // ── 会员相关（settle_timer_session 的会员分支。文案与 lib/member/service.ts 的 mapMemberError 一致）──
  if (raw.includes('MEMBER_REQUIRED'))             return '该订单没有关联会员'
  if (raw.includes('MEMBER_NOT_FOUND'))            return '找不到该会员'
  if (raw.includes('MEMBER_SESSION_MISMATCH'))     return '这类奖励只能用于本人的订单，请先把订单关联到会员'
  if (raw.includes('MEMBER_REWARD_UNAVAILABLE'))   return '该会员当前没有可用的这类奖励'
  if (raw.includes('MEMBER_REWARD_COUPON_USED'))   return '该奖励对应的内部券已经被使用'
  if (raw.includes('MEMBER_DISCOUNT_MISMATCH'))    return '会员优惠金额校验未通过，请刷新后重试'
  if (raw.includes('MEMBER_DISCOUNT_MISSING'))     return '会员优惠金额缺失，请重新选择'
  if (raw.includes('REWARD_TYPE_INVALID'))         return '奖励类型无效'
  if (raw.includes('REWARD_ALREADY_USED'))         return '这个订单解锁的奖励已经被用掉了，需要管理员处理'
  if (raw.includes('VIP_MUST_BE_APPLIED'))         return 'VIP 生效期间系统自动使用 VIP 85 折，不能改用其他会员优惠'
  if (raw.includes('VIP_NOT_ACTIVE'))              return '该会员当前没有生效中的 VIP Month'
  if (raw.includes('VIP_ALREADY_ACTIVATED'))       return '这张 VIP Month 已经激活过了'
  if (raw.includes('MULTIPLE_DISCOUNT_SOURCES'))   return '一个订单只能使用一种优惠'
  if (raw.includes('DISCOUNT_SOURCE_INVALID'))     return '优惠类型无效'
  if (raw.includes('DISCOUNT_AMOUNT_INVALID'))     return '优惠金额异常，请重新选择'
  return '操作失败，请重试'
}
