'use client'

import { useState, useMemo, useEffect, useCallback } from 'react'
import {
  ChevronLeft, ChevronRight, Users, CheckCircle2,
  AlertCircle, BookOpen, Clock, X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AvailabilityResult } from '@/lib/booking/types'
import { BUSINESS_CONFIG, CLOSED_WEEKDAYS } from '@/lib/booking/config'
import { useLanguage } from '@/lib/i18n/LanguageContext'
import { t, pick } from '@/lib/i18n/translations'

// ── localStorage 待支付预约 ────────────────────────────────────────────────
const LS_KEY = 'tangdouren_pending_booking'

interface PendingBooking {
  bookingId:   string
  checkoutUrl: string
  displayText: string
  expiresAt:   number
}

function savePendingBooking(data: PendingBooking) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(data)) } catch {}
}
function loadPendingBooking(): PendingBooking | null {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return null
    const data: PendingBooking = JSON.parse(raw)
    if (Date.now() > data.expiresAt) { localStorage.removeItem(LS_KEY); return null }
    return data
  } catch { return null }
}
function clearPendingBooking() {
  try { localStorage.removeItem(LS_KEY) } catch {}
}

// ── 伦敦时间工具 ──────────────────────────────────────────────────────────────
const TZ = 'Europe/London'
function todayLondon()   { return new Intl.DateTimeFormat('sv-SE', { timeZone: TZ }).format(new Date()) }
function getLondonYM()   {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit' }).formatToParts(new Date())
  return { year: parseInt(p.find(x => x.type === 'year')!.value), month: parseInt(p.find(x => x.type === 'month')!.value) - 1 }
}
function pad(n: number)  { return String(n).padStart(2, '0') }
function dateKey(y: number, m: number, d: number) { return `${y}-${pad(m+1)}-${pad(d)}` }
function getDays(y: number, m: number)   { return new Date(y, m + 1, 0).getDate() }
function getFirstDay(y: number, m: number) { return new Date(y, m, 1).getDay() }

type Step = 'date' | 'party' | 'slots' | 'form' | 'done'

export default function BookingPage() {
  const { lang } = useLanguage()
  const p = (entry: { zh: string; en: string }) => pick(entry, lang)

  const today                = useMemo(() => todayLondon(), [])
  const { year: iy, month: im } = useMemo(() => getLondonYM(), [])

  const isTodayClosed = useMemo(() => {
    const [closeH, closeM] = BUSINESS_CONFIG.closeTime.split(':').map(Number)
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date())
    const nowH = parseInt(parts.find(pt => pt.type === 'hour')!.value)
    const nowM = parseInt(parts.find(pt => pt.type === 'minute')!.value)
    return nowH * 60 + nowM >= closeH * 60 + closeM
  }, [])

  const STEPS: { key: Step; label: string }[] = [
    { key: 'date',  label: p(t.stepDate) },
    { key: 'party', label: p(t.stepParty) },
    { key: 'slots', label: p(t.stepSlots) },
    { key: 'form',  label: p(t.stepForm) },
  ]

  const PARTY_OPTIONS = [
    { value: 1, label: p(t.party1Label), sub: p(t.party1Sub) },
    { value: 2, label: p(t.party2Label), sub: p(t.party2Sub) },
    { value: 3, label: p(t.party3Label), sub: p(t.party3Sub) },
  ]

  function stepIndex(s: Step) { return STEPS.findIndex(x => x.key === s) }

  const [step, setStep] = useState<Step>('date')
  const [year, setYear]           = useState(iy)
  const [month, setMonth]         = useState(im)
  const [selectedDate, setDate]   = useState<string | null>(null)
  const [blockedDates, setBlocked] = useState<string[]>([])
  const [loadingCal, setLoadingCal] = useState(false)
  const [partySize, setPartySize]         = useState<number>(1)
  const [acceptsSharing, setSharing]      = useState(false)
  const [pickedTime, setPickedTime] = useState<string | null>(null)
  const [availability, setAvailability]   = useState<AvailabilityResult[]>([])
  const [loadingSlots, setLoadingSlots]   = useState(false)
  const [slotsError, setSlotsError]       = useState('')
  const [selectedOption, setSelectedOption] = useState<{
    startTime: string; durationMinutes: number; displayTag: string
  } | null>(null)
  const [form, setForm]         = useState({ name: '', email: '', remark: '', joinClub: false })
  const [memberJoined, setMemberJoined] = useState(false)
  const [formErrors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [bookingResult, setBookingResult] = useState<{
    bookingId: string; assignedTableCode: string; endTime: string
  } | null>(null)
  const [redirecting, setRedirecting] = useState(false)
  const [pendingBooking, setPendingBooking] = useState<PendingBooking | null>(null)

  useEffect(() => { setPendingBooking(loadPendingBooking()) }, [])

  const fetchBlocked = useCallback(async (y: number, m: number) => {
    setLoadingCal(true)
    try {
      const res  = await fetch(`/api/blocked-dates?year=${y}&month=${m + 1}`)
      const data = await res.json()
      if (Array.isArray(data)) setBlocked(data.map((d: { date: string }) => d.date))
    } finally { setLoadingCal(false) }
  }, [])

  useEffect(() => { fetchBlocked(year, month) }, [year, month, fetchBlocked])

  const fetchAvailability = useCallback(async () => {
    if (!selectedDate) return
    setLoadingSlots(true)
    setSlotsError('')
    setPickedTime(null)
    setSelectedOption(null)
    try {
      const params = new URLSearchParams({
        date: selectedDate, partySize: String(partySize), acceptsSharing: String(acceptsSharing),
      })
      const res  = await fetch(`/api/availability?${params}`)
      const data = await res.json()
      setAvailability(data.results ?? [])
    } catch {
      setSlotsError(p(t.slotsLoadErr))
    } finally { setLoadingSlots(false) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, partySize, acceptsSharing])

  useEffect(() => {
    if (step === 'slots') fetchAvailability()
  }, [step, fetchAvailability])

  const isCurrentMonth = year === iy && month === im
  const maxDate = useMemo(() => {
    const d = new Date(today); d.setMonth(d.getMonth() + 1); return d.toISOString().slice(0, 10)
  }, [today])
  const maxYear  = useMemo(() => parseInt(maxDate.slice(0, 4)), [maxDate])
  const maxMonth = useMemo(() => parseInt(maxDate.slice(5, 7)) - 1, [maxDate])
  const isMaxMonth = year === maxYear && month === maxMonth

  function prevMonth() {
    if (isCurrentMonth) return
    if (month === 0) { setYear(y => y - 1); setMonth(11) } else setMonth(m => m - 1)
  }
  function nextMonth() {
    if (isMaxMonth) return
    if (month === 11) { setYear(y => y + 1); setMonth(0) } else setMonth(m => m + 1)
  }
  function isPast(day: number)    { return dateKey(year, month, day) < today }
  function isTooFar(day: number)  { return dateKey(year, month, day) > maxDate }
  function isBlocked(day: number) { return blockedDates.includes(dateKey(year, month, day)) }
  function isClosedToday(day: number) { return isTodayClosed && dateKey(year, month, day) === today }

  function fmtDuration(min: number) {
    const h = min / 60
    if (lang === 'en') return h === 1 ? `1${p(t.durationHour)}` : `${h}${p(t.durationHours)}`
    return `${h}${p(t.durationHour)}`
  }

  const allStartTimes = useMemo(() =>
    [...new Set(availability.map(r => r.startTime))].sort(),
  [availability])

  const timeOptions = useMemo(() => {
    if (!pickedTime) return []
    return availability.find(r => r.startTime === pickedTime)?.options ?? []
  }, [availability, pickedTime])

  function validate() {
    const e: Record<string, string> = {}
    if (!form.name.trim())  e.name  = p(t.step4NameErr)
    if (!form.email.trim()) {
      e.email = p(t.step4EmailErr)
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      e.email = p(t.step4EmailFmtErr)
    }
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate() || !selectedOption || !selectedDate) return
    setSubmitting(true)
    setSubmitError('')
    try {
      const bookingRes = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: selectedDate, partySize, acceptsSharing,
          startTime: selectedOption.startTime,
          durationMinutes: selectedOption.durationMinutes,
          customerName: form.name, email: form.email,
          remark: form.remark || undefined,
          joinClub: lang === 'zh' && form.joinClub,
          lang,
        }),
      })
      const bookingData = await bookingRes.json()
      if (!bookingRes.ok) { setSubmitError(bookingData.error ?? p(t.step4NetworkErr)); return }
      setMemberJoined(Boolean(bookingData.memberJoined))

      setBookingResult({
        bookingId: bookingData.bookingId,
        assignedTableCode: bookingData.assignedTableCode,
        endTime: bookingData.endTime,
      })

      if (bookingData.confirmed) {
        clearPendingBooking()
        setStep('done')
        return
      }

      const sessionRes = await fetch(`/api/bookings/${bookingData.bookingId}/checkout-session`, { method: 'POST' })
      const sessionData = await sessionRes.json()
      if (!sessionRes.ok) { setSubmitError(sessionData.error ?? p(t.step4NetworkErr)); return }

      savePendingBooking({
        bookingId: bookingData.bookingId,
        checkoutUrl: sessionData.checkoutUrl,
        displayText: `${selectedDate} ${selectedOption.startTime} · ${fmtDuration(selectedOption.durationMinutes)}`,
        expiresAt: Date.now() + 30 * 60 * 1000,
      })

      setRedirecting(true)
      window.location.href = sessionData.checkoutUrl
    } catch {
      setSubmitError(p(t.step4NetworkErr))
    } finally { setSubmitting(false) }
  }

  function resetAll() {
    setStep('date'); setDate(null); setPartySize(1); setSharing(false)
    setPickedTime(null); setAvailability([]); setSelectedOption(null)
    setForm({ name: '', email: '', remark: '', joinClub: false })
    setErrors({}); setSubmitError(''); setBookingResult(null)
  }

  const WEEKDAYS = t.weekdays[lang]
  const MONTHS   = t.months[lang]

  return (
    <div className="pt-16 min-h-screen bg-gradient-to-br from-cream via-warm-50 to-white">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-12">

        {/* ── 待支付横幅 ─────────────────────────────────────────────────── */}
        {pendingBooking && (
          <div className="mb-6 rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3 flex items-center gap-3">
            <Clock size={18} className="text-amber-500 shrink-0" />
            <div className="flex-1 text-sm">
              <span className="font-medium text-amber-800">{p(t.bookingPendingTitle)}</span>
              <span className="text-amber-700 ml-1">（{pendingBooking.displayText}）</span>
            </div>
            <button
              onClick={() => { window.location.href = pendingBooking.checkoutUrl }}
              className="shrink-0 rounded-xl bg-amber-500 text-white text-xs font-semibold px-3 py-1.5 hover:bg-amber-600 transition-colors"
            >
              {p(t.bookingPendingPay)}
            </button>
            <button
              onClick={() => { clearPendingBooking(); setPendingBooking(null) }}
              className="shrink-0 text-amber-400 hover:text-amber-600 transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* 页面标题 */}
        <div className="text-center mb-10">
          <span className="text-terracotta text-sm font-medium tracking-wider uppercase">{p(t.bookingPageLabel)}</span>
          <h1 className="font-display text-3xl sm:text-4xl font-bold text-charcoal mt-2">{p(t.bookingPageTitle)}</h1>
          <p className="text-charcoal-light mt-2 text-sm">
            {p(t.bookingHours)} {BUSINESS_CONFIG.openTime}–{BUSINESS_CONFIG.closeTime}{p(t.bookingHoursUnit)}
          </p>
        </div>

        {/* 进度条 */}
        {step !== 'done' && (
          <div className="flex items-center justify-center gap-1.5 mb-10">
            {STEPS.map((s, i) => {
              const done    = stepIndex(step) > i
              const current = step === s.key
              return (
                <div key={s.key} className="flex items-center gap-1.5">
                  <div className={cn(
                    'h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold transition-all',
                    current ? 'bg-terracotta text-white shadow-warm' :
                    done    ? 'bg-sage text-white' :
                              'bg-sand-200 text-charcoal-light'
                  )}>
                    {done ? '✓' : i + 1}
                  </div>
                  <span className={cn(
                    'text-xs hidden sm:inline',
                    current ? 'text-terracotta font-medium' :
                    done    ? 'text-sage-dark' : 'text-charcoal-light'
                  )}>{s.label}</span>
                  {i < STEPS.length - 1 && (
                    <div className={cn('h-px w-6 sm:w-10 transition-all', done ? 'bg-sage' : 'bg-sand-200')} />
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* ── STEP 1: 日期选择 ─────────────────────────────────────────────── */}
        {step === 'date' && (
          <div className="card p-6 sm:p-8 animate-fade-in">
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-display text-xl font-semibold text-charcoal">{p(t.bkStep1Title)}</h2>
              <span className="text-xs text-charcoal-light bg-warm-100 px-2 py-1 rounded-full">{p(t.step1TodayBadge)}</span>
            </div>
            <p className="text-xs text-charcoal-light mb-6">
              {p(t.step1Today)}{today}
              {loadingCal && <span className="ml-2 animate-pulse text-terracotta">{p(t.step1Loading)}</span>}
            </p>

            <div className="flex items-center justify-between mb-5">
              <button onClick={prevMonth} disabled={isCurrentMonth}
                className={cn('btn-ghost p-2', isCurrentMonth && 'opacity-30 cursor-not-allowed')}>
                <ChevronLeft size={18} />
              </button>
              <span className="font-display font-semibold text-charcoal">
                {lang === 'zh' ? `${year} 年 ${MONTHS[month]}` : `${MONTHS[month]} ${year}`}
              </span>
              <button onClick={nextMonth} disabled={isMaxMonth}
                className={cn('btn-ghost p-2', isMaxMonth && 'opacity-30 cursor-not-allowed')}>
                <ChevronRight size={18} />
              </button>
            </div>

            <div className="grid grid-cols-7 mb-2">
              {WEEKDAYS.map(d => (
                <div key={d} className="text-center text-xs font-medium text-charcoal-light py-1">{d}</div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: getFirstDay(year, month) }).map((_, i) => <div key={`e${i}`} />)}
              {Array.from({ length: getDays(year, month) }).map((_, i) => {
                const day     = i + 1
                const key     = dateKey(year, month, day)
                const past        = isPast(day)
                const tooFar      = isTooFar(day)
                const blocked     = isBlocked(day)
                const closedToday = isClosedToday(day)
                const isClosedWeekday = CLOSED_WEEKDAYS.includes(new Date(key).getDay())
                const sel         = selectedDate === key
                const isToday     = key === today
                const disabled    = past || tooFar || blocked || closedToday || isClosedWeekday
                const dimmed      = past || tooFar || blocked || closedToday || isClosedWeekday
                return (
                  <button key={day} disabled={disabled} onClick={() => setDate(key)}
                    className={cn(
                      'relative aspect-square rounded-xl text-sm font-medium transition-all duration-200',
                      sel    ? 'bg-terracotta text-white shadow-warm scale-105' :
                      dimmed ? 'text-charcoal-light/25 cursor-not-allowed' :
                               'bg-warm-100 text-charcoal hover:bg-sand-200 hover:scale-105'
                    )}
                  >
                    {day}
                    {isToday && !sel && !dimmed && (
                      <span className="absolute top-0.5 right-1 text-[8px] text-terracotta font-bold leading-none">{p(t.step1TodayMarker)}</span>
                    )}
                    {!sel && !dimmed && (
                      <span className="absolute bottom-1 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full bg-terracotta/50" />
                    )}
                  </button>
                )
              })}
            </div>

            <div className="flex flex-wrap gap-4 mt-5 text-xs text-charcoal-light">
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded bg-warm-100 border border-sand-200" />{p(t.step1LegendAvail)}</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded bg-terracotta" />{p(t.step1LegendSel)}</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded bg-warm-50 border border-sand-100 opacity-40" />{p(t.step1LegendDim)}</span>
            </div>

            <div className="mt-6 flex justify-end">
              <button disabled={!selectedDate} onClick={() => setStep('party')} className="btn-primary">
                {p(t.step1Next)} <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 2: 人数 + 拼桌 ──────────────────────────────────────────── */}
        {step === 'party' && (
          <div className="animate-fade-in">
            <button onClick={() => setStep('date')} className="btn-ghost mb-4 text-sm">
              <ChevronLeft size={14} /> {p(t.step2BackBtn)}
            </button>
            <div className="card p-6 sm:p-8">
              <h2 className="font-display text-xl font-semibold text-charcoal mb-1">{p(t.bkStep2Title)}</h2>
              <p className="text-sm text-charcoal-light mb-6">{selectedDate}</p>

              <div className="grid grid-cols-3 gap-3 mb-6">
                {PARTY_OPTIONS.map(opt => (
                  <button key={opt.value} onClick={() => { setPartySize(opt.value); if (opt.value === 3) setSharing(false) }}
                    className={cn(
                      'rounded-2xl border-2 p-4 text-center transition-all duration-200',
                      partySize === opt.value
                        ? 'border-terracotta bg-terracotta/5 shadow-warm'
                        : 'border-sand-200 hover:border-terracotta/40 hover:bg-warm-50'
                    )}
                  >
                    <Users className={cn('mx-auto mb-1.5', partySize === opt.value ? 'text-terracotta' : 'text-charcoal-light')} size={22} />
                    <div className="font-semibold text-charcoal text-sm">{opt.label}</div>
                    <div className="text-xs text-charcoal-light mt-0.5">{opt.sub}</div>
                  </button>
                ))}
              </div>

              {partySize !== 3 && (
                <div className={cn(
                  'rounded-2xl border-2 p-4 transition-all cursor-pointer',
                  acceptsSharing ? 'border-terracotta bg-terracotta/5' : 'border-sand-200 hover:border-terracotta/30'
                )}
                  onClick={() => setSharing(s => !s)}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium text-charcoal text-sm">{p(t.step2ShareTitle)}</div>
                      <div className="text-xs text-charcoal-light mt-0.5">
                        {partySize === 1 ? p(t.step2Share1Desc) : p(t.step2Share2Desc)}
                      </div>
                    </div>
                    <div className={cn(
                      'h-5 w-9 rounded-full transition-colors relative shrink-0 ml-3',
                      acceptsSharing ? 'bg-terracotta' : 'bg-sand-200'
                    )}>
                      <div className={cn(
                        'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform',
                        acceptsSharing ? 'translate-x-4' : 'translate-x-0.5'
                      )} />
                    </div>
                  </div>
                </div>
              )}

              <button
                onClick={() => window.open('/gallery', '_blank')}
                className="mt-4 w-full flex items-center justify-center gap-2 rounded-2xl border border-dashed border-sand-300 py-3 text-sm text-charcoal-light hover:border-terracotta/40 hover:text-terracotta transition-colors"
              >
                <BookOpen size={14} />
                {p(t.step2GalleryBtn)}
              </button>

              <div className="mt-6 flex justify-end">
                <button onClick={() => setStep('slots')} className="btn-primary">
                  {p(t.step2Next)} <ChevronRight size={16} />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── STEP 3: 可用时段 ─────────────────────────────────────────────── */}
        {step === 'slots' && (
          <div className="animate-fade-in">
            <button onClick={() => setStep('party')} className="btn-ghost mb-4 text-sm">
              <ChevronLeft size={14} /> {p(t.step3BackBtn)}
            </button>
            <div className="card p-6 sm:p-8">
              <div className="flex items-start justify-between mb-1">
                <h2 className="font-display text-xl font-semibold text-charcoal">{p(t.bkStep3Title)}</h2>
                <button onClick={fetchAvailability} className="text-xs text-charcoal-light hover:text-terracotta">{p(t.step3Refresh)}</button>
              </div>
              <p className="text-sm text-charcoal-light mb-6">
                {selectedDate} · {partySize === 3 ? p(t.partyPersons34) : partySize}{p(t.step3Persons)}
                {acceptsSharing && p(t.step3Sharing)}
              </p>

              {loadingSlots ? (
                <div className="py-10 text-center text-sm text-charcoal-light animate-pulse">{p(t.step3Loading)}</div>
              ) : slotsError ? (
                <div className="py-8 text-center text-sm text-red-500">{slotsError}</div>
              ) : allStartTimes.length === 0 ? (
                <div className="text-center py-10 text-charcoal-light">
                  <AlertCircle className="mx-auto mb-2 text-sand-300" size={32} />
                  <p className="text-sm">{p(t.step3Empty)}</p>
                  <p className="text-xs mt-1 text-charcoal-light/60">{p(t.step3EmptySub)}</p>
                </div>
              ) : (
                <>
                  <div className="mb-2">
                    <p className="text-xs font-medium text-charcoal-light mb-3 tracking-wide">{p(t.step3Phase1)}</p>
                    <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
                      {allStartTimes.map(st => {
                        const hasSharing = availability.find(r => r.startTime === st)?.options.some(o => o.isSharedOption)
                        return (
                          <button
                            key={st}
                            onClick={() => { setPickedTime(st); setSelectedOption(null) }}
                            className={cn(
                              'relative rounded-xl border-2 py-2.5 text-sm font-semibold text-center transition-all duration-200',
                              pickedTime === st
                                ? 'border-terracotta bg-terracotta text-white shadow-warm'
                                : 'border-sand-200 bg-warm-50 text-charcoal hover:border-terracotta/50 hover:bg-terracotta/5'
                            )}
                          >
                            {st}
                            {hasSharing && pickedTime !== st && (
                              <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-sage border border-white" />
                            )}
                          </button>
                        )
                      })}
                    </div>
                    {acceptsSharing && allStartTimes.some(st =>
                      availability.find(r => r.startTime === st)?.options.some(o => o.isSharedOption)
                    ) && (
                      <p className="mt-2 text-[11px] text-charcoal-light/60 flex items-center gap-1">
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-sage" />
                        {p(t.step3SharedDot)}
                      </p>
                    )}
                  </div>

                  {pickedTime && (
                    <div className="mt-5 pt-5 border-t border-sand-100">
                      <p className="text-xs font-medium text-charcoal-light mb-3 tracking-wide">
                        {p(t.step3Phase2Prefix)}{pickedTime}{p(t.step3Phase2Suffix)}
                      </p>
                      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                        {timeOptions.map(opt => {
                          const key = `${pickedTime}_${opt.durationMinutes}_${opt.isSharedOption}`
                          const sel = selectedOption?.startTime === pickedTime
                            && selectedOption.durationMinutes === opt.durationMinutes
                            && selectedOption.displayTag === opt.displayTag
                          return (
                            <button
                              key={key}
                              onClick={() => setSelectedOption(sel ? null : {
                                startTime: pickedTime,
                                durationMinutes: opt.durationMinutes,
                                displayTag: opt.displayTag,
                              })}
                              className={cn(
                                'rounded-2xl border-2 p-3 text-center transition-all duration-200',
                                sel
                                  ? 'border-terracotta bg-terracotta/5 shadow-warm scale-[1.02]'
                                  : opt.isSharedOption
                                    ? 'border-sage/50 bg-sage/5 hover:border-sage hover:bg-sage/10'
                                    : 'border-sand-200 bg-warm-50 hover:border-terracotta/40 hover:bg-terracotta/5'
                              )}
                            >
                              <div className={cn('text-base font-bold leading-tight', sel ? 'text-terracotta' : 'text-charcoal')}>
                                {fmtDuration(opt.durationMinutes)}
                              </div>
                              <div className={cn('text-[11px] mt-1 leading-snug',
                                sel ? 'text-terracotta/70' : opt.isSharedOption ? 'text-sage-dark' : 'text-charcoal-light'
                              )}>
                                {opt.displayTag}
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}

              {selectedOption && (
                <div className="mt-5 rounded-2xl bg-terracotta/5 border border-terracotta/20 px-4 py-3 text-sm flex items-center gap-2">
                  <Clock size={14} className="text-terracotta shrink-0" />
                  <span className="text-charcoal">
                    {p(t.step3Selected)}<strong>{selectedOption.startTime}</strong>{p(t.step3Start)}
                    {fmtDuration(selectedOption.durationMinutes)}，
                    <span className="text-terracotta">{selectedOption.displayTag}</span>
                  </span>
                </div>
              )}

              <div className="mt-6 flex justify-end">
                <button disabled={!selectedOption} onClick={() => setStep('form')} className="btn-primary">
                  {p(t.step3Next)} <ChevronRight size={16} />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── STEP 4: 填写信息 ─────────────────────────────────────────────── */}
        {step === 'form' && selectedOption && (
          <div className="animate-fade-in">
            <button onClick={() => setStep('slots')} className="btn-ghost mb-4 text-sm">
              <ChevronLeft size={14} /> {p(t.step4BackBtn)}
            </button>
            <div className="card p-6 sm:p-8">
              <h2 className="font-display text-xl font-semibold text-charcoal mb-1">{p(t.step4Title)}</h2>
              <p className="text-sm text-charcoal-light mb-6">
                {selectedDate} · {selectedOption.startTime} · {fmtDuration(selectedOption.durationMinutes)} · {selectedOption.displayTag}
              </p>

              <form onSubmit={handleSubmit} noValidate>
                <div className="space-y-5">
                  <div>
                    <label className="label" htmlFor="name">{p(t.step4NameLabel)}</label>
                    <input id="name"
                      className={cn('input-field', formErrors.name && 'border-red-400 focus:ring-red-200')}
                      placeholder={p(t.step4NamePH)}
                      value={form.name}
                      onChange={e => setForm({ ...form, name: e.target.value })}
                    />
                    {formErrors.name && <p className="mt-1 text-xs text-red-500">{formErrors.name}</p>}
                  </div>

                  <div>
                    <label className="label" htmlFor="email">{p(t.step4EmailLabel)}</label>
                    <input id="email" type="email"
                      className={cn('input-field', formErrors.email && 'border-red-400 focus:ring-red-200')}
                      placeholder={p(t.step4EmailPH)}
                      value={form.email}
                      onChange={e => setForm({ ...form, email: e.target.value })}
                    />
                    {formErrors.email && <p className="mt-1 text-xs text-red-500">{formErrors.email}</p>}
                  </div>

                  {/* 英文版暂不开放会员制度（业主 2026-09-17）：中文界面才给这个勾选框 */}
                  {lang === 'zh' && (
                    <label className="flex items-start gap-3 rounded-2xl border border-sand-200 bg-warm-50 p-4">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={form.joinClub}
                        onChange={e => setForm({ ...form, joinClub: e.target.checked })}
                      />
                      <span>
                        <span className="block text-sm font-medium text-charcoal">{p(t.step4JoinClub)}</span>
                        <span className="mt-1 block text-xs leading-5 text-charcoal-light">{p(t.step4JoinClubHint)}</span>
                      </span>
                    </label>
                  )}

                  <div>
                    <label className="label" htmlFor="remark">{p(t.step4RemarkLabel)}</label>
                    <textarea id="remark" rows={3}
                      className="input-field resize-none"
                      placeholder={p(t.step4RemarkPH)}
                      value={form.remark}
                      onChange={e => setForm({ ...form, remark: e.target.value })}
                    />
                  </div>
                </div>

                <div className="mt-6 rounded-2xl bg-warm-50 border border-sand-200 p-4 text-sm space-y-1.5">
                  <p className="font-semibold text-charcoal mb-2">{p(t.step4SummaryTitle)}</p>
                  <p className="text-charcoal-light">{p(t.step4SummaryDate)}{selectedDate}</p>
                  <p className="text-charcoal-light">{p(t.step4SummaryTime)}{selectedOption.startTime}{p(t.step4SummaryDur)}{fmtDuration(selectedOption.durationMinutes)}</p>
                  <p className="text-charcoal-light">{p(t.step4SummaryTable)}{selectedOption.displayTag}</p>
                  <p className="text-charcoal-light">
                    {p(t.step4SummaryGroup)}{partySize === 3 ? p(t.partyPersons34) : partySize}{p(t.step4SummaryUnit)}
                    {acceptsSharing && p(t.acceptsSharing)}
                  </p>
                </div>

                <div className="mt-5 rounded-xl bg-sage/10 border border-sage/30 px-4 py-3 text-sm text-charcoal-light">
                  {p(t.step4DepositOff)}
                </div>

                {submitError && (
                  <div className="mt-4 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">
                    {submitError}
                  </div>
                )}

                <button type="submit" disabled={submitting || redirecting} className="btn-primary w-full mt-4 py-3.5 text-base">
                  {submitting ? p(t.step4Submitting) : p(t.step4Submit)}
                  {!submitting && <CheckCircle2 size={18} />}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* ── STEP 5: 成功 ─────────────────────────────────────────────────── */}
        {step === 'done' && bookingResult && selectedOption && (
          <div className="card p-8 text-center animate-fade-in">
            <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-sage/10">
              <CheckCircle2 size={40} className="text-sage" />
            </div>
            <h2 className="font-display text-2xl font-bold text-charcoal mb-2">{p(t.step5Title)}</h2>
            <p className="text-charcoal-light mb-2">{p(t.step5Subtitle)}</p>
            <p className="text-sm text-charcoal-light/60 mb-8">{p(t.step5SubNote)}</p>

            {memberJoined && (
              <div className="rounded-2xl bg-sage/10 border border-sage/30 px-4 py-3 text-sm text-charcoal mb-4">
                {p(t.step5MemberJoined)}
              </div>
            )}

            <div className="rounded-2xl bg-warm-50 border border-sand-200 p-4 text-sm text-left space-y-2 mb-6">
              <p className="font-semibold text-charcoal mb-2">{p(t.step5DetailsTitle)}</p>
              <p className="text-xs text-charcoal-light/70">{p(t.step5Ref)}{bookingResult.bookingId.slice(0, 8)}…</p>
              <p className="text-charcoal-light">📅 {selectedDate}</p>
              <p className="text-charcoal-light">⏰ {selectedOption.startTime} – {bookingResult.endTime}</p>
              <p className="text-charcoal-light">🪑 {selectedOption.displayTag} · {bookingResult.assignedTableCode}</p>
              <p className="text-charcoal-light">👤 {form.name} · {partySize === 3 ? p(t.partyPersons34) : partySize}{p(t.step4SummaryUnit)}</p>
              <p className="text-charcoal-light">✉️ {form.email}</p>
            </div>

            <div className="rounded-2xl bg-terracotta/5 border border-terracotta/20 px-4 py-3 text-sm text-charcoal-light mb-8">
              {p(t.step5LocationPre)}{' '}
              <a href="/location" className="inline-flex items-center gap-0.5 rounded-lg bg-terracotta text-white px-2.5 py-0.5 text-xs font-medium hover:bg-terracotta/90 transition-colors">
                {p(t.step5LocationBtn)}
              </a>
              {' '}{p(t.step5LocationPost)}
            </div>

            <button onClick={resetAll} className="btn-secondary">{p(t.step5Again)}</button>
          </div>
        )}

      </div>
    </div>
  )
}
