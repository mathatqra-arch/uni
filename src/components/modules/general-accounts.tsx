'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch, formatEGP, formatDate, formatNumber } from '@/lib/api'
import { useAuthStore } from '@/lib/store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Calculator, Save, RefreshCw, Percent, TrendingUp, TrendingDown, WalletCards, Scale, ShoppingCart, Package, UsersRound, CircleDollarSign, RotateCcw, ArrowUpFromLine } from 'lucide-react'
import { toast } from 'sonner'
import { notifyError } from '@/lib/notify'
import { DataTable } from '@/components/ui/data-table'

type SummaryRow = { key?: string; label?: string; value?: number; kind?: string; category?: string; amount?: number; count?: number; method?: string }

interface GeneralAccountsData {
  accounts?: Array<{ id: string; code?: string; name?: string; nameAr?: string; accountType?: string; balanceSource?: string; debit?: number; credit?: number; balance?: number; operationalBalance?: number }>
  journalEntries?: Array<{ id: string; entryNo?: string; entryDate?: string; description?: string; totalDebit?: number; totalCredit?: number; user?: { name?: string } | null }>
  summary?: {
    revenue?: number
    cogs?: number
    grossProfit?: number
    operatingExpenses?: number
    wasteRate?: number
    wasteProvision?: number
    netProfitAfterWaste?: number
    currentCash?: number
    inventoryValue?: number
    supplierPayables?: number
    purchasesTotal?: number
    returnsTotal?: number
    salesCount?: number
    returnsCount?: number
    expenseCount?: number
    purchaseCount?: number
    marginPercent?: number
    deadStockValue?: number
    deadStockCount?: number
    deadStockProducts?: Array<{ id: string; name?: string; nameAr?: string | null; value?: number }>
    deepBreakdown?: SummaryRow[]
    expenseBreakdown?: Array<{ category?: string; amount?: number; count?: number }>
    salePaymentMix?: Array<{ method?: string; amount?: number }>
    monthlyProfit?: Array<{ month?: string; revenue?: number; cogs?: number; expenses?: number; operatingProfitBeforeWaste?: number; wasteProvision?: number; netProfitAfterWaste?: number }>
  }
}
const TYPE_LABELS: Record<string, string> = {
  ASSET: 'أصل', LIABILITY: 'التزام', EQUITY: 'حقوق ملكية', REVENUE: 'إيراد', COGS: 'تكلفة مبيعات', EXPENSE: 'مصروف'
}

function currentMonth() {
  const now = new Date()
  const from = new Date(now.getFullYear(), now.getMonth(), 1)
  return { from: from.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) }
}

export function GeneralAccountsModule() {
  const { user } = useAuthStore()
  const admin = user?.role === 'OWNER' || user?.role === 'ADMIN'
  const [data, setData] = useState<GeneralAccountsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState(currentMonth())
  const [wasteRate, setWasteRate] = useState('0')
  

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch(`/general-accounts?dateFrom=${range.from}&dateTo=${range.to}`)
      setData(res)
      setWasteRate(String(res?.summary?.wasteRate ?? 0))
    } catch (e) {
      notifyError(e)
    } finally { setLoading(false) }
  }, [range])

  useEffect(() => { void load() }, [load])

  const accounts = data?.accounts || []
  const entries = data?.journalEntries || []
  const summary = data?.summary || {}

  const saveWaste = async () => {
    if (!admin) return
    const rate = parseFloat(wasteRate)
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) return toast.error('النسبة يجب أن تكون بين 0 و100')
    try {
      await apiFetch('/general-accounts/waste', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'waste', rate }) })
      toast.success('تم حفظ نسبة الهالك')
      await load()
    } catch (e) { notifyError(e) }
  }

  const statCards = [
    { label: 'صافي المبيعات', value: summary.revenue, icon: TrendingUp, tone: 'text-emerald-600' },
    { label: 'تكلفة البضاعة المباعة', value: summary.cogs, icon: WalletCards, tone: 'text-amber-600' },
    { label: 'مجمل الربح', value: summary.grossProfit, icon: Scale, tone: 'text-sky-600' },
    { label: 'مصروفات التشغيل', value: summary.operatingExpenses, icon: TrendingDown, tone: 'text-rose-600' },
    { label: `الهالك (${summary.wasteRate || 0}%)`, value: summary.wasteProvision, icon: Percent, tone: 'text-violet-600' },
    { label: 'صافي الربح', value: summary.netProfitAfterWaste, icon: Calculator, tone: (summary.netProfitAfterWaste ?? 0) >= 0 ? 'text-emerald-700' : 'text-rose-700' },
  ]

  const opsCards = [
    { label: 'السيولة في الخزنة', value: summary.currentCash, icon: CircleDollarSign },
    { label: 'قيمة المخزون الحالية', value: summary.inventoryValue, icon: Package },
    { label: 'مستحقات الموردين', value: summary.supplierPayables, icon: UsersRound },
    { label: 'إجمالي المشتريات', value: summary.purchasesTotal, icon: ShoppingCart },
    { label: 'إجمالي المرتجعات', value: summary.returnsTotal, icon: RotateCcw },
    { label: 'عدد المبيعات', value: summary.salesCount, icon: ArrowUpFromLine, count: true },
  ]

  if (loading && !data) return <div className="p-6">جاري تحميل الحسابات العامة...</div>

  return (
    <div className="module-page p-4 md:p-6 space-y-6 max-w-[1600px] mx-auto">
      <div className="uk-page-header flex flex-col md:flex-row md:items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Calculator className="w-6 h-6 text-primary" /> الحسابات العامة</h1>
          <p className="text-sm text-muted-foreground mt-1">لوحة مالية مرتبطة مباشرة بحركة المبيعات والمشتريات والمصروفات والمرتجعات والخزنة والمخزون</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={() => void load()}><RefreshCw className="w-4 h-4 ml-1" /> تحديث</Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 p-3 rounded-xl border bg-card">
        <Label>من</Label><Input type="date" value={range.from} onChange={e => setRange(r => ({ ...r, from: e.target.value }))} className="w-auto" />
        <Label>إلى</Label><Input type="date" value={range.to} onChange={e => setRange(r => ({ ...r, to: e.target.value }))} className="w-auto" />
        <Button size="sm" variant="secondary" onClick={() => setRange(currentMonth())}>هذا الشهر</Button>
        <Button size="sm" variant="secondary" onClick={() => { const d=new Date(); d.setMonth(d.getMonth()-1); setRange({ from:new Date(d.getFullYear(),d.getMonth(),1).toISOString().slice(0,10), to:new Date(d.getFullYear(),d.getMonth()+1,0).toISOString().slice(0,10) }) }}>الشهر السابق</Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {statCards.map((s) => { const Icon=s.icon; return <div key={s.label} className="unikasher-card p-4"><div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center mb-3"><Icon className={`w-4.5 h-4.5 ${s.tone || 'text-primary'}`} /></div><p className="text-xs text-muted-foreground">{s.label}</p><p className={`text-lg font-bold pos-number mt-1 ${s.tone || ''}`}>{formatEGP(s.value || 0)}</p></div> })}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {opsCards.map((s) => { const Icon=s.icon; return <div key={s.label} className="rounded-xl border bg-card p-4"><div className="flex items-center justify-between gap-2"><p className="text-xs text-muted-foreground">{s.label}</p><Icon className="w-4 h-4 text-muted-foreground" /></div><p className="text-base font-bold pos-number mt-2">{s.count ? formatNumber(s.value || 0) : formatEGP(s.value || 0)}</p></div> })}
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">ملخص المكان الفعلي</CardTitle></CardHeader>
        <CardContent>
          <div className="grid lg:grid-cols-2 gap-6">
            <div className="space-y-3">
              {(summary.deepBreakdown || []).map((row) => <div key={row.key} className="flex items-center justify-between gap-4 p-3 rounded-lg border"><span className="text-sm">{row.label}</span><strong className={`pos-number ${row.kind === 'cost' || row.kind === 'waste' ? 'text-rose-600' : row.kind === 'profit' ? 'text-emerald-700' : ''}`}>{formatEGP(row.value || 0)}</strong></div>)}
            </div>
            <div className="space-y-4">
              <div><div className="flex justify-between text-sm mb-2"><span>هامش صافي الربح</span><strong>{Number(summary.marginPercent || 0).toFixed(2)}%</strong></div><div className="h-3 rounded-full bg-muted overflow-hidden"><div className="h-full bg-primary rounded-full transition-all" style={{ width: `${Math.min(100, Math.max(0, Number(summary.marginPercent || 0)))}%` }} /></div></div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">عدد الفواتير</p><p className="text-xl font-bold mt-1">{formatNumber(summary.salesCount || 0)}</p></div>
                <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">عدد المرتجعات</p><p className="text-xl font-bold mt-1">{formatNumber(summary.returnsCount || 0)}</p></div>
                <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">مصروفات مسجلة</p><p className="text-xl font-bold mt-1">{formatNumber(summary.expenseCount || 0)}</p></div>
                <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">المشتريات</p><p className="text-xl font-bold mt-1">{formatNumber(summary.purchaseCount || 0)}</p></div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {admin && <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Percent className="w-4 h-4 text-primary" /> نسبة الهالك الشهرية</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-col md:flex-row gap-3 md:items-end">
            <div className="flex-1 max-w-sm"><Label>نسبة الهالك من الربح التشغيلي قبل الهالك</Label><Input className="mt-2" type="number" min="0" max="100" step="0.01" dir="ltr" value={wasteRate} onChange={e => setWasteRate(e.target.value)} /></div>
            <Button onClick={() => void saveWaste()}><Save className="w-4 h-4 ml-1" /> حفظ النسبة</Button>
          </div>
          <p className="text-xs text-muted-foreground mt-3">الهالك نسبة تشغيلية يحددها الأدمن. تُطبّق على الربح التشغيلي الموجب لكل شهر على حدة، وتُخصم من الربح فقط؛ لا تغيّر المخزون ولا تنشئ حركة نقص.</p>
        </CardContent>
      </Card>}

      <Card className="border-primary/20 bg-primary/5">
        <CardHeader className="pb-3"><CardTitle className="text-base">الأرقام المرتبطة بالسستم</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2 text-sm">
          <div><span className="text-muted-foreground">المبيعات</span><div className="font-bold pos-number">{formatEGP(summary.revenue || 0)}</div></div>
          <div><span className="text-muted-foreground">مجمل الربح</span><div className="font-bold pos-number">{formatEGP(summary.grossProfit || 0)}</div></div>
          <div><span className="text-muted-foreground">المصروفات</span><div className="font-bold pos-number">{formatEGP(summary.operatingExpenses || 0)}</div></div>
          <div><span className="text-muted-foreground">الخزنة</span><div className="font-bold pos-number">{formatEGP(summary.currentCash || 0)}</div></div>
          <div><span className="text-muted-foreground">المخزون</span><div className="font-bold pos-number">{formatEGP(summary.inventoryValue || 0)}</div></div>
          <div><span className="text-muted-foreground">الموردون</span><div className="font-bold pos-number">{formatEGP(summary.supplierPayables || 0)}</div></div>
          <div><span className="text-muted-foreground">المخزون الراكد</span><div className="font-bold pos-number">{formatEGP(summary.deadStockValue || 0)}</div><div className="text-[11px] text-muted-foreground">{formatNumber(summary.deadStockCount || 0)} منتج</div></div>
          <div><span className="text-muted-foreground">هالك الربح</span><div className="font-bold pos-number">{formatEGP(summary.wasteProvision || 0)}</div></div>
        </CardContent>
      </Card>

      <Tabs defaultValue="dashboard" dir="rtl">
        <TabsList><TabsTrigger value="dashboard">لوحة المكان</TabsTrigger><TabsTrigger value="expenses">المصروفات</TabsTrigger><TabsTrigger value="monthly">الربحية الشهرية</TabsTrigger><TabsTrigger value="accounts">دليل الحسابات</TabsTrigger><TabsTrigger value="journal">سجل القيود</TabsTrigger></TabsList>
        <TabsContent value="dashboard" className="mt-4">
          <div className="grid lg:grid-cols-3 gap-4">
            <Card><CardHeader className="pb-3"><CardTitle className="text-base">المخزون الراكد</CardTitle></CardHeader><CardContent><div className="flex items-end justify-between"><div><p className="text-xs text-muted-foreground">حسب الإعداد العام وOverride لكل منتج</p><p className="text-2xl font-bold pos-number mt-1">{formatEGP(summary.deadStockValue || 0)}</p></div><Badge variant="secondary">{formatNumber(summary.deadStockCount || 0)} منتج</Badge></div>{(summary.deadStockProducts || []).slice(0,5).map((p)=><div key={p.id} className="flex justify-between border-t pt-2 mt-2 text-sm"><span className="truncate max-w-[65%]">{p.name}</span><span className="pos-number">{formatEGP(p.value)}</span></div>)}</CardContent></Card>
            <div className="lg:col-span-2 grid lg:grid-cols-2 gap-4">
            <Card><CardHeader className="pb-3"><CardTitle className="text-base">المصروفات حسب البند</CardTitle></CardHeader><CardContent><div className="space-y-3">{(summary.expenseBreakdown || []).map((e) => { const max = Math.max(...(summary.expenseBreakdown || []).map((x)=>Number(x.amount||0)), 1); return <div key={e.category}><div className="flex justify-between text-sm mb-1"><span>{e.category}</span><strong className="pos-number">{formatEGP(e.amount)}</strong></div><div className="h-2 rounded-full bg-muted overflow-hidden"><div className="h-full bg-primary rounded-full" style={{width:`${Math.min(100, Number(e.amount||0)/max*100)}%`}} /></div></div> })}{!(summary.expenseBreakdown || []).length && <p className="text-center text-muted-foreground py-8">لا توجد مصروفات في الفترة.</p>}</div></CardContent></Card>
            <Card><CardHeader className="pb-3"><CardTitle className="text-base">طريقة دفع المبيعات</CardTitle></CardHeader><CardContent><div className="space-y-3">{(summary.salePaymentMix || []).map((e) => <div key={e.method} className="flex items-center justify-between p-3 rounded-lg border"><span>{e.method === 'CASH' ? 'نقدي' : e.method === 'CARD' ? 'بطاقة' : e.method === 'TRANSFER' ? 'تحويل' : e.method === 'SPLIT' ? 'متعدد' : e.method}</span><strong className="pos-number">{formatEGP(e.amount)}</strong></div>)}{!(summary.salePaymentMix || []).length && <p className="text-center text-muted-foreground py-8">لا توجد مبيعات في الفترة.</p>}</div></CardContent></Card>
          </div>
          </div>
        </TabsContent>
        <TabsContent value="expenses" className="mt-4">
          <Card><CardContent className="pt-5">            <DataTable
              maxHeight="480px"
              columns={[
                { key: 'c0', header: 'البند', render: (e) => e.category },
                { key: 'c1', header: 'عدد العمليات', render: (e) => formatNumber(e.count || 0) },
                { key: 'c2', header: 'الإجمالي', cellClassName: "font-bold pos-number", render: (e) => formatEGP(e.amount || 0) },
              ]}
              rows={(summary.expenseBreakdown || [])}
              rowKey={(e) => e.category}
              emptyMessage='لا توجد مصروفات في الفترة.'
            /></CardContent></Card>
        </TabsContent>
        <TabsContent value="monthly" className="mt-4"><div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">{(summary.monthlyProfit || []).map((m)=><Card key={m.month}><CardHeader className="pb-2"><CardTitle className="text-sm">{m.month}</CardTitle></CardHeader><CardContent className="space-y-2 text-sm"><div className="flex justify-between"><span>المبيعات</span><b>{formatEGP(m.revenue)}</b></div><div className="flex justify-between"><span>التكلفة</span><b>{formatEGP(m.cogs)}</b></div><div className="flex justify-between"><span>المصروفات</span><b>{formatEGP(m.expenses)}</b></div><div className="flex justify-between"><span>الربح قبل الهالك</span><b>{formatEGP(m.operatingProfitBeforeWaste)}</b></div><div className="flex justify-between"><span>الهالك</span><b>{formatEGP(m.wasteProvision)}</b></div><div className="flex justify-between border-t pt-2"><span className="font-semibold">صافي الربح</span><b className="text-emerald-700">{formatEGP(m.netProfitAfterWaste)}</b></div></CardContent></Card>)}{!(summary.monthlyProfit || []).length && <Card className="md:col-span-2 xl:col-span-3"><CardContent className="py-12 text-center text-muted-foreground">لا توجد حركة مالية في الفترة المحددة.</CardContent></Card>}</div></TabsContent>
        <TabsContent value="accounts" className="mt-4">
          <Card><CardContent className="pt-5">            <DataTable
              maxHeight="480px"
              columns={[
                { key: 'c0', header: 'الكود', cellClassName: "font-mono", render: (a) => a.code },
                { key: 'c1', header: 'الحساب', cellClassName: "font-medium", render: (a) => <>{a.nameAr}<div className="mt-1">{a.balanceSource === 'OPERATIONS' ? <Badge variant="secondary">مرتبط بحركة النظام</Badge> : <Badge variant="outline">قيد محاسبي</Badge>}</div></> },
                { key: 'c2', header: 'النوع', render: (a) => <Badge variant="outline">{TYPE_LABELS[a.accountType ?? ''] ?? a.accountType ?? ''}</Badge> },
                { key: 'c3', header: 'مدين', cellClassName: "pos-number", render: (a) => formatEGP(a.debit) },
                { key: 'c4', header: 'دائن', cellClassName: "pos-number", render: (a) => formatEGP(a.credit) },
                { key: 'c5', header: 'الرصيد', cellClassName: "font-bold pos-number", render: (a) => formatEGP(a.operationalBalance ?? a.balance) },
              ]}
              rows={accounts}
            /></CardContent></Card>
        </TabsContent>
        <TabsContent value="journal" className="mt-4">
          <Card><CardContent className="pt-5">            <DataTable
              maxHeight="480px"
              columns={[
                { key: 'c0', header: 'رقم القيد', cellClassName: "font-mono", render: (e) => e.entryNo },
                { key: 'c1', header: 'التاريخ', render: (e) => formatDate(e.entryDate) },
                { key: 'c2', header: 'البيان', render: (e) => e.description },
                { key: 'c3', header: 'المدين', cellClassName: "pos-number", render: (e) => formatEGP(e.totalDebit) },
                { key: 'c4', header: 'الدائن', cellClassName: "pos-number", render: (e) => formatEGP(e.totalCredit) },
                { key: 'c5', header: 'المستخدم', render: (e) => e.user?.name || '—' },
              ]}
              rows={entries}
              emptyMessage='لا توجد قيود في الفترة المحددة'
            /></CardContent></Card>
        </TabsContent>
      </Tabs>

    </div>
  )
}
