'use client'

import { logger } from '../../lib/logger'
import { useEffect, useState, useMemo, useCallback } from 'react'
import { apiFetch, formatEGP, formatNumber, formatDateTime } from '@/lib/api'
import { useDebounce } from '@/hooks/use-debounce'
import { generateUUID } from '@/lib/ids'
import { useAuthStore } from '@/lib/store'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select'
import {
  ShoppingCart, Plus, Search, RefreshCw, Trash2, Eye,
  Wallet, FileText, TrendingUp, Printer, HandCoins,
} from 'lucide-react'
import { toast } from 'sonner'
import type { Purchase, PurchaseItem, Supplier, Product } from '@/lib/types'

type PurchaseRow = Omit<Purchase, 'items'> & { items?: Array<PurchaseItem & { product?: { id?: string; name?: string; nameAr?: string | null; sku?: string } | null }>; user?: { name?: string } | null; createdAt?: string }
import { notifyError } from '@/lib/notify'
import { PurchaseInvoicePrint } from './purchase-invoice-print'
import { DataTable } from '@/components/ui/data-table'

const KPI_TINTS = ['kpi-tint-blue', 'kpi-tint-green', 'kpi-tint-purple', 'kpi-tint-yellow', 'kpi-tint-pink', 'kpi-tint-teal']

const STATUS_META: Record<string, { label: string; className: string }> = {
  PENDING: { label: 'قيد الانتظار', className: 'bg-gray-500/10 text-gray-700 border-gray-500/20' },
  RECEIVED: { label: 'مستلمة', className: 'bg-blue-500/10 text-blue-700 border-blue-500/20' },
  PARTIAL: { label: 'مدفوعة جزئياً', className: 'bg-amber-500/10 text-amber-700 border-amber-500/20' },
  PAID: { label: 'مدفوعة', className: 'bg-green-500/10 text-green-700 border-green-500/20' },
}

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] || STATUS_META.PENDING
  return <Badge variant="outline" className={meta.className}>{meta.label}</Badge>
}

interface LineItem {
  productId: string
  name: string
  sku?: string
  quantity: string
  unitCost: string
}

export function PurchasesModule() {
  const { user } = useAuthStore()
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [_warehouses, setWarehouses] = useState<Array<{ id: string; name?: string; nameAr?: string }>>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [supplierFilter, setSupplierFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [detail, setDetail] = useState<PurchaseRow | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [printTarget, setPrintTarget] = useState<PurchaseRow | null>(null)
  const [payTarget, setPayTarget] = useState<PurchaseRow | null>(null)
  const [payAmount, setPayAmount] = useState('')
  const [paySource, setPaySource] = useState('CASHBOX')
  const [paying, setPaying] = useState(false)

  // Create form state
  const [cf, setCf] = useState({
    supplierId: '', warehouseId: '', note: '',
    taxAmount: '0', discountAmount: '0', paidAmount: '0', paymentMethod: 'CASHBOX',
  })
  const [lineItems, setLineItems] = useState<LineItem[]>([])
  const [productSearch, setProductSearch] = useState('')

  const debouncedSearch = useDebounce(search, 350)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (supplierFilter !== 'all') params.set('supplierId', supplierFilter)
      if (statusFilter !== 'all') params.set('status', statusFilter)
      if (dateFrom) params.set('dateFrom', dateFrom)
      if (dateTo) params.set('dateTo', dateTo)
      params.set('limit', '500')
      const data = await apiFetch(`/purchases?${params.toString()}`)
      // client-side search on invoice number / supplier name
      let list = data || []
      if (debouncedSearch) {
        const q = debouncedSearch.toLowerCase()
        list = list.filter((p) =>
          p.invoiceNumber?.toLowerCase().includes(q) ||
          p.supplier?.name?.toLowerCase().includes(q)
        )
      }
      setPurchases(list)
    } catch (e) {
      notifyError(e)
    } finally {
      setLoading(false)
    }
  }, [supplierFilter, statusFilter, dateFrom, dateTo, debouncedSearch])

  const loadMeta = async () => {
    try {
      const [sups, prods] = await Promise.all([
        apiFetch('/suppliers?limit=500'),
        apiFetch('/products?limit=500'),
      ])
      setSuppliers(sups || [])
      setProducts(prods || [])
      // try warehouses via inventory
      try {
        const inv = await apiFetch('/inventory?limit=1') as { products?: Array<{ stockLevels?: Array<{ warehouseId?: string | null; warehouse?: { name?: string | null } | null }> }> } | null
        const whSet = new Map<string, string>()
        inv?.products?.forEach((p) => {
          p.stockLevels?.forEach((sl) => {
            if (sl.warehouseId && !whSet.has(sl.warehouseId)) {
              whSet.set(sl.warehouseId, sl.warehouse?.name || sl.warehouseId)
            }
          })
        })
        const whArr = Array.from(whSet.entries()).map(([id, name]) => ({ id, name }))
        setWarehouses(whArr.length > 0 ? whArr : [{ id: 'main', name: 'المخزن الرئيسي' }])
      } catch {
        setWarehouses([{ id: 'main', name: 'المخزن الرئيسي' }])
      }
    } catch (e) {
      logger.warn(`meta load failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  useEffect(() => {
    load()
    loadMeta()
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const stats = useMemo(() => {
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const thisMonth = purchases.filter((p) => new Date(p.createdAt ?? 0) >= monthStart)
    const totalThisMonth = thisMonth.reduce((s, p) => s + p.total, 0)
    const totalDue = purchases.reduce((s, p) => s + (p.total - p.paidAmount), 0)
    const invoiceCount = purchases.length
    const avg = invoiceCount > 0 ? purchases.reduce((s, p) => s + p.total, 0) / invoiceCount : 0
    return { totalThisMonth, totalDue, invoiceCount, avg }
  }, [purchases])

  const summaryCards = [
    { label: 'مشتريات هذا الشهر', value: formatEGP(stats.totalThisMonth), icon: ShoppingCart, color: 'text-blue-600', bg: 'bg-blue-500/10' },
    { label: 'المستحق للموردين', value: formatEGP(stats.totalDue), icon: Wallet, color: 'text-orange-600', bg: 'bg-orange-500/10' },
    { label: 'عدد الفواتير', value: formatNumber(stats.invoiceCount), icon: FileText, color: 'text-purple-600', bg: 'bg-purple-500/10' },
    { label: 'متوسط الفاتورة', value: formatEGP(stats.avg), icon: TrendingUp, color: 'text-green-600', bg: 'bg-green-500/10' },
  ]

  const filteredProducts = useMemo(() => {
    if (!productSearch) return products.slice(0, 20)
    const q = productSearch.toLowerCase()
    return products.filter((p) =>
      p.name?.toLowerCase().includes(q) ||
      p.nameAr?.toLowerCase().includes(q) ||
      p.sku?.toLowerCase().includes(q) ||
      p.barcode?.toLowerCase().includes(q)
    ).slice(0, 20)
  }, [products, productSearch])

  const lineSubtotal = useMemo(() => {
    return lineItems.reduce((s, it) => s + (parseFloat(it.quantity || '0') * parseFloat(it.unitCost || '0')), 0)
  }, [lineItems])

  const grandTotal = useMemo(() => {
    const tax = parseFloat(cf.taxAmount || '0') || 0
    const disc = parseFloat(cf.discountAmount || '0') || 0
    return lineSubtotal + tax - disc
  }, [lineSubtotal, cf.taxAmount, cf.discountAmount])

  const addProduct = (p) => {
    if (lineItems.find((it) => it.productId === p.id)) {
      toast.error('المنتج مضاف بالفعل')
      return
    }
    setLineItems([
      ...lineItems,
      {
        productId: p.id,
        name: p.nameAr || p.name,
        sku: p.sku,
        quantity: '1',
        unitCost: String(p.purchaseCost ?? 0),
      },
    ])
    setProductSearch('')
  }

  const updateLine = (productId: string, field: keyof LineItem, value: string) => {
    setLineItems(lineItems.map((it) => it.productId === productId ? { ...it, [field]: value } : it))
  }

  const removeLine = (productId: string) => {
    setLineItems(lineItems.filter((it) => it.productId !== productId))
  }

  const resetCreate = () => {
    setCf({ supplierId: '', warehouseId: '', note: '', taxAmount: '0', discountAmount: '0', paidAmount: '0', paymentMethod: 'CASH' })
    setLineItems([])
    setProductSearch('')
  }

  const handleCreate = async () => {
    if (!cf.supplierId) { toast.error('اختر المورد'); return }
    if (!user?.id) { toast.error('مستخدم غير معروف'); return }
    if (lineItems.length === 0) { toast.error('أضف صنفاً واحداً على الأقل'); return }
    for (const it of lineItems) {
      if (parseFloat(it.quantity || '0') <= 0) { toast.error('الكمية يجب أن تكون أكبر من صفر'); return }
      if (parseFloat(it.unitCost || '0') < 0) { toast.error('التكلفة غير صالحة'); return }
    }
    setSaving(true)
    try {
      // Idempotency: stable clientTxnId survives retries so the server-side
      // cache (X-Client-Txn-Id header) and the desktop SQLite handler
      // (body.clientTxnId → purchases.client_txn_id + stock_movements.client_txn_id
      // + supplier balance movement + sync_queue.client_txn_id) return / queue
      // exactly one purchase invoice per user action, even on network blips.
      const clientTxnId = generateUUID()
      const created = await apiFetch('/purchases', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Txn-Id': clientTxnId,
        },
        body: JSON.stringify({
          supplierId: cf.supplierId,
          userId: user.id,
          items: lineItems.map((it) => ({
            productId: it.productId,
            quantity: it.quantity,
            unitCost: it.unitCost,
          })),
          taxAmount: cf.taxAmount,
          discountAmount: cf.discountAmount,
          paidAmount: cf.paidAmount,
          paymentSource: cf.paymentMethod,
          paymentMethod: cf.paymentMethod === 'CASHBOX' ? 'CASH' : cf.paymentMethod,
          note: cf.note || undefined,
          clientTxnId,
        }),
      })
      toast.success('تم إنشاء فاتورة الشراء بنجاح وتحديث المخزون')
      setCreateOpen(false)
      resetCreate()
      // Re-fetch the list so the invoice we print has the supplier/items
      // fully joined (the create response itself may be a lean echo of the
      // request body, especially offline) — then open the print dialog for
      // the invoice that was just created.
      try {
        const params = new URLSearchParams({ limit: '500' })
        const fresh = await apiFetch(`/purchases?${params.toString()}`)
        setPurchases(fresh || [])
        const match = (fresh || []).find((p) => p.id === created?.id)
        if (match) setPrintTarget(match)
      } catch {
        load()
      }
    } catch (e) {
      notifyError(e)
    } finally {
      setSaving(false)
    }
  }

  const handlePay = async () => {
    if (!payTarget) return
    const amount = parseFloat(payAmount || '0')
    const remaining = payTarget.total - payTarget.paidAmount
    if (!amount || amount <= 0) { toast.error('أدخل قيمة سداد صحيحة'); return }
    if (amount > remaining + 0.01) { toast.error('القيمة أكبر من المتبقي على الفاتورة'); return }
    setPaying(true)
    try {
      await apiFetch(`/purchases/${payTarget.id}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, paymentSource: paySource, paymentMethod: paySource === 'CASHBOX' ? 'CASH' : paySource, clientTxnId: generateUUID() }),
      })
      toast.success('تم تسجيل السداد بنجاح')
      setPayTarget(null)
      setPayAmount('')
      setPaySource('CASHBOX')
      load()
    } catch (e) {
      notifyError(e)
    } finally {
      setPaying(false)
    }
  }

  return (
    <div className="module-page p-4 md:p-6 space-y-6 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="uk-page-header flex flex-col md:flex-row md:items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShoppingCart className="w-6 h-6 text-primary" />
            المشتريات
          </h1>
          <p className="text-muted-foreground text-sm">إدارة فواتير الشراء من الموردين</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw className="w-4 h-4" />
            تحديث
          </Button>
          <Button size="sm" onClick={() => { resetCreate(); setCreateOpen(true) }}>
            <Plus className="w-4 h-4" />
            فاتورة شراء جديدة
          </Button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        {summaryCards.map((card, i) => {
          const Icon = card.icon
          return (
            <div key={i} className={`unikasher-card ${KPI_TINTS[i % KPI_TINTS.length]} p-4`}>
                <div className="w-10 h-10 rounded-xl bg-white/70 dark:bg-black/20 flex items-center justify-center mb-2.5 shadow-sm">
                  <Icon className="w-5 h-5" strokeWidth={2.25} />
                </div>
                <p className="text-xs font-medium opacity-70 mb-1">{card.label}</p>
                <p className="text-lg md:text-xl font-bold pos-number">{card.value}</p>
              </div>
          )
        })}
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="ابحث برقم الفاتورة أو المورد..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pr-9"
              />
            </div>
            <Select value={supplierFilter} onValueChange={setSupplierFilter}>
              <SelectTrigger className="md:w-48">
                <SelectValue placeholder="كل الموردين" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الموردين</SelectItem>
                {suppliers.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="md:w-44">
                <SelectValue placeholder="كل الحالات" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الحالات</SelectItem>
                <SelectItem value="PENDING">قيد الانتظار</SelectItem>
                <SelectItem value="RECEIVED">مستلمة</SelectItem>
                <SelectItem value="PARTIAL">مدفوعة جزئياً</SelectItem>
                <SelectItem value="PAID">مدفوعة</SelectItem>
              </SelectContent>
            </Select>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="md:w-40" />
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="md:w-40" />
          </div>
        </CardContent>
      </Card>

      {/* Table / Cards */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-14" />)}
        </div>
      ) : purchases.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <ShoppingCart className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>لا توجد فواتير شراء</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Desktop table */}
          <Card className="hidden md:block">
            <DataTable
              maxHeight="600px"
              columns={[
                { key: 'c0', header: 'رقم الفاتورة', cellClassName: "font-mono text-xs", render: (p) => p.invoiceNumber },
                { key: 'c1', header: 'المورد', cellClassName: "font-medium", render: (p) => p.supplier?.name || '—' },
                { key: 'c2', header: 'التاريخ', cellClassName: "text-sm text-muted-foreground", render: (p) => formatDateTime(p.createdAt) },
                { key: 'c3', header: 'الأصناف', align: 'center', cellClassName: "pos-number", render: (p) => formatNumber(p.items?.length || 0) },
                { key: 'c4', header: 'الإجمالي', align: 'center', cellClassName: "pos-number font-medium", render: (p) => formatEGP(p.total) },
                { key: 'c5', header: 'المدفوع', align: 'center', cellClassName: "pos-number text-green-600", render: (p) => formatEGP(p.paidAmount) },
                { key: 'c6', header: 'المتبقي', align: 'center', cellClassName: "pos-number text-orange-600", render: (p) => formatEGP(p.total - p.paidAmount) },
                { key: 'c7', header: 'الحالة', align: 'center', render: (p) => <StatusBadge status={p.status} /> },
                { key: 'c8', header: 'إجراءات', align: 'center', render: (p) => (
                    <div className="flex justify-center gap-1" onClick={(e) => e.stopPropagation()}>
                                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setDetail(p)} title="عرض">
                                                <Eye className="w-4 h-4" />
                                              </Button>
                                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setPrintTarget(p)} title="طباعة">
                                                <Printer className="w-4 h-4" />
                                              </Button>
                                              {p.total - p.paidAmount > 0 && (
                                                <Button
                                                  variant="ghost"
                                                  size="icon"
                                                  className="h-8 w-8 text-green-600"
                                                  onClick={() => { setPayTarget(p); setPayAmount(String((p.total - p.paidAmount).toFixed(2))) }}
                                                  title="سداد المتبقي"
                                                >
                                                  <HandCoins className="w-4 h-4" />
                                                </Button>
                                              )}
                                            </div>
                  ) },
              ]}
              rows={purchases}
              onRowClick={(p) => setDetail(p)}
            />
          </Card>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {purchases.map((p) => (
              <Card key={p.id} onClick={() => setDetail(p)} className="cursor-pointer">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="font-mono text-xs">{p.invoiceNumber}</p>
                      <p className="font-medium">{p.supplier?.name || '—'}</p>
                      <p className="text-xs text-muted-foreground">{formatDateTime(p.createdAt)}</p>
                    </div>
                    <StatusBadge status={p.status} />
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center mt-2">
                    <div>
                      <p className="text-xs text-muted-foreground">الإجمالي</p>
                      <p className="font-bold text-sm pos-number">{formatEGP(p.total)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">المدفوع</p>
                      <p className="font-bold text-sm pos-number text-green-600">{formatEGP(p.paidAmount)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">المتبقي</p>
                      <p className="font-bold text-sm pos-number text-orange-600">{formatEGP(p.total - p.paidAmount)}</p>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-3" onClick={(e) => e.stopPropagation()}>
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => setPrintTarget(p)}>
                      <Printer className="w-3.5 h-3.5 ml-1" />
                      طباعة
                    </Button>
                    {p.total - p.paidAmount > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 text-green-600 border-green-600/30"
                        onClick={() => { setPayTarget(p); setPayAmount(String((p.total - p.paidAmount).toFixed(2))) }}
                      >
                        <HandCoins className="w-3.5 h-3.5 ml-1" />
                        سداد
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* Detail Dialog */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5" />
              {detail?.invoiceNumber}
              {detail?.status && <StatusBadge status={detail.status} />}
            </DialogTitle>
            <DialogDescription>
              {detail?.supplier?.name} — {detail ? formatDateTime(detail.createdAt) : ''}
            </DialogDescription>
          </DialogHeader>

          {detail && (
            <ScrollArea className="max-h-[70vh]">
              <div className="space-y-4 pr-1">
                {/* Meta */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 rounded-lg bg-muted/30">
                  <div>
                    <p className="text-xs text-muted-foreground">المستخدم</p>
                    <p className="text-sm">{detail.user?.name || '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">عدد الأصناف</p>
                    <p className="text-sm pos-number">{formatNumber(detail.items?.length || 0)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">التاريخ</p>
                    <p className="text-sm">{formatDateTime(detail.createdAt)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">ملاحظة</p>
                    <p className="text-sm">{detail.note || '—'}</p>
                  </div>
                </div>

                {/* Items */}
                <div className="rounded-md border">
                  <DataTable
                    maxHeight="480px"
                    columns={[
                      { key: 'c0', header: 'المنتج', cellClassName: "font-medium", render: (it) => (
                          <>{it.product?.nameAr || it.product?.name || '—'}
                                                      <p className="text-xs text-muted-foreground font-mono">{it.product?.sku}</p></>
                        ) },
                      { key: 'c1', header: 'الكمية', align: 'center', cellClassName: "pos-number", render: (it) => formatNumber(it.quantity) },
                      { key: 'c2', header: 'التكلفة', align: 'center', cellClassName: "pos-number", render: (it) => formatEGP(it.unitCost) },
                      { key: 'c3', header: 'الإجمالي', align: 'center', cellClassName: "pos-number font-medium", render: (it) => formatEGP(it.total) },
                    ]}
                    rows={detail.items ?? []}
                  />
                </div>

                {/* Totals */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="p-3 rounded-lg bg-blue-500/5 border border-blue-500/20 text-center">
                    <p className="text-xs text-muted-foreground">الإجمالي الفرعي</p>
                    <p className="font-bold pos-number">{formatEGP(detail.subtotal)}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-purple-500/5 border border-purple-500/20 text-center">
                    <p className="text-xs text-muted-foreground">الضريبة</p>
                    <p className="font-bold pos-number">{formatEGP(detail.taxAmount)}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-orange-500/5 border border-orange-500/20 text-center">
                    <p className="text-xs text-muted-foreground">الخصم</p>
                    <p className="font-bold pos-number">{formatEGP(detail.discountAmount)}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-green-500/5 border border-green-500/20 text-center">
                    <p className="text-xs text-muted-foreground">الإجمالي</p>
                    <p className="font-bold pos-number">{formatEGP(detail.total)}</p>
                  </div>
                </div>

                <Separator />

                <div className="grid grid-cols-3 gap-3">
                  <div className="p-3 rounded-lg bg-green-500/5 border border-green-500/20 text-center">
                    <p className="text-xs text-muted-foreground">المدفوع</p>
                    <p className="font-bold pos-number text-green-700">{formatEGP(detail.paidAmount)}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-orange-500/5 border border-orange-500/20 text-center">
                    <p className="text-xs text-muted-foreground">المتبقي</p>
                    <p className="font-bold pos-number text-orange-700">{formatEGP(detail.total - detail.paidAmount)}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/30 border text-center">
                    <p className="text-xs text-muted-foreground">الحالة</p>
                    <div className="mt-1 flex justify-center"><StatusBadge status={detail.status} /></div>
                  </div>
                </div>
              </div>
            </ScrollArea>
          )}
          <DialogFooter>
            {detail && detail.total - detail.paidAmount > 0 && (
              <Button
                variant="outline"
                className="text-green-600 border-green-600/30"
                onClick={() => { setPayTarget(detail); setPayAmount(String((detail.total - detail.paidAmount).toFixed(2))); setDetail(null) }}
              >
                <HandCoins className="w-4 h-4 ml-2" />
                سداد المتبقي
              </Button>
            )}
            <Button onClick={() => { setPrintTarget(detail); setDetail(null) }}>
              <Printer className="w-4 h-4 ml-2" />
              طباعة الفاتورة
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="w-5 h-5" />
              فاتورة شراء جديدة
            </DialogTitle>
            <DialogDescription>أضف الأصناف وحدد المورد وسيتم تحديث المخزون تلقائياً</DialogDescription>
          </DialogHeader>

          <ScrollArea className="max-h-[70vh]">
            <div className="space-y-4 pr-1">
              {/* Supplier */}
              <div className="grid grid-cols-1 gap-3">
                <div className="grid gap-2">
                  <Label>المورد *</Label>
                  <Select value={cf.supplierId} onValueChange={(v) => setCf({ ...cf, supplierId: v })}>
                    <SelectTrigger><SelectValue placeholder="اختر المورد" /></SelectTrigger>
                    <SelectContent>
                      {suppliers.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Product search */}
              <div className="space-y-2">
                <Label>إضافة أصناف</Label>
                <div className="relative">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="ابحث عن منتج بالاسم أو SKU أو الباركود..."
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    className="pr-9"
                  />
                </div>
                {productSearch && (
                  <div className="rounded-md border max-h-48 overflow-y-auto">
                    {filteredProducts.length === 0 ? (
                      <p className="p-3 text-sm text-muted-foreground text-center">لا توجد نتائج</p>
                    ) : (
                      filteredProducts.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => addProduct(p)}
                          className="w-full text-right p-2 hover:bg-muted/50 border-b last:border-0 flex items-center justify-between"
                        >
                          <div>
                            <p className="text-sm font-medium">{p.nameAr || p.name}</p>
                            <p className="text-xs text-muted-foreground font-mono">{p.sku}</p>
                          </div>
                          <div className="text-left">
                            <p className="text-xs text-muted-foreground">التكلفة</p>
                            <p className="text-sm pos-number">{formatEGP(p.purchaseCost || 0)}</p>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>

              {/* Line items */}
              {lineItems.length > 0 && (
                <div className="rounded-md border">
                  <DataTable
                    maxHeight="480px"
                    columns={[
                      { key: 'c0', header: 'المنتج', cellClassName: "font-medium", render: (it) => (
                          <>{it.name}
                                                        <p className="text-xs text-muted-foreground font-mono">{it.sku}</p></>
                        ) },
                      { key: 'c1', header: 'الكمية', align: 'center', width: "w-24", render: (it) => (
                          <Input
                                                          type="number"
                                                          value={it.quantity}
                                                          onChange={(e) => updateLine(it.productId, 'quantity', e.target.value)}
                                                          className="h-8 text-center"
                                                          min={1}
                                                        />
                        ) },
                      { key: 'c2', header: 'التكلفة', align: 'center', width: "w-32", render: (it) => (
                          <Input
                                                          type="number"
                                                          value={it.unitCost}
                                                          onChange={(e) => updateLine(it.productId, 'unitCost', e.target.value)}
                                                          className="h-8 text-center"
                                                          step="0.01"
                                                          min={0}
                                                        />
                        ) },
                      { key: 'c3', header: 'الإجمالي', align: 'center', width: "w-32", cellClassName: "pos-number font-medium", render: (it) => {
                          const total = (parseFloat(it.quantity || '0') * parseFloat(it.unitCost || '0')) || 0
                          return (
                          formatEGP(total)
                          )
                        } },
                      { key: 'c4', header: 'إجراءات', width: "w-10", render: (it) => (
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600" onClick={() => removeLine(it.productId)}>
                                                          <Trash2 className="w-4 h-4" />
                                                        </Button>
                        ) },
                    ]}
                    rows={lineItems}
                    rowKey={(it) => it.productId}
                  />
                </div>
              )}

              {/* Totals + payment */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-2">
                      <Label>الضريبة</Label>
                      <Input
                        type="number"
                        value={cf.taxAmount}
                        onChange={(e) => setCf({ ...cf, taxAmount: e.target.value })}
                        step="0.01"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label>الخصم</Label>
                      <Input
                        type="number"
                        value={cf.discountAmount}
                        onChange={(e) => setCf({ ...cf, discountAmount: e.target.value })}
                        step="0.01"
                      />
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Label>المبلغ المدفوع</Label>
                    <Input
                      type="number"
                      value={cf.paidAmount}
                      onChange={(e) => setCf({ ...cf, paidAmount: e.target.value })}
                      step="0.01"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>طريقة الدفع</Label>
                    <Select value={cf.paymentMethod} onValueChange={(v) => setCf({ ...cf, paymentMethod: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="CASHBOX">نقدي — من الخزنة</SelectItem>
                        <SelectItem value="OUTSIDE_CASH">نقدي — من خارج الخزنة</SelectItem>
                        <SelectItem value="CARD">بطاقة</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label>ملاحظة</Label>
                    <Textarea
                      value={cf.note}
                      onChange={(e) => setCf({ ...cf, note: e.target.value })}
                      rows={2}
                      placeholder="ملاحظات إضافية"
                    />
                  </div>
                </div>
                <div className="p-4 rounded-lg bg-muted/30 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">الإجمالي الفرعي</span>
                    <span className="pos-number font-medium">{formatEGP(lineSubtotal)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">الضريبة</span>
                    <span className="pos-number font-medium">{formatEGP(parseFloat(cf.taxAmount || '0') || 0)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">الخصم</span>
                    <span className="pos-number font-medium text-orange-600">- {formatEGP(parseFloat(cf.discountAmount || '0') || 0)}</span>
                  </div>
                  <Separator />
                  <div className="flex justify-between text-base font-bold">
                    <span>الإجمالي</span>
                    <span className="pos-number text-green-700">{formatEGP(grandTotal)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">المدفوع</span>
                    <span className="pos-number font-medium text-green-600">{formatEGP(parseFloat(cf.paidAmount || '0') || 0)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">المتبقي</span>
                    <span className="pos-number font-medium text-orange-600">
                      {formatEGP(grandTotal - (parseFloat(cf.paidAmount || '0') || 0))}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </ScrollArea>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>إلغاء</Button>
            <Button onClick={handleCreate} disabled={saving}>
              {saving ? 'جاري الحفظ...' : 'حفظ الفاتورة'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Print Dialog — POS-style printable invoice */}
      {printTarget && (
        <PurchaseInvoicePrint purchase={printTarget} onClose={() => setPrintTarget(null)} />
      )}

      {/* Pay Remaining Balance Dialog */}
      <Dialog open={!!payTarget} onOpenChange={(o) => !o && setPayTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HandCoins className="w-5 h-5 text-green-600" />
              سداد المتبقي
            </DialogTitle>
            <DialogDescription>
              {payTarget?.invoiceNumber} — {payTarget?.supplier?.name || 'المورد'}
            </DialogDescription>
          </DialogHeader>

          {payTarget && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-muted/30 border text-center">
                  <p className="text-xs text-muted-foreground">الإجمالي</p>
                  <p className="font-bold pos-number">{formatEGP(payTarget.total)}</p>
                </div>
                <div className="p-3 rounded-lg bg-orange-500/5 border border-orange-500/20 text-center">
                  <p className="text-xs text-muted-foreground">المتبقي</p>
                  <p className="font-bold pos-number text-orange-700">{formatEGP(payTarget.total - payTarget.paidAmount)}</p>
                </div>
              </div>
              <div className="grid gap-2">
                <Label>مصدر السداد</Label>
                <Select value={paySource} onValueChange={setPaySource}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CASHBOX">من الخزنة</SelectItem>
                    <SelectItem value="OUTSIDE_CASH">من خارج الخزنة</SelectItem>
                    <SelectItem value="CARD">بطاقة</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>قيمة السداد</Label>
                <Input
                  type="number"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  step="0.01"
                  min={0}
                  max={payTarget.total - payTarget.paidAmount}
                  autoFocus
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setPayTarget(null)}>إلغاء</Button>
            <Button onClick={handlePay} disabled={paying} className="bg-green-600 hover:bg-green-700">
              {paying ? 'جاري السداد...' : 'تأكيد السداد'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
