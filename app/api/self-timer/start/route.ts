import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { startSelfTimer } from '@/lib/timer/selfService'

const StartSchema = z.object({
  tableNumber: z.string().min(1).max(10),
  seatNumber: z.string().min(1).max(10),
  customerName: z.string().min(1).max(50),
  confirmNoMixedBeans: z.boolean(),
  idempotencyKey: z.string().min(8).max(120).optional(),
  // 允许留空：空字符串等于「不以会员身份开始」，不能因此阻断普通计时
  memberEmail: z.string().max(100).optional()
    .transform(v => (v && v.trim() ? v.trim() : undefined))
    .refine(v => v === undefined || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), '邮箱格式不正确'),
})

function messageForError(error: unknown): { message: string; status: number } {
  const code = error instanceof Error ? error.message : ''
  const map: Record<string, { message: string; status: number }> = {
    CONFIRMATION_REQUIRED: { message: '请先确认撒豆、混豆提醒', status: 400 },
    INVALID_SEAT: { message: '请选择有效座位号', status: 400 },
    INVALID_NAME: { message: '请填写顾客姓名', status: 400 },
  }
  return map[code] ?? { message: '开始计时失败，请联系店员', status: 500 }
}

export async function POST(request: NextRequest) {
  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 })
  }

  const parsed = StartSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? '参数有误' }, { status: 400 })
  }

  try {
    const result = await startSelfTimer(createAdminClient(), parsed.data)
    return NextResponse.json(result, { status: result.restored ? 200 : 201 })
  } catch (error) {
    const { message, status } = messageForError(error)
    return NextResponse.json({ error: message }, { status })
  }
}
