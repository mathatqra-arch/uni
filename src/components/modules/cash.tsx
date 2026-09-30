'use client'

import { useEffect, useState, useCallback } from 'react'
import type { CashSession, CashMovement } from '@/lib/types'

type CashSessionRow = Omit<CashSession, 'movements'> & { movements?: Array<CashMovement & { userName?: string | null }>; userName?: string | null; register?: { id?: string; name?: string | null } | null }
import { apiFetch, formatEGP, formatDateTime } from '@/lib/api'
import { generateUUID } from '@/lib/ids'
import { useAuthStore, useCashSessionStore } from '@/lib/store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'

import {
  Wallet, Lock, Unlock, ArrowDownToLine, ArrowUpFromLine, RefreshCw, User,
  AlertTriangle, Coins, TrendingUp, TrendingDown, Receipt, PiggyBank, Scale,
} from 'lucide-react'
import { toast } from 'sonner'
import { notifyError } from '@/lib/notify'
import { DataTable } from '@/components/ui/data-table'

const KPI_TINTS = ['kpi-tint-blue', 'kpi-tint-green', 'kpi-tint-purple', 'kpi-tint-yellow', 'kpi-tint-pink', 'kpi-tint-teal']

const MOVEMENT_META: Record<string, { label: string; color: string; sign: '+' | '-' | '·' }> = {
  OPENING:   { label: 'افتتاح',        color: 'bg-blue-100 text-blue-700 border-blue-200',       sign: '+' },
  CLOSING:   { label: 'إغلاق',         color: 'bg-gray-100 text-gray-700 border-gray-200',       sign: '·' },
  SALE:      { label: 'بيع',           color: 'bg-green-100 text-green-700 border-green-200',    sign: '+' },
  CASH_IN:   { label: 'إيداع نقدي',    color: 'bg-emerald-100 text-emerald-700 border-emerald-200', sign: '+' },
  CASH_OUT:  { label: 'سحب نقدي',      color: 'bg-amber-100 text-amber-700 border-amber-200',    sign: '-' },
  EXPENSE:   { label: 'مصروف',         color: 'bg-red-100 text-red-700 border-red-200',          sign: '-' },
  REFUND:    { label: 'مرتجع',         color: 'bg-orange-100 text-orange-700 border-orange-200', sign: '-' },
}

export function CashModule() {
  const { user } = useAuthStore()
  const setGlobalRegisterOpen = useCashSessionStore((s) => s.setRegisterOpen)
  const [session, setSession] = useState<CashSessionRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [openingBalance, setOpeningBalance] = useState('0')
  const [openingSession, setOpeningSession] = useState(false)
  const [movementDialogOpen, setMovementDialogOpen] = useState(false)
  const [movementType, setMovementType] = useState<'CASH_IN' | 'CASH_OUT'>('CASH_IN')
  const [movementAmount, setMovementAmount] = useState('')
  const [movementNote, setMovementNote] = useState('')
  const [savingMovement, setSavingMovement] = useState(false)
  const [closeDialogOpen, setCloseDialogOpen] = useState(false)
  const [actualCash, setActualCash] = useState('')
  const [closing, setClosing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiFetch('/cash')
      setSession(data)
      setGlobalRegisterOpen(!!data)
      if (data?.expectedCash !== undefined) {
        setActualCash(String(data.expectedCash.toFixed(2)))
      }
    } catch {
      setSession(null)
      setGlobalRegisterOpen(false)
    } finally {
      setLoading(false)
    }
  }, [setGlobalRegisterOpen])

  useEffect(() => { load() }, [load])

  const handleOpen = async () => {
    if (!user?.id) { toast.error('المستخدم غير مسجل'); return }
    setOpeningSession(true)
    try {
      // Idempotency: cash_sessions.clientTxn_id is the durable idempotency identity for opening;
      // sync_queue mirrors it for recovery/synchronization.
      // Prevents a retry from creating a second opening session.
      const clientTxnId = generateUUID()
      await apiFetch('/cash/open', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Txn-Id': clientTxnId,
        },
        body: JSON.stringify({
          userId: user.id,
          openingBalance: parseFloat(openingBalance) || 0,
          clientTxnId,
        }),
      })
      toast.success('تم فتح الخزنة وحفظ الرصيد الافتتاحي بنجاح')
      setGlobalRegisterOpen(true)
      // FIX: `result` from /cash/open does not include a `movements` array
      // (it only echoes back the request body + id). Rendering the "open
      // session" dashboard immediately after reads session.movements.filter(...)
      // which crashed with "Cannot read properties of undefined (reading
      // 'filter')". Re-fetch the full session (which always includes
      // movements) instead of trusting the open-endpoint's response shape.
      await load()
      setOpeningBalance('0')
    } catch (e) {
      notifyError(e, { context: 'فتح الخزنة' })
    } finally {
      setOpeningSession(false)
    }
  }

  const handleMovement = async () => {
    if (!session) return
    const amt = parseFloat(movementAmount)
    if (!amt || amt <= 0) { toast.error('أدخل مبلغاً صحيحاً'); return }
    setSavingMovement(true)
    try {
      // Idempotency: cash movements (CASH_IN / CASH_OUT) move real money;
      // a retry must not double-debit or double-credit the drawer.
      const clientTxnId = generateUUID()
      await apiFetch('/cash/movement', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Txn-Id': clientTxnId,
        },
        body: JSON.stringify({
          sessionId: session.id,
          type: movementType,
          amount: amt,
          note: movementNote,
          userId: user?.id,
          clientTxnId,
        }),
      })
      toast.success(movementType === 'CASH_IN' ? 'تم الإيداع بنجاح' : 'تم السحب بنجاح')
      setMovementDialogOpen(false)
      setMovementAmount('')
      setMovementNote('')
      await load()
    } catch (e) {
      notifyError(e, { context: movementType === 'CASH_IN' ? 'تسجيل إيداع' : 'تسجيل سحب' })
    } finally {
      setSavingMovement(false)
    }
  }

  const handleClose = async () => {
    if (!session) return
    const amt = parseFloat(actualCash)
    if (isNaN(amt)) { toast.error('أدخل النقد الفعلي'); return }
    setClosing(true)
    try {
      // Idempotency: closing a session twice must not post a duplicate CLOSING
      // movement; the cash movement row itself carries the durable clientTxnId guard.
      const clientTxnId = generateUUID()
      await apiFetch('/cash/close', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Txn-Id': clientTxnId,
        },
        body: JSON.stringify({
          sessionId: session.id,
          actualCash: amt,
          userId: user?.id,
          clientTxnId,
        }),
      })
      toast.success('تم إغلاق الخزنة وحفظ البيانات بنجاح')
      setCloseDialogOpen(false)
      setSession(null)
      setGlobalRegisterOpen(false)
      setActualCash('')
      await load()
    } catch (e) {
      notifyError(e, { context: 'إغلاق الخزنة' })
    } finally {
      setClosing(false)
    }
  }

  if (loading) {
    return (
      <div className="p-4 md:p-6 space-y-6 max-w-[1600px] mx-auto">
        <Skeleton className="h-10 w-48" />
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-28" />)}
        </div>
        <Skeleton className="h-96" />
      </div>
    )
  }

  // No open session
  if (!session) {
    return (
      <div className="uk-page space-y-5">
        <div className="uk-page-header">
          <div className="uk-page-header__title">
            <div className="uk-page-header__icon"><Wallet className="w-5 h-5" /></div>
            <div>
              <h1 className="text-2xl font-bold">الخزنة</h1>
              <p className="uk-page-header__subtitle">إدارة درج الكاش والجلسات النقدية</p>
            </div>
          </div>
        </div>

        <Card className="max-w-md mx-auto unikasher-card">
          <CardHeader className="text-center pb-2">
            <div className="w-16 h-16 rounded-full bg-amber-500/10 flex items-center justify-center mx-auto mb-2">
              <Lock className="w-8 h-8 text-amber-600" />
            </div>
            <CardTitle>الخزنة مغلقة</CardTitle>
            <p className="text-sm text-muted-foreground">لا توجد جلسة كاش مفتوحة. ابدأ بفتح خزنة جديدة.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="opening-balance">رصيد الافتتاح (ج.م)</Label>
              <Input
                id="opening-balance"
                type="number"
                step="0.01"
                min="0"
                value={openingBalance}
                onChange={(e) => setOpeningBalance(e.target.value)}
                placeholder="0.00"
                className="text-lg font-medium pos-number"
                dir="ltr"
              />
              <p className="text-xs text-muted-foreground">أدخل المبلغ الموجود فعلياً في الدرج عند بدء الوردية</p>
            </div>
            <Button className="w-full h-11" onClick={handleOpen} disabled={openingSession}>
              <Unlock className="w-4 h-4 ml-2" />
              {openingSession ? 'جاري الفتح...' : 'فتح الخزنة'}
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Open session dashboard
  const expected = session.expectedCash ?? 0
  const sales = (session.movements || []).filter((m) => m.type === 'SALE').reduce((s, m) => s + m.amount, 0)
  const expenses = (session.movements || []).filter((m) => m.type === 'EXPENSE').reduce((s, m) => s + m.amount, 0)
  const cashIn = (session.movements || []).filter((m) => m.type === 'CASH_IN').reduce((s, m) => s + m.amount, 0)
  const cashOut = (session.movements || []).filter((m) => m.type === 'CASH_OUT').reduce((s, m) => s + m.amount, 0)
  const refunds = (session.movements || []).filter((m) => m.type === 'REFUND').reduce((s, m) => s + m.amount, 0)
  const actual = parseFloat(actualCash) || 0
  const diff = actual - expected

  const summaryCards = [
    { label: 'رصيد الافتتاح', value: formatEGP(session.openingBalance), icon: PiggyBank, color: 'text-blue-600', bg: 'bg-blue-500/10' },
    { label: 'المبيعات النقدية', value: formatEGP(sales), icon: Receipt, color: 'text-green-600', bg: 'bg-green-500/10' },
    { label: 'المصروفات', value: formatEGP(expenses), icon: TrendingDown, color: 'text-red-600', bg: 'bg-red-500/10' },
    { label: 'صافي الإيداعات/السحوبات', value: formatEGP(cashIn - cashOut), icon: Scale, color: 'text-amber-600', bg: 'bg-amber-500/10', sub: `إيداع: ${formatEGP(cashIn)} · سحب: ${formatEGP(cashOut)}` },
    { label: 'المرتجعات', value: formatEGP(refunds), icon: TrendingDown, color: 'text-orange-600', bg: 'bg-orange-500/10' },
    { label: 'المتوقع', value: formatEGP(expected), icon: TrendingUp, color: 'text-purple-600', bg: 'bg-purple-500/10' },
  ]

  return (
    <div className="uk-page space-y-5">
      {/* Header */}
      <div className="uk-page-header">
        <div className="uk-page-header__title">
          <div className="uk-page-header__icon"><Wallet className="w-5 h-5" /></div>
          <div>
            <h1 className="text-2xl font-bold">الخزنة</h1>
            <p className="uk-page-header__subtitle">مفتوحة منذ {formatDateTime(session.openedAt)} — بواسطة {session.user?.name || session.userName || '—'}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw className="w-4 h-4 ml-1" />
            تحديث
          </Button>
          <Button variant="outline" size="sm" onClick={() => { setMovementType('CASH_IN'); setMovementDialogOpen(true) }}>
            <ArrowDownToLine className="w-4 h-4 ml-1 text-green-600" />
            إيداع نقدي
          </Button>
          <Button variant="outline" size="sm" onClick={() => { setMovementType('CASH_OUT'); setMovementDialogOpen(true) }}>
            <ArrowUpFromLine className="w-4 h-4 ml-1 text-amber-600" />
            سحب نقدي
          </Button>
          <Button variant="destructive" size="sm" onClick={() => setCloseDialogOpen(true)}>
            <Lock className="w-4 h-4 ml-1" />
            إغلاق الخزنة
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
          <Unlock className="w-3 h-3 ml-1" />
          مفتوحة
        </Badge>
        <Badge variant="outline" className="text-xs">
          <User className="w-3 h-3 ml-1" />
          المستخدم: {session.user?.name || session.userName || '—'}
        </Badge>
        {session.register && (
          <Badge variant="outline" className="text-xs">
            الدرج: {session.register.name || session.register.id}
          </Badge>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {summaryCards.map((c, i) => {
          const Icon = c.icon
          return (
            <div key={i} className={`uk-financial-kpi ${KPI_TINTS[i % KPI_TINTS.length]}`}>
                <div className="w-9 h-9 rounded-lg bg-white/70 dark:bg-black/20 flex items-center justify-center mb-2 shadow-sm">
                  <Icon className="w-4.5 h-4.5" strokeWidth={2.25} />
                </div>
                <p className="text-xs font-medium opacity-70 mb-1">{c.label}</p>
                <p className="text-sm md:text-base font-bold pos-number">{c.value}</p>
                {c.sub && <p className="text-[10px] opacity-70 mt-1">{c.sub}</p>}
              </div>
          )
        })}
      </div>

      {/* Actual vs Expected */}
      <Card className="unikasher-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Coins className="w-4 h-4 text-primary" />
            جرد الدرج
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div className="space-y-2">
              <Label>المتوقع في الدرج</Label>
              <div className="h-10 px-3 rounded-md bg-muted flex items-center font-bold pos-number">{formatEGP(expected)}</div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="actual-cash">الفعلي (عدّ النقد)</Label>
              <Input
                id="actual-cash"
                type="number"
                step="0.01"
                value={actualCash}
                onChange={(e) => setActualCash(e.target.value)}
                placeholder="0.00"
                className="text-base font-bold pos-number"
                dir="ltr"
              />
            </div>
            <div className="space-y-2">
              <Label>الفرق</Label>
              <div className={`h-10 px-3 rounded-md flex items-center font-bold pos-number ${
                Math.abs(diff) < 0.01 ? 'bg-green-100 text-green-700'
                : diff > 0 ? 'bg-blue-100 text-blue-700'
                : 'bg-red-100 text-red-700'
              }`}>
                {diff > 0 ? '+' : ''}{formatEGP(diff)}
              </div>
            </div>
          </div>
          {Math.abs(diff) >= 0.01 && actualCash !== '' && (
            <Alert className={`mt-4 ${diff > 0 ? 'border-blue-200 bg-blue-50' : 'border-red-200 bg-red-50'}`}>
              <AlertTriangle className={`w-4 h-4 ${diff > 0 ? 'text-blue-600' : 'text-red-600'}`} />
              <AlertDescription className={diff > 0 ? 'text-blue-700' : 'text-red-700'}>
                {diff > 0
                  ? `يوجد زيادة عن المتوقع بمقدار ${formatEGP(diff)} - تحقق من المعاملات النقدية`
                  : `يوجد عجز بمقدار ${formatEGP(Math.abs(diff))} - راجع المصروفات والمرتجعات`}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Movements table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">حركات الكاش ({session.movements?.length || 0})</CardTitle>
        </CardHeader>
        <CardContent>
          {session.movements?.length ? (
            <div className="uk-table-sticky h-[420px] overflow-auto uk-scroll-region rounded-2xl border bg-card">
              <DataTable
                maxHeight="480px"
                columns={[
                  { key: 'c0', header: 'النوع', render: (m) => {
                      const meta = MOVEMENT_META[m.type] || { label: m.type, color: 'bg-gray-100 text-gray-700 border-gray-200', sign: '·' }
                      return (
                      <Badge variant="outline" className={`text-xs ${meta.color}`}>
                                                  {meta.label}
                                                </Badge>
                      )
                    } },
                  { key: 'c1', header: 'المبلغ', align: 'left', cellClassName: "font-bold pos-number ${meta.sign === '+' ? 'uk-amount-positive' : meta.sign === '-' ? 'uk-amount-negative' : 'uk-amount-neutral'}", render: (m) => {
                      const meta = MOVEMENT_META[m.type] || { label: m.type, color: 'bg-gray-100 text-gray-700 border-gray-200', sign: '·' }
                      return (
                      <>{meta.sign === '+' ? '+' : meta.sign === '-' ? '-' : ''}{formatEGP(m.amount)}</>
                      )
                    } },
                  { key: 'c2', header: 'الملاحظة', cellClassName: "text-sm text-muted-foreground max-w-xs", render: (m) => m.note || '—' },
                  { key: 'c3', header: 'المستخدم', cellClassName: "text-sm font-medium", render: (m) => m.userName || '—' },
                  { key: 'c4', header: 'المرجع', cellClassName: "text-xs text-muted-foreground", render: (m) => m.refType ? `${m.refType}` : '—' },
                  { key: 'c5', header: 'التوقيت', cellClassName: "text-xs text-muted-foreground", render: (m) => formatDateTime(m.createdAt) },
                ]}
                rows={(session.movements || [])}
                rowClassName="uk-transaction-row"
              />
            </div>
          ) : (
            <div className="uk-empty-state"><div><div className="uk-empty-state__icon"><Receipt className="w-5 h-5" /></div><p className="text-sm mt-3 font-medium">لا توجد حركات بعد</p><p className="text-xs mt-1">ستظهر عمليات البيع والإيداع والسحب والمرتجعات هنا.</p></div></div>
          )}
        </CardContent>
      </Card>

      {/* Movement dialog */}
      <Dialog open={movementDialogOpen} onOpenChange={setMovementDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {movementType === 'CASH_IN' ? 'إيداع نقدي' : 'سحب نقدي'}
            </DialogTitle>
            <DialogDescription>
              {movementType === 'CASH_IN'
                ? 'إيداع مبلغ نقدي إضافي إلى الدرج'
                : 'سحب مبلغ نقدي من الدرج (للنفقات أو الإيداع البنكي)'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant={movementType === 'CASH_IN' ? 'default' : 'outline'}
                onClick={() => setMovementType('CASH_IN')}
                className="justify-start"
              >
                <ArrowDownToLine className="w-4 h-4 ml-2 text-green-300" />
                إيداع
              </Button>
              <Button
                variant={movementType === 'CASH_OUT' ? 'default' : 'outline'}
                onClick={() => setMovementType('CASH_OUT')}
                className="justify-start"
              >
                <ArrowUpFromLine className="w-4 h-4 ml-2 text-amber-300" />
                سحب
              </Button>
            </div>
            <div className="space-y-2">
              <Label htmlFor="mv-amount">المبلغ (ج.م)</Label>
              <Input
                id="mv-amount"
                type="number"
                step="0.01"
                min="0.01"
                value={movementAmount}
                onChange={(e) => setMovementAmount(e.target.value)}
                placeholder="0.00"
                className="pos-number"
                dir="ltr"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mv-note">الملاحظة (اختياري)</Label>
              <Textarea
                id="mv-note"
                rows={2}
                value={movementNote}
                onChange={(e) => setMovementNote(e.target.value)}
                placeholder="سبب الإيداع أو السحب"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMovementDialogOpen(false)}>إلغاء</Button>
            <Button onClick={handleMovement} disabled={savingMovement}>
              {savingMovement ? 'جاري الحفظ...' : 'تأكيد'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Close dialog */}
      <Dialog open={closeDialogOpen} onOpenChange={setCloseDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>إغلاق الخزنة</DialogTitle>
            <DialogDescription>أدخل النقد الفعلي في الدرج لإغلاق الجلسة وحساب الفرق</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <Card>
                <CardContent className="p-3">
                  <p className="text-xs text-muted-foreground mb-1">رصيد الافتتاح</p>
                  <p className="text-sm font-bold pos-number">{formatEGP(session.openingBalance)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3">
                  <p className="text-xs text-muted-foreground mb-1">المتوقع</p>
                  <p className="text-sm font-bold pos-number text-purple-600">{formatEGP(expected)}</p>
                </CardContent>
              </Card>
            </div>
            <Separator />
            <div className="space-y-2">
              <Label htmlFor="close-actual">النقد الفعلي (ج.م)</Label>
              <Input
                id="close-actual"
                type="number"
                step="0.01"
                value={actualCash}
                onChange={(e) => setActualCash(e.target.value)}
                placeholder="0.00"
                className="pos-number"
                dir="ltr"
              />
            </div>
            {actualCash !== '' && !isNaN(parseFloat(actualCash)) && (
              <div className={`p-3 rounded-lg flex items-center gap-2 ${
                Math.abs(diff) < 0.01 ? 'bg-green-50 text-green-700'
                : diff > 0 ? 'bg-blue-50 text-blue-700'
                : 'bg-red-50 text-red-700'
              }`}>
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span className="text-sm">
                  {Math.abs(diff) < 0.01
                    ? 'الفرق صفر - متطابق تماماً'
                    : diff > 0
                      ? `زيادة بمقدار ${formatEGP(diff)}`
                      : `عجز بمقدار ${formatEGP(Math.abs(diff))}`}
                </span>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseDialogOpen(false)}>إلغاء</Button>
            <Button variant="destructive" onClick={handleClose} disabled={closing}>
              <Lock className="w-4 h-4 ml-1" />
              {closing ? 'جاري الإغلاق...' : 'إغلاق الخزنة'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
