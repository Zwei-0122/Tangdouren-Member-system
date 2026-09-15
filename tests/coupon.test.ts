import assert from 'node:assert/strict'
import test from 'node:test'
import { calcBill } from '../lib/timer/pricing.ts'
import {
  computeSettlement,
  couponStatus,
  describeDiscount,
  isValidDateString,
  londonEndOfDayToUtcIso,
  londonToday,
  normalizeCouponCode,
  toPence,
  validateGenerateInput,
  type CouponForPreview,
  type SessionForPreview,
} from '../lib/coupon/coupon.ts'
import { COUPON_CODE_ALPHABET, generateCouponCode, generateCouponCodes } from '../lib/coupon/code.ts'

// ── 测试辅助 ────────────────────────────────────────────────────────────────

function session(billingMinutes: number, opts: Partial<SessionForPreview> = {}): SessionForPreview {
  return {
    session_id:      'PB-20260915-001',
    status:          'completed',
    is_settled:      false,
    billing_minutes: billingMinutes,
    amount_gbp:      calcBill(billingMinutes).totalGbp,
    ...opts,
  }
}

function coupon(type: CouponForPreview['discount_type'], value: number, opts: Partial<CouponForPreview> = {}): CouponForPreview {
  return {
    code:           'TDTESTCODE',
    discount_type:  type,
    discount_value: value,
    expires_at:     null,
    redeemed_at:    null,
    ...opts,
  }
}

function preview(s: SessionForPreview, c: CouponForPreview | null, now?: Date) {
  const res = computeSettlement(s, c, now)
  assert.equal(res.ok, true, res.ok ? '' : res.error)
  if (!res.ok) throw new Error('unreachable')
  return res.preview
}

function failure(s: SessionForPreview, c: CouponForPreview | null, now?: Date): string {
  const res = computeSettlement(s, c, now)
  assert.equal(res.ok, false)
  if (res.ok) throw new Error('unreachable')
  return res.error
}

// ── 11.1 计算测试 ───────────────────────────────────────────────────────────

test('固定抵扣：£13.99 订单使用 £2 券后应收 £11.99', () => {
  const p = preview(session(60), coupon('fixed_amount', 2))
  assert.equal(p.preDiscountGbp, 13.99)
  assert.equal(p.discountGbp, 2)
  assert.equal(p.finalGbp, 11.99)
})

test('固定抵扣大于原价时最终金额为 £0.00', () => {
  const p = preview(session(60), coupon('fixed_amount', 20))
  assert.equal(p.preDiscountGbp, 13.99)
  assert.equal(p.discountGbp, 13.99)
  assert.equal(p.finalGbp, 0)
  assert.equal(p.discountAmountPence, 1399)
})

test('百分比折扣：£25.99 使用 15% OFF 按便士四舍五入为 £3.90，应收 £22.09', () => {
  const p = preview(session(150), coupon('percentage_off', 15))
  assert.equal(p.preDiscountGbp, 25.99)
  assert.equal(p.discountGbp, 3.90)
  assert.equal(p.finalGbp, 22.09)
})

test('百分比折扣不会超过原价（例如 99% OFF）', () => {
  const p = preview(session(60), coupon('percentage_off', 99))
  assert.equal(p.discountGbp, 13.85)
  assert.equal(p.finalGbp, 0.14)
})

test('时长券：60 分钟订单不可使用', () => {
  assert.equal(failure(session(60), coupon('time_minutes', 30)), '当前订单没有可减免的续时时长')
})

test('时长券：90 分钟订单用 30 分钟券，统一减半小时续时价 £6.00', () => {
  const p = preview(session(90), coupon('time_minutes', 30))
  assert.equal(p.preDiscountGbp, 19.98)
  assert.equal(p.discountGbp, 6)
  assert.equal(p.finalGbp, 13.98)
})

test('时长券：150 分钟订单用 30 分钟券，同样减 £6.00（不重新跑套餐计价）', () => {
  const p = preview(session(150), coupon('time_minutes', 30))
  assert.equal(p.preDiscountGbp, 25.99)   // 2.5h 套餐价
  assert.equal(p.discountGbp, 6)
  assert.equal(p.finalGbp, 19.99)
})

test('时长券：240 分钟订单用 30 分钟券，同样减 £6.00', () => {
  const p = preview(session(240), coupon('time_minutes', 30))
  assert.equal(p.preDiscountGbp, 39.99)   // 4h 套餐价
  assert.equal(p.discountGbp, 6)
  assert.equal(p.finalGbp, 33.99)
})

test('时长券：60 分钟券减 £11.99（两倍半小时续时价）', () => {
  const p = preview(session(150), coupon('time_minutes', 60))
  assert.equal(p.discountGbp, 11.99)
  assert.equal(p.finalGbp, 14)
})

test('时长券：优惠金额不会超过订单原价', () => {
  const p = preview(session(90), coupon('time_minutes', 300))   // 10×£5.995 ≈ £59.95
  assert.equal(p.discountGbp, 19.98)
  assert.equal(p.finalGbp, 0)
})

test('无券结算时最终应收等于系统原价', () => {
  const p = preview(session(150), null)
  assert.equal(p.couponCode, null)
  assert.equal(p.discountGbp, 0)
  assert.equal(p.finalGbp, 25.99)
})

test('未完成计时的订单不能结算', () => {
  assert.equal(failure(session(60, { status: 'running' }), null), '请先结束计时再结算')
})

test('已结算订单不能重复结算', () => {
  assert.equal(failure(session(60, { is_settled: true }), null), '该订单已结算')
})

// ── 11.2 状态测试 ───────────────────────────────────────────────────────────

test('永久有效券（expires_at 为空）可验证', () => {
  assert.equal(couponStatus(coupon('fixed_amount', 2)), 'unused')
})

test('截止日当天伦敦时间 23:59 前仍可验证', () => {
  // 2026-07-15 伦敦当地 23:59:59 = 22:59:59Z
  const expiresAt = londonEndOfDayToUtcIso('2026-07-15')
  assert.equal(expiresAt, '2026-07-15T22:59:59.000Z')
  const before = new Date('2026-07-15T22:59:00.000Z')
  assert.equal(couponStatus({ redeemed_at: null, expires_at: expiresAt }, before), 'unused')
  const after = new Date('2026-07-15T23:00:00.000Z')
  assert.equal(couponStatus({ redeemed_at: null, expires_at: expiresAt }, after), 'expired')
})

test('冬季（GMT）截止日换算不带夏令时偏移', () => {
  assert.equal(londonEndOfDayToUtcIso('2026-12-15'), '2026-12-15T23:59:59.000Z')
})

test('过期券被拒绝', () => {
  const expiresAt = londonEndOfDayToUtcIso('2026-07-15')
  const now       = new Date('2026-07-16T10:00:00.000Z')
  assert.equal(failure(session(60), coupon('fixed_amount', 2, { expires_at: expiresAt }), now), '该优惠券已过期')
})

test('已使用券被拒绝', () => {
  const c = coupon('fixed_amount', 2, { redeemed_at: '2026-07-10T10:00:00.000Z' })
  assert.equal(failure(session(60), c), '该优惠券已被使用')
})

test('优惠码输入忽略大小写与首尾空格', () => {
  assert.equal(normalizeCouponCode('  tdabcd1234 '), 'TDABCD1234')
  assert.equal(normalizeCouponCode(null), '')
})

test('优惠文案', () => {
  assert.equal(describeDiscount('fixed_amount', 2), '减 £2.00')
  assert.equal(describeDiscount('percentage_off', 15), '15% OFF')
  assert.equal(describeDiscount('time_minutes', 30), '减免 30 分钟')
})

// ── 生成参数校验 ────────────────────────────────────────────────────────────

const TODAY = new Date('2026-09-15T12:00:00.000Z')

test('时长券只接受 30 分钟的整数倍', () => {
  const bad = validateGenerateInput({ discountType: 'time_minutes', discountValue: 45, expiresOn: null, quantity: 1 }, TODAY)
  assert.equal(bad.ok, false)
  if (!bad.ok) assert.equal(bad.error, '时长减免必须是 30 分钟的整数倍')

  const good = validateGenerateInput({ discountType: 'time_minutes', discountValue: 90, expiresOn: null, quantity: 1 }, TODAY)
  assert.equal(good.ok, true)
})

test('百分比折扣必须在 0 与 100 之间', () => {
  for (const value of [0, -5, 100, 120]) {
    const res = validateGenerateInput({ discountType: 'percentage_off', discountValue: value, expiresOn: null, quantity: 1 }, TODAY)
    assert.equal(res.ok, false, `${value} 应被拒绝`)
  }
  const ok = validateGenerateInput({ discountType: 'percentage_off', discountValue: 15, expiresOn: null, quantity: 1 }, TODAY)
  assert.equal(ok.ok, true)
})

test('固定金额最多两位小数且必须大于 0', () => {
  assert.equal(validateGenerateInput({ discountType: 'fixed_amount', discountValue: 2.005, expiresOn: null, quantity: 1 }, TODAY).ok, false)
  assert.equal(validateGenerateInput({ discountType: 'fixed_amount', discountValue: 0, expiresOn: null, quantity: 1 }, TODAY).ok, false)
  assert.equal(validateGenerateInput({ discountType: 'fixed_amount', discountValue: 2.5, expiresOn: null, quantity: 1 }, TODAY).ok, true)
})

test('生成数量必须是 1 到 500 之间的整数', () => {
  assert.equal(validateGenerateInput({ discountType: 'fixed_amount', discountValue: 2, expiresOn: null, quantity: 0 }, TODAY).ok, false)
  assert.equal(validateGenerateInput({ discountType: 'fixed_amount', discountValue: 2, expiresOn: null, quantity: 501 }, TODAY).ok, false)
  assert.equal(validateGenerateInput({ discountType: 'fixed_amount', discountValue: 2, expiresOn: null, quantity: 2.5 }, TODAY).ok, false)
  assert.equal(validateGenerateInput({ discountType: 'fixed_amount', discountValue: 2, expiresOn: null, quantity: 500 }, TODAY).ok, true)
})

test('截止日期必须是合法日期且不能早于今天（伦敦时间）', () => {
  assert.equal(validateGenerateInput({ discountType: 'fixed_amount', discountValue: 2, expiresOn: '2026-02-30', quantity: 1 }, TODAY).ok, false)
  assert.equal(validateGenerateInput({ discountType: 'fixed_amount', discountValue: 2, expiresOn: 'not-a-date', quantity: 1 }, TODAY).ok, false)
  assert.equal(validateGenerateInput({ discountType: 'fixed_amount', discountValue: 2, expiresOn: '2026-09-01', quantity: 1 }, TODAY).ok, false)
  assert.equal(validateGenerateInput({ discountType: 'fixed_amount', discountValue: 2, expiresOn: '2026-09-15', quantity: 1 }, TODAY).ok, true)
})

test('日期与伦敦当日判断', () => {
  assert.equal(isValidDateString('2026-09-15'), true)
  assert.equal(isValidDateString('2026-13-01'), false)
  assert.equal(londonToday(new Date('2026-09-15T22:30:00.000Z')), '2026-09-15')
  assert.equal(londonToday(new Date('2026-09-15T23:30:00.000Z')), '2026-09-16') // 伦敦已跨日
})

// ── 优惠码生成 ──────────────────────────────────────────────────────────────

test('优惠码格式：TD 前缀 + 8 位，且不含易混淆字符', () => {
  const code = generateCouponCode()
  assert.match(code, /^TD[A-Z2-9]{8}$/)
  assert.equal(code.length, 10)
  for (const ch of code.slice(2)) {
    assert.ok(COUPON_CODE_ALPHABET.includes(ch), `${ch} 不在字符集中`)
  }
  assert.equal(/[0O1I]/.test(code), false)
})

test('批量生成的优惠码互不重复', () => {
  const codes = generateCouponCodes(500)
  assert.equal(codes.length, 500)
  assert.equal(new Set(codes).size, 500)
})

test('便士换算按分四舍五入', () => {
  assert.equal(toPence(13.99), 1399)
  assert.equal(toPence(19.985), 1999)
  assert.equal(toPence(0.005), 1)
})
