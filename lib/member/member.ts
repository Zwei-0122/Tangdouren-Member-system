// ============================================================
// 会员：Visit 口径、奖励进度、奖励可用性与折扣计算的纯函数
// 规则见《Tangdouren Club 会员系统 PRD v1》第 6、7、9、10、11、20、21 节
//
// 约定：
//   1) 金额一律换算成「便士整数」计算，与 lib/coupon/coupon.ts 同一套口径。
//   2) 折扣金额在这里算一遍，settle_timer_session 会拿数据库记录再复核一遍，
//      对不上就报错。改这里必须同步改 supabase/migrations/017_member_settlement.sql。
//   3) 本文件不碰数据库、不碰 React，可在浏览器、服务端与测试里共用。
// ============================================================

import { describeDiscount, londonToday, toPence, fromPence } from '../coupon/coupon.ts'

// ── 常量 ────────────────────────────────────────────────────────────────────

/** 每 10 个 Reward-eligible Visit 为一轮（PRD 7） */
export const REWARD_CYCLE_SIZE = 10

/** 一个会员同时最多一张 VIP Month 生效（PRD 11.6） */
export const MAX_ACTIVE_VIP_MONTHS = 1

/** VIP Month 有效期 30 天含首尾：expires_on = activated_on + 29（PRD 11.2） */
export const VIP_MONTH_DAYS = 30
export const VIP_MONTH_OFFSET_DAYS = VIP_MONTH_DAYS - 1

export const TWO_POUND_PENCE = 200
export const FIVE_POUND_PENCE = 500

/** 折扣百分比：本人 15%、朋友 10%、VIP 15%（PRD 10、11.3） */
export const PERSONAL_DISCOUNT_PERCENT = 15
export const FRIEND_DISCOUNT_PERCENT = 10
export const VIP_DISCOUNT_PERCENT = 15

export type RewardType =
  | 'TWO_POUND'
  | 'FIVE_POUND'
  | 'PERSONAL_15_OFF'
  | 'FRIEND_10_OFF'
  | 'VIP_MONTH'

/** 一次结算只允许一个折扣来源（PRD 21） */
export type DiscountSource = 'none' | 'coupon' | 'member_reward' | 'vip_month'

/** 一轮里各档位的门槛与对应奖励。第 2 轮及以后靠 10 ×(轮次 - 1) + 档位 推到 12 / 15 / 18 / 20（PRD 7） */
export const CYCLE_REWARD_NODES: readonly { node: number; rewardTypes: readonly RewardType[] }[] = [
  { node: 2,  rewardTypes: ['TWO_POUND'] },
  { node: 5,  rewardTypes: ['FIVE_POUND'] },
  { node: 8,  rewardTypes: ['PERSONAL_15_OFF', 'FRIEND_10_OFF'] },
  { node: 10, rewardTypes: ['VIP_MONTH'] },
]

/** 可以在结算台作为折扣使用的奖励类型（VIP Month 是权益，不是折扣来源） */
export const USABLE_REWARD_TYPES: readonly RewardType[] = [
  'TWO_POUND', 'FIVE_POUND', 'PERSONAL_15_OFF', 'FRIEND_10_OFF',
]

export interface MemberRewardRow {
  reward_id:      string
  member_id:      string
  reward_type:    RewardType
  cycle_index:    number
  unlocked_at:    string
  coupon_id:      string | null
  used_at:        string | null
}

export interface VipBenefitRow {
  benefit_id:   string
  reward_id:    string
  activated_on: string | null   // 伦敦当地 YYYY-MM-DD
  expires_on:   string | null
}

// ── 身份 ────────────────────────────────────────────────────────────────────

/** 会员以邮箱为唯一身份。email_key = lower(trim(email))，与数据库 members_email_key_check 同口径 */
export function normalizeMemberEmail(email: unknown): string {
  return typeof email === 'string' ? email.trim().toLowerCase() : ''
}

/** 邮箱形状：@ 前面要有东西，@ 后面要有域名点号（与 members_email_shape_check 同口径） */
export function isValidMemberEmail(email: string): boolean {
  const at = email.indexOf('@')
  if (at <= 0) return false
  const domain = email.slice(at + 1)
  const dot = domain.indexOf('.')
  return dot > 0 && dot < domain.length - 1 && !/\s/.test(email)
}

/** 客户端展示用的脱敏邮箱：z***@gmail.com（PRD 4.3 前后端都不提供改邮箱） */
export function maskEmail(email: string): string {
  const at = email.indexOf('@')
  if (at <= 0) return '***'
  return `${email[0]}***${email.slice(at)}`
}

// ── 日期（一律按伦敦自然日）────────────────────────────────────────────────

/** 某个时刻对应的伦敦当地日期。Visit 归日用它，跨午夜算到店那天 */
export function londonDateOf(at: Date | string): string {
  return londonToday(typeof at === 'string' ? new Date(at) : at)
}

/** YYYY-MM-DD 加 n 天，用 UTC 做纯日期运算，不受运行环境时区影响 */
export function addDays(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split('-').map(Number)
  const d = new Date(Date.UTC(year, month - 1, day + days))
  return d.toISOString().slice(0, 10)
}

/** 激活当天算起 30 天含首尾，所以到期日 = 激活日 + 29（PRD 11.2） */
export function vipExpiresOn(activatedOn: string): string {
  return addDays(activatedOn, VIP_MONTH_OFFSET_DAYS)
}

/** 某张 VIP Month 在指定伦敦日期是否生效。激活前不算，到期日当天仍有效 */
export function isVipBenefitActiveOn(benefit: VipBenefitRow, londonDate: string): boolean {
  if (!benefit.activated_on || !benefit.expires_on) return false
  return londonDate >= benefit.activated_on && londonDate <= benefit.expires_on
}

/** 会员此刻有没有生效中的 VIP Month */
export function isVipActive(benefits: VipBenefitRow[], londonDate: string): boolean {
  return benefits.some(b => isVipBenefitActiveOn(b, londonDate))
}

/**
 * VIP 月卡这类奖励**自身**的状态，由权益日期派生（不存状态字段）：
 *   ready  = 已解锁、还没激活
 *   active = 生效中（到期日当天仍算生效）
 *   ended  = 已经过期
 * 传进来的不是 VIP 月卡（没有权益行）时返回 null，交给调用方按普通奖励处理。
 * 日期都是伦敦当地 YYYY-MM-DD，字符串比较即可（同 isVipBenefitActiveOn 的口径）。
 */
export type VipRewardState = 'ready' | 'active' | 'ended'

export function vipRewardState(
  benefit: VipBenefitRow | null | undefined,
  londonToday: string,
): VipRewardState | null {
  if (!benefit) return null
  if (!benefit.activated_on) return 'ready'
  if (benefit.expires_on && benefit.expires_on < londonToday) return 'ended'
  return 'active'
}

// ── Visit 口径（与 member_visit_days 视图同口径）────────────────────────────

export interface VisitSessionRow {
  session_id:      string
  member_id:       string | null
  started_at:      string
  is_settled:      boolean
  reward_eligible: boolean | null
  /** 下面两个只有会员页要用来区分「这次是不是走了 VIP 折扣」，Visit 口径本身不需要 */
  discount_amount_gbp?: number | null
  coupon_code_snapshot?: string | null
}

export interface VisitDay {
  visit_date:      string
  reward_eligible: boolean
}

/**
 * 把计时单压成「访日」列表，与 SQL 视图 member_visit_days 完全同口径：
 *   只认有会员归属且已结算的单；按伦敦日期合并；当天只要有一条计入进度就算。
 */
export function buildVisitDays(sessions: VisitSessionRow[]): VisitDay[] {
  const byDate = new Map<string, VisitDay>()
  for (const s of sessions) {
    if (!s.member_id || !s.is_settled) continue
    const date = londonDateOf(s.started_at)
    const day = byDate.get(date) ?? { visit_date: date, reward_eligible: false }
    day.reward_eligible = day.reward_eligible || Boolean(s.reward_eligible)
    byDate.set(date, day)
  }
  return [...byDate.values()].sort((a, b) => a.visit_date.localeCompare(b.visit_date))
}

/** Lifetime Visits：真实到店次数，VIP 期间照常累计（PRD 6.1） */
export function countLifetimeVisits(visits: VisitDay[]): number {
  return visits.length
}

/**
 * Reward Progress：只认计入进度的访日。
 * 业主 2026-09-16 口径：VIP 期间进度照常累积，所以 false 只来自后台补挂的已结算单，
 * 那一单进 Lifetime、不进 Progress。
 */
export function countRewardProgress(visits: VisitDay[]): number {
  return visits.filter(v => v.reward_eligible).length
}

// ── 轮次、进度与解锁 ────────────────────────────────────────────────────────

/** 第 cycle 轮第 node 个档位对应的累计 Progress */
export function rewardThreshold(cycleIndex: number, node: number): number {
  return REWARD_CYCLE_SIZE * (cycleIndex - 1) + node
}

export interface UnlockedReward {
  cycle_index: number
  reward_type: RewardType
  threshold:   number
}

/** 当前 Progress 应该已经解锁的全部奖励。与 ensure_member_rewards 的循环同一个规则 */
export function unlockedRewardsForProgress(progress: number): UnlockedReward[] {
  if (progress <= 0) return []
  const unlocked: UnlockedReward[] = []
  const cycles = Math.floor((progress - 1) / REWARD_CYCLE_SIZE) + 1
  for (let cycle = 1; cycle <= cycles; cycle++) {
    for (const { node, rewardTypes } of CYCLE_REWARD_NODES) {
      const threshold = rewardThreshold(cycle, node)
      if (progress < threshold) continue
      for (const reward_type of rewardTypes) {
        unlocked.push({ cycle_index: cycle, reward_type, threshold })
      }
    }
  }
  return unlocked
}

export interface NextReward {
  cycle_index: number
  node:        number
  threshold:   number
  remaining:   number
  rewardTypes: readonly RewardType[]
}

/** 还差几次到下一个奖励（PRD 7.1 的 "2 more visits to your next reward"） */
export function nextReward(progress: number): NextReward | null {
  const cycle = Math.floor(progress / REWARD_CYCLE_SIZE) + 1
  for (const { node, rewardTypes } of CYCLE_REWARD_NODES) {
    const threshold = rewardThreshold(cycle, node)
    if (progress < threshold) {
      return { cycle_index: cycle, node, threshold, remaining: threshold - progress, rewardTypes }
    }
  }
  return null
}

/** 十格进度条里当前点亮几格。内部总进度不清零，顾客端按 10 循环显示（PRD 7） */
export function cycleProgress(progress: number): number {
  if (progress <= 0) return 0
  const filled = progress % REWARD_CYCLE_SIZE
  return filled === 0 ? REWARD_CYCLE_SIZE : filled
}

export type ProgressCellState = 'done' | 'current' | 'todo'

export interface ProgressCell {
  index:        number          // 1..10
  threshold:    number          // 该格对应的累计 Progress
  isRewardNode: boolean
  rewardTypes:  readonly RewardType[]
  state:        ProgressCellState
}

/** 进度条的十格数据。顾客端不显示 Cycle 1 / Cycle 2 这类技术概念（PRD 7.1） */
export function progressBarCells(progress: number): ProgressCell[] {
  const cycle = Math.floor(progress / REWARD_CYCLE_SIZE) + 1
  const filled = cycleProgress(progress)
  return Array.from({ length: REWARD_CYCLE_SIZE }, (_, i) => {
    const index = i + 1
    const node = CYCLE_REWARD_NODES.find(n => n.node === index)
    return {
      index,
      threshold:    rewardThreshold(cycle, index),
      isRewardNode: Boolean(node),
      rewardTypes:  node?.rewardTypes ?? [],
      state:        index <= filled ? 'done' : index === filled + 1 ? 'current' : 'todo',
    }
  })
}

// ── 奖励可用性 ──────────────────────────────────────────────────────────────

export type RewardState = 'available' | 'used' | 'paused_by_vip' | 'transferred'

export interface RewardAvailability {
  reward: MemberRewardRow
  state:  RewardState
}

/**
 * 单个奖励当前能不能用。顺序不能变：
 *   已用 → 已转赠成券（Friend 10% 转赠后不能再用，PRD 10.4）→ VIP 生效中 → 可用
 *
 * paused_by_vip 的含义是「顾客端不能自行使用」：业主 2026-09-16 口径下，VIP 期间进度照常累积、
 * 奖励也不作废，店员可以在结算台手动改用（见 computeMemberDiscount），所以它拦的是顾客自助那条路。
 */
export function rewardState(reward: MemberRewardRow, vipActive: boolean): RewardState {
  if (reward.used_at) return 'used'
  if (reward.reward_type === 'FRIEND_10_OFF' && reward.coupon_id) return 'transferred'
  if (vipActive) return 'paused_by_vip'
  return 'available'
}

/** My Rewards 列表：VIP 生效期间其他奖励继续显示、只标成顾客端不可自行使用，不隐藏（PRD 13.1） */
export function rewardAvailabilityList(
  rewards: MemberRewardRow[],
  vipActive: boolean,
): RewardAvailability[] {
  return rewards.map(reward => ({ reward, state: rewardState(reward, vipActive) }))
}

/**
 * 结算台挑券：同类奖励里挑「最早解锁且未使用」的一张（PRD 9）。
 * 排序与 SQL 的 ORDER BY unlocked_at, reward_id 保持一致，否则预览与实际核销会对不上。
 */
export function pickRewardForUse(
  rewards: MemberRewardRow[],
  rewardType: RewardType,
  excludeSessionId?: string | null,
): MemberRewardRow | null {
  // 不按 VIP 过滤：VIP 期间店员可以手动改用（业主 2026-09-16 口径），
  // 顾客端的限制由 rewardAvailabilityList 负责。
  const candidates = rewards
    .filter(r => r.reward_type === rewardType)
    .filter(r => rewardState(r, false) === 'available')
    .filter(r => !excludeSessionId || r.reward_id !== excludeSessionId)
    .sort((a, b) => a.unlocked_at.localeCompare(b.unlocked_at) || a.reward_id.localeCompare(b.reward_id))
  return candidates[0] ?? null
}

/**
 * 会员当前可选的奖励类型（去重，供结算台下拉用；PRD 21）。
 * 同样不按 VIP 过滤：VIP 期间结算台要能列出奖励供店员手动改用（业主 2026-09-16 口径）。
 */
export function usableRewardTypes(rewards: MemberRewardRow[]): RewardType[] {
  const types = rewards
    .filter(r => USABLE_REWARD_TYPES.includes(r.reward_type))
    .filter(r => rewardState(r, false) === 'available')
    .map(r => r.reward_type)
  return [...new Set(types)]
}

// ── VIP Month ───────────────────────────────────────────────────────────────

export interface VipMonthSummary {
  active:                VipBenefitRow | null
  readyToActivate:       number   // 已解锁、尚未激活的 VIP Month 数量（后台要显示）
  activated:             number
}

export function vipMonthSummary(
  rewards: MemberRewardRow[],
  benefits: VipBenefitRow[],
  londonDate: string,
): VipMonthSummary {
  const vipRewards = rewards.filter(r => r.reward_type === 'VIP_MONTH')
  const benefitByReward = new Map(benefits.map(b => [b.reward_id, b]))
  let readyToActivate = 0
  let activated = 0
  let active: VipBenefitRow | null = null

  for (const reward of vipRewards) {
    const benefit = benefitByReward.get(reward.reward_id)
    if (!benefit || !benefit.activated_on) {
      readyToActivate += 1
      continue
    }
    activated += 1
    if (!active && isVipBenefitActiveOn(benefit, londonDate)) active = benefit
  }

  return { active, readyToActivate, activated }
}

/**
 * 能不能再激活一张 VIP Month。同一时间只能有一张生效，且到期后不会自动续（PRD 11.6）。
 * 多张可累计，未激活的排队等下一次手动激活。
 */
export function canActivateVip(
  benefits: VipBenefitRow[],
  londonDate: string,
): { ok: true } | { ok: false; error: 'VIP_ALREADY_ACTIVE' } {
  const activeCount = benefits.filter(b => isVipBenefitActiveOn(b, londonDate)).length
  return activeCount >= MAX_ACTIVE_VIP_MONTHS
    ? { ok: false, error: 'VIP_ALREADY_ACTIVE' }
    : { ok: true }
}

// ── 折扣计算 ────────────────────────────────────────────────────────────────

export interface MemberDiscountPreview {
  source:              DiscountSource
  rewardType:          RewardType | null
  discountType:        'fixed_amount' | 'percentage_off'
  discountValue:       number
  description:         string
  preDiscountGbp:      number
  discountGbp:         number
  finalGbp:            number
  discountAmountPence: number
}

export type MemberDiscountResult =
  | { ok: true;  preview: MemberDiscountPreview }
  | { ok: false; error: MemberDiscountError }

export type MemberDiscountError =
  | 'SESSION_AMOUNT_MISSING'
  | 'DISCOUNT_SOURCE_INVALID'
  | 'COUPON_SOURCE_NOT_HANDLED'
  | 'VIP_MUST_BE_APPLIED'
  | 'VIP_NOT_ACTIVE'
  | 'REWARD_TYPE_INVALID'

export interface MemberDiscountContext {
  amountGbp:  number | null | undefined
  vipActive:  boolean
  rewardType?: RewardType | null
}

/**
 * 会员折扣的唯一计算入口（与 computeSettlement 并列，互不叠加）。
 * 错误码与 017 里 settle_timer_session 抛出的错误码同名，前端可以直接按码给文案。
 */
export function computeMemberDiscount(
  source: DiscountSource,
  ctx: MemberDiscountContext,
): MemberDiscountResult {
  if (ctx.amountGbp === null || ctx.amountGbp === undefined) {
    return { ok: false, error: 'SESSION_AMOUNT_MISSING' }
  }
  const prePence = toPence(ctx.amountGbp)

  // VIP 生效期间默认走 VIP 折扣；只有「不打折」被拒。
  // 业主 2026-09-16 口径：店员可以在柜台改用券或会员奖励，当次放弃 VIP 折扣，VIP 的 30 天不顺延。
  if (ctx.vipActive && source === 'none') {
    return { ok: false, error: 'VIP_MUST_BE_APPLIED' }
  }

  if (source === 'coupon') return { ok: false, error: 'COUPON_SOURCE_NOT_HANDLED' }
  if (source !== 'none' && source !== 'member_reward' && source !== 'vip_month') {
    return { ok: false, error: 'DISCOUNT_SOURCE_INVALID' }
  }

  let rewardType: RewardType | null = null
  let discountType: 'fixed_amount' | 'percentage_off' = 'fixed_amount'
  let discountValue = 0
  let discountPence = 0

  if (source === 'none') {
    discountPence = 0
  } else if (source === 'vip_month') {
    if (!ctx.vipActive) return { ok: false, error: 'VIP_NOT_ACTIVE' }
    discountType  = 'percentage_off'
    discountValue = VIP_DISCOUNT_PERCENT
    discountPence = percentOffPence(prePence, discountValue)
  } else {
    const type = ctx.rewardType ?? null
    if (!type || !USABLE_REWARD_TYPES.includes(type)) {
      return { ok: false, error: 'REWARD_TYPE_INVALID' }
    }
    rewardType = type
    if (type === 'TWO_POUND') {
      discountValue = TWO_POUND_PENCE / 100
      discountPence = Math.min(TWO_POUND_PENCE, prePence)
    } else if (type === 'FIVE_POUND') {
      discountValue = FIVE_POUND_PENCE / 100
      discountPence = Math.min(FIVE_POUND_PENCE, prePence)
    } else {
      discountType  = 'percentage_off'
      discountValue = type === 'PERSONAL_15_OFF' ? PERSONAL_DISCOUNT_PERCENT : FRIEND_DISCOUNT_PERCENT
      discountPence = percentOffPence(prePence, discountValue)
    }
  }

  const finalPence = prePence - discountPence
  return {
    ok: true,
    preview: {
      source,
      rewardType,
      discountType,
      discountValue,
      description: source === 'none'
        ? '不使用会员优惠'
        : source === 'vip_month'
          ? `VIP Month ${VIP_DISCOUNT_PERCENT}% OFF`
          : describeDiscount(discountType, discountValue),
      preDiscountGbp:      fromPence(prePence),
      discountGbp:         fromPence(discountPence),
      finalGbp:            fromPence(finalPence),
      discountAmountPence: discountPence,
    },
  }
}

/** 百分比折扣：按分四舍五入，与 SQL 的 ROUND(原价 pence × 百分比 / 100) 同口径 */
export function percentOffPence(prePence: number, percent: number): number {
  return Math.round(prePence * percent / 100)
}
