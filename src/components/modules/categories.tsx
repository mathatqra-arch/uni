'use client'

import { Fragment, useEffect, useState, useMemo, useRef } from 'react'
import { cn } from '@/lib/utils'
import { apiFetch, formatNumber, formatEGP } from '@/lib/api'
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
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@/components/ui/table'
import { DataTable } from '@/components/ui/data-table'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select'
import {
  Plus, Pencil, Trash2, Folder, FolderOpen, ChevronDown, ChevronRight, ChevronLeft,
  Palette, Tag, AlertTriangle, Search, Package, Upload, Download, DollarSign, PackagePlus,
} from 'lucide-react'
import { toast } from 'sonner'
import type { Category, Product } from '@/lib/types'

interface CategoryRow extends Omit<Category, 'children'> {
  subcategories: CategoryRow[]
  skuCode?: string
  deadStockDaysOverride?: number | null
  productCount?: number
  children?: unknown[]
  products?: unknown[]
}

interface CategoryImportRow { name: string; nameAr: string; parentName: string; color: string; icon: string }
import { notifyError, extractErrorMessage } from '@/lib/notify'

interface CategoryFormState {
  name: string
  nameAr: string
  color: string
  icon: string
  parentId: string
  deadStockDaysOverride: string
}

const EMPTY_FORM: CategoryFormState = {
  name: '', nameAr: '', color: '', icon: '', parentId: '', deadStockDaysOverride: '',
}

// Preset color palette for beauty/cosmetics theme
const PRESET_COLORS = [
  { name: 'كريمي', value: '#F5EFE2' },
  { name: 'أصفر هادئ', value: '#E8E5A4' },
  { name: 'مرجاني', value: '#D44D5C' },
  { name: 'عنابي', value: '#772344' },
  { name: 'برقوقي', value: '#160029' },
  { name: 'وردي ناعم', value: '#D98592' },
  { name: 'لافندر', value: '#A88BAF' },
  { name: 'أخضر هادئ', value: '#7E9B7A' },
]

export function CategoriesModule() {
  const [categories, setCategories] = useState<CategoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [collapsedParents, setCollapsedParents] = useState<Set<string>>(new Set())
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<CategoryRow | null>(null)
  const [form, setForm] = useState<CategoryFormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<CategoryRow | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deletePreview, setDeletePreview] = useState<CategoryRow & { children?: unknown[]; products?: unknown[] } | null>(null)

  // ─── CSV IMPORT/EXPORT (same pattern as products.tsx) ───
  const [importPreview, setImportPreview] = useState<CategoryImportRow[] | null>(null)
  const [importing, setImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ─── BULK PRICE CHANGE — "زوّد سعر الفئة كلها 10%" ───
  const [bulkPriceTarget, setBulkPriceTarget] = useState<CategoryRow | null>(null)
  const [bulkPriceMode, setBulkPriceMode] = useState<'PERCENT' | 'FIXED'>('PERCENT')
  const [bulkPriceValue, setBulkPriceValue] = useState('10')
  const [bulkPriceField, setBulkPriceField] = useState<'sellingPrice' | 'wholesalePrice' | 'both'>('sellingPrice')
  const [bulkPriceIncludeSubs, setBulkPriceIncludeSubs] = useState(true)
  const [bulkPriceSaving, setBulkPriceSaving] = useState(false)

  // ─── MANAGE PRODUCTS IN CATEGORY — bulk-assign products ───
  const [manageProductsTarget, setManageProductsTarget] = useState<CategoryRow | null>(null)
  const [categoryProducts, setCategoryProducts] = useState<Product[]>([])
  const [loadingCategoryProducts, setLoadingCategoryProducts] = useState(false)
  const [productSearch, setProductSearch] = useState('')
  const debouncedProductSearch = useDebounce(productSearch, 350)
  const [searchResults, setSearchResults] = useState<Product[]>([])
  const [searchingProducts, setSearchingProducts] = useState(false)
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set())
  const [assigningProducts, setAssigningProducts] = useState(false)

  const loadCategories = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await apiFetch('/categories')
      setCategories(data || [])
    } catch (e) {
      setError(extractErrorMessage(e))
      notifyError(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadCategories()
  }, [])

  // Build hierarchical structure
  const hierarchy = useMemo(() => {
    const roots = categories.filter((c) => !c.parentId)
    return roots.map((root) => {
      const subcategories = categories.filter((c) => c.parentId === root.id)
      // Parent's displayed product count must include products assigned to its
      // subcategories, not just products assigned directly to the parent itself —
      // otherwise parents with only sub-categorized products always show 0.
      const subsProductCount = subcategories.reduce((sum, s) => sum + (s.productCount || 0), 0)
      return {
        ...root,
        subcategories,
        productCount: (root.productCount || 0) + subsProductCount,
      }
    })
  }, [categories])

  // Filter by search
  const filteredHierarchy = useMemo(() => {
    if (!search.trim()) return hierarchy
    const q = search.trim().toLowerCase()
    const matches = (c: CategoryRow) =>
      (c.name || '').toLowerCase().includes(q) ||
      (c.nameAr || '').toLowerCase().includes(q)
    return hierarchy
      .map((root) => {
        const rootMatches = matches(root)
        const matchedSubs = (root.subcategories || []).filter((s: CategoryRow) => matches(s))
        if (rootMatches || matchedSubs.length > 0) {
          return { ...root, subcategories: rootMatches ? root.subcategories : matchedSubs }
        }
        return null
      })
      .filter(Boolean) as CategoryRow[]
  }, [hierarchy, search])

  const toggleCollapse = (id: string) => {
    setCollapsedParents((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const stats = useMemo(() => {
    const totalRoots = categories.filter((c) => !c.parentId).length
    const totalSubs = categories.filter((c) => !!c.parentId).length
    const totalProducts = categories.reduce((sum, c) => sum + (c.productCount || 0), 0)
    return { totalRoots, totalSubs, total: categories.length, totalProducts }
  }, [categories])

  // Root categories only (for parent select in form) — excludes self and descendants when editing
  const availableParents = useMemo(() => {
    if (!editing) return categories.filter((c) => !c.parentId)
    // Exclude self when editing
    return categories.filter((c) => !c.parentId && c.id !== editing.id)
  }, [categories, editing])

  const openAdd = (presetParentId?: string) => {
    setEditing(null)
    setForm({ ...EMPTY_FORM, parentId: presetParentId || '' })
    setDialogOpen(true)
  }

  const openAddSub = (parent: CategoryRow) => {
    setEditing(null)
    setForm({ ...EMPTY_FORM, parentId: parent.id })
    setDialogOpen(true)
  }

  const openEdit = (c: CategoryRow) => {
    setEditing(c)
    setForm({
      name: c.name || '',
      nameAr: c.nameAr || '',
      color: c.color || '',
      icon: c.icon || '',
      parentId: c.parentId || '',
      deadStockDaysOverride: c.deadStockDaysOverride == null ? '' : String(c.deadStockDaysOverride),
    })
    setDialogOpen(true)
  }

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error('اسم الفئة مطلوب')
      return
    }
    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        nameAr: form.nameAr.trim() || null,
        parentId: form.parentId === 'none' || !form.parentId ? null : form.parentId,
        color: form.color || null,
        icon: form.icon.trim() || null,
        deadStockDaysOverride: form.deadStockDaysOverride ? Math.max(1, Math.min(3650, Math.floor(Number(form.deadStockDaysOverride)))) : null,
      }
      if (editing) {
        await apiFetch(`/categories/${editing.id}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        })
        toast.success('تم تحديث الفئة')
      } else {
        await apiFetch('/categories', {
          method: 'POST',
          body: JSON.stringify(body),
        })
        toast.success('تم إنشاء الفئة بنجاح')
      }
      setDialogOpen(false)
      loadCategories()
    } catch (e) {
      notifyError(e)
    } finally {
      setSaving(false)
    }
  }

  const openDelete = async (c: CategoryRow) => {
    setDeleteTarget(c)
    setDeletePreview(null)
    setDeleting(true)
    try {
      // Fetch fresh details to confirm product/child counts server-side
      const detail = await apiFetch(`/categories/${c.id}`) as CategoryRow
      setDeletePreview(detail)
    } catch {
      // fall back to whatever we already have
      setDeletePreview(c)
    } finally {
      setDeleting(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await apiFetch(`/categories/${deleteTarget.id}`, { method: 'DELETE' })
      toast.success('تم حذف الفئة بنجاح')
      setDeleteTarget(null)
      setDeletePreview(null)
      loadCategories()
    } catch (e) {
      notifyError(e)
    } finally {
      setDeleting(false)
    }
  }

  const renderColorDot = (color?: string | null, size = 'w-3 h-3') => {
    if (!color) {
      return <span className={`${size} rounded-full bg-muted border`} />
    }
    return (
      <span
        className={`${size} rounded-full inline-block border border-black/10`}
        style={{ backgroundColor: color }}
      />
    )
  }

  // ─── CSV EXPORT — mirrors products.tsx exportCSV so files round-trip ───
  const exportCSV = async () => {
    const headers = ['الاسم', 'الاسم عربي', 'الفئة الأب', 'اللون', 'الأيقونة']
    const lines = [headers.join(',')]
    categories.forEach((c) => {
      const parentName = c.parentId ? (categories.find((p) => p.id === c.parentId)?.name || '') : ''
      const line = [
        `"${c.name || ''}"`,
        `"${c.nameAr || ''}"`,
        `"${parentName}"`,
        `"${c.color || ''}"`,
        `"${c.icon || ''}"`,
      ]
      lines.push(line.join(','))
    })
    const csv = lines.join('\n')
    await exportTextFile(`categories-${new Date().toISOString().slice(0, 10)}.csv`, csv)
    toast.success(`تم تصدير ${categories.length} فئة`)
  }

  // ─── CSV IMPORT — same simple-quoted-CSV parser as products.tsx ───
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
        name: c[0] || '',
        nameAr: c[1] || '',
        parentName: c[2] || '',
        color: c[3] || '',
        icon: c[4] || '',
      })).filter((r) => r.name.trim())
      setImportPreview(parsed)
      toast.success(`تم تحميل ${parsed.length} سجل`)
    } catch (err) {
      toast.error('Failed to import: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const confirmCategoryImport = async () => {
    if (!importPreview) return
    setImporting(true)
    let created = 0
    let updated = 0
    let fail = 0
    // Resolve/create root (parent) categories first so subcategory rows in
    // the same file can reference a parent that didn't exist a moment ago —
    // rows are otherwise processed top-to-bottom as they appear in the file.
    const byName = new Map<string, CategoryRow>()
    for (const c of categories) {
      if (c.name) byName.set(c.name.trim().toLowerCase(), c)
      if (c.nameAr) byName.set(c.nameAr.trim().toLowerCase(), c)
    }
    for (const row of importPreview) {
      try {
        let parentId: string | null = null
        const parentName = row.parentName.trim()
        if (parentName) {
          const parent = byName.get(parentName.toLowerCase())
          if (parent) {
            parentId = parent.id
          } else {
            // Referenced parent doesn't exist yet — create it as a root
            // category first, same as products.tsx does for missing
            // category names during product import.
            const newParent = await apiFetch('/categories', {
              method: 'POST',
              body: JSON.stringify({ name: parentName }),
            })
            byName.set(parentName.toLowerCase(), newParent)
            parentId = newParent.id
            created++
          }
        }

        const existing = byName.get(row.name.trim().toLowerCase()) || (row.nameAr && byName.get(row.nameAr.trim().toLowerCase()))
        if (existing) {
          await apiFetch(`/categories/${existing.id}`, {
            method: 'PUT',
            body: JSON.stringify({
              name: row.name || existing.name,
              nameAr: row.nameAr || existing.nameAr,
              parentId,
              color: row.color || existing.color,
              icon: row.icon || existing.icon,
            }),
          })
          updated++
        } else {
          const newCat = await apiFetch('/categories', {
            method: 'POST',
            body: JSON.stringify({
              name: row.name,
              nameAr: row.nameAr || null,
              parentId,
              color: row.color || null,
              icon: row.icon || null,
            }),
          })
          byName.set(row.name.trim().toLowerCase(), newCat)
          if (row.nameAr) byName.set(row.nameAr.trim().toLowerCase(), newCat)
          created++
        }
      } catch {
        fail++
      }
    }
    const parts = [`تم إنشاء ${created} فئة`]
    if (updated) parts.push(`وتحديث ${updated} فئة موجودة`)
    if (fail) parts.push(`وفشل ${fail}`)
    toast.success(parts.join('، '))
    setImportPreview(null)
    setImporting(false)
    loadCategories()
  }

  // ─── BULK PRICE CHANGE ───
  const openBulkPrice = (c: CategoryRow) => {
    setBulkPriceTarget(c)
    setBulkPriceMode('PERCENT')
    setBulkPriceValue('10')
    setBulkPriceField('sellingPrice')
    setBulkPriceIncludeSubs(true)
  }

  const confirmBulkPrice = async () => {
    if (!bulkPriceTarget) return
    const value = parseFloat(bulkPriceValue)
    if (isNaN(value)) {
      toast.error('القيمة غير صالحة')
      return
    }
    setBulkPriceSaving(true)
    try {
      const result = await apiFetch(`/categories/${bulkPriceTarget.id}/bulk-price`, {
        method: 'POST',
        body: JSON.stringify({
          mode: bulkPriceMode,
          value,
          field: bulkPriceField,
          includeSubcategories: bulkPriceIncludeSubs,
        }),
      })
      toast.success(result?.message || 'تم تحديث الأسعار')
      setBulkPriceTarget(null)
      loadCategories()
    } catch (e) {
      notifyError(e)
    } finally {
      setBulkPriceSaving(false)
    }
  }

  // ─── MANAGE PRODUCTS IN CATEGORY ───
  const openManageProducts = async (c: CategoryRow) => {
    setManageProductsTarget(c)
    setProductSearch('')
    setSearchResults([])
    setSelectedProductIds(new Set())
    setLoadingCategoryProducts(true)
    try {
      const detail = await apiFetch(`/categories/${c.id}`) as CategoryRow
      setCategoryProducts((detail?.products as Product[] | undefined) || [])
    } catch (e) {
      notifyError(e)
      setCategoryProducts([])
    } finally {
      setLoadingCategoryProducts(false)
    }
  }

  useEffect(() => {
    if (!manageProductsTarget || !debouncedProductSearch.trim()) {
      setSearchResults([])
      return
    }
    let cancelled = false
    setSearchingProducts(true)
    apiFetch(`/products?search=${encodeURIComponent(debouncedProductSearch.trim())}&limit=25`)
      .then((data) => {
        if (cancelled) return
        const inCategoryIds = new Set(categoryProducts.map((p) => p.id))
        setSearchResults((data || []).filter((p) => !inCategoryIds.has(p.id)))
      })
      .catch(() => { if (!cancelled) setSearchResults([]) })
      .finally(() => { if (!cancelled) setSearchingProducts(false) })
    return () => { cancelled = true }
  }, [debouncedProductSearch, manageProductsTarget, categoryProducts])

  const toggleSelectedProduct = (id: string) => {
    setSelectedProductIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const confirmAssignProducts = async () => {
    if (!manageProductsTarget || selectedProductIds.size === 0) return
    setAssigningProducts(true)
    try {
      const result = await apiFetch(`/categories/${manageProductsTarget.id}/assign-products`, {
        method: 'POST',
        body: JSON.stringify({ productIds: Array.from(selectedProductIds) }),
      })
      toast.success(result?.message || 'تم نقل المنتجات')
      setSelectedProductIds(new Set())
      // Refresh the "products in this category" list to include the newly
      // assigned ones, and pull the category tree so its product-count
      // badge updates too.
      const detail = await apiFetch(`/categories/${manageProductsTarget.id}`)
      setCategoryProducts((detail?.products as Product[] | undefined) || [])
      loadCategories()
    } catch (e) {
      notifyError(e)
    } finally {
      setAssigningProducts(false)
    }
  }

  interface CategoryFlatRow {
    id: string
    name: string
    nameAr?: string
    skuCode?: string
    color?: string
    productCount?: number
    isSub: boolean
    hasSubs: boolean
    isCollapsed: boolean
    raw: CategoryRow
  }

  const flattenedRows = useMemo(() => {
    const list: CategoryFlatRow[] = []
    filteredHierarchy.forEach((parent) => {
      const isCollapsed = collapsedParents.has(parent.id)
      const hasSubs = parent.subcategories.length > 0
      list.push({
        id: parent.id,
        name: parent.name,
        nameAr: parent.nameAr,
        skuCode: parent.skuCode,
        color: parent.color,
        productCount: parent.productCount,
        isSub: false,
        hasSubs,
        isCollapsed,
        raw: parent,
      })
      if (!isCollapsed && hasSubs) {
        parent.subcategories.forEach((sub) => {
          list.push({
            id: sub.id,
            name: sub.name,
            nameAr: sub.nameAr,
            skuCode: sub.skuCode,
            color: sub.color,
            productCount: sub.productCount,
            isSub: true,
            hasSubs: false,
            isCollapsed: false,
            raw: sub,
          })
        })
      }
    })
    return list
  }, [filteredHierarchy, collapsedParents])

  const categoryColumns: DataTableColumn<CategoryFlatRow>[] = useMemo(() => [
    {
      key: 'nameAr',
      header: 'اسم الفئة',
      align: 'right',
      width: 'w-[35%]',
      render: (row) => (
        <div className={cn("flex items-center gap-2", row.isSub && "pr-7")}>
          {row.isSub ? (
            <>
              <span className="text-muted-foreground">—</span>
              <Tag className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <span className="font-medium text-foreground">{row.nameAr || row.name}</span>
            </>
          ) : (
            <>
              {row.hasSubs ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleCollapse(row.id)
                  }}
                  className="p-1 rounded hover:bg-muted text-foreground transition-colors"
                  title={row.isCollapsed ? 'توسيع الفئة الفرعية' : 'طي الفئة الفرعية'}
                >
                  {row.isCollapsed ? (
                    <ChevronLeft className="w-4 h-4 text-primary" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-primary" />
                  )}
                </button>
              ) : (
                <span className="w-6 inline-block" />
              )}
              <FolderOpen className="w-4 h-4 text-primary shrink-0" />
              <span className="font-bold text-foreground">{row.nameAr || row.name}</span>
              {row.hasSubs && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4.5 bg-muted">
                  {row.raw.subcategories.length}
                </Badge>
              )}
            </>
          )}
        </div>
      ),
    },
    {
      key: 'name',
      header: 'الاسم (إنجليزي)',
      align: 'right',
      render: (row) => <span className="text-sm text-muted-foreground">{row.name || '—'}</span>,
    },
    {
      key: 'skuCode',
      header: 'كود SKU',
      align: 'center',
      render: (row) => <span className="font-mono text-xs text-muted-foreground">{row.skuCode || '—'}</span>,
    },
    {
      key: 'color',
      header: 'اللون',
      align: 'center',
      render: (row) => <div className="flex justify-center">{renderColorDot(row.color, 'w-4 h-4')}</div>,
    },
    {
      key: 'productCount',
      header: 'عدد المنتجات',
      align: 'center',
      render: (row) => (
        <Badge variant="secondary" className="font-bold pos-number text-xs px-2 py-0.5">
          {formatNumber(row.productCount || 0)}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: 'إجراءات',
      align: 'center',
      render: (row) => (
        <div className="flex items-center justify-center gap-1">
          {!row.isSub && (
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-primary hover:bg-primary/10 hover:text-primary rounded-lg"
              onClick={() => openAddSub(row.raw)}
              title="إضافة فئة فرعية"
            >
              <Plus className="w-4 h-4" />
            </Button>
          )}
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg"
            onClick={() => openManageProducts(row.raw)}
            title="إدارة منتجات الفئة"
          >
            <PackagePlus className="w-4 h-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg"
            onClick={() => openBulkPrice(row.raw)}
            title="تغيير سعر الفئة بالكامل"
          >
            <DollarSign className="w-4 h-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg"
            onClick={() => openEdit(row.raw)}
            title="تعديل"
          >
            <Pencil className="w-4 h-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10 rounded-lg"
            onClick={() => openDelete(row.raw)}
            title="حذف"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      ),
    },
  ], [collapsedParents])

  return (
    <div className="module-page p-4 md:p-6 space-y-6 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="uk-page-header flex flex-col md:flex-row md:items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FolderOpen className="w-6 h-6 text-primary" />
            الفئات والفئات الفرعية
          </h1>
          <p className="text-muted-foreground text-sm max-w-2xl leading-6">تنظيم المنتجات في فئات رئيسية وفرعية</p>
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
          <Button onClick={() => openAdd()} size="sm">
            <Plus className="w-4 h-4" />
            إضافة فئة
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="ux-filter-card border-border/60 shadow-sm">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">إجمالي الفئات</p>
            <p className="text-xl font-bold mt-1">{formatNumber(stats.total)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">فئات رئيسية</p>
            <p className="text-xl font-bold mt-1 text-primary">{formatNumber(stats.totalRoots)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">فئات فرعية</p>
            <p className="text-xl font-bold mt-1 text-purple-600">{formatNumber(stats.totalSubs)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">منتجات مصنفة</p>
            <p className="text-xl font-bold mt-1 text-green-600">{formatNumber(stats.totalProducts)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <Card>
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="بحث في الفئات..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pr-10"
            />
          </div>
        </CardContent>
      </Card>

      {/* Categories DataTable Component */}
      {error ? (
        <Card>
          <CardContent className="p-8 text-center">
            <AlertTriangle className="w-10 h-10 text-red-500 mx-auto mb-2" />
            <p className="text-red-600 mb-3">{error}</p>
            <Button variant="outline" onClick={loadCategories}>إعادة المحاولة</Button>
          </CardContent>
        </Card>
      ) : (
        <DataTable<CategoryFlatRow>
          className="ux-data-table"
          columns={categoryColumns}
          rows={flattenedRows}
          loading={loading}
          rowKey={(row) => row.id}
          rowClassName={(row) => row.isSub ? "bg-muted/10 hover:bg-muted/25 transition-colors" : "bg-muted/30 font-semibold hover:bg-muted/50 transition-colors"}
          emptyMessage={search ? 'لا توجد فئات مطابقة للبحث' : 'لا توجد فئات بعد'}
          minWidth="min-w-[680px]"
          fillHeight
        />
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderOpen className="w-5 h-5 text-primary" />
              {editing ? 'تعديل الفئة' : 'إضافة فئة جديدة'}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? `تعديل بيانات: ${editing.nameAr || editing.name}`
                : form.parentId
                  ? 'سيتم إنشاؤها كفئة فرعية'
                  : 'سيتم إنشاؤها كفئة رئيسية'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>الاسم (إنجليزي) *</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Skincare"
                />
              </div>
              <div className="space-y-1.5">
                <Label>الاسم (عربي)</Label>
                <Input
                  value={form.nameAr}
                  onChange={(e) => setForm({ ...form, nameAr: e.target.value })}
                  placeholder="العناية بالبشرة"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>الفئة الأب (اتركه فارغاً لفئة رئيسية)</Label>
              <Select
                value={form.parentId}
                onValueChange={(v) => setForm({ ...form, parentId: v })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="— بدون (فئة رئيسية) —" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— بدون (فئة رئيسية) —</SelectItem>
                  {availableParents.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nameAr || c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>مدة ركود هذه الفئة (يوم)</Label>
              <Input
                type="number"
                min="1"
                max="3650"
                step="1"
                value={form.deadStockDaysOverride}
                onChange={(e) => setForm({ ...form, deadStockDaysOverride: e.target.value })}
                placeholder={form.parentId ? 'اتركه فارغًا لاستخدام الفئة الرئيسية ثم الإعداد العام' : 'اتركه فارغًا لاستخدام الإعداد العام'}
              />
              <p className="text-[11px] text-muted-foreground">
                الأولوية للمنتج أولًا، ثم الفئة الفرعية، ثم الفئة الرئيسية، ثم الإعداد العام.
              </p>
            </div>

            <Separator />

            {/* Color picker */}
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <Palette className="w-4 h-4" />
                اللون
              </Label>
              <div className="flex flex-wrap gap-2">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setForm({ ...form, color: c.value })}
                    title={c.name}
                    className={`w-8 h-8 rounded-full border-2 transition ${
                      form.color === c.value ? 'border-foreground scale-110' : 'border-transparent hover:scale-105'
                    }`}
                    style={{ backgroundColor: c.value }}
                  />
                ))}
                {/* Custom color via native input */}
                <label
                  className={`w-8 h-8 rounded-full border-2 flex items-center justify-center cursor-pointer transition ${
                    form.color && !PRESET_COLORS.find((p) => p.value === form.color)
                      ? 'border-foreground scale-110'
                      : 'border-dashed border-muted-foreground hover:scale-105'
                  }`}
                  title="لون مخصص"
                >
                  <Plus className="w-3.5 h-3.5 text-muted-foreground" />
                  <input
                    type="color"
                    className="opacity-0 absolute w-0 h-0"
                    value={form.color || '#ec4899'}
                    onChange={(e) => setForm({ ...form, color: e.target.value })}
                  />
                </label>
                {form.color && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-xs h-8"
                    onClick={() => setForm({ ...form, color: '' })}
                  >
                    إزالة اللون
                  </Button>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>الأيقونة (اختياري)</Label>
              <Input
                value={form.icon}
                onChange={(e) => setForm({ ...form, icon: e.target.value })}
                placeholder="emoji أو نص قصير (مثل: 💄)"
              />
            </div>

            {/* Preview */}
            <div className="rounded-md border p-3 bg-muted/30 flex items-center gap-2">
              <span className="text-xs text-muted-foreground">معاينة:</span>
              <Badge
                variant="outline"
                className="gap-1.5"
                style={form.color ? { borderColor: form.color, color: form.color } : undefined}
              >
                {form.color && (
                  <span
                    className="w-2.5 h-2.5 rounded-full inline-block"
                    style={{ backgroundColor: form.color }}
                  />
                )}
                {form.icon && <span>{form.icon}</span>}
                {form.nameAr || form.name || 'اسم الفئة'}
              </Badge>
              {form.parentId && (
                <span className="text-xs text-muted-foreground">
                  ← {categories.find((c) => c.id === form.parentId)?.nameAr || categories.find((c) => c.id === form.parentId)?.name || ''}
                </span>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>إلغاء</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'جاري الحفظ...' : editing ? 'حفظ التعديلات' : 'إضافة الفئة'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="w-5 h-5" />
              تأكيد الحذف
            </DialogTitle>
            <DialogDescription>
              هل أنت متأكد من حذف الفئة &quot;{deleteTarget?.nameAr || deleteTarget?.name}&quot;؟
            </DialogDescription>
          </DialogHeader>

          {deletePreview && (
            <div className="space-y-2">
              {(deletePreview.children?.length || deletePreview.subcategories?.length || 0) > 0 ? (
                <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3 text-sm">
                  <p className="font-semibold text-red-700 mb-1">⚠️ لا يمكن الحذف</p>
                  <p className="text-red-600 text-xs">
                    تحتوي هذه الفئة على {(deletePreview.children?.length || deletePreview.subcategories?.length || 0)} فئة فرعية.
                    احذف الفئات الفرعية أولاً.
                  </p>
                </div>
              ) : (deletePreview.productCount || deletePreview.products?.length || 0) > 0 ? (
                <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3 text-sm">
                  <p className="font-semibold text-red-700 mb-1">⚠️ لا يمكن الحذف</p>
                  <p className="text-red-600 text-xs">
                    تحتوي هذه الفئة على {formatNumber(deletePreview.productCount || deletePreview.products?.length || 0)} منتج.
                    انقل المنتجات إلى فئة أخرى قبل الحذف.
                  </p>
                </div>
              ) : (
                <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
                  <p className="flex items-center gap-2">
                    <Package className="w-4 h-4" />
                    لا توجد منتجات أو فئات فرعية مرتبطة. يمكن الحذف بأمان.
                  </p>
                </div>
              )}
            </div>
          )}

          {!deletePreview && deleting && (
            <div className="text-center text-sm text-muted-foreground py-2">جاري التحقق...</div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeleteTarget(null); setDeletePreview(null) }}>
              إلغاء
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleting || (deletePreview ? ((deletePreview.children?.length || deletePreview.subcategories?.length || 0) > 0 || (deletePreview.productCount || deletePreview.products?.length || 0) > 0) : false)}
            >
              {deleting ? 'جاري الحذف...' : 'تأكيد الحذف'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Preview Dialog */}
      <Dialog open={!!importPreview} onOpenChange={(o) => !o && setImportPreview(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="w-5 h-5 text-primary" />
              معاينة استيراد الفئات
            </DialogTitle>
            <DialogDescription>
              تم تحليل {importPreview?.length || 0} سجل. الفئات الموجودة (بنفس الاسم) سيتم تحديثها، والباقي سيتم إنشاؤه.
            </DialogDescription>
          </DialogHeader>
          <DataTable
            maxHeight="50vh"
            columns={[
              { key: 'name', header: 'الاسم', render: (r) => r.name || '—' },
              { key: 'nameAr', header: 'الاسم عربي', render: (r) => r.nameAr || '—' },
              { key: 'parentName', header: 'الفئة الأب', render: (r) => <span className="text-xs text-muted-foreground">{r.parentName || '— رئيسية —'}</span> },
              { key: 'color', header: 'اللون', align: 'center', render: (r) => renderColorDot(r.color) },
            ]}
            rows={importPreview || []}
            emptyMessage="لا توجد فئات لمعاينتها"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportPreview(null)} disabled={importing}>
              إلغاء
            </Button>
            <Button onClick={confirmCategoryImport} disabled={importing}>
              <Upload className="w-4 h-4" />
              {importing ? 'جاري الاستيراد...' : `تأكيد الاستيراد (${importPreview?.length || 0})`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Price Change Dialog — "زوّد سعر الفئة كلها 10%" */}
      <Dialog open={!!bulkPriceTarget} onOpenChange={(o) => !o && setBulkPriceTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-primary" />
              تغيير سعر فئة: {bulkPriceTarget?.nameAr || bulkPriceTarget?.name}
            </DialogTitle>
            <DialogDescription>
              التغيير سيُطبَّق على كل المنتجات داخل هذه الفئة بنفس النسبة أو المبلغ.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>نوع التغيير</Label>
              <Select value={bulkPriceMode} onValueChange={(v) => setBulkPriceMode(v as 'PERCENT' | 'FIXED')}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="PERCENT">نسبة مئوية %</SelectItem>
                  <SelectItem value="FIXED">مبلغ ثابت (ج.م)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>
                {bulkPriceMode === 'PERCENT'
                  ? 'النسبة % (استخدم رقم سالب للتخفيض، مثال: 10 أو -10)'
                  : 'المبلغ ج.م (استخدم رقم سالب للتخفيض)'}
              </Label>
              <Input
                type="number"
                value={bulkPriceValue}
                onChange={(e) => setBulkPriceValue(e.target.value)}
                placeholder={bulkPriceMode === 'PERCENT' ? '10' : '5'}
              />
            </div>

            <div className="space-y-1.5">
              <Label>السعر المستهدف</Label>
              <Select value={bulkPriceField} onValueChange={(v) => setBulkPriceField(v as 'sellingPrice' | 'wholesalePrice' | 'both')}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sellingPrice">سعر البيع فقط</SelectItem>
                  <SelectItem value="wholesalePrice">سعر الجملة فقط</SelectItem>
                  <SelectItem value="both">سعر البيع والجملة معاً</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {!bulkPriceTarget?.parentId && (
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={bulkPriceIncludeSubs}
                  onCheckedChange={(v) => setBulkPriceIncludeSubs(!!v)}
                />
                يشمل الفئات الفرعية أيضاً
              </label>
            )}

            {bulkPriceValue && !isNaN(parseFloat(bulkPriceValue)) && (
              <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
                مثال: منتج سعره {formatEGP(100)} سيصبح{' '}
                <span className="font-bold text-foreground">
                  {formatEGP(
                    bulkPriceMode === 'PERCENT'
                      ? Math.max(0, 100 * (1 + parseFloat(bulkPriceValue) / 100))
                      : Math.max(0, 100 + parseFloat(bulkPriceValue))
                  )}
                </span>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkPriceTarget(null)} disabled={bulkPriceSaving}>
              إلغاء
            </Button>
            <Button onClick={confirmBulkPrice} disabled={bulkPriceSaving}>
              {bulkPriceSaving ? 'جاري التطبيق...' : 'تطبيق التغيير'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manage Products In Category Dialog — bulk-assign products */}
      <Dialog open={!!manageProductsTarget} onOpenChange={(o) => { if (!o) { setManageProductsTarget(null); setProductSearch(''); setSelectedProductIds(new Set()) } }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PackagePlus className="w-5 h-5 text-primary" />
              منتجات فئة: {manageProductsTarget?.nameAr || manageProductsTarget?.name}
            </DialogTitle>
            <DialogDescription>
              ابحث عن منتج وحدده لنقله لهذه الفئة — يمكنك تحديد أكثر من منتج قبل التأكيد.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="ابحث بالاسم أو SKU أو الباركود..."
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                className="pr-10"
              />
            </div>

            {productSearch.trim() && (
              <div className="border rounded-md">
                <ScrollArea className="max-h-40">
                  <div className="p-1 space-y-0.5">
                    {searchingProducts ? (
                      <p className="text-xs text-muted-foreground p-2">جاري البحث...</p>
                    ) : searchResults.length === 0 ? (
                      <p className="text-xs text-muted-foreground p-2">لا توجد نتائج</p>
                    ) : (
                      searchResults.map((p) => (
                        <label key={p.id} className="flex items-center gap-2 p-2 rounded hover:bg-muted/50 cursor-pointer text-sm">
                          <Checkbox
                            checked={selectedProductIds.has(p.id)}
                            onCheckedChange={() => toggleSelectedProduct(p.id)}
                          />
                          <span className="flex-1 truncate">{p.nameAr || p.name}</span>
                          <span className="text-xs text-muted-foreground font-mono">{p.sku}</span>
                        </label>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </div>
            )}

            {selectedProductIds.size > 0 && (
              <div className="flex items-center justify-between rounded-md border border-primary/30 bg-primary/5 p-2 text-sm">
                <span>{formatNumber(selectedProductIds.size)} منتج محدد للنقل</span>
                <Button size="sm" onClick={confirmAssignProducts} disabled={assigningProducts}>
                  {assigningProducts ? 'جاري النقل...' : 'نقل المحدد لهذه الفئة'}
                </Button>
              </div>
            )}

            <Separator />

            <div>
              <p className="text-xs text-muted-foreground mb-1.5">المنتجات الحالية في هذه الفئة ({categoryProducts.length})</p>
              <ScrollArea className="max-h-52 border rounded-md">
                {loadingCategoryProducts ? (
                  <div className="p-3 space-y-2">
                    {[1, 2, 3].map((i) => <Skeleton key={i} className="h-8 w-full" />)}
                  </div>
                ) : categoryProducts.length === 0 ? (
                  <p className="text-center text-xs text-muted-foreground py-6">لا توجد منتجات في هذه الفئة بعد</p>
                ) : (
                  <div className="divide-y">
                    {categoryProducts.map((p) => (
                      <div key={p.id} className="flex items-center justify-between p-2 text-sm">
                        <span className="truncate">{p.nameAr || p.name}</span>
                        <span className="text-xs text-muted-foreground pos-number">{formatEGP(p.sellingPrice || 0)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setManageProductsTarget(null); setProductSearch(''); setSelectedProductIds(new Set()) }}>
              إغلاق
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
