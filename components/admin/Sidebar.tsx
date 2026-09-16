'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { LayoutDashboard, CalendarDays, Settings2, ImageIcon, Menu, X, LogOut, Timer, TicketPercent } from 'lucide-react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'

const navItems = [
  { href: '/dashboard',          icon: LayoutDashboard, label: '概览' },
  { href: '/dashboard/bookings', icon: CalendarDays,    label: '预约管理' },
  { href: '/dashboard/timers',   icon: Timer,           label: '拼豆计时' },
  { href: '/dashboard/slots',    icon: Settings2,       label: 'Slot 配置' },
  { href: '/dashboard/gallery',  icon: ImageIcon,       label: '作品图库' },
  { href: '/dashboard/coupons',  icon: TicketPercent,   label: '优惠券' },
]

export default function Sidebar({ active }: { active: string }) {
  const [open, setOpen] = useState(false)
  const router   = useRouter()
  const supabase = createClient()

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const NavContent = () => (
    <>
        <div className="px-4 py-5 border-b border-white/10">
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="logo" className="w-7 h-7 rounded-lg object-cover shrink-0" />
            <span className="font-display text-base font-semibold text-white">糖豆人手工工作室</span>
          </div>
          <p className="text-xs text-white/40 mt-0.5">后台管理系统</p>
        </div>

      <nav className="flex-1 p-3 space-y-1">
        {navItems.map(({ href, icon: Icon, label }) => (
          <Link
            key={href}
            href={href}
            onClick={() => setOpen(false)}
            className={cn(
              'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all',
              active === href
                ? 'bg-terracotta text-white shadow-sm'
                : 'text-white/60 hover:bg-white/10 hover:text-white'
            )}
          >
            <Icon size={16} />
            {label}
          </Link>
        ))}
      </nav>

      <div className="p-3 border-t border-white/10">
        <button onClick={handleLogout} className="flex items-center gap-3 w-full rounded-xl px-3 py-2.5 text-sm text-white/50 hover:bg-white/10 hover:text-white transition-all">
          <LogOut size={16} />
          退出登录
        </button>
      </div>
    </>
  )

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-56 bg-charcoal min-h-screen fixed left-0 top-0 z-40">
        <NavContent />
      </aside>

      {/* Mobile header */}
      <div className="md:hidden fixed top-0 inset-x-0 z-40 bg-charcoal flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="logo" className="w-6 h-6 rounded-md object-cover shrink-0" />
            <span className="font-display text-sm font-semibold text-white">拼豆工作室后台</span>
          </div>
        <button onClick={() => setOpen(!open)} className="text-white/70 hover:text-white">
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Mobile drawer */}
      {open && (
        <div className="md:hidden fixed inset-0 z-50 bg-black/50" onClick={() => setOpen(false)}>
          <aside className="absolute left-0 top-0 bottom-0 w-56 bg-charcoal flex flex-col" onClick={e => e.stopPropagation()}>
            <NavContent />
          </aside>
        </div>
      )}
    </>
  )
}
