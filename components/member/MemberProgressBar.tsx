'use client'

// 会员进度条（PRD 7.1）：十格循环显示，2 / 5 / 8 / 10 是奖励节点。
// 顾客端不出现「第几轮」这类概念，只显示本轮的第几格。

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
    rewards: {
      TWO_POUND:       '£2',
      FIVE_POUND:      '£5',
      PERSONAL_15_OFF: '🎁',
      FRIEND_10_OFF:   '🎁',
      VIP_MONTH:       'VIP',
    } as Record<RewardType, string>,
  },
  en: {
    visits:        (done: number, total: number) => `${done} / ${total} visits`,
    lifetime:      (n: number) => `Lifetime visits: ${n}`,
    toNext:        (n: number) => `${n} more ${n === 1 ? 'visit' : 'visits'} to your next reward`,
    nextIs:        'Next reward',
    roundDone:     'This round is complete — the next visit starts a new round',
    rewards: {
      TWO_POUND:       '£2',
      FIVE_POUND:      '£5',
      PERSONAL_15_OFF: '🎁',
      FRIEND_10_OFF:   '🎁',
      VIP_MONTH:       'VIP',
    } as Record<RewardType, string>,
  },
} as const

interface Props {
  cells:          ProgressCell[]
  cycleProgress:  number
  nextReward:     NextReward | null
  lifetimeVisits: number
  lang:           Lang
}

export default function MemberProgressBar({ cells, cycleProgress, nextReward, lifetimeVisits, lang }: Props) {
  const c = copy[lang]

  return (
    <div className="rounded-3xl border border-sand-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-semibold text-charcoal">{c.visits(cycleProgress, cells.length)}</p>

      <div className="mt-4 flex items-center gap-1">
        {cells.map((cell, index) => (
          <div key={cell.index} className="flex flex-1 items-center">
            <div className="flex flex-1 flex-col items-center gap-1">
              <span
                aria-hidden
                className={
                  cell.state === 'done'
                    ? 'flex h-6 w-6 items-center justify-center rounded-full bg-terracotta text-white'
                    : cell.state === 'current'
                      ? 'flex h-6 w-6 items-center justify-center rounded-full border-2 border-terracotta bg-white'
                      : 'flex h-6 w-6 items-center justify-center rounded-full border border-sand-200 bg-white'
                }
              >
                {cell.isRewardNode
                  ? <Star size={12} className={cell.state === 'done' ? 'text-white' : 'text-terracotta'} />
                  : <span className={`h-1.5 w-1.5 rounded-full ${cell.state === 'done' ? 'bg-white' : 'bg-sand-200'}`} />}
              </span>
              <span className="h-4 text-[10px] leading-4 text-charcoal-light">
                {cell.isRewardNode ? cell.rewardTypes.map(rt => c.rewards[rt]).filter((v, i, a) => a.indexOf(v) === i).join('/') : ''}
              </span>
            </div>
            {index < cells.length - 1 && (
              <span aria-hidden className={`-mt-5 h-0.5 flex-1 ${cell.state === 'done' ? 'bg-terracotta' : 'bg-sand-200'}`} />
            )}
          </div>
        ))}
      </div>

      <p className="mt-3 text-sm text-charcoal">
        {nextReward ? c.toNext(nextReward.remaining) : c.roundDone}
        {nextReward && <span className="ml-1 text-charcoal-light">({c.nextIs}: {nextReward.rewardTypes.map(rt => c.rewards[rt]).filter((v, i, a) => a.indexOf(v) === i).join('/')})</span>}
      </p>
      <p className="mt-1 text-xs text-charcoal-light">{c.lifetime(lifetimeVisits)}</p>
    </div>
  )
}
