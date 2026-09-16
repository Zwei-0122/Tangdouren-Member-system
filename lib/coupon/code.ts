// 服务端随机优惠码生成（Node crypto，安全随机源）
// 仅在 API 路由中使用，不进入浏览器包

import { randomInt } from 'node:crypto'
import { COUPON_CODE_LENGTH, COUPON_CODE_PREFIX } from './coupon.ts'

// 排除易混淆字符：0 / O、1 / I
export const COUPON_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** 生成一张优惠码，格式：活动前缀 + 5 位大写字母数字随机后缀 */
export function generateCouponCode(prefix: string = COUPON_CODE_PREFIX): string {
  let suffix = ''
  for (let i = 0; i < COUPON_CODE_LENGTH; i++) {
    suffix += COUPON_CODE_ALPHABET[randomInt(COUPON_CODE_ALPHABET.length)]
  }
  return `${prefix}${suffix}`
}

/**
 * 批量生成互不重复的优惠码（同批次内去重）。
 * 后缀随机、不做顺序号：递增数字可被枚举，明确否决。
 */
export function generateCouponCodes(quantity: number, prefix: string = COUPON_CODE_PREFIX): string[] {
  const codes = new Set<string>()
  while (codes.size < quantity) codes.add(generateCouponCode(prefix))
  return [...codes]
}
