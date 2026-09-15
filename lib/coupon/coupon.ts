// ============================================================
// 优惠券：类型、状态判定与优惠计算（纯函数，可在浏览器/服务端/测试中复用）
// 规则见 PRD《Tangdouren 优惠券生成与核销系统》第 5、6 节
// 金额一律换算为「便士整数」计算，避免浮点误差
// ============================================================

import { TIMER_PRICING } from '../timer/pricing.ts'

export type DiscountType = 'fixed_amount' | 'percentage_off' | 'time_minutes'
export type CouponStatus = 'unused' | 'redeemed' | 'expired'

export const COUPON_CODE_PREFIX       = 'TD'
export const COUPON_CODE_LENGTH       = 8      // 去掉易混淆字符后随机位数
export const MIN_BILLING_MINUTES      = 60     // 首小时不可减免
export const TIME_COUPON_STEP_MINUTES = 30     // 时长券必须是 30 分钟的整数倍
export const MAX_GENERATE_QUANTITY    = 500    // 单次生成上限
export const MIN_GENERATE_QUANTITY    = 1

/** 每 30 分钟续时价格（£11.99/h ÷ 2），时长券按此统一抵扣 */
export const CONTINUATION_BLOCK_GBP = TIMER_PRICING.continuationPerHourGbp / 2

export const COUPON_STATUS_LABELS: Record<CouponStatus, string> = {
  unused:   '未使用',
  redeemed: '已使用',
  expired:  '已过期',
}

// ── 金额换算 ────────────────────────────────────────────────────────────────

/** 英镑 → 便士整数（四舍五入到分） */
export function toPence(gbp: number): number {
  return Math.round(gbp * 100)
}

/** 便士整数 → 英镑数值 */
export function fromPence(pence: number): number {
  return pence / 100
}

/** 统一的优惠码输入规范化：去首尾空格 + 转大写 */
export function normalizeCouponCode(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toUpperCase() : ''
}

// ── 状态判定 ────────────────────────────────────────────────────────────────

export interface CouponStateFields {
  redeemed_at: string | null
  expires_at:  string | null
}

/** 状态判定顺序：已核销 → 已过期 → 未使用（有效期动态判断，不落库） */
export function couponStatus(coupon: CouponStateFields, now: Date = new Date()): CouponStatus {
  if (coupon.redeemed_at) return 'redeemed'
  if (coupon.expires_at && new Date(coupon.expires_at).getTime() < now.getTime()) return 'expired'
  return 'unused'
}

/** 优惠内容文案，例如「减 £2.00」「15% OFF」「减免 30 分钟」 */
export function describeDiscount(type: DiscountType, value: number): string {
  if (type === 'fixed_amount')   return `减 £${value.toFixed(2)}`
  if (type === 'percentage_off') return `${trimNumber(value)}% OFF`
  return `减免 ${trimNumber(value)} 分钟`
}

function trimNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(parseFloat(value.toFixed(2)))
}

// ── 伦敦时区日期处理 ────────────────────────────────────────────────────────

const LONDON_TZ = 'Europe/London'

/** 某个 UTC 时刻下，伦敦比 UTC 快多少毫秒（BST 时为正） */
function londonOffsetMs(date: Date): number {
  const dtf = new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON_TZ, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const parts = dtf.formatToParts(date)
  const get   = (type: string) => Number(parts.find(p => p.type === type)?.value ?? '0')
  const asUtc = Date.UTC(
    get('year'), get('month') - 1, get('day'),
    get('hour'), get('minute'), get('second'),
  )
  return asUtc - date.getTime()
}

/** 伦敦当地日期（YYYY-MM-DD） */
export function londonToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: LONDON_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
}

/**
 * 把「截止日期」（伦敦当地 YYYY-MM-DD）转换成 UTC 时刻，结束于当日 23:59:59。
 * 永久有效时调用方应传 null。
 */
export function londonEndOfDayToUtcIso(dateStr: string): string | null {
  if (!isValidDateString(dateStr)) return null
  const [year, month, day] = dateStr.split('-').map(Number)
  // 先按「伦敦墙上时间 23:59:59」当作 UTC 得到近似时刻，再用该时刻的伦敦偏移校正
  const probe = new Date(Date.UTC(year, month - 1, day, 23, 59, 59))
  return new Date(probe.getTime() - londonOffsetMs(probe)).toISOString()
}

/** 判断 YYYY-MM-DD 是否是合法日历日期 */
export function isValidDateString(dateStr: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)
  if (!m) return false
  const year = Number(m[1]), month = Number(m[2]), day = Number(m[3])
  const d = new Date(Date.UTC(year, month - 1, day))
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day
}

// ── 生成参数校验 ────────────────────────────────────────────────────────────

export interface GenerateCouponInput {
  discountType:  DiscountType
  discountValue: number
  expiresOn:     string | null   // 伦敦当地 YYYY-MM-DD，null = 永久有效
  quantity:      number
}

export type GenerateValidation =
  | { ok: true;  value: GenerateCouponInput }
  | { ok: false; error: string }

export function validateGenerateInput(raw: {
  discountType?: unknown
  discountValue?: unknown
  expiresOn?: unknown
  quantity?: unknown
}, now: Date = new Date()): GenerateValidation {
  const type = raw.discountType
  if (type !== 'fixed_amount' && type !== 'percentage_off' && type !== 'time_minutes') {
    return { ok: false, error: '请选择优惠类型' }
  }

  const value = typeof raw.discountValue === 'number'
    ? raw.discountValue
    : parseFloat(String(raw.discountValue ?? ''))
  if (!Number.isFinite(value) || value <= 0) {
    return { ok: false, error: '优惠值必须大于 0' }
  }

  if (type === 'fixed_amount') {
    if (value > 9999.99) return { ok: false, error: '固定金额过大' }
    if (toPence(value) / 100 !== parseFloat(value.toFixed(2))) {
      return { ok: false, error: '固定金额最多保留两位小数' }
    }
  }

  if (type === 'percentage_off' && value >= 100) {
    return { ok: false, error: '折扣百分比必须大于 0 且小于 100' }
  }

  if (type === 'time_minutes') {
    if (!Number.isInteger(value) || value % TIME_COUPON_STEP_MINUTES !== 0) {
      return { ok: false, error: `时长减免必须是 ${TIME_COUPON_STEP_MINUTES} 分钟的整数倍` }
    }
  }

  let expiresOn: string | null = null
  const rawExpires = typeof raw.expiresOn === 'string' && raw.expiresOn.trim() !== '' ? raw.expiresOn.trim() : null
  if (rawExpires) {
    if (!isValidDateString(rawExpires)) return { ok: false, error: '截止日期格式不正确' }
    if (rawExpires < londonToday(now)) return { ok: false, error: '截止日期不能早于今天' }
    expiresOn = rawExpires
  }

  const rawQuantity = raw.quantity
  const quantity = typeof rawQuantity === 'number'
    ? rawQuantity
    : (typeof rawQuantity === 'string' && /^\d+$/.test(rawQuantity.trim())
        ? parseInt(rawQuantity.trim(), 10)
        : NaN)
  if (!Number.isInteger(quantity) || quantity < MIN_GENERATE_QUANTITY || quantity > MAX_GENERATE_QUANTITY) {
    return { ok: false, error: `生成数量必须是 ${MIN_GENERATE_QUANTITY} 到 ${MAX_GENERATE_QUANTITY} 之间的整数` }
  }

  return { ok: true, value: { discountType: type, discountValue: value, expiresOn, quantity } }
}

// ── 优惠计算 / 预验证 ───────────────────────────────────────────────────────

export interface CouponForPreview {
  code:            string
  discount_type:   DiscountType
  discount_value:  number
  expires_at:      string | null
  redeemed_at:     string | null
}

export interface SessionForPreview {
  session_id:      string
  status:          string
  is_settled:      boolean
  billing_minutes: number | null
  amount_gbp:      number | null
}

export interface SettlementPreview {
  sessionId:           string
  couponCode:          string | null
  discountType:        DiscountType | null
  discountValue:       number | null
  description:         string
  preDiscountGbp:      number
  discountGbp:         number
  finalGbp:            number
  discountAmountPence: number
}

export type PreviewResult =
  | { ok: true;  preview: SettlementPreview }
  | { ok: false; error: string }

/**
 * 服务端唯一的优惠计算入口。
 * 传入订单与优惠券记录，返回原价 / 优惠金额 / 最终应收（英镑）以及时长券的优惠后计费分钟。
 * coupon 为 null 时表示不使用优惠券。
 */
export function computeSettlement(
  session: SessionForPreview,
  coupon: CouponForPreview | null,
  now: Date = new Date(),
): PreviewResult {
  if (session.status !== 'completed') {
    return { ok: false, error: '请先结束计时再结算' }
  }
  if (session.is_settled) {
    return { ok: false, error: '该订单已结算' }
  }
  if (session.amount_gbp === null || session.amount_gbp === undefined) {
    return { ok: false, error: '订单金额缺失，无法结算' }
  }

  const prePence = toPence(session.amount_gbp)

  // 无券
  if (!coupon) {
    return {
      ok: true,
      preview: {
        sessionId:           session.session_id,
        couponCode:          null,
        discountType:        null,
        discountValue:       null,
        description:         '不使用优惠券',
        preDiscountGbp:      fromPence(prePence),
        discountGbp:         0,
        finalGbp:            fromPence(prePence),
        discountAmountPence: 0,
      },
    }
  }

  const status = couponStatus(coupon, now)
  if (status === 'redeemed') return { ok: false, error: '该优惠券已被使用' }
  if (status === 'expired')  return { ok: false, error: '该优惠券已过期' }

  let discountPence: number

  if (coupon.discount_type === 'fixed_amount') {
    // 优惠金额 = min(固定抵扣金额, 系统原价)
    discountPence = Math.min(toPence(coupon.discount_value), prePence)

  } else if (coupon.discount_type === 'percentage_off') {
    // 优惠金额 = 系统原价 × 减免百分比 ÷ 100（按分四舍五入）
    discountPence = Math.round(prePence * coupon.discount_value / 100)

  } else {
    // 时长券：首小时不可减免；按「每 30 分钟续时价」统一抵扣，不重新计算套餐
    const billingMinutes = session.billing_minutes
    if (billingMinutes === null || billingMinutes === undefined || billingMinutes <= MIN_BILLING_MINUTES) {
      return { ok: false, error: '当前订单没有可减免的续时时长' }
    }
    const blocks = coupon.discount_value / TIME_COUPON_STEP_MINUTES
    discountPence = Math.min(toPence(blocks * CONTINUATION_BLOCK_GBP), prePence)
  }

  if (discountPence > prePence) discountPence = prePence
  const finalPence = prePence - discountPence

  return {
    ok: true,
    preview: {
      sessionId:           session.session_id,
      couponCode:          coupon.code,
      discountType:        coupon.discount_type,
      discountValue:       coupon.discount_value,
      description:         describeDiscount(coupon.discount_type, coupon.discount_value),
      preDiscountGbp:      fromPence(prePence),
      discountGbp:         fromPence(discountPence),
      finalGbp:            fromPence(finalPence),
      discountAmountPence: discountPence,
    },
  }
}
