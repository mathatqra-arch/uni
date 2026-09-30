'use client'
import type { LucideIcon } from 'lucide-react'

import { logger } from '../../lib/logger'
import { useEffect, useState, useMemo, useCallback } from 'react'
import { apiFetch, formatEGP, formatNumber, formatDateTime } from '@/lib/api'
import { exportTextFile } from '@/lib/export-file'
import { useDebounce } from '@/hooks/use-debounce'
import { generateUUID } from '@/lib/ids'
import { useAuthStore } from '@/lib/store'
import { Card, CardContent } from '@/components/ui/card'
import type { Sale, SaleItem } from '@/lib/types'
type SaleListRow = Omit<Sale, 'items' | 'returns' | 'payments'> & {
  createdAt?: string | Date
  customerName?: string | null
  returns?: Array<{ id: string; status?: string; total?: number; reason?: string; refundMethod?: string; createdAt?: string; user?: { name?: string }; items?: Array<{ saleItemId: string; quantity: number }> }>
  items?: Array<SaleItem & { costAtSale?: number; refundQty?: number; product?: { id?: string; name?: string; nameAr?: string | null; sku?: string } | null }>
  payments?: Array<{ id: string; method?: string; amount?: number }>
  customer?: { name?: string } | null
  register?: { name?: string } | null
  status?: string
  user?: { name?: string } | null
}
type SaleRow = SaleListRow
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import { DataTable } from '@/components/ui/data-table'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select'
import {
  ShoppingCart, Search, Eye, Printer, Undo2, Download, RefreshCw,
  DollarSign, Receipt, Percent, TrendingUp, Wallet, Banknote, CreditCard, ArrowLeftRight,
} from 'lucide-react'
import { toast } from 'sonner'
import { notifyError } from '@/lib/notify'
import { printSaleReceipt } from '@/lib/receipt-template'

const KPI_TINTS = ['kpi-tint-blue', 'kpi-tint-green', 'kpi-tint-purple', 'kpi-tint-yellow', 'kpi-tint-pink', 'kpi-tint-teal']

const PERIODS = [
  { value: 'today', label: 'اليوم' },
  { value: 'week', label: 'هذا الأسبوع' },
  { value: 'month', label: 'هذا الشهر' },
  { value: 'all', label: 'الكل' },
]

const PAYMENT_METHOD_META: Record<string, { label: string; color: string; icon: LucideIcon }> = {
  CASH: { label: 'نقدي', color: 'bg-green-500/10 text-green-700 border-green-500/20', icon: Banknote },
  CARD: { label: 'بطاقة', color: 'bg-blue-500/10 text-blue-700 border-blue-500/20', icon: CreditCard },
  TRANSFER: { label: 'تحويل', color: 'bg-purple-500/10 text-purple-700 border-purple-500/20', icon: ArrowLeftRight },
  SPLIT: { label: 'مقسّم', color: 'bg-amber-500/10 text-amber-700 border-amber-500/20', icon: Wallet },
  OTHER: { label: 'أخرى', color: 'bg-gray-500/10 text-gray-700 border-gray-500/20', icon: DollarSign },
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'COMPLETED':
      return <Badge className="bg-green-500/10 text-green-700 border-green-500/20">مكتملة</Badge>
    case 'REFUNDED':
      return <Badge className="bg-red-500/10 text-red-700 border-red-500/20">مستردة</Badge>
    case 'PARTIAL_REFUND':
      return <Badge className="bg-orange-500/10 text-orange-700 border-orange-500/20">مرتجع جزئي</Badge>
    case 'HELD':
      return <Badge className="bg-gray-500/10 text-gray-700 border-gray-500/20">معلقة</Badge>
    default:
      return <Badge variant="outline">{status}</Badge>
  }
}

export function SalesModule() {
  const [sales, setSales] = useState<SaleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState('today')
  const [search, setSearch] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('all')
  const [detail, setDetail] = useState<SaleRow | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [refundOpen, setRefundOpen] = useState(false)
  const [refundTarget, setRefundTarget] = useState<SaleRow | null>(null)

  const debouncedSearch = useDebounce(search, 350)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (period !== 'all') params.set('period', period)
      if (debouncedSearch) params.set('search', debouncedSearch)
      if (paymentMethod !== 'all') params.set('paymentMethod', paymentMethod)
      params.set('limit', '200')
      const url = `/sales?${params.toString()}`
      logger.debug('[Sales] Fetching:', url, { period, debouncedSearch, paymentMethod })
      const data = await apiFetch(url)
      logger.debug('[Sales] Received:', data?.length, 'sales')
      setSales(data || [])
    } catch (e) {
      logger.error(`[Sales] Error: ${e instanceof Error ? e.message : String(e)}`)
      notifyError(e)
    } finally {
      setLoading(false)
    }
  }, [period, debouncedSearch, paymentMethod])

  useEffect(() => {
    load()
  }, [load])

  // Net-of-returns helpers. Previously the invoice list and summary cards
  // always showed the sale's original `total`/item totals, completely
  // ignoring partial refunds — a 50%-refunded invoice still looked
  // untouched here even though /sales/[id]/refund had already processed it.
  const getRefundedTotal = (sale: SaleRow) =>
    (sale.returns || []).reduce((s, r) => s + (r.total || 0), 0)
  const getNetTotal = (sale: SaleRow) => Math.max(0, (sale.total || 0) - getRefundedTotal(sale))

  // Summary
  const stats = useMemo(() => {
    const total = sales.reduce((s, x) => s + getNetTotal(x), 0)
    const refunded = sales.reduce((s, x) => s + getRefundedTotal(x), 0)
    const count = sales.length
    const avg = count > 0 ? total / count : 0
    const profit = sales.reduce((s, x) => {
      const refundRatio = x.total > 0 ? getRefundedTotal(x) / x.total : 0
      const itemsProfit = (x.items || []).reduce((p, it) => {
        const revenue = (it.total || 0) - (it.taxAmount || 0)
        // Scale down profit proportionally to what's been refunded so a
        // partial return actually lowers reported profit, not just full
        // returns (which the API already excludes from `sales` entirely).
        return p + (revenue - (it.costAtSale || 0) * it.quantity) * (1 - refundRatio)
      }, 0)
      return s + itemsProfit
    }, 0)
    return { total, count, avg, profit, refunded }
  }, [sales])

  const openDetail = async (id: string) => {
    setDetailLoading(true)
    try {
      const data = await apiFetch(`/sales/${id}`)
      setDetail(data)
    } catch (e) {
      notifyError(e)
    } finally {
      setDetailLoading(false)
    }
  }

  const openRefund = (sale: SaleRow) => {
    setRefundTarget(sale)
    setRefundOpen(true)
  }

  const exportCSV = async () => {
    const headers = ['رقم الفاتورة', 'التاريخ', 'العميل', 'الكاشير', 'الإجمالي الأصلي', 'المرتجع', 'الصافي', 'طريقة الدفع', 'الحالة']
    const lines = [headers.join(',')]
    sales.forEach((s) => {
      const customer = s.customer?.name || ''
      const cashier = s.user?.name || ''
      const pmMeta = PAYMENT_METHOD_META[s.paymentMethod] || { label: s.paymentMethod }
      const statusLabel =
        s.status === 'COMPLETED' ? 'مكتملة' :
        s.status === 'REFUNDED' ? 'مستردة' :
        s.status === 'PARTIAL_REFUND' ? 'مرتجع جزئي' : s.status
      const refunded = getRefundedTotal(s)
      const line = [
        `"${s.invoiceNumber}"`,
        `"${formatDateTime(s.createdAt)}"`,
        `"${customer}"`,
        `"${cashier}"`,
        s.total ?? 0,
        refunded,
        getNetTotal(s),
        `"${pmMeta.label}"`,
        `"${statusLabel}"`,
      ]
      lines.push(line.join(','))
    })
    const csv = lines.join('\n')
    await exportTextFile(`sales-${new Date().toISOString().slice(0, 10)}.csv`, csv)
    toast.success(`تم تصدير ${sales.length} فاتورة`)
  }

  // FIX: this used to build a completely different, A4-invoice-styled print
  // template (see the removed code below) — visually nothing like what the
  // register prints for the same sale, so a reprint from this screen didn't
  // match the customer's original receipt at all. It also used the same
  // window.open()+injected-<script> pattern already known to silently fail
  // under the desktop app's CSP (see receipt-print.tsx's original fix note).
  // Now this calls the same printSaleReceipt() helper used by the Reports
  // module's reprint button, which builds the identical thermal-receipt
  // layout the POS uses (src/lib/receipt-template.ts) — so printing a sale
  // from here, from Reports, or right after checkout, all produce the same
  // paper.
  const handlePrint = async (sale: SaleRow) => {
    if (!sale) return
    try {
      await printSaleReceipt(
        sale,
        () => toast.success('تم إرسال الإيصال للطباعة'),
        () => toast.error('تعذر فتح نافذة الطباعة — تأكد من تعريف الطابعة على الجهاز')
      )
    } catch (e) {
      toast.error('Print failed: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  const summaryCards = [
    { label: 'إجمالي المبيعات (صافي)', value: formatEGP(stats.total), icon: DollarSign, color: 'text-green-600', bg: 'bg-green-500/10' },
    { label: 'عدد الفواتير', value: formatNumber(stats.count), icon: Receipt, color: 'text-blue-600', bg: 'bg-blue-500/10' },
    { label: 'متوسط الفاتورة', value: formatEGP(stats.avg), icon: Percent, color: 'text-purple-600', bg: 'bg-purple-500/10' },
    { label: 'إجمالي الأرباح', value: formatEGP(stats.profit), icon: TrendingUp, color: 'text-amber-600', bg: 'bg-amber-500/10' },
    { label: 'إجمالي المرتجعات', value: formatEGP(stats.refunded), icon: Undo2, color: 'text-orange-600', bg: 'bg-orange-500/10' },
  ]

  return (
    <div className="module-page p-4 md:p-6 space-y-6 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="uk-page-header flex flex-col md:flex-row md:items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShoppingCart className="w-6 h-6 text-primary" />
            المبيعات
          </h1>
          <p className="text-muted-foreground text-sm">إدارة الفواتير والمرتجعات</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={exportCSV}>
            <Download className="w-4 h-4" />
            تصدير CSV
          </Button>
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw className="w-4 h-4" />
            تحديث
          </Button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {summaryCards.map((s, i) => {
          const Icon = s.icon
          return (
            <div key={i} className={`unikasher-card ${KPI_TINTS[i % KPI_TINTS.length]} p-4`}>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium opacity-70">{s.label}</p>
                  <div className="w-8 h-8 rounded-lg bg-white/70 dark:bg-black/20 flex items-center justify-center shadow-sm">
                    <Icon className="w-4 h-4" strokeWidth={2.25} />
                  </div>
                </div>
                <p className="text-lg font-bold pos-number">{s.value}</p>
              </div>
          )
        })}
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-3">
            {/* Period */}
            <div className="flex gap-1 bg-muted p-1 rounded-lg w-full md:w-fit">
              {PERIODS.map((p) => (
                <button
                  key={p.value}
                  onClick={() => setPeriod(p.value)}
                  className={`flex-1 md:flex-none px-3 py-1.5 text-sm rounded-md transition-colors ${
                    period === p.value ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {/* Search */}
            <div className="relative flex-1">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="بحث برقم الفاتورة..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pr-10"
              />
            </div>
            {/* Payment */}
            <Select value={paymentMethod} onValueChange={setPaymentMethod}>
              <SelectTrigger className="w-full md:w-44">
                <SelectValue placeholder="كل الطرق" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الطرق</SelectItem>
                {Object.entries(PAYMENT_METHOD_META).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Sales table */}
      {loading ? (
        <Card>
          <CardContent className="p-4 space-y-2">
            {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
          </CardContent>
        </Card>
      ) : sales.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center uk-empty">
            <Receipt className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">لا توجد فواتير في الفترة المحددة</p>
            <p className="text-xs text-muted-foreground mt-1">جرّب توسيع نطاق التاريخ، أو اعمل فاتورة جديدة من نقطة البيع (F2 للانتقال السريع).</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="md:flex md:flex-col md:flex-1 md:min-h-0">
          <CardContent className="p-0 md:flex-1 md:min-h-0 md:flex md:flex-col">
            {/* Desktop */}
            <div className="hidden md:flex md:flex-col md:flex-1 md:min-h-0">
              <DataTable
                maxHeight="500px"
                minWidth="min-w-[1000px]"
                columns={[
                  { key: 'invoice', header: 'رقم الفاتورة', render: (s) => (
                    <span className="font-mono font-medium">{s.invoiceNumber}</span>
                  ) },
                  { key: 'date', header: 'التاريخ', render: (s) => (
                    <span className="text-sm">{formatDateTime(s.createdAt)}</span>
                  ) },
                  { key: 'customer', header: 'العميل', render: (s) => (
                    s.customer?.name || <span className="text-muted-foreground">عميل نقدي</span>
                  ) },
                  { key: 'cashier', header: 'الكاشير', render: (s) => (
                    <span className="text-sm">{s.user?.name || '—'}</span>
                  ) },
                  { key: 'items', header: 'الأصناف', align: 'center', render: (s) => {
                    const itemCount = (s.items || []).reduce((sum, it) => sum + it.quantity, 0)
                    return <span className="text-sm pos-number">{formatNumber(itemCount)}</span>
                  } },
                  { key: 'total', header: 'الإجمالي', align: 'left', render: (s) => {
                    const refunded = getRefundedTotal(s)
                    const net = getNetTotal(s)
                    return refunded > 0 ? (
                      <div>
                        <div className="text-xs text-muted-foreground line-through">{formatEGP(s.total)}</div>
                        <div className="font-bold pos-number">{formatEGP(net)}</div>
                        <div className="text-xs text-orange-600">مرتجع: {formatEGP(refunded)}</div>
                      </div>
                    ) : <span className="font-bold pos-number">{formatEGP(s.total)}</span>
                  } },
                  { key: 'payment', header: 'طريقة الدفع', align: 'center', render: (s) => {
                    const pmMeta = PAYMENT_METHOD_META[s.paymentMethod ?? ''] || { label: s.paymentMethod ?? '', color: '', icon: DollarSign }
                    const PmIcon = pmMeta.icon
                    return (
                      <Badge variant="outline" className={pmMeta.color}>
                        <PmIcon className="w-3 h-3" />
                        {pmMeta.label}
                      </Badge>
                    )
                  } },
                  { key: 'status', header: 'الحالة', align: 'center', render: (s) => getStatusBadge(s.status) },
                  { key: 'actions', header: 'إجراءات', align: 'center', render: (s) => (
                    <div className="flex items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openDetail(s.id)} aria-label={`عرض تفاصيل الفاتورة ${s.invoiceNumber}`}><Eye className="w-4 h-4" /></Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => handlePrint(s)} aria-label={`طباعة الفاتورة ${s.invoiceNumber}`}><Printer className="w-4 h-4" /></Button>
                      {s.status !== 'REFUNDED' && (
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-orange-600" onClick={() => openRefund(s)} aria-label={`استرجاع الفاتورة ${s.invoiceNumber}`}><Undo2 className="w-4 h-4" /></Button>
                      )}
                    </div>
                  ) },
                ]}
                rows={sales}
                onRowClick={(s) => openDetail(s.id)}
              />
            </div>

            {/* Mobile */}
            <div className="md:hidden divide-y">
              {sales.map((s) => {
                const pmMeta = PAYMENT_METHOD_META[s.paymentMethod ?? ''] || { label: s.paymentMethod ?? '', color: '', icon: DollarSign }
                const PmIcon = pmMeta.icon
                const refunded = getRefundedTotal(s)
                const net = getNetTotal(s)
                return (
                  <div key={s.id} className="p-4 cursor-pointer hover:bg-muted/30" onClick={() => openDetail(s.id)}>
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div>
                        <p className="font-mono font-medium text-sm">{s.invoiceNumber}</p>
                        <p className="text-xs text-muted-foreground">{formatDateTime(s.createdAt)}</p>
                      </div>
                      <div className="text-left">
                        {refunded > 0 ? (
                          <>
                            <p className="text-xs text-muted-foreground line-through pos-number">{formatEGP(s.total)}</p>
                            <p className="font-bold pos-number">{formatEGP(net)}</p>
                          </>
                        ) : (
                          <p className="font-bold pos-number">{formatEGP(s.total)}</p>
                        )}
                        {getStatusBadge(s.status)}
                      </div>
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-xs text-muted-foreground">{s.customer?.name || 'عميل نقدي'}</span>
                      <Badge variant="outline" className={pmMeta.color}>
                        <PmIcon className="w-3 h-3" />
                        {pmMeta.label}
                      </Badge>
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Detail Dialog */}
      <Dialog open={!!detail || detailLoading} onOpenChange={(o) => { if (!o) { setDetail(null); setDetailLoading(false) } }}>
        <DialogContent className="w-[calc(100%-2rem)] max-w-4xl min-w-0 overflow-x-hidden overflow-y-auto max-h-[90vh]">
          {detailLoading ? (
            <div className="py-8">
              <Skeleton className="h-8 w-48 mb-4" />
              <Skeleton className="h-32 w-full mb-4" />
              <Skeleton className="h-64 w-full" />
            </div>
          ) : detail ? (
            <div className="w-full min-w-0 max-w-full overflow-hidden">
              <SaleDetail
                sale={detail}
                onClose={() => setDetail(null)}
                onPrint={() => handlePrint(detail)}
                onRefund={() => { setDetail(null); openRefund(detail) }}
              />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Refund Dialog */}
      <RefundDialog
        sale={refundTarget}
        open={refundOpen}
        onClose={() => { setRefundOpen(false); setRefundTarget(null) }}
        onDone={() => { setRefundOpen(false); setRefundTarget(null); load() }}
      />
    </div>
  )
}

// ============ SALE DETAIL ============
function SaleDetail({ sale, onClose, onPrint, onRefund }: {
  sale: SaleRow
  onClose: () => void
  onPrint: () => void
  onRefund: () => void
}) {
  const pmMeta = PAYMENT_METHOD_META[sale.paymentMethod] || { label: sale.paymentMethod, color: '', icon: DollarSign }
  const PmIcon = pmMeta.icon
  const itemCount = (sale.items || []).reduce((sum, it) => sum + it.quantity, 0)
  const hasReturns = (sale.returns || []).length > 0
  const totalRefunded = (sale.returns || []).reduce((s, r) => s + (r.total || 0), 0)

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Receipt className="w-5 h-5" />
          {sale.invoiceNumber}
        </DialogTitle>
        <DialogDescription>تفاصيل الفاتورة</DialogDescription>
      </DialogHeader>

      {/* Meta info */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <div>
          <p className="text-xs text-muted-foreground">التاريخ</p>
          <p className="font-medium">{formatDateTime(sale.createdAt)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">الكاشير</p>
          <p className="font-medium">{sale.user?.name || '—'}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">العميل</p>
          <p className="font-medium">{sale.customer?.name || 'عميل نقدي'}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">الدرج</p>
          <p className="font-medium">{sale.register?.name || '—'}</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {getStatusBadge(sale.status)}
        <Badge variant="outline" className={pmMeta.color}>
          <PmIcon className="w-3 h-3" />
          {pmMeta.label}
        </Badge>
        {hasReturns && (
          <Badge className="bg-orange-500/10 text-orange-700 border-orange-500/20">
            مرتجع: {formatEGP(totalRefunded)}
          </Badge>
        )}
      </div>

      <Separator />

      {/* Items */}
      <div>
        <p className="text-sm font-semibold mb-2">الأصناف ({formatNumber(itemCount)})</p>
        <div className="w-full min-w-0 max-w-full overflow-hidden">
          <DataTable
            maxHeight="480px"
            minWidth="min-w-[560px]"
            className="w-full min-w-0 max-w-full"
            columns={[
            { key: 'c0', header: 'الصنف', cellClassName: "font-medium", render: (it) => (
                <>{it.product?.nameAr || it.product?.name || '—'}
                                    {/* سعر وحدة = صفر هو المؤشر الوحيد المتاح حاليًا لصنف
                                        اتاخد بالنقاط (استبدال بالنقاط في شاشة الكاشير) —
                                        نوضحه هنا عشان محدش يفتكرها خصم أو غلطة. */}
                                    {it.unitPrice === 0 && (
                                      <Badge className="mr-1.5 bg-amber-500 hover:bg-amber-500 text-white text-[9px] px-1 py-0 h-4 align-middle">
                                        بالنقاط
                                      </Badge>
                                    )}
                                    {it.product?.sku && <span className="text-xs text-muted-foreground block font-mono">{it.product.sku}</span>}</>
              ) },
            { key: 'c1', header: 'الكمية', align: 'center', cellClassName: "pos-number", render: (it) => formatNumber(it.quantity) },
            { key: 'c2', header: 'السعر', align: 'left', cellClassName: "pos-number", render: (it) => formatEGP(it.unitPrice) },
            { key: 'c3', header: 'الضريبة', align: 'left', cellClassName: "text-sm text-muted-foreground pos-number", render: (it) => formatEGP(it.taxAmount) },
            { key: 'c4', header: 'الإجمالي', align: 'left', cellClassName: "font-bold pos-number", render: (it) => formatEGP(it.total) },
          ]}
            rows={(sale.items || [])}
          />
        </div>
      </div>

      <Separator />

      {/* Totals & Payments */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1.5 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">الإجمالي الفرعي</span><span className="pos-number">{formatEGP(sale.subtotal)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">الخصم</span><span className="pos-number text-red-600">- {formatEGP(sale.discountAmount)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">الضريبة</span><span className="pos-number">{formatEGP(sale.taxAmount)}</span></div>
          <Separator />
          <div className="flex justify-between font-bold text-base">
            <span>الإجمالي</span>
            <span className="pos-number text-primary">{formatEGP(sale.total)}</span>
          </div>
          <div className="flex justify-between text-sm"><span className="text-muted-foreground">المدفوع</span><span className="pos-number">{formatEGP(sale.paidAmount)}</span></div>
          {sale.changeAmount > 0 && (
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">الباقي</span><span className="pos-number">{formatEGP(sale.changeAmount)}</span></div>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-sm font-semibold">المدفوعات</p>
          {(sale.payments || []).length > 0 ? (
            <div className="space-y-1.5">
              {(sale.payments || []).map((p, i: number) => {
                const m = (p.method ? PAYMENT_METHOD_META[p.method] : undefined) || { label: p.method, color: '', icon: DollarSign }
                const Icon = m.icon
                return (
                  <div key={i} className="flex items-center justify-between rounded-md border p-2 text-sm">
                    <Badge variant="outline" className={m.color}>
                      <Icon className="w-3 h-3" />
                      {m.label}
                    </Badge>
                    <span className="font-medium pos-number">{formatEGP(p.amount)}</span>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">لا تفاصيل مدفوعات</p>
          )}

          {(sale.loyaltyEarned > 0 || sale.loyaltyRedeemed > 0) && (
            <div className="rounded-md bg-amber-500/10 border border-amber-500/20 p-2 text-sm space-y-1">
              <p className="font-medium text-amber-800">معلومات الولاء</p>
              {sale.loyaltyEarned > 0 && (
                <div className="flex justify-between"><span className="text-muted-foreground">نقاط مكتسبة</span><span className="font-medium">+{sale.loyaltyEarned}</span></div>
              )}
              {sale.loyaltyRedeemed > 0 && (
                <div className="flex justify-between"><span className="text-muted-foreground">نقاط مستبدلة</span><span className="font-medium">-{sale.loyaltyRedeemed}</span></div>
              )}
            </div>
          )}
        </div>
      </div>

      {sale.note && (
        <>
          <Separator />
          <div>
            <p className="text-sm font-semibold mb-1">ملاحظات</p>
            <p className="text-sm text-muted-foreground">{sale.note}</p>
          </div>
        </>
      )}

      <DialogFooter className="gap-2">
        <Button variant="outline" onClick={onClose}>إغلاق</Button>
        {sale.status !== 'REFUNDED' && (
          <Button variant="outline" className="text-orange-600 border-orange-500/30" onClick={onRefund}>
            <Undo2 className="w-4 h-4" />
            استرجاع
          </Button>
        )}
        <Button onClick={onPrint}>
          <Printer className="w-4 h-4" />
          طباعة
        </Button>
      </DialogFooter>
    </>
  )
}

// ============ REFUND DIALOG ============
function RefundDialog({ sale, open, onClose, onDone }: {
  sale: SaleRow | null
  open: boolean
  onClose: () => void
  onDone: () => void
}) {
  const { user } = useAuthStore()
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [reason, setReason] = useState('')
  const [reasonNote, setReasonNote] = useState('')
  const [refundMethod, setRefundMethod] = useState('CASH')
  const [saving, setSaving] = useState(false)
  const [freshSale, setFreshSale] = useState<SaleRow | null>(null)
  const [loadingSale, setLoadingSale] = useState(false)

  // BUG FIX: `sale` here can come straight from the sales list (no `returns`
  // relation included), so the dialog previously had no idea how much of
  // each item was already refunded in an earlier partial return and let the
  // max input go up to the full original quantity. Always re-fetch the sale
  // with its `returns` included when the dialog opens, so remaining
  // refundable quantities are accurate regardless of how it was opened.
  useEffect(() => {
    let cancelled = false
    if (sale?.id && open) {
      setLoadingSale(true)
      apiFetch(`/sales/${sale.id}`)
        .then((data) => { if (!cancelled) setFreshSale(data) })
        .catch(() => { if (!cancelled) setFreshSale(sale) })
        .finally(() => { if (!cancelled) setLoadingSale(false) })
    } else if (!open) {
      setFreshSale(null)
    }
    return () => { cancelled = true }
  }, [sale?.id, open])

  const effectiveSale = freshSale || sale

  // Already-returned quantity per sale item, from previous COMPLETED returns.
  const alreadyReturnedByItem = useMemo(() => {
    const map: Record<string, number> = {}
    for (const ret of (effectiveSale?.returns || [])) {
      if (ret.status !== 'COMPLETED') continue
      for (const ri of (ret.items || [])) {
        map[ri.saleItemId] = (map[ri.saleItemId] || 0) + ri.quantity
      }
    }
    return map
  }, [effectiveSale])

  useEffect(() => {
    if (effectiveSale) {
      const init: Record<string, number> = {}
      ;(effectiveSale.items || []).forEach((it) => { init[it.id] = 0 })
      setQuantities(init)
      setReason('')
      setReasonNote('')
      setRefundMethod(effectiveSale.paymentMethod || 'CASH')
    }
  }, [effectiveSale?.id])

  const refundItems = useMemo(() => {
    if (!effectiveSale) return []
    return (effectiveSale.items || [])
      .map((it) => ({ ...it, refundQty: quantities[it.id] || 0 }))
      .filter((it) => it.refundQty > 0)
  }, [effectiveSale, quantities])

  const refundTotal = refundItems.reduce((s, it) => {
    const unitTotal = it.total / it.quantity
    return s + unitTotal * it.refundQty
  }, 0)

  const handleSubmit = async () => {
    if (!effectiveSale) return
    if (refundItems.length === 0) {
      toast.error('اختر صنفاً واحداً على الأقل للاسترجاع')
      return
    }
    if (!reason) {
      toast.error('اختر سبب الاسترجاع')
      return
    }
    // Validate quantities against what's actually still refundable
    // (original quantity minus what was already returned in earlier
    // partial refunds), not just the original sold quantity.
    for (const it of refundItems) {
      const remaining = it.quantity - (alreadyReturnedByItem[it.id] || 0)
      if (it.refundQty > remaining) {
        toast.error(`الكمية المتاحة للاسترجاع لـ ${it.product?.nameAr || it.product?.name}: ${remaining}`)
        return
      }
    }
    setSaving(true)
    try {
      // Idempotency: stable clientTxnId survives retries. The refund endpoint
      // writes sale_returns + sale_return_items + reverses stock_movements +
      // reverses loyalty_transactions + (if cash) inserts a REFUND cash_movement
      // + queues a sync op. A duplicate refund would silently double-reverse
      // stock and double-credit loyalty, so we guard with X-Client-Txn-Id
      // server-side AND body.clientTxnId for the desktop SQLite handler.
      const clientTxnId = generateUUID()
      await apiFetch(`/sales/${effectiveSale.id}/refund`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Txn-Id': clientTxnId,
        },
        body: JSON.stringify({
          items: refundItems.map((it) => ({ saleItemId: it.id, quantity: it.refundQty })),
          reason: reasonNote ? `${reason} - ${reasonNote}` : reason,
          refundMethod,
          userId: user?.id,
          clientTxnId,
        }),
      })
      toast.success('تم معالجة المرتجع بنجاح')
      onDone()
    } catch (e) {
      notifyError(e)
    } finally {
      setSaving(false)
    }
  }

  if (!sale) return null

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-3xl min-w-0 overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Undo2 className="w-5 h-5 text-orange-600" />
            استرجاع فاتورة
          </DialogTitle>
          <DialogDescription>
            {sale.invoiceNumber} — إجمالي: {formatEGP(sale.total)}
          </DialogDescription>
        </DialogHeader>

        {loadingSale || !effectiveSale ? (
          <div className="py-8 text-center text-sm text-muted-foreground">جاري تحميل بيانات الفاتورة...</div>
        ) : (
        <ScrollArea className="max-h-[70vh]">
          <div className="space-y-4 pr-1">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 rounded-lg bg-muted/30">
            <div>
              <p className="text-xs text-muted-foreground">الفاتورة</p>
              <p className="text-sm font-medium font-mono">{effectiveSale.invoiceNumber}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">العميل</p>
              <p className="text-sm">{effectiveSale.customer?.name || 'عميل نقدي'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">التاريخ</p>
              <p className="text-sm">{formatDateTime(effectiveSale.createdAt)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">الحالة</p>
              <div className="mt-1">{getStatusBadge(effectiveSale.status)}</div>
            </div>
          </div>

          <div>
            <p className="text-sm font-semibold mb-2">الأصناف المراد استرجاعها</p>
            <p className="text-xs text-muted-foreground mb-2">حدد الكميات المراد استرجاعها:</p>
            <div className="w-full min-w-0 max-w-full overflow-hidden rounded-md border">
              <DataTable
              maxHeight="480px"
              minWidth="min-w-[560px]"
              className="w-full min-w-0 max-w-full"
              columns={[
              { key: 'c0', header: 'الصنف', cellClassName: "font-medium", render: (it) => (
                  <>{it.product?.nameAr || it.product?.name || '—'}
                                          <span className="text-xs text-muted-foreground block pos-number">{formatEGP(it.unitPrice)} / وحدة</span></>
                ) },
              { key: 'c1', header: 'المباعة', align: 'center', cellClassName: "pos-number", render: (it) => formatNumber(it.quantity) },
              { key: 'c2', header: 'متاح للاسترجاع', align: 'center', cellClassName: "pos-number", render: (it) => {
                  const qty = quantities[it.id] || 0
                                    const alreadyReturned = alreadyReturnedByItem[it.id] || 0
                                    const max = Math.max(0, it.quantity - alreadyReturned)
                                    const unitTotal = it.total / it.quantity
                  return (
                  <>{max}
                                          {alreadyReturned > 0 && (
                                            <span className="text-xs text-muted-foreground block">(مرتجع سابقًا: {alreadyReturned})</span>
                                          )}</>
                  )
                } },
              { key: 'c3', header: 'الكمية', align: 'center', render: (it) => {
                  const qty = quantities[it.id] || 0
                                    const alreadyReturned = alreadyReturnedByItem[it.id] || 0
                                    const max = Math.max(0, it.quantity - alreadyReturned)
                                    const unitTotal = it.total / it.quantity
                  return (
                  <Input
                                            type="number"
                                            min={0}
                                            max={max}
                                            value={qty}
                                            disabled={max === 0}
                                            onChange={(e) => {
                                              const v = Math.min(Math.max(parseInt(e.target.value) || 0, 0), max)
                                              setQuantities({ ...quantities, [it.id]: v })
                                            }}
                                            className="w-20 mx-auto text-center"
                                          />
                  )
                } },
              { key: 'c4', header: 'الإجمالي', align: 'left', cellClassName: "font-bold pos-number", render: (it) => {
                  const qty = quantities[it.id] || 0
                                    const alreadyReturned = alreadyReturnedByItem[it.id] || 0
                                    const max = Math.max(0, it.quantity - alreadyReturned)
                                    const unitTotal = it.total / it.quantity
                  return (
                  formatEGP(unitTotal * qty)
                  )
                } },
            ]}
              rows={(effectiveSale.items || [])}
            />
          </div>

          <div className="rounded-lg bg-orange-500/10 border border-orange-500/20 p-3 flex justify-between items-center">

            <span className="text-sm font-medium">إجمالي الاسترجاع</span>
            <span className="text-lg font-bold text-orange-700 pos-number">{formatEGP(refundTotal)}</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">

            <div className="space-y-1.5">
              <Label>طريقة استرجاع المبلغ</Label>
              <Select value={refundMethod} onValueChange={setRefundMethod}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="CASH">نقدي</SelectItem>
                  <SelectItem value="CARD">بطاقة</SelectItem>
                  <SelectItem value="TRANSFER">تحويل</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>سبب الاسترجاع *</Label>
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger className="w-full"><SelectValue placeholder="اختر السبب" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="DEFECTIVE">منتج معيب</SelectItem>
                  <SelectItem value="WRONG_ITEM">صنف خاطئ</SelectItem>
                  <SelectItem value="CUSTOMER_RETURN">استرجاع العميل</SelectItem>
                  <SelectItem value="DAMAGED">تالف</SelectItem>
                  <SelectItem value="OTHER">أخرى</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>ملاحظات إضافية</Label>
            <Textarea
              value={reasonNote}
              onChange={(e) => setReasonNote(e.target.value)}
              rows={2}
              placeholder="تفاصيل إضافية عن سبب الاسترجاع..."
            />
          </div>
        </div>
        </ScrollArea>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>إلغاء</Button>
          <Button
            onClick={handleSubmit}
            disabled={saving || loadingSale || refundItems.length === 0}
            className="bg-orange-600 hover:bg-orange-700 text-white"
          >
            <Undo2 className="w-4 h-4" />
            {saving ? 'جاري المعالجة...' : `تأكيد الاسترجاع (${formatEGP(refundTotal)})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
