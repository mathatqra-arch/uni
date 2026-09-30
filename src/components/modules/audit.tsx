'use client'
import type { LucideIcon } from 'lucide-react'
import type { AuditLog } from '@/lib/types'

type AuditRow = AuditLog & { user?: { id?: string; name?: string; username?: string; role?: string } | null }

import { useEffect, useState, useCallback } from 'react'
import { apiFetch, formatDateTime } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select'
import {
  ScrollText, Filter, RefreshCw, ChevronLeft, User, Clock, FileText,
  LogIn, ShoppingCart, RotateCcw, Package, Wallet, Receipt, Coins,
  Settings as SettingsIcon, UserPlus, AlertTriangle, Database,
} from 'lucide-react'

import { notifyError } from '@/lib/notify'
import { DataTable } from '@/components/ui/data-table'

// Action type → color/icon/label mapping
const ACTION_META: Record<string, { label: string; color: string; icon: LucideIcon }> = {
  LOGIN:               { label: 'تسجيل دخول',         color: 'bg-blue-100 text-blue-700 border-blue-200',          icon: LogIn },
  LOGOUT:              { label: 'تسجيل خروج',          color: 'bg-gray-100 text-gray-700 border-gray-200',          icon: LogIn },
  SALE_CREATED:        { label: 'إنشاء بيع',          color: 'bg-green-100 text-green-700 border-green-200',       icon: ShoppingCart },
  SALE_REFUNDED:       { label: 'مرتجع بيع',          color: 'bg-red-100 text-red-700 border-red-200',             icon: RotateCcw },
  SALE_UPDATED:        { label: 'تعديل بيع',          color: 'bg-amber-100 text-amber-700 border-amber-200',       icon: ShoppingCart },
  PRODUCT_CREATED:     { label: 'إنشاء منتج',         color: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: Package },
  PRODUCT_UPDATED:     { label: 'تعديل منتج',         color: 'bg-cyan-100 text-cyan-700 border-cyan-200',          icon: Package },
  PRODUCT_ARCHIVED:    { label: 'أرشفة منتج',         color: 'bg-gray-100 text-gray-700 border-gray-200',          icon: Package },
  PURCHASE_CREATED:    { label: 'إنشاء شراء',         color: 'bg-indigo-100 text-indigo-700 border-indigo-200',    icon: Receipt },
  CASH_OPENED:         { label: 'فتح خزنة',           color: 'bg-green-100 text-green-700 border-green-200',       icon: Wallet },
  CASH_CLOSED:         { label: 'إغلاق خزنة',         color: 'bg-amber-100 text-amber-700 border-amber-200',       icon: Wallet },
  CASH_IN:             { label: 'إيداع نقدي',         color: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: Wallet },
  CASH_OUT:            { label: 'سحب نقدي',           color: 'bg-orange-100 text-orange-700 border-orange-200',    icon: Wallet },
  EXPENSE_CREATED:     { label: 'إنشاء مصروف',        color: 'bg-red-100 text-red-700 border-red-200',             icon: Receipt },
  INVENTORY_ADJUSTED:  { label: 'تسوية مخزون',        color: 'bg-purple-100 text-purple-700 border-purple-200',    icon: Package },
  LOYALTY_REDEEM:      { label: 'استبدال نقاط',       color: 'bg-pink-100 text-pink-700 border-pink-200',          icon: Coins },
  LOYALTY_EARN:        { label: 'كسب نقاط',           color: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: Coins },
  CUSTOMER_CREATED:    { label: 'إنشاء عميل',         color: 'bg-teal-100 text-teal-700 border-teal-200',          icon: UserPlus },
  SETTINGS_UPDATED:    { label: 'تحديث إعدادات',      color: 'bg-slate-100 text-slate-700 border-slate-200',       icon: SettingsIcon },
  USER_CREATED:        { label: 'إنشاء مستخدم',       color: 'bg-blue-100 text-blue-700 border-blue-200',          icon: UserPlus },
}

const ENTITY_LABELS: Record<string, string> = {
  Sale: 'بيع',
  SaleItem: 'عنصر بيع',
  Product: 'منتج',
  Category: 'فئة',
  Customer: 'عميل',
  Supplier: 'مورد',
  Purchase: 'شراء',
  PurchaseItem: 'عنصر شراء',
  CashSession: 'جلسة كاش',
  CashMovement: 'حركة كاش',
  Expense: 'مصروف',
  ExpenseCategory: 'فئة مصروف',
  InventoryMovement: 'حركة مخزون',
  LoyaltyAccount: 'حساب ولاء',
  LoyaltyTransaction: 'معاملة ولاء',
  LoyaltyTier: 'فئة ولاء',
  LoyaltyCampaign: 'حملة ولاء',
  User: 'مستخدم',
  Setting: 'إعداد',
  Register: 'درج',
  Warehouse: 'مخزن',
  Brand: 'علامة تجارية',
  Unit: 'وحدة',
  TaxRate: 'نسبة ضريبة',
}

function getActionMeta(action: string): { label: string; color: string; icon: LucideIcon } {
  return ACTION_META[action] || {
    label: action || 'غير معروف',
    color: 'bg-gray-100 text-gray-700 border-gray-200',
    icon: FileText,
  }
}

function prettyJson(s: string | null | undefined): string {
  if (!s) return ''
  try {
    return JSON.stringify(JSON.parse(s), null, 2)
  } catch {
    return s
  }
}

export function AuditModule() {
  const [logs, setLogs] = useState<AuditRow[]>([])
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [filters, setFilters] = useState({ action: 'all', entity: 'all', dateFrom: '', dateTo: '' })
  const [selectedLog, setSelectedLog] = useState<AuditRow | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const PAGE = 50

  const load = useCallback(async (reset = true) => {
    if (reset) setLoading(true)
    else setLoadingMore(true)
    try {
      const params = new URLSearchParams()
      params.set('limit', String(PAGE))
      if (!reset) params.set('offset', String(logs.length))
      if (filters.action !== 'all') params.set('action', filters.action)
      if (filters.entity !== 'all') params.set('entity', filters.entity)
      if (filters.dateFrom) params.set('dateFrom', filters.dateFrom)
      if (filters.dateTo) params.set('dateTo', filters.dateTo + 'T23:59:59')

      const data = await apiFetch(`/audit?${params.toString()}`)
      if (reset) {
        setLogs(data?.logs || [])
      } else {
        setLogs(prev => [...prev, ...(data?.logs || [])])
      }
      setTotal(data?.pagination?.total || 0)
      setHasMore(data?.pagination?.hasMore || false)
    } catch (e) {
      notifyError(e)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [filters, logs.length])

  useEffect(() => { load(true) }, [filters])

  const handleRowClick = (log) => {
    setSelectedLog(log)
    setDetailOpen(true)
  }

  // Unique actions list for filter (from ACTION_META)
  const actionOptions = Object.keys(ACTION_META).sort()

  return (
    <div className="module-page p-4 md:p-6 space-y-6 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="uk-page-header flex flex-col md:flex-row md:items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ScrollText className="w-6 h-6 text-primary" />
            سجل العمليات
          </h1>
          <p className="text-muted-foreground text-sm">سجل تدقيق كامل لجميع العمليات في النظام</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => load(true)} disabled={loading}>
          <RefreshCw className={`w-4 h-4 ml-1 ${loading ? 'animate-spin' : ''}`} />
          تحديث
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="unikasher-card kpi-tint-blue p-4">
          <div className="w-10 h-10 rounded-xl bg-white/70 dark:bg-black/20 flex items-center justify-center mb-2 shadow-sm">
            <ScrollText className="w-5 h-5" strokeWidth={2.25} />
          </div>
          <p className="text-xs font-medium opacity-70 mb-1">إجمالي السجلات (مفلتر)</p>
          <p className="text-lg font-bold pos-number">{new Intl.NumberFormat('ar-EG').format(total)}</p>
        </div>
        <div className="unikasher-card kpi-tint-green p-4">
          <div className="w-10 h-10 rounded-xl bg-white/70 dark:bg-black/20 flex items-center justify-center mb-2 shadow-sm">
            <Database className="w-5 h-5" strokeWidth={2.25} />
          </div>
          <p className="text-xs font-medium opacity-70 mb-1">السجلات المعروضة</p>
          <p className="text-lg font-bold pos-number">{new Intl.NumberFormat('ar-EG').format(logs.length)}</p>
        </div>
        <div className="unikasher-card kpi-tint-yellow p-4">
          <div className="w-10 h-10 rounded-xl bg-white/70 dark:bg-black/20 flex items-center justify-center mb-2 shadow-sm">
            <AlertTriangle className="w-5 h-5" strokeWidth={2.25} />
          </div>
          <p className="text-xs font-medium opacity-70 mb-1">أنواع العمليات</p>
          <p className="text-lg font-bold pos-number">{actionOptions.length}</p>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <Filter className="w-4 h-4" />
              فلترة:
            </div>
            <div className="w-56">
              <Select value={filters.action} onValueChange={(v) => setFilters(f => ({ ...f, action: v }))}>
                <SelectTrigger><SelectValue placeholder="نوع العملية" /></SelectTrigger>
                <SelectContent className="max-h-80">
                  <SelectItem value="all">كل العمليات</SelectItem>
                  {actionOptions.map(a => (
                    <SelectItem key={a} value={a}>{ACTION_META[a].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-48">
              <Select value={filters.entity} onValueChange={(v) => setFilters(f => ({ ...f, entity: v }))}>
                <SelectTrigger><SelectValue placeholder="الكيان" /></SelectTrigger>
                <SelectContent className="max-h-80">
                  <SelectItem value="all">كل الكيانات</SelectItem>
                  {Object.entries(ENTITY_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">من تاريخ</Label>
              <Input type="date" value={filters.dateFrom} onChange={(e) => setFilters(f => ({ ...f, dateFrom: e.target.value }))} className="w-40" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">إلى تاريخ</Label>
              <Input type="date" value={filters.dateTo} onChange={(e) => setFilters(f => ({ ...f, dateTo: e.target.value }))} className="w-40" />
            </div>
            <Button variant="ghost" size="sm" onClick={() => setFilters({ action: 'all', entity: 'all', dateFrom: '', dateTo: '' })}>
              مسح الفلاتر
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">السجلات ({logs.length} من {new Intl.NumberFormat('ar-EG').format(total)})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4 space-y-2">
              {[1, 2, 3, 4, 5, 6, 7, 8].map(i => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : logs.length ? (
            <DataTable
              maxHeight="600px"
              columns={[
                { key: 'c0', header: 'المستخدم', render: (log) => (
                    <div className="flex items-center gap-2">
                                                <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center shrink-0">
                                                  <User className="w-3.5 h-3.5 text-muted-foreground" />
                                                </div>
                                                <div className="min-w-0">
                                                  <p className="text-sm font-medium truncate">{log.user?.name || '—'}</p>
                                                  <p className="text-xs text-muted-foreground truncate">{log.user?.username || ''}</p>
                                                </div>
                                              </div>
                  ) },
                { key: 'c1', header: 'العملية', render: (log) => {
                    const meta = getActionMeta(log.action)
                                        const Icon = meta.icon
                                        const entityLabel = (log.entity ? ENTITY_LABELS[log.entity] : undefined) || log.entity || '?'
                    return (
                    <Badge variant="outline" className={`text-xs ${meta.color}`}>
                                                <Icon className="w-3 h-3 ml-1" />
                                                {meta.label}
                                              </Badge>
                    )
                  } },
                { key: 'c2', header: 'الكيان', cellClassName: "text-sm", render: (log) => {
                    const meta = getActionMeta(log.action)
                                        const Icon = meta.icon
                                        const entityLabel = (log.entity ? ENTITY_LABELS[log.entity] : undefined) || log.entity || '?'
                    return (
                    <><span className="text-muted-foreground">{entityLabel}</span>
                                              {log.entityId && (
                                                <span className="text-xs text-muted-foreground block font-mono" dir="ltr">{log.entityId.slice(-8)}</span>
                                              )}</>
                    )
                  } },
                { key: 'c3', header: 'الوقت', cellClassName: "text-xs text-muted-foreground", render: (log) => (
                    <div className="flex items-center gap-1">
                                                <Clock className="w-3 h-3" />
                                                {formatDateTime(log.createdAt)}
                                              </div>
                  ) },
                { key: 'c4', header: 'التفاصيل', cellClassName: "text-xs text-muted-foreground max-w-xs", render: (log) => log.after ? log.after.slice(0, 60) : '—' },
                { key: 'c5', header: 'إجراءات', render: (log) => <ChevronLeft className="w-4 h-4 text-muted-foreground" /> },
              ]}
              rows={logs}
              onRowClick={(log) => handleRowClick(log)}
            />
          ) : (
            <div className="text-center py-12 uk-empty">
              <ScrollText className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground uk-empty-title">لا توجد سجلات مطابقة للفلاتر</p>
              <p className="text-xs text-muted-foreground uk-empty-hint">كل عملية على النظام بتسجل تلقائيًا — وسّع نطاق التاريخ أو صفّي أقل.</p>
            </div>
          )}
        </CardContent>
        {hasMore && !loading && (
          <div className="p-3 border-t flex justify-center">
            <Button variant="outline" size="sm" onClick={() => load(false)} disabled={loadingMore}>
              {loadingMore ? 'جاري التحميل...' : 'تحميل المزيد'}
            </Button>
          </div>
        )}
      </Card>

      {/* Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {(() => {
                const meta = getActionMeta(selectedLog?.action ?? '')
                const Icon = meta.icon
                return <><Icon className="w-5 h-5" />{meta.label}</>
              })()}
            </DialogTitle>
            <DialogDescription>
              تفاصيل العملية على {ENTITY_LABELS[selectedLog?.entity ?? ''] ?? selectedLog?.entity ?? '?'}
            </DialogDescription>
          </DialogHeader>
          {selectedLog && (
            <div className="space-y-4 max-h-[70vh] overflow-y-auto">
              {/* Meta grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-muted/50">
                  <p className="text-xs text-muted-foreground mb-1">المستخدم</p>
                  <p className="text-sm font-medium">{selectedLog.user?.name || '—'}</p>
                  <p className="text-xs text-muted-foreground">{selectedLog.user?.username} · {selectedLog.user?.role}</p>
                </div>
                <div className="p-3 rounded-lg bg-muted/50">
                  <p className="text-xs text-muted-foreground mb-1">وقت العملية</p>
                  <p className="text-sm font-medium">{formatDateTime(selectedLog.createdAt)}</p>
                </div>
                <div className="p-3 rounded-lg bg-muted/50">
                  <p className="text-xs text-muted-foreground mb-1">الكيان</p>
                  <p className="text-sm font-medium">{ENTITY_LABELS[selectedLog.entity ?? ''] ?? selectedLog.entity ?? '?'}</p>
                </div>
                <div className="p-3 rounded-lg bg-muted/50">
                  <p className="text-xs text-muted-foreground mb-1">معرف الكيان</p>
                  <p className="text-sm font-mono" dir="ltr">{selectedLog.entityId}</p>
                </div>
              </div>

              {/* Action badge */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">نوع العملية:</span>
                {(() => {
                  const meta = getActionMeta(selectedLog.action)
                  const Icon = meta.icon
                  return (
                    <Badge variant="outline" className={meta.color}>
                      <Icon className="w-3 h-3 ml-1" />
                      {meta.label}
                    </Badge>
                  )
                })()}
                <span className="text-xs text-muted-foreground font-mono" dir="ltr">{selectedLog.action}</span>
              </div>

              {/* Before */}
              {selectedLog.before && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-2 h-2 rounded-full bg-red-500" />
                    <p className="text-sm font-medium">قبل التعديل</p>
                  </div>
                  <pre className="p-3 rounded-lg bg-red-50 dark:bg-red-950/20 text-xs overflow-x-auto border border-red-200 dark:border-red-900" dir="ltr">
                    <code className="font-mono">{prettyJson(selectedLog.before)}</code>
                  </pre>
                </div>
              )}

              {/* After */}
              {selectedLog.after && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-2 h-2 rounded-full bg-green-500" />
                    <p className="text-sm font-medium">بعد التعديل</p>
                  </div>
                  <pre className="p-3 rounded-lg bg-green-50 dark:bg-green-950/20 text-xs overflow-x-auto border border-green-200 dark:border-green-900" dir="ltr">
                    <code className="font-mono">{prettyJson(selectedLog.after)}</code>
                  </pre>
                </div>
              )}

              {!selectedLog.before && !selectedLog.after && (
                <p className="text-sm text-muted-foreground text-center py-4">لا توجد تفاصيل إضافية</p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
