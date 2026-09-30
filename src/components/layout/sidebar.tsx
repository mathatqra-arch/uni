'use client'
import type { LucideIcon } from 'lucide-react'

import { useAuthStore, useUIStore, useCashSessionStore } from '@/lib/store'
import { getRoleLabel } from '@/lib/roles'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Sheet, SheetContent
} from '@/components/ui/sheet'
import {
  LayoutDashboard, ShoppingCart, Package, Boxes, Receipt, Users, Award,
  Truck, Building2, Wallet, Receipt as ReceiptIcon, BarChart3, Settings,
  ScrollText, LogOut, Menu, Moon, Sun, Tags,
  PanelLeftClose, PanelLeftOpen, ChevronLeft, Calculator, Database
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { toast } from 'sonner'

// ============================================================
// Uni Kasher System — Grouped Module Navigation
// ============================================================
// Modules organized into logical groups matching business workflows:
//   • العمليات (Operations): POS, sales, cash
//   • المخزون (Inventory): products, categories, inventory, purchases, suppliers
//   • المحاسبة (Accounting): expenses, reports, audit
//   • العملاء (CRM): customers, loyalty
//   • النظام (System): employees, settings, desktop download, offline test
// ============================================================

interface ModuleDef {
  id: string
  label: string
  icon: LucideIcon
  roles: string[]
  badge?: string
}

interface ModuleGroup {
  label: string
  icon: LucideIcon
  modules: ModuleDef[]
}

// FIX (employee permissions): every module below used to list only
// 'ADMIN' (and friends) and never included 'OWNER' — but the real shop
// The owner account created during setup receives the OWNER role.
// handleCompleteSetup), not ADMIN. Since visibleGroups filters strictly by
// `m.roles.includes(user.role)`, the owner account could not see ANY module
// whose list didn't happen to include 'OWNER' — most critically settings,
// employees and the audit log, which is why those looked "broken" (they
// were simply invisible/unreachable to the only account meant to use them).
// OWNER is added everywhere as the top of the permission hierarchy.
//
// Also: 'dashboard' previously included CASHIER, so cashiers saw the
// owner-facing overview (today's totals, profit, growth). Per the explicit
// requirement, the dashboard is now OWNER/ADMIN only.
const MODULE_GROUPS: ModuleGroup[] = [
  {
    label: 'العمليات',
    icon: ShoppingCart,
    modules: [
      { id: 'dashboard', label: 'لوحة التحكم', icon: LayoutDashboard, roles: ['OWNER','ADMIN'] },
      { id: 'pos', label: 'نقطة البيع', icon: ShoppingCart, roles: ['OWNER','ADMIN','MANAGER','CASHIER'] },
      { id: 'sales', label: 'المبيعات', icon: Receipt, roles: ['OWNER','ADMIN','MANAGER','CASHIER','ACCOUNTANT'] },
      { id: 'cash', label: 'الخزنة', icon: Wallet, roles: ['OWNER','ADMIN','MANAGER','CASHIER'] },
    ],
  },
  {
    label: 'المخزون',
    icon: Boxes,
    modules: [
      { id: 'products', label: 'المنتجات', icon: Package, roles: ['OWNER','ADMIN','MANAGER','WAREHOUSE'] },
      { id: 'categories', label: 'الفئات', icon: Tags, roles: ['OWNER','ADMIN','MANAGER','WAREHOUSE'] },
      { id: 'inventory', label: 'المخزون', icon: Boxes, roles: ['OWNER','ADMIN','MANAGER','WAREHOUSE'], badge: 'low' },
      { id: 'purchases', label: 'المشتريات', icon: Truck, roles: ['OWNER','ADMIN','MANAGER','WAREHOUSE'] },
      { id: 'suppliers', label: 'الموردون', icon: Building2, roles: ['OWNER','ADMIN','MANAGER','WAREHOUSE'] },
    ],
  },
  {
    label: 'العملاء',
    icon: Users,
    modules: [
      { id: 'customers', label: 'العملاء', icon: Users, roles: ['OWNER','ADMIN','MANAGER','CASHIER'] },
      { id: 'loyalty', label: 'نقاط الولاء', icon: Award, roles: ['OWNER','ADMIN','MANAGER'] },
    ],
  },
  {
    label: 'المحاسبة',
    icon: ReceiptIcon,
    modules: [
      { id: 'expenses', label: 'المصروفات', icon: ReceiptIcon, roles: ['OWNER','ADMIN','MANAGER','ACCOUNTANT'] },
      { id: 'reports', label: 'التقارير', icon: BarChart3, roles: ['OWNER','ADMIN','MANAGER','ACCOUNTANT'] },
      { id: 'general-accounts', label: 'الحسابات العامة', icon: Calculator, roles: ['OWNER','ADMIN','ACCOUNTANT'] },
      { id: 'audit', label: 'سجل العمليات', icon: ScrollText, roles: ['OWNER','ADMIN'] },
    ],
  },
  {
    label: 'النظام',
    icon: Settings,
    modules: [
      { id: 'employees', label: 'الموظفون', icon: Users, roles: ['OWNER','ADMIN'] },
      { id: 'settings', label: 'الإعدادات', icon: Settings, roles: ['OWNER','ADMIN'] },
    ],
  },
]

// ============================================================
// SidebarContent — shared inner content (used by both desktop
// and mobile Sheet variants). Renders the expanded sidebar with
// all navigation, connection status, and user footer.
// ============================================================
function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { user, logout } = useAuthStore()
  const { activeModule, setModule, setSidebar, theme, toggleTheme } = useUIStore()
  const [mounted, setMounted] = useState(false)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [loggingOut, setLoggingOut] = useState(false)
  const [lowStockAlertCount, setLowStockAlertCount] = useState(0)
  const setGlobalRegisterOpen = useCashSessionStore((s) => s.setRegisterOpen)

  useEffect(() => setMounted(true), [])

  // FIX: the "المخزون" nav item had `badge: 'low'` — a static truthy
  // string used only to decide *whether* to render the red "!" badge, so
  // it rendered unconditionally on every load regardless of real stock
  // levels (looked like a permanent, unexplained alert icon next to
  // Inventory). Pull the real low/out-of-stock count from the inventory
  // summary and only show the badge — with the actual count — when there's
  // something to flag. Refreshes on login, when switching into Inventory
  // (after adjustments), and on an interval so it doesn't go stale.
  useEffect(() => {
    const canSeeInventory = ['OWNER', 'ADMIN', 'MANAGER', 'WAREHOUSE'].includes(user?.role || '')
    if (!user?.id || !canSeeInventory) { setLowStockAlertCount(0); return }
    let cancelled = false
    const loadLowStockCount = () => {
      apiFetch('/inventory?limit=500')
        .then((r) => {
          if (cancelled) return
          const summary = r?.summary
          setLowStockAlertCount((summary?.lowStockCount || 0) + (summary?.outOfStockCount || 0))
        })
        .catch(() => { /* non-blocking UI refresh */ })
    }
    loadLowStockCount()
    const interval = setInterval(loadLowStockCount, 60000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [user?.id, activeModule])

  // Keep the global "is the register open" flag fresh as soon as we're
  // logged in — this is what powers the tab-close/refresh warning
  // (see <BeforeUnloadGuard />), so it needs to be known even if the
  // user never opens the "الخزنة" or "نقطة البيع" screens this session.
  useEffect(() => {
    if (!user?.id) return
    apiFetch('/cash')
      .then((session) => setGlobalRegisterOpen(!!session && session.status === 'OPEN'))
      .catch(() => { /* non-blocking UI refresh */ })
  }, [user?.id, setGlobalRegisterOpen])

  // Block logout while the cash drawer is open — closing the register
  // first (counting the cash, recording the closing balance) is what
  // makes end-of-shift reconciliation possible. Logging out with the
  // drawer still open would leave an OPEN cash_sessions row with no
  // one accountable for it.
  const handleLogout = async () => {
    setLoggingOut(true)
    try {
      const session = await apiFetch('/cash')
      const isOpen = !!session && session.status === 'OPEN'
      setGlobalRegisterOpen(isOpen)
      if (isOpen) {
        toast.error('لا يمكن تسجيل الخروج والخزنة مفتوحة', {
          description: 'أغلق الخزنة أولاً من شاشة "الخزنة" (عدّ النقدية وسجّل رصيد الإغلاق) قبل تسجيل الخروج.',
          duration: 7000,
        })
        return
      }
      logout()
    } catch {
      // If we couldn't determine the cash-session state, don't lock the
      // user out of the app entirely — allow logout but warn them.
      toast.warning('تعذر التحقق من حالة الخزنة، تم تسجيل الخروج على أي حال')
      logout()
    } finally {
      setLoggingOut(false)
    }
  }

  const toggleGroup = (label: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  }

  // Filter modules by user role
  const visibleGroups = MODULE_GROUPS.map(g => ({
    ...g,
    modules: g.modules.filter(m => !user || m.roles.includes(user.role)),
  })).filter(g => g.modules.length > 0)

  const handleModuleClick = (id: string) => {
    setModule(id)
    onNavigate?.()  // Close mobile sheet on navigation
  }

  return (
    <div className="w-full bg-sidebar sidebar-brand-surface flex flex-col h-full">
      {/* Header — Uni Kasher logo */}
      <div className="p-4 pb-3">
        <div className="flex items-center gap-3">
          <img src="/icon-512.png" alt="" className="w-9 h-9 shrink-0 object-contain" draggable={false} />
          <div className="flex-1 min-w-0">
            <h2 className="font-bold text-base text-white tracking-tight">Uni Kasher</h2>
            <p className="text-[11px] text-sidebar-foreground/60 font-medium">إدارة أعمالك بسهولة</p>
          </div>
          {/* Desktop-only collapse button — hidden inside Sheet */}
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0 text-sidebar-foreground/70 hover:bg-white/[0.06] hover:text-white hidden md:inline-flex"
            onClick={() => setSidebar(false)}
            title="إغلاق القائمة"
            aria-label="إغلاق القائمة"
          >
            <PanelLeftClose className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Navigation — grouped modules. min-h-0 is required here: without it,
          a flex child defaults to min-height:auto and grows to fit ALL nav
          items instead of shrinking to the space actually available, which
          pushes the connection-status/user footer (and the bottom of the
          list itself) below the viewport instead of scrolling. */}
      <ScrollArea className="flex-1 min-h-0 px-2">
        <div className="py-2 space-y-4">
          {visibleGroups.map(group => {
            const GroupIcon = group.icon
            const isCollapsed = collapsedGroups.has(group.label)
            return (
              <div key={group.label}>
                <button
                  onClick={() => toggleGroup(group.label)}
                  className="w-full flex items-center gap-2 px-2.5 py-2 text-[11px] font-extrabold tracking-wide text-sidebar-foreground/55 hover:text-sidebar-foreground/90 transition-colors duration-150"
                  aria-label={`${isCollapsed ? 'فتح' : 'طي'} مجموعة ${group.label}`}
                  aria-expanded={!isCollapsed}
                >
                  <GroupIcon className="w-3.5 h-3.5" strokeWidth={2} />
                  <span className="flex-1 text-right">{group.label}</span>
                  <ChevronLeft className={cn("w-3.5 h-3.5 transition-transform", isCollapsed && "-rotate-90")} />
                </button>
                {!isCollapsed && (
                  <div className="space-y-0.5 mt-1">
                    {group.modules.map(m => {
                      const Icon = m.icon
                      const active = activeModule === m.id
                      return (
                        <button
                          key={m.id}
                          onClick={() => handleModuleClick(m.id)}
                          aria-label={m.label}
                          aria-current={active ? 'page' : undefined}
                          className={cn(
                            "w-full flex items-center gap-3 px-3 py-2.5 min-h-11 rounded-xl text-sm font-medium transition-[background-color,color,transform,box-shadow] duration-150 uk-focus-ring",
                            active
                              ? "bg-sidebar-accent text-white shadow-[0_10px_24px_-18px_rgba(0,0,0,0.8)] sidebar-active-indicator hover:bg-sidebar-accent/90"
                              : "text-sidebar-foreground/90 hover:bg-white/[0.06] hover:text-white hover:translate-x-[-1px]"
                          )}
                        >
                          <Icon className="w-4.5 h-4.5 shrink-0" strokeWidth={active ? 2.5 : 2} />
                          <span className="flex-1 text-right">{m.label}</span>
                          {m.badge === 'low' && lowStockAlertCount > 0 && (
                            <Badge className="h-5 px-1.5 text-[10px] bg-kpi-red/20 text-kpi-red border-0">
                              {lowStockAlertCount > 99 ? '99+' : lowStockAlertCount}
                            </Badge>
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </ScrollArea>

      {/* Runtime status: Uni Kasher is intentionally local/offline. */}
      <div className="px-3 py-2 border-t border-sidebar-border">
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-sidebar-accent/50 text-xs" title="كل البيانات محفوظة على هذا الجهاز — يعمل بدون إنترنت">
          <Database className="w-3.5 h-3.5 text-kpi-green" />
          <span className="text-kpi-green font-medium">قاعدة بيانات محلية • SQLite</span>
          <span className="mr-auto h-1.5 w-1.5 rounded-full bg-kpi-green animate-pulse" aria-hidden="true" />
        </div>
      </div>

      {/* User */}
      <div className="p-3 border-t border-sidebar-border">
        <div className="flex items-center gap-2.5 mb-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#772344] to-[#D44D5C] text-[#F5EFE2] flex items-center justify-center font-bold text-sm shrink-0 shadow-md ring-1 ring-white/15">
            {user?.name?.charAt(0) || 'U'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white truncate">{user?.name}</p>
            <p className="text-[11px] text-sidebar-foreground/60">{getRoleLabel(user?.role)}</p>
          </div>
        </div>
        <div className="flex gap-1.5">
          <Button variant="ghost" size="sm" className="flex-1 h-8 text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-white" onClick={toggleTheme} aria-label="تبديل المظهر">
            {mounted && theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
          </Button>
          <Button variant="ghost" size="sm" className="flex-1 h-8 text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-white" onClick={handleLogout} disabled={loggingOut} aria-label="تسجيل الخروج">
            <LogOut className="w-3.5 h-3.5 ml-1" />
            خروج
          </Button>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// CollapsedSidebar — icon-only rail (desktop only, md+)
// ============================================================
function CollapsedSidebar() {
  const { user } = useAuthStore()
  const { activeModule, setModule, setSidebar } = useUIStore()
  const visibleGroups = MODULE_GROUPS.map(g => ({
    ...g,
    modules: g.modules.filter(m => !user || m.roles.includes(user.role)),
  })).filter(g => g.modules.length > 0)

  return (
    <div className="w-[72px] bg-sidebar flex flex-col items-center py-4 gap-1 shrink-0 h-screen sticky top-0">
      <img src="/icon-512.png" alt="" className="w-8 h-8 object-contain mb-3" draggable={false} />
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setSidebar(true)}
        title="فتح القائمة"
        aria-label="فتح القائمة"
        className="h-10 w-10 text-sidebar-foreground hover:bg-white/[0.07]"
      >
        <PanelLeftOpen className="w-5 h-5" />
      </Button>
      <div className="w-8 h-px bg-sidebar-border my-2" />
      <div className="sidebar-rail flex-1 min-h-0 w-full overflow-y-auto flex flex-col items-center gap-1">
        {visibleGroups.flatMap(g => g.modules).map(m => {
          const Icon = m.icon
          const active = activeModule === m.id
          return (
            <Button
              key={m.id}
              variant="ghost"
              size="icon"
              onClick={() => setModule(m.id)}
              aria-label={m.label}
              aria-current={active ? 'page' : undefined}
              className={cn(
                "h-11 w-11 relative rounded-xl transition-[background-color,color,transform,box-shadow] duration-150 shrink-0",
                active
                  ? "bg-sidebar-accent text-white sidebar-active-indicator shadow-[0_10px_24px_-18px_rgba(0,0,0,0.8)] hover:bg-sidebar-accent/90"
                  : "text-sidebar-foreground/70 hover:bg-white/[0.07] hover:text-white"
              )}
              title={m.label}
            >
              <Icon className="w-5 h-5" strokeWidth={active ? 2.5 : 2} />
            </Button>
          )
        })}
      </div>
    </div>
  )
}

// ============================================================
// MobileTopBar — sticky top bar with hamburger + brand, mobile only
// ============================================================
function MobileTopBar({ onOpenSidebar }: { onOpenSidebar: () => void }) {
  return (
    <div className="md:hidden sticky top-0 z-30 flex items-center gap-3 px-4 py-3 bg-sidebar text-white shadow-md">
      <Button
        variant="ghost"
        size="icon"
        onClick={onOpenSidebar}
        aria-label="فتح القائمة"
        className="h-10 w-10 text-white hover:bg-white/[0.08] shrink-0"
      >
        <Menu className="w-5 h-5" />
      </Button>
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <img src="/icon-512.png" alt="" className="w-7 h-7 object-contain shrink-0" draggable={false} />
        <h2 className="font-bold text-sm truncate">Uni Kasher</h2>
      </div>
    </div>
  )
}

// ============================================================
// Sidebar — top-level responsive component
// ============================================================
// Renders different UIs based on viewport:
//   • Desktop (md+): fixed sidebar (260px expanded, 72px collapsed)
//   • Mobile (<md): top bar with hamburger + Sheet drawer
// ============================================================
export function Sidebar() {
  const { sidebarOpen } = useUIStore()
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <>
      {/* ─── Mobile: top bar + Sheet drawer ─── */}
      <div className="md:hidden">
        <MobileTopBar onOpenSidebar={() => setMobileOpen(true)} />
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="right" className="w-[280px] p-0 bg-sidebar">
            <SidebarContent onNavigate={() => setMobileOpen(false)} />
          </SheetContent>
        </Sheet>
      </div>

      {/* ─── Desktop: fixed sidebar (expanded or collapsed) ─── */}
      <div className="hidden md:block">
        {sidebarOpen ? (
          <div className="w-[260px] shrink-0 h-screen sticky top-0">
            <SidebarContent />
          </div>
        ) : (
          <CollapsedSidebar />
        )}
      </div>
    </>
  )
}

// Note: getRoleLabel is now imported from '@/lib/roles' (centralized)

