'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { apiFetch, formatEGP, formatNumber, formatDateTime } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import { DataTable } from '@/components/ui/data-table'

import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Star, Coins, Users, Plus, RefreshCw, Sparkles, TrendingDown,
  History, Trash2, Award,
} from 'lucide-react'
import { toast } from 'sonner'
import type { LoyaltyAccount, LoyaltyTransaction, Product } from '@/lib/types'
import { notifyError } from '@/lib/notify'
interface LoyaltyAccountRow extends LoyaltyAccount {
  className?: never
  customerName?: string
  customer?: { id?: string; name?: string | null; phone?: string | null }
}

const KPI_TINTS = ['kpi-tint-blue', 'kpi-tint-green', 'kpi-tint-purple', 'kpi-tint-yellow', 'kpi-tint-pink', 'kpi-tint-teal']

const TXN_TYPE_META: Record<string, { label: string; className: string }> = {
  EARN: { label: 'كسب', className: 'bg-green-500/10 text-green-700 border-green-500/20' },
  REDEEM: { label: 'استبدال', className: 'bg-orange-500/10 text-orange-700 border-orange-500/20' },
  BONUS: { label: 'مكافأة', className: 'bg-blue-500/10 text-blue-700 border-blue-500/20' },
  REVERSE: { label: 'عكس', className: 'bg-red-500/10 text-red-700 border-red-500/20' },
  EXPIRE: { label: 'انتهاء', className: 'bg-gray-500/10 text-gray-700 border-gray-500/20' },
  ADJUSTMENT: { label: 'تسوية', className: 'bg-amber-500/10 text-amber-700 border-amber-500/20' },
}



export function LoyaltyModule() {
  return (
    <div className="module-page p-4 md:p-6 space-y-6 max-w-[1600px] mx-auto">
      <div>
        <h1 className="text-2xl font-bold flex items-center justify-start gap-2">
          <Star className="w-6 h-6 text-amber-500" />
          نقاط الولاء
        </h1>
        <p className="text-muted-foreground text-sm">إدارة حسابات الولاء والحملات والمعاملات</p>
      </div>

      <Tabs defaultValue="accounts" className="w-full overflow-x-hidden flex-1 min-h-0 flex flex-col">
        <TabsList className="w-full md:w-auto flex-wrap justify-start">
          <TabsTrigger value="accounts"><Users className="w-4 h-4" /> الحسابات</TabsTrigger>
          <TabsTrigger value="pointsProducts"><Award className="w-4 h-4" /> منتجات بالنقاط</TabsTrigger>
          <TabsTrigger value="transactions"><History className="w-4 h-4" /> المعاملات</TabsTrigger>
        </TabsList>

        <TabsContent value="accounts" className="mt-4 w-full flex-1 min-h-0 flex flex-col">
          <AccountsTab />
        </TabsContent>
        <TabsContent value="pointsProducts" className="mt-4 flex-1 min-h-0 flex flex-col">
          <PointsProductsTab />
        </TabsContent>
        <TabsContent value="transactions" className="mt-4 flex-1 min-h-0 flex flex-col">
          <TransactionsTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ============ TAB 1: ACCOUNTS ============
function AccountsTab() {
  const [accounts, setAccounts] = useState<LoyaltyAccountRow[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('limit', '500')
      const data = await apiFetch(`/loyalty?${params.toString()}`)
      setAccounts(data || [])
    } catch (e) {
      notifyError(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const stats = useMemo(() => {
    const totalDistributed = accounts.reduce((s, a) => s + (a.totalEarned || 0), 0)
    const totalRedeemed = accounts.reduce((s, a) => s + (a.totalRedeemed || 0), 0)
    const totalAvailable = accounts.reduce((s, a) => s + (a.points || 0), 0)
    return { totalDistributed, totalRedeemed, totalAvailable, count: accounts.length }
  }, [accounts])

  const summaryCards = [
    { label: 'إجمالي النقاط الموزعة', value: formatNumber(stats.totalDistributed), icon: Coins, color: 'text-blue-600', bg: 'bg-blue-500/10' },
    { label: 'النقاط المستبدلة', value: formatNumber(stats.totalRedeemed), icon: TrendingDown, color: 'text-orange-600', bg: 'bg-orange-500/10' },
    { label: 'النقاط المتاحة', value: formatNumber(stats.totalAvailable), icon: Sparkles, color: 'text-green-600', bg: 'bg-green-500/10' },
    { label: 'عدد العملاء', value: formatNumber(stats.count), icon: Users, color: 'text-purple-600', bg: 'bg-purple-500/10' },
  ]

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-4" dir="rtl">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={load}>
              <RefreshCw className="w-4 h-4" />
              تحديث
            </Button>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-14" />)}
        </div>
      ) : accounts.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Star className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>لا توجد حسابات ولاء</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Desktop table */}
          <Card className="hidden md:flex md:flex-col flex-1 min-h-0">
            <CardContent className="p-0 flex-1 min-h-0 flex flex-col">
              <DataTable
                  maxHeight="480px"
                  minWidth="min-w-[640px]"
                  columns={[
                    { key: 'customer', header: 'العميل', render: (a) => (
                      <span className="font-medium">{a.customer?.name || '—'}</span>
                    ) },
                    { key: 'phone', header: 'الهاتف', render: (a) => (
                      <span className="text-muted-foreground" dir="ltr">{a.customer?.phone || '—'}</span>
                    ) },
                    { key: 'points', header: 'النقاط الحالية', render: (a) => (
                      <Badge variant="secondary" className="pos-number">{formatNumber(a.points)}</Badge>
                    ) },
                    { key: 'earned', header: 'المكتسبة', align: 'left', render: (a) => (
                      <span className="pos-number text-green-600">{formatNumber(a.totalEarned)}</span>
                    ) },
                    { key: 'redeemed', header: 'المستبدلة', align: 'left', render: (a) => (
                      <span className="pos-number text-orange-600">{formatNumber(a.totalRedeemed)}</span>
                    ) },
                  ]}
                  rows={accounts}
                />
            </CardContent>
          </Card>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {accounts.map((a) => (
              <Card key={a.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="font-medium">{a.customer?.name || '—'}</p>
                      <p className="text-xs text-muted-foreground" dir="ltr">{a.customer?.phone || '—'}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center mb-3">
                    <div>
                      <p className="text-xs text-muted-foreground">الحالية</p>
                      <p className="font-bold text-sm pos-number">{formatNumber(a.points)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">المكتسبة</p>
                      <p className="font-bold text-sm pos-number text-green-600">{formatNumber(a.totalEarned)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">المستبدلة</p>
                      <p className="font-bold text-sm pos-number text-orange-600">{formatNumber(a.totalRedeemed)}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

    </div>
  )
}

// ============ TAB: PRODUCTS REDEEMABLE WITH POINTS ============
// "منتجات بالنقاط" — products a customer can get by spending loyalty
// points instead of cash (e.g. redeem 500 points for a free coffee).
// Stored as a single JSON setting (loyalty.pointsProducts) rather than a
// new DB table/column — the desktop `settings` key-value store already
// provides the right persistence boundary, so no separate loyalty table is needed. Consumed by pos.tsx to show a
// "استبدال بالنقاط" action on eligible product cards.
function PointsProductsTab() {
  const [items, setItems] = useState<{ productId: string; pointsCost: number }[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState({ productId: '', pointsCost: '' })

  const load = async () => {
    setLoading(true)
    try {
      const [settingsData, prods] = await Promise.all([
        apiFetch('/settings'),
        apiFetch('/products?limit=500'),
      ])
      const raw = settingsData?.grouped?.loyalty?.['loyalty.pointsProducts']
      let parsed: { productId: string; pointsCost: number }[] = []
      if (raw) {
        try { parsed = JSON.parse(raw) } catch { parsed = [] }
      }
      setItems(Array.isArray(parsed) ? parsed : [])
      setProducts(prods || [])
    } catch (e) {
      notifyError(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const persist = async (next: { productId: string; pointsCost: number }[]) => {
    setSaving(true)
    try {
      await apiFetch('/settings', {
        method: 'PUT',
        body: JSON.stringify({
          settings: [{ key: 'loyalty.pointsProducts', value: JSON.stringify(next), category: 'loyalty' }],
        }),
      })
      setItems(next)
    } catch (e) {
      notifyError(e)
    } finally {
      setSaving(false)
    }
  }

  const handleAdd = async () => {
    const points = parseInt(form.pointsCost)
    if (!form.productId) { toast.error('اختر منتج'); return }
    if (!points || points <= 0) { toast.error('أدخل عدد نقاط صحيح'); return }
    if (items.some((i) => i.productId === form.productId)) {
      toast.error('هذا المنتج مضاف بالفعل لمنتجات النقاط')
      return
    }
    await persist([...items, { productId: form.productId, pointsCost: points }])
    toast.success('تمت إضافة المنتج لمنتجات النقاط')
    setDialogOpen(false)
    setForm({ productId: '', pointsCost: '' })
  }

  const handleRemove = async (productId: string) => {
    await persist(items.filter((i) => i.productId !== productId))
    toast.success('تم حذف المنتج من منتجات النقاط')
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">حدد منتجات يقدر العميل يستبدلها بنقاطه بدل الفلوس — تظهر تلقائيًا في نقطة البيع.</p>
        <Button size="sm" onClick={() => setDialogOpen(true)} disabled={saving}>
          <Plus className="w-4 h-4" />
          إضافة منتج
        </Button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Award className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>لا توجد منتجات بالنقاط بعد</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((i) => {
            const product = products.find((p) => p.id === i.productId)
            return (
              <Card key={i.productId}>
                <CardContent className="p-4 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0">
                      <Award className="w-5 h-5 text-amber-500" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-sm truncate">{product?.nameAr || product?.name || 'منتج محذوف'}</p>
                      <p className="text-xs text-muted-foreground">{formatNumber(i.pointsCost)} نقطة</p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200 shrink-0"
                    disabled={saving}
                    onClick={() => handleRemove(i.productId)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Award className="w-5 h-5 text-amber-500" />
              منتج جديد بالنقاط
            </DialogTitle>
            <DialogDescription>اختر منتج وحدد عدد النقاط المطلوبة لاستبداله مجانًا</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="ppProduct">المنتج *</Label>
              <Select value={form.productId} onValueChange={(v) => setForm({ ...form, productId: v })}>
                <SelectTrigger id="ppProduct"><SelectValue placeholder="اختر منتج" /></SelectTrigger>
                <SelectContent>
                  {products.filter((p) => !items.some((i) => i.productId === p.id)).map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.nameAr || p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ppPoints">النقاط المطلوبة *</Label>
              <Input id="ppPoints" type="number" min={1} value={form.pointsCost} onChange={(e) => setForm({ ...form, pointsCost: e.target.value })} placeholder="مثال: 500" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>إلغاء</Button>
            <Button onClick={handleAdd} disabled={saving}>
              {saving ? 'جاري الحفظ...' : 'إضافة'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ============ TAB 3: TRANSACTIONS ============
function TransactionsTab() {
  const [transactions, setTransactions] = useState<(LoyaltyTransaction & { customer?: { name?: string } | null })[]>([])
  const [loading, setLoading] = useState(true)
  const [typeFilter, setTypeFilter] = useState('all')
  // FIX: was a hardcoded 0.05 EGP/point constant unrelated to the real,
  // configurable earn rate (loyalty.pointsPerEgp). Fetched from the new
  // /loyalty/rate endpoint instead.
  const [pointsPerEgp, setPointsPerEgp] = useState(0.1)

  // FIX: this tab used to have no dedicated endpoint, so it faked the
  // list by aggregating each account's totalEarned/totalRedeemed into a
  // single synthetic EARN + REDEEM row per customer (wrong dates from
  // account.updatedAt, no individual transactions, and the BONUS/REVERSE
  // filter options below never matched anything real). It now calls the
  // real per-transaction endpoint, filtered server-side by type.
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('limit', '500')
      if (typeFilter !== 'all') params.set('type', typeFilter)
      const data = await apiFetch(`/loyalty/transactions?${params.toString()}`)
      setTransactions(data || [])
    } catch (e) {
      notifyError(e)
    } finally {
      setLoading(false)
    }
  }, [typeFilter])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    apiFetch('/loyalty/rate').then((r) => {
      if (r?.pointsPerEgp > 0) setPointsPerEgp(r.pointsPerEgp)
    }).catch(() => { /* non-blocking UI refresh */ })
  }, [])

  const filtered = useMemo(() => transactions.map((t) => ({
    ...t,
    customerName: t.customer?.name,
  })), [transactions])

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-4">
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="md:w-48">
                <SelectValue placeholder="كل الأنواع" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الأنواع</SelectItem>
                <SelectItem value="EARN">كسب</SelectItem>
                <SelectItem value="REDEEM">استبدال</SelectItem>
                <SelectItem value="BONUS">مكافأة</SelectItem>
                <SelectItem value="REVERSE">عكس</SelectItem>
                <SelectItem value="EXPIRE">انتهاء</SelectItem>
                <SelectItem value="ADJUSTMENT">تسوية</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={load}>
              <RefreshCw className="w-4 h-4" />
              تحديث
            </Button>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-14" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <History className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>لا توجد معاملات</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Desktop table */}
          <Card className="hidden md:flex md:flex-col flex-1 min-h-0">
            <CardContent className="p-0 flex-1 min-h-0 flex flex-col">
              <DataTable
                maxHeight="480px"
                columns={[
                  { key: 'c0', header: 'العميل', align: 'center', width: "w-[180px]", cellClassName: "font-medium max-w-[180px] pl-2", render: (t) => t.customerName || '—' },
                  { key: 'c1', header: 'النوع', align: 'center', render: (t) => {
                      const meta = TXN_TYPE_META[t.type] || TXN_TYPE_META.EARN
                      return (
                      <Badge variant="outline" className={meta.className}>{meta.label}</Badge>
                      )
                    } },
                  { key: 'c2', header: 'النقاط', align: 'center', cellClassName: "pos-number font-medium ${t.points < 0 ? 'text-red-600' : 'text-green-600'}", render: (t) => <>{t.points > 0 ? '+' : ''}{formatNumber(t.points)}</> },
                  { key: 'c3', header: 'القيمة', align: 'left', cellClassName: "pos-number text-muted-foreground", render: (t) => formatEGP(pointsPerEgp > 0 ? Math.abs(t.points) / pointsPerEgp : 0) },
                  { key: 'c4', header: 'المرجع', align: 'left', width: "w-[180px]", cellClassName: "text-sm text-muted-foreground max-w-[180px]", render: (t) => t.note || t.refType || '—' },
                  { key: 'c5', header: 'التاريخ', align: 'left', cellClassName: "text-sm", render: (t) => formatDateTime(t.createdAt) },
                ]}
                rows={filtered}
              />
            </CardContent>
          </Card>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {filtered.map((t) => {
              const meta = TXN_TYPE_META[t.type] || TXN_TYPE_META.EARN
              return (
                <Card key={t.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="font-medium">{t.customerName || '—'}</p>
                        <p className="text-xs text-muted-foreground">{formatDateTime(t.createdAt)}</p>
                      </div>
                      <Badge variant="outline" className={meta.className}>{meta.label}</Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">{t.note || t.refType || '—'}</span>
                      <span className={`font-bold pos-number ${t.points < 0 ? 'text-red-600' : 'text-green-600'}`}>
                        {t.points > 0 ? '+' : ''}{formatNumber(t.points)} نقطة
                      </span>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
