'use client'

import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { apiFetch, formatEGP, formatNumber, formatDateTime } from '@/lib/api'
import { exportTextFile } from '@/lib/export-file'
import { useDebounce } from '@/hooks/use-debounce'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import {
  Plus, Search, Pencil, Truck, Download, Upload, RefreshCw, Phone, Mail, MapPin,
  FileText, Wallet, ShoppingBag, Receipt, X,
} from 'lucide-react'
import { toast } from 'sonner'
import type { Supplier } from '@/lib/types'

type SupplierListRow = Supplier & {
  purchaseSummary?: { balance?: number; totalPurchases?: number; totalPaid?: number }
  purchases?: Array<{ id: string; createdAt?: string }>
}
import { notifyError } from '@/lib/notify'
import { DataTable } from '@/components/ui/data-table'
interface SupplierDetail extends Supplier {
  purchases?: Array<{ id: string; invoiceNumber?: string | null; createdAt?: string; total?: number; paidAmount?: number; status?: string; items?: Array<{ id: string }> }>
  payments?: Array<{ id: string; paidAt?: string; createdAt?: string; amount?: number; source?: string; note?: string | null }>
  _loading?: boolean
  summary?: { totalPurchases?: number; totalPaid?: number; balance?: number; paymentCount?: number }
}
interface SupplierImportRow { name: string; phone: string; email: string; address: string; taxId: string }

const KPI_TINTS = ['kpi-tint-blue', 'kpi-tint-green', 'kpi-tint-purple', 'kpi-tint-yellow', 'kpi-tint-pink', 'kpi-tint-teal']

interface SupplierFormState {
  name: string
  phone: string
  email: string
  address: string
  taxId: string
}

const EMPTY_FORM: SupplierFormState = {
  name: '', phone: '', email: '', address: '', taxId: '',
}

export function SuppliersModule() {
  const [suppliers, setSuppliers] = useState<SupplierListRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Supplier | null>(null)
  const [form, setForm] = useState<SupplierFormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [detail, setDetail] = useState<SupplierDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [importPreview, setImportPreview] = useState<SupplierImportRow[] | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const debouncedSearch = useDebounce(search, 350)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (debouncedSearch) params.set('search', debouncedSearch)
      params.set('limit', '500')
      const data = await apiFetch(`/suppliers?${params.toString()}`)
      setSuppliers(data || [])
    } catch (e) {
      notifyError(e)
    } finally {
      setLoading(false)
    }
  }, [debouncedSearch])

  useEffect(() => {
    load()
  }, [load])

  const stats = useMemo(() => {
    const total = suppliers.length
    const totalDue = suppliers.reduce((s, sup) => s + (sup.purchaseSummary?.balance || sup.balance || 0), 0)
    const totalPurchases = suppliers.reduce((s, sup) => s + (sup.purchaseSummary?.totalPurchases || 0), 0)
    const avg = total > 0 ? totalPurchases / total : 0
    return { total, totalDue, totalPurchases, avg }
  }, [suppliers])

  const openAdd = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setDialogOpen(true)
  }

  const openEdit = (s: SupplierListRow) => {
    setEditing(s)
    setForm({
      name: s.name || '',
      phone: s.phone || '',
      email: s.email || '',
      address: s.address || '',
      taxId: s.taxId || '',
    })
    setDialogOpen(true)
  }

  const handleSave = async () => {
    if (!form.name) {
      toast.error('اسم المورد مطلوب')
      return
    }
    setSaving(true)
    try {
      const body: Record<string, unknown> = { ...form }
      if (editing) {
        await apiFetch(`/suppliers/${editing.id}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        })
        toast.success('تم تحديث المورد')
      } else {
        await apiFetch('/suppliers', {
          method: 'POST',
          body: JSON.stringify(body),
        })
        toast.success('تم إنشاء المورد بنجاح')
      }
      setDialogOpen(false)
      load()
    } catch (e) {
      notifyError(e)
    } finally {
      setSaving(false)
    }
  }

  const openDetail = async (s: SupplierListRow) => {
    setDetailLoading(true)
    setDetail({ ...s, _loading: true } as SupplierDetail)
    try {
      const full = await apiFetch(`/suppliers/${s.id}`)
      setDetail(full)
    } catch (e) {
      notifyError(e)
      setDetail(null)
    } finally {
      setDetailLoading(false)
    }
  }

  const exportCSV = async () => {
    const headers = ['الاسم', 'الهاتف', 'البريد', 'العنوان', 'الرقم الضريبي', 'الرصيد', 'إجمالي المشتريات']
    const lines = [headers.join(',')]
    suppliers.forEach((s) => {
      const line = [
        `"${s.name || ''}"`,
        `"${s.phone || ''}"`,
        `"${s.email || ''}"`,
        `"${s.address || ''}"`,
        `"${s.taxId || ''}"`,
        s.purchaseSummary?.balance || s.balance || 0,
        s.purchaseSummary?.totalPurchases || 0,
      ]
      lines.push(line.join(','))
    })
    const csv = lines.join('\n')
    await exportTextFile(`suppliers-${new Date().toISOString().slice(0, 10)}.csv`, csv)
    toast.success(`تم تصدير ${suppliers.length} مورد`)
  }

  const handleImportClick = () => fileInputRef.current?.click()

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const lines = text.split(/\r?\n/).filter(Boolean)
      if (lines.length < 2) {
        toast.error('الملف فارغ أو غير صالح')
        return
      }
      // Expects columns: الاسم, الهاتف, البريد, العنوان, الرقم الضريبي
      // (name, phone, email, address, taxId)
      const parsed = lines.slice(1).map((line) => {
        const cells: string[] = []
        let cur = ''
        let inQ = false
        for (let i = 0; i < line.length; i++) {
          const ch = line[i]
          if (ch === '"') inQ = !inQ
          else if (ch === ',' && !inQ) { cells.push(cur); cur = '' }
          else cur += ch
        }
        cells.push(cur)
        return cells
      }).map((c) => ({
        name: (c[0] || '').trim(),
        phone: (c[1] || '').trim(),
        email: (c[2] || '').trim(),
        address: (c[3] || '').trim(),
        taxId: (c[4] || '').trim(),
      })).filter((r) => r.name)
      if (parsed.length === 0) {
        toast.error('لم يتم العثور على أي موردين صالحين في الملف')
        return
      }
      setImportPreview(parsed)
      toast.success(`تم تحميل ${parsed.length} سجل`)
    } catch (err) {
      toast.error('فشل قراءة الملف: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const confirmImport = async () => {
    if (!importPreview) return
    let ok = 0
    let fail = 0
    for (const row of importPreview) {
      try {
        await apiFetch('/suppliers', {
          method: 'POST',
          body: JSON.stringify({
            name: row.name,
            phone: row.phone || undefined,
            email: row.email || undefined,
            address: row.address || undefined,
            taxId: row.taxId || undefined,
            active: true,
          }),
        })
        ok++
      } catch {
        fail++
      }
    }
    toast.success(`تم استيراد ${ok} مورد${fail ? `, فشل ${fail}` : ''}`)
    setImportPreview(null)
    load()
  }

  const summaryCards = [
    { label: 'إجمالي الموردين', value: formatNumber(stats.total), icon: Truck, color: 'text-blue-600', bg: 'bg-blue-500/10' },
    { label: 'المستحق بالكامل', value: formatEGP(stats.totalDue), icon: Wallet, color: 'text-orange-600', bg: 'bg-orange-500/10' },
    { label: 'إجمالي المشتريات', value: formatEGP(stats.totalPurchases), icon: ShoppingBag, color: 'text-green-600', bg: 'bg-green-500/10' },
    { label: 'متوسط الشراء', value: formatEGP(stats.avg), icon: Receipt, color: 'text-purple-600', bg: 'bg-purple-500/10' },
  ]

  return (
    <div className="module-page p-4 md:p-6 space-y-6 max-w-[1600px] mx-auto animate-page-enter">
      {/* Header */}
      <div className="uk-page-header flex flex-col md:flex-row md:items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Truck className="w-6 h-6 text-primary" />
            الموردون
          </h1>
          <p className="text-muted-foreground text-sm max-w-2xl leading-6">إدارة الموردين وفواتير الشراء</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={handleImportFile}
          />
          <Button className="ux-action-btn" variant="outline" size="sm" onClick={handleImportClick}>
            <Upload className="w-4 h-4" />
            استيراد CSV
          </Button>
          <Button className="ux-action-btn" variant="outline" size="sm" onClick={exportCSV} disabled={suppliers.length === 0}>
            <Download className="w-4 h-4" />
            تصدير CSV
          </Button>
          <Button className="ux-action-btn" variant="outline" size="sm" onClick={load}>
            <RefreshCw className="w-4 h-4" />
            تحديث
          </Button>
          <Button className="ux-action-btn" size="sm" onClick={openAdd}>
            <Plus className="w-4 h-4" />
            إضافة مورد
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

      {/* Search */}
      <Card>
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="ابحث بالاسم أو الهاتف..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pr-9"
            />
          </div>
        </CardContent>
      </Card>

      {/* DataTable */}
      <DataTable
        fillHeight={true}
        reserveHeight={350}
        minHeight="480px"
        minWidth="min-w-[960px]"
        loading={loading}
        emptyMessage="لا يوجد موردون — أضف أول مورد من الزر أعلى الصفحة"
        columns={[
          { key: 'name', header: 'الاسم', cellClassName: "font-medium", render: (s) => s.name },
          { key: 'phone', header: 'الهاتف', cellClassName: "text-muted-foreground", render: (s) => s.phone || '—' },
          { key: 'email', header: 'البريد', cellClassName: "text-muted-foreground", render: (s) => s.email || '—' },
          { key: 'address', header: 'العنوان', cellClassName: "text-muted-foreground text-sm", render: (s) => s.address || '—' },
          { key: 'taxId', header: 'الرقم الضريبي', cellClassName: "font-mono text-xs", render: (s) => s.taxId || '—' },
          {
            key: 'balance',
            header: 'الرصيد المستحق',
            align: 'center',
            render: (s) => {
              const balance = s.purchaseSummary?.balance || s.balance || 0
              return (
                <Badge
                  variant="outline"
                  className={
                    balance > 0
                      ? 'bg-orange-500/10 text-orange-700 border-orange-500/20 pos-number font-bold'
                      : 'bg-green-500/10 text-green-700 border-green-500/20 pos-number font-bold'
                  }
                >
                  {formatEGP(balance)}
                </Badge>
              )
            }
          },
          {
            key: 'totalPurchases',
            header: 'إجمالي المشتريات',
            align: 'center',
            cellClassName: "pos-number font-medium",
            render: (s) => formatEGP(s.purchaseSummary?.totalPurchases || 0)
          },
          {
            key: 'totalPaid',
            header: 'إجمالي المدفوع',
            align: 'center',
            cellClassName: "pos-number font-medium text-green-600",
            render: (s) => formatEGP(s.purchaseSummary?.totalPaid || 0)
          },
          {
            key: 'lastPurchase',
            header: 'آخر شراء',
            cellClassName: "text-muted-foreground text-sm",
            render: (s) => {
              const lastPurchase = s.purchases?.[0]?.createdAt || s.updatedAt
              return lastPurchase ? formatDateTime(lastPurchase) : '—'
            }
          },
          {
            key: 'actions',
            header: 'إجراءات',
            align: 'center',
            render: (s) => (
              <div className="flex justify-center gap-1" onClick={(e) => e.stopPropagation()}>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => openEdit(s)}
                  aria-label={`تعديل المورد ${s.name}`}
                  title="تعديل المورد"
                >
                  <Pencil className="w-4 h-4" />
                </Button>
              </div>
            )
          }
        ]}
        rows={suppliers}
        onRowClick={(s) => openDetail(s)}
      />

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'تعديل مورد' : 'إضافة مورد'}</DialogTitle>
            <DialogDescription>
              {editing ? 'تحديث بيانات المورد' : 'إنشاء مورد جديد'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="sname">الاسم *</Label>
              <Input
                id="sname"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="اسم المورد"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="sphone">الهاتف</Label>
                <Input
                  id="sphone"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="01xxxxxxxxx"
                  dir="ltr"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="staxId">الرقم الضريبي</Label>
                <Input
                  id="staxId"
                  value={form.taxId}
                  onChange={(e) => setForm({ ...form, taxId: e.target.value })}
                  placeholder="xxx-xxx-xxx"
                  dir="ltr"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="semail">البريد الإلكتروني</Label>
              <Input
                id="semail"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="supplier@example.com"
                dir="ltr"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="saddress">العنوان</Label>
              <Input
                id="saddress"
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="العنوان"
              />
            </div>
          </div>
          <DialogFooter>
            <Button className="ux-action-btn" variant="outline" onClick={() => setDialogOpen(false)}>إلغاء</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'جاري الحفظ...' : 'حفظ'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Truck className="w-5 h-5" />
              {detail?.name || 'تفاصيل المورد'}
            </DialogTitle>
            <DialogDescription>ملف المورد وسجل المشتريات</DialogDescription>
          </DialogHeader>

          {detailLoading || detail?._loading ? (
            <div className="space-y-2 py-4">
              <Skeleton className="h-20" />
              <Skeleton className="h-40" />
            </div>
          ) : detail ? (
            <ScrollArea className="max-h-[70vh]">
              <div className="space-y-4 pr-1">
                {/* Profile */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 rounded-lg bg-muted/30">
                  <div className="flex items-start gap-2">
                    <Phone className="w-4 h-4 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-xs text-muted-foreground">الهاتف</p>
                      <p className="text-sm" dir="ltr">{detail.phone || '—'}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <Mail className="w-4 h-4 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-xs text-muted-foreground">البريد</p>
                      <p className="text-sm" dir="ltr">{detail.email || '—'}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <MapPin className="w-4 h-4 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-xs text-muted-foreground">العنوان</p>
                      <p className="text-sm">{detail.address || '—'}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <FileText className="w-4 h-4 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-xs text-muted-foreground">الرقم الضريبي</p>
                      <p className="text-sm font-mono" dir="ltr">{detail.taxId || '—'}</p>
                    </div>
                  </div>
                </div>

                {/* Balance info */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="p-3 rounded-lg bg-green-500/5 border border-green-500/20 text-center">
                    <p className="text-xs text-muted-foreground">إجمالي المشتريات</p>
                    <p className="text-lg font-bold pos-number text-green-700">
                      {formatEGP(detail.summary?.totalPurchases || 0)}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-blue-500/5 border border-blue-500/20 text-center">
                    <p className="text-xs text-muted-foreground">إجمالي المدفوع</p>
                    <p className="text-lg font-bold pos-number text-blue-700">
                      {formatEGP(detail.summary?.totalPaid || 0)}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-orange-500/5 border border-orange-500/20 text-center">
                    <p className="text-xs text-muted-foreground">الرصيد المستحق</p>
                    <p className="text-lg font-bold pos-number text-orange-700">
                      {formatEGP(detail.summary?.balance || detail.balance || 0)}
                    </p>
                  </div>
                </div>

                <Separator />

                {/* Purchase history */}
                <div>
                  <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                    <ShoppingBag className="w-4 h-4 text-blue-500" />
                    سجل المشتريات ({formatNumber(detail.purchases?.length || 0)})
                  </h3>
                  {detail.purchases && detail.purchases.length > 0 ? (
                    <div className="rounded-md border">
                      <DataTable
                        maxHeight="480px"
                        className="ux-data-table"
                        columns={[
                          { key: 'c0', header: 'رقم الفاتورة', cellClassName: "font-mono text-xs", render: (p) => p.invoiceNumber },
                          { key: 'c1', header: 'التاريخ', cellClassName: "text-sm", render: (p) => formatDateTime(p.createdAt) },
                          { key: 'c2', header: 'الأصناف', align: 'center', cellClassName: "pos-number", render: (p) => formatNumber(p.items?.length || 0) },
                          { key: 'c3', header: 'الإجمالي', align: 'center', cellClassName: "pos-number font-medium", render: (p) => formatEGP(p.total) },
                          { key: 'c4', header: 'المدفوع', align: 'center', cellClassName: "pos-number text-green-600", render: (p) => formatEGP(p.paidAmount) },
                          { key: 'c5', header: 'الحالة', align: 'center', render: (p) => (
                              <Badge variant="outline" className={
                                                                p.status === 'PAID' ? 'bg-green-500/10 text-green-700 border-green-500/20' :
                                                                p.status === 'PARTIAL' ? 'bg-amber-500/10 text-amber-700 border-amber-500/20' :
                                                                p.status === 'RECEIVED' ? 'bg-blue-500/10 text-blue-700 border-blue-500/20' :
                                                                'bg-gray-500/10 text-gray-700 border-gray-500/20'
                                                              }>
                                                                {p.status === 'PAID' ? 'مدفوعة' :
                                                                 p.status === 'PARTIAL' ? 'جزئية' :
                                                                 p.status === 'RECEIVED' ? 'مستلمة' :
                                                                 p.status === 'PENDING' ? 'قيد الانتظار' : p.status}
                                                              </Badge>
                            ) },
                        ]}
                        rows={detail.purchases}
                      />
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground py-3 text-center">لا توجد مشتريات</p>
                  )}
                </div>

                <div className="space-y-3">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <div className="p-3 rounded-lg border bg-muted/20"><p className="text-xs text-muted-foreground">إجمالي المشتريات</p><p className="font-bold pos-number">{formatEGP(detail.summary?.totalPurchases || 0)}</p></div>
                    <div className="p-3 rounded-lg border bg-muted/20"><p className="text-xs text-muted-foreground">إجمالي المدفوع</p><p className="font-bold pos-number text-green-700">{formatEGP(detail.summary?.totalPaid || 0)}</p></div>
                    <div className="p-3 rounded-lg border bg-muted/20"><p className="text-xs text-muted-foreground">المتبقي</p><p className="font-bold pos-number text-orange-700">{formatEGP(detail.summary?.balance || 0)}</p></div>
                    <div className="p-3 rounded-lg border bg-muted/20"><p className="text-xs text-muted-foreground">عدد الدفعات</p><p className="font-bold pos-number">{formatNumber(detail.summary?.paymentCount || 0)}</p></div>
                  </div>
                  <div className="rounded-lg border overflow-auto">
                    <DataTable
                      maxHeight="480px"
                      className="ux-data-table"
                      columns={[
                        { key: 'c0', header: 'التاريخ', render: (pay) => formatDateTime(pay.paidAt || pay.createdAt) },
                        { key: 'c1', header: 'المبلغ', cellClassName: "font-bold pos-number", render: (pay) => formatEGP(pay.amount || 0) },
                        { key: 'c2', header: 'المصدر', render: (pay) => pay.source === 'CASHBOX' ? 'الخزنة' : pay.source === 'OUTSIDE_CASH' ? 'خارج الخزنة' : pay.source === 'CARD' ? 'بطاقة' : pay.source },
                        { key: 'c3', header: 'البيان', render: (pay) => pay.note || 'سداد مورد' },
                      ]}
                      rows={(detail.payments || [])}
                      emptyMessage='لا توجد دفعات مسجلة'
                    />
                  </div>
                </div>

                {detail && (
                  <div className="flex justify-end pt-2">
                    <Button className="ux-action-btn" variant="outline" size="sm" onClick={() => { setDetail(null); openEdit(detail) }}>
                      <Pencil className="w-4 h-4" />
                      تعديل البيانات
                    </Button>
                  </div>
                )}
              </div>
            </ScrollArea>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Import Preview Dialog */}
      <Dialog open={!!importPreview} onOpenChange={(o) => !o && setImportPreview(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>معاينة استيراد الموردين</DialogTitle>
            <DialogDescription>
              تم تحليل {importPreview?.length || 0} سجل. سيتم إنشاء موردين جدد.
            </DialogDescription>
          </DialogHeader>
          <DataTable
            maxHeight="480px"
            className="ux-data-table"
            columns={[
              { key: 'c0', header: 'الاسم', render: (r) => r.name || '—' },
              { key: 'c1', header: 'الهاتف', cellClassName: "text-xs", render: (r) => r.phone || '—' },
              { key: 'c2', header: 'البريد', cellClassName: "text-xs", render: (r) => r.email || '—' },
              { key: 'c3', header: 'الرقم الضريبي', cellClassName: "text-xs", render: (r) => r.taxId || '—' },
            ]}
            rows={importPreview ?? []}
          />
          <DialogFooter>
            <Button className="ux-action-btn" variant="outline" onClick={() => setImportPreview(null)}>
              <X className="w-4 h-4" />
              إلغاء
            </Button>
            <Button onClick={confirmImport}>
              <Upload className="w-4 h-4" />
              تأكيد الاستيراد ({importPreview?.length || 0})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
