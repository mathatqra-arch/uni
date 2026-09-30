'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  BarChart3,
  Boxes,
  Calculator,
  Command as CommandIcon,
  LayoutDashboard,
  Package,
  Receipt,
  Search,
  Settings,
  ShoppingCart,
  SunMoon,
  Tags,
  Truck,
  UserRound,
  Users,
  Wallet,
  RefreshCw,
  Building2,
} from 'lucide-react'
import { toast } from 'sonner'
import { apiFetch } from '@/lib/api'
import { useAuthStore, useUIStore } from '@/lib/store'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command'
import { Badge } from '@/components/ui/badge'

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface SearchResult {
  id: string
  label: string
  detail?: string
  type: 'product' | 'customer' | 'supplier' | 'sale'
  module: string
}

const NAV_ITEMS = [
  { id: 'dashboard', label: 'لوحة التحكم', keywords: 'الرئيسية احصائيات مبيعات أرباح', icon: LayoutDashboard, roles: ['OWNER', 'ADMIN'] },
  { id: 'pos', label: 'نقطة البيع', keywords: 'بيع فاتورة كاشير كاش صندوق', icon: ShoppingCart, roles: ['OWNER', 'ADMIN', 'MANAGER', 'CASHIER'] },
  { id: 'sales', label: 'المبيعات', keywords: 'الفواتير المرتجعات مبيعات', icon: Receipt, roles: ['OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'ACCOUNTANT'] },
  { id: 'cash', label: 'الخزنة', keywords: 'درج نقدية سحب إيداع', icon: Wallet, roles: ['OWNER', 'ADMIN', 'MANAGER', 'CASHIER'] },
  { id: 'products', label: 'المنتجات', keywords: 'صنف منتج سعر باركود sku', icon: Package, roles: ['OWNER', 'ADMIN', 'MANAGER', 'WAREHOUSE'] },
  { id: 'categories', label: 'الفئات', keywords: 'تصنيفات تصنيف', icon: Tags, roles: ['OWNER', 'ADMIN', 'MANAGER', 'WAREHOUSE'] },
  { id: 'inventory', label: 'المخزون', keywords: 'رصيد مخزون حركة مخزون نواقص', icon: Boxes, roles: ['OWNER', 'ADMIN', 'MANAGER', 'WAREHOUSE'] },
  { id: 'purchases', label: 'المشتريات', keywords: 'شراء مورد فواتير مشتريات', icon: Truck, roles: ['OWNER', 'ADMIN', 'MANAGER', 'WAREHOUSE'] },
  { id: 'suppliers', label: 'الموردون', keywords: 'موردين شركات مورد', icon: Building2, roles: ['OWNER', 'ADMIN', 'MANAGER', 'WAREHOUSE'] },
  { id: 'customers', label: 'العملاء', keywords: 'عميل زبون هاتف هاتف', icon: Users, roles: ['OWNER', 'ADMIN', 'MANAGER', 'CASHIER'] },
  { id: 'loyalty', label: 'نقاط الولاء', keywords: 'ولاء نقاط مكافآت', icon: UserRound, roles: ['OWNER', 'ADMIN', 'MANAGER'] },
  { id: 'expenses', label: 'المصروفات', keywords: 'مصروف نفقات', icon: Receipt, roles: ['OWNER', 'ADMIN', 'MANAGER', 'ACCOUNTANT'] },
  { id: 'reports', label: 'التقارير', keywords: 'تقرير تقارير تحليل', icon: BarChart3, roles: ['OWNER', 'ADMIN', 'MANAGER', 'ACCOUNTANT'] },
  { id: 'general-accounts', label: 'الحسابات العامة', keywords: 'محاسبة قيد قيود حسابات', icon: Calculator, roles: ['OWNER', 'ADMIN', 'ACCOUNTANT'] },
  { id: 'employees', label: 'الموظفون', keywords: 'موظف مستخدم صلاحيات', icon: Users, roles: ['OWNER', 'ADMIN'] },
  { id: 'settings', label: 'الإعدادات', keywords: 'اعدادات إعدادات النظام', icon: Settings, roles: ['OWNER', 'ADMIN'] },
  { id: 'audit', label: 'سجل العمليات', keywords: 'تدقيق سجل نشاط عمليات audit', icon: Receipt, roles: ['OWNER', 'ADMIN'] },
] as const

function resultTitle(result: SearchResult) {
  if (result.type === 'sale') return `فاتورة ${result.label}`
  return result.label
}

export function GlobalCommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const user = useAuthStore((state) => state.user)
  const setModule = useUIStore((state) => state.setModule)
  const theme = useUIStore((state) => state.theme)
  const toggleTheme = useUIStore((state) => state.toggleTheme)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)

  const availableNav = useMemo(
    () => NAV_ITEMS.filter((item) => !user || item.roles.includes(user.role as never)),
    [user],
  )

  useEffect(() => {
    if (!open) {
      setQuery('')
      setResults([])
      setSearching(false)
      return
    }

    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setResults([])
      setSearching(false)
      return
    }

    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setSearching(true)
      const q = encodeURIComponent(trimmed)
      const searches: Array<Promise<SearchResult[]>> = [
        apiFetch(`/products?search=${q}&limit=6`)
          .then((data) => (Array.isArray(data) ? data : data?.items || []).map((item) => ({
            id: String(item.id),
            label: item.nameAr || item.name || item.sku || 'منتج',
            detail: [item.sku, item.barcode].filter(Boolean).join(' • '),
            type: 'product' as const,
            module: 'products',
          })))
          .catch(() => []),
        apiFetch(`/customers?search=${q}&limit=6`)
          .then((data) => (Array.isArray(data) ? data : data?.items || []).map((item) => ({
            id: String(item.id),
            label: item.name || 'عميل',
            detail: item.phone || undefined,
            type: 'customer' as const,
            module: 'customers',
          })))
          .catch(() => []),
        apiFetch(`/suppliers?search=${q}&limit=6`)
          .then((data) => (Array.isArray(data) ? data : data?.items || []).map((item) => ({
            id: String(item.id),
            label: item.name || 'مورد',
            detail: item.phone || undefined,
            type: 'supplier' as const,
            module: 'suppliers',
          })))
          .catch(() => []),
      ]

      const grouped = await Promise.allSettled(searches)
      if (controller.signal.aborted) return
      const merged = grouped.flatMap((entry) => entry.status === 'fulfilled' ? entry.value : [])
      const seen = new Set<string>()
      setResults(merged.filter((item) => {
        const key = `${item.type}:${item.id}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      }))
      setSearching(false)
    }, 280)

    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [open, query])

  const navigate = (module: string) => {
    setModule(module)
    onOpenChange(false)
  }

  const runRefresh = () => {
    window.dispatchEvent(new CustomEvent('unikasher:data-changed', { detail: { source: 'command-palette', force: true } }))
    toast.success('تم طلب تحديث البيانات')
    onOpenChange(false)
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="مركز الأوامر والبحث" description="ابحث عن قسم أو بيانات أو أمر سريع داخل Uni Kasher">
      <div className="border-b bg-background/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <CommandIcon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold">مركز الأوامر والبحث</p>
            <p className="text-[11px] text-muted-foreground">تنقل أسرع • بحث موحد • أوامر فورية</p>
          </div>
          <Badge variant="outline" className="mr-auto hidden sm:inline-flex text-[10px]">Ctrl K</Badge>
        </div>
      </div>
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="اكتب اسم قسم، منتج، عميل، مورد..."
        aria-label="البحث والتنقل في Uni Kasher"
      />
      <CommandList className="max-h-[min(70vh,540px)]">
        {searching && (
          <div className="flex items-center gap-2 px-4 py-3 text-xs text-muted-foreground" role="status" aria-live="polite">
            <Search className="h-3.5 w-3.5 animate-pulse" />
            بنبحث في البيانات المحلية...
          </div>
        )}
        <CommandEmpty>
          {query.trim().length >= 2 ? 'مش لاقي نتيجة مطابقة.' : 'اكتب حرفين على الأقل للبحث في البيانات.'}
        </CommandEmpty>

        {results.length > 0 && (
          <CommandGroup heading="نتائج البيانات المحلية">
            {results.map((result) => (
              <CommandItem key={`${result.type}-${result.id}`} value={`${resultTitle(result)} ${result.detail || ''}`} onSelect={() => navigate(result.module)} className="group min-h-12">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground group-data-[selected=true]:bg-primary/10 group-data-[selected=true]:text-primary">
                    {result.type === 'product' ? <Package className="h-4 w-4" /> : result.type === 'customer' ? <Users className="h-4 w-4" /> : <Building2 className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{resultTitle(result)}</p>
                    {result.detail && <p className="truncate text-[11px] text-muted-foreground">{result.detail}</p>}
                  </div>
                </div>
                <Badge variant="secondary" className="text-[10px] shrink-0">{result.type === 'product' ? 'منتج' : result.type === 'customer' ? 'عميل' : 'مورد'}</Badge>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        <CommandSeparator />
        <CommandGroup heading="التنقل السريع">
          {availableNav.map((item) => {
            const Icon = item.icon
            return (
              <CommandItem key={item.id} value={`${item.label} ${item.keywords}`} onSelect={() => navigate(item.id)} className="min-h-11">
                <Icon className="h-4 w-4" />
                <span>{item.label}</span>
                {item.id === 'pos' && <CommandShortcut>F2</CommandShortcut>}
              </CommandItem>
            )
          })}
        </CommandGroup>

        <CommandSeparator />
        <CommandGroup heading="أوامر سريعة">
          <CommandItem value="تحديث البيانات refresh" onSelect={runRefresh}>
            <RefreshCw className="h-4 w-4" />
            <span>تحديث البيانات الحالية</span>
            <CommandShortcut>R</CommandShortcut>
          </CommandItem>
          <CommandItem value="الوضع الداكن الوضع الليلي theme" onSelect={() => { toggleTheme(); onOpenChange(false) }}>
            <SunMoon className="h-4 w-4" />
            <span>{theme === 'light' ? 'تفعيل الوضع الداكن' : 'تفعيل الوضع الفاتح'}</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
