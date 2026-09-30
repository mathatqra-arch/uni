'use client'

import { logger } from '../../lib/logger'
import { Fragment, useEffect, useState, useMemo, useRef, useCallback } from 'react'
import { apiFetch, formatEGP, formatNumber } from '@/lib/api'
import { exportTextFile } from '@/lib/export-file'
import { useDebounce } from '@/hooks/use-debounce'
import { useAuthStore } from '@/lib/store'
import { generateUUID } from '@/lib/ids'
import { BarcodeDialog, BulkBarcodeDialog } from '@/components/pos/barcode-dialog'
import { Card, CardContent } from '@/components/ui/card'
import { DataTable } from '@/components/ui/data-table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select'
import {
  Plus, Search, Pencil, Trash2, Download, Upload, Package, Filter, Image as ImageIcon, X,
  Tag, Barcode,
} from 'lucide-react'
import { toast } from 'sonner'
import type { Product, Category, Supplier } from '@/lib/types'

type ProductRow = Product & { category?: { name?: string | null; nameAr?: string | null } | null; warehouse?: { name?: string | null } | null; deadStockDaysOverride?: number | null }
interface ProductImportRow { name: string; nameAr: string; sku: string; barcode: string; category: string; wholesalePrice: string; purchaseCost: string; sellingPrice: string; taxRate: string; stock: string }
import { notifyError } from '@/lib/notify'


interface ProductFormState {
  name: string
  nameAr: string
  sku: string
  barcode: string
  categoryId: string
  brandId: string
  unitId: string
  supplierId: string
  purchaseCost: string
  sellingPrice: string
  taxRate: string
  minStock: string
  reorderLevel: string
  deadStockDaysOverride: string
  openingStock: string
  image: string
  description: string
  active: boolean
}

const EMPTY_FORM: ProductFormState = {
  name: '', nameAr: '', sku: '', barcode: '',
  categoryId: '', brandId: '', unitId: '', supplierId: '',
  purchaseCost: '0', sellingPrice: '0', taxRate: '14',
  minStock: '0', reorderLevel: '5', deadStockDaysOverride: '', openingStock: '0',
  image: '', description: '', active: true,
}

// ─── DUPLICATE-PRODUCT MERGE ───
// When adding stock (manual "new product" form or CSV import) with a
// barcode/SKU that already belongs to an existing product, we used to just
// POST /products again — the server rejects a repeated SKU with a bare 409
// (silently counted as "fail" during import) and, worse, didn't check
// barcode at all, so a repeated barcode created a second product row and
// split that item's stock across two records. Instead: look the row up
// against the already-loaded product list first (barcode match takes
// priority since it's what a barcode scanner keys off), and if found, add
// the incoming quantity onto the EXISTING product's stock via
// /inventory/adjust rather than creating a duplicate.
function findDuplicateProduct(products: ProductRow[], candidate: { sku?: string; barcode?: string }): ProductRow | null {
  const barcode = (candidate.barcode || '').trim()
  const sku = (candidate.sku || '').trim()
  if (barcode) {
    const byBarcode = products.find((p) => p.barcode && p.barcode.trim() === barcode)
    if (byBarcode) return byBarcode
  }
  if (sku) {
    const bySku = products.find((p) => p.sku && p.sku.trim().toLowerCase() === sku.toLowerCase())
    if (bySku) return bySku
  }
  return null
}

async function mergeStockIntoProduct(
  existing: ProductRow,
  addQty: number,
  userId: string | undefined,
  note: string,
  // FIX: merging into an existing product (same barcode/SKU) used to ONLY
  // adjust stock via /inventory/adjust — any category chosen in the
  // "add product" form or set on the CSV row was silently thrown away,
  // because the merge path never called PUT /products/{id} at all. So
  // adding a product that happened to share a barcode with an existing one
  // (a very common flow — re-scanning stock, or a product created earlier
  // with no category) never actually linked it to the category the user
  // picked. Now any provided fields are applied to the existing product too.
  updates?: { categoryId?: string; sellingPrice?: number; wholesalePrice?: number; purchaseCost?: number; taxRate?: number; nameAr?: string }
) {
  if (addQty && addQty > 0) {
    const warehouseId = existing?.stockLevels?.[0]?.warehouseId
    const clientTxnId = generateUUID()
    await apiFetch('/inventory/adjust', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Client-Txn-Id': clientTxnId },
      body: JSON.stringify({
        productId: existing.id,
        warehouseId,
        newQuantity: (existing.currentStock ?? 0) + addQty,
        reason: 'CORRECTION',
        note,
        userId,
        clientTxnId,
      }),
    })
  }

  if (updates) {
    const patch: Record<string, unknown> = {}
    // Only patch categoryId when the merge actually specifies one — an
    // empty/blank category on the incoming row must never wipe out a
    // category the product already had.
    if (updates.categoryId && updates.categoryId !== existing.categoryId) {
      patch.categoryId = updates.categoryId
    }
    if (updates.nameAr && updates.nameAr !== existing.nameAr) {
      patch.nameAr = updates.nameAr
    }
    for (const [key, val] of Object.entries({
      sellingPrice: updates.sellingPrice,
      purchaseCost: updates.purchaseCost ?? updates.wholesalePrice,
      taxRate: updates.taxRate,
    })) {
      if (val !== undefined && val !== null && !isNaN(Number(val)) && Number(val) !== 0) {
        patch[key] = Number(val)
      }
    }
    if (Object.keys(patch).length > 0) {
      await apiFetch(`/products/${existing.id}`, {
        method: 'PUT',
        body: JSON.stringify(patch),
      })
    }
  }
}

export function ProductsModule() {
  const { user } = useAuthStore()
  const [products, setProducts] = useState<ProductRow[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [taxRates, setTaxRates] = useState<{ id: string; name: string; rate: number; isDefault?: boolean }[]>([])
  const [defaultTaxRate, setDefaultTaxRate] = useState('14')
  // Brands and Units tables exist in the schema but have no API endpoints
  // and no admin UI to manage them. Rather than show empty dropdowns that
  // confuse users, we omit these fields from the form entirely. They can
  // Brand/unit selectors remain intentionally disabled until their desktop CRUD exists.
  const [loading, setLoading] = useState(true)
  
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [activeFilter, setActiveFilter] = useState<string>('all')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<ProductRow | null>(null)
  const [form, setForm] = useState<ProductFormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [importPreview, setImportPreview] = useState<ProductImportRow[] | null>(null)
  const [barcodeProduct, setBarcodeProduct] = useState<ProductRow | null>(null)
  const [bulkBarcodeOpen, setBulkBarcodeOpen] = useState(false)
  const [quickPriceProduct, setQuickPriceProduct] = useState<ProductRow | null>(null)
  const [quickPriceValue, setQuickPriceValue] = useState('')
  const [quickPriceSaving, setQuickPriceSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const debouncedSearch = useDebounce(search, 350)
  const debouncedCategory = useDebounce(categoryFilter, 350)
  const debouncedActive = useDebounce(activeFilter, 350)

  const loadProducts = useCallback(async () => {
    setLoading(true)

    try {
      const params = new URLSearchParams()
      if (debouncedSearch) params.set('search', debouncedSearch)
      if (debouncedCategory !== 'all') params.set('categoryId', debouncedCategory)
      if (debouncedActive !== 'all') params.set('active', debouncedActive)
      params.set('limit', '500')
      const data = await apiFetch(`/products?${params.toString()}`)
      setProducts(data || [])
    } catch (e) {

      notifyError(e)
    } finally {
      setLoading(false)
    }
  }, [debouncedSearch, debouncedCategory, debouncedActive])

  const loadMeta = async () => {
    try {
      const [cats, sups, settingsData] = await Promise.all([
        apiFetch('/categories'),
        apiFetch('/suppliers'),
        apiFetch('/settings').catch(() => null),
      ])
      setCategories(cats || [])
      setSuppliers(sups || [])
      // Named tax rates managed in Settings → الضرائب (see settings.tsx).
      // Offered here as a dropdown so tax stays consistent with what's
      // configured there instead of a free-typed number every time.
      try {
        const raw = settingsData?.grouped?.tax?.['tax.rates']
        const rates = raw ? JSON.parse(raw) : []
        setTaxRates(rates)
        const def = rates.find((r) => r.isDefault)
        if (def) setDefaultTaxRate(String(def.rate))
      } catch {
        setTaxRates([])
      }
    } catch (e) {
      // non-fatal
      logger.warn(`meta load failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  useEffect(() => {
    loadProducts()
    loadMeta()
  }, [])

  // debounced search — fires when debouncedSearch/Category/Active change
  useEffect(() => {
    loadProducts()
  }, [loadProducts])

  const filtered = useMemo(() => products, [products])

  // Hierarchical categories: parent rows with nested subcategories
  const categoryHierarchy = useMemo(() => {
    const roots = categories.filter((c) => !c.parentId)
    return roots.map((root) => ({
      ...root,
      subcategories: categories.filter((c) => c.parentId === root.id),
    }))
  }, [categories])

  const openQuickPrice = (p: ProductRow) => {
    setQuickPriceProduct(p)
    setQuickPriceValue(String(p.sellingPrice ?? 0))
  }

  const saveQuickPrice = async () => {
    if (!quickPriceProduct) return
    const newPrice = parseFloat(quickPriceValue)
    if (isNaN(newPrice) || newPrice < 0) {
      toast.error('السعر غير صالح')
      return
    }
    setQuickPriceSaving(true)
    try {
      await apiFetch(`/products/${quickPriceProduct.id}`, {
        method: 'PUT',
        body: JSON.stringify({ sellingPrice: newPrice }),
      })
      toast.success('تم تحديث السعر')
      setQuickPriceProduct(null)
      loadProducts()
    } catch (e) {
      notifyError(e)
    } finally {
      setQuickPriceSaving(false)
    }
  }

  const openAdd = () => {
    setEditing(null)
    setForm({ ...EMPTY_FORM, taxRate: defaultTaxRate })
    setDialogOpen(true)
  }

  const openEdit = (p: ProductRow) => {
    setEditing(p)
    setForm({
      name: p.name || '',
      nameAr: p.nameAr || '',
      sku: p.sku || '',
      barcode: p.barcode || '',
      categoryId: p.categoryId || '',
      brandId: p.brandId || '',
      unitId: p.unitId || '',
      supplierId: p.supplierId || '',
      purchaseCost: String(p.purchaseCost ?? p.wholesalePrice ?? 0),
      sellingPrice: String(p.sellingPrice ?? 0),
      taxRate: String(p.taxRate ?? 0),
      minStock: String(p.minStock ?? 0),
      reorderLevel: String(p.reorderLevel ?? 0),
      deadStockDaysOverride: p.deadStockDaysOverride == null ? '' : String(p.deadStockDaysOverride),
      openingStock: '0',
      image: p.image || '',
      description: p.description || '',
      active: p.active ?? true,
    })
    setDialogOpen(true)
  }

  const handleSave = async () => {
    if (!form.name) {
      toast.error('اسم المنتج مطلوب')
      return
    }
    if (!form.categoryId) {
      toast.error('اختيار الفئة إجباري للمنتج')
      return
    }
    setSaving(true)
    try {
      const body: Record<string, unknown> = { ...form }
      body.deadStockDaysOverride = body.deadStockDaysOverride ? Math.max(1, Math.floor(Number(body.deadStockDaysOverride))) : null
      body.purchaseCost = Math.max(0, Number(body.purchaseCost || 0))
      body.wholesalePrice = body.purchaseCost
      if (!editing) body.sku = ''
      // Clean empty strings -> null for foreign keys
      ;['categoryId', 'brandId', 'unitId', 'supplierId'].forEach((k) => {
        if (!body[k]) body[k] = null
      })
      if (editing) {
        delete body.openingStock
        await apiFetch(`/products/${editing.id}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        })
        toast.success('تم تحديث المنتج')
      } else {
        // Duplicate check BEFORE creating — same barcode/SKU means this is
        // really "add stock to an existing product", not a new product.
        const duplicate = findDuplicateProduct(products, { sku: form.sku, barcode: form.barcode })
        if (duplicate) {
          const addQty = parseInt(form.openingStock) || 0
          await mergeStockIntoProduct(
            duplicate, addQty, user?.id,
            `دمج عند الإضافة — نفس ${duplicate.barcode && duplicate.barcode === form.barcode.trim() ? 'الباركود' : 'رمز SKU'}`,
            {
              categoryId: (body.categoryId as string) || undefined,
              nameAr: (body.nameAr as string) || undefined,
              sellingPrice: parseFloat(String(body.sellingPrice ?? 0)),
              wholesalePrice: parseFloat(String(body.wholesalePrice ?? 0)),
              purchaseCost: parseFloat(String(body.purchaseCost ?? 0)),
              taxRate: parseFloat(String(body.taxRate ?? 0)),
            }
          )
          toast.success(
            addQty > 0
              ? `المنتج "${duplicate.nameAr || duplicate.name}" موجود بالفعل — تم إضافة ${addQty} للمخزون بدل إنشاء منتج مكرر`
              : `المنتج "${duplicate.nameAr || duplicate.name}" موجود بالفعل — لم يتم إنشاء منتج مكرر`
          )
        } else {
          await apiFetch('/products', {
            method: 'POST',
            body: JSON.stringify(body),
          })
          toast.success('تم إنشاء المنتج بنجاح')
        }
      }
      setDialogOpen(false)
      loadProducts()
    } catch (e) {
      notifyError(e)
    } finally {
      setSaving(false)
    }
  }

  const handleArchive = async (p: ProductRow) => {
    if (!confirm(`هل أنت متأكد من أرشفة المنتج "${p.nameAr || p.name}"؟`)) return
    try {
      await apiFetch(`/products/${p.id}`, { method: 'DELETE' })
      toast.success('تم أرشفة المنتج')
      loadProducts()
    } catch (e) {
      notifyError(e)
    }
  }

  const exportCSV = async () => {
    const rows: ProductRow[] = filtered
    const headers = ['الاسم', 'الاسم عربي', 'SKU', 'الباركود', 'الفئة', 'سعر الشراء / الجملة', 'سعر البيع', 'الضريبة %', 'المخزون', 'الحد الأدنى', 'حد إعادة الطلب', 'الحالة']
    const lines = [headers.join(',')]
    rows.forEach((p) => {
      const stock = p.currentStock ?? 0
      const cat = p.category ? (p.category.nameAr || p.category.name) : ''
      const line = [
        `"${p.name || ''}"`,
        `"${p.nameAr || ''}"`,
        `"${p.sku || ''}"`,
        `"${p.barcode || ''}"`,
        `"${cat}"`,
        p.purchaseCost ?? p.wholesalePrice ?? 0,
        p.sellingPrice ?? 0,
        p.taxRate ?? 0,
        stock,
        p.minStock ?? 0,
        p.reorderLevel ?? 0,
        p.active ? 'نشط' : 'مؤرشف',
      ]
      lines.push(line.join(','))
    })
    const csv = lines.join('\n')
    await exportTextFile(`products-${new Date().toISOString().slice(0, 10)}.csv`, csv)
    toast.success(`تم تصدير ${rows.length} منتج`)
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
      // Skip header
      const parsed = lines.slice(1).map((line) => {
        // simple CSV parser handling quoted strings
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
        name: c[0] || '',
        nameAr: c[1] || '',
        sku: c[2] || '',
        barcode: c[3] || '',
        category: c[4] || '',
        purchaseCost: c[5] || c[7] || '0',
        sellingPrice: c[6] || '0',
        taxRate: c[8] || '0',
        stock: c[9] || '0',
      }))
      setImportPreview(parsed as ProductImportRow[])
      toast.success(`تم تحميل ${parsed.length} سجل`)
    } catch (err) {
      toast.error('Failed to import: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      // reset input so the same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const confirmImport = async () => {
    if (!importPreview) return
    let created = 0
    let merged = 0
    let fail = 0
    let categoriesCreated = 0
    // Track barcodes/SKUs created *within this same import batch* too —
    // otherwise two duplicate rows inside one CSV file would still both
    // get created as separate products (findDuplicateProduct alone only
    // sees products that existed before the import started).
    const seenThisBatch: ProductRow[] = []
    // FIX: the "الفئة" column was parsed from the file into row.category but
    // never actually sent to POST /products — every imported product landed
    // with no category at all regardless of what the CSV said. Resolve each
    // row's category name to a categoryId here (matching by English or
    // Arabic name, case-insensitive), creating a new root category on the
    // fly the first time an unrecognized name is seen so re-importing the
    // same file later reuses it instead of creating duplicates.
    const categoryByName = new Map<string, string>()
    for (const c of categories) {
      if (c.name) categoryByName.set(c.name.trim().toLowerCase(), c.id)
      if (c.nameAr) categoryByName.set(c.nameAr.trim().toLowerCase(), c.id)
    }
    const resolveCategoryId = async (rawName: string): Promise<string | undefined> => {
      const name = (rawName || '').trim()
      if (!name) return undefined
      const key = name.toLowerCase()
      const existing = categoryByName.get(key)
      if (existing) return existing
      try {
        const newCat = await apiFetch('/categories', {
          method: 'POST',
          body: JSON.stringify({ name }),
        })
        categoryByName.set(key, newCat.id)
        categoriesCreated++
        return newCat.id
      } catch {
        // Category creation failed (e.g. permission) — import the product
        // without a category rather than failing the whole row.
        return undefined
      }
    }

    for (const row of importPreview) {
      try {
        const duplicate = findDuplicateProduct([...products, ...seenThisBatch], { sku: row.sku, barcode: row.barcode })
        if (duplicate) {
          const addQty = parseInt(row.stock) || 0
          const categoryId = await resolveCategoryId(row.category)
          await mergeStockIntoProduct(
            duplicate, addQty, user?.id, 'دمج عند الاستيراد من ملف — نفس الباركود/SKU',
            {
              categoryId,
              nameAr: row.nameAr || undefined,
              sellingPrice: parseFloat(row.sellingPrice),
              purchaseCost: parseFloat(row.purchaseCost),
              wholesalePrice: parseFloat(row.purchaseCost),
              taxRate: parseFloat(row.taxRate),
            }
          )
          merged++
          continue
        }
        const categoryId = await resolveCategoryId(row.category)
        const newProduct = await apiFetch('/products', {
          method: 'POST',
          body: JSON.stringify({
            name: row.name,
            nameAr: row.nameAr,
            sku: row.sku || `SKU-${Date.now()}-${created}`,
            barcode: row.barcode || undefined,
            categoryId,
            purchaseCost: row.purchaseCost,
            sellingPrice: row.sellingPrice,
            wholesalePrice: row.wholesalePrice,
            taxRate: row.taxRate,
            openingStock: row.stock,
            active: true,
          }),
        })
        seenThisBatch.push({ ...(newProduct as ProductRow), currentStock: parseInt(row.stock) || 0 })
        created++
      } catch {
        fail++
      }
    }
    const parts = [`تم إنشاء ${created} منتج`]
    if (merged) parts.push(`ودمج ${merged} منتج مكرر بإضافة الكمية لمخزونه الحالي`)
    if (categoriesCreated) parts.push(`وإنشاء ${categoriesCreated} فئة جديدة من الملف`)
    if (fail) parts.push(`وفشل ${fail}`)
    toast.success(parts.join('، '))
    setImportPreview(null)
    loadProducts()
    if (categoriesCreated) loadMeta()
  }

  // Stats
  const stats = useMemo(() => {
    const total = filtered.length
    const active = filtered.filter((p) => p.active).length
    const lowStock = filtered.filter((p) => {
      const s = p.currentStock ?? 0
      return s <= (p.reorderLevel ?? 0) && s > 0
    }).length
    const outOfStock = filtered.filter((p) => (p.currentStock ?? 0) <= 0).length
    return { total, active, lowStock, outOfStock }
  }, [filtered])

  return (
    <div className="module-page p-4 md:p-6 pb-6 space-y-6 max-w-[1600px] mx-auto h-full min-h-0 flex flex-col">
      {/* Header */}
      <div className="uk-page-header flex flex-col md:flex-row md:items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Package className="w-6 h-6 text-primary" />
            المنتجات
          </h1>
          <p className="text-muted-foreground text-sm max-w-2xl leading-6">إدارة المنتجات والأسعار والمخزون</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={handleImportFile}
          />
          <Button variant="outline" size="sm" onClick={handleImportClick}>
            <Upload className="w-4 h-4" />
            استيراد CSV
          </Button>
          <Button variant="outline" size="sm" onClick={exportCSV}>
            <Download className="w-4 h-4" />
            تصدير CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setBulkBarcodeOpen(true)}
            disabled={filtered.length === 0}
            title="طباعة باركود جميع المنتجات المعروضة"
          >
            <Barcode className="w-4 h-4" />
            طباعة باركود
          </Button>
          <Button onClick={openAdd} size="sm">
            <Plus className="w-4 h-4" />
            إضافة منتج
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="ux-filter-card border-border/60 shadow-sm">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">إجمالي المنتجات</p>
            <p className="text-xl font-bold mt-1">{formatNumber(stats.total)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">نشط</p>
            <p className="text-xl font-bold mt-1 text-green-600">{formatNumber(stats.active)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">مخزون منخفض</p>
            <p className="text-xl font-bold mt-1 text-orange-600">{formatNumber(stats.lowStock)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">نفد المخزون</p>
            <p className="text-xl font-bold mt-1 text-red-600">{formatNumber(stats.outOfStock)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="بحث بالاسم أو SKU أو الباركود..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pr-10"
              />
            </div>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-full md:w-64">
                <Filter className="w-4 h-4 ml-1 text-muted-foreground" />
                <SelectValue placeholder="كل الفئات" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الفئات</SelectItem>
                {categoryHierarchy.map((parent) => (
                  <Fragment key={parent.id}>
                    <SelectItem value={parent.id}>
                      {parent.nameAr || parent.name}
                    </SelectItem>
                    {parent.subcategories.map((child) => (
                      <SelectItem key={child.id} value={child.id}>
                        — {child.nameAr || child.name}
                      </SelectItem>
                    ))}
                  </Fragment>
                ))}
              </SelectContent>
            </Select>
            <Select value={activeFilter} onValueChange={setActiveFilter}>
              <SelectTrigger className="w-full md:w-44">
                <SelectValue placeholder="الكل" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                <SelectItem value="true">نشط</SelectItem>
                <SelectItem value="false">مؤرشف</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Loading / Error / Empty / Table */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-14" />)}
        </div>
      ) : (
        <>
<DataTable
                  loading={loading}
                  emptyMessage="لا توجد منتجات — أضف أول منتج من الزر أعلى الصفحة"
                  fillHeight={true}
                  reserveHeight={360}
                  minHeight="480px"
                  minWidth="min-w-[980px]"
columns={[
                  { key: 'image', header: 'الصورة', width: 'w-14', render: (p) => (
                    p.image
                      ? <img src={p.image} alt="" className="w-10 h-10 rounded object-cover border" />
                      : <div className="w-10 h-10 rounded bg-muted flex items-center justify-center"><ImageIcon className="w-4 h-4 text-muted-foreground" /></div>
                  ) },
                  { key: 'name', header: 'الاسم', render: (p) => (
                    <div>
                      <div>{p.nameAr || p.name}</div>
                      {p.nameAr && p.name && <div className="text-xs text-muted-foreground">{p.name}</div>}
                    </div>
                  ) },
                  { key: 'barcode', header: 'الباركود', render: (p) => p.barcode || '—' },
                  { key: 'sku', header: 'SKU', render: (p) => p.sku },
                  { key: 'category', header: 'الفئة', render: (p) => (
                    p.category
                      ? <Badge variant="outline">{p.category.nameAr || p.category.name}</Badge>
                      : <span className="text-muted-foreground">—</span>
                  ) },
                  { key: 'sellingPrice', header: 'سعر البيع', align: 'left', render: (p) => formatEGP(p.sellingPrice) },
                  { key: 'purchaseCost', header: 'سعر الشراء / الجملة', align: 'left', render: (p) => formatEGP(p.purchaseCost ?? p.wholesalePrice ?? 0) },
                  { key: 'stock', header: 'المخزون', align: 'center', render: (p) => { const stock = p.currentStock ?? 0; return formatNumber(stock) } },
                  { key: 'active', header: 'الحالة', align: 'center', render: (p) => (
                    p.active
                      ? <Badge className="bg-green-500/10 text-green-700 border-green-500/20">نشط</Badge>
                      : <Badge className="bg-gray-500/10 text-gray-700 border-gray-500/20">مؤرشف</Badge>
                  ) },
                  { key: 'actions', header: 'إجراءات', align: 'center', render: (p) => (
                    <div className="flex items-center justify-center gap-1">
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openQuickPrice(p)} title="تغيير السعر" aria-label={`تغيير سعر ${p.nameAr || p.name}`}><Tag className="w-4 h-4 text-primary" /></Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setBarcodeProduct(p)} title="طباعة الباركود" aria-label={`طباعة باركود ${p.nameAr || p.name}`}><Barcode className="w-4 h-4" /></Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(p)} title="تعديل" aria-label={`تعديل المنتج ${p.nameAr || p.name}`}><Pencil className="w-4 h-4" /></Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-red-600 hover:text-red-700" onClick={() => handleArchive(p)} title="حذف" aria-label={`حذف المنتج ${p.nameAr || p.name}`}><Trash2 className="w-4 h-4" /></Button>
                    </div>
                  ) },
                ]}
                  rows={filtered}
                />

          {/* Mobile cards */}
          <div className="md:hidden divide-y">
            {filtered.map((p) => {
              const stock = p.currentStock ?? 0
              const stockColor = stock <= 0 ? 'text-red-600' : stock <= (p.reorderLevel ?? 0) ? 'text-orange-600' : 'text-green-600'
              return (
                <div key={p.id} className="p-4 flex gap-3 md:hidden">
                  {p.image ? (
                    <img src={p.image} alt="" className="w-14 h-14 rounded object-cover border shrink-0" />
                  ) : (
                    <div className="w-14 h-14 rounded bg-muted flex items-center justify-center shrink-0">
                      <ImageIcon className="w-5 h-5 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium truncate">{p.nameAr || p.name}</p>
                      <Badge variant="outline" className="shrink-0">{formatEGP(p.sellingPrice)}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground font-mono mt-0.5">{p.sku}{p.barcode ? ` · ${p.barcode}` : ''}</p>
                    <div className="flex items-center gap-3 mt-2 text-xs">
                      <span>المخزون: <span className={`font-bold ${stockColor}`}>{formatNumber(stock)}</span></span>
                      {p.category && <span className="text-muted-foreground">{p.category.nameAr || p.category.name}</span>}
                    </div>
                    <div className="flex flex-wrap gap-2 mt-2">
                      <Button className="ux-action-btn" size="sm" variant="outline" onClick={() => openEdit(p)}>
                        <Pencil className="w-3.5 h-3.5" />
                        تعديل
                      </Button>
                      <Button className="ux-action-btn" size="sm" variant="outline" onClick={() => openQuickPrice(p)}>
                        <Tag className="w-3.5 h-3.5 text-primary" />
                        تغيير السعر
                      </Button>
                      <Button size="sm" variant="ghost" className="text-red-600" onClick={() => handleArchive(p)}>
                        <Trash2 className="w-3.5 h-3.5" />
                        أرشفة
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'تعديل المنتج' : 'إضافة منتج جديد'}</DialogTitle>
            <DialogDescription>
              {editing ? `تعديل بيانات: ${editing.nameAr || editing.name}` : 'أدخل بيانات المنتج الجديد'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Basic info */}
            <div className="space-y-1.5">
              <Label>الاسم (إنجليزي) *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Product Name" />
            </div>
            <div className="space-y-1.5">
              <Label>الاسم (عربي)</Label>
              <Input value={form.nameAr} onChange={(e) => setForm({ ...form, nameAr: e.target.value })} placeholder="اسم المنتج" />
            </div>
            <div className="space-y-1.5">
              <Label>SKU</Label>
              <Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="يُولد تلقائيًا من الفئة" readOnly={!editing} />
              {!editing && <p className="text-[11px] text-muted-foreground">سيتم توليده تلقائيًا بعد اختيار الفئة.</p>}
            </div>
            <div className="space-y-1.5">
              <Label>الباركود</Label>
              <Input value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} placeholder="622..." />
            </div>

            <div className="space-y-1.5">
              <Label>الفئة *</Label>
              <Select value={form.categoryId} onValueChange={(v) => setForm({ ...form, categoryId: v })}>
                <SelectTrigger className="w-full"><SelectValue placeholder="اختر الفئة" /></SelectTrigger>
                <SelectContent>
                  {categoryHierarchy.map((parent) => (
                    <Fragment key={parent.id}>
                      <SelectItem value={parent.id}>{parent.nameAr || parent.name}</SelectItem>
                      {parent.subcategories.map((child) => (
                        <SelectItem key={child.id} value={child.id}>
                          — {child.nameAr || child.name}
                        </SelectItem>
                      ))}
                    </Fragment>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>المورد</Label>
              <Select value={form.supplierId} onValueChange={(v) => setForm({ ...form, supplierId: v })}>
                <SelectTrigger className="w-full"><SelectValue placeholder="اختر المورد" /></SelectTrigger>
                <SelectContent>
                  {suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* Brand + Unit fields removed — no API endpoints or admin UI exist for them.
                Enable when desktop brand/unit CRUD is implemented. */}
          </div>

          <Separator />

          {/* Pricing */}
          <div>
            <p className="text-sm font-semibold mb-3">التسعير</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">سعر الشراء / الجملة</Label>
                <Input type="number" min="0" step="0.01" value={form.purchaseCost} onChange={(e) => setForm({ ...form, purchaseCost: e.target.value })} />
                <p className="text-[11px] text-muted-foreground">قيمة واحدة تمثل تكلفة التوريد وسعر الجملة في نسخة المنتجات، مع استمرار حفظ الحقلين داخليًا للتوافق.</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">سعر البيع</Label>
                <Input type="number" min="0" step="0.01" value={form.sellingPrice} onChange={(e) => setForm({ ...form, sellingPrice: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">الضريبة %</Label>
                {taxRates.length > 0 ? (
                  <Select
                    value={taxRates.find(t => String(t.rate) === form.taxRate)?.id || 'custom'}
                    onValueChange={(v) => {
                      const t = taxRates.find(r => r.id === v)
                      if (t) setForm({ ...form, taxRate: String(t.rate) })
                    }}
                  >
                    <SelectTrigger><SelectValue placeholder="اختر نسبة الضريبة" /></SelectTrigger>
                    <SelectContent>
                      {taxRates.map(t => (
                        <SelectItem key={t.id} value={t.id}>{t.name} ({t.rate}%)</SelectItem>
                      ))}
                      <SelectItem value="custom" disabled>أو أدخل نسبة مخصصة تحت</SelectItem>
                    </SelectContent>
                  </Select>
                ) : null}
                <Input
                  type="number" step="0.01" value={form.taxRate}
                  onChange={(e) => setForm({ ...form, taxRate: e.target.value })}
                  placeholder={taxRates.length > 0 ? 'نسبة مخصصة (اختياري)' : undefined}
                  className={taxRates.length > 0 ? 'mt-1' : undefined}
                />
              </div>
            </div>
          </div>

          <Separator />

          {/* Inventory */}
          <div>
            <p className="text-sm font-semibold mb-3">المخزون</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">الحد الأدنى</Label>
                <Input type="number" min="0" value={form.minStock} onChange={(e) => setForm({ ...form, minStock: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">حد إعادة الطلب</Label>
                <Input type="number" min="0" value={form.reorderLevel} onChange={(e) => setForm({ ...form, reorderLevel: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">ركود هذا المنتج (يوم)</Label>
                <Input type="number" min="1" step="1" value={form.deadStockDaysOverride} onChange={(e) => setForm({ ...form, deadStockDaysOverride: e.target.value })} placeholder="افتراضي المتجر" />
                <p className="text-[11px] text-muted-foreground">اتركه فارغًا لاستخدام إعداد الفئة الفرعية، ثم الفئة الرئيسية، ثم الإعداد العام.</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{editing ? 'المخزون الافتتاحي' : 'المخزون الافتتاحي *'}</Label>
                <Input
                  type="number"
                  min="0"
                  value={form.openingStock}
                  onChange={(e) => setForm({ ...form, openingStock: e.target.value })}
                  disabled={!!editing}
                  placeholder={editing ? 'استخدم تسوية المخزون' : '0'}
                />
              </div>
            </div>
          </div>

          <Separator />

          {/* Other */}
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>رابط الصورة</Label>
              <Input value={form.image} onChange={(e) => setForm({ ...form, image: e.target.value })} placeholder="https://..." />
            </div>
            <div className="space-y-1.5">
              <Label>الوصف</Label>
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} placeholder="وصف المنتج..." />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label htmlFor="active-switch" className="cursor-pointer">المنتج نشط</Label>
                <p className="text-xs text-muted-foreground">المنتجات المؤرشفة لا تظهر في نقطة البيع</p>
              </div>
              <Switch id="active-switch" checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>إلغاء</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'جاري الحفظ...' : editing ? 'حفظ التعديلات' : 'إضافة المنتج'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Preview Dialog */}
      <Dialog open={!!importPreview} onOpenChange={(o) => !o && setImportPreview(null)}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>معاينة الاستيراد</DialogTitle>
            <DialogDescription>
              تم تحليل {importPreview?.length || 0} سجل. سيتم إنشاء منتجات جديدة.
            </DialogDescription>
          </DialogHeader>
          <DataTable
            maxHeight="480px"
            className="ux-data-table"
            columns={[
              { key: 'c0', header: 'الاسم', render: (r) => r.nameAr || r.name || `—` },
              { key: 'c1', header: 'SKU', cellClassName: "font-mono text-xs", render: (r) => r.sku || '—' },
              { key: 'c2', header: 'الباركود', cellClassName: "text-xs", render: (r) => r.barcode || '—' },
              { key: 'c3', header: 'الفئة', cellClassName: "text-xs", render: (r) => r.category || '—' },
              { key: 'c4', header: 'السعر', align: 'left', cellClassName: "pos-number", render: (r) => formatEGP(parseFloat(r.sellingPrice) || 0) },
              { key: 'c5', header: 'المخزون', align: 'center', render: (r) => r.stock },
            ]}
            rows={importPreview ?? []}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportPreview(null)}>
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

      {/* Barcode dialogs */}
      <BarcodeDialog
        open={!!barcodeProduct}
        onOpenChange={(o) => !o && setBarcodeProduct(null)}
        product={barcodeProduct}
      />
      <BulkBarcodeDialog
        open={bulkBarcodeOpen}
        onOpenChange={setBulkBarcodeOpen}
        products={filtered}
      />

      {/* Quick Price Edit Dialog */}
      <Dialog open={!!quickPriceProduct} onOpenChange={(o) => !o && setQuickPriceProduct(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Tag className="w-5 h-5 text-primary" />
              تغيير السعر السريع
            </DialogTitle>
            <DialogDescription>
              {quickPriceProduct?.nameAr || quickPriceProduct?.name}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-md border p-3 bg-muted/30">
              <span className="text-sm text-muted-foreground">السعر الحالي</span>
              <span className="font-bold pos-number">{formatEGP(quickPriceProduct?.sellingPrice ?? 0)}</span>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="quick-price">السعر الجديد</Label>
              <Input
                id="quick-price"
                type="number"
                step="0.01"
                min="0"
                autoFocus
                value={quickPriceValue}
                onChange={(e) => setQuickPriceValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveQuickPrice()
                }}
              />
            </div>
            {quickPriceProduct && !isNaN(parseFloat(quickPriceValue)) && (
              <p className="text-xs text-muted-foreground text-center">
                الفرق:{' '}
                <span className={`font-bold pos-number ${parseFloat(quickPriceValue) >= (quickPriceProduct.sellingPrice ?? 0) ? 'text-green-600' : 'text-red-600'}`}>
                  {formatEGP(parseFloat(quickPriceValue) - (quickPriceProduct.sellingPrice ?? 0))}
                </span>
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setQuickPriceProduct(null)}>
              إلغاء
            </Button>
            <Button onClick={saveQuickPrice} disabled={quickPriceSaving}>
              {quickPriceSaving ? 'جاري الحفظ...' : 'حفظ السعر'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
