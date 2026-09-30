'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { useAuthStore } from '@/lib/store'
import { ROLE_LABELS, ROLE_COLORS } from '@/lib/roles'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import { DataTable } from '@/components/ui/data-table'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription
} from '@/components/ui/dialog'
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select'
import { UserPlus, Users, Edit, Trash2, Shield, Lock, Mail, Phone } from 'lucide-react'
import type { User } from '@/lib/types'
import { toast } from 'sonner'
import { notifyError } from '@/lib/notify'

// Role labels & colors now imported from '@/lib/roles' (centralized)

export function EmployeesModule() {
  const { user } = useAuthStore()
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editUser, setEditUser] = useState<User | null>(null)
  const [saving, setSaving] = useState(false)

  // Form state
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [phone, setPhone] = useState('')
  const [role, setRole] = useState('CASHIER')
  const [pin, setPin] = useState('')
  const [active, setActive] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const data = await apiFetch('/users')
      setUsers(data || [])
    } catch (e) {
      notifyError(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const openAdd = () => {
    setEditUser(null)
    setName('')
    setUsername('')
    setEmail('')
    setPassword('')
    setPhone('')
    setRole('CASHIER')
    setPin('')
    setActive(true)
    setDialogOpen(true)
  }

  const openEdit = (u: User) => {
    setEditUser(u)
    setName(u.name)
    setUsername(u.username)
    setEmail(u.email || '')
    setPassword('')
    setPhone(u.phone || '')
    setRole(u.role)
    setPin('')
    setActive(u.active !== false)
    setDialogOpen(true)
  }

  const isEditingSelfAdmin = !!editUser && editUser.id === user?.id && user?.role === 'ADMIN'

  const handleSave = async () => {
    setSaving(true)
    try {
      const data: Record<string, unknown> = { name, username, email, phone, active }
      if (!isEditingSelfAdmin) data.role = role
      // PIN is write-only in the API: never read or resend the stored hash.
      // A blank PIN on edit means "keep the existing PIN".
      if (pin) data.pin = pin
      if (password) data.password = password

      if (editUser) {
        await apiFetch(`/users/${editUser.id}`, { method: 'PUT', body: JSON.stringify(data) })
        toast.success('تم تحديث الموظف')
      } else {
        if (!password) {
          toast.error('كلمة المرور مطلوبة')
          setSaving(false)
          return
        }
        await apiFetch('/users', { method: 'POST', body: JSON.stringify(data) })
        toast.success('تم إنشاء الموظف')
      }
      setDialogOpen(false)
      load()
    } catch (e) {
      notifyError(e)
    } finally {
      setSaving(false)
    }
  }

  const handleDeactivate = async (u: User) => {
    if (!confirm(`تعطيل الموظف "${u.name}"؟`)) return
    try {
      await apiFetch(`/users/${u.id}`, { method: 'DELETE' })
      toast.success('تم تعطيل الموظف')
      load()
    } catch (e) {
      notifyError(e)
    }
  }

  // Only ADMIN or PLATFORM can access
  if (user?.role !== 'ADMIN' && user?.role !== 'PLATFORM') {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="p-8 text-center">
            <Lock className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">صلاحية المدير مطلوبة للوصول لهذه الصفحة</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const activeCount = users.filter(u => u.active !== false).length
  const adminCount = users.filter(u => u.role === 'ADMIN').length

  return (
    <div className="module-page p-4 md:p-6 space-y-6 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="uk-page-header flex flex-col md:flex-row md:items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="w-6 h-6 text-primary" />
            إدارة الموظفين
          </h1>
          <p className="text-muted-foreground text-sm">إضافة وتعديل وتعطيل حسابات الموظفين</p>
        </div>
        <Button onClick={openAdd}>
          <UserPlus className="w-4 h-4 ml-1" />
          إضافة موظف
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">إجمالي الموظفين</p>
            <p className="text-2xl font-bold">{users.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">نشط</p>
            <p className="text-2xl font-bold text-green-600">{activeCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">مديرون</p>
            <p className="text-2xl font-bold text-purple-600">{adminCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">معطل</p>
            <p className="text-2xl font-bold text-red-600">{users.length - activeCount}</p>
          </CardContent>
        </Card>
      </div>

      {/* Users Table */}
      <DataTable
        loading={loading}
        fillHeight={true}
        reserveHeight={350}
        minHeight="480px"
        minWidth="min-w-[800px]"
        emptyMessage="لا يوجد موظفون — أضف أول موظف من الزر أعلى الصفحة"
        columns={[
          {
            key: 'name',
            header: 'الموظف',
            render: (u) => (
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold shrink-0 text-xs">
                  {u.name?.charAt(0) || 'U'}
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{u.name}</span>
                  {u.id === user?.id && <Badge variant="secondary" className="text-[10px]">أنت</Badge>}
                  {u.active === false && <Badge variant="destructive" className="text-[10px]">معطل</Badge>}
                </div>
              </div>
            )
          },
          { key: 'username', header: 'اسم المستخدم', cellClassName: 'font-mono text-xs text-muted-foreground', render: (u) => `@${u.username}` },
          { key: 'phone', header: 'الهاتف', cellClassName: 'text-sm text-muted-foreground', render: (u) => u.phone || '—' },
          { key: 'email', header: 'البريد', cellClassName: 'text-sm text-muted-foreground', render: (u) => u.email || '—' },
          {
            key: 'role',
            header: 'الصلاحية',
            align: 'center',
            render: (u) => (
              <Badge className={`inline-flex items-center ${ROLE_COLORS[u.role] || ''}`} variant="outline">
                <Shield className="w-3 h-3 ml-1" />
                {ROLE_LABELS[u.role] || u.role}
              </Badge>
            )
          },
          {
            key: 'status',
            header: 'الحالة',
            align: 'center',
            render: (u) => (
              <Badge variant={u.active !== false ? 'secondary' : 'destructive'} className="text-xs">
                {u.active !== false ? 'نشط' : 'معطل'}
              </Badge>
            )
          },
          {
            key: 'actions',
            header: 'إجراءات',
            align: 'center',
            render: (u) => (
              <div className="flex items-center justify-center gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  onClick={() => openEdit(u)}
                  aria-label={`تعديل الموظف ${u.name}`}
                  title="تعديل"
                >
                  <Edit className="w-4 h-4" />
                </Button>
                {u.id !== user?.id && u.active !== false && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-destructive"
                    onClick={() => handleDeactivate(u)}
                    aria-label={`تعطيل الموظف ${u.name}`}
                    title="تعطيل"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </div>
            )
          }
        ]}
        rows={users}
        rowKey={(u) => u.id}
      />

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editUser ? 'تعديل موظف' : 'إضافة موظف جديد'}</DialogTitle>
            {!editUser && (
              <DialogDescription>
                سيتم إنشاء حساب جديد يمكنه تسجيل الدخول للنظام
              </DialogDescription>
            )}
          </DialogHeader>
          <div className="space-y-3 max-h-[60vh] overflow-y-auto">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>الاسم الكامل *</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: أحمد محمد" />
              </div>
              <div className="space-y-1.5">
                <Label>اسم المستخدم *</Label>
                <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="ahmed" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>البريد الإلكتروني</Label>
                <div className="relative">
                  <Mail className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input className="pr-9" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ahmed@beauty.com" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>الهاتف</Label>
                <div className="relative">
                  <Phone className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input className="pr-9" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01000000000" />
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{editUser ? 'كلمة مرور جديدة' : 'كلمة المرور *'}</Label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={editUser ? 'اتركها فارغة للإبقاء' : '6 أحرف على الأقل'}
                />
              </div>
              <div className="space-y-1.5">
                <Label>رمز PIN (اختياري)</Label>
                <Input
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, '').substring(0, 4))}
                  placeholder={editUser ? 'اتركه فارغًا للإبقاء' : '0000'}
                  maxLength={4}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>الدور *</Label>
                {isEditingSelfAdmin && (
                  <span className="text-[11px] text-muted-foreground">صلاحية حسابك محمية</span>
                )}
              </div>
              <Select value={role} onValueChange={setRole} disabled={isEditingSelfAdmin}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ADMIN">مدير (صلاحيات كاملة)</SelectItem>
                  <SelectItem value="MANAGER">مشرف</SelectItem>
                  <SelectItem value="CASHIER">كاشير</SelectItem>
                  <SelectItem value="WAREHOUSE">أمين مخزن</SelectItem>
                  <SelectItem value="ACCOUNTANT">محاسب</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {isEditingSelfAdmin && (
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-800">
                لا يمكن لمدير النظام تغيير دوره أو صلاحياته الذاتية. يمكنه تعديل بيانات الحساب الأخرى فقط.
              </div>
            )}

            <div className="flex items-center justify-between p-3 rounded-lg border">
              <div>
                <Label>الحساب نشط</Label>
                <p className="text-xs text-muted-foreground">الموظفون المعطلون لا يمكنهم تسجيل الدخول</p>
              </div>
              <Switch checked={active} onCheckedChange={setActive} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>إلغاء</Button>
            <Button
              onClick={handleSave}
              disabled={saving || !name || !username || (!editUser && !password)}
            >
              {saving ? 'جاري الحفظ...' : editUser ? 'حفظ التعديلات' : 'إنشاء الموظف'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
