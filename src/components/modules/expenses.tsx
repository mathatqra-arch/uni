'use client'
import type { LucideIcon } from 'lucide-react'

import type { Expense, ExpenseCategory } from '@/lib/types'
import { useEffect, useState, useMemo, useCallback, type CSSProperties } from 'react'
import { apiFetch, formatEGP, formatNumber, formatDate } from '@/lib/api'
import { generateUUID } from '@/lib/ids'
import { useAuthStore } from '@/lib/store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'


import { DataTable } from '@/components/ui/data-table'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'

import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select'
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from '@/components/ui/tabs'
import {
  Plus, Receipt, Wallet, CreditCard, TrendingDown, Filter, Tag, RefreshCw,
  Banknote, ArrowRightLeft, PieChart,
} from 'lucide-react'
import { toast } from 'sonner'
import { notifyError } from '@/lib/notify'

const KPI_TINTS = ['kpi-tint-blue', 'kpi-tint-green', 'kpi-tint-purple', 'kpi-tint-yellow', 'kpi-tint-pink', 'kpi-tint-teal']

const PAYMENT_META: Record<string, { label: string; color: string; icon: LucideIcon }> = {
  CASH:     { label: 'نقدي',  color: 'bg-green-100 text-green-700 border-green-200',   icon: Banknote },
  CARD:     { label: 'بطاقة', color: 'bg-blue-100 text-blue-700 border-blue-200',     icon: CreditCard },
  TRANSFER: { label: 'تحويل', color: 'bg-purple-100 text-purple-700 border-purple-200', icon: ArrowRightLeft },
}

const CATEGORY_COLORS = ['#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#6b7280', '#0ea5e9', '#d946ef']

interface ExpenseForm {
  categoryId: string
  amount: string
  paymentMethod: 'CASH' | 'CARD' | 'TRANSFER'
  note: string
  date: string
}

const EMPTY_FORM: ExpenseForm = {
  categoryId: '',
  amount: '',
  paymentMethod: 'CASH',
  note: '',
  date: new Date().toISOString().slice(0, 10),
}

interface CategoryForm {
  name: string
  nameAr: string
  color: string
}

const EMPTY_CAT: CategoryForm = { name: '', nameAr: '', color: CATEGORY_COLORS[0] }

export function ExpensesModule() {
  const { user } = useAuthStore()
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [categories, setCategories] = useState<ExpenseCategory[]>([])
  const [loading, setLoading] = useState(true)
  
  const [filters, setFilters] = useState({ categoryId: 'all', paymentMethod: 'all', dateFrom: '', dateTo: '' })
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState<ExpenseForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [catDialogOpen, setCatDialogOpen] = useState(false)
  const [catForm, setCatForm] = useState<CategoryForm>(EMPTY_CAT)
  const [savingCat, setSavingCat] = useState(false)

  const loadCategories = useCallback(async () => {
    try {
      const data = await apiFetch('/expenses/categories')
      setCategories(data || [])
    } catch (e) {
      notifyError(e)
    }
  }, [])

  const loadExpenses = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filters.categoryId !== 'all') params.set('categoryId', filters.categoryId)
      if (filters.paymentMethod !== 'all') params.set('paymentMethod', filters.paymentMethod)
      if (filters.dateFrom) params.set('dateFrom', filters.dateFrom)
      if (filters.dateTo) params.set('dateTo', filters.dateTo)
      params.set('limit', '500')
      const data = await apiFetch(`/expenses?${params.toString()}`)
      setExpenses(data?.expenses || [])

    } catch (e) {
      notifyError(e)
    } finally {
      setLoading(false)
    }
  }, [filters])

  useEffect(() => { loadCategories() }, [loadCategories])
  useEffect(() => { loadExpenses() }, [loadExpenses])

  // Computed stats
  const stats = useMemo(() => {
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const monthExpenses = expenses.filter(e => new Date(e.date) >= monthStart)
    const monthTotal = monthExpenses.reduce((s, e) => s + e.amount, 0)
    const count = monthExpenses.length
    const avg = count > 0 ? monthTotal / count : 0

    // top category
    const byCat = new Map<string, { name: string; total: number }>()
    for (const e of monthExpenses) {
      const key = e.category?.id || 'none'
      const name = e.category?.nameAr || e.category?.name || 'غير مصنف'
      if (!byCat.has(key)) byCat.set(key, { name, total: 0 })
      byCat.get(key)!.total += e.amount
    }
    const topCat = Array.from(byCat.entries()).sort((a, b) => b[1].total - a[1].total)[0]
    return {
      monthTotal,
      count,
      avg,
      topCategory: topCat ? topCat[1].name : '—',
      topCategoryAmount: topCat ? topCat[1].total : 0,
      byCategory: Array.from(byCat.values()).sort((a, b) => b.total - a.total),
    }
  }, [expenses])

  const handleSave = async () => {
    if (!form.categoryId) { toast.error('اختر الفئة'); return }
    if (!form.amount || parseFloat(form.amount) <= 0) { toast.error('أدخل مبلغاً صحيحاً'); return }
    if (!user?.id) { toast.error('المستخدم غير مسجل'); return }
    setSaving(true)
    try {
      // Idempotency: stable clientTxnId survives retries so the server-side
      // cache (X-Client-Txn-Id header) and the desktop SQLite handler
      // (body.clientTxnId → expenses.client_txn_id + sync_queue.client_txn_id)
      // return / queue exactly one expense per cashier action.
      const clientTxnId = generateUUID()
      await apiFetch('/expenses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Txn-Id': clientTxnId,
        },
        body: JSON.stringify({
          categoryId: form.categoryId,
          userId: user.id,
          amount: parseFloat(form.amount),
          paymentMethod: form.paymentMethod,
          note: form.note || undefined,
          date: form.date ? new Date(form.date).toISOString() : undefined,
          clientTxnId,
        }),
      })
      toast.success('تم إضافة المصروف')
      setDialogOpen(false)
      setForm(EMPTY_FORM)
      await Promise.all([loadExpenses(), loadCategories()])
    } catch (e) {
      notifyError(e)
    } finally {
      setSaving(false)
    }
  }

  const handleSaveCat = async () => {
    if (!catForm.name) { toast.error('أدخل اسم الفئة'); return }
    setSavingCat(true)
    try {
      await apiFetch('/expenses/categories', {
        method: 'POST',
        body: JSON.stringify({
          name: catForm.name,
          nameAr: catForm.nameAr || undefined,
          color: catForm.color,
        }),
      })
      toast.success('تم إنشاء الفئة')
      setCatDialogOpen(false)
      setCatForm(EMPTY_CAT)
      await loadCategories()
    } catch (e) {
      notifyError(e)
    } finally {
      setSavingCat(false)
    }
  }

  const summaryCards = [
    { label: 'مصروفات هذا الشهر', value: formatEGP(stats.monthTotal), icon: Wallet, color: 'text-red-600', bg: 'bg-red-500/10' },
    { label: 'عدد المصروفات', value: formatNumber(stats.count), icon: Receipt, color: 'text-blue-600', bg: 'bg-blue-500/10' },
    { label: 'أكبر فئة', value: stats.topCategory, sub: formatEGP(stats.topCategoryAmount), icon: Tag, color: 'text-purple-600', bg: 'bg-purple-500/10' },
    { label: 'متوسط المصروف', value: formatEGP(stats.avg), icon: TrendingDown, color: 'text-amber-600', bg: 'bg-amber-500/10' },
  ]

  return (
    <div className="module-page p-4 md:p-6 pb-6 space-y-6 max-w-[1600px] mx-auto h-full min-h-0 flex flex-col">
      {/* Header */}
      <div className="uk-page-header flex flex-col md:flex-row md:items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Wallet className="w-6 h-6 text-red-600" />
            المصروفات
          </h1>
          <p className="text-muted-foreground text-sm">إدارة وتتبع مصروفات المتجر</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => { loadCategories(); loadExpenses() }}>
            <RefreshCw className="w-4 h-4 ml-1" />
            تحديث
          </Button>
          <Button variant="outline" size="sm" onClick={() => setCatDialogOpen(true)}>
            <Tag className="w-4 h-4 ml-1" />
            فئات المصروفات
          </Button>
          <Button size="sm" onClick={() => { setForm({ ...EMPTY_FORM, categoryId: categories[0]?.id || '' }); setDialogOpen(true) }}>
            <Plus className="w-4 h-4 ml-1" />
            إضافة مصروف
          </Button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        {summaryCards.map((c, i) => {
          const Icon = c.icon
          return (
            <div key={i} className={`unikasher-card ${KPI_TINTS[i % KPI_TINTS.length]} p-4`}>
                <div className="w-10 h-10 rounded-xl bg-white/70 dark:bg-black/20 flex items-center justify-center mb-2.5 shadow-sm">
                  <Icon className="w-5 h-5" strokeWidth={2.25} />
                </div>
                <p className="text-xs font-medium opacity-70 mb-1">{c.label}</p>
                <p className="text-lg font-bold pos-number">{c.value}</p>
                {c.sub && <p className="text-xs opacity-70 mt-1">{c.sub}</p>}
              </div>
          )
        })}
      </div>

      <Tabs defaultValue="expenses">
        <TabsList>
          <TabsTrigger value="expenses">المصروفات</TabsTrigger>
          <TabsTrigger value="breakdown">حسب الفئة</TabsTrigger>
          <TabsTrigger value="categories">الفئات</TabsTrigger>
        </TabsList>

        {/* Expenses Tab */}
        <TabsContent value="expenses" className="space-y-4">
          {/* Filters */}
          <Card>
            <CardContent className="p-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                  <Filter className="w-4 h-4" />
                  فلترة:
                </div>
                <div className="w-48">
                  <Select value={filters.categoryId} onValueChange={(v) => setFilters(f => ({ ...f, categoryId: v }))}>
                    <SelectTrigger><SelectValue placeholder="الفئة" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">كل الفئات</SelectItem>
                      {categories.map(c => (
                        <SelectItem key={c.id} value={c.id}>{c.nameAr || c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-40">
                  <Select value={filters.paymentMethod} onValueChange={(v) => setFilters(f => ({ ...f, paymentMethod: v }))}>
                    <SelectTrigger><SelectValue placeholder="طريقة الدفع" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">كل الطرق</SelectItem>
                      <SelectItem value="CASH">نقدي</SelectItem>
                      <SelectItem value="CARD">بطاقة</SelectItem>
                      <SelectItem value="TRANSFER">تحويل</SelectItem>
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
                <Button variant="ghost" size="sm" onClick={() => setFilters({ categoryId: 'all', paymentMethod: 'all', dateFrom: '', dateTo: '' })}>
                  مسح الفلاتر
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Table */}
          <DataTable
                  loading={loading}
                  emptyMessage="لا توجد مصروفات في هذه الفترة — سجّل أول مصروف من الزر أعلى الصفحة"
                  fillHeight
                  reserveHeight={340}
                  minHeight="480px"
                  minWidth="min-w-[760px]"
                  columns={[
                    { key: 'category', header: 'الفئة', render: (e) => {
                      const cat = e.category
                      return (
                        <div className="flex items-center gap-2">
                          <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: cat?.color || '#6b7280' }} />
                          <span className="text-sm font-medium">{cat?.nameAr || cat?.name || 'غير مصنف'}</span>
                        </div>
                      )
                    } },
                    { key: 'amount', header: 'المبلغ', align: 'left', render: (e) => (
                      <span className="pos-number font-medium">{formatEGP(e.amount)}</span>
                    ) },
                    { key: 'paymentMethod', header: 'طريقة الدفع', render: (e) => {
                      const pm = PAYMENT_META[e.paymentMethod] || PAYMENT_META.CASH
                      return <Badge variant="outline" className={`text-xs ${pm.color}`}>{pm.label}</Badge>
                    } },
                    { key: 'user', header: 'المستخدم', render: (e) => e.user?.name || '—' },
                    { key: 'note', header: 'الملاحظة', render: (e) => e.note || '—' },
                    { key: 'date', header: 'التاريخ', render: (e) => formatDate(e.date) },
                  ]}
                  rows={expenses}
                />
        </TabsContent>

        {/* Breakdown Tab */}
        <TabsContent value="breakdown">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <PieChart className="w-4 h-4 text-primary" />
                توزيع المصروفات حسب الفئة (هذا الشهر)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {stats.byCategory.length ? (
                <div className="space-y-3">
                  {stats.byCategory.map((c, i) => {
                    const pct = stats.monthTotal > 0 ? (c.total / stats.monthTotal) * 100 : 0
                    return (
                      <div key={i}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium">{c.name}</span>
                          <div className="text-left">
                            <span className="text-sm font-bold pos-number">{formatEGP(c.total)}</span>
                            <span className="text-xs text-muted-foreground mr-2">({pct.toFixed(1)}%)</span>
                          </div>
                        </div>
                        <Progress value={pct} className="h-2" style={{ '--progress-color': CATEGORY_COLORS[i % CATEGORY_COLORS.length] } as CSSProperties} />
                      </div>
                    )
                  })}
                  <Separator className="my-4" />
                  <div className="flex items-center justify-between">
                    <span className="font-medium">الإجمالي</span>
                    <span className="font-bold pos-number text-red-600">{formatEGP(stats.monthTotal)}</span>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">لا توجد مصروفات هذا الشهر</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Categories Tab */}
        <TabsContent value="categories">
          <Card>
            <CardHeader className="pb-2 flex-row items-center justify-between">
              <CardTitle className="text-base">فئات المصروفات</CardTitle>
              <Button size="sm" variant="outline" onClick={() => setCatDialogOpen(true)}>
                <Plus className="w-4 h-4 ml-1" />
                فئة جديدة
              </Button>
            </CardHeader>
            <CardContent>
              {categories.length ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {categories.map(c => (
                    <div key={c.id} className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-accent/30 transition-colors">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: (c.color || '#6b7280') + '22' }}>
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: c.color || '#6b7280' }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{c.nameAr || c.name}</p>
                        <p className="text-xs text-muted-foreground">{formatNumber(c.expenseCount || 0)} مصروف</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">لا توجد فئات. أنشئ أول فئة.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Add Expense Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>إضافة مصروف</DialogTitle>
            <DialogDescription>سجل مصروفاً جديداً للمتجر</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>الفئة *</Label>
              <Select value={form.categoryId} onValueChange={(v) => setForm(f => ({ ...f, categoryId: v }))}>
                <SelectTrigger><SelectValue placeholder="اختر الفئة" /></SelectTrigger>
                <SelectContent>
                  {categories.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.nameAr || c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {categories.length === 0 && (
                <p className="text-xs text-amber-600">لا توجد فئات. أنشئ فئة أولاً.</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="exp-amount">المبلغ (ج.م) *</Label>
                <Input
                  id="exp-amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={form.amount}
                  onChange={(e) => setForm(f => ({ ...f, amount: e.target.value }))}
                  placeholder="0.00"
                  className="pos-number"
                  dir="ltr"
                />
              </div>
              <div className="space-y-2">
                <Label>طريقة الدفع</Label>
                <Select value={form.paymentMethod} onValueChange={(v) => setForm(f => ({ ...f, paymentMethod: v as ExpenseForm['paymentMethod'] }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CASH">نقدي</SelectItem>
                    <SelectItem value="CARD">بطاقة</SelectItem>
                    <SelectItem value="TRANSFER">تحويل</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="exp-date">التاريخ</Label>
              <Input
                id="exp-date"
                type="date"
                value={form.date}
                onChange={(e) => setForm(f => ({ ...f, date: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="exp-note">ملاحظات</Label>
              <Textarea
                id="exp-note"
                rows={2}
                value={form.note}
                onChange={(e) => setForm(f => ({ ...f, note: e.target.value }))}
                placeholder="تفاصيل المصروف (اختياري)"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>إلغاء</Button>
            <Button onClick={handleSave} disabled={saving || categories.length === 0}>
              {saving ? 'جاري الحفظ...' : 'حفظ المصروف'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Category Dialog */}
      <Dialog open={catDialogOpen} onOpenChange={setCatDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>فئة مصروفات جديدة</DialogTitle>
            <DialogDescription>أنشئ فئة لتصنيف المصروفات</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="cat-name">اسم الفئة (إنجليزي) *</Label>
              <Input
                id="cat-name"
                value={catForm.name}
                onChange={(e) => setCatForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Rent"
                dir="ltr"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cat-name-ar">الاسم بالعربي</Label>
              <Input
                id="cat-name-ar"
                value={catForm.nameAr}
                onChange={(e) => setCatForm(f => ({ ...f, nameAr: e.target.value }))}
                placeholder="إيجار"
              />
            </div>
            <div className="space-y-2">
              <Label>اللون</Label>
              <div className="flex flex-wrap gap-2">
                {CATEGORY_COLORS.map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCatForm(f => ({ ...f, color: c }))}
                    className={`w-8 h-8 rounded-full border-2 ${catForm.color === c ? 'ring-2 ring-offset-2 ring-primary' : 'border-transparent'}`}
                    style={{ backgroundColor: c }}
                    aria-label={`Color ${c}`}
                  />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCatDialogOpen(false)}>إلغاء</Button>
            <Button onClick={handleSaveCat} disabled={savingCat}>
              {savingCat ? 'جاري الحفظ...' : 'حفظ الفئة'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
