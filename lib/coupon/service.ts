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
  return '操作失败，请重试'
}
