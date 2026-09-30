// Dev browser mock — lets `vite --port 1420` render the full UI without Tauri/SQLite.
// Only used when window is localhost:1420. Real Tauri builds never hit this.
const MOCK_PRODUCTS = [
  { id: 'p1', name: 'أرز مصري', nameAr: 'أرز مصري فاخر 1كجم', sku: 'RICE-001', barcode: '6221001000001', sellingPrice: 42, purchaseCost: 35, avgCost: 35, taxRate: 14, active: true, currentStock: 120, reorderLevel: 20, categoryId: 'c1', image: null, stockLevels: [{ quantity: 120 }], allowNegativeStock: false },
  { id: 'p2', name: 'زيت عباد', nameAr: 'زيت عباد الشمس 900مل', sku: 'OIL-001', barcode: '6221001000002', sellingPrice: 85, purchaseCost: 70, avgCost: 70, taxRate: 14, active: true, currentStock: 45, reorderLevel: 15, categoryId: 'c1', image: null, stockLevels: [{ quantity: 45 }], allowNegativeStock: false },
  { id: 'p3', name: 'سكر أبيض', nameAr: 'سكر أبيض 1كجم', sku: 'SUG-001', barcode: '6221001000003', sellingPrice: 32, purchaseCost: 26, avgCost: 26, taxRate: 14, active: true, currentStock: 8, reorderLevel: 20, categoryId: 'c1', image: null, stockLevels: [{ quantity: 8 }], allowNegativeStock: false },
  { id: 'p4', name: 'مكرونة', nameAr: 'مكرونة 400جم', sku: 'PAS-001', barcode: '6221001000004', sellingPrice: 18, purchaseCost: 14, avgCost: 14, taxRate: 14, active: true, currentStock: 200, reorderLevel: 30, categoryId: 'c1', image: null, stockLevels: [{ quantity: 200 }], allowNegativeStock: false },
]
const MOCK_CATEGORIES = [
  { id: 'c1', name: 'بقالة', nameAr: 'بقالة', children: [], productCount: 4 },
  { id: 'c2', name: 'ألبان', nameAr: 'ألبان', children: [], productCount: 0 },
  { id: 'c3', name: 'منظفات', nameAr: 'منظفات', children: [], productCount: 0 },
]
const MOCK_CUSTOMERS = [
  { id: 'cu1', name: 'أحمد محمد', phone: '01012345678', loyaltyAccount: { points: 240 } },
  { id: 'cu2', name: 'سارة علي', phone: '01123456789', loyaltyAccount: { points: 85 } },
]

export function isDevMockActive(): boolean {
  if (typeof window === 'undefined') return false
  return window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
}

export async function devMockFetch(path: string, options: RequestInit = {}): Promise<unknown> {
  const method = options.method || 'GET'
  // Setup
  if (path.includes('/setup/status')) return { needsSetup: false }
  if (path.includes('/settings')) return { grouped: { loyalty: { 'loyalty.enabled': 'true', 'loyalty.egpPerPoint': '0.05', 'loyalty.minRedeem': '50' }, tax: { 'tax.enabled': 'true' } } }
  // Products / categories / inventory
  if (path.startsWith('/products')) return MOCK_PRODUCTS
  if (path.startsWith('/categories')) return MOCK_CATEGORIES
  if (path.startsWith('/inventory')) {
    if (path.includes('/movements')) return { movements: [] }
    return { items: MOCK_PRODUCTS.map(p => ({ ...p, quantity: p.currentStock })), summary: { lowStockCount: 1, outOfStockCount: 0, totalProducts: 4 } }
  }
  if (path.startsWith('/customers')) {
    const url = new URL(path, 'http://localhost')
    const q = (url.searchParams.get('search') || '').toLowerCase()
    if (!q) return MOCK_CUSTOMERS
    return MOCK_CUSTOMERS.filter(c => c.name.includes(q) || c.phone.includes(q))
  }
  if (path.startsWith('/sales')) {
    if (method === 'POST') {
      const body = options.body ? JSON.parse(options.body as string) : {}
      return { id: 'sale_mock', invoiceNumber: `INV-${Date.now()}`, items: body.items || [], total: body.total || 0 }
    }
    return []
  }
  if (path.startsWith('/cash')) return null
  if (path.startsWith('/loyalty/campaigns')) return []
  if (path.startsWith('/dashboard')) return {
    todaySales: 4250, todayProfit: 680, lowStockCount: 1, totalProducts: 4,
    recentSales: [{ id: '1', invoiceNumber: 'INV-1001', total: 250, createdAt: new Date().toISOString() }],
    topProducts: MOCK_PRODUCTS.slice(0, 3).map(p => ({ name: p.nameAr, quantity: 12 })),
    salesTrend: [{ date: 'اليوم', sales: 4250 }, { date: 'أمس', sales: 3800 }],
  }
  if (path.startsWith('/reports')) return { summary: {}, rows: [] }
  if (path.startsWith('/expenses') || path.startsWith('/purchases') || path.startsWith('/suppliers') || path.startsWith('/general-accounts') || path.startsWith('/audit')) return []
  if (path.startsWith('/employees')) return []
  return []
}
