'use client'

// 后台会员列表（PRD 16.1）：按姓名或邮箱搜索，点进去看详情与操作。

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, Users } from 'lucide-react'
import Sidebar from '@/components/admin/Sidebar'

interface MemberListItem {
  member_id:       string
  email:           string
  display_name:    string | null
  joined_at:       string
  is_active:       boolean
  lifetime_visits: number
  reward_progress: number
}

export default function MembersPage() {
  const router = useRouter()
  const [members, setMembers] = useState<MemberListItem[]>([])
  const [search, setSearch]   = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')

  async function load(q = '') {
    setLoading(true)
    setError('')
    try {
      const res  = await fetch(`/api/admin/members?search=${encodeURIComponent(q)}`)
      const data = await res.json() as MemberListItem[] | { error?: string }
      if (!res.ok) { setError((data as { error?: string }).error ?? '读取失败'); setMembers([]); return }
      setMembers(data as MemberListItem[])
    } catch {
      setError('网络错误，请重试')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-screen bg-stone-50">
      <Sidebar active="/dashboard/members" />
      <div className="md:ml-56 pt-14 md:pt-0">
        <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold text-stone-800 flex items-center gap-2">
              <Users size={18} /> Tangdouren Club 会员
            </h1>
            <span className="text-xs text-stone-400">共 {members.length} 位</span>
          </div>

          <div className="bg-white rounded-2xl border border-stone-100 shadow-sm px-5 py-4">
            <div className="flex gap-2">
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && load(search)}
                placeholder="按姓名或邮箱搜索"
                className="flex-1 border border-stone-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta/30"
              />
              <button
                onClick={() => load(search)}
                className="px-4 py-2 bg-terracotta text-white rounded-xl text-sm font-medium hover:bg-terracotta/90 transition flex items-center gap-1.5"
              >
                <Search size={14} /> 搜索
              </button>
            </div>
            <p className="text-xs text-stone-400 mt-2">
              * 会员进度由真实结算记录派生，后台不能手动加减次数或补发奖励。
            </p>
          </div>

          {error && <p className="text-sm text-red-500 bg-red-50 border border-red-100 rounded-xl px-4 py-3">{error}</p>}

          {loading ? (
            <div className="text-center py-12 text-stone-400">加载中…</div>
          ) : members.length === 0 ? (
            <div className="text-center py-12 text-stone-400">
              <p className="text-3xl mb-2">👥</p>
              <p>{search ? '没有匹配的会员' : '还没有会员'}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {members.map(m => (
                <button
                  key={m.member_id}
                  onClick={() => router.push(`/dashboard/members/${m.member_id}`)}
                  className="w-full flex items-center justify-between bg-white rounded-2xl border border-stone-100 px-4 py-3 text-left hover:border-terracotta/30 hover:shadow-sm transition"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-medium text-stone-800 text-sm truncate">{m.display_name ?? '（未填姓名）'}</span>
                      {!m.is_active && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-stone-100 text-stone-500 font-medium shrink-0">已停用</span>
                      )}
                    </div>
                    <p className="text-xs text-stone-400 truncate">{m.email}</p>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <p className="text-xs text-stone-500">累计到店 <span className="font-semibold text-stone-700">{m.lifetime_visits}</span> 次</p>
                    <p className="text-xs text-stone-400">计入进度 {m.reward_progress} 次</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
