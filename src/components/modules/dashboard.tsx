'use client'
import type { LucideIcon } from 'lucide-react'
import { extractErrorMessage } from '@/lib/notify'

import { useEffect, useMemo, useState } from 'react'
import { apiFetch, formatEGP, formatNumber } from '@/lib/api'
import { useUIStore } from '@/lib/store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import {
  TrendingUp, TrendingDown, DollarSign, ShoppingCart, Users, Package, ReceiptText,
  AlertTriangle, Lightbulb, ArrowUpRight, ArrowDownRight, Wallet, Percent, RotateCcw,
  RefreshCw, Plus, WalletCards, PackagePlus, ShoppingCart as ShoppingCartIcon
} from 'lucide-react'
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, CartesianGrid, Legend
} from 'recharts'

// Use the CSS chart tokens so colors stay in sync with the design system
const CHART_COLORS = ['#D44D5C', '#772344', '#E8E5A4', '#160029', '#D44D5C']

// Dashboard API response shape (subset of fields actually rendered).
// Note: many fields are optional because the API may omit them when empty.
// The `[key: string]: any` index signature allows extra fields without
// failing strict-mode type checks (e.g. for fields added in future API versions).
interface DashboardData {
  todaySales?: number
  todayCount?: number
  todayProfit?: number
  weekSales?: number
  weekGrowth?: number
  totalCustomers?: number
  newCustomersThisMonth?: number
  totalProducts?: number
  lowStockCount?: number
  inventoryValue?: number
  todayReturns?: number
  todayReturnsCount?: number
  monthReturns?: number
  returnRate?: number
  monthSales?: number
  profitMargin?: number
  avgOrderValue?: number
  salesTrend?: Array<{ date: string; total: number; count: number }>
  topProducts?: Array<{ name: string; nameAr?: string | null; total: number; quantity: number; revenue?: number }>
  paymentMethods?: Array<{ method: string; total: number; count: number }>
  categorySales?: Array<{ name: string; total: number }>
  salesByPaymentMethod?: Array<{ method: string; total: number; count: number }>
  lowStockProducts?: Array<{ name: string; nameAr?: string; currentStock: number; reorderLevel: number }>
  insights?: Array<{ type: string; text?: string; message?: string }>
  // Allow extra fields without failing strict-mode type checks
  salesByDay?: Array<{ day: string; sales: number; profit: number }>
  leastUsedProducts?: Array<{ name: string; nameAr?: string; revenue: number; quantity: number }>
  salesByCategory?: Array<{ name: string; value: number }>
  oldestInventory?: Array<{ name: string; nameAr?: string; stock: number; ageDays?: number; value: number }>
  deadStockCount?: number
  [key: string]: unknown
}

export function DashboardModule() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const setModule = useUIStore((s) => s.setModule)

  useEffect(() => {
    let mounted = true
    const load = async () => {
      try { const d = await apiFetch('/dashboard'); if (mounted) { setData(d as DashboardData); setError(null) } }
      catch (e) { if (mounted) setError(extractErrorMessage(e) || 'فشل تحميل البيانات') }
      finally { if (mounted) setLoading(false) }
    }
    void load()
    const onChanged = () => { void load() }
    window.addEventListener('unikasher:data-changed', onChanged)
    const interval = window.setInterval(() => { void load() }, 20000)
    return () => { mounted=false; window.removeEventListener('unikasher:data-changed', onChanged); window.clearInterval(interval) }
  }, [])

  const refresh = async () => {
    setRefreshing(true)
    try {
      const d = await apiFetch('/dashboard')
      setData(d as DashboardData)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'فشل تحديث البيانات')
    } finally {
      setRefreshing(false)
    }
  }

  const summary = useMemo(() => ({
    sales: Number(data?.todaySales || 0),
    profit: Number(data?.todayProfit || 0),
    invoices: Number(data?.todayCount || 0),
    lowStock: Number(data?.lowStockCount || 0),
  }), [data])

  if (loading) {
    return (
      <div className="uk-page space-y-5">
        <Skeleton className="h-10 w-48" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-28" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Skeleton className="h-80 lg:col-span-2" />
          <Skeleton className="h-80" />
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="uk-page">
        <Card>
          <CardContent className="p-8 text-center">
            <AlertTriangle className="w-12 h-12 mx-auto mb-3 text-destructive" />
            <p className="font-medium text-destructive mb-1">فشل تحميل لوحة التحكم</p>
            <p className="text-sm text-muted-foreground mb-4">{error || 'تعذّر جلب البيانات'}</p>
            <Button variant="outline" onClick={() => window.location.reload()}>
              إعادة المحاولة
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const kpis: Array<{ label: string; value: string; icon: LucideIcon; change?: number; suffix?: string; sub?: string; tint: string }> = [
    {
      label: 'مبيعات اليوم', value: formatEGP(data.todaySales), icon: DollarSign,
      sub: `نمو الأسبوع: ${Number(data.weekGrowth ?? 0) >= 0 ? '+' : ''}${Number(data.weekGrowth ?? 0).toFixed(1)}%`,
      tint: 'kpi-tint-green',
    },
    {
      label: 'أرباح اليوم', value: formatEGP(data.todayProfit), icon: TrendingUp,
      sub: `هامش الربح: ${Number(data.profitMargin || 0).toFixed(1)}%`,
      tint: 'kpi-tint-blue',
    },
    {
      label: 'عدد الفواتير اليوم', value: formatNumber(data.todayCount), icon: ShoppingCart,
      tint: 'kpi-tint-purple',
    },
    {
      label: 'متوسط الفاتورة', value: formatEGP(data.avgOrderValue), icon: ReceiptText,
      tint: 'kpi-tint-yellow',
    },
    {
      label: 'العملاء', value: formatNumber(data.totalCustomers), icon: Users,
      sub: `+${data.newCustomersThisMonth} هذا الشهر`, tint: 'kpi-tint-teal',
    },
    {
      label: 'المنتجات', value: formatNumber(data.totalProducts), icon: Package,
      tint: 'kpi-tint-purple',
    },
    {
      label: 'مخزون منخفض', value: formatNumber(data.lowStockCount), icon: AlertTriangle,
      tint: 'kpi-tint-pink',
    },
    {
      label: 'قيمة المخزون', value: formatEGP(data.inventoryValue), icon: Wallet,
      tint: 'kpi-tint-teal',
    },
    {
      label: 'مرتجعات اليوم', value: formatEGP(data.todayReturns), icon: RotateCcw,
      sub: `${data.todayReturnsCount || 0} عملية إرجاع`, tint: 'kpi-tint-pink',
    },
    {
      label: 'نسبة الإرجاع', value: `${data.returnRate || 0}%`, icon: Percent,
      sub: Number(data.returnRate ?? 0) > 10 ? 'نسبة مرتفعة' : 'مقبولة', tint: Number(data.returnRate ?? 0) > 10 ? 'kpi-tint-pink' : 'kpi-tint-green',
    },
  ]

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-[1600px] mx-auto">
      {/* Header */}
      <section className="dashboard-hero unikasher-card p-4 md:p-5">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="status-dot" aria-hidden="true" />
              <span className="text-xs font-semibold text-primary/80">المتابعة اليومية</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">لوحة التحكم</h1>
            <p className="text-muted-foreground text-sm mt-1">كل أهم أرقام المتجر في نظرة واحدة.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-sm py-1.5 px-3 rounded-full bg-background/70">
              <TrendingUp className="w-3.5 h-3.5 ml-1" />
              الشهر: {formatEGP(data.monthSales)}
            </Badge>
            <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={refreshing}>
              <RefreshCw className={`w-4 h-4 ml-2 ${refreshing ? 'animate-spin' : ''}`} />
              تحديث
            </Button>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-2">
          {[
            { label: 'مبيعات اليوم', value: formatEGP(summary.sales), icon: ShoppingCartIcon, action: () => setModule('pos') },
            { label: 'أرباح اليوم', value: formatEGP(summary.profit), icon: TrendingUp, action: () => setModule('reports') },
            { label: 'الفواتير', value: formatNumber(summary.invoices), icon: ReceiptText, action: () => setModule('sales') },
            { label: 'مخزون منخفض', value: formatNumber(summary.lowStock), icon: PackagePlus, action: () => setModule('inventory') },
          ].map(item => {
            const Icon = item.icon
            return (
              <button key={item.label} type="button" onClick={item.action} className="dashboard-mini-stat text-right">
                <Icon className="w-4 h-4 text-primary shrink-0" />
                <span className="min-w-0">
                  <span className="block text-[11px] text-muted-foreground truncate">{item.label}</span>
                  <span className="block text-sm font-bold pos-number truncate">{item.value}</span>
                </span>
              </button>
            )
          })}
        </div>
      </section>

      <section aria-label="إجراءات سريعة" className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {[
          { label: 'بيع جديد', hint: 'ابدأ فاتورة', icon: ShoppingCartIcon, action: () => setModule('pos'), tone: 'quick-primary' },
          { label: 'إضافة منتج', hint: 'أنشئ صنفًا', icon: Plus, action: () => setModule('products'), tone: 'quick-secondary' },
          { label: 'الخزنة', hint: 'راجع النقدية', icon: WalletCards, action: () => setModule('cash'), tone: 'quick-soft' },
          { label: 'المخزون', hint: 'راجع التنبيهات', icon: PackagePlus, action: () => setModule('inventory'), tone: 'quick-soft' },
        ].map(item => {
          const Icon = item.icon
          return (
            <button key={item.label} type="button" onClick={item.action} className={`quick-action-card ${item.tone}`}>
              <span className="quick-action-icon"><Icon className="w-5 h-5" /></span>
              <span className="min-w-0 text-right"><span className="block text-sm font-bold">{item.label}</span><span className="block text-[11px] opacity-70 mt-0.5 truncate">{item.hint}</span></span>
            </button>
          )
        })}
      </section>

      {/* KPI Cards — full pastel-tint cards with a floating white icon chip,
          matching the reference "asset card" style rather than plain white
          cards with a small colored icon square. */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
        {kpis.map((kpi, i) => {
          const Icon = kpi.icon
          return (
            <div key={i} className={`uk-financial-kpi ${kpi.tint}`}>
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 rounded-xl bg-white/70 dark:bg-black/20 flex items-center justify-center shadow-sm">
                  <Icon className="w-5 h-5" strokeWidth={2.25} />
                </div>
                {kpi.change !== undefined && (
                  <div className={`flex items-center gap-0.5 text-xs font-bold px-2 py-0.5 rounded-full bg-white/60 dark:bg-black/20 ${kpi.change >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>
                    {kpi.change >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                    {Math.abs(kpi.change).toFixed(1)}%
                  </div>
                )}
              </div>
              <p className="text-xs font-medium opacity-70 mb-1">{kpi.label}</p>
              <p className="text-lg md:text-xl font-bold pos-number">{kpi.value}{kpi.suffix || ''}</p>
              {kpi.sub && <p className="text-xs opacity-70 mt-1">{kpi.sub}</p>}
            </div>
          )
        })}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Sales chart */}
        <Card className="lg:col-span-2 unikasher-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">المبيعات - آخر 7 أيام</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={data.salesByDay}>
                <defs>
                  <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#D44D5C" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#D44D5C" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="day" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `${v/1000}k`} />
                <Tooltip
                  formatter={(v: number) => formatEGP(v)}
                  contentStyle={{ direction: 'rtl', fontSize: '13px' }}
                />
                <Area type="monotone" dataKey="sales" stroke="#D44D5C" strokeWidth={2} fill="url(#colorSales)" name="المبيعات" />
                <Area type="monotone" dataKey="profit" stroke="#772344" strokeWidth={2} fillOpacity={0} name="الأرباح" />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Payment methods */}
        <Card className="unikasher-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">طرق الدفع</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={data.salesByPaymentMethod}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={90}
                  paddingAngle={3}
                >
                  {(data.salesByPaymentMethod || data.paymentMethods || []).map((_, i: number) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number) => formatEGP(v)} contentStyle={{ direction: 'rtl', fontSize: '13px' }} />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Top products */}
        <Card className="lg:col-span-2 unikasher-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">المنتجات الأكثر مبيعاً</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {(data.topProducts || []).map((p, i: number) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-xl kpi-tint-purple flex items-center justify-center text-xs font-bold shrink-0">
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{p.nameAr || p.name}</p>
                    <Progress value={((p.revenue ?? 0) / (data.topProducts?.[0]?.revenue || 1)) * 100} className="h-1.5 mt-1" />
                  </div>
                  <div className="text-left shrink-0">
                    <p className="text-sm font-bold pos-number">{formatEGP(p.revenue)}</p>
                    <p className="text-xs text-muted-foreground">{formatNumber(p.quantity)} وحدة</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Smart Insights */}
        <Card className="unikasher-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Lightbulb className="w-4 h-4 text-amber-500" />
              رؤى ذكية
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2.5 max-h-[280px] overflow-y-auto">
              {data.insights?.map((insight, i: number) => (
                <div key={i} className={`flex items-start gap-2 p-2.5 rounded-xl text-sm ${
                  insight.type === 'positive' ? 'kpi-tint-green' :
                  insight.type === 'warning' ? 'kpi-tint-yellow' :
                  insight.type === 'negative' ? 'kpi-tint-pink' : 'kpi-tint-blue'
                }`}>
                  <div className="mt-0.5 shrink-0">
                    {insight.type === 'positive' ? <TrendingUp className="w-4 h-4" /> :
                     insight.type === 'warning' ? <AlertTriangle className="w-4 h-4" /> :
                     insight.type === 'negative' ? <TrendingDown className="w-4 h-4" /> :
                     <Lightbulb className="w-4 h-4" />}
                  </div>
                  <p className="text-xs leading-relaxed font-medium">{insight.message || insight.text || 'لا توجد تفاصيل إضافية'}</p>
                </div>
              ))}
              {(!data.insights || data.insights.length === 0) && (
                <p className="text-sm text-muted-foreground text-center py-4">لا توجد رؤى حالياً</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* New insights row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Least Sold Products */}
        <Card className="unikasher-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingDown className="w-4 h-4 text-red-500" />
              المنتجات الأقل مبيعاً
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {(data.leastUsedProducts || []).map((p, i: number) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-xl kpi-tint-pink flex items-center justify-center text-xs font-bold shrink-0">
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{p.nameAr || p.name}</p>
                    <Progress value={(p.revenue / (data.leastUsedProducts?.[data.leastUsedProducts.length - 1]?.revenue || 1)) * 100} className="h-1.5 mt-1" />
                  </div>
                  <div className="text-left shrink-0">
                    <p className="text-sm font-bold pos-number">{formatEGP(p.revenue)}</p>
                    <p className="text-xs text-muted-foreground">{formatNumber(p.quantity)} وحدة</p>
                  </div>
                </div>
              ))}
              {(!data.leastUsedProducts || data.leastUsedProducts.length === 0) && (
                <p className="text-sm text-muted-foreground text-center py-4">لا توجد بيانات</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Oldest Inventory */}
        <Card className="unikasher-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              المخزون الراكد
              <Badge variant="secondary" className="mr-auto">{formatNumber(data.deadStockCount || 0)} منتج</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {(data.oldestInventory || []).map((p, i: number) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-xl kpi-tint-yellow flex items-center justify-center text-xs font-bold shrink-0">
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{p.nameAr || p.name}</p>
                    <p className="text-xs text-muted-foreground">{formatNumber(p.stock)} وحدة · راكد منذ {formatNumber(p.ageDays || 0)} يوم</p>
                  </div>
                  <div className="text-left shrink-0">
                    <p className="text-sm font-bold pos-number">{formatEGP(p.value)}</p>
                    <p className="text-xs text-muted-foreground">قيمة مجمدة</p>
                  </div>
                </div>
              ))}
              {(!data.oldestInventory || data.oldestInventory.length === 0) && (
                <p className="text-sm text-muted-foreground text-center py-4">لا يوجد مخزون راكد</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Category breakdown */}
      <Card className="unikasher-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">المبيعات حسب الفئة</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={data.salesByCategory || []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `${v/1000}k`} />
              <Tooltip formatter={(v: number) => formatEGP(v)} contentStyle={{ direction: 'rtl', fontSize: '13px' }} />
              <Bar dataKey="value" name="المبيعات" radius={[8, 8, 0, 0]}>
                {(data.salesByCategory || []).map((_, i: number) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  )
}
