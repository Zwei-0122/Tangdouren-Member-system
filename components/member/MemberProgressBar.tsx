'use client'

// 会员进度条（PRD 7.1）：十格循环显示，2 / 5 / 8 / 10 是奖励节点。
// 顾客端不出现「第几轮」这类概念，只显示本轮的第几格。
// 奖励说明：每个奖励节点都带 title（电脑上鼠标悬停可见）；
// expandable = true 时再支持「点一下展开」（顾客端多是手机，没有悬停这回事）。

import { useState } from 'react'
import { Star } from 'lucide-react'
import type { Lang } from '@/lib/i18n/translations'
import type { NextReward, ProgressCell, RewardType } from '@/lib/member/member'

const copy = {
  zh: {
    visits:        (done: number, total: number) => `${done} / ${total} 次到店`,
    lifetime:      (n: number) => `累计到店 ${n} 次`,
    toNext:        (n: number) => `再 ${n} 次解锁下一个奖励`,
    nextIs:        '下一个奖励',
    roundDone:     '本轮已完成，下一格自动开始新一轮',
    atNode:        (n: number) => `第 ${n} 次`,
    rewards: {
      TWO_POUND:       '£2',
      FIVE_POUND:      '£5',
      PERSONAL_15_OFF: '🎁',
      FRIEND_10_OFF:   '🎁',
      VIP_MONTH:       '月卡',
    } as Record<RewardType, string>,
    hints: {
      TWO_POUND:       '£2 抵用券：下次到店结算时可抵扣 £2',
      FIVE_POUND:      '£5 抵用券：下次到店结算时可抵扣 £5',
      PERSONAL_15_OFF: '本人 85 折：下次消费可以自己用',
      FRIEND_10_OFF:   '朋友 9 折：可以给朋友用',
      VIP_MONTH:       'VIP 月卡：激活后 30 天内每次计时自动享受 85 折',
    } as Record<RewardType, string>,
  },
  en: {
    visits:        (done: number, total: number) => `${done} / ${total} visits`,
    lifetime:      (n: number) => `Lifetime visits: ${n}`,
    toNext:        (n: number) => `${n} more ${n === 1 ? 'visit' : 'visits'} to your next reward`,
    nextIs:        'Next reward',
    roundDone:     'This round is complete, the next visit starts a new round',
    atNode:        (n: number) => `Visit ${n}`,
    rewards: {
      TWO_POUND:       '£2',
      FIVE_POUND:      '£5',
      PERSONAL_15_OFF: '🎁',
      FRIEND_10_OFF:   '🎁',
      VIP_MONTH:       'VIP',
    } as Record<RewardType, string>,
    hints: {
      TWO_POUND:       '£2 voucher: £2 off at your next settlement',
      FIVE_POUND:      '£5 voucher: £5 off at your next settlement',
      PERSONAL_15_OFF: '15% off for you: use it on your next visit',
      FRIEND_10_OFF:   '10% off for a friend: pass it on',
      VIP_MONTH:       'VIP Month: 15% off every timer session for 30 days after you activate it',
    } as Record<RewardType, string>,
  },
} as const

interface Props {
  cells:          ProgressCell[]
  cycleProgress:  number
  nextReward:     NextReward | null
  lifetimeVisits: number
  lang:           Lang
  /** 顾客端传 true：奖励节点可以点一下展开说明（手机没有悬停） */
  expandable?:    boolean
}

export default function MemberProgressBar({ cells, cycleProgress, nextReward, lifetimeVisits, lang, expandable = false }: Props) {
  const c = copy[lang]
  const [openNode, setOpenNode] = useState<number | null>(null)

  /** 一个节点上可能挂着两种奖励（第 8 次是本人 85 折 + 朋友 9 折），说明合并显示 */
  const nodeHint = (types: readonly RewardType[]) =>
    types.map(rt => c.hints[rt]).filter((v, i, a) => a.indexOf(v) === i).join(' · ')

  const openCell = cells.find(cell => cell.index === openNode && cell.isRewardNode) ?? null

  return (
    <div className="rounded-3xl border border-sand-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-semibold text-charcoal">{c.visits(cycleProgress, cells.length)}</p>

      <div className="mt-4 flex items-center gap-1">
        {cells.map((cell, index) => {
          const hint = cell.isRewardNode ? nodeHint(cell.rewardTypes) : undefined
          const circle = cell.state === 'done'
            ? 'flex h-6 w-6 items-center justify-center rounded-full bg-terracotta text-white'
            : cell.state === 'current'
              ? 'flex h-6 w-6 items-center justify-center rounded-full border-2 border-terracotta bg-white'
              : 'flex h-6 w-6 items-center justify-center rounded-full border border-sand-200 bg-white'
          return (
            <div key={cell.index} className="flex flex-1 items-center">
              <div className="flex flex-1 flex-col items-center gap-1">
                {cell.isRewardNode && expandable ? (
                  <button
                    type="button"
                    title={hint}
                    aria-label={hint}
                    aria-expanded={openNode === cell.index}
                    onClick={() => setOpenNode(v => (v === cell.index ? null : cell.index))}
                    className={circle}
                  >
                    <Star size={12} className={cell.state === 'done' ? 'text-white' : 'text-terracotta'} />
                  </button>
                ) : (
                  <span aria-hidden title={hint} className={circle}>
                    {cell.isRewardNode
                      ? <Star size={12} className={cell.state === 'done' ? 'text-white' : 'text-terracotta'} />
                      : <span className={`h-1.5 w-1.5 rounded-full ${cell.state === 'done' ? 'bg-white' : 'bg-sand-200'}`} />}
                  </span>
                )}
                <span className="h-4 text-[10px] leading-4 text-charcoal-light">
                  {cell.isRewardNode ? cell.rewardTypes.map(rt => c.rewards[rt]).filter((v, i, a) => a.indexOf(v) === i).join('/') : ''}
                </span>
              </div>
              {index < cells.length - 1 && (
                <span aria-hidden className={`-mt-5 h-0.5 flex-1 ${cell.state === 'done' ? 'bg-terracotta' : 'bg-sand-200'}`} />
              )}
            </div>
          )
        })}
      </div>

      <p className="mt-3 text-sm text-charcoal">
        {nextReward ? c.toNext(nextReward.remaining) : c.roundDone}
        {nextReward && <span className="ml-1 text-charcoal-light">({c.nextIs}: {nextReward.rewardTypes.map(rt => c.rewards[rt]).filter((v, i, a) => a.indexOf(v) === i).join('/')})</span>}
      </p>
      <p className="mt-1 text-xs text-charcoal-light">{c.lifetime(lifetimeVisits)}</p>

      {expandable && openCell && (
        <p className="mt-3 rounded-2xl bg-sand-50 px-3 py-2 text-xs leading-5 text-charcoal">
          <span className="font-semibold">{c.atNode(openCell.index)}</span>
          <span className="mx-1 text-charcoal-light">·</span>
          {nodeHint(openCell.rewardTypes)}
        </p>
      )}
    </div>
  )
}
