'use client'
import type { LucideIcon } from 'lucide-react'
import { extractErrorMessage } from '@/lib/notify'

/* Report payloads are intentionally dynamic: each section returns its own shape,
 * and the renderer iterates them generically. One documented escape hatch covers
 * the whole module instead of scattering casts at every access. */
/* eslint-disable @typescript-eslint/no-explicit-any */
type ReportData = Record<string, any>
type SaleRowLite = { id?: string; invoiceNumber?: string; total?: number; [key: string]: any }
/* eslint-enable @typescript-eslint/no-explicit-any */

import { useEffect, useState, useCallback } from 'react'
import { apiFetch, formatEGP, formatNumber, formatDateTime, formatDate } from '@/lib/api'
import { exportTextFile } from '@/lib/export-file'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select'
import {
  Tabs, TabsList, TabsTrigger,
} from '@/components/ui/tabs'
import {
  BarChart3, Download, FileText, TrendingUp, Wallet, Package, Users,
  Truck, ShoppingCart, RotateCcw, Coins, Receipt, Percent, RefreshCw, Filter,
  Printer,
} from 'lucide-react'
import { toast } from 'sonner'
import { printSaleReceipt } from '@/lib/receipt-template'
import { printHtmlDocument } from '@/lib/print-utils'
import { DataTable } from '@/components/ui/data-table'

type ReportType =
  | 'sales' | 'profit' | 'inventory' | 'product' | 'customer'
  | 'supplier' | 'purchases' | 'returns' | 'cash' | 'expense' | 'loyalty' | 'tax'

const REPORT_TYPES: { value: ReportType; label: string; icon: LucideIcon; needsDate?: boolean }[] = [
  { value: 'sales',      label: 'المبيعات',   icon: ShoppingCart, needsDate: true },
  { value: 'profit',     label: 'الأرباح',    icon: TrendingUp,   needsDate: true },
  { value: 'inventory',  label: 'المخزون',    icon: Package },
  { value: 'product',    label: 'المنتجات',   icon: BarChart3,    needsDate: true },
  { value: 'customer',   label: 'العملاء',    icon: Users,        needsDate: true },
  { value: 'supplier',   label: 'الموردون',   icon: Truck,        needsDate: true },
  { value: 'cash',       label: 'الخزنة',     icon: Wallet,       needsDate: true },
  { value: 'expense',    label: 'المصروفات',  icon: Receipt,      needsDate: true },
  { value: 'loyalty',    label: 'الولاء',     icon: Coins },
  { value: 'tax',        label: 'الضرائب',    icon: Percent,      needsDate: true },
  { value: 'returns',    label: 'المرتجعات',  icon: RotateCcw,    needsDate: true },
]

// Map UI tab to API type
const API_TYPE_MAP: Record<string, string> = {
  sales: 'sales',
  profit: 'profit',
  inventory: 'inventory',
  product: 'product',
  customer: 'customer',
  supplier: 'supplier',
  purchases: 'supplier', // purchases uses supplier endpoint
  returns: 'returns',    // dedicated returns report
  cash: 'cash',
  expense: 'expense',
  loyalty: 'loyalty',
  tax: 'tax',
}

const STOCK_STATUS: Record<string, { label: string; color: string }> = {
  IN_STOCK:     { label: 'متوفر',   color: 'bg-green-100 text-green-700 border-green-200' },
  LOW_STOCK:    { label: 'منخفض',   color: 'bg-amber-100 text-amber-700 border-amber-200' },
  OUT_OF_STOCK: { label: 'نفد',     color: 'bg-red-100 text-red-700 border-red-200' },
}

const PAYMENT_BADGE: Record<string, string> = {
  CASH: 'bg-green-100 text-green-700 border-green-200',
  CARD: 'bg-blue-100 text-blue-700 border-blue-200',
  TRANSFER: 'bg-purple-100 text-purple-700 border-purple-200',
  CREDIT: 'bg-amber-100 text-amber-700 border-amber-200',
}

const SESSION_STATUS: Record<string, string> = {
  OPEN: 'bg-green-100 text-green-700 border-green-200',
  CLOSED: 'bg-gray-100 text-gray-700 border-gray-200',
}

function fmtNum(v: number | undefined | null): string {
  return formatNumber(v || 0)
}
function fmtEGP(v: number | undefined | null): string {
  return formatEGP(v || 0)
}

function safeParse(v): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return String(v)
  return String(v)
}

export function ReportsModule() {
  const [reportType, setReportType] = useState<ReportType>('sales')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [groupBy, setGroupBy] = useState('none')
  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)

  const generate = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      params.set('type', API_TYPE_MAP[reportType] || reportType)
      if (dateFrom) params.set('dateFrom', dateFrom)
      if (dateTo) params.set('dateTo', dateTo + 'T23:59:59')
      if (groupBy && groupBy !== 'none') params.set('groupBy', groupBy)
      const result = await apiFetch(`/reports?${params.toString()}`)
      setData(result)
      setGeneratedAt(new Date().toISOString())
    } catch (e) {
      setError(extractErrorMessage(e) || 'فشل تحميل التقرير')
      toast.error(extractErrorMessage(e) || 'فشل تحميل التقرير')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [reportType, dateFrom, dateTo, groupBy])

  useEffect(() => { generate() }, [generate])

  const setQuickRange = (days: number) => {
    const end = new Date()
    const start = new Date()
    start.setDate(start.getDate() - days)
    setDateFrom(start.toISOString().slice(0, 10))
    setDateTo(end.toISOString().slice(0, 10))
  }

  const setThisMonth = () => {
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth(), 1)
    setDateFrom(start.toISOString().slice(0, 10))
    setDateTo(now.toISOString().slice(0, 10))
  }

  const setLastMonth = () => {
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const end = new Date(now.getFullYear(), now.getMonth(), 0)
    setDateFrom(start.toISOString().slice(0, 10))
    setDateTo(end.toISOString().slice(0, 10))
  }

  const meta = REPORT_TYPES.find(r => r.value === reportType)!

  // CSV Export
  const exportCSV = async () => {
    if (!data) return
    let headers: string[] = []
    let rows: unknown[][] = []

    switch (reportType) {
      case 'sales':
        headers = ['رقم الفاتورة', 'التاريخ', 'العميل', 'الكاشير', 'الإجمالي', 'المدفوع', 'طريقة الدفع']
        rows = (data.sales || []).map((s) => [
          s.invoiceNumber, formatDate(s.createdAt), s.customer?.name || '—', s.user?.name || '—',
          s.total, s.paidAmount, s.paymentMethod,
        ])
        break
      case 'profit':
        if (groupBy === 'product' && data.byProduct) {
          headers = ['المنتج', 'SKU', 'الوحدات', 'الإيراد', 'التكلفة', 'الربح']
          rows = data.byProduct.map((p) => [p.nameAr || p.name, p.sku, p.units, p.revenue, p.cost, p.profit])
        } else {
          headers = ['المنتج', 'الكمية', 'الإيراد', 'التكلفة', 'الربح']
          rows = (data.items || []).map((it) => [it.product?.nameAr || it.product?.name || '—', it.quantity, it.total, it.costAtSale * it.quantity, it.total - it.costAtSale * it.quantity])
        }
        break
      case 'inventory':
        headers = ['المنتج', 'SKU', 'الفئة', 'المخزون', 'التكلفة', 'القيمة', 'السعر', 'الحالة']
        rows = (data.products || []).map((p) => [p.nameAr || p.name, p.sku, p.category?.name || '—', p.stock, p.avgCost, p.stockValue, p.sellingPrice, p.status])
        break
      case 'product':
        headers = ['المنتج', 'SKU', 'الوحدات', 'الإيراد', 'التكلفة', 'الربح']
        rows = (data.products || []).map((r) => [r.product?.nameAr || r.product?.name, r.product?.sku, r.units, r.revenue, r.cost, r.profit])
        break
      case 'customer':
        headers = ['العميل', 'الهاتف', 'الفئة', 'الطلبات', 'الإجمالي']
        rows = (data.customers || []).map((r) => [r.customer?.name, r.customer?.phone || '—', r.customer?.tier || '—', r.orders, r.total])
        break
      case 'supplier':
        headers = ['المورد', 'الهاتف', 'المشتريات', 'الإجمالي', 'المدفوع', 'المستحق']
        rows = (data.suppliers || []).map((r) => [r.supplier?.name, r.supplier?.phone || '—', r.purchases, r.total, r.paid, r.balance])
        break
      case 'cash':
        headers = ['المستخدم', 'افتتاح', 'إغلاق', 'متوقع', 'الفرق', 'الحالة', 'الافتتاح (وقت)']
        rows = (data.sessions || []).map((s) => [s.user?.name, s.openingBalance, s.closingBalance || 0, s.expectedCash || 0, s.difference || 0, s.status, formatDateTime(s.openedAt)])
        break
      case 'expense':
        headers = ['الفئة', 'المبلغ', 'طريقة الدفع', 'المستخدم', 'التاريخ']
        rows = (data.expenses || []).map((e) => [e.category?.nameAr || e.category?.name || '—', e.amount, e.paymentMethod, e.user?.name || '—', formatDate(e.date)])
        break
      case 'loyalty':
        headers = ['العميل', 'الفئة', 'النقاط', 'المكتسبة', 'المستبدلة']
        rows = (data.accounts || []).map((a) => [a.customer?.name, a.tier, a.points, a.totalEarned, a.totalRedeemed])
        break
      case 'tax':
        headers = ['رقم الفاتورة', 'التاريخ', 'الصافي', 'الضريبة', 'الإجمالي']
        rows = (data.sales || []).map((s) => [s.invoiceNumber, formatDate(s.createdAt), s.netSubtotal ?? s.subtotal, s.netTaxAmount ?? s.taxAmount, s.netTotal ?? s.total])
        break
      case 'returns':
        headers = ['رقم المرتجع', 'رقم الفاتورة', 'التاريخ', 'العميل', 'نوع المرتجع', 'المسترد', 'طريقة الاسترداد', 'السبب', 'الموظف']
        // BUG FIX: classify by comparing this return's own total to the
        // sale's original total, not by the sale's current status (which
        // reflects the cumulative state now, not what this one return did).
        rows = (data.returns || []).map((r) => [r.returnNumber, r.sale?.invoiceNumber, formatDateTime(r.createdAt), r.sale?.customer?.name || '—', (r.sale && r.total >= r.sale.total - 0.01) ? 'كامل' : 'جزئي', r.total, r.refundMethod, r.reason || '—', r.user?.name || '—'])
        break
      default:
        return
    }

    const csv = [
      headers.join(','),
      ...rows.map(r => r.map((cell) => {
        const s = safeParse(cell)
        return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s
      }).join(','))
    ].join('\n')

    await exportTextFile(`report-${reportType}-${new Date().toISOString().slice(0, 10)}.csv`, csv)
    toast.success('تم تصدير التقرير')
  }

  const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char] as string))

  const handleA4Print = useCallback(() => {
    if (!data) return

    const reportLabel = REPORT_TYPES.find(r => r.value === reportType)?.label || reportType
    const dateRange = dateFrom || dateTo
      ? `${dateFrom || '...'} → ${dateTo || '...'}`
      : 'كل الفترات'

    const summaryEntries = Object.entries(data.summary || {}).map(([key, value]) => {
      const labelMap: Record<string, string> = {
        count: 'العدد',
        totalSubtotal: 'الصافي',
        totalDiscount: 'الخصومات',
        totalTax: 'الضريبة',
        total: 'الإجمالي',
        totalPaid: 'المدفوع',
        revenue: 'الإيراد',
        cost: 'التكلفة',
        grossProfit: 'الربح الإجمالي',
        netProfit: 'صافي الربح',
        marginPercent: 'هامش الربح',
        totalProducts: 'عدد المنتجات',
        totalUnits: 'إجمالي الوحدات',
        totalStockValue: 'قيمة المخزون',
        totalPotentialRevenue: 'الإيراد المحتمل',
        outOfStock: 'نفد من المخزون',
        lowStock: 'مخزون منخفض',
        customerCount: 'عدد العملاء',
        totalOrders: 'إجمالي الطلبات',
        avgOrderValue: 'متوسط الطلب',
        supplierCount: 'عدد الموردين',
        totalPurchases: 'إجمالي المشتريات',
        totalBalance: 'الرصيد',
        sessionCount: 'عدد الجلسات',
        totalOpening: 'الرصيد الافتتاحي',
        totalClosing: 'الرصيد الختامي',
        totalDifference: 'الفرق',
        accountCount: 'عدد الحسابات',
        totalPoints: 'إجمالي النقاط',
        totalEarned: 'المكتسب',
        totalRedeemed: 'المستبدل',
        itemLevelTax: 'ضريبة البنود',
        fullRefunds: 'المرتجعات الكاملة',
        partialRefunds: 'المرتجعات الجزئية',
        totalRefunded: 'إجمالي المرتجعات',
        totalTaxRefunded: 'ضريبة المرتجعات',
        avgRefundAmount: 'متوسط المرتجع',
      }

      const numeric = typeof value === 'number' ? value : Number(value || 0)
      const formatted = Number.isFinite(numeric)
        ? (key.toLowerCase().includes('count') || key.toLowerCase().includes('units') || key.toLowerCase().includes('orders') || key.toLowerCase().includes('products') || key.toLowerCase().includes('sessions') || key.toLowerCase().includes('accounts') || key.toLowerCase().includes('points') || key.toLowerCase().includes('refunds'))
          ? formatNumber(numeric)
          : formatEGP(numeric)
        : String(value ?? '—')

      return {
        label: labelMap[key] || key.replace(/([A-Z])/g, ' $1').trim(),
        value: formatted,
      }
    })

    const printTable = (() => {
      switch (reportType) {
        case 'sales': {
          const sales = data.sales || []
          return {
            columns: ['رقم الفاتورة', 'التاريخ', 'العميل', 'الكاشير', 'الحالة', 'الصافي', 'الضريبة', 'الإجمالي', 'طريقة الدفع', 'المدفوع'],
            rows: sales.map((sale) => [
              sale.invoiceNumber || '—',
              formatDateTime(sale.createdAt),
              sale.customer?.name || '—',
              sale.user?.name || '—',
              sale.status === 'PARTIAL_REFUND' ? 'مرتجع جزئي' : sale.status === 'REFUNDED' ? 'مرتجع كامل' : 'مكتمل',
              formatEGP(sale.netSubtotal ?? sale.subtotal),
              formatEGP(sale.netTaxAmount ?? sale.taxAmount),
              formatEGP(sale.netTotal ?? sale.total),
              sale.paymentMethod || '—',
              formatEGP(sale.paidAmount),
            ]),
          }
        }
        case 'profit': {
          const rowsSource = data.byProduct?.length ? data.byProduct : (data.items || [])
          return {
            columns: ['المنتج', 'SKU', 'الوحدات', 'الإيراد', 'التكلفة', 'الربح', 'الهامش'],
            rows: rowsSource.map((item) => {
              const profit = item.profit ?? (item.total - item.costAtSale * item.quantity)
              const revenue = item.revenue ?? (item.total - (item.taxAmount || 0))
              const margin = revenue > 0 ? ((profit / revenue) * 100) : 0
              return [
                item.nameAr || item.name || item.product?.nameAr || item.product?.name || '—',
                item.sku || item.product?.sku || '—',
                formatNumber(item.units ?? item.quantity ?? 0),
                formatEGP(revenue),
                formatEGP(item.cost ?? (item.costAtSale * (item.quantity || 1))),
                formatEGP(profit),
                `${margin.toFixed(1)}%`,
              ]
            }),
          }
        }
        case 'inventory': {
          const items = data.products || []
          return {
            columns: ['المنتج', 'SKU', 'الفئة', 'المخزون', 'التكلفة', 'القيمة', 'السعر', 'الحالة'],
            rows: items.map((p) => [
              p.nameAr || p.name || '—',
              p.sku || '—',
              p.category?.name || '—',
              formatNumber(p.stock),
              formatEGP(p.avgCost),
              formatEGP(p.stockValue),
              formatEGP(p.sellingPrice),
              p.status === 'OUT_OF_STOCK' ? 'نفد' : p.status === 'LOW_STOCK' ? 'منخفض' : 'متوفر',
            ]),
          }
        }
        case 'product': {
          const items = data.products || []
          return {
            columns: ['المنتج', 'SKU', 'الوحدات', 'الإيراد', 'التكلفة', 'الربح'],
            rows: items.map((p) => [
              p.product?.nameAr || p.product?.name || '—',
              p.product?.sku || '—',
              formatNumber(p.units),
              formatEGP(p.revenue),
              formatEGP(p.cost),
              formatEGP(p.profit),
            ]),
          }
        }
        case 'customer': {
          const items = data.customers || []
          return {
            columns: ['العميل', 'الهاتف', 'الفئة', 'الطلبات', 'الإجمالي'],
            rows: items.map((r) => [
              r.customer?.name || '—',
              r.customer?.phone || '—',
              r.customer?.tier || '—',
              formatNumber(r.orders),
              formatEGP(r.total),
            ]),
          }
        }
        case 'supplier': {
          const items = data.suppliers || []
          return {
            columns: ['المورد', 'الهاتف', 'المشتريات', 'الإجمالي', 'المدفوع', 'الرصيد'],
            rows: items.map((r) => [
              r.supplier?.name || '—',
              r.supplier?.phone || '—',
              formatNumber(r.purchases),
              formatEGP(r.total),
              formatEGP(r.paid),
              formatEGP(r.balance),
            ]),
          }
        }
        case 'cash': {
          const items = data.sessions || []
          return {
            columns: ['المستخدم', 'افتتاح', 'إغلاق', 'المتوقع', 'الفرق', 'الحالة', 'تاريخ الافتتاح'],
            rows: items.map((s) => [
              s.user?.name || '—',
              formatEGP(s.openingBalance),
              formatEGP(s.closingBalance || 0),
              formatEGP(s.expectedCash || 0),
              formatEGP(s.difference || 0),
              s.status === 'OPEN' ? 'مفتوح' : 'مغلق',
              formatDateTime(s.openedAt),
            ]),
          }
        }
        case 'expense': {
          const items = data.expenses || []
          return {
            columns: ['الفئة', 'المبلغ', 'طريقة الدفع', 'المستخدم', 'التاريخ'],
            rows: items.map((e) => [
              e.category?.nameAr || e.category?.name || '—',
              formatEGP(e.amount),
              e.paymentMethod || '—',
              e.user?.name || '—',
              formatDate(e.date),
            ]),
          }
        }
        case 'loyalty': {
          const items = data.accounts || []
          return {
            columns: ['العميل', 'الفئة', 'النقاط', 'المكتسب', 'المستبدل'],
            rows: items.map((a) => [
              a.customer?.name || '—',
              a.tier || '—',
              formatNumber(a.points),
              formatEGP(a.totalEarned),
              formatEGP(a.totalRedeemed),
            ]),
          }
        }
        case 'tax': {
          const items = data.sales || []
          return {
            columns: ['رقم الفاتورة', 'التاريخ', 'الصافي', 'الضريبة', 'الإجمالي'],
            rows: items.map((s) => [
              s.invoiceNumber || '—',
              formatDateTime(s.createdAt),
              formatEGP(s.subtotal),
              formatEGP(s.taxAmount),
              formatEGP(s.total),
            ]),
          }
        }
        case 'returns': {
          const items = data.returns || []
          return {
            columns: ['رقم المرتجع', 'رقم الفاتورة', 'التاريخ', 'العميل', 'النوع', 'المبلغ'],
            rows: items.map((r) => [
              r.returnNumber || '—',
              r.sale?.invoiceNumber || '—',
              formatDateTime(r.createdAt),
              r.sale?.customer?.name || '—',
              r.sale?.status === 'REFUNDED' ? 'كامل' : 'جزئي',
              formatEGP(r.total),
            ]),
          }
        }
        default:
          return { columns: ['بيانات'], rows: [] }
      }
    })()

    const head = printTable.columns.length ? printTable.columns.map(c => escapeHtml(c)).join('</th><th>') : ''
    const body = printTable.rows.length
      ? printTable.rows.map((row: unknown[]) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell ?? '—')}</td>`).join('')}</tr>`).join('')
      : '<tr><td colspan="100%" style="text-align:center;padding:18px;">لا توجد بيانات</td></tr>'

    const summaryHtml = summaryEntries.length
      ? `<div class="summary-grid">${summaryEntries.map(item => `<div class="summary-box"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong></div>`).join('')}</div>`
      : ''

    const html = `
      <!doctype html>
      <html dir="rtl" lang="ar">
        <head>
          <meta charset="UTF-8" />
          <title>تقرير ${escapeHtml(reportLabel)}</title>
          <style>
            * { box-sizing: border-box; }
            body {
              margin: 0;
              font-family: Arial, sans-serif;
              background: #fff;
              color: #111827;
              padding: 18mm 16mm;
            }
            .sheet {
              max-width: 190mm;
              margin: 0 auto;
            }
            .header {
              text-align: center;
              border-bottom: 2px solid #111827;
              padding-bottom: 10px;
              margin-bottom: 12px;
            }
            h1 {
              margin: 0 0 6px;
              font-size: 22px;
            }
            .meta {
              margin: 0;
              color: #6b7280;
              font-size: 11px;
            }
            .summary-grid {
              display: grid;
              grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
              gap: 8px;
              margin: 14px 0 18px;
            }
            .summary-box {
              border: 1px solid #d1d5db;
              border-radius: 8px;
              padding: 8px 10px;
              background: #f9fafb;
            }
            .summary-box span {
              display: block;
              font-size: 10px;
              color: #6b7280;
              margin-bottom: 4px;
            }
            .summary-box strong {
              font-size: 13px;
              white-space: nowrap;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              font-size: 9px;
              direction: rtl;
            }
            th, td {
              border: 1px solid #d1d5db;
              padding: 6px 5px;
              text-align: center;
              vertical-align: middle;
            }
            th {
              background: #f3f4f6;
              font-weight: 700;
            }
            .footer {
              margin-top: 16px;
              text-align: center;
              font-size: 9px;
              color: #6b7280;
              border-top: 1px solid #d1d5db;
              padding-top: 8px;
            }
            @page {
              size: A4 portrait;
              margin: 12mm;
            }
            @media print {
              body { margin: 0; }
              .sheet { max-width: 100%; }
            }
          </style>
        </head>
        <body>
          <div class="sheet">
            <div class="header">
              <h1>تقرير ${escapeHtml(reportLabel)}</h1>
              <p class="meta">${escapeHtml(dateRange)} | تم التوليد: ${escapeHtml(new Date().toLocaleString('ar-EG'))}</p>
            </div>
            ${summaryHtml}
            <table>
              <thead>
                <tr>${head ? `<th>${head}</th>` : ''}</tr>
              </thead>
              <tbody>
                ${body}
              </tbody>
            </table>
            <div class="footer">تقرير ${escapeHtml(reportLabel)}</div>
          </div>
        </body>
      </html>
    `

    printHtmlDocument(html, 350)
  }, [data, reportType, dateFrom, dateTo])

  return (
    <div data-report-print-root="true" className="module-page p-4 md:p-6 space-y-6 max-w-[1600px] mx-auto">
      {/* Header + tabs + filters */}
      <div className="space-y-4">
      {/* Header */}
      <div className="uk-page-header flex flex-col md:flex-row md:items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileText className="w-6 h-6 text-primary" />
            التقارير
          </h1>
          <p className="text-muted-foreground text-sm">تقارير شاملة عن أداء المتجر</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={generate} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ml-1 ${loading ? 'animate-spin' : ''}`} />
            تحديث
          </Button>
          <Button size="sm" onClick={exportCSV} disabled={!data || loading}>
            <Download className="w-4 h-4 ml-1" />
            تصدير CSV
          </Button>
          <Button size="sm" variant="outline" onClick={handleA4Print} disabled={!data || loading}>
            <Printer className="w-4 h-4 ml-1" />
            طباعة A4
          </Button>
        </div>
      </div>

      {/* Report Type Tabs */}
      <Card>
        <CardContent className="p-3">
          <Tabs value={reportType} onValueChange={(v) => setReportType(v as ReportType)}>
            <TabsList className="flex flex-wrap h-auto gap-1 bg-transparent">
              {REPORT_TYPES.map(rt => {
                const Icon = rt.icon
                return (
                  <TabsTrigger
                    key={rt.value}
                    value={rt.value}
                    className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground gap-1.5"
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {rt.label}
                  </TabsTrigger>
                )
              })}
            </TabsList>
          </Tabs>
        </CardContent>
      </Card>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <Filter className="w-4 h-4" />
              الفلاتر:
            </div>
            {meta.needsDate && (
              <>
                <div className="space-y-1">
                  <Label className="text-xs">من تاريخ</Label>
                  <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">إلى تاريخ</Label>
                  <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" />
                </div>
                <div className="flex gap-1">
                  <Button variant="outline" size="sm" onClick={() => setQuickRange(7)}>7 أيام</Button>
                  <Button variant="outline" size="sm" onClick={() => setQuickRange(30)}>30 يوم</Button>
                  <Button variant="outline" size="sm" onClick={setThisMonth}>هذا الشهر</Button>
                  <Button variant="outline" size="sm" onClick={setLastMonth}>الشهر الماضي</Button>
                </div>
              </>
            )}
            {(reportType === 'sales' || reportType === 'expense' || reportType === 'profit' || reportType === 'returns') && (
              <div className="space-y-1">
                <Label className="text-xs">تجميع حسب</Label>
                <Select value={groupBy} onValueChange={setGroupBy}>
                  <SelectTrigger className="w-32"><SelectValue placeholder="بدون" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">بدون تجميع</SelectItem>
                    {reportType === 'sales' && <>
                      <SelectItem value="day">يومي</SelectItem>
                      <SelectItem value="week">أسبوعي</SelectItem>
                      <SelectItem value="month">شهري</SelectItem>
                    </>}
                    {reportType === 'profit' && <SelectItem value="product">منتج</SelectItem>}
                    {reportType === 'expense' && <SelectItem value="category">فئة</SelectItem>}
                  </SelectContent>
                </Select>
              </div>
            )}
            <Button onClick={generate} disabled={loading}>
              <FileText className="w-4 h-4 ml-1" />
              {loading ? 'جاري التوليد...' : 'توليد التقرير'}
            </Button>
            {(dateFrom || dateTo) && (
              <Button variant="ghost" size="sm" onClick={() => { setDateFrom(''); setDateTo(''); setGroupBy('') }}>
                مسح الفلاتر
              </Button>
            )}
          </div>
          {generatedAt && (
            <p className="text-xs text-muted-foreground mt-3">
              آخر تحديث: {formatDateTime(generatedAt)}
            </p>
          )}
        </CardContent>
      </Card>
      </div>

      {/* Content */}
      {loading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24" />)}
          </div>
          <Skeleton className="h-96" />
        </div>
      ) : error ? (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-sm text-red-600">{error}</p>
            <Button className="mt-3" variant="outline" size="sm" onClick={generate}>
              <RefreshCw className="w-4 h-4 ml-1" />
              إعادة المحاولة
            </Button>
          </CardContent>
        </Card>
      ) : data ? (
        <ReportContent type={reportType} data={data} />
      ) : null}
    </div>
  )
}

// Legacy call sites pass raw Tailwind classes like color="text-blue-600"
// bg="bg-blue-500/10" — mapped here to the pastel-tint design system so
// every report's stat cards match the rest of the app without having to
// touch each of the ~30 call sites individually.
const LEGACY_COLOR_TO_TINT: Record<string, string> = {
  blue: 'kpi-tint-blue', green: 'kpi-tint-green', purple: 'kpi-tint-purple',
  amber: 'kpi-tint-yellow', yellow: 'kpi-tint-yellow', red: 'kpi-tint-pink',
  teal: 'kpi-tint-teal', gray: 'kpi-tint-blue', primary: 'kpi-tint-blue',
}

function StatCard({ label, value, sub, icon: Icon, color = 'text-primary', bg = 'bg-primary/10' }: { label: string; value: string | number; sub?: string; icon?: LucideIcon; color?: string; bg?: string }) {
  const colorName = /text-(\w+)-\d+/.exec(color)?.[1] || /bg-(\w+)\//.exec(bg)?.[1] || 'primary'
  const tint = LEGACY_COLOR_TO_TINT[colorName] || 'kpi-tint-blue'
  return (
    <div className={`unikasher-card ${tint} p-4`}>
      {Icon && (
        <div className="w-9 h-9 rounded-lg bg-white/70 dark:bg-black/20 flex items-center justify-center mb-2 shadow-sm">
          <Icon className="w-4.5 h-4.5" strokeWidth={2.25} />
        </div>
      )}
      <p className="text-xs font-medium opacity-70 mb-1">{label}</p>
      <p className="text-lg font-bold pos-number">{value}</p>
      {sub && <p className="text-xs opacity-70 mt-0.5">{sub}</p>}
    </div>
  )
}

function ReportContent({ type, data }: { type: ReportType; data: ReportData }) {
  switch (type) {
    case 'sales': return <SalesReport data={data} />
    case 'profit': return <ProfitReport data={data} />
    case 'inventory': return <InventoryReport data={data} />
    case 'product': return <ProductReport data={data} />
    case 'customer': return <CustomerReport data={data} />
    case 'supplier': return <SupplierReport data={data} />
    case 'cash': return <CashReport data={data} />
    case 'expense': return <ExpenseReport data={data} />
    case 'loyalty': return <LoyaltyReport data={data} />
    case 'tax': return <TaxReport data={data} />
    case 'returns': return <ReturnsReport data={data} />
    default: return null
  }
}

const EmptyReport = ({ msg = 'لا توجد بيانات' }: { msg?: string }) => (
  <Card><CardContent className="p-12 text-center text-sm text-muted-foreground">{msg}</CardContent></Card>
)

// Reprints a sale from the report using the exact same receipt template and
// print mechanism as the POS post-sale dialog (src/lib/receipt-template.ts),
// so what comes out of the printer here matches what the customer originally
// got at checkout — same layout, same store info, same live loyalty QR.
function ReprintButton({ sale }: { sale: SaleRowLite }) {
  const [printing, setPrinting] = useState(false)
  const handleReprint = async () => {
    setPrinting(true)
    try {
      await printSaleReceipt(
        sale,
        () => toast.success('تم إرسال الإيصال للطباعة'),
        () => toast.error('تعذر فتح نافذة الطباعة — تأكد من تعريف الطابعة على الجهاز')
      )
    } catch {
      toast.error('تعذر إعادة طباعة الفاتورة')
    } finally {
      setPrinting(false)
    }
  }
  return (
    <Button variant="ghost" size="icon" className="h-7 w-7" disabled={printing} onClick={handleReprint} title="إعادة طباعة الفاتورة">
      <Printer className={`w-3.5 h-3.5 ${printing ? 'animate-pulse' : ''}`} />
    </Button>
  )
}

function SalesReport({ data }: { data: ReportData }) {
  const s = data.summary || {}
  if (data.grouped && data.grouped.length) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="عدد الفواتير" value={fmtNum(s.count)} icon={ShoppingCart} color="text-blue-600" bg="bg-blue-500/10" />
          <StatCard label="صافي المبيعات" value={fmtEGP(s.totalSubtotal)} icon={TrendingUp} color="text-green-600" bg="bg-green-500/10" />
          <StatCard label="الضريبة" value={fmtEGP(s.totalTax)} icon={Percent} color="text-amber-600" bg="bg-amber-500/10" />
          <StatCard label="الإجمالي" value={fmtEGP(s.total)} icon={Wallet} color="text-purple-600" bg="bg-purple-500/10" />
        </div>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">المبيعات المجمعة</CardTitle></CardHeader>
          <CardContent>
            <DataTable
              maxHeight="none"
              columns={[
                { key: 'c0', header: 'الفترة', cellClassName: "font-medium", render: (g) => g.key },
                { key: 'c1', header: 'عدد الفواتير', align: 'left', cellClassName: "pos-number", render: (g) => fmtNum(g.count) },
                { key: 'c2', header: 'الإجمالي', align: 'left', cellClassName: "font-bold pos-number", render: (g) => fmtEGP(g.total) },
              ]}
              rows={data.grouped}
              rowClassName="uk-transaction-row"
            />
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!data.sales?.length) return <EmptyReport msg="لا توجد مبيعات في هذه الفترة" />

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="عدد الفواتير" value={fmtNum(s.count)} icon={ShoppingCart} color="text-blue-600" bg="bg-blue-500/10" />
        <StatCard label="صافي المبيعات" value={fmtEGP(s.totalSubtotal)} icon={TrendingUp} color="text-green-600" bg="bg-green-500/10" />
        <StatCard label="الخصومات" value={fmtEGP(s.totalDiscount)} icon={Receipt} color="text-red-600" bg="bg-red-500/10" />
        <StatCard label="الضريبة" value={fmtEGP(s.totalTax)} icon={Percent} color="text-amber-600" bg="bg-amber-500/10" />
        <StatCard label="الإجمالي" value={fmtEGP(s.total)} icon={Wallet} color="text-purple-600" bg="bg-purple-500/10" />
        <StatCard label="المدفوع" value={fmtEGP(s.totalPaid)} icon={Coins} color="text-teal-600" bg="bg-teal-500/10" />
      </div>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">تفاصيل المبيعات</CardTitle></CardHeader>
        <CardContent>
          <DataTable
            maxHeight="none"
            columns={[
              { key: 'c0', header: 'رقم الفاتورة', cellClassName: "font-mono text-xs", render: (sale) => sale.invoiceNumber },
              { key: 'c1', header: 'التاريخ', cellClassName: "text-xs", render: (sale) => formatDateTime(sale.createdAt) },
              { key: 'c2', header: 'العميل', cellClassName: "text-sm", render: (sale) => sale.customer?.name || '—' },
              { key: 'c3', header: 'الكاشير', cellClassName: "text-sm", render: (sale) => sale.user?.name || '—' },
              { key: 'c4', header: 'الحالة', render: (sale) => (
                  sale.status === 'PARTIAL_REFUND' ? (
                                          <Badge className="text-xs bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-100">مرتجع جزئي</Badge>
                                        ) : sale.status === 'REFUNDED' ? (
                                          <Badge className="text-xs bg-red-100 text-red-700 border-red-200 hover:bg-red-100">مرتجع كامل</Badge>
                                        ) : (
                                          <Badge className="text-xs bg-green-100 text-green-700 border-green-200 hover:bg-green-100">مكتمل</Badge>
                                        )
                ) },
              { key: 'c5', header: 'الصافي', align: 'left', cellClassName: "pos-number", render: (sale) => fmtEGP(sale.netSubtotal ?? sale.subtotal) },
              { key: 'c6', header: 'الضريبة', align: 'left', cellClassName: "pos-number", render: (sale) => fmtEGP(sale.netTaxAmount ?? sale.taxAmount) },
              { key: 'c7', header: 'الإجمالي', align: 'left', cellClassName: "font-bold pos-number", render: (sale) => fmtEGP(sale.netTotal ?? sale.total) },
              { key: 'c8', header: 'طريقة الدفع', render: (sale) => (
                  <Badge variant="outline" className={`text-xs ${PAYMENT_BADGE[sale.paymentMethod] || ''}`}>
                                          {sale.paymentMethod}
                                        </Badge>
                ) },
              { key: 'c9', header: 'المدفوع', align: 'left', cellClassName: "pos-number", render: (sale) => fmtEGP(sale.paidAmount) },
              { key: 'c10', header: 'إجراءات', width: "w-10", render: (sale) => <ReprintButton sale={sale} /> },
            ]}
            rows={data.sales}
          />
        </CardContent>
      </Card>
    </div>
  )
}

function ProfitReport({ data }: { data: ReportData }) {
  const s = data.summary || {}
  if (data.byProduct && data.byProduct.length) {
    return (
      <div className="space-y-4 uk-financial-report">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatCard label="الإيراد (قبل الضريبة)" value={fmtEGP(s.revenue)} icon={TrendingUp} color="text-green-600" bg="bg-green-500/10" />
          <StatCard label="الضريبة" value={fmtEGP(s.tax)} icon={Percent} color="text-amber-600" bg="bg-amber-500/10" />
          <StatCard label="التكلفة" value={fmtEGP(s.cost)} icon={Receipt} color="text-red-600" bg="bg-red-500/10" />
          <StatCard label="صافي الربح" value={fmtEGP(s.netProfit ?? s.grossProfit)} icon={Wallet} color="text-blue-600" bg="bg-blue-500/10" />
          <StatCard label="هامش الربح" value={`${s.marginPercent || 0}%`} icon={Percent} color="text-purple-600" bg="bg-purple-500/10" />
        </div>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">الأرباح حسب المنتج</CardTitle></CardHeader>
          <CardContent>
            <DataTable
              maxHeight="none"
              columns={[
                { key: 'c0', header: 'المنتج', cellClassName: "font-medium", render: (p) => p.nameAr || p.name },
                { key: 'c1', header: 'SKU', cellClassName: "font-mono text-xs", render: (p) => p.sku },
                { key: 'c2', header: 'الوحدات', align: 'left', cellClassName: "pos-number", render: (p) => fmtNum(p.units) },
                { key: 'c3', header: 'الإيراد', align: 'left', cellClassName: "pos-number", render: (p) => fmtEGP(p.revenue) },
                { key: 'c4', header: 'التكلفة', align: 'left', cellClassName: "pos-number text-red-600", render: (p) => fmtEGP(p.cost) },
                { key: 'c5', header: 'الربح', align: 'left', cellClassName: "font-bold pos-number text-green-600", render: (p) => fmtEGP(p.profit) },
                { key: 'c6', header: 'الهامش', align: 'left', cellClassName: "pos-number", render: (p) => {
                    const margin = p.revenue > 0 ? (p.profit / p.revenue) * 100 : 0
                    return (
                    <>{margin.toFixed(1)}%</>
                    )
                  } },
              ]}
              rows={data.byProduct}
              rowClassName="uk-transaction-row"
            />
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!data.items?.length) return <EmptyReport msg="لا توجد بيانات أرباح" />

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label="الإيراد (قبل الضريبة)" value={fmtEGP(s.revenue)} icon={TrendingUp} color="text-green-600" bg="bg-green-500/10" />
        <StatCard label="الضريبة" value={fmtEGP(s.tax)} icon={Percent} color="text-amber-600" bg="bg-amber-500/10" />
        <StatCard label="التكلفة" value={fmtEGP(s.cost)} icon={Receipt} color="text-red-600" bg="bg-red-500/10" />
        <StatCard label="صافي الربح" value={fmtEGP(s.netProfit ?? s.grossProfit)} icon={Wallet} color="text-blue-600" bg="bg-blue-500/10" />
        <StatCard label="هامش الربح" value={`${s.marginPercent || 0}%`} icon={Percent} color="text-purple-600" bg="bg-purple-500/10" />
      </div>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">تفاصيل الأرباح</CardTitle></CardHeader>
        <CardContent>
          <DataTable
            maxHeight="none"
            columns={[
              { key: 'c0', header: 'المنتج', cellClassName: "font-medium", render: (it) => it.product?.nameAr || it.product?.name || '—' },
              { key: 'c1', header: 'الكمية', align: 'left', cellClassName: "pos-number", render: (it) => fmtNum(it.quantity) },
              { key: 'c2', header: 'سعر البيع', align: 'left', cellClassName: "pos-number", render: (it) => fmtEGP(it.unitPrice) },
              { key: 'c3', header: 'الإيراد (قبل الضريبة)', align: 'left', cellClassName: "pos-number", render: (it) => {
                  // it.total includes tax_amount (see handleCreateSale) — strip it
                                    // out here too so the per-row profit matches the summary cards
                                    // and isn't inflated by tax collected on behalf of the government.
                                    const revenue = it.total - (it.taxAmount || 0)
                                    const cost = it.costAtSale * it.quantity
                                    const profit = revenue - cost
                  return (
                  fmtEGP(revenue)
                  )
                } },
              { key: 'c4', header: 'الضريبة', align: 'left', cellClassName: "pos-number text-amber-600", render: (it) => fmtEGP(it.taxAmount || 0) },
              { key: 'c5', header: 'التكلفة', align: 'left', cellClassName: "pos-number text-red-600", render: (it) => {
                  // it.total includes tax_amount (see handleCreateSale) — strip it
                                    // out here too so the per-row profit matches the summary cards
                                    // and isn't inflated by tax collected on behalf of the government.
                                    const revenue = it.total - (it.taxAmount || 0)
                                    const cost = it.costAtSale * it.quantity
                                    const profit = revenue - cost
                  return (
                  fmtEGP(cost)
                  )
                } },
              { key: 'c6', header: 'صافي الربح', align: 'left', cellClassName: "font-bold pos-number text-green-600", render: (it) => {
                  // it.total includes tax_amount (see handleCreateSale) — strip it
                                    // out here too so the per-row profit matches the summary cards
                                    // and isn't inflated by tax collected on behalf of the government.
                                    const revenue = it.total - (it.taxAmount || 0)
                                    const cost = it.costAtSale * it.quantity
                                    const profit = revenue - cost
                  return (
                  fmtEGP(profit)
                  )
                } },
            ]}
            rows={data.items}
            rowClassName="uk-transaction-row"
          />
        </CardContent>
      </Card>
    </div>
  )
}

function InventoryReport({ data }: { data: ReportData }) {
  const s = data.summary || {}
  if (!data.products?.length) return <EmptyReport msg="لا توجد منتجات" />
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="عدد المنتجات" value={fmtNum(s.totalProducts)} icon={Package} color="text-blue-600" bg="bg-blue-500/10" />
        <StatCard label="إجمالي الوحدات" value={fmtNum(s.totalUnits)} icon={BarChart3} color="text-cyan-600" bg="bg-cyan-500/10" />
        <StatCard label="قيمة المخزون" value={fmtEGP(s.totalStockValue)} icon={Wallet} color="text-green-600" bg="bg-green-500/10" />
        <StatCard label="الإيراد المحتمل" value={fmtEGP(s.totalPotentialRevenue)} icon={TrendingUp} color="text-purple-600" bg="bg-purple-500/10" />
        <StatCard label="نفد من المخزون" value={fmtNum(s.outOfStock)} icon={Receipt} color="text-red-600" bg="bg-red-500/10" />
        <StatCard label="مخزون منخفض" value={fmtNum(s.lowStock)} icon={Percent} color="text-amber-600" bg="bg-amber-500/10" />
      </div>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">المخزون الحالي</CardTitle></CardHeader>
        <CardContent>
          <DataTable
            maxHeight="none"
            columns={[
              { key: 'c0', header: 'المنتج', cellClassName: "font-medium", render: (p) => p.nameAr || p.name },
              { key: 'c1', header: 'SKU', cellClassName: "font-mono text-xs", render: (p) => p.sku },
              { key: 'c2', header: 'الفئة', cellClassName: "text-sm text-muted-foreground", render: (p) => p.category?.name || '—' },
              { key: 'c3', header: 'المخزون', align: 'left', cellClassName: "pos-number font-bold", render: (p) => fmtNum(p.stock) },
              { key: 'c4', header: 'التكلفة', align: 'left', cellClassName: "pos-number", render: (p) => fmtEGP(p.avgCost) },
              { key: 'c5', header: 'القيمة', align: 'left', cellClassName: "pos-number", render: (p) => fmtEGP(p.stockValue) },
              { key: 'c6', header: 'السعر', align: 'left', cellClassName: "pos-number", render: (p) => fmtEGP(p.sellingPrice) },
              { key: 'c7', header: 'الحالة', render: (p) => {
                  const st = STOCK_STATUS[p.status] || STOCK_STATUS.IN_STOCK
                  return (
                  <Badge variant="outline" className={`text-xs ${st.color}`}>{st.label}</Badge>
                  )
                } },
            ]}
            rows={data.products}
          />
        </CardContent>
      </Card>
    </div>
  )
}

function ProductReport({ data }: { data: ReportData }) {
  const s = data.summary || {}
  if (!data.products?.length) return <EmptyReport msg="لا توجد مبيعات منتجات" />
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="عدد المنتجات" value={fmtNum(s.productCount)} icon={Package} color="text-blue-600" bg="bg-blue-500/10" />
        <StatCard label="إجمالي الوحدات" value={fmtNum(s.totalUnits)} icon={BarChart3} color="text-cyan-600" bg="bg-cyan-500/10" />
        <StatCard label="إجمالي الإيراد" value={fmtEGP(s.totalRevenue)} icon={TrendingUp} color="text-green-600" bg="bg-green-500/10" />
        <StatCard label="إجمالي الربح" value={fmtEGP(s.totalProfit)} icon={Wallet} color="text-purple-600" bg="bg-purple-500/10" />
      </div>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">أداء المنتجات</CardTitle></CardHeader>
        <CardContent>
          <DataTable
            maxHeight="none"
            columns={[
              { key: 'c0', header: '#', cellClassName: "text-xs text-muted-foreground", render: (_, index) => index + 1 },
              { key: 'c1', header: 'المنتج', cellClassName: "font-medium", render: (r) => r.product?.nameAr || r.product?.name || '—' },
              { key: 'c2', header: 'SKU', cellClassName: "font-mono text-xs", render: (r) => r.product?.sku },
              { key: 'c3', header: 'الوحدات', align: 'left', cellClassName: "pos-number font-bold", render: (r) => fmtNum(r.units) },
              { key: 'c4', header: 'الإيراد', align: 'left', cellClassName: "pos-number", render: (r) => fmtEGP(r.revenue) },
              { key: 'c5', header: 'التكلفة', align: 'left', cellClassName: "pos-number text-red-600", render: (r) => fmtEGP(r.cost) },
              { key: 'c6', header: 'الربح', align: 'left', cellClassName: "font-bold pos-number text-green-600", render: (r) => fmtEGP(r.profit) },
            ]}
            rows={data.products}
            rowClassName="uk-transaction-row"
          />
        </CardContent>
      </Card>
    </div>
  )
}

function CustomerReport({ data }: { data: ReportData }) {
  const s = data.summary || {}
  if (!data.customers?.length) return <EmptyReport msg="لا توجد بيانات عملاء" />
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="عدد العملاء" value={fmtNum(s.customerCount)} icon={Users} color="text-blue-600" bg="bg-blue-500/10" />
        <StatCard label="إجمالي الطلبات" value={fmtNum(s.totalOrders)} icon={ShoppingCart} color="text-cyan-600" bg="bg-cyan-500/10" />
        <StatCard label="إجمالي الإيراد" value={fmtEGP(s.totalRevenue)} icon={TrendingUp} color="text-green-600" bg="bg-green-500/10" />
        <StatCard label="متوسط الطلب" value={fmtEGP(s.avgOrderValue)} icon={Wallet} color="text-purple-600" bg="bg-purple-500/10" />
      </div>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">أفضل العملاء</CardTitle></CardHeader>
        <CardContent>
          <DataTable
            maxHeight="none"
            columns={[
              { key: 'c0', header: '#', cellClassName: "text-xs text-muted-foreground", render: (_, index) => index + 1 },
              { key: 'c1', header: 'العميل', cellClassName: "font-medium", render: (r) => r.customer?.name || '—' },
              { key: 'c2', header: 'الهاتف', cellClassName: "text-sm text-muted-foreground", render: (r) => r.customer?.phone || '—' },
              { key: 'c3', header: 'الفئة', render: (r) => <Badge variant="outline" className="text-xs">{r.customer?.tier || '—'}</Badge> },
              { key: 'c4', header: 'الطلبات', align: 'left', cellClassName: "pos-number", render: (r) => fmtNum(r.orders) },
              { key: 'c5', header: 'الإجمالي', align: 'left', cellClassName: "font-bold pos-number", render: (r) => fmtEGP(r.total) },
              { key: 'c6', header: 'متوسط الطلب', align: 'left', cellClassName: "pos-number", render: (r) => fmtEGP(r.orders > 0 ? r.total / r.orders : 0) },
            ]}
            rows={data.customers}
            rowClassName="uk-transaction-row"
          />
        </CardContent>
      </Card>
    </div>
  )
}

function SupplierReport({ data }: { data: ReportData }) {
  const s = data.summary || {}
  if (!data.suppliers?.length) return <EmptyReport msg="لا توجد مشتريات" />
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="عدد الموردين" value={fmtNum(s.supplierCount)} icon={Truck} color="text-blue-600" bg="bg-blue-500/10" />
        <StatCard label="إجمالي المشتريات" value={fmtEGP(s.totalPurchases)} icon={ShoppingCart} color="text-cyan-600" bg="bg-cyan-500/10" />
        <StatCard label="المدفوع" value={fmtEGP(s.totalPaid)} icon={Wallet} color="text-green-600" bg="bg-green-500/10" />
        <StatCard label="المستحق" value={fmtEGP(s.totalBalance)} icon={Receipt} color="text-red-600" bg="bg-red-500/10" />
      </div>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">الموردين</CardTitle></CardHeader>
        <CardContent>
          <DataTable
            maxHeight="none"
            columns={[
              { key: 'c0', header: '#', cellClassName: "text-xs text-muted-foreground", render: (_, index) => index + 1 },
              { key: 'c1', header: 'المورد', cellClassName: "font-medium", render: (r) => r.supplier?.name || '—' },
              { key: 'c2', header: 'الهاتف', cellClassName: "text-sm text-muted-foreground", render: (r) => r.supplier?.phone || '—' },
              { key: 'c3', header: 'عدد الفواتير', align: 'left', cellClassName: "pos-number", render: (r) => fmtNum(r.purchases) },
              { key: 'c4', header: 'الإجمالي', align: 'left', cellClassName: "pos-number", render: (r) => fmtEGP(r.total) },
              { key: 'c5', header: 'المدفوع', align: 'left', cellClassName: "pos-number text-green-600", render: (r) => fmtEGP(r.paid) },
              { key: 'c6', header: 'المستحق', align: 'left', render: (r) => <span className={`pos-number font-bold ${r.balance > 0 ? 'text-red-600' : 'text-green-600'}`}>{fmtEGP(r.balance)}</span> },
            ]}
            rows={data.suppliers}
            rowClassName="uk-transaction-row"
          />
        </CardContent>
      </Card>
    </div>
  )
}

function CashReport({ data }: { data: ReportData }) {
  const s = data.summary || {}
  if (!data.sessions?.length) return <EmptyReport msg="لا توجد جلسات كاش" />
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="عدد الجلسات" value={fmtNum(s.sessionCount)} icon={Wallet} color="text-blue-600" bg="bg-blue-500/10" />
        <StatCard label="إجمالي الافتتاح" value={fmtEGP(s.totalOpening)} icon={Coins} color="text-cyan-600" bg="bg-cyan-500/10" />
        <StatCard label="إجمالي الإغلاق" value={fmtEGP(s.totalClosing)} icon={TrendingUp} color="text-green-600" bg="bg-green-500/10" />
        <StatCard label="إجمالي الفروقات" value={fmtEGP(s.totalDifference)} icon={Percent} color={s.totalDifference < 0 ? 'text-red-600' : 'text-amber-600'} bg={s.totalDifference < 0 ? 'bg-red-500/10' : 'bg-amber-500/10'} />
      </div>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">جلسات الكاش</CardTitle></CardHeader>
        <CardContent>
          <DataTable
            maxHeight="none"
            columns={[
              { key: 'c0', header: 'المستخدم', cellClassName: "text-sm font-medium", render: (sess) => sess.user?.name || '—' },
              { key: 'c1', header: 'افتتاح', align: 'left', cellClassName: "pos-number", render: (sess) => fmtEGP(sess.openingBalance) },
              { key: 'c2', header: 'إيداعات', align: 'left', cellClassName: "pos-number text-green-600", render: (sess) => fmtEGP(sess.totalIn) },
              { key: 'c3', header: 'مصاريف', align: 'left', cellClassName: "pos-number text-red-600", render: (sess) => fmtEGP(sess.totalOut) },
              { key: 'c4', header: 'متوقع', align: 'left', cellClassName: "pos-number", render: (sess) => fmtEGP(sess.expectedCash) },
              { key: 'c5', header: 'فعلي', align: 'left', cellClassName: "pos-number", render: (sess) => fmtEGP(sess.closingBalance) },
              { key: 'c6', header: 'الفرق', align: 'left', render: (sess) => (
                <span className={`pos-number font-bold ${sess.difference < 0 ? 'text-red-600' : sess.difference > 0 ? 'text-blue-600' : ''}`}>
                  {fmtEGP(sess.difference)}
                </span>
              ) },
              { key: 'c7', header: 'الحالة', render: (sess) => <Badge variant="outline" className={`text-xs ${SESSION_STATUS[sess.status] || ''}`}>{sess.status === 'OPEN' ? 'مفتوحة' : 'مغلقة'}</Badge> },
              { key: 'c8', header: 'الافتتاح', cellClassName: "text-xs text-muted-foreground", render: (sess) => formatDateTime(sess.openedAt) },
              { key: 'c9', header: 'الإغلاق', cellClassName: "text-xs text-muted-foreground", render: (sess) => sess.closedAt ? formatDateTime(sess.closedAt) : '—' },
            ]}
            rows={data.sessions}
          />
        </CardContent>
      </Card>
    </div>
  )
}

function ExpenseReport({ data }: { data: ReportData }) {
  const s = data.summary || {}
  if (!data.expenses?.length && !data.byCategory?.length) return <EmptyReport msg="لا توجد مصروفات" />
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="عدد المصروفات" value={fmtNum(s.count)} icon={Receipt} color="text-blue-600" bg="bg-blue-500/10" />
        <StatCard label="الإجمالي" value={fmtEGP(s.total)} icon={Wallet} color="text-red-600" bg="bg-red-500/10" />
        <StatCard label="نقدي" value={fmtEGP(s.byMethod?.CASH || 0)} icon={Coins} color="text-green-600" bg="bg-green-500/10" />
        <StatCard label="بطاقة" value={fmtEGP(s.byMethod?.CARD || 0)} icon={Percent} color="text-blue-600" bg="bg-blue-500/10" />
        <StatCard label="تحويل" value={fmtEGP(s.byMethod?.TRANSFER || 0)} icon={TrendingUp} color="text-purple-600" bg="bg-purple-500/10" />
      </div>
      {data.byCategory && data.byCategory.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">المصروفات حسب الفئة</CardTitle></CardHeader>
          <CardContent>
            <DataTable
              maxHeight="none"
              columns={[
                { key: 'c0', header: 'الفئة', cellClassName: "font-medium", render: (c) => c.name },
                { key: 'c1', header: 'عدد المصروفات', align: 'left', cellClassName: "pos-number", render: (c) => fmtNum(c.count) },
                { key: 'c2', header: 'الإجمالي', align: 'left', cellClassName: "font-bold pos-number text-red-600", render: (c) => fmtEGP(c.total) },
              ]}
              rows={data.byCategory}
              rowClassName="uk-transaction-row"
            />
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">تفاصيل المصروفات</CardTitle></CardHeader>
        <CardContent>
          {data.expenses?.length ? (
            <DataTable
              maxHeight="400px"
              columns={[
                { key: 'c0', header: 'الفئة', cellClassName: "font-medium", render: (e) => e.category?.nameAr || e.category?.name || '—' },
                { key: 'c1', header: 'المبلغ', align: 'left', cellClassName: "font-bold pos-number text-red-600", render: (e) => fmtEGP(e.amount) },
                { key: 'c2', header: 'طريقة الدفع', render: (e) => <Badge variant="outline" className={`text-xs ${PAYMENT_BADGE[e.paymentMethod] || ''}`}>{e.paymentMethod}</Badge> },
                { key: 'c3', header: 'المستخدم', cellClassName: "text-sm", render: (e) => e.user?.name || '—' },
                { key: 'c4', header: 'الملاحظة', cellClassName: "text-sm text-muted-foreground max-w-xs", render: (e) => e.note || '—' },
                { key: 'c5', header: 'التاريخ', cellClassName: "text-xs text-muted-foreground", render: (e) => formatDate(e.date) },
              ]}
              rows={data.expenses}
            />
          ) : (
            <p className="text-sm text-muted-foreground text-center py-6">لا توجد تفاصيل</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function LoyaltyReport({ data }: { data: ReportData }) {
  const s = data.summary || {}
  if (!data.accounts?.length) return <EmptyReport msg="لا توجد حسابات ولاء" />
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="عدد الحسابات" value={fmtNum(s.accountCount)} icon={Users} color="text-blue-600" bg="bg-blue-500/10" />
        <StatCard label="النقاط الحالية" value={fmtNum(s.totalPoints)} icon={Coins} color="text-amber-600" bg="bg-amber-500/10" />
        <StatCard label="إجمالي المكتسبة" value={fmtNum(s.totalEarned)} icon={TrendingUp} color="text-green-600" bg="bg-green-500/10" />
        <StatCard label="إجمالي المستبدلة" value={fmtNum(s.totalRedeemed)} icon={Wallet} color="text-red-600" bg="bg-red-500/10" />
      </div>
      {s.byTier && Object.keys(s.byTier).length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Object.entries(s.byTier as Record<string, number>).map(([tier, count]) => (
            <StatCard key={tier} label={`فئة ${tier}`} value={fmtNum(count)} icon={Users} />
          ))}
        </div>
      )}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">حسابات الولاء</CardTitle></CardHeader>
        <CardContent>
          <DataTable
            maxHeight="none"
            columns={[
              { key: 'c0', header: '#', cellClassName: "text-xs text-muted-foreground", render: (_, index) => index + 1 },
              { key: 'c1', header: 'العميل', cellClassName: "font-medium", render: (a) => a.customer?.name || '—' },
              { key: 'c2', header: 'الهاتف', cellClassName: "text-sm text-muted-foreground", render: (a) => a.customer?.phone || '—' },
              { key: 'c3', header: 'الفئة', render: (a) => <Badge variant="outline" className="text-xs">{a.tier}</Badge> },
              { key: 'c4', header: 'النقاط الحالية', align: 'left', cellClassName: "font-bold pos-number text-amber-600", render: (a) => fmtNum(a.points) },
              { key: 'c5', header: 'المكتسبة', align: 'left', cellClassName: "pos-number text-green-600", render: (a) => fmtNum(a.totalEarned) },
              { key: 'c6', header: 'المستبدلة', align: 'left', cellClassName: "pos-number text-red-600", render: (a) => fmtNum(a.totalRedeemed) },
            ]}
            rows={data.accounts}
            rowClassName="uk-transaction-row"
          />
        </CardContent>
      </Card>
    </div>
  )
}

function TaxReport({ data }: { data: ReportData }) {
  const s = data.summary || {}
  if (!data.sales?.length) return <EmptyReport msg="لا توجد مبيعات" />
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="عدد الفواتير" value={fmtNum(s.count)} icon={Receipt} color="text-blue-600" bg="bg-blue-500/10" />
        <StatCard label="صافي المبيعات" value={fmtEGP(s.totalSubtotal)} icon={TrendingUp} color="text-green-600" bg="bg-green-500/10" />
        <StatCard label="ضريبة الفواتير" value={fmtEGP(s.totalTax)} icon={Percent} color="text-amber-600" bg="bg-amber-500/10" />
        <StatCard label="ضريبة الأصناف" value={fmtEGP(s.itemLevelTax)} icon={Wallet} color="text-purple-600" bg="bg-purple-500/10" />
        <StatCard label="الإجمالي" value={fmtEGP(s.total)} icon={Coins} color="text-teal-600" bg="bg-teal-500/10" />
      </div>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">تفاصيل الضرائب</CardTitle></CardHeader>
        <CardContent>
          <DataTable
            maxHeight="none"
            columns={[
              { key: 'c0', header: 'رقم الفاتورة', cellClassName: "font-mono text-xs", render: (sale) => sale.invoiceNumber },
              { key: 'c1', header: 'التاريخ', cellClassName: "text-xs", render: (sale) => formatDate(sale.createdAt) },
              { key: 'c2', header: 'الصافي', align: 'left', cellClassName: "pos-number", render: (sale) => {
                  const netSubtotal = sale.netSubtotal ?? sale.subtotal
                                    const netTaxAmount = sale.netTaxAmount ?? sale.taxAmount
                                    const netTotal = sale.netTotal ?? sale.total
                                    const taxPct = netSubtotal > 0 ? (netTaxAmount / netSubtotal) * 100 : 0
                  return (
                  fmtEGP(netSubtotal)
                  )
                } },
              { key: 'c3', header: 'الضريبة', align: 'left', cellClassName: "font-bold pos-number text-amber-600", render: (sale) => {
                  const netSubtotal = sale.netSubtotal ?? sale.subtotal
                                    const netTaxAmount = sale.netTaxAmount ?? sale.taxAmount
                                    const netTotal = sale.netTotal ?? sale.total
                                    const taxPct = netSubtotal > 0 ? (netTaxAmount / netSubtotal) * 100 : 0
                  return (
                  fmtEGP(netTaxAmount)
                  )
                } },
              { key: 'c4', header: 'الإجمالي', align: 'left', cellClassName: "pos-number", render: (sale) => {
                  const netSubtotal = sale.netSubtotal ?? sale.subtotal
                                    const netTaxAmount = sale.netTaxAmount ?? sale.taxAmount
                                    const netTotal = sale.netTotal ?? sale.total
                                    const taxPct = netSubtotal > 0 ? (netTaxAmount / netSubtotal) * 100 : 0
                  return (
                  fmtEGP(netTotal)
                  )
                } },
              { key: 'c5', header: 'نسبة الضريبة', align: 'left', cellClassName: "pos-number", render: (sale) => {
                  const netSubtotal = sale.netSubtotal ?? sale.subtotal
                                    const netTaxAmount = sale.netTaxAmount ?? sale.taxAmount
                                    const netTotal = sale.netTotal ?? sale.total
                                    const taxPct = netSubtotal > 0 ? (netTaxAmount / netSubtotal) * 100 : 0
                  return (
                  <>{taxPct.toFixed(2)}%</>
                  )
                } },
            ]}
            rows={data.sales}
          />
        </CardContent>
      </Card>
    </div>
  )
}

function ReturnsReport({ data }: { data: ReportData }) {
  const s = data.summary || {}
  if (!data.returns?.length) return <EmptyReport msg="لا توجد مرتجعات في هذه الفترة" />

  // BUG FIX: same rule as the backend summary — classify by comparing this
  // specific return's own total to the sale's original total, not by the
  // sale's current (possibly since-changed-by-later-returns) status.
  const isFullReturn = (ret) => !!ret.sale && ret.total >= ret.sale.total - 0.01

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="إجمالي المرتجعات" value={fmtNum(s.count)} icon={RotateCcw} color="text-blue-600" bg="bg-blue-500/10" />
      <StatCard label="مرتجع كامل" value={fmtNum(s.fullRefunds || 0)} icon={RotateCcw} color="text-red-600" bg="bg-red-500/10" />
      <StatCard label="مرتجع جزئي" value={fmtNum(s.partialRefunds || 0)} icon={RefreshCw} color="text-amber-600" bg="bg-amber-500/10" />
      <StatCard label="إجمالي المسترد" value={fmtEGP(s.totalRefunded)} icon={Wallet} color="text-green-600" bg="bg-green-500/10" />
      <StatCard label="الضريبة المستردة" value={fmtEGP(s.totalTaxRefunded)} icon={Percent} color="text-purple-600" bg="bg-purple-500/10" />
      <StatCard label="متوسط المرتجع" value={fmtEGP(s.avgRefundAmount)} icon={TrendingUp} color="text-teal-600" bg="bg-teal-500/10" />
      </div>

      {/* Top Reasons */}
      {s.topReasons?.length > 0 && (
        <Card className="unikasher-card">
          <CardHeader className="pb-2"><CardTitle className="text-base">أكثر أسباب الإرجاع</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {s.topReasons.map((r, i: number) => (
                <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-background/50">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg kpi-tint-pink flex items-center justify-center text-xs font-bold">{i + 1}</div>
                    <span className="text-sm font-medium">{r.reason}</span>
                  </div>
                  <Badge variant="outline" className="text-xs">{r.count} مرة</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Top Returned Products */}
      {data.topReturnedProducts?.length > 0 && (
        <Card className="unikasher-card">
          <CardHeader className="pb-2"><CardTitle className="text-base">المنتجات الأكثر إرجاعاً</CardTitle></CardHeader>
          <CardContent>
            <DataTable
              maxHeight="300px"
              columns={[
                { key: 'c0', header: 'المنتج', cellClassName: "text-sm", render: (p) => p.product?.nameAr || p.product?.name },
                { key: 'c1', header: 'الكمية المرتجعة', align: 'left', cellClassName: "pos-number", render: (p) => fmtNum(p.quantity) },
                { key: 'c2', header: 'إجمالي المسترد', align: 'left', cellClassName: "pos-number font-bold", render: (p) => fmtEGP(p.totalRefunded) },
              ]}
              rows={data.topReturnedProducts}
              rowClassName="uk-transaction-row"
            />
          </CardContent>
        </Card>
      )}

      {/* Returns Table */}
      <Card className="unikasher-card">
        <CardHeader className="pb-2"><CardTitle className="text-base">تفاصيل المرتجعات</CardTitle></CardHeader>
        <CardContent>
          <DataTable
            maxHeight="none"
            columns={[
              { key: 'c0', header: 'رقم المرتجع', cellClassName: "font-mono text-xs", render: (ret) => ret.returnNumber },
              { key: 'c1', header: 'رقم الفاتورة', cellClassName: "font-mono text-xs", render: (ret) => ret.sale?.invoiceNumber },
              { key: 'c2', header: 'التاريخ', cellClassName: "text-xs", render: (ret) => formatDateTime(ret.createdAt) },
              { key: 'c3', header: 'العميل', cellClassName: "text-sm", render: (ret) => ret.sale?.customer?.name || '—' },
              { key: 'c4', header: 'نوع المرتجع', render: (ret) => (
                  <Badge variant="outline" className={`text-xs ${isFullReturn(ret) ? 'bg-red-100 text-red-700 border-red-200' : 'bg-amber-100 text-amber-700 border-amber-200'}`}>
                                          {isFullReturn(ret) ? 'كامل' : 'جزئي'}
                                        </Badge>
                ) },
              { key: 'c5', header: 'المسترد', align: 'left', cellClassName: "pos-number font-bold", render: (ret) => fmtEGP(ret.total) },
              { key: 'c6', header: 'طريقة الاسترداد', render: (ret) => (
                  <Badge variant="outline" className={`text-xs ${PAYMENT_BADGE[ret.refundMethod] || ''}`}>
                                          {ret.refundMethod}
                                        </Badge>
                ) },
              { key: 'c7', header: 'السبب', width: "w-[150px]", cellClassName: "text-xs max-w-[150px]", render: (ret) => ret.reason || '—' },
              { key: 'c8', header: 'الموظف', cellClassName: "text-sm", render: (ret) => ret.user?.name || '—' },
            ]}
            rows={data.returns}
          />
        </CardContent>
      </Card>
    </div>
  )
}
