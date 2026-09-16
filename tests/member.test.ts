import assert from 'node:assert/strict'
import test from 'node:test'
import { calcBill } from '../lib/timer/pricing.ts'
import {
  CYCLE_REWARD_NODES,
  FIVE_POUND_PENCE,
  PERSONAL_DISCOUNT_PERCENT,
  REWARD_CYCLE_SIZE,
  TWO_POUND_PENCE,
  VIP_MONTH_DAYS,
  buildVisitDays,
  canActivateVip,
  computeMemberDiscount,
  countLifetimeVisits,
  countRewardProgress,
  cycleProgress,
  isVipActive,
  isVipBenefitActiveOn,
  isValidMemberEmail,
  londonDateOf,
  maskEmail,
  nextReward,
  normalizeMemberEmail,
  percentOffPence,
  pickRewardForUse,
  progressBarCells,
  rewardAvailabilityList,
  rewardState,
  rewardThreshold,
  unlockedRewardsForProgress,
  usableRewardTypes,
  vipExpiresOn,
  vipMonthSummary,
  type MemberRewardRow,
  type RewardType,
  type VisitSessionRow,
  type VipBenefitRow,
} from '../lib/member/member.ts'

// ── 测试辅助 ────────────────────────────────────────────────────────────────

function session(startedAt: string, opts: Partial<VisitSessionRow> = {}): VisitSessionRow {
  return {
    session_id:      `T-${startedAt}`,
    member_id:       'member-1',
    started_at:      startedAt,
    is_settled:      true,
    reward_eligible: true,
    ...opts,
  }
}

let rewardSeq = 0
function reward(type: RewardType, opts: Partial<MemberRewardRow> = {}): MemberRewardRow {
  rewardSeq += 1
  return {
    reward_id:   `reward-${String(rewardSeq).padStart(3, '0')}`,
    member_id:   'member-1',
    reward_type: type,
    cycle_index: 1,
    unlocked_at: '2026-09-01T10:00:00Z',
    coupon_id:   type === 'TWO_POUND' || type === 'FIVE_POUND' ? `coupon-${rewardSeq}` : null,
    used_at:     null,
    ...opts,
  }
}

// ── 身份 ────────────────────────────────────────────────────────────────────

test('email_key 规范化：去首尾空格 + 转小写', () => {
  assert.equal(normalizeMemberEmail('  Wei@Example.COM '), 'wei@example.com')
  assert.equal(normalizeMemberEmail(null), '')
  assert.equal(normalizeMemberEmail(123), '')
})

test('重复邮箱的大小写与空格差异被识别成同一个人', () => {
  assert.equal(normalizeMemberEmail('Wei@Gmail.com'), normalizeMemberEmail('wei@gmail.com '))
})

test('邮箱形状校验与数据库 CHECK 同口径', () => {
  assert.equal(isValidMemberEmail('wei@gmail.com'), true)
  assert.equal(isValidMemberEmail('wei@sub.domain.co.uk'), true)
  assert.equal(isValidMemberEmail('wei@gmail'), false)
  assert.equal(isValidMemberEmail('@gmail.com'), false)
  assert.equal(isValidMemberEmail('wei.com'), false)
  assert.equal(isValidMemberEmail('wei@gmail.'), false)
  assert.equal(isValidMemberEmail('wei @gmail.com'), false)
})

test('脱敏邮箱只露出首字母与域名', () => {
  assert.equal(maskEmail('zhangwei@gmail.com'), 'z***@gmail.com')
  assert.equal(maskEmail('not-an-email'), '***')
})

// ── 伦敦自然日 ──────────────────────────────────────────────────────────────

test('Visit 归日用伦敦当地日期，跨午夜算到店那天', () => {
  // 伦敦夏令时 BST = UTC+1
  assert.equal(londonDateOf('2026-09-15T23:30:00Z'), '2026-09-16')
  assert.equal(londonDateOf('2026-09-16T00:30:00Z'), '2026-09-16')
  // 冬季 GMT = UTC
  assert.equal(londonDateOf('2026-01-15T23:30:00Z'), '2026-01-15')
  assert.equal(londonDateOf('2026-01-15T00:30:00Z'), '2026-01-15')
})

test('同一天的多条已结算单只算一个访日', () => {
  const visits = buildVisitDays([
    session('2026-09-15T09:00:00Z'),
    session('2026-09-15T15:00:00Z', { session_id: 'T-2' }),
    session('2026-09-16T09:00:00Z', { session_id: 'T-3' }),
  ])
  assert.deepEqual(visits.map(v => v.visit_date), ['2026-09-15', '2026-09-16'])
  assert.equal(countLifetimeVisits(visits), 2)
  assert.equal(countRewardProgress(visits), 2)
})

test('散客单与未结算单都不计入', () => {
  const visits = buildVisitDays([
    session('2026-09-15T09:00:00Z', { member_id: null }),
    session('2026-09-16T09:00:00Z', { is_settled: false }),
    session('2026-09-17T09:00:00Z', { reward_eligible: null }),
  ])
  assert.deepEqual(visits.map(v => v.visit_date), ['2026-09-17'])
  assert.equal(countLifetimeVisits(visits), 1)
  assert.equal(countRewardProgress(visits), 0)
})

test('VIP 期间 Lifetime 加、Reward Progress 不加，两个数因此会不同', () => {
  const visits = buildVisitDays([
    session('2026-09-10T12:00:00Z', { reward_eligible: true }),
    session('2026-09-11T12:00:00Z', { reward_eligible: false }),
    session('2026-09-12T12:00:00Z', { reward_eligible: false }),
  ])
  assert.equal(countLifetimeVisits(visits), 3)
  assert.equal(countRewardProgress(visits), 1)
})

test('VIP 激活当天：激活前完成的那条进度不回退', () => {
  // 同一天两条单，一条在激活前（eligible），一条在激活后（不 eligible）
  const visits = buildVisitDays([
    session('2026-09-18T09:00:00Z', { reward_eligible: true }),
    session('2026-09-18T18:00:00Z', { reward_eligible: false, session_id: 'T-2' }),
  ])
  assert.equal(countLifetimeVisits(visits), 1)
  assert.equal(countRewardProgress(visits), 1)
})

// ── 轮次与进度 ──────────────────────────────────────────────────────────────

test('档位门槛：第 2 轮落在 12 / 15 / 18 / 20', () => {
  assert.equal(rewardThreshold(1, 2), 2)
  assert.equal(rewardThreshold(1, 10), 10)
  assert.equal(rewardThreshold(2, 2), 12)
  assert.equal(rewardThreshold(2, 5), 15)
  assert.equal(rewardThreshold(2, 8), 18)
  assert.equal(rewardThreshold(2, 10), 20)
  assert.equal(rewardThreshold(3, 2), 22)
})

test('解锁集合随进度增长，第 8 档一次发两张', () => {
  assert.deepEqual(unlockedRewardsForProgress(0), [])
  assert.deepEqual(
    unlockedRewardsForProgress(2).map(r => [r.cycle_index, r.reward_type]),
    [[1, 'TWO_POUND']],
  )
  assert.deepEqual(
    unlockedRewardsForProgress(7).map(r => r.reward_type),
    ['TWO_POUND', 'FIVE_POUND'],
  )
  assert.deepEqual(
    unlockedRewardsForProgress(8).map(r => r.reward_type),
    ['TWO_POUND', 'FIVE_POUND', 'PERSONAL_15_OFF', 'FRIEND_10_OFF'],
  )
  assert.deepEqual(
    unlockedRewardsForProgress(10).map(r => r.reward_type),
    ['TWO_POUND', 'FIVE_POUND', 'PERSONAL_15_OFF', 'FRIEND_10_OFF', 'VIP_MONTH'],
  )
})

test('第 2 轮的四个节点按 12 / 15 / 18 / 20 解锁', () => {
  const at12 = unlockedRewardsForProgress(12)
  assert.deepEqual(at12.slice(-1).map(r => [r.cycle_index, r.reward_type]), [[2, 'TWO_POUND']])
  const at20 = unlockedRewardsForProgress(20)
  assert.deepEqual(
    at20.filter(r => r.cycle_index === 2).map(r => [r.threshold, r.reward_type]),
    [[12, 'TWO_POUND'], [15, 'FIVE_POUND'], [18, 'PERSONAL_15_OFF'], [18, 'FRIEND_10_OFF'], [20, 'VIP_MONTH']],
  )
  assert.equal(at20.length, 10)
})

test('解锁数量单调不减，且同一档位只出现一次', () => {
  let previous = 0
  for (let progress = 0; progress <= 40; progress++) {
    const unlocked = unlockedRewardsForProgress(progress)
    assert.ok(unlocked.length >= previous, `progress ${progress} 解锁数倒退了`)
    previous = unlocked.length
    const keys = unlocked.map(r => `${r.cycle_index}:${r.reward_type}`)
    assert.equal(new Set(keys).size, keys.length, `progress ${progress} 出现重复档位`)
  }
})

test('下一个奖励与还差几次（PRD 7.1 的例子：6 / 10，还差 2 次）', () => {
  assert.deepEqual(nextReward(6), { cycle_index: 1, node: 8, threshold: 8, remaining: 2, rewardTypes: ['PERSONAL_15_OFF', 'FRIEND_10_OFF'] })
  assert.deepEqual(nextReward(0), { cycle_index: 1, node: 2, threshold: 2, remaining: 2, rewardTypes: ['TWO_POUND'] })
  assert.deepEqual(nextReward(10), { cycle_index: 2, node: 2, threshold: 12, remaining: 2, rewardTypes: ['TWO_POUND'] })
  assert.deepEqual(nextReward(21), { cycle_index: 3, node: 2, threshold: 22, remaining: 1, rewardTypes: ['TWO_POUND'] })
})

test('十格循环显示：内部总进度不清零', () => {
  assert.equal(cycleProgress(0), 0)
  assert.equal(cycleProgress(6), 6)
  assert.equal(cycleProgress(10), 10)
  assert.equal(cycleProgress(11), 1)
  assert.equal(cycleProgress(20), 10)
  assert.equal(cycleProgress(23), 3)
})

test('进度条格子：2 / 5 / 8 / 10 是奖励节点', () => {
  const cells = progressBarCells(6)
  assert.equal(cells.length, REWARD_CYCLE_SIZE)
  assert.deepEqual(cells.filter(c => c.isRewardNode).map(c => c.index), [2, 5, 8, 10])
  assert.deepEqual(cells.filter(c => c.state === 'done').map(c => c.index), [1, 2, 3, 4, 5, 6])
  assert.equal(cells[6].state, 'current')
  const roundTwo = progressBarCells(13)
  assert.equal(roundTwo[0].threshold, 11)
  assert.deepEqual(roundTwo.filter(c => c.state === 'done').map(c => c.index), [1, 2, 3])
})

test('奖励节点表就是 PRD 第 7 节那张表', () => {
  assert.deepEqual(
    CYCLE_REWARD_NODES.map(n => [n.node, n.rewardTypes]),
    [[2, ['TWO_POUND']], [5, ['FIVE_POUND']], [8, ['PERSONAL_15_OFF', 'FRIEND_10_OFF']], [10, ['VIP_MONTH']]],
  )
})

// ── 奖励可用性 ──────────────────────────────────────────────────────────────

test('奖励状态：已用 > 已转赠 > VIP 期间暂停 > 可用', () => {
  assert.equal(rewardState(reward('TWO_POUND', { used_at: '2026-09-20T10:00:00Z' }), false), 'used')
  assert.equal(rewardState(reward('FRIEND_10_OFF', { coupon_id: 'coupon-x' }), false), 'transferred')
  assert.equal(rewardState(reward('PERSONAL_15_OFF'), true), 'paused_by_vip')
  assert.equal(rewardState(reward('PERSONAL_15_OFF'), false), 'available')
})

test('VIP 期间其他奖励继续显示，只是标成不可用', () => {
  const list = rewardAvailabilityList([reward('TWO_POUND'), reward('PERSONAL_15_OFF')], true)
  assert.equal(list.length, 2)
  assert.deepEqual(list.map(r => r.state), ['paused_by_vip', 'paused_by_vip'])
})

test('同类多张时挑最早解锁的那张，与 SQL 的排序一致', () => {
  const older = reward('TWO_POUND', { reward_id: 'reward-a', unlocked_at: '2026-09-01T10:00:00Z' })
  const newer = reward('TWO_POUND', { reward_id: 'reward-b', unlocked_at: '2026-09-05T10:00:00Z' })
  assert.equal(pickRewardForUse([newer, older], 'TWO_POUND', false)?.reward_id, 'reward-a')
})

test('挑券时跳过已用、已转赠与 VIP 暂停的', () => {
  const used = reward('TWO_POUND', { reward_id: 'reward-a', used_at: '2026-09-20T10:00:00Z' })
  const ok = reward('TWO_POUND', { reward_id: 'reward-b' })
  assert.equal(pickRewardForUse([used, ok], 'TWO_POUND', false)?.reward_id, 'reward-b')
  assert.equal(pickRewardForUse([ok], 'TWO_POUND', true), null)

  const transferred = reward('FRIEND_10_OFF', { reward_id: 'reward-c', coupon_id: 'coupon-x' })
  assert.equal(pickRewardForUse([transferred], 'FRIEND_10_OFF', false), null)
})

test('结算台可选奖励去重后按类型给出', () => {
  const rewards = [
    reward('TWO_POUND', { reward_id: 'reward-a' }),
    reward('TWO_POUND', { reward_id: 'reward-b', cycle_index: 2 }),
    reward('PERSONAL_15_OFF', { reward_id: 'reward-c' }),
    reward('VIP_MONTH', { reward_id: 'reward-d' }),
  ]
  assert.deepEqual(usableRewardTypes(rewards, false), ['TWO_POUND', 'PERSONAL_15_OFF'])
  assert.deepEqual(usableRewardTypes(rewards, true), [])
})

// ── VIP Month ───────────────────────────────────────────────────────────────

test('VIP 有效期 30 天含首尾：9 月 18 日激活，10 月 17 日整天仍有效', () => {
  assert.equal(VIP_MONTH_DAYS, 30)
  assert.equal(vipExpiresOn('2026-09-18'), '2026-10-17')
  const benefit: VipBenefitRow = {
    benefit_id: 'benefit-1', reward_id: 'reward-1',
    activated_on: '2026-09-18', expires_on: '2026-10-17',
  }
  assert.equal(isVipBenefitActiveOn(benefit, '2026-09-17'), false)
  assert.equal(isVipBenefitActiveOn(benefit, '2026-09-18'), true)
  assert.equal(isVipBenefitActiveOn(benefit, '2026-10-17'), true)
  assert.equal(isVipBenefitActiveOn(benefit, '2026-10-18'), false)
})

test('跨月与跨年的有效期推算', () => {
  assert.equal(vipExpiresOn('2026-10-17'), '2026-11-15')
  assert.equal(vipExpiresOn('2026-12-20'), '2027-01-18')
  assert.equal(vipExpiresOn('2028-02-01'), '2028-03-01')
})

test('未激活的 VIP Month 不生效', () => {
  const notActivated: VipBenefitRow = {
    benefit_id: 'benefit-2', reward_id: 'reward-2', activated_on: null, expires_on: null,
  }
  assert.equal(isVipBenefitActiveOn(notActivated, '2026-09-18'), false)
  assert.equal(isVipActive([notActivated], '2026-09-18'), false)
})

test('可以累计多张未激活的 VIP Month，同一时间只有一张生效', () => {
  const rewards = [
    reward('VIP_MONTH', { reward_id: 'reward-v1', cycle_index: 1 }),
    reward('VIP_MONTH', { reward_id: 'reward-v2', cycle_index: 2 }),
  ]
  const benefits: VipBenefitRow[] = [
    { benefit_id: 'b1', reward_id: 'reward-v1', activated_on: '2026-09-18', expires_on: '2026-10-17' },
    { benefit_id: 'b2', reward_id: 'reward-v2', activated_on: null, expires_on: null },
  ]
  const summary = vipMonthSummary(rewards, benefits, '2026-09-20')
  assert.equal(summary.active?.benefit_id, 'b1')
  assert.equal(summary.readyToActivate, 1)
  assert.equal(summary.activated, 1)
  assert.deepEqual(canActivateVip(benefits, '2026-09-20'), { ok: false, error: 'VIP_ALREADY_ACTIVE' })

  // 到期之后不会自动续上，需要再手动激活
  assert.deepEqual(canActivateVip(benefits, '2026-10-18'), { ok: true })
  assert.equal(vipMonthSummary(rewards, benefits, '2026-10-18').active, null)
})

// ── 折扣计算 ────────────────────────────────────────────────────────────────

test('£2 / £5 Voucher 抵扣金额与封顶', () => {
  const two = computeMemberDiscount('member_reward', { amountGbp: 13.99, vipActive: false, rewardType: 'TWO_POUND' })
  assert.equal(two.ok && two.preview.discountAmountPence, TWO_POUND_PENCE)
  assert.equal(two.ok && two.preview.finalGbp, 11.99)

  const five = computeMemberDiscount('member_reward', { amountGbp: 3.5, vipActive: false, rewardType: 'FIVE_POUND' })
  assert.equal(five.ok && five.preview.discountAmountPence, 350)
  assert.equal(five.ok && five.preview.finalGbp, 0)
  assert.ok(five.ok && five.preview.discountAmountPence <= FIVE_POUND_PENCE)
})

test('本人 15% 与朋友 10% 按分四舍五入', () => {
  const personal = computeMemberDiscount('member_reward', { amountGbp: 13.99, vipActive: false, rewardType: 'PERSONAL_15_OFF' })
  assert.equal(personal.ok && personal.preview.discountAmountPence, 210)
  assert.equal(personal.ok && personal.preview.discountValue, PERSONAL_DISCOUNT_PERCENT)

  const friend = computeMemberDiscount('member_reward', { amountGbp: 13.99, vipActive: false, rewardType: 'FRIEND_10_OFF' })
  assert.equal(friend.ok && friend.preview.discountAmountPence, 140)

  assert.equal(percentOffPence(1399, 15), 210)
  assert.equal(percentOffPence(1399, 10), 140)
  assert.equal(percentOffPence(100, 15), 15)
})

test('折扣金额跟着仓库真实定价走', () => {
  const bill = calcBill(150)
  const vip = computeMemberDiscount('vip_month', { amountGbp: bill.totalGbp, vipActive: true })
  assert.equal(vip.ok, true)
  if (!vip.ok) return
  assert.equal(vip.preview.discountAmountPence, Math.round(bill.totalGbp * 100 * 15 / 100))
  assert.equal(vip.preview.preDiscountGbp, bill.totalGbp)
})

test('不打折时金额原样返回', () => {
  const none = computeMemberDiscount('none', { amountGbp: 25.99, vipActive: false })
  assert.equal(none.ok && none.preview.discountAmountPence, 0)
  assert.equal(none.ok && none.preview.finalGbp, 25.99)
})

test('VIP 生效期间强制走 VIP，其他会员奖励一律拒绝', () => {
  const blocked = computeMemberDiscount('member_reward', { amountGbp: 13.99, vipActive: true, rewardType: 'TWO_POUND' })
  assert.deepEqual(blocked, { ok: false, error: 'VIP_MUST_BE_APPLIED' })
  const notVip = computeMemberDiscount('vip_month', { amountGbp: 13.99, vipActive: false })
  assert.deepEqual(notVip, { ok: false, error: 'VIP_NOT_ACTIVE' })
})

test('会员奖励的入参校验', () => {
  assert.deepEqual(
    computeMemberDiscount('member_reward', { amountGbp: 13.99, vipActive: false }),
    { ok: false, error: 'REWARD_TYPE_INVALID' },
  )
  assert.deepEqual(
    computeMemberDiscount('member_reward', { amountGbp: 13.99, vipActive: false, rewardType: 'VIP_MONTH' }),
    { ok: false, error: 'REWARD_TYPE_INVALID' },
  )
  assert.deepEqual(
    computeMemberDiscount('none', { amountGbp: null, vipActive: false }),
    { ok: false, error: 'SESSION_AMOUNT_MISSING' },
  )
  assert.deepEqual(
    computeMemberDiscount('coupon', { amountGbp: 13.99, vipActive: false }),
    { ok: false, error: 'COUPON_SOURCE_NOT_HANDLED' },
  )
  assert.deepEqual(
    computeMemberDiscount('bogus' as never, { amountGbp: 13.99, vipActive: false }),
    { ok: false, error: 'DISCOUNT_SOURCE_INVALID' },
  )
})
