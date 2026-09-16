import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { listMembers, mapMemberError } from '@/lib/member/service'

// ── GET /api/admin/members — 后台会员列表（PRD 16.1）─────────────────────────

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '未授权' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const search = searchParams.get('search')

  try {
    const admin   = createAdminClient()
    const members = await listMembers(admin, { search, limit: 100 })
    return NextResponse.json(members)
  } catch (err) {
    const code = err instanceof Error ? err.message : ''
    console.error('[GET /api/admin/members]', code)
    return NextResponse.json({ error: mapMemberError(code) }, { status: 500 })
  }
}
