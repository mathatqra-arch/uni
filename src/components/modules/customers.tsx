'use client'

import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { apiFetch, formatEGP, formatNumber, formatDate, formatDateTime } from '@/lib/api'
import { exportTextFile } from '@/lib/export-file'
import { useDebounce } from '@/hooks/use-debounce'
import { Card, CardContent } from '@/components/ui/card'
import { DataTable } from '@/components/ui/data-table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select'
import {
  Plus, Search, Pencil, Users, Crown, Download, Upload, RefreshCw, Phone, Mail, MapPin,
  Cake, Star, ShoppingBag, Coins, TrendingUp, X, FileText } from 'lucide-react'
import { toast } from 'sonner'
import type { Customer, LoyaltyTransaction } from '@/lib/types'
import { notifyError } from '@/lib/notify'
type CustomerListRow = Customer & { _count?: { sales?: number } }

interface CustomerDetail extends Customer {
  sales?: Array<{ id: string; invoiceNumber?: string; createdAt?: string; total?: number; items?: Array<{ id: string }> }>
  loyaltyTransactions?: LoyaltyTransaction[]
  _loading?: boolean
  _count?: { sales?: number }
}
interface CustomerImportRow { name: string; phone: string; email: string; address: string; tier: string; pointsPerEgp: string }

const KPI_TINTS = ['kpi-tint-blue', 'kpi-tint-green', 'kpi-tint-purple', 'kpi-tint-yellow', 'kpi-tint-pink', 'kpi-tint-teal']

interface CustomerFormState {
  name: string
  phone: string
  email: string
  address: string
  birthday: string
  notes: string
  tier: string
}

const EMPTY_FORM: CustomerFormState = {
  name: '', phone: '', email: '', address: '', birthday: '', notes: '', tier: 'BRONZE',
}

const TIER_META: Record<string, { label: string; className: string }> = {
  BRONZE: { label: 'برونزي', className: 'bg-amber-700/10 text-amber-800 border-amber-700/30' },
  SILVER: { label: 'فضي', className: 'bg-gray-400/10 text-gray-700 border-gray-400/30' },
  GOLD: { label: 'ذهبي', className: 'bg-amber-500/10 text-amber-600 border-amber-500/30' },
  VIP: { label: 'VIP', className: 'bg-purple-500/10 text-purple-700 border-purple-500/30' },
}

function TierBadge({ tier }: { tier: string }) {
  const meta = TIER_META[tier] || TIER_META.BRONZE
  return (
    <Badge variant="outline" className={meta.className}>
      <Crown className="w-3 h-3 ml-1" />
      {meta.label}
    </Badge>
  )
}

export function CustomersModule() {
  const [customers, setCustomers] = useState<CustomerListRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [tierFilter, setTierFilter] = useState('all')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Customer | null>(null)
  const [form, setForm] = useState<CustomerFormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [detail, setDetail] = useState<CustomerDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [importPreview, setImportPreview] = useState<CustomerImportRow[] | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // FIX: was a hardcoded 0.05 EGP/point guess with no relation to the
  // Use the same configurable loyalty earn rate as the desktop sale flow.
  // actually uses. Fetched once from /loyalty/rate and used to convert
  // points -> EGP everywhere below instead.
  const [pointsPerEgp, setPointsPerEgp] = useState(0.1)

  const debouncedSearch = useDebounce(search, 350)

  useEffect(() => {
    apiFetch('/loyalty/rate').then((r) => {
      if (r?.pointsPerEgp > 0) setPointsPerEgp(r.pointsPerEgp)
    }).catch(() => { /* non-blocking UI refresh */ })
  }, [])

  const pointsToEGP = useCallback((points: number) => (pointsPerEgp > 0 ? points / pointsPerEgp : 0), [pointsPerEgp])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (debouncedSearch) params.set('search', debouncedSearch)
      if (tierFilter !== 'all') params.set('tier', tierFilter)
      params.set('limit', '500')
      const data = await apiFetch(`/customers?${params.toString()}`)
      setCustomers(data || [])
    } catch (e) {
      notifyError(e)
    } finally {
      setLoading(false)
    }
  }, [debouncedSearch, tierFilter])

  useEffect(() => {
    load()
  }, [load])

  const stats = useMemo(() => {
    const total = customers.length
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const newThisMonth = customers.filter((c) => new Date(c.createdAt ?? 0) >= monthStart).length
    const vipCount = customers.filter((c) => c.tier === 'VIP').length
    const totalSpend = customers.reduce((s, c) => s + pointsToEGP(c.loyaltyAccount?.totalEarned || 0), 0)
    const avgSpend = total > 0 ? totalSpend / total : 0
    return { total, newThisMonth, vipCount, avgSpend }
  }, [customers, pointsToEGP])

  const openAdd = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setDialogOpen(true)
  }

  const openEdit = (c: Customer) => {
    setEditing(c)
    setForm({
      name: c.name || '',
      phone: c.phone || '',
      email: c.email || '',
      address: c.address || '',
      birthday: c.birthday ? new Date(c.birthday).toISOString().slice(0, 10) : '',
      notes: c.notes || '',
      tier: c.tier || 'BRONZE',
    })
    setDialogOpen(true)
  }

  const handleSave = async () => {
    if (!form.name) {
      toast.error('اسم العميل مطلوب')
      return
    }
    setSaving(true)
    try {
      const body: Record<string, unknown> = { ...form }
      if (!body.birthday) delete body.birthday
      if (editing) {
        await apiFetch(`/customers/${editing.id}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        })
        toast.success('تم تحديث العميل')
      } else {
        await apiFetch('/customers', {
          method: 'POST',
          body: JSON.stringify(body),
        })
        toast.success('تم إنشاء العميل بنجاح')
      }
      setDialogOpen(false)
      load()
    } catch (e) {
      notifyError(e)
    } finally {
      setSaving(false)
    }
  }

  const openDetail = async (c: Customer) => {
    setDetailLoading(true)
    setDetail({ ...c, _loading: true })
    try {
      const full = await apiFetch(`/customers/${c.id}`)
      setDetail(full)
    } catch (e) {
      notifyError(e)
      setDetail(null)
    } finally {
      setDetailLoading(false)
    }
  }

  const exportCSV = async () => {
    const headers = ['الاسم', 'الهاتف', 'البريد', 'الفئة', 'إجمالي الطلبات', 'إجمالي الإنفاق', 'نقاط الولاء']
    const lines = [headers.join(',')]
    customers.forEach((c) => {
      const lines_total = c._count?.sales || 0
      const totalEarned = c.loyaltyAccount?.totalEarned || 0
      const totalSpend = pointsToEGP(totalEarned)
      const line = [
        `"${c.name || ''}"`,
        `"${c.phone || ''}"`,
        `"${c.email || ''}"`,
        `"${TIER_META[c.tier]?.label || c.tier}"`,
        lines_total,
        totalSpend.toFixed(2),
        c.loyaltyAccount?.points || 0,
      ]
      lines.push(line.join(','))
    })
    const csv = lines.join('\n')
    await exportTextFile(`customers-${new Date().toISOString().slice(0, 10)}.csv`, csv)
    toast.success(`تم تصدير ${customers.length} عميل`)
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
      // Simple CSV parser handling quoted strings — expects columns:
      // الاسم, الهاتف, البريد, العنوان, الفئة (name, phone, email, address, tier)
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
        tier: (c[4] || 'BRONZE').trim().toUpperCase(),
      })).filter((r) => r.name)
      if (parsed.length === 0) {
        toast.error('لم يتم العثور على أي عملاء صالحين في الملف')
        return
      }
      setImportPreview(parsed as CustomerImportRow[])
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
        await apiFetch('/customers', {
          method: 'POST',
          body: JSON.stringify({
            name: row.name,
            phone: row.phone || undefined,
            email: row.email || undefined,
            address: row.address || undefined,
            tier: ['BRONZE', 'SILVER', 'GOLD', 'VIP'].includes(row.tier) ? row.tier : 'BRONZE',
          }),
        })
        ok++
      } catch {
        fail++
      }
    }
    toast.success(`تم استيراد ${ok} عميل${fail ? `, فشل ${fail}` : ''}`)
    setImportPreview(null)
    load()
  }

  const summaryCards = [
    { label: 'إجمالي العملاء', value: formatNumber(stats.total), icon: Users, color: 'text-blue-600', bg: 'bg-blue-500/10' },
    { label: 'عملاء جدد (هذا الشهر)', value: formatNumber(stats.newThisMonth), icon: TrendingUp, color: 'text-green-600', bg: 'bg-green-500/10' },
    { label: 'عملاء VIP', value: formatNumber(stats.vipCount), icon: Crown, color: 'text-purple-600', bg: 'bg-purple-500/10' },
    { label: 'متوسط الإنفاق', value: formatEGP(stats.avgSpend), icon: Coins, color: 'text-amber-600', bg: 'bg-amber-500/10' },
  ]

  return (
    <div className="module-page p-4 md:p-6 pb-6 space-y-6 max-w-[1600px] mx-auto h-full min-h-0 flex flex-col">

      {/* Top: header + summary in one card */}
      <Card className="uk-top-card">
        <CardContent className="p-4 md:p-5 space-y-4">
          <div className="uk-page-header flex flex-col md:flex-row md:items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <Users className="w-6 h-6 text-primary" />
                العملاء
              </h1>
              <p className="uk-page-header__subtitle">إدارة بيانات العملاء وبرنامج الولاء</p>
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
              <Button className="ux-action-btn" variant="outline" size="sm" onClick={exportCSV} disabled={customers.length === 0}>
                <Download className="w-4 h-4" />
                تصدير CSV
              </Button>
              <Button className="ux-action-btn" variant="outline" size="sm" onClick={load}>
                <RefreshCw className="w-4 h-4" />
                تحديث
              </Button>
              <Button className="ux-action-btn" size="sm" onClick={openAdd}>
                <Plus className="w-4 h-4" />
                إضافة عميل
              </Button>
            </div>
          </div>

          {/* Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
            {summaryCards.map((card, i) => {
              const Icon = card.icon
              return (
                <div key={i} className={`unikasher-card ${KPI_TINTS[i % KPI_TINTS.length]} p-4 min-w-0 overflow-hidden`}>
                  <div className="w-10 h-10 rounded-xl bg-white/70 dark:bg-black/20 flex items-center justify-center mb-2.5 shadow-sm">
                    <Icon className="w-5 h-5" strokeWidth={2.25} />
                  </div>
                  <p className="text-xs font-medium opacity-70 mb-1">{card.label}</p>
                  <p className="text-lg md:text-xl font-bold pos-number break-words">{card.value}</p>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="ابحث بالاسم أو الهاتف أو البريد..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pr-9"
              />
            </div>
            <Select value={tierFilter} onValueChange={setTierFilter}>
              <SelectTrigger className="md:w-48">
                <SelectValue placeholder="الكل" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الفئات</SelectItem>
                <SelectItem value="BRONZE">برونزي</SelectItem>
                <SelectItem value="SILVER">فضي</SelectItem>
                <SelectItem value="GOLD">ذهبي</SelectItem>
                <SelectItem value="VIP">VIP</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Table / Cards */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-14" />)}
        </div>
      ) : customers.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">

            <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>لا يوجد عملاء</p>
          
          </CardContent>
        </Card>
      ) : (
        <DataTable
          fillHeight={true}
                  reserveHeight={350}
                  minHeight="480px"
          minWidth="min-w-[900px]"
          loading={loading}
          emptyMessage="لا يوجد عملاء — أضف أول عميل من الزر أعلى الصفحة"
columns={[
                  { key: 'name', header: 'الاسم' },
                  { key: 'phone', header: 'الهاتف' },
                  { key: 'email', header: 'البريد' },
                  { key: 'tier', header: 'الفئة', align: 'center' },
                  { key: 'orders', header: 'الطلبات', align: 'center' },
                  { key: 'spend', header: 'الإنفاق', align: 'left' },
                  { key: 'points', header: 'نقاط الولاء', align: 'left' },
                  { key: 'last', header: 'آخر شراء', align: 'left' },
                  { key: 'actions', header: 'إجراءات', align: 'center' },
                ]}
rows={customers.map((c) => ({
                  id: c.id,
                  name: c.name,
                  phone: c.phone || '—',
                  email: c.email || '—',
                  tier: <TierBadge tier={c.tier} />,
                  orders: formatNumber(c._count?.sales || 0),
                  spend: formatEGP(pointsToEGP(c.loyaltyAccount?.totalEarned || 0)),
                  points: <Badge variant="secondary" className="pos-number">{formatNumber(c.loyaltyAccount?.points || 0)}</Badge>,
                  last: c.updatedAt ? formatDate(c.updatedAt) : '—',
                  actions: (
                    <div className="flex justify-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openDetail(c)} aria-label={`ملف العميل ${c.name}`} title="فتح ملف العميل"><FileText className="w-4 h-4" /></Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(c)} aria-label={`تعديل العميل ${c.name}`}><Pencil className="w-4 h-4" /></Button>
                    </div>
                  ),
                }))}
        />
      )}

          {/* Mobile cards */}
          {!loading && customers.length > 0 && <div className="md:hidden space-y-3">
            {customers.map((c) => {
              const totalSpend = pointsToEGP(c.loyaltyAccount?.totalEarned || 0)
              return (
                <Card key={c.id} onClick={() => openDetail(c)} className="cursor-pointer min-w-0 overflow-hidden">
                  <CardContent className="p-4 min-w-0 overflow-hidden">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="font-medium">{c.name}</p>
                        <p className="text-xs text-muted-foreground">{c.phone || '—'}</p>
                      </div>
                      <TierBadge tier={c.tier} />
                    </div>
                    <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                      <div className="min-w-0">
                        <p className="text-xs text-muted-foreground">الطلبات</p>
                        <p className="font-bold text-sm pos-number break-words">{formatNumber(c._count?.sales || 0)}</p>
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs text-muted-foreground">الإنفاق</p>
                        <p className="font-bold text-sm pos-number break-words">{formatEGP(totalSpend)}</p>
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs text-muted-foreground">النقاط</p>
                        <p className="font-bold text-sm pos-number break-words">{formatNumber(c.loyaltyAccount?.points || 0)}</p>
                      </div>
                    </div>
                    <Button className="ux-action-btn w-full mt-3" variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); openEdit(c) }}>
                      <Pencil className="w-4 h-4" />
                      تعديل
                    </Button>
                  </CardContent>
                </Card>
              )
            })}
          </div>}

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'تعديل عميل' : 'إضافة عميل'}</DialogTitle>
            <DialogDescription>
              {editing ? 'تحديث بيانات العميل' : 'إنشاء عميل جديد مع حساب ولاء تلقائي'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="name">الاسم *</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="اسم العميل"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="phone">الهاتف</Label>
                <Input
                  id="phone"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="01xxxxxxxxx"
                  dir="ltr"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="birthday">تاريخ الميلاد</Label>
                <Input
                  id="birthday"
                  type="date"
                  value={form.birthday}
                  onChange={(e) => setForm({ ...form, birthday: e.target.value })}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="email">البريد الإلكتروني</Label>
              <Input
                id="email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="customer@example.com"
                dir="ltr"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="address">العنوان</Label>
              <Input
                id="address"
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="العنوان"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="tier">الفئة</Label>
              <Select value={form.tier} onValueChange={(v) => setForm({ ...form, tier: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="BRONZE">برونزي</SelectItem>
                  <SelectItem value="SILVER">فضي</SelectItem>
                  <SelectItem value="GOLD">ذهبي</SelectItem>
                  <SelectItem value="VIP">VIP</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="notes">ملاحظات</Label>
              <Textarea
                id="notes"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="ملاحظات إضافية"
                rows={3}
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
              <Users className="w-5 h-5" />
              {detail?.name || 'تفاصيل العميل'}
              {detail?.tier && <TierBadge tier={detail.tier} />}
            </DialogTitle>
            <DialogDescription>ملف العميل وسجل المشتريات والولاء</DialogDescription>
          </DialogHeader>

          {detailLoading || detail?._loading ? (
            <div className="space-y-2 py-4">
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
              <Skeleton className="h-40" />
            </div>
          ) : detail ? (
            <ScrollArea className="max-h-[70vh]">
              <div className="space-y-4 pr-1">
                {/* Profile
                    FIX: a long email/phone with no spaces (e.g.
                    "somecustomer@verylongdomainname.com") is a single
                    unbreakable text token. Flex/grid children default to
                    min-width:auto, which refuses to shrink below that
                    token's width — so the cell (and the whole grid row)
                    got pushed wider than the dialog instead of wrapping,
                    spilling the card outside the visible dialog/screen on
                    narrower widths. min-w-0 lets the flex child actually
                    shrink to the grid track, and break-words lets long
                    tokens wrap instead of forcing overflow. */}
                {/* KPI strip: quick numbers before the profile */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="p-3 rounded-lg bg-blue-500/5 border border-blue-500/20 text-center min-w-0">
                    <p className="text-xs text-muted-foreground">عدد الفواتير</p>
                    <p className="text-lg font-bold pos-number text-blue-700 break-words">
                      {formatNumber(detail.sales?.length || 0)}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-green-500/5 border border-green-500/20 text-center min-w-0">
                    <p className="text-xs text-muted-foreground">إجمالي الإنفاق</p>
                    <p className="text-lg font-bold pos-number text-green-700 break-words">
                      {formatEGP((detail.sales || []).reduce((s, x) => s + (x.total || 0), 0))}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 text-center min-w-0">
                    <p className="text-xs text-muted-foreground">آخر شراء</p>
                    <p className="text-sm font-bold break-words">
                      {detail.sales && detail.sales.length > 0 ? formatDate(detail.sales[0].createdAt) : '—'}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-purple-500/5 border border-purple-500/20 text-center min-w-0">
                    <p className="text-xs text-muted-foreground">الفئة</p>
                    <p className="text-sm font-bold break-words">{TIER_META[detail.tier]?.label || detail.tier || '—'}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 rounded-lg bg-muted/30">
                  <div className="flex items-start gap-2 min-w-0">
                    <Phone className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">الهاتف</p>
                      <p className="text-sm break-words" dir="ltr">{detail.phone || '—'}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2 min-w-0">
                    <Mail className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">البريد</p>
                      <p className="text-sm break-words" dir="ltr">{detail.email || '—'}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2 min-w-0">
                    <MapPin className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">العنوان</p>
                      <p className="text-sm break-words">{detail.address || '—'}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2 min-w-0">
                    <Cake className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">الميلاد</p>
                      <p className="text-sm break-words">{detail.birthday ? formatDate(detail.birthday) : '—'}</p>
                    </div>
                  </div>
                </div>

                {detail.notes && (
                  <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
                    <p className="text-xs text-muted-foreground mb-1">ملاحظات</p>
                    <p className="text-sm">{detail.notes}</p>
                  </div>
                )}

                {/* Loyalty account */}
                <div>
                  <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                    <Star className="w-4 h-4 text-amber-500" />
                    حساب الولاء
                  </h3>
                  {/* FIX: same overflow class of bug as the profile grid
                      above — grid items default to min-width:auto, so a
                      long formatted number/currency string (e.g. a big
                      "قيمة النقاط" EGP value) refused to shrink and pushed
                      the box past the dialog width, spilling the loyalty
                      card outside its container on narrow screens. min-w-0
                      lets each box shrink to its grid track and break-words
                      lets the value wrap instead of overflowing. */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="p-3 rounded-lg bg-purple-500/5 border border-purple-500/20 text-center min-w-0">
                      <p className="text-xs text-muted-foreground">النقاط الحالية</p>
                      <p className="text-lg font-bold pos-number text-purple-700 break-words">
                        {formatNumber(detail.loyaltyAccount?.points || 0)}
                      </p>
                    </div>
                    <div className="p-3 rounded-lg bg-green-500/5 border border-green-500/20 text-center min-w-0">
                      <p className="text-xs text-muted-foreground">إجمالي المكتسبة</p>
                      <p className="text-lg font-bold pos-number text-green-700 break-words">
                        {formatNumber(detail.loyaltyAccount?.totalEarned || 0)}
                      </p>
                    </div>
                    <div className="p-3 rounded-lg bg-orange-500/5 border border-orange-500/20 text-center min-w-0">
                      <p className="text-xs text-muted-foreground">إجمالي المستبدلة</p>
                      <p className="text-lg font-bold pos-number text-orange-700 break-words">
                        {formatNumber(detail.loyaltyAccount?.totalRedeemed || 0)}
                      </p>
                    </div>
                    <div className="p-3 rounded-lg bg-blue-500/5 border border-blue-500/20 text-center min-w-0">
                      <p className="text-xs text-muted-foreground">قيمة النقاط</p>
                      <p className="text-lg font-bold pos-number text-blue-700 break-words">
                        {formatEGP(pointsToEGP(detail.loyaltyAccount?.points || 0))}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Recent sales */}
                <div>
                  <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                    <ShoppingBag className="w-4 h-4 text-blue-500" />
                    آخر المشتريات
                  </h3>
                  {detail.sales && detail.sales.length > 0 ? (
                    <div className="rounded-md border">
                      <DataTable
                        maxHeight="480px"
                        className="ux-data-table"
                        columns={[
                          { key: 'c0', header: 'رقم الفاتورة', cellClassName: "font-mono text-xs", render: (s) => s.invoiceNumber },
                          { key: 'c1', header: 'التاريخ', cellClassName: "text-sm", render: (s) => formatDateTime(s.createdAt) },
                          { key: 'c2', header: 'الأصناف', align: 'center', cellClassName: "pos-number", render: (s) => formatNumber(s.items?.length || 0) },
                          { key: 'c3', header: 'الإجمالي', align: 'center', cellClassName: "pos-number font-medium", render: (s) => formatEGP(s.total) },
                        ]}
                        rows={detail.sales}
                      />
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground py-3 text-center">لا توجد مشتريات</p>
                  )}
                </div>

                {/* Loyalty transactions */}
                <div>
                  <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                    <Coins className="w-4 h-4 text-amber-500" />
                    حركات الولاء
                  </h3>
                  {detail.loyaltyTransactions && detail.loyaltyTransactions.length > 0 ? (
                    <div className="rounded-md border">
                      <DataTable
                        maxHeight="480px"
                        className="ux-data-table"
                        columns={[
                          { key: 'c0', header: 'النوع', render: (t) => (
                              <Badge variant="outline" className={
                                                                t.type === 'EARN' ? 'bg-green-500/10 text-green-700 border-green-500/20' :
                                                                t.type === 'REDEEM' ? 'bg-orange-500/10 text-orange-700 border-orange-500/20' :
                                                                t.type === 'BONUS' ? 'bg-blue-500/10 text-blue-700 border-blue-500/20' :
                                                                t.type === 'REVERSE' ? 'bg-red-500/10 text-red-700 border-red-500/20' :
                                                                'bg-gray-500/10 text-gray-700 border-gray-500/20'
                                                              }>
                                                                {t.type === 'EARN' ? 'كسب' :
                                                                 t.type === 'REDEEM' ? 'استبدال' :
                                                                 t.type === 'BONUS' ? 'مكافأة' :
                                                                 t.type === 'REVERSE' ? 'عكس' :
                                                                 t.type === 'EXPIRE' ? 'انتهاء' : t.type}
                                                              </Badge>
                            ) },
                          { key: 'c1', header: 'النقاط', align: 'center', cellClassName: "pos-number font-medium ${t.points < 0 ? 'text-red-600' : 'text-green-600'}", render: (t) => <>{t.points > 0 ? '+' : ''}{formatNumber(t.points)}</> },
                          { key: 'c2', header: 'المرجع', cellClassName: "text-sm text-muted-foreground", render: (t) => t.note || t.refType || '—' },
                          { key: 'c3', header: 'التاريخ', cellClassName: "text-sm", render: (t) => formatDateTime(t.createdAt) },
                        ]}
                        rows={detail.loyaltyTransactions}
                      />
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground py-3 text-center">لا توجد حركات ولاء</p>
                  )}
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
            <DialogTitle>معاينة استيراد العملاء</DialogTitle>
            <DialogDescription>
              تم تحليل {importPreview?.length || 0} سجل. سيتم إنشاء عملاء جدد (سيتم تجاهل الأرقام المكررة).
            </DialogDescription>
          </DialogHeader>
          <DataTable
            maxHeight="480px"
            className="ux-data-table"
            columns={[
              { key: 'c0', header: 'الاسم', render: (r) => r.name || '—' },
              { key: 'c1', header: 'الهاتف', cellClassName: "text-xs", render: (r) => r.phone || '—' },
              { key: 'c2', header: 'البريد', cellClassName: "text-xs", render: (r) => r.email || '—' },
              { key: 'c3', header: 'الفئة', render: (r) => TIER_META[r.tier]?.label || r.tier },
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
