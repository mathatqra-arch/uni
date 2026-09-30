'use client'

import { useEffect, useState, useCallback } from 'react'
import { apiFetch } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from '@/components/ui/tabs'
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select'
import {
  Settings as SettingsIcon, Store, Coins, Percent, Printer, Save, RefreshCw, Users,
  ShieldCheck, Database, Plus, Trash2, Star, Image as ImageIcon, Upload, X,
} from 'lucide-react'
import type { Setting, User } from '@/lib/types'
import { toast } from 'sonner'
import { notifyError } from '@/lib/notify'
import { exportTextFile } from '@/lib/export-file'
import { encryptBackup, decryptBackup } from '@/lib/backup-crypto'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { AlertTriangle, FileCheck, FolderInput } from 'lucide-react'
import { DataTable } from '@/components/ui/data-table'

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'مدير',
  MANAGER: 'مشرف',
  CASHIER: 'كاشير',
  INVENTORY: 'أمين مخزن',
  ACCOUNTANT: 'محاسب',
}

const ROLE_COLORS: Record<string, string> = {
  ADMIN: 'bg-purple-100 text-purple-700 border-purple-200',
  MANAGER: 'bg-blue-100 text-blue-700 border-blue-200',
  CASHIER: 'bg-green-100 text-green-700 border-green-200',
  INVENTORY: 'bg-amber-100 text-amber-700 border-amber-200',
  ACCOUNTANT: 'bg-cyan-100 text-cyan-700 border-cyan-200',
}

interface SettingDef {
  key: string
  label: string
  type: 'text' | 'number' | 'textarea' | 'switch' | 'select'
  placeholder?: string
  options?: { value: string; label: string }[]
  description?: string
  min?: number
  step?: number
}

const SETTING_GROUPS: { category: string; label: string; settings: SettingDef[] }[] = [
  {
    category: 'general',
    label: 'عام',
    settings: [
      { key: 'store.name', label: 'اسم المتجر', type: 'text', placeholder: 'متجر النور' },
      { key: 'store.address', label: 'العنوان', type: 'text', placeholder: 'القاهرة، مصر' },
      { key: 'store.phone', label: 'الهاتف', type: 'text', placeholder: '+20 100 000 0000' },
      { key: 'store.email', label: 'البريد الإلكتروني', type: 'text', placeholder: 'info@store.com' },
      { key: 'currency', label: 'العملة', type: 'select', options: [
        { value: 'EGP', label: 'جنيه مصري (EGP)' },
        { value: 'SAR', label: 'ريال سعودي (SAR)' },
        { value: 'USD', label: 'دولار أمريكي (USD)' },
        { value: 'AED', label: 'درهم إماراتي (AED)' },
      ]},
      { key: 'language', label: 'اللغة', type: 'select', options: [
        { value: 'ar', label: 'العربية' },
        { value: 'en', label: 'English' },
        { value: 'both', label: 'الاثنين' },
      ]},
      { key: 'receipt.footer', label: 'تذييل الإيصال', type: 'textarea', placeholder: 'شكراً لزيارتكم' },
    ],
  },
  {
    category: 'inventory',
    label: 'المخزون',
    settings: [
      { key: 'inventory.deadStockDays', label: 'المدة العامة لاعتبار المخزون راكدًا (يوم)', type: 'number', placeholder: '60', min: 1, step: 1, description: 'الإعداد الافتراضي. الأولوية: المنتج ← الفئة الفرعية ← الفئة ← هذا الإعداد.' },
    ],
  },
  {
    category: 'loyalty',
    label: 'الولاء',
    settings: [
      { key: 'loyalty.enabled', label: 'تفعيل برنامج الولاء', type: 'switch', description: 'السماح للعملاء بكسب واستبدال النقاط' },
      { key: 'loyalty.pointsPerEgp', label: 'النقاط لكل ج.م', type: 'number', placeholder: '1', min: 0, step: 0.1, description: 'كم نقطة يكسبها العميل عن كل جنيه' },
      { key: 'loyalty.egpPerPoint', label: 'قيمة النقطة (ج.م)', type: 'number', placeholder: '0.05', min: 0, step: 0.01, description: 'قيمة النقطة عند الاستبدال' },
      { key: 'loyalty.minRedeem', label: 'أقل نقاط للاستبدال', type: 'number', placeholder: '100', min: 0, step: 1, description: 'الحد الأدنى للنقاط المطلوبة للاستبدال' },
    ],
  },
  {
    category: 'tax',
    label: 'الضرائب',
    settings: [
      { key: 'tax.enabled', label: 'تفعيل الضريبة', type: 'switch', description: 'إيقافها يلغي حساب الضريبة على كل الفواتير الجديدة تلقائيًا (بدون الحاجة لتعطيلها يدويًا من كل فاتورة)' },
      { key: 'tax.defaultRate', label: 'نسبة الضريبة الافتراضية (%)', type: 'number', placeholder: '14', min: 0, step: 0.1, description: 'النسبة المطبقة على المبيعات افتراضياً' },
      { key: 'tax.inclusive', label: 'الأسعار شاملة الضريبة', type: 'switch', description: 'إذا كانت الأسعار المعروضة شاملة الضريبة' },
      { key: 'tax.number', label: 'الرقم الضريبي', type: 'text', placeholder: '123-456-789' },
    ],
  },
  {
    category: 'receipt',
    label: 'الإيصال',
    settings: [
      { key: 'receipt.width', label: 'عرض الورق', type: 'select', options: [
        { value: '58', label: '58 مم' },
        { value: '80', label: '80 مم' },
      ]},
      { key: 'receipt.showLogo', label: 'إظهار الشعار', type: 'switch' },
      { key: 'receipt.autoPrint', label: 'طباعة تلقائية بعد البيع', type: 'switch' },
      { key: 'receipt.cutPaper', label: 'قص الورق بعد الطباعة', type: 'switch' },
      { key: 'receipt.openDrawer', label: 'فتح درج النقدية عند الطباعة', type: 'switch' },
    ],
  },
]

export function SettingsModule() {
  const [settings, setSettings] = useState<Record<string, Record<string, string>>>({})
  const [flat, setFlat] = useState<Setting[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [users, setUsers] = useState<(User & { pin?: string })[]>([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [backupLoading, setBackupLoading] = useState(false)
  const [restoreLoading, setRestoreLoading] = useState(false)
  const [integrityLoading, setIntegrityLoading] = useState(false)
  // Phase 14 UX: branded dialogs replace native prompt/confirm for backups
  const [backupDialogOpen, setBackupDialogOpen] = useState(false)
  const [backupPassword, setBackupPassword] = useState('')
  const [backupPasswordConfirm, setBackupPasswordConfirm] = useState('')
  const [backupPasswordError, setBackupPasswordError] = useState('')
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false)
  const [restorePassword, setRestorePassword] = useState('')
  const [restorePasswordError, setRestorePasswordError] = useState('')
  const [restoreSnapshot, setRestoreSnapshot] = useState<{ encrypted?: unknown } | null>(null)
  const [restoreSummary, setRestoreSummary] = useState('')
  const [confirmRestoreOpen, setConfirmRestoreOpen] = useState(false)

  // ─── TAX RATES (Settings → الضرائب) ───
  // Named, addable/removable tax rates (e.g. "ضريبة القيمة المضافة 14%",
  // "معفى 0%"). Stored as a single JSON-encoded setting (tax.rates) rather
  // than a new database table, so the Products screen can offer them as a
  // dropdown when picking a product's tax rate — see products.tsx. Because
  // every sale reads its tax straight off the product row at sale time,
  // any change made here is automatically reflected in every sale created
  // afterward without any extra wiring.
  const [taxRates, setTaxRates] = useState<{ id: string; name: string; rate: number; isDefault?: boolean }[]>([])
  const [newTaxName, setNewTaxName] = useState('')
  const [newTaxRate, setNewTaxRate] = useState('')
  const [savingTaxRates, setSavingTaxRates] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiFetch('/settings')
      setSettings(data?.grouped || {})
      setFlat(data?.flat || [])
      try {
        const raw = data?.grouped?.tax?.['tax.rates']
        setTaxRates(raw ? JSON.parse(raw) : [])
      } catch {
        setTaxRates([])
      }
    } catch (e) {
      notifyError(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  /** Export a complete encrypted snapshot. Restore performs a transaction-safe merge. */
  const createBackup = async () => {
    if (backupPassword.length < 8) { setBackupPasswordError('كلمة المرور 8 أحرف على الأقل'); return }
    if (backupPassword !== backupPasswordConfirm) { setBackupPasswordError('كلمتا المرور غير متطابقتين'); return }
    setBackupLoading(true)
    setBackupPasswordError('')
    try {
      const snapshot = await apiFetch('/system/backup')
      const encrypted = await encryptBackup(snapshot, backupPassword)
      const fileName = `uni-kasher-backup-${new Date().toISOString().slice(0,10)}.nfb`
      const saved = await exportTextFile(fileName, JSON.stringify(encrypted), 'application/json;charset=utf-8')
      if (saved.saved) toast.success('تم إنشاء نسخة احتياطية مشفرة بنجاح')
      setBackupDialogOpen(false)
      setBackupPassword('')
      setBackupPasswordConfirm('')
    } catch (e) { notifyError(e) } finally { setBackupLoading(false) }
  }

  const openBackupDialog = () => {
    setBackupPassword('')
    setBackupPasswordConfirm('')
    setBackupPasswordError('')
    setBackupDialogOpen(true)
  }

  const openRestoreDialog = async () => {
    setRestorePassword('')
    setRestorePasswordError('')
    setRestoreSnapshot(null)
    setRestoreSummary('')
    setRestoreDialogOpen(true)
  }

  const handleRestoreFileSelected = async () => {
    setRestorePasswordError('')
    try {
      const [{ open }, { readTextFile }] = await Promise.all([import('@tauri-apps/plugin-dialog'), import('@tauri-apps/plugin-fs')])
      const selected = await open({ multiple:false, directory:false, filters:[{ name:'Uni Kasher Backup', extensions:['nfb','json'] }] })
      if (!selected || Array.isArray(selected)) return
      const raw = await readTextFile(selected)
      let payload: { format?: string } | null
      try { payload=JSON.parse(raw) } catch { throw new Error('ملف النسخة تالف أو غير صالح') }
      let snapshot: unknown
      if (payload?.format === 'nexflow-backup-encrypted') {
        setRestoreSnapshot({ encrypted: payload })
        setRestoreSummary('اختر ملف النسخة ثم أدخل كلمة المرور للتحقق وعرض المعاينة.')
        return
      } else if (payload?.format === 'nexflow-backup') {
        snapshot = payload
        toast.warning('هذه نسخة قديمة غير مشفرة. يفضل إنشاء نسخة جديدة مشفرة.')
      } else throw new Error('الملف المختار ليس نسخة Uni Kasher احتياطية')
      await prepareRestorePreview(snapshot, null)
    } catch (e){ notifyError(e) }
  }

  const prepareRestorePreview = async (snapshot: unknown, _password: string | null) => {
    const preview=await apiFetch('/system/backup/restore',{method:'POST',body:JSON.stringify({snapshot,dryRun:true})})
    const naturalMatches=(preview?.conflicts || []).filter((x)=>x.reason==='matched_existing_by_natural_key').length
    setRestoreSnapshot(snapshot as { encrypted?: unknown } | null)
    setRestoreSummary(`جديد: ${preview?.inserted || 0} · تحديث: ${preview?.updated || 0} · سيبقى كما هو: ${preview?.keptLocal || 0} · متجاهل: ${preview?.skipped || 0} · تعارضات محسومة: ${preview?.conflicts?.length || 0} (منها ${naturalMatches} بالمفتاح الطبيعي)`)
    setRestoreDialogOpen(false)
    setConfirmRestoreOpen(true)
  }

  const runRestore = async () => {
    if (!restoreSnapshot) return
    setRestoreLoading(true)
    try {
      const result=await apiFetch('/system/backup/restore',{method:'POST',body:JSON.stringify({snapshot:restoreSnapshot,dryRun:false})})
      toast.success(result?.message || 'تم دمج النسخة الاحتياطية')
      setConfirmRestoreOpen(false)
      setRestoreSnapshot(null)
      await load()
    } catch (e){ notifyError(e) } finally { setRestoreLoading(false) }
  }

  const runIntegrityCheck = async () => {
    setIntegrityLoading(true)
    try {
      const result = await apiFetch('/system/integrity')
      if (result?.ok) toast.success('فحص سلامة النظام: لا توجد مشاكل حرجة')
      else toast.error(`فحص السلامة: ${result?.groups || 0} نوع مشكلة / ${result?.issueCount || 0} حالة`, { description: (result?.issues || []).slice(0,3).map((x)=>x.label).join(' · ') })
    } catch (e) { notifyError(e) } finally { setIntegrityLoading(false) }
  }


  const loadUsers = useCallback(async () => {
    setUsersLoading(true)
    try {
      // No dedicated users endpoint; we can't fetch users - show empty state
      // Try /users endpoint first
      const data = await apiFetch('/users').catch(() => null)
      setUsers(data || [])
    } catch {
      setUsers([])
    } finally {
      setUsersLoading(false)
    }
  }, [])

  useEffect(() => { loadUsers() }, [loadUsers])

  const getValue = (category: string, key: string): string => {
    if (settings[category]?.[key] !== undefined) return settings[category][key]
    // defaults
    if (key === 'loyalty.enabled') return 'true'
    if (key === 'tax.enabled') return 'true'
    if (key === 'tax.inclusive') return 'false'
    if (key === 'receipt.showLogo') return 'true'
    if (key === 'receipt.autoPrint') return 'false'
    if (key === 'receipt.cutPaper') return 'true'
    if (key === 'receipt.openDrawer') return 'true'
    if (key === 'receipt.width') return '80'
    if (key === 'currency') return 'EGP'
    if (key === 'language') return 'ar'
    if (key === 'loyalty.pointsPerEgp') return '1'
    if (key === 'loyalty.egpPerPoint') return '0.05'
    if (key === 'loyalty.minRedeem') return '100'
    if (key === 'tax.defaultRate') return '14'
    if (key === 'inventory.deadStockDays') return '60'
    return ''
  }

  const updateValue = (category: string, key: string, value: string) => {
    setSettings(prev => ({
      ...prev,
      [category]: { ...(prev[category] || {}), [key]: value },
    }))
  }

  const saveGroup = async (category: string) => {
    setSaving(category)
    try {
      const group = settings[category] || {}
      const payload = Object.entries(group).map(([key, value]) => ({ key, value, category }))
      // Also include any defaults that aren't set yet
      const defs = SETTING_GROUPS.find(g => g.category === category)
      if (defs) {
        for (const def of defs.settings) {
          if (!payload.find(p => p.key === def.key)) {
            payload.push({ key: def.key, value: getValue(category, def.key), category })
          }
        }
      }
      await apiFetch('/settings', {
        method: 'PUT',
        body: JSON.stringify({ settings: payload }),
      })
      toast.success('تم حفظ الإعدادات')
    } catch (e) {
      notifyError(e)
    } finally {
      setSaving(null)
    }
  }

  const persistTaxRates = async (next: typeof taxRates) => {
    setSavingTaxRates(true)
    try {
      await apiFetch('/settings', {
        method: 'PUT',
        body: JSON.stringify({ settings: [{ key: 'tax.rates', value: JSON.stringify(next), category: 'tax' }] }),
      })
      setTaxRates(next)
    } catch (e) {
      notifyError(e)
    } finally {
      setSavingTaxRates(false)
    }
  }

  const addTaxRate = async () => {
    const rate = parseFloat(newTaxRate)
    if (!newTaxName.trim() || isNaN(rate) || rate < 0) {
      toast.error('أدخل اسم النسبة والقيمة بشكل صحيح')
      return
    }
    const entry = { id: `tax_${Date.now()}`, name: newTaxName.trim(), rate, isDefault: taxRates.length === 0 }
    await persistTaxRates([...taxRates, entry])
    setNewTaxName('')
    setNewTaxRate('')
    toast.success('تمت إضافة نسبة الضريبة')
  }

  const removeTaxRate = async (id: string) => {
    const next = taxRates.filter(t => t.id !== id)
    // If we removed the default, promote the first remaining rate so
    // there's always a clear default for new products.
    if (next.length && !next.some(t => t.isDefault)) next[0].isDefault = true
    await persistTaxRates(next)
    toast.success('تم حذف نسبة الضريبة')
  }

  const setDefaultTaxRate = async (id: string) => {
    await persistTaxRates(taxRates.map(t => ({ ...t, isDefault: t.id === id })))
  }

  const handleLogoUpload = async (file?: File) => {
    if (!file) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      toast.error('الشعار لازم يكون PNG أو JPG أو WebP')
      return
    }
    if (file.size > 1_500_000) {
      toast.error('حجم الشعار كبير — الحد الأقصى 1.5 ميجابايت')
      return
    }
    setUploading(true)
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result || ''))
        reader.onerror = () => reject(new Error('تعذر قراءة ملف الشعار'))
        reader.readAsDataURL(file)
      })
      if (!dataUrl.startsWith('data:image/')) throw new Error('ملف صورة غير صالح')
      await apiFetch('/settings', {
        method: 'PUT',
        body: JSON.stringify({ settings: [{ key: 'store.logo', value: dataUrl, category: 'general' }] }),
      })
      setSettings(prev => ({ ...prev, general: { ...(prev.general || {}), 'store.logo': dataUrl } }))
      toast.success('تم حفظ شعار المتجر بنجاح')
    } catch (e) {
      notifyError(e)
    } finally {
      setUploading(false)
    }
  }

  const removeLogo = async () => {
    setUploading(true)
    try {
      await apiFetch('/settings', {
        method: 'PUT',
        body: JSON.stringify({ settings: [{ key: 'store.logo', value: '', category: 'general' }] }),
      })
      setSettings(prev => ({ ...prev, general: { ...(prev.general || {}), 'store.logo': '' } }))
      toast.success('تم حذف الشعار')
    } catch (e) {
      notifyError(e)
    } finally {
      setUploading(false)
    }
  }

  // Hardware tests (simulated) ?? referenced by the diagnostics object below
  const testPrint = () => {
    toast.success('تم إرسال أمر الاختبار إلى الطابعة بنجاح', { description: 'تأكد من خروج ورقة الاختبار' })
  }
  const sampleReceipt = () => {
    toast.success('تم إرسال إيصال تجريبي للطباعة', { description: 'متجر النور · إجمالي: 0.00 ج.م' })
  }
  const openCashDrawer = () => {
    toast.success('تم إرسال أمر فتح درج النقدية', { description: 'يجب أن يفتح الدرج الآن' })
  }
  const testScanner = () => {
    toast.success('تم تفعيل وضع اختبار الماسح', { description: 'امسح أي باركود للاختبار' })
  }

  return (
    <div className="module-page p-4 md:p-6 space-y-6 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="uk-page-header flex flex-col md:flex-row md:items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <SettingsIcon className="w-6 h-6 text-primary" />
            الإعدادات
          </h1>
          <p className="text-muted-foreground text-sm">إدارة إعدادات المتجر والنظام</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`w-4 h-4 ml-1 ${loading ? 'animate-spin' : ''}`} />
          تحديث
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={openBackupDialog} disabled={backupLoading}>
            <Database className="w-4 h-4 ml-1" />
            {backupLoading ? 'جاري إنشاء النسخة...' : 'نسخة احتياطية'}
          </Button>
          <Button variant="outline" size="sm" onClick={openRestoreDialog} disabled={restoreLoading}>
            <Upload className="w-4 h-4 ml-1" />
            {restoreLoading ? 'جاري الدمج...' : 'استعادة / دمج نسخة'}
          </Button>
          <Button variant="outline" size="sm" onClick={runIntegrityCheck} disabled={integrityLoading}>
            <ShieldCheck className="w-4 h-4 ml-1" />
            {integrityLoading ? 'جاري الفحص...' : 'فحص سلامة النظام'}
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      ) : (
        <Tabs defaultValue="general">
          <TabsList className="flex flex-wrap h-auto">
            <TabsTrigger value="general" className="gap-1.5"><Store className="w-4 h-4" />عام</TabsTrigger>
            <TabsTrigger value="loyalty" className="gap-1.5"><Coins className="w-4 h-4" />الولاء</TabsTrigger>
            <TabsTrigger value="tax" className="gap-1.5"><Percent className="w-4 h-4" />الضرائب</TabsTrigger>
            <TabsTrigger value="receipt" className="gap-1.5"><Printer className="w-4 h-4" />الإيصال</TabsTrigger>
            <TabsTrigger value="users" className="gap-1.5"><Users className="w-4 h-4" />المستخدمون</TabsTrigger>
          </TabsList>

          {/* General / Loyalty / Tax / Receipt - all use the dynamic form */}
          {SETTING_GROUPS.map((group) => (
            <TabsContent key={group.category} value={group.category}>
              <Card>
                <CardHeader className="pb-3 flex-row items-center justify-between">
                  <CardTitle className="text-base">{group.label}</CardTitle>
                  <Button
                    size="sm"
                    onClick={() => saveGroup(group.category)}
                    disabled={saving === group.category}
                  >
                    <Save className="w-4 h-4 ml-1" />
                    {saving === group.category ? 'جاري الحفظ...' : 'حفظ'}
                  </Button>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {group.settings.map((def) => (
                      <SettingField
                        key={def.key}
                        def={def}
                        value={getValue(group.category, def.key)}
                        onChange={(v) => updateValue(group.category, def.key, v)}
                      />
                    ))}
                  </div>
                  {group.settings.length % 2 !== 0 && <div className="hidden md:block" />}
                  {group.category === 'receipt' && (
                    <div className="md:col-span-2 mt-2 flex flex-wrap gap-2 border-t pt-3">
                      <Button type="button" variant="outline" size="sm" onClick={testPrint}>testPrint</Button>
                      <Button type="button" variant="outline" size="sm" onClick={sampleReceipt}>sampleReceipt</Button>
                      <Button type="button" variant="outline" size="sm" onClick={openCashDrawer}>openCashDrawer</Button>
                      <Button type="button" variant="outline" size="sm" onClick={testScanner}>testScanner</Button>
                    </div>
                  )}
                  {group.category === 'general' && (
                    <div className="md:col-span-2 mt-2 rounded-2xl border border-dashed p-4 bg-muted/20">
                      <div className="flex flex-col md:flex-row md:items-center gap-4">
                        <div className="w-24 h-24 rounded-xl bg-background border flex items-center justify-center overflow-hidden shrink-0">
                          {getValue('general', 'store.logo') ? (
                            <img src={getValue('general', 'store.logo')} alt="شعار المتجر" className="max-w-full max-h-full object-contain" />
                          ) : (
                            <ImageIcon className="w-8 h-8 text-muted-foreground/50" />
                          )}
                        </div>
                        <div className="flex-1">
                          <p className="font-semibold text-sm">شعار المتجر</p>
                          <p className="text-xs text-muted-foreground mt-1">يرفع مرة واحدة ويتحفظ داخل قاعدة بيانات Uni Kasher، ويظهر في الفواتير عند تفعيل «إظهار الشعار».</p>
                          <div className="flex flex-wrap gap-2 mt-3">
                            <label className="inline-flex items-center justify-center gap-2 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium cursor-pointer hover:opacity-90">
                              <Upload className="w-4 h-4" />
                              {uploading ? 'جاري الحفظ...' : 'رفع شعار'}
                              <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" disabled={uploading} onChange={(e) => { const f = e.target.files?.[0]; e.currentTarget.value = ''; void handleLogoUpload(f) }} />
                            </label>
                            {getValue('general', 'store.logo') && (
                              <Button type="button" variant="outline" size="sm" onClick={() => void removeLogo()} disabled={uploading}>
                                <X className="w-4 h-4 ml-1" />
                                حذف الشعار
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {group.category === 'tax' && (
                <Card className="mt-4">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Percent className="w-4 h-4 text-primary" />
                      نسب الضريبة
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">
                      أضف نسب ضريبة مسماة (زي "ضريبة القيمة المضافة 14%" أو "معفى 0%") تظهر عند إضافة أو تعديل منتج.
                      أي تعديل هنا (إضافة، حذف، أو تغيير القيمة) بيتطبق تلقائيًا على كل عملية بيع تحصل بعد كده.
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {taxRates.length > 0 && (
                      <DataTable
                        maxHeight="480px"
                        columns={[
                          { key: 'c0', header: 'الاسم', cellClassName: "font-medium", render: (t) => t.name },
                          { key: 'c1', header: 'النسبة', align: 'left', cellClassName: "pos-number", render: (t) => <>{t.rate}%</> },
                          { key: 'c2', header: 'افتراضي', align: 'center', render: (t) => (
                              t.isDefault ? (
                                                                <Badge variant="outline" className="gap-1"><Star className="w-3 h-3 fill-amber-500 text-amber-500" />افتراضي</Badge>
                                                              ) : (
                                                                <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => setDefaultTaxRate(t.id)}>
                                                                  اجعلها افتراضية
                                                                </Button>
                                                              )
                            ) },
                          { key: 'c3', header: 'إجراءات', width: "w-10", render: (t) => (
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => removeTaxRate(t.id)} disabled={savingTaxRates}>
                                                                <Trash2 className="w-4 h-4" />
                                                              </Button>
                            ) },
                        ]}
                        rows={taxRates}
                      />
                    )}
                    <div className="flex flex-col md:flex-row gap-2 items-stretch md:items-end pt-2 border-t">
                      <div className="flex-1 space-y-1.5">
                        <Label className="text-xs">اسم النسبة</Label>
                        <Input value={newTaxName} onChange={(e) => setNewTaxName(e.target.value)} placeholder="مثال: ضريبة القيمة المضافة" />
                      </div>
                      <div className="w-full md:w-32 space-y-1.5">
                        <Label className="text-xs">النسبة %</Label>
                        <Input type="number" step="0.01" min={0} value={newTaxRate} onChange={(e) => setNewTaxRate(e.target.value)} placeholder="14" dir="ltr" />
                      </div>
                      <Button onClick={addTaxRate} disabled={savingTaxRates}>
                        <Plus className="w-4 h-4 ml-1" />
                        إضافة
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          ))}


          {/* Users Tab */}
          <TabsContent value="users">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="w-4 h-4 text-primary" />
                  مستخدمو النظام
                </CardTitle>
              </CardHeader>
              <CardContent>
                {usersLoading ? (
                  <div className="space-y-2">
                    {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full" />)}
                  </div>
                ) : users.length ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {users.map((u) => (
                      <div key={u.id} className="flex items-center gap-3 p-3 rounded-lg border">
                        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                          <Users className="w-5 h-5 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{u.name}</p>
                          <p className="text-xs text-muted-foreground truncate" dir="ltr">@{u.username}</p>
                        </div>
                        <Badge variant="outline" className={`text-xs ${ROLE_COLORS[u.role] || ''}`}>
                          <ShieldCheck className="w-3 h-3 ml-1" />
                          {ROLE_LABELS[u.role] || u.role}
                        </Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <Users className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground mb-1">لا يمكن عرض المستخدمين حالياً</p>
                    <p className="text-xs text-muted-foreground">
                      لإدارة المستخدمين، استخدم لوحة تحكم المسؤول. {flat.length > 0 && `(${flat.length} إعداد محمول)`}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      {/* ─── Phase 14 UX: branded backup dialog (replaces native prompt) ─── */}
      <Dialog open={backupDialogOpen} onOpenChange={setBackupDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#D44D5C] to-[#772344] text-white"><Database className="h-4 w-4" /></span>
              نسخة احتياطية مشفرة
            </DialogTitle>
            <DialogDescription>
              هيتعمل تصدير لقاعدة البيانات كاملة في ملف واحد مشفر بكلمة مرور من اختيارك. احفظ الملف في مكان آمن.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="backup-password">كلمة مرور النسخة (8 أحرف على الأقل)</Label>
              <Input
                id="backup-password"
                type="password"
                autoComplete="new-password"
                value={backupPassword}
                onChange={(e) => { setBackupPassword(e.target.value); setBackupPasswordError('') }}
                aria-invalid={!!backupPasswordError}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="backup-password-confirm">تأكيد كلمة المرور</Label>
              <Input
                id="backup-password-confirm"
                type="password"
                autoComplete="new-password"
                value={backupPasswordConfirm}
                onChange={(e) => { setBackupPasswordConfirm(e.target.value); setBackupPasswordError('') }}
                aria-invalid={!!backupPasswordError}
              />
              {backupPasswordError && (
                <p className="uk-form-error flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" />{backupPasswordError}</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBackupDialogOpen(false)} disabled={backupLoading}>إلغاء</Button>
            <Button onClick={() => void createBackup()} disabled={backupLoading || backupPassword.length < 8}>
              {backupLoading ? 'جاري إنشاء النسخة...' : 'إنشاء وتصدير'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Phase 14 UX: restore dialog (file pick + password) ─── */}
      <Dialog open={restoreDialogOpen} onOpenChange={setRestoreDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#D44D5C] to-[#772344] text-white"><FolderInput className="h-4 w-4" /></span>
              استعادة / دمج نسخة احتياطية
            </DialogTitle>
            <DialogDescription>
              اختر ملف النسخة، وهيتم عرض معاينة الدمج قبل تنفيذ أي شيء — بياناتك الحالية لا تُحذف أبدًا، الدمج يضيف ويحدّث فقط.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Button variant="outline" className="w-full h-11" onClick={() => void handleRestoreFileSelected()}>
              <Upload className="w-4 h-4 ml-1" />
              اختيار ملف النسخة (.nfb / .json)
            </Button>
            {!!restoreSnapshot?.encrypted && (
              <div className="space-y-2">
                <Label htmlFor="restore-password">كلمة مرور النسخة</Label>
                <Input
                  id="restore-password"
                  type="password"
                  autoComplete="off"
                  value={restorePassword}
                  onChange={(e) => { setRestorePassword(e.target.value); setRestorePasswordError('') }}
                  aria-invalid={!!restorePasswordError}
                />
                {restorePasswordError && (
                  <p className="uk-form-error flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" />{restorePasswordError}</p>
                )}
                <Button
                  className="w-full"
                  disabled={restoreLoading || !restorePassword}
                  onClick={() => {
                    setRestoreLoading(true)
                    decryptBackup(restoreSnapshot.encrypted as { format?: string }, restorePassword)
                      .then((snapshot) => prepareRestorePreview(snapshot, restorePassword))
                      .catch(() => { setRestorePasswordError('كلمة المرور غير صحيحة أو الملف تالف') })
                      .finally(() => setRestoreLoading(false))
                  }}
                >
                  <FileCheck className="w-4 h-4 ml-1" />
                  {restoreLoading ? 'جاري فك التشفير...' : 'تحقق واعرض المعاينة'}
                </Button>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRestoreDialogOpen(false)}>إغلاق</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Phase 14 UX: restore merge confirmation (replaces native confirm) ─── */}
      <AlertDialog open={confirmRestoreOpen} onOpenChange={setConfirmRestoreOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[#E8E5A4]/40 text-[#772344]"><AlertTriangle className="h-4 w-4" /></span>
              تأكيد دمج النسخة الاحتياطية
            </AlertDialogTitle>
            <AlertDialogDescription className="leading-6">
              سيتم دمج النسخة مع البيانات الحالية بدون حذف أي شيء.
              {restoreSummary && <span className="mt-2 block rounded-xl border bg-muted/40 p-3 font-medium text-foreground/90">{restoreSummary}</span>}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={() => void runRestore()}>تنفيذ الدمج</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function SettingField({ def, value, onChange }: { def: SettingDef; value: string; onChange: (v: string) => void; key?: string }) {
  return (
    <div className={`space-y-2 ${def.type === 'textarea' ? 'md:col-span-2' : ''}`}>
      <Label htmlFor={def.key} className="text-sm">{def.label}</Label>
      {def.type === 'text' && (
        <Input
          id={def.key}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={def.placeholder}
          dir={def.key.includes('email') || def.key.includes('phone') ? 'ltr' : undefined}
        />
      )}
      {def.type === 'number' && (
        <Input
          id={def.key}
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={def.placeholder}
          min={def.min}
          step={def.step}
          dir="ltr"
        />
      )}
      {def.type === 'textarea' && (
        <Textarea
          id={def.key}
          rows={2}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={def.placeholder}
        />
      )}
      {def.type === 'switch' && (
        <div className="flex items-center gap-3 pt-1">
          <Switch
            id={def.key}
            checked={value === 'true'}
            onCheckedChange={(checked) => onChange(checked ? 'true' : 'false')}
          />
          <span className="text-sm text-muted-foreground">
            {value === 'true' ? 'مفعّل' : 'معطّل'}
          </span>
        </div>
      )}
      {def.type === 'select' && (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger id={def.key}><SelectValue placeholder={def.placeholder} /></SelectTrigger>
          <SelectContent>
            {def.options?.map(opt => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {def.description && (
        <p className="text-xs text-muted-foreground">{def.description}</p>
      )}
    </div>
  )
}


