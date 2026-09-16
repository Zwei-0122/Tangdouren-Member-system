// ============================================================
// 浏览器端记住会员身份（PRD 4.3）
// 只用于少打一次邮箱，**不是会员资格凭证**：每次进会员页都由服务端重新查
// Member 状态、Visits、Rewards 与 VIP Month。所以这里只存识别信息，不存任何权益数据。
// ============================================================

export interface RememberedMember {
  member_id:    string
  display_name: string | null
  email:        string
}

const MEMBER_LS_KEY = 'tangdouren_club_member'

export function readRememberedMember(): RememberedMember | null {
  try {
    const raw = localStorage.getItem(MEMBER_LS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<RememberedMember>
    if (!parsed?.email || !parsed?.member_id) return null
    return {
      member_id:    parsed.member_id,
      display_name: parsed.display_name ?? null,
      email:        parsed.email,
    }
  } catch {
    return null
  }
}

export function rememberMember(member: RememberedMember): void {
  try { localStorage.setItem(MEMBER_LS_KEY, JSON.stringify(member)) } catch {}
}

export function forgetMember(): void {
  try { localStorage.removeItem(MEMBER_LS_KEY) } catch {}
}
