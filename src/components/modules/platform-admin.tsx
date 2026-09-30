'use client'

import { useEffect, useState } from 'react'
import { apiFetch, formatEGP, formatNumber, formatDateTime } from '@/lib/api'
import { useAuthStore } from '@/lib/store'
import { getRoleLabel } from '@/lib/roles'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'


import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription
} from '@/components/ui/dialog'
import {
  Database, Users, Lock, Unlock, AlertTriangle,
  TrendingUp, Activity, HardDrive, Server, Shield, LogOut, RefreshCw
} from 'lucide-react'
import { toast } from 'sonner'

interface PlatformAdminData {
  systemLocked?: boolean
  lockedReason?: string | null
  database?: { totalRecords?: number; estimatedSizeMB?: string | number; tables?: Record<string, number> }
  totalSalesRevenue?: number
  recentSales?: number
  recentAuditLogs?: number
  usersByRole?: Record<string, number>
  lastUpdated?: string
}
import { notifyError } from '@/lib/notify'

export function PlatformAdminModule() {
  const { user, logout } = useAuthStore()
  const [data, setData] = useState<PlatformAdminData | null>(null)
  const [loading, setLoading] = useState(true)
  const [lockDialog, setLockDialog] = useState(false)
  const [lockReason, setLockReason] = useState('')

  const loadData = async () => {
    setLoading(true)
    try {
      const result = await apiFetch('/platform')
      setData(result)
    } catch (e) {
      notifyError(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
    const interval = setInterval(loadData, 30000) // refresh every 30s
    return () => clearInterval(interval)
  }, [])

  const handleLockSystem = async () => {
    try {
      await apiFetch('/platform/lock', {
        method: 'POST',
        body: JSON.stringify({
          locked: !data?.systemLocked,
          reason: lockReason,
          userId: user?.id,
        })
      })
      toast.success(data?.systemLocked ? 'تم فتح النظام' : 'تم قفل النظام')
      setLockDialog(false)
      setLockReason('')
      loadData()
    } catch (e) {
      notifyError(e)
    }
  }

  if (loading || !data) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="max-w-6xl mx-auto space-y-6">
          <Skeleton className="h-12 w-64" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[1,2,3,4].map(i => <Skeleton key={i} className="h-28" />)}
          </div>
          <Skeleton className="h-64" />
        </div>
      </div>
    )
  }

  const db = data.database ?? {}
  const tables = db.tables

  return (
    <div className="min-h-screen bg-background">
      <div className="module-page p-4 md:p-6 space-y-6 max-w-[1600px] mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
              <Shield className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">لوحة مدير المنصة</h1>
              <p className="text-sm text-muted-foreground">إدارة ومراقبة نظام المستحضرات التجميلية</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={loadData}>
              <RefreshCw className="w-4 h-4 ml-1" />
              تحديث
            </Button>
            <Button variant="outline" size="sm" onClick={logout}>
              <LogOut className="w-4 h-4 ml-1" />
              خروج
            </Button>
          </div>
        </div>

        {/* System Lock Status Alert */}
        {data.systemLocked ? (
          <Card className="border-destructive bg-destructive/5">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-destructive/10 flex items-center justify-center">
                <Lock className="w-5 h-5 text-destructive" />
              </div>
              <div className="flex-1">
                <p className="font-bold text-destructive">النظام مقفل</p>
                <p className="text-sm text-muted-foreground">
                  {data.lockedReason || 'لا يوجد سبب محدد'} • {data.lockedReason && `تم القفل بواسطة مدير المنصة`}
                </p>
              </div>
              <Button variant="outline" onClick={() => { setLockReason(data.lockedReason ?? ''); setLockDialog(true) }}>
                <Unlock className="w-4 h-4 ml-1" />
                فتح النظام
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-green-500 bg-green-500/5">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                <Unlock className="w-5 h-5 text-green-600" />
              </div>
              <div className="flex-1">
                <p className="font-bold text-green-600">النظام يعمل بشكل طبيعي</p>
                <p className="text-sm text-muted-foreground">جميع المتاجر نشطة ويمكنها إجراء عمليات البيع</p>
              </div>
              <Button variant="outline" onClick={() => setLockDialog(true)}>
                <Lock className="w-4 h-4 ml-1" />
                قفل النظام
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Data Volume Overview */}
        <div>
          <h2 className="text-lg font-bold mb-3 flex items-center gap-2">
            <Database className="w-5 h-5 text-primary" />
            حجم البيانات
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <HardDrive className="w-5 h-5 text-blue-500" />
                  <span className="text-xs text-muted-foreground">إجمالي السجلات</span>
                </div>
                <p className="text-2xl font-bold pos-number">{formatNumber(db.totalRecords)}</p>
                <p className="text-xs text-muted-foreground mt-1">سجل في قاعدة البيانات</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Server className="w-5 h-5 text-purple-500" />
                  <span className="text-xs text-muted-foreground">حجم البيانات</span>
                </div>
                <p className="text-2xl font-bold pos-number">{db.estimatedSizeMB}</p>
                <p className="text-xs text-muted-foreground mt-1">ميجابايت (تقريبي)</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp className="w-5 h-5 text-green-500" />
                  <span className="text-xs text-muted-foreground">إجمالي الإيرادات</span>
                </div>
                <p className="text-lg font-bold pos-number">{formatEGP(data.totalSalesRevenue)}</p>
                <p className="text-xs text-muted-foreground mt-1">من جميع المبيعات</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Activity className="w-5 h-5 text-amber-500" />
                  <span className="text-xs text-muted-foreground">نشاط الأسبوع</span>
                </div>
                <p className="text-2xl font-bold pos-number">{formatNumber(data.recentSales)}</p>
                <p className="text-xs text-muted-foreground mt-1">عملية بيع • {data.recentAuditLogs} سجل</p>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Database Tables Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Database className="w-4 h-4" />
              تفاصيل الجداول
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {Object.entries(tables as Record<string, number>).map(([table, count]) => (
                <div key={table} className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
                  <div>
                    <p className="text-xs text-muted-foreground">{getTableLabel(table)}</p>
                    <p className="text-lg font-bold pos-number">{formatNumber(count as number)}</p>
                  </div>
                  <Database className="w-4 h-4 text-muted-foreground" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Users by Role */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="w-4 h-4" />
              المستخدمون حسب الدور
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {Object.entries(data.usersByRole as Record<string, number>).map(([role, count]) => (
                <div key={role} className="text-center p-4 rounded-lg border">
                  <p className="text-xs text-muted-foreground mb-1">{getRoleLabel(role)}</p>
                  <p className="text-2xl font-bold pos-number">{formatNumber(count as number)}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Last Updated */}
        <div className="text-center text-xs text-muted-foreground py-4">
          آخر تحديث: {formatDateTime(data.lastUpdated)}
          <br />
          مدير المنصة: {user?.name} • هذه اللوحة لمراقبة النظام فقط ولا تعرض تفاصيل المتجر
        </div>
      </div>

      {/* Lock Dialog */}
      <Dialog open={lockDialog} onOpenChange={setLockDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {data.systemLocked ? <Unlock className="w-5 h-5" /> : <Lock className="w-5 h-5" />}
              {data.systemLocked ? 'فتح النظام' : 'قفل النظام'}
            </DialogTitle>
            <DialogDescription>
              {data.systemLocked
                ? 'سيتم فتح النظام والسماح بعمليات البيع من جديد'
                : 'سيتم منع جميع عمليات البيع في المتاجر. لا يمكن للكاشيرات إتمام أي فاتورة.'}
            </DialogDescription>
          </DialogHeader>
          {!data.systemLocked && (
            <div className="space-y-2">
              <Label>سبب القفل (اختياري)</Label>
              <Textarea
                value={lockReason}
                onChange={(e) => setLockReason(e.target.value)}
                placeholder="مثال: صيانة دورية، تحديث النظام..."
                rows={3}
              />
            </div>
          )}
          {data.systemLocked && (
            <div className="bg-amber-500/10 p-3 rounded-lg flex gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
              <p className="text-sm">سيتم إشعار جميع المتاجر بأن النظام متاح من جديد</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setLockDialog(false)} className="ml-2">
              إلغاء
            </Button>
            <Button
              variant={data.systemLocked ? 'default' : 'destructive'}
              onClick={handleLockSystem}
            >
              {data.systemLocked ? 'فتح النظام' : 'تأكيد القفل'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function getTableLabel(table: string): string {
  const labels: Record<string, string> = {
    stores: 'المتاجر',
    users: 'المستخدمون',
    products: 'المنتجات',
    customers: 'العملاء',
    sales: 'المبيعات',
    suppliers: 'الموردون',
    purchases: 'المشتريات',
    expenses: 'المصروفات',
    stockMovements: 'حركات المخزون',
    auditLogs: 'سجل العمليات',
    loyaltyTransactions: 'معاملات الولاء',
    cashSessions: 'جلسات الخزنة',
    saleReturns: 'المرتجعات',
    settings: 'الإعدادات',
  }
  return labels[table] || table
}

// Note: getRoleLabel is now imported from '@/lib/roles' (centralized)

