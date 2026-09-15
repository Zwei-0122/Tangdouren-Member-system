// 服务端随机优惠码生成（Node crypto，安全随机源）
// 仅在 API 路由中使用，不进入浏览器包

import { randomInt } from 'node:crypto'
import { COUPON_CODE_LENGTH, COUPON_CODE_PREFIX } from './coupon.ts'

// 排除易混淆字符：0 / O、1 / I
export const COUPON_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** 生成一张优惠码，格式：TD + 8 位大写字母数字 */
export function generateCouponCode(): string {
  let suffix = ''
  for (let i = 0; i < COUPON_CODE_LENGTH; i++) {
    suffix += COUPON_CODE_ALPHABET[randomInt(COUPON_CODE_ALPHABET.length)]
  }
  return `${COUPON_CODE_PREFIX}${suffix}`
}

/** 批量生成互不重复的优惠码（同批次内去重） */
export function generateCouponCodes(quantity: number): string[] {
  const codes = new Set<string>()
  while (codes.size < quantity) codes.add(generateCouponCode())
  return [...codes]
}
