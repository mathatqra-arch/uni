// ============================================================
// DESKTOP DATA ORCHESTRATOR — TAURI + SQLITE
// ============================================================
// This intercepts ALL apiFetch calls in desktop mode.
// When in Tauri: reads/writes go to local SQLite (PRIMARY store)
// Local SQLite is authoritative; the Desktop runtime has no cloud transport.
// ============================================================

import { isDesktop } from './desktop-mode'
import { z } from 'zod'
import { calculateExpectedCash } from './cash-utils'
import { getRolePermissions } from './roles'
import { isDeadStock, normalizeDeadStockDays, resolveDeadStockDays } from './dead-stock'
import { deriveCategorySkuBase, ensureCategorySkuCode, generateProductSku } from './sku-generator'
import { generateUUID } from './ids'
import { atomicExec, round2, sqlErrorMsg, sqlEsc, sqlVals } from './desktop-core/sql'
import {
  assignProductsSchema, cashCloseSchema, cashOpenSchema, createSaleSchema, expenseSchema,
  loyaltyRedeemSchema, loyaltyRefundSchema, refundSchema, bulkPriceSchema,
  normalizePurchasePaymentSource, validateFullSalePayment, zodError,
} from './desktop-core/validation'
import { requirePermission, requireUser } from './desktop-core/auth'
import { autoJournalStatements, makeJournalEntryNo } from './desktop-core/accounting'
import { logger } from './logger'

// MAINTAINER RULES
// 1. Keep pure policies in desktop-core/*.ts so they can be tested directly.
// 2. Keep SQLite transactions here at the domain boundary; do not move them into UI.
// 3. Add a new handler instead of creating a second data-access path for the same entity.
// 4. When a schema changes, add a numbered SQLite migration and test it from an empty DB.
// 5. Comments should explain a non-obvious invariant or reason, not restate the code.


interface SQLiteDatabase {
  execute(sql: string, bindings?: unknown[]): Promise<unknown>
  select<T = Record<string, unknown>>(sql: string, bindings?: unknown[]): Promise<T[]>
}

let sqlDb: SQLiteDatabase | null = null

function isUniqueConstraintError(error: unknown): boolean {
  const msg = sqlErrorMsg(error).toLowerCase()
  return msg.includes('unique constraint') || msg.includes('unique failed') || (msg.includes('constraint failed') && msg.includes('unique'))
}
let seeded = false
let dbInitPromise: Promise<SQLiteDatabase | null> | null = null

// ============================================================
// GLOBAL WRITE/READ SERIALIZATION QUEUE — fixes "database is
// locked" (SQLITE_BUSY) and "cannot start a transaction within
// a transaction" errors.
//
// tauri-plugin-sql runs SQLite through a connection pool. WAL
// mode + busy_timeout are only ever applied to the ONE pooled
// connection that happened to run the PRAGMA during getDb() init
// — every OTHER connection the pool hands out for a later call
// has busy_timeout = 0 (SQLite's default), so it fails INSTANTLY
// instead of waiting when it hits a write lock held by another
// in-flight statement. Two overlapping atomicExec() calls (e.g. a
// double-click submit, or a GET racing a POST) can also each try
// to BEGIN a transaction on different pooled connections, which
// throws "cannot start a transaction within a transaction".
//
// Since SQLite only ever allows ONE writer at a time anyway, there
// is no throughput to lose by fully serializing every desktop DB
// call (reads included) through a single in-app queue. This makes
// the pool-connection issue irrelevant: only one statement/batch
// is ever in flight against pos.db at any moment.
// ============================================================
let dbQueue: Promise<void> = Promise.resolve()

function enqueueDbOp<T>(fn: () => Promise<T>): Promise<T> {
  const run = dbQueue.then(fn, fn)
  // Swallow rejections here so one failed op doesn't poison the
  // queue for everything queued after it — the real error is still
  // thrown to whoever awaited `run`.
  dbQueue = run.then(() => undefined, () => undefined)
  return run
}


export async function getDb(): Promise<SQLiteDatabase | null> {
  if (sqlDb) return sqlDb
  if (!isDesktop()) return null
  if (dbInitPromise) return dbInitPromise

  dbInitPromise = (async () => {
    try {
      // Import the plugin — use default export (Tauri plugin-sql v2.4.0)
      const mod = await import('@tauri-apps/plugin-sql')
      const Database = mod.default || (mod as any).Database

      if (!Database || typeof Database.load !== 'function') {
        throw new Error('Database class not found in @tauri-apps/plugin-sql')
      }

      sqlDb = await Database.load('sqlite:pos.db')

      // PRAGMA foreign_keys is enforced by the versioned migration set and the native transaction connection.
      // The migration system runs before Database.load() returns, so
      // the schema is guaranteed to be ready.
      //
      // We still set PRAGMA here as a safety net — it's a per-connection
      // setting in SQLite, so new connections need it re-applied.
      try {
        await sqlDb.execute('PRAGMA foreign_keys = ON')
      } catch (e) {
        logger.warn('[Desktop DB] PRAGMA foreign_keys = ON failed:', sqlErrorMsg(e))
      }

      // ─── FIX: "database is locked" (SQLITE_BUSY, code 5) ───
      // Root cause: the default SQLite journal mode (DELETE/rollback
      // journal) takes an exclusive file lock for the whole duration of
      // any write, and with no busy_timeout set, a second connection/
      // statement that hits that lock fails IMMEDIATELY instead of
      // waiting — which is exactly what happened here: a burst of GET
      // queries (products/categories/sales) racing a POST /expenses or
      // POST /users write.
      //
      // WAL (Write-Ahead Logging) mode lets readers run concurrently
      // with a writer instead of blocking, and busy_timeout makes any
      // remaining lock contention retry for up to 5s instead of failing
      // instantly. WAL is persisted in the db file itself (set once),
      // busy_timeout is per-connection so it must be re-applied here.
      try {
        await sqlDb.execute('PRAGMA journal_mode = WAL')
        await sqlDb.execute('PRAGMA busy_timeout = 5000')
      } catch (e) {
        logger.warn('[Desktop DB] PRAGMA journal_mode/busy_timeout failed:', sqlErrorMsg(e))
      }

      // Schema patches (ALTER TABLE, indexes, sync_queue cleanup) are now
      // enforced by the versioned Rust migration set. No more runtime patchSchema().
      // This was the root cause of the "sql.execute not allowed" errors —
      // patchSchema() used db.execute() which requires sql:allow-execute.
      // Now migrations run through tauri-plugin-sql's Rust migration system.

      // Seed admin user on first run (needs bcrypt — JS-only, can't run in Rust)
      if (!seeded) {
        await seedAdminUser(sqlDb)
        seeded = true
      }

      logger.info('[Desktop DB] SQLite initialized successfully (migrations applied via Rust)')
      return sqlDb
    } catch (e) {
      logger.error(`[Desktop DB] Failed to load SQLite: ${sqlErrorMsg(e)}`)
      // Never leave a rejected/failed initialization cached forever. A
      // transient plugin/migration/permission issue should be retryable.
      dbInitPromise = null
      sqlDb = null
      return null
    }
  })()

  return dbInitPromise
}

/**
 * patchSchema() was REMOVED — all schema patches now handled by
 * Historical runtime schema patching was removed; schema evolution is owned by the registered versioned migrations.
 *
 * Previously this function ran ALTER TABLE, CREATE INDEX, and
 * sync_queue cleanup via db.execute() at runtime, which required
 * sql:allow-execute permission. Now these operations run through
 * tauri-plugin-sql's Rust migration system before Database.load()
 * returns, so the schema is guaranteed to be ready.
 *
 * The following patches are now owned by the registered versioned migrations:
 * - suppliers.active, products.description, customers.notes
 * - deleted_at on 16 tables
 * - client_txn_id on 6 transactional tables
 * - updated_at on 13 tables
 * - device_id on sync_queue
 * - sync_queue dedup + unique index
 * - sync performance indexes
 * - sale_payments table
 * - sync_metadata table
 */

async function seedAdminUser(db) {
  try {
    const users = await db.select('SELECT COUNT(*) as count FROM users')
    if (users[0]?.count > 0) {
      logger.debug('[Desktop DB] Admin already exists, skipping admin seed')
      return
    }

    const bcrypt = await import('bcryptjs')
    const randomPassword = crypto.randomUUID() + crypto.randomUUID()
    const passwordHash = await bcrypt.hash(randomPassword, 12)
    const id = generateUUID()

    // Resolve/reuse the minimum base entities BEFORE opening the write batch.
    // The complete seed is then committed as one transaction, so a crash or
    // constraint failure cannot leave a half-initialized installation.
    let storeId: string
    const existingStores = await db.select('SELECT id FROM stores ORDER BY rowid LIMIT 1')
    if (existingStores[0]?.id) {
      storeId = String(existingStores[0].id)
    } else {
      storeId = generateUUID()
    }

    let warehouseId: string
    const existingWarehouses = await db.select('SELECT id FROM warehouses ORDER BY rowid LIMIT 1')
    if (existingWarehouses[0]?.id) {
      warehouseId = String(existingWarehouses[0].id)
    } else {
      warehouseId = generateUUID()
    }

    const seedStatements: string[] = [
      `INSERT INTO users (id, email, username, password_hash, name, role, permissions, active, pin, created_at, updated_at)
       VALUES ${sqlVals([id, 'admin@unikasher.pos', 'admin', passwordHash, 'مدير المتجر', 'ADMIN', JSON.stringify(['all']), 1, null, new Date().toISOString(), new Date().toISOString()])}`,
      `INSERT OR REPLACE INTO settings (key, value, category) VALUES ${sqlVals(['system.needsSetup', 'true', 'system'])}`,
    ]

    if (!existingStores[0]?.id) {
      seedStatements.push(`INSERT INTO stores (id, name, address, phone, currency, receipt_footer, active, created_at)
       VALUES ${sqlVals([storeId, 'متجري الجديد', '', '', 'EGP', 'شكراً لتعاملكم معنا', 1, new Date().toISOString()])}`)
    }

    if (!existingWarehouses[0]?.id) {
      seedStatements.push(`INSERT INTO warehouses (id, name, store_id, created_at)
       VALUES ${sqlVals([warehouseId, 'المخزن الرئيسي', storeId, new Date().toISOString()])}`)
    }

    const categories = [
      { name: 'Perfumes', nameAr: 'العطور', color: '#e11d48' },
      { name: 'Makeup', nameAr: 'المكياج', color: '#ec4899' },
      { name: 'Skincare', nameAr: 'العناية بالبشرة', color: '#8b5cf6' },
      { name: 'Haircare', nameAr: 'العناية بالشعر', color: '#f59e0b' },
      { name: 'Body Care', nameAr: 'العناية بالجسم', color: '#10b981' },
      { name: 'Beauty Tools', nameAr: 'أدوات التجميل', color: '#06b6d4' },
      { name: 'Offers', nameAr: 'العروض', color: '#ef4444' },
    ]
    for (const c of categories) {
      seedStatements.push(`INSERT INTO categories (id, name, name_ar, color, created_at)
       VALUES ${sqlVals([generateUUID(), c.name, c.nameAr, c.color, new Date().toISOString()])}`)
    }

    const expCats = [
      { name: 'Rent', nameAr: 'إيجار', color: '#ef4444' },
      { name: 'Electricity', nameAr: 'كهرباء', color: '#f59e0b' },
      { name: 'Internet', nameAr: 'إنترنت', color: '#3b82f6' },
      { name: 'Salary', nameAr: 'رواتب', color: '#10b981' },
      { name: 'Other', nameAr: 'أخرى', color: '#6b7280' },
    ]
    for (const c of expCats) {
      seedStatements.push(`INSERT INTO expense_categories (id, name, name_ar, color, created_at)
       VALUES ${sqlVals([generateUUID(), c.name, c.nameAr, c.color, new Date().toISOString()])}`)
    }

    const tiers = [
      { name: 'BRONZE', displayName: 'برونزي', minPoints: 0, multiplier: 1.0, discount: 0, color: '#cd7f32' },
      { name: 'SILVER', displayName: 'فضي', minPoints: 500, multiplier: 1.2, discount: 5, color: '#c0c0c0' },
      { name: 'GOLD', displayName: 'ذهبي', minPoints: 1500, multiplier: 1.5, discount: 10, color: '#ffd700' },
      { name: 'VIP', displayName: 'VIP', minPoints: 3000, multiplier: 2.0, discount: 15, color: '#9333ea' },
    ]
    for (const t of tiers) {
      seedStatements.push(`INSERT INTO loyalty_tiers (id, name, display_name, min_points, earning_multiplier, discount_percent, color)
       VALUES ${sqlVals([generateUUID(), t.name, t.displayName, t.minPoints, t.multiplier, t.discount, t.color])}`)
    }

    const settings = [
      ['loyalty.enabled', 'true', 'loyalty'],
      ['loyalty.pointsPerEgp', '0.1', 'loyalty'],
      ['loyalty.egpPerPoint', '0.05', 'loyalty'],
      ['loyalty.minRedeem', '500', 'loyalty'],
      ['tax.defaultRate', '14', 'tax'],
      ['receipt.width', '80', 'receipt'],
      ['receipt.autoPrint', 'true', 'receipt'],
      ['receipt.cutPaper', 'true', 'receipt'],
      ['receipt.openDrawer', 'true', 'receipt'],
      ['currency', 'EGP', 'general'],
      ['language', 'ar', 'general'],
      ['store.name', 'Uni Kasher', 'general'],
      ['inventory.deadStockDays', '60', 'inventory'],
      ['system.locked', 'false', 'system'],
    ]
    for (const [key, value, category] of settings) {
      seedStatements.push(`INSERT OR REPLACE INTO settings (key, value, category) VALUES ${sqlVals([key, value, category])}`)
    }

    await atomicExec(db, seedStatements)
    logger.info('[Desktop DB] Admin + system configuration initialized atomically (no demo data)')
  } catch (e) {
    logger.error(`[Desktop DB] Seed error: ${sqlErrorMsg(e)}`)
    throw e
  }
}

// Demo/test data seeding has intentionally been removed from the production
// desktop startup path. Fresh installations must contain no fake products,
// customers, suppliers, sales, returns, expenses, or opening cash sessions.

const TABLE_MAP: Record<string, string> = {
  '/products': 'products',
  '/categories': 'categories',
  '/customers': 'customers',
  '/suppliers': 'suppliers',
  '/sales': 'sales',
  '/inventory/movements': 'stock_movements',
  '/inventory': 'products',
  '/loyalty/campaigns': 'loyalty_campaigns',
  '/loyalty': 'loyalty_accounts',
  '/cash': 'cash_sessions',
  '/expenses/categories': 'expense_categories',
  '/expenses': 'expenses',
  '/purchases': 'purchases',
  '/audit': 'audit_logs',
  '/users': 'users',
  '/settings': 'settings',
  '/dashboard': 'dashboard',
  '/reports': 'reports',
  '/general-accounts': 'general_accounts',
  '/platform': 'platform',
}

const SCHEMA: Record<string, { table: string, columns: string[] }> = {
  brands: { table: 'brands', columns: ['id','name','name_ar','color','created_at','updated_at','deleted_at'] },
  units: { table: 'units', columns: ['id','name','name_ar','abbreviation','created_at','updated_at','deleted_at'] },
  loyalty_tiers: { table: 'loyalty_tiers', columns: ['id','name','display_name','min_points','earning_multiplier','discount_percent','color'] },
  stock_adjustments: { table: 'stock_adjustments', columns: ['id','client_txn_id','product_id','warehouse_id','old_quantity','new_quantity','reason','note','user_id','created_at'] },
  invoice_sequences: { table: 'invoice_sequences', columns: ['id','store_id','prefix','next_number','updated_at'] },
  products: {
    table: 'products',
    columns: ['id', 'name', 'name_ar', 'sku', 'barcode', 'category_id', 'brand_id', 'unit_id', 'supplier_id',
      'purchase_cost', 'selling_price', 'wholesale_price', 'tax_rate', 'min_stock', 'reorder_level',
      'track_stock', 'allow_negative_stock', 'avg_cost', 'image', 'description', 'active', 'current_stock', 'dead_stock_days_override',
      'created_at', 'updated_at', 'deleted_at']
  },
  categories: { table: 'categories', columns: ['id', 'name', 'name_ar', 'parent_id', 'color', 'icon', 'dead_stock_days_override', 'created_at', 'updated_at', 'deleted_at'] },
  customers: {
    table: 'customers',
    columns: ['id', 'name', 'phone', 'email', 'address', 'notes', 'birthday', 'tier', 'active',
      'loyalty_points', 'total_earned', 'total_redeemed', 'created_at', 'updated_at', 'deleted_at']
  },
  suppliers: { table: 'suppliers', columns: ['id', 'name', 'phone', 'email', 'address', 'tax_id', 'balance', 'active', 'created_at', 'updated_at', 'deleted_at'] },
  sales: {
    table: 'sales',
    columns: ['id', 'client_txn_id', 'invoice_number', 'customer_id', 'user_id', 'items_json',
      'subtotal', 'discount_amount', 'tax_amount', 'total', 'paid_amount', 'change_amount',
      'payment_method', 'payment_details', 'loyalty_earned', 'loyalty_redeemed', 'note',
      'status', 'sync_status', 'created_at', 'updated_at', 'deleted_at']
  },
  expenses: { table: 'expenses', columns: ['id', 'client_txn_id', 'category_id', 'user_id', 'amount', 'payment_method', 'note', 'date', 'sync_status', 'created_at', 'updated_at', 'deleted_at'] },
  expense_categories: { table: 'expense_categories', columns: ['id', 'name', 'name_ar', 'color', 'created_at'] },
  settings: { table: 'settings', columns: ['key', 'value', 'category', 'updated_at'] },
  users: { table: 'users', columns: ['id', 'email', 'username', 'password_hash', 'name', 'phone', 'role', 'permissions', 'active', 'pin', 'created_at', 'updated_at', 'deleted_at'] },
  loyalty_accounts: { table: 'loyalty_accounts', columns: ['id', 'customer_id', 'points', 'total_earned', 'total_redeemed', 'tier', 'updated_at', 'deleted_at'] },
  loyalty_transactions: { table: 'loyalty_transactions', columns: ['id', 'client_txn_id', 'customer_id', 'type', 'points', 'ref_type', 'ref_id', 'note', 'sync_status', 'created_at', 'updated_at', 'deleted_at'] },
  loyalty_campaigns: { table: 'loyalty_campaigns', columns: ['id', 'name', 'description', 'start_date', 'end_date', 'tier_filter', 'points_multiplier', 'bonus_points', 'min_purchase', 'product_id', 'active', 'created_at'] },
  cash_sessions: { table: 'cash_sessions', columns: ['id', 'client_txn_id', 'user_id', 'register_id', 'opening_balance', 'closing_balance', 'expected_cash', 'difference', 'status', 'opened_at', 'closed_at', 'updated_at', 'deleted_at'] },
  cash_movements: { table: 'cash_movements', columns: ['id', 'client_txn_id', 'session_id', 'type', 'amount', 'note', 'ref_type', 'ref_id', 'sync_status', 'created_at', 'updated_at', 'deleted_at'] },
  purchases: { table: 'purchases', columns: ['id', 'client_txn_id', 'invoice_number', 'supplier_id', 'user_id', 'warehouse_id', 'subtotal', 'tax_amount', 'discount_amount', 'total', 'paid_amount', 'payment_method', 'status', 'note', 'created_at', 'updated_at', 'deleted_at'] },
  audit_logs: { table: 'audit_logs', columns: ['id', 'user_id', 'action', 'entity', 'entity_id', 'before', 'after', 'created_at', 'updated_at', 'deleted_at'] },
  stock_movements: { table: 'stock_movements', columns: ['id', 'client_txn_id', 'product_id', 'warehouse_id', 'type', 'quantity', 'ref_type', 'ref_id', 'note', 'user_id', 'sync_status', 'created_at', 'updated_at', 'deleted_at'] },
  stock_levels: { table: 'stock_levels', columns: ['id', 'product_id', 'warehouse_id', 'quantity', 'updated_at'] },
  registers: { table: 'registers', columns: ['id', 'name', 'store_id', 'active', 'created_at'] },
  general_accounts: { table: 'general_accounts', columns: ['id', 'code', 'name', 'name_ar', 'account_type', 'parent_id', 'opening_balance', 'active', 'is_system', 'created_at', 'updated_at'] },
  general_journal_entries: { table: 'general_journal_entries', columns: ['id','client_txn_id','entry_no','entry_date','description','reference_type','reference_id','user_id','status','entry_source','created_at','updated_at'] },
  general_journal_lines: { table: 'general_journal_lines', columns: ['id','journal_entry_id','account_id','debit','credit','note'] },
}

function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)
}

function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
}

function rowToCamel(row): any {
  if (!row) return null
  const result: any = {}
  for (const [key, value] of Object.entries(row)) {
    result[toCamelCase(key)] = value
  }
  return result
}

function objToSnake(obj): any {
  const result: any = {}
  for (const [key, value] of Object.entries(obj)) {
    result[toSnakeCase(key)] = value
  }
  return result
}

// ============================================================
// MAIN: Handle API request locally via SQLite
// ============================================================

export async function desktopApiFetch(path: string, options: RequestInit = {}): Promise<any> {
  const db = await getDb()
  if (!db) {
    throw new Error('قاعدة البيانات المحلية غير متاحة - فشل تحميل SQLite')
  }

  const method = options.method || 'GET'
  const tableName = getTableName(path)
  const pathParts = path.split('/').filter(Boolean)
  const entityId = pathParts.length > 1 && pathParts[pathParts.length - 2] !== 'api' ? pathParts[pathParts.length - 1] : null

  try {
    return await enqueueDbOp(async () => {
      switch (method) {
        case 'GET': return await handleGet(db, tableName, path, entityId)
        case 'POST': return await handlePost(db, tableName, path, options)
        case 'PUT': return await handlePut(db, tableName, path, entityId || '', options)
        case 'DELETE': return await handleDelete(db, tableName, entityId || '')
        default: throw new Error(`Method ${method} not supported offline`)
      }
    })
  } catch (e) {
    // Wrap all errors with readable messages and path info
    const msg = sqlErrorMsg(e)
    logger.error(`[Desktop API] ${method} ${path} failed: ${msg}`)
    throw new Error(msg)
  }
}

function getTableName(path: string): string {
  const cleanPath = path.replace(/^\//, '').split('?')[0]
  for (const [apiPath, table] of Object.entries(TABLE_MAP)) {
    if (cleanPath.startsWith(apiPath.replace(/^\//, ''))) return table
  }
  return cleanPath.split('/')[0]
}

// ============================================================
// GET
// ============================================================
async function handleGet(db, tableName: string, path: string, entityId: string | null): Promise<any> {
  const schema = SCHEMA[tableName]

  if (path.includes('/dashboard')) return handleDashboard(db)
  if (path.includes('/system/integrity')) return handleSystemIntegrity(db)
  if (path === '/system/backup' || path.startsWith('/system/backup/')) return handleBackupExport(db)
  if (path.includes('/reports')) return handleReports(db, path)
  if (path.startsWith('/general-accounts')) return handleGeneralAccountsGet(db, path)
  // FIX: the Categories screen (categories.tsx) reads `c.children` (to
  // nest subcategories under their parent) and `c.productCount` (the "X
  // منتج" badge, and what confirms a bulk product-assign actually took
  // effect) on every category row — the generic list/single-row handler
  // below only ever returns flat category columns, so both were always
  // undefined/0 no matter how many products or subcategories a category
  // actually had. This mirrors the web route's shape
  // (the category desktop handlers) exactly.
  if (tableName === 'categories') return handleCategoriesGet(db, entityId)
  if (path.includes('/inventory') && !path.includes('/movements')) return handleInventory(db, path)
  if (path.includes('/inventory/movements')) {
    // FIX: this used to return a bare array. The Movements tab
    // (inventory.tsx) reads `data.movements.length` / `data.movements.map`
    // and expects each row's product/warehouse as nested objects — a bare
    // array made `data.movements` undefined, crashing with
    // "Cannot read properties of undefined (reading 'length')". Shape
    // Keep pagination and joins explicit because the SQLite layer returns raw rows.
    // `include` does there.
    const url = new URL(`http://x${path}`)
    const type = url.searchParams.get('type')
    const dateFrom = url.searchParams.get('dateFrom')
    const dateTo = url.searchParams.get('dateTo')
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 1000)
    const offset = parseInt(url.searchParams.get('offset') || '0')

    const whereParts: string[] = ['sm.deleted_at IS NULL']
    const args: unknown[] = []
    if (type) { whereParts.push('sm.type = ?'); args.push(type) }
    if (dateFrom) { whereParts.push('sm.created_at >= ?'); args.push(dateFrom) }
    if (dateTo) { whereParts.push('sm.created_at <= ?'); args.push(dateTo) }
    const where = whereParts.join(' AND ')

    const rows = await db.select(
      `SELECT sm.*, p.name as p_name, p.name_ar as p_name_ar, p.sku as p_sku,
              w.name as w_name
       FROM stock_movements sm
       LEFT JOIN products p ON sm.product_id = p.id
       LEFT JOIN warehouses w ON sm.warehouse_id = w.id
       WHERE ${where}
       ORDER BY sm.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      args
    )
    const countRows = await db.select(
      `SELECT COUNT(*) as cnt FROM stock_movements sm WHERE ${where}`,
      args
    )
    const total = countRows[0]?.cnt || 0

    const movements = rows.map((r) => ({
      id: r.id,
      productId: r.product_id,
      warehouseId: r.warehouse_id,
      type: r.type,
      quantity: r.quantity,
      refType: r.ref_type,
      refId: r.ref_id,
      note: r.note,
      createdAt: r.created_at,
      product: r.product_id ? { id: r.product_id, name: r.p_name, nameAr: r.p_name_ar, sku: r.p_sku } : null,
      warehouse: r.warehouse_id ? { id: r.warehouse_id, name: r.w_name } : null,
    }))
    return { movements, pagination: { total, limit, offset, hasMore: offset + movements.length < total } }
  }
  if (path.includes('/loyalty') && path.includes('/campaigns')) {
    // Join product name/nameAr so the Campaigns tab and the POS badge can
    // show "which product" without a second round-trip per campaign.
    // ?active=true (used by the POS screen) narrows to campaigns that are
    // actually live right now (active flag + within date range) — the
    // Campaigns management tab still passes active=all to see everything.
    const url = new URL(`http://x${path}`)
    const activeParam = url.searchParams.get('active')
    let where = ''
    const args: unknown[] = []
    if (activeParam === 'true') {
      const now = new Date().toISOString()
      where = "WHERE (lc.active = 1 OR lc.active = 'true') AND date(lc.start_date) <= date(?) AND date(lc.end_date) >= date(?)"
      args.push(now, now)
    }
    const rows = await db.select(
      `SELECT lc.*, p.name as p_name, p.name_ar as p_name_ar
       FROM loyalty_campaigns lc
       LEFT JOIN products p ON lc.product_id = p.id
       ${where}
       ORDER BY lc.created_at DESC`,
      args
    )
    return rows.map((r) => {
      const camel = rowToCamel(r)
      camel.product = r.product_id ? { id: r.product_id, name: r.p_name, nameAr: r.p_name_ar } : null
      delete camel.pName; delete camel.pNameAr
      return camel
    })
  }
  if (path.includes('/loyalty/transactions')) {
    // Keep this response aligned with the desktop loyalty transaction contract.
    // because loyalty.tsx's Transactions tab used to fake this list by
    // aggregating each account's total_earned/total_redeemed into two
    // synthetic rows instead of querying real loyalty_transactions rows.
    const url = new URL(`http://x${path}`)
    const type = url.searchParams.get('type')
    const search = (url.searchParams.get('search') || '').trim().toLowerCase()
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '200'), 1000)
    const whereParts: string[] = ['lt.deleted_at IS NULL', 'c.deleted_at IS NULL']
    const args: unknown[] = []
    if (type) { whereParts.push('lt.type = ?'); args.push(type) }
    if (search) { whereParts.push('(LOWER(c.name) LIKE ? OR c.phone LIKE ?)'); args.push(`%${search}%`, `%${search}%`) }
    const where = whereParts.join(' AND ')
    const rows = await db.select(
      `SELECT lt.*, c.id as c_id, c.name as c_name, c.phone as c_phone
       FROM loyalty_transactions lt
       JOIN customers c ON lt.customer_id = c.id
       WHERE ${where}
       ORDER BY lt.created_at DESC LIMIT ${limit}`,
      args
    )
    return rows.map((r) => {
      const camel = rowToCamel(r)
      camel.customer = { id: r.c_id, name: r.c_name, phone: r.c_phone }
      delete camel.cId; delete camel.cName; delete camel.cPhone
      return camel
    })
  }
  if (path.includes('/loyalty/rate')) {
    // Read the canonical loyalty rate from the desktop settings.
    // for why customers.tsx/loyalty.tsx can no longer hardcode a point
    // value constant.
    const rows = await db.select("SELECT value FROM settings WHERE key = 'loyalty.pointsPerEgp'")
    const parsed = rows.length ? parseFloat(rows[0].value) : NaN
    return { pointsPerEgp: parsed > 0 ? parsed : 0.1 }
  }
  if (path.includes('/loyalty') && !path.includes('/campaigns')) {
    // loyalty_accounts is soft-deletable (migration 002) — filter deleted rows.
    // Keep the loyalty response shape stable for the desktop UI.
    // against) reads the customer's name/phone from a NESTED `a.customer`
    // response object expected by the desktop UI. This handler used to
    // return them as FLAT `customerName`/`customerPhone` fields instead, so
    // on desktop `a.customer` was always undefined and the loyalty page
    // showed "—" for every customer name/phone. Nest them to match.
    const rows = await db.select('SELECT la.*, c.id as c_id, c.name as c_name, c.phone as c_phone FROM loyalty_accounts la JOIN customers c ON la.customer_id = c.id WHERE la.deleted_at IS NULL AND c.deleted_at IS NULL ORDER BY la.points DESC')
    return rows.map((r) => {
      const camel = rowToCamel(r)
      camel.customer = { id: r.c_id, name: r.c_name, phone: r.c_phone }
      delete camel.cId; delete camel.cName; delete camel.cPhone
      return camel
    })
  }
  if (path.includes('/cash')) return handleCash(db, path)
  if (path.includes('/expenses/categories')) {
    // expense_categories has no deleted_at column — no filter.
    const rows = await db.select('SELECT * FROM expense_categories ORDER BY name')
    return rows.map(rowToCamel)
  }

  if (tableName === 'suppliers' && !entityId) {
    const url = new URL(`http://x${path}`)
    const search = (url.searchParams.get('search') || '').trim()
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 1000)
    const where = search ? `WHERE s.deleted_at IS NULL AND (s.name LIKE ? OR s.phone LIKE ? OR s.email LIKE ?)` : `WHERE s.deleted_at IS NULL`
    const args = search ? [`%${search}%`, `%${search}%`, `%${search}%`] : []
    const rows = await db.select(`
      SELECT s.*,
        COALESCE((SELECT SUM(p.total) FROM purchases p WHERE p.supplier_id=s.id AND p.deleted_at IS NULL),0) total_purchases,
        COALESCE((SELECT SUM(pp.amount) FROM purchase_payments pp JOIN purchases px ON px.id=pp.purchase_id WHERE pp.supplier_id=s.id AND px.deleted_at IS NULL),0) total_paid,
        COALESCE((SELECT SUM(p.total) FROM purchases p WHERE p.supplier_id=s.id AND p.deleted_at IS NULL),0)
          - COALESCE((SELECT SUM(pp.amount) FROM purchase_payments pp JOIN purchases px ON px.id=pp.purchase_id WHERE pp.supplier_id=s.id AND px.deleted_at IS NULL),0) total_outstanding,
        (SELECT COUNT(*) FROM purchases p WHERE p.supplier_id=s.id AND p.deleted_at IS NULL) purchase_count,
        (SELECT MAX(p.created_at) FROM purchases p WHERE p.supplier_id=s.id AND p.deleted_at IS NULL) last_purchase_at
      FROM suppliers s
      ${where}
      ORDER BY s.name ASC LIMIT ${limit}
    `, args)
    return rows.map((r) => ({
      ...rowToCamel(r),
      purchaseSummary: {
        totalPurchases: round2(Number(r.total_purchases || 0)),
        totalPaid: round2(Number(r.total_paid || 0)),
        balance: round2(Math.max(0, Number(r.total_outstanding || 0))),
        count: Number(r.purchase_count || 0),
        lastPurchaseAt: r.last_purchase_at || null,
      },
    }))
  }
  if (path.includes('/expenses')) {
    // FIX: this used to return a bare array with the joined category/user
    // fields flattened onto each row (category_name, category_name_ar,
    // user_name). The Expenses screen reads `data.expenses` / `data.total`
    // and `e.category?.nameAr` / `e.user?.name` as NESTED objects (same
    // shape expected by the desktop UI — a flat array
    // made `data.expenses` undefined, so `setExpenses(data?.expenses || [])`
    // always fell back to [] and the module showed nothing no matter how
    // many expenses existed.
    const url = new URL(`http://x${path}`)
    const categoryId = url.searchParams.get('categoryId')
    const paymentMethod = url.searchParams.get('paymentMethod')
    const dateFrom = url.searchParams.get('dateFrom')
    const dateTo = url.searchParams.get('dateTo')
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 1000)

    const whereParts: string[] = ['e.deleted_at IS NULL']
    const args: unknown[] = []
    if (categoryId) { whereParts.push('e.category_id = ?'); args.push(categoryId) }
    if (paymentMethod) { whereParts.push('e.payment_method = ?'); args.push(paymentMethod) }
    if (dateFrom) { whereParts.push('e.date >= ?'); args.push(dateFrom) }
    if (dateTo) { whereParts.push('e.date <= ?'); args.push(dateTo) }
    const where = whereParts.join(' AND ')

    const rows = await db.select(
      `SELECT e.*, ec.name as category_name, ec.name_ar as category_name_ar, ec.color as category_color,
              u.name as user_name
       FROM expenses e
       LEFT JOIN expense_categories ec ON e.category_id = ec.id
       LEFT JOIN users u ON e.user_id = u.id
       WHERE ${where}
       ORDER BY e.date DESC LIMIT ${limit}`,
      args
    )
    const expenses = rows.map((r) => ({
      id: r.id,
      categoryId: r.category_id,
      userId: r.user_id,
      amount: r.amount,
      paymentMethod: r.payment_method,
      note: r.note,
      date: r.date,
      createdAt: r.created_at,
      category: r.category_id ? { id: r.category_id, name: r.category_name, nameAr: r.category_name_ar, color: r.category_color } : null,
      user: r.user_id ? { id: r.user_id, name: r.user_name } : null,
    }))
    const total = expenses.reduce((s, e) => s + (e.amount || 0), 0)
    return { expenses, total }
  }
  if (path.includes('/purchases')) {
    // FIX: this used to `SELECT p.*, s.name as supplier_name` (a single
    // flat alias) with no purchase_items join at all, and ignored every
    // filter the Purchases screen sends. purchases.tsx reads
    // `p.supplier?.name` (a nested object) and `p.items` (an array with
    // `.product.nameAr/name/sku`) — neither existed on the returned rows,
    // so the supplier column and the item count/detail always showed
    // blank. The desktop response includes supplier and user metadata:
    // items: { include: { product } } }` shape and honors the same query
    // params (supplierId/status/dateFrom/dateTo/limit).
    const url = new URL(`http://x${path}`)
    const supplierId = url.searchParams.get('supplierId')
    const status = url.searchParams.get('status')
    const dateFrom = url.searchParams.get('dateFrom')
    const dateTo = url.searchParams.get('dateTo')
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 1000)

    const whereParts: string[] = ['p.deleted_at IS NULL']
    const args: unknown[] = []
    if (supplierId) { whereParts.push('p.supplier_id = ?'); args.push(supplierId) }
    if (status) { whereParts.push('p.status = ?'); args.push(status) }
    if (dateFrom) { whereParts.push('p.created_at >= ?'); args.push(dateFrom) }
    if (dateTo) { whereParts.push('p.created_at <= ?'); args.push(dateTo) }
    const where = whereParts.join(' AND ')

    const rows = await db.select(
      `SELECT p.*,
              s.id as s_id, s.name as s_name, s.phone as s_phone, s.balance as s_balance,
              u.id as u_id, u.name as u_name
       FROM purchases p
       LEFT JOIN suppliers s ON p.supplier_id = s.id
       LEFT JOIN users u ON p.user_id = u.id
       WHERE ${where}
       ORDER BY p.created_at DESC LIMIT ${limit}`,
      args
    )
    if (rows.length === 0) return []

    const ids = rows.map((r) => r.id)
    const placeholders = ids.map(() => '?').join(',')
    const itemRows = await db.select(
      `SELECT pi.*, pr.name as pr_name, pr.name_ar as pr_name_ar, pr.sku as pr_sku
       FROM purchase_items pi
       LEFT JOIN products pr ON pi.product_id = pr.id
       WHERE pi.purchase_id IN (${placeholders})`,
      ids
    )
    const itemsByPurchase = new Map<string, any[]>()
    for (const it of itemRows) {
      const arr = itemsByPurchase.get(it.purchase_id) || []
      arr.push({
        id: it.id,
        purchaseId: it.purchase_id,
        productId: it.product_id,
        quantity: it.quantity,
        unitCost: it.unit_cost,
        taxRate: it.tax_rate,
        total: it.total,
        product: { id: it.product_id, name: it.pr_name, nameAr: it.pr_name_ar, sku: it.pr_sku },
      })
      itemsByPurchase.set(it.purchase_id, arr)
    }

    return rows.map((r) => {
      const base = rowToCamel(r)
      delete base.sId; delete base.sName; delete base.sPhone; delete base.sBalance
      delete base.uId; delete base.uName
      return {
        ...base,
        supplier: r.supplier_id ? { id: r.s_id, name: r.s_name, phone: r.s_phone, balance: r.s_balance } : null,
        user: r.user_id ? { id: r.u_id, name: r.u_name } : null,
        items: itemsByPurchase.get(r.id) || [],
      }
    })
  }
  if (path.includes('/audit')) {
    // FIX: this used to return a bare array from `rows.map(rowToCamel)`.
    // The Audit screen reads `data.logs` and `data.pagination.total/hasMore`
    // Preserve the nested shape consumed by the audit screen.
    // undefined, so `setLogs(data?.logs || [])` always fell back to [] and
    // the log showed "no records" no matter how many operations happened.
    // Also restored the action/entity/date filters and pagination that the
    // UI already sends, and joined users so log.user.name/username/role
    // render instead of blank "—".
    const url = new URL(`http://x${path}`)
    const action = url.searchParams.get('action')
    const entity = url.searchParams.get('entity')
    const dateFrom = url.searchParams.get('dateFrom')
    const dateTo = url.searchParams.get('dateTo')
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 1000)
    const offset = parseInt(url.searchParams.get('offset') || '0')

    // audit_logs: per PHASE-1C spec, hard-deleted — no deleted_at filter here.
    const whereParts: string[] = ['1=1']
    const args: unknown[] = []
    if (action) { whereParts.push('a.action = ?'); args.push(action) }
    if (entity) { whereParts.push('a.entity = ?'); args.push(entity) }
    if (dateFrom) { whereParts.push('a.created_at >= ?'); args.push(dateFrom) }
    if (dateTo) { whereParts.push('a.created_at <= ?'); args.push(dateTo) }
    const where = whereParts.join(' AND ')

    const rows = await db.select(
      `SELECT a.*, u.name as user_name, u.username as user_username, u.role as user_role
       FROM audit_logs a
       LEFT JOIN users u ON a.user_id = u.id
       WHERE ${where}
       ORDER BY a.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      args
    )
    const countRows = await db.select(`SELECT COUNT(*) as cnt FROM audit_logs a WHERE ${where}`, args)
    const total = countRows[0]?.cnt || 0

    const logs = rows.map((r) => {
      const camel = rowToCamel(r)
      camel.user = r.user_id ? { id: r.user_id, name: r.user_name, username: r.user_username, role: r.user_role } : null
      delete camel.userName; delete camel.userUsername; delete camel.userRole
      return camel
    })
    return { logs, pagination: { total, limit, offset, hasMore: offset + logs.length < total } }
  }
  if (path.includes('/platform')) return handlePlatform(db)
  if (path.includes('/setup-db')) return { needsSetup: false, tablesExist: true }
  // IMPORTANT: check '/setup/status' BEFORE the generic '/setup' check,
  // otherwise '/setup/status' would match '/setup' and try to call
  // handleSetup() which is a POST handler — wrong method.
  if (path.includes('/setup/status')) {
    const users = await db.select('SELECT COUNT(*) as count FROM users WHERE deleted_at IS NULL')
    const setupRows = await db.select("SELECT value FROM settings WHERE key = 'system.needsSetup' LIMIT 1")
    const needsSetup = users[0]?.count === 0 || setupRows[0]?.value === 'true'
    return { needsSetup }
  }
  if (path.includes('/setup/complete')) {
    // GET on /setup/complete — return current status (not yet implemented as GET,
    // but prevent it from falling through to handleSetup below)
    const setupRows = await db.select("SELECT value FROM settings WHERE key = 'system.needsSetup' LIMIT 1")
    return { needsSetup: setupRows[0]?.value === 'true' }
  }
  if (path.includes('/setup')) {
    // Generic /setup GET — return setup status
    const users = await db.select('SELECT COUNT(*) as count FROM users WHERE deleted_at IS NULL')
    const setupRows = await db.select("SELECT value FROM settings WHERE key = 'system.needsSetup' LIMIT 1")
    const needsSetup = users[0]?.count === 0 || setupRows[0]?.value === 'true'
    return { needsSetup }
  }
  if (path.includes('/settings')) {
    const rows = await db.select('SELECT * FROM settings')
    const flat = rows.map((r) => ({ key: r.key, value: r.value, category: r.category }))
    const grouped: any = {}
    for (const s of flat) { if (!grouped[s.category]) grouped[s.category] = {}; grouped[s.category][s.key] = s.value }
    return { grouped, flat }
  }

  if (!schema) return []

  if (entityId) {
    // Single-entity lookup — apply deleted_at filter when the table has the column.
    const hasDeletedAt = schema.columns.includes('deleted_at')
    const rows = await db.select(
      hasDeletedAt
        ? `SELECT * FROM ${schema.table} WHERE id = ? AND deleted_at IS NULL LIMIT 1`
        : `SELECT * FROM ${schema.table} WHERE id = ? LIMIT 1`,
      [entityId]
    )
    const row = rows[0]
    if (!row) return null
    const camelRow = rowToCamel(row)
    if (tableName === 'products') {
      camelRow.currentStock = row.current_stock
      camelRow.stockLevels = [{ quantity: row.current_stock }]
      // FIX: same category-not-showing bug as the list handler — the
      // product edit form (openEdit in products.tsx) reads
      // `p.categoryId` directly so that part worked, but anywhere this
      // single-product fetch feeds a nested `.category.nameAr` display
      // (e.g. quick views) it was silently blank.
      if (row.category_id) {
        const catRows = await db.select('SELECT id, name, name_ar, color, icon FROM categories WHERE id = ? LIMIT 1', [row.category_id])
        camelRow.category = catRows[0] ? { id: catRows[0].id, name: catRows[0].name, nameAr: catRows[0].name_ar, color: catRows[0].color, icon: catRows[0].icon } : null
      } else {
        camelRow.category = null
      }
    }
    if (tableName === 'sales') {
      const items = await db.select('SELECT * FROM sale_items WHERE sale_id = ? AND deleted_at IS NULL', [entityId])
      camelRow.items = items.map((i) => rowToCamel(i))
      // BUG FIX: the web route's GET /sales/[id] includes `returns` (with
      // their items) so the Sales module's refund dialog can compute how
      // much of each line was already returned in an earlier partial
      // refund. This desktop handler never attached it, so on desktop the
      // refund dialog always thought nothing had been returned yet and let
      // the max quantity default back to the full original quantity —
      // producing "أقصى كمية: 0" errors from handleSaleRefund's real
      // double-refund guard once the user tried to submit.
      const returnRows = await db.select('SELECT * FROM sale_returns WHERE sale_id = ? ORDER BY created_at DESC', [entityId])
      camelRow.returns = []
      for (const r of returnRows) {
        const retItems = await db.select('SELECT * FROM sale_return_items WHERE sale_return_id = ?', [r.id])
        camelRow.returns.push({ ...rowToCamel(r), items: retItems.map((i) => rowToCamel(i)) })
      }
    }

    if (tableName === 'suppliers') {
      const purchases = await db.select(`
        SELECT p.*, s.name as supplier_name
        FROM purchases p JOIN suppliers s ON s.id=p.supplier_id
        WHERE p.supplier_id = ? AND p.deleted_at IS NULL
        ORDER BY p.created_at DESC LIMIT 50
      `,[entityId])
      const payments = await db.select(`
        SELECT pp.*, u.name as user_name
        FROM purchase_payments pp
        JOIN purchases px ON px.id=pp.purchase_id AND px.deleted_at IS NULL
        LEFT JOIN users u ON u.id=pp.user_id
        WHERE pp.supplier_id=?
        ORDER BY pp.paid_at DESC, pp.created_at DESC LIMIT 100
      `,[entityId])
      const totalPurchases = round2(purchases.reduce((sum:any,p:any)=>sum+Number(p.total||0),0))
      const totalPaid = round2(payments.reduce((sum:any,p:any)=>sum+Number(p.amount||0),0))
      camelRow.purchases = []
      for (const p of purchases) {
        const items = await db.select(`SELECT pi.*, pr.name pr_name, pr.name_ar pr_name_ar, pr.sku pr_sku FROM purchase_items pi LEFT JOIN products pr ON pr.id=pi.product_id WHERE pi.purchase_id=?`,[p.id])
        camelRow.purchases.push({ ...rowToCamel(p), items: items.map((i)=>({ ...rowToCamel(i), product: { id:i.product_id, name:i.pr_name, nameAr:i.pr_name_ar, sku:i.pr_sku } })) })
      }
      camelRow.payments = payments.map((p)=>({ ...rowToCamel(p), user:p.user_name?{name:p.user_name}:null }))
      camelRow.summary = { totalPurchases, totalPaid, balance: round2(Math.max(0, Number(row.balance || 0))), purchaseCount: purchases.length, paymentCount: payments.length }
    }
    if (tableName === 'customers') {
      const acct = await db.select('SELECT * FROM loyalty_accounts WHERE customer_id = ? AND deleted_at IS NULL LIMIT 1', [entityId])
      camelRow.loyaltyAccount = acct[0] ? rowToCamel(acct[0]) : null
      // FIX: the customer detail dialog reads detail.sales and
      // detail.loyaltyTransactions ("آخر المشتريات" / "حركات الولاء" tabs)
      // — neither was ever populated here, so both always showed empty
      // ("لا توجد مشتريات" / "لا توجد حركات ولاء") no matter how much
      // return the customer's actual local history:
      // `include: { sales, loyaltyTransactions }`.
      const salesRows = await db.select(
        'SELECT * FROM sales WHERE customer_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 10',
        [entityId]
      )
      camelRow.sales = []
      for (const s of salesRows) {
        const items = await db.select('SELECT * FROM sale_items WHERE sale_id = ? AND deleted_at IS NULL', [s.id])
        camelRow.sales.push({ ...rowToCamel(s), items: items.map((i) => rowToCamel(i)) })
      }
      const txnRows = await db.select(
        'SELECT * FROM loyalty_transactions WHERE customer_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 20',
        [entityId]
      )
      camelRow.loyaltyTransactions = txnRows.map((t) => rowToCamel(t))
    }
    return camelRow
  }

  const url = new URL(`http://x${path}`)
  const search = url.searchParams.get('search')
  const period = url.searchParams.get('period')
  const paymentMethod = url.searchParams.get('paymentMethod')
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 1000)
  let sql = `SELECT * FROM ${schema.table}`
  const args: unknown[] = []
  const hasDeletedAt = schema.columns.includes('deleted_at')
  const tablesWithActive = ['products', 'customers', 'suppliers']
  const hasActive = tablesWithActive.includes(tableName)

  // Build the WHERE clause from: search term, active flag (if applicable),
  // and deleted_at IS NULL (if the table has the column). Each filter is
  // appended with the correct AND / leading-WHERE connector.
  const whereParts: string[] = []
  
  // Sales-specific filters
  if (tableName === 'sales') {
    whereParts.push('status != ?')
    args.push('REFUNDED')
    
    // Period filter
    if (period === 'today') {
      const start = new Date()
      start.setHours(0, 0, 0, 0)
      whereParts.push('created_at >= ?')
      args.push(start.toISOString())
    } else if (period === 'week') {
      const start = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      whereParts.push('created_at >= ?')
      args.push(start.toISOString())
    } else if (period === 'month') {
      const start = new Date()
      start.setDate(1)
      start.setHours(0, 0, 0, 0)
      whereParts.push('created_at >= ?')
      args.push(start.toISOString())
    }
    
    // Payment method filter
    if (paymentMethod && paymentMethod !== 'all') {
      whereParts.push('payment_method = ?')
      args.push(paymentMethod)
    }
  }
  
  if (search) {
    const searchFields = getSearchFields(tableName)
    if (searchFields.length > 0) {
      whereParts.push(`(${searchFields.map(f => `${f} LIKE ?`).join(' OR ')})`)
      const q = `%${search}%`
      searchFields.forEach(() => args.push(q))
    }
  }
  if (hasActive) whereParts.push("(active = 1 OR active = 'true')")
  if (hasDeletedAt) whereParts.push('deleted_at IS NULL')
  if (whereParts.length > 0) {
    sql += ' WHERE ' + whereParts.join(' AND ')
  }
  // Use string interpolation for LIMIT — safe because `limit` is a parsed integer
  sql += ` ORDER BY created_at DESC LIMIT ${limit}`

  // Development diagnostics only; never dump SQL parameters or row payloads in production.
  logger.debug(`[Desktop API] GET ${tableName}: executing query`)
  const rows = await db.select(sql, args)
  logger.debug(`[Desktop API] GET ${tableName}: returned ${rows.length} rows`)
  if (rows.length === 0) {
    // Try without filters to see if data exists at all
    const countRows = await db.select(`SELECT COUNT(*) as cnt FROM ${schema.table}`)
    logger.debug(`[Desktop API] GET ${tableName}: total rows without filters: ${countRows[0]?.cnt || 0}`)
    if (countRows[0]?.cnt > 0) {
      logger.debug(`[Desktop API] GET ${tableName}: rows exist but filters excluded them`)
    }
  }

  let results = rows.map(rowToCamel)

  if (tableName === 'products') {
    // FIX: same bug as the single-product GET below — products.tsx reads a
    // nested `p.category.nameAr`/`p.category.name` to render the category
    // badge in the list, but this generic list handler only ever returned
    // the flat `categoryId`. Batch-load categories once (cheap — there are
    // never more than a few dozen) and attach the nested object so the
    // Desktop list responses share one explicit shape for the UI.
    const allCats = await db.select('SELECT id, name, name_ar, color, icon FROM categories WHERE deleted_at IS NULL')
    const catMap = new Map(allCats.map((c) => [c.id, { id: c.id, name: c.name, nameAr: c.name_ar, color: c.color, icon: c.icon }]))
    results = results.map((r) => {
      r.currentStock = r.currentStock ?? 0
      r.stockLevels = [{ quantity: r.currentStock }]
      r.category = r.categoryId ? (catMap.get(r.categoryId) || null) : null
      return r
    })
  }
  if (tableName === 'customers') {
    for (const c of results) {
      const acct = await db.select('SELECT * FROM loyalty_accounts WHERE customer_id = ? AND deleted_at IS NULL LIMIT 1', [c.id])
      c.loyaltyAccount = acct[0] ? rowToCamel(acct[0]) : null
      // FIX: the customers screen reads c._count.sales for the "orders"
      // column (desktop and mobile card layouts both) — this was never
      // populated, so every customer showed 0 orders regardless of their
      // actual purchase history.
      const salesCount = await db.select('SELECT COUNT(*) as cnt FROM sales WHERE customer_id = ? AND deleted_at IS NULL', [c.id])
      c._count = { sales: salesCount[0]?.cnt || 0 }
    }
  }
  if (tableName === 'sales') {
    for (const s of results) {
      const items = await db.select('SELECT * FROM sale_items WHERE sale_id = ? AND deleted_at IS NULL', [s.id])
      s.items = items.map((i) => rowToCamel(i))
      // BUG FIX: mirrors the web route's GET /sales include of `returns` —
      // without it, sales.tsx's getRefundedTotal()/getNetTotal() always saw
      // an empty returns array on desktop, so a partially-refunded invoice
      // kept showing its full original total (and the refund dialog's
      // remaining-quantity guard had no prior-returns data to work with).
      const returnRows = await db.select(
        "SELECT * FROM sale_returns WHERE sale_id = ? AND status = 'COMPLETED' ORDER BY created_at DESC",
        [s.id]
      )
      s.returns = []
      for (const r of returnRows) {
        const retItems = await db.select('SELECT * FROM sale_return_items WHERE sale_return_id = ?', [r.id])
        s.returns.push({ ...rowToCamel(r), items: retItems.map((i) => rowToCamel(i)) })
      }
    }
  }
  return results
}



async function handleBackupExport(db):Promise<any>{
  const tableNames=['stores','warehouses','registers','users','settings','categories','brands','units','products','customers','suppliers','expense_categories','expenses','purchases','purchase_items','purchase_payments','sales','sale_items','sale_payments','sale_returns','sale_return_items','cash_sessions','cash_movements','stock_movements','stock_adjustments','loyalty_tiers','loyalty_accounts','loyalty_transactions','loyalty_campaigns','sku_sequences','invoice_sequences','general_accounts','general_journal_entries','general_journal_lines','audit_logs','sync_metadata','sync_queue']
  const tables:any={}
  for(const table of tableNames){
    const hasDeleted=await db.select(`SELECT COUNT(*) c FROM pragma_table_info('${table}') WHERE name='deleted_at'`).catch(()=>[])
    const rows=Number(hasDeleted[0]?.c||0)>0
      ? await db.select(`SELECT * FROM ${table} WHERE deleted_at IS NULL`).catch(async ()=>await db.select(`SELECT * FROM ${table}`))
      : await db.select(`SELECT * FROM ${table}`)
    tables[table]=rows
  }
  return {
    format:'nexflow-backup',
    version:3,
    schemaVersion:27,
    appVersion:'2.0.9',
    createdAt:new Date().toISOString(),
    tables,
  }
}

async function handleBackupRestore(db, body:any):Promise<any>{
  const auth=await requirePermission(db,'accounts.view')
  if(auth.role!=='OWNER'&&auth.role!=='ADMIN'&&!auth.permissions.includes('all')) throw new Error('استعادة النسخة الاحتياطية متاحة للإدارة فقط')
  const backup=body?.snapshot??body?.backup??body
  if(!backup||backup.format!=='nexflow-backup') throw new Error('ملف النسخة الاحتياطية غير صالح')
  const backupFormatVersion=Number(backup.version||0)
  if(backupFormatVersion<2 || backupFormatVersion>3) throw new Error(`إصدار النسخة الاحتياطية غير مدعوم (${backupFormatVersion})`)
  if(!backup.tables||typeof backup.tables!=='object') throw new Error('النسخة الاحتياطية لا تحتوي على بيانات')
  const localVersionRows=await db.select("SELECT COALESCE(MAX(version), 0) AS version FROM _sqlx_migrations").catch(()=>[])
  const localVersion=Number(localVersionRows[0]?.version||27), backupVersion=Number(backup.schemaVersion||0)
  if(backupVersion>localVersion) throw new Error(`هذه النسخة تحتاج قاعدة بيانات أحدث (${backupVersion} > ${localVersion})`)

  const tableNames=['stores','warehouses','registers','users','settings','categories','brands','units','products','customers','suppliers','expense_categories','expenses','purchases','purchase_items','purchase_payments','sales','sale_items','sale_payments','sale_returns','sale_return_items','cash_sessions','cash_movements','stock_movements','stock_adjustments','loyalty_tiers','loyalty_accounts','loyalty_transactions','loyalty_campaigns','sku_sequences','invoice_sequences','general_accounts','general_journal_entries','general_journal_lines','audit_logs','sync_metadata','sync_queue']
  const result:any={inserted:0,updated:0,keptLocal:0,skipped:0,conflicts:[],tables:{},dryRun:Boolean(body?.dryRun)}
  const timeOf=(r)=>{const raw=r?.updated_at??r?.created_at??r?.paid_at??r?.date;const t=raw?new Date(String(raw)).getTime():0;return Number.isFinite(t)?t:0}
  const cache=new Map<string,any>()
  const idMaps=new Map<string,Map<string,string>>()
  const actions:string[]=[]
  let stagedOpenCash=(await db.select("SELECT id FROM cash_sessions WHERE status='OPEN' AND deleted_at IS NULL LIMIT 1").catch(()=>[]))[0]?.id as string|undefined

  const getMeta=async(table:string)=>{if(cache.has(table))return cache.get(table);const rs=await db.select(`PRAGMA table_info(${table})`);const m={columns:rs.map((r)=>String(r.name)),pk:rs.find((r)=>Number(r.pk)===1)?.name||null};cache.set(table,m);return m}
  const mapFor=(table:string)=>{let m=idMaps.get(table);if(!m){m=new Map();idMaps.set(table,m)}return m}
  const remapId=(table:string,value:any)=>{if(value==null)return value;return mapFor(table).get(String(value))||value}
  const remapRef=(refType:any,value:any)=>{
    if(value==null||!refType)return value
    const key=String(refType).toLowerCase()
    const tableByRef:Record<string,string>={
      purchase:'purchases', purchasepayment:'purchase_payments', purchase_payment:'purchase_payments',
      sale:'sales', salepayment:'sale_payments', sale_payment:'sale_payments',
      salereturn:'sale_returns', sale_return:'sale_returns', cashsession:'cash_sessions', cash_session:'cash_sessions',
      cashmovement:'cash_movements', cash_movement:'cash_movements', stockmovement:'stock_movements', stock_movement:'stock_movements',
      expense:'expenses', loyaltytransaction:'loyalty_transactions', loyalty_transaction:'loyalty_transactions'
    }
    return remapId(tableByRef[key]||'',value)
  }
  const fixedRefs:Record<string,Record<string,string>>={
    warehouses:{store_id:'stores'},
    registers:{store_id:'stores',warehouse_id:'warehouses'},
    categories:{parent_id:'categories'},
    products:{category_id:'categories',brand_id:'brands',unit_id:'units',supplier_id:'suppliers',store_id:'stores'},
    expenses:{category_id:'expense_categories',user_id:'users'},
    purchases:{supplier_id:'suppliers',store_id:'stores',warehouse_id:'warehouses',user_id:'users'},
    purchase_items:{purchase_id:'purchases',product_id:'products'},
    purchase_payments:{purchase_id:'purchases',supplier_id:'suppliers',user_id:'users'},
    sales:{customer_id:'customers',user_id:'users'},
    sale_items:{sale_id:'sales',product_id:'products'},
    sale_payments:{sale_id:'sales',user_id:'users'},
    sale_returns:{sale_id:'sales',user_id:'users'},
    sale_return_items:{sale_return_id:'sale_returns',sale_item_id:'sale_items'},
    cash_sessions:{user_id:'users',register_id:'registers'},
    cash_movements:{session_id:'cash_sessions',user_id:'users'},
    stock_movements:{product_id:'products',warehouse_id:'warehouses',user_id:'users'},
    stock_levels:{product_id:'products',warehouse_id:'warehouses'},
    stock_adjustments:{product_id:'products',warehouse_id:'warehouses',user_id:'users'},
    loyalty_accounts:{customer_id:'customers'},
    loyalty_transactions:{customer_id:'customers',user_id:'users'},
    loyalty_campaigns:{product_id:'products'},
    general_journal_entries:{user_id:'users'},
    general_journal_lines:{entry_id:'general_journal_entries',account_id:'general_accounts'},
    audit_logs:{user_id:'users'}
  }
  const naturalKeys:Record<string,string[]>={
    stores:['name'], warehouses:['name','store_id'], registers:['name','warehouse_id'],
    categories:['name','name_ar'], expense_categories:['name','name_ar'], users:['username'],
    suppliers:['phone'], customers:['phone'], products:['sku','barcode'],
    purchases:['invoice_number'], sales:['invoice_number'], general_accounts:['code'], brands:['name'], units:['name'], loyalty_tiers:['name']
  }
  const normalizeKey=(v)=>v==null?'':String(v).trim().toLowerCase()

  const findExisting=async(table:string,row:any,m:any)=>{
    if(!m.pk)return {rows:[],matchedBy:null}
    let local=await db.select(`SELECT * FROM ${table} WHERE ${m.pk}=? LIMIT 1`,[row[m.pk]])
    if(local.length)return {rows:local,matchedBy:'id'}
    if(m.columns.includes('client_txn_id')&&row.client_txn_id){
      local=await db.select(`SELECT * FROM ${table} WHERE client_txn_id=? LIMIT 1`,[row.client_txn_id])
      if(local.length)return {rows:local,matchedBy:'client_txn_id'}
    }
    const keys=naturalKeys[table]||[]
    for(const key of keys){
      if(!m.columns.includes(key)||row[key]==null||normalizeKey(row[key])==='')continue
      const clauses=[`${key}=?`]; const vals:any[]=[row[key]]
      if(table==='warehouses'&&row.store_id){clauses.push('store_id=?');vals.push(remapId('stores',row.store_id))}
      if(table==='registers'&&row.warehouse_id){clauses.push('warehouse_id=?');vals.push(remapId('warehouses',row.warehouse_id))}
      if(table==='categories'&&row.parent_id!==undefined){clauses.push('COALESCE(parent_id,\'\')=?');vals.push(remapId('categories',row.parent_id)||'')}
      if(table==='purchases'&&row.supplier_id){clauses.push('supplier_id=?');vals.push(remapId('suppliers',row.supplier_id))}
      if(table==='products'&&key==='barcode') clauses.push("COALESCE(barcode,'')!=''")
      local=await db.select(`SELECT * FROM ${table} WHERE ${clauses.join(' AND ')} LIMIT 1`,vals)
      if(local.length)return {rows:local,matchedBy:key}
    }
    return {rows:[],matchedBy:null}
  }

  const remapRow=(table:string, source:any, columns:string[])=>{
    const row:any={}
    // FIX: avg_cost used to be unconditionally excluded here, on the same
    // "it's a derived value, don't trust a stale snapshot" reasoning as
    // current_stock below — but unlike current_stock, nothing ever
    // recomputed avg_cost afterward (no equivalent of the current_stock /
    // stock_levels rebuild further down uses purchase_items to rebuild it).
    // A restored backup therefore always came back with avg_cost=0/whatever
    // the local row already had, silently discarding the incoming cost
    // basis — the exact same "computed value never persisted" pattern that
    // was fixed in handleCreatePurchase. avg_cost is an ordinary business
    // fact like selling_price/purchase_cost, so let it flow through the
    // normal last-write-wins merge like every other product column.
    for (const c of columns) { if (table === 'products' && c === 'current_stock') continue; if (table === 'purchases' && c === 'paid_amount') continue; if (Object.prototype.hasOwnProperty.call(source, c)) row[c] = source[c] }
    const refs=fixedRefs[table]||{}
    for(const [column,targetTable] of Object.entries(refs)) if(row[column]!=null) row[column]=remapId(targetTable,row[column])
    if(Object.prototype.hasOwnProperty.call(row,'ref_id')) row.ref_id=remapRef(row.ref_type,row.ref_id)
    return row
  }

  // Preflight + action planning. No writes happen until every row has been validated
  // and all cross-device natural-key identity mappings are known.
  for(const table of tableNames){
    const incoming=Array.isArray(backup.tables[table])?backup.tables[table]:[]
    if(!incoming.length){result.tables[table]={inserted:0,updated:0,keptLocal:0,skipped:0};continue}
    const m=await getMeta(table).catch(()=>null)
    if(!m?.pk){result.skipped+=incoming.length;result.tables[table]={inserted:0,updated:0,keptLocal:0,skipped:incoming.length};continue}
    let ins=0,upd=0,kept=0,sk=0
    for(const raw of incoming){
      const originalId=raw[m.pk]
      if(originalId===undefined||originalId===null){sk++;continue}
      if(table==='cash_sessions'&&String(raw.status).toUpperCase()==='OPEN'){
        const mappedIncoming=remapId('cash_sessions',originalId)
        if(stagedOpenCash && String(stagedOpenCash)!==String(mappedIncoming)){
          mapFor('cash_sessions').set(String(originalId), String(stagedOpenCash))
          sk++;result.conflicts.push({table,id:originalId,reason:'open_cash_session_mapped_to_local'});continue
        }
        if(!stagedOpenCash) stagedOpenCash=String(mappedIncoming)
      }
      const {rows:locals}=await findExisting(table,raw,m)
      const local=locals[0]
      const mapped=remapRow(table,raw,m.columns)
      if(!locals.length){
        mapFor(table).set(String(originalId),String(mapped[m.pk]))
        const cols=Object.keys(mapped)
        if(!result.dryRun) actions.push(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map((c)=>sqlEsc(mapped[c])).join(',')})`)
        ins++
        continue
      }
      const localId=String(local[m.pk])
      mapFor(table).set(String(originalId),localId)
      if(table==='audit_logs'){sk++;continue}
      const incomingTs=timeOf(raw), localTs=timeOf(local)
      if(incomingTs<=localTs){sk++;kept++;continue}
      const cols=Object.keys(mapped).filter(c=>c!==m.pk)
      if(!cols.length){sk++;continue}
      if(!result.dryRun) actions.push(`UPDATE ${table} SET ${cols.map((c)=>`${c}=${sqlEsc(mapped[c])}`).join(',')} WHERE ${m.pk}=${sqlEsc(local[m.pk])}`)
      upd++
    }
    result.inserted+=ins;result.updated+=upd;result.keptLocal+=kept;result.skipped+=sk;result.tables[table]={inserted:ins,updated:upd,keptLocal:kept,skipped:sk}
  }

  if(!result.dryRun){
    // Reconciliation is part of the same transaction, so a partial restore cannot
    // leave supplier balances or invoice paid totals half-updated.
    actions.push(`UPDATE purchases SET paid_amount=MIN(total,MAX(0,COALESCE((SELECT SUM(pp.amount) FROM purchase_payments pp WHERE pp.purchase_id=purchases.id),0))) WHERE deleted_at IS NULL`)
    actions.push(`UPDATE purchases SET status=CASE WHEN paid_amount>=total THEN 'PAID' WHEN paid_amount>0 THEN 'PARTIAL' ELSE status END WHERE deleted_at IS NULL`)
    actions.push(`UPDATE suppliers SET balance=MAX(0,COALESCE((SELECT SUM(p.total) FROM purchases p WHERE p.supplier_id=suppliers.id AND p.deleted_at IS NULL),0)-COALESCE((SELECT SUM(pp.amount) FROM purchase_payments pp JOIN purchases px ON px.id=pp.purchase_id WHERE pp.supplier_id=suppliers.id AND px.deleted_at IS NULL),0)) WHERE deleted_at IS NULL`)
    // Rebuild derived stock truth from the immutable movement journal. This keeps
    // current_stock correct even when a backup was made on another device or the
    // incoming snapshot contained stale derived balances.
    actions.push(`UPDATE products SET current_stock=COALESCE((SELECT SUM(sm.quantity) FROM stock_movements sm WHERE sm.product_id=products.id AND sm.deleted_at IS NULL),0), updated_at=datetime('now') WHERE deleted_at IS NULL`)
    actions.push(`DELETE FROM stock_levels`)
    actions.push(`INSERT INTO stock_levels (id,product_id,warehouse_id,quantity,updated_at) SELECT lower(hex(randomblob(16))), sm.product_id, sm.warehouse_id, SUM(sm.quantity), datetime('now') FROM stock_movements sm JOIN products p ON p.id=sm.product_id AND p.deleted_at IS NULL WHERE sm.deleted_at IS NULL GROUP BY sm.product_id, sm.warehouse_id HAVING SUM(sm.quantity) != 0`)
    // The restore is submitted as one atomic batch. Never split BEGIN/COMMIT
    // over pooled `db.execute()` calls: doing so can bind transaction control
    // statements to different SQLite connections.
    await atomicExec(db, actions)
    if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('unikasher:data-changed',{detail:{method:'RESTORE',path:'/system/backup/restore'}}))
  }
  return {...result,message:result.dryRun?`معاينة الدمج: ${result.inserted} جديد، ${result.updated} محدث، ${result.keptLocal} محفوظ محليًا، ${result.skipped} متجاوز`:`تم دمج النسخة بأمان: ${result.inserted} جديد، ${result.updated} محدث، ${result.keptLocal} محفوظ محليًا، ${result.skipped} متجاوز`}
}


async function handleSystemIntegrity(db):Promise<any>{
  const auth=await requirePermission(db,'accounts.view')
  if(auth.role!=='OWNER'&&auth.role!=='ADMIN'&&!auth.permissions.includes('all')) throw new Error('فحص سلامة النظام متاح للإدارة فقط')
  const issues:any[]=[]
  const check=async(code:string,label:string,query:string,severity:'high'|'medium'|'low'='high', mapper:(r)=>any=(r)=>r)=>{
    const rows=await db.select(query).catch((e)=>{issues.push({code,label,severity,error:sqlErrorMsg(e)});return []})
    if(rows.length) issues.push({code,label,severity,count:rows.length,rows:rows.slice(0,20).map(mapper)})
  }
  await check('NEGATIVE_STOCK','مخزون سالب',`SELECT id, name, current_stock FROM products WHERE deleted_at IS NULL AND COALESCE(current_stock,0)<0`,'high')
  await check('STOCK_TRUTH_DRIFT','الرصيد الحالي لا يطابق دفتر حركة المخزون',`SELECT p.id,p.name,COALESCE(p.current_stock,0) current_stock,COALESCE(SUM(CASE WHEN sm.deleted_at IS NULL THEN sm.quantity ELSE 0 END),0) movement_stock FROM products p LEFT JOIN stock_movements sm ON sm.product_id=p.id WHERE p.deleted_at IS NULL GROUP BY p.id HAVING ROUND(COALESCE(p.current_stock,0)-COALESCE(SUM(CASE WHEN sm.deleted_at IS NULL THEN sm.quantity ELSE 0 END),0),2)!=0`,'high')
  await check('MISSING_AUTO_LEDGER','عمليات مالية بدون قيد تلقائي',`SELECT s.id AS ref_id,'Sale' AS reference_type FROM sales s LEFT JOIN general_journal_entries e ON e.reference_type='Sale' AND e.reference_id=s.id AND e.entry_source='AUTOMATIC' AND e.status='POSTED' WHERE s.deleted_at IS NULL AND e.id IS NULL UNION ALL SELECT p.id,'Purchase' FROM purchases p LEFT JOIN general_journal_entries e ON e.reference_type='Purchase' AND e.reference_id=p.id AND e.entry_source='AUTOMATIC' AND e.status='POSTED' WHERE p.deleted_at IS NULL AND e.id IS NULL UNION ALL SELECT x.id,'Expense' FROM expenses x LEFT JOIN general_journal_entries e ON e.reference_type='Expense' AND e.reference_id=x.id AND e.entry_source='AUTOMATIC' AND e.status='POSTED' WHERE x.deleted_at IS NULL AND e.id IS NULL UNION ALL SELECT r.id,'SaleReturn' FROM sale_returns r LEFT JOIN general_journal_entries e ON e.reference_type='SaleReturn' AND e.reference_id=r.id AND e.entry_source='AUTOMATIC' AND e.status='POSTED' WHERE r.status='COMPLETED' AND e.id IS NULL UNION ALL SELECT pp.id,'PurchasePayment' FROM purchase_payments pp JOIN purchases p ON p.id=pp.purchase_id AND p.deleted_at IS NULL LEFT JOIN general_journal_entries e ON e.reference_type='PurchasePayment' AND e.reference_id=pp.purchase_id AND e.entry_source='AUTOMATIC' AND e.status='POSTED' AND e.client_txn_id LIKE pp.client_txn_id || ':GL' WHERE e.id IS NULL`,'high')
  await check('DUP_SKU','تكرار SKU',`SELECT sku, COUNT(*) count FROM products WHERE deleted_at IS NULL GROUP BY sku HAVING COUNT(*)>1`,'high')
  await check('DUP_BARCODE','تكرار الباركود',`SELECT barcode, COUNT(*) count FROM products WHERE deleted_at IS NULL AND COALESCE(barcode,'')!='' GROUP BY barcode HAVING COUNT(*)>1`,'medium')
  await check('ORPHAN_SALE_ITEMS','أصناف بيع بدون فاتورة',`SELECT si.id, si.sale_id FROM sale_items si LEFT JOIN sales s ON s.id=si.sale_id WHERE s.id IS NULL`,'high')
  await check('ORPHAN_PURCHASE_ITEMS','أصناف شراء بدون فاتورة',`SELECT pi.id, pi.purchase_id FROM purchase_items pi LEFT JOIN purchases p ON p.id=pi.purchase_id WHERE p.id IS NULL`,'high')
  await check('ORPHAN_PAYMENT','دفعات موردين بدون فاتورة',`SELECT pp.id, pp.purchase_id FROM purchase_payments pp LEFT JOIN purchases p ON p.id=pp.purchase_id WHERE p.id IS NULL`,'medium')
  await check('UNBALANCED_JOURNAL','قيود محاسبية غير متوازنة',`SELECT e.id, e.entry_date, COALESCE(SUM(l.debit),0) debit, COALESCE(SUM(l.credit),0) credit FROM general_journal_entries e LEFT JOIN general_journal_lines l ON l.journal_entry_id=e.id WHERE e.status='POSTED' GROUP BY e.id HAVING ROUND(debit-credit,2)!=0`,'high')
  await check('PURCHASE_PAID_DRIFT','فواتير شراء مدفوعها لا يطابق سجل الدفعات',`SELECT p.id,p.total,p.paid_amount,COALESCE(SUM(pp.amount),0) history_paid FROM purchases p LEFT JOIN purchase_payments pp ON pp.purchase_id=p.id WHERE p.deleted_at IS NULL GROUP BY p.id HAVING ROUND(MIN(p.total,MAX(0,p.paid_amount))-MIN(p.total,MAX(0,COALESCE(SUM(pp.amount),0))),2)!=0`,'high')
  await check('SUPPLIER_BALANCE_DRIFT','رصيد مورد لا يطابق مشترياته ومدفوعاته',`SELECT s.id,s.name,s.balance,
    ROUND(MAX(0,COALESCE((SELECT SUM(p.total) FROM purchases p WHERE p.supplier_id=s.id AND p.deleted_at IS NULL),0)-COALESCE((SELECT SUM(pp.amount) FROM purchase_payments pp JOIN purchases px ON px.id=pp.purchase_id WHERE pp.supplier_id=s.id AND px.deleted_at IS NULL),0)),2) expected
    FROM suppliers s WHERE s.deleted_at IS NULL AND ROUND(COALESCE(s.balance,0)-expected,2)!=0`,'high')

  const openSessions=await db.select("SELECT id, register_id, opening_balance, user_id FROM cash_sessions WHERE status='OPEN' AND deleted_at IS NULL ORDER BY opened_at ASC")
  if(openSessions.length>1){
    issues.push({code:'MULTIPLE_OPEN_CASH_SESSIONS',label:'أكثر من خزنة مفتوحة في نفس الوقت',severity:'high',count:openSessions.length,rows:openSessions.slice(0,20)})
  }
  for(const session of openSessions){
    const movements=await db.select('SELECT type,amount FROM cash_movements WHERE session_id=? AND deleted_at IS NULL',[session.id])
    const expected=calculateExpectedCash(session.opening_balance,movements)
    if(expected<0) issues.push({code:'NEGATIVE_CASH',label:'خزنة برصيد متوقع سالب',severity:'high',count:1,rows:[{id:session.id,expected}]})
  }
  const orphanRefs=await db.select(`SELECT COUNT(*) count FROM stock_movements sm LEFT JOIN products p ON p.id=sm.product_id WHERE p.id IS NULL`).catch(()=>[{count:0}])
  if(Number(orphanRefs[0]?.count||0)>0) issues.push({code:'ORPHAN_STOCK_MOVEMENTS',label:'حركات مخزون بدون منتج',severity:'high',count:Number(orphanRefs[0].count)})
  return {ok:issues.length===0,checkedAt:new Date().toISOString(),issueCount:issues.reduce((n:any,i:any)=>n+(i.count||1),0),groups:issues.length,issues}
}

function getSearchFields(tableName: string): string[] {
  switch (tableName) {
    case 'sales': return ['invoice_number']
    case 'products': return ['name', 'name_ar', 'sku', 'barcode']
    case 'customers': return ['name', 'phone', 'email']
    case 'suppliers': return ['name', 'phone', 'email']
    default: return ['name']
  }
}

// ============================================================
// POST
// ============================================================
// Columns that are UNIQUE but not required. SQLite treats '' as a real,
// non-distinct value for UNIQUE — two rows both saved with '' collide and
// the second INSERT/UPDATE fails. NULL is always distinct from other NULLs,
// so blank optional fields must be stored as NULL, not ''.
const NULLABLE_UNIQUE_FIELDS = ['barcode', 'phone']
function normalizeNullableUnique(snakeBody: Record<string, any>) {
  for (const f of NULLABLE_UNIQUE_FIELDS) {
    if (snakeBody[f] === '') snakeBody[f] = null
  }
}

async function resolveDefaultWarehouseId(db, storeId?: string | null): Promise<string> {
  const args: unknown[] = []
  // warehouses table has NO deleted_at column (schema mismatch fix) —
  // the previous `WHERE deleted_at IS NULL` broke every product POST
  // with "no such column: deleted_at".
  let sql = "SELECT id FROM warehouses WHERE 1=1"
  if (storeId) { sql += ' AND store_id = ?'; args.push(storeId) }
  sql += ' ORDER BY name ASC LIMIT 1'
  const rows = await db.select(sql, args)
  if (rows[0]?.id) return String(rows[0].id)
  throw new Error('لا يوجد مخزن متاح لتسجيل حركة المخزون')
}

async function handlePost(db, tableName: string, path: string, options: RequestInit): Promise<any> {
  const body = JSON.parse(options.body as string)
  const schema = SCHEMA[tableName]
  if (path.includes('/auth/login')) return handleLogin(db, body)
  if (path.startsWith('/system/backup/restore')) return handleBackupRestore(db, body)
  // Generic CRUD writes are protected here as a second line of defense;
  // special financial handlers also enforce their narrower permissions.
  const genericPostPermission: Record<string, string> = {
    products: 'product.edit', categories: 'product.edit', customers: 'customers.create',
    suppliers: 'purchase.create', expenses: 'expense.create', purchases: 'purchase.create',
    settings: 'settings.edit', users: 'users.manage',
  }
  const genericPermission = genericPostPermission[tableName]
  if (genericPermission) await requirePermission(db, genericPermission)
  // IMPORTANT: check '/refund' BEFORE the generic `tableName === 'sales'`
  // check below. getTableName() maps ANY path starting with '/sales'
  // (including '/sales/{id}/refund') to tableName 'sales', so with the
  // old ordering a refund POST was routed to handleCreateSale() — which
  // validates the body against createSaleSchema (expects
  // items[].productId) instead of refundSchema (items[].saleItemId).
  // That produced "items.0.productId: Invalid input: expected string,
  // received undefined" on every refund attempt and no refund was ever
  // actually processed.
  // FIX: this used to be a bare `path.includes('/refund')`, which ALSO
  // matches '/loyalty/refund' (any path containing the substring
  // "/refund" — not just sale refunds). That silently hijacked every
  // loyalty points-refund call (removing a points-redeemed item from the
  // POS cart, decreasing its quantity, or cancelling the sale — see
  // pos.tsx removePointsAwareItem/decrementPointsItem/
  // clearCartRefundingPoints) into handleSaleRefund(), which expects a
  // completely different body shape (saleId + items[].saleItemId) and
  // would throw instead of ever crediting the points back. Scoping this
  // check to paths that actually start with '/sales/' keeps it matching
  // only real sale refunds, letting '/loyalty/refund' fall through to its
  // own explicit check further down.
  if (path.includes('/sales/') && path.includes('/refund')) return handleSaleRefund(db, path, body)
  if (tableName === 'sales') return handleCreateSale(db, body)
  if (tableName === 'customers') return handleCreateCustomer(db, body)
  if (tableName === 'users') return handleCreateUser(db, body)
  // IMPORTANT: check '/pay' BEFORE the generic `tableName === 'purchases'`
  // check below, for the same reason '/refund' is checked before 'sales'
  // above — getTableName() maps '/purchases/{id}/pay' to tableName
  // 'purchases' too, which would otherwise route a payment POST into
  // handleCreatePurchase() and try to create a brand-new invoice with no
  // items instead of settling the balance on an existing one.
  if (path.includes('/purchases/') && path.includes('/pay')) return handlePurchasePayment(db, path, body)
  if (tableName === 'purchases') return handleCreatePurchase(db, body)
  if (tableName === 'expenses') return handleCreateExpense(db, body)
  if (path.includes('/cash/open')) return handleCashOpen(db, body)
  if (path.includes('/cash/movement')) return handleCashMovement(db, body)
  if (path.includes('/cash/close')) return handleCashClose(db, body)
  if (path.includes('/inventory/adjust')) return handleInventoryAdjust(db, body)
  if (path.includes('/loyalty/redeem')) return handleLoyaltyRedeem(db, body)
  // IMPORTANT: same "/{id}/action" vs generic-CRUD ordering issue as
  // '/refund' and '/pay' above — getTableName() maps '/loyalty/refund' to
  // the 'loyalty_accounts' table and '/categories/{id}/assign-products' /
  // '/categories/{id}/bulk-price' to 'categories'. These must be checked
  // before any generic branch would treat them as a plain row create.
  if (path.includes('/loyalty/refund')) return handleLoyaltyRefund(db, body)
  if (path.includes('/categories/') && path.includes('/assign-products')) return handleCategoryAssignProducts(db, path, body)
  if (path.includes('/categories/') && path.includes('/bulk-price')) return handleCategoryBulkPrice(db, path, body)
  if (path.includes('/platform/lock')) return handlePlatformLock(db, body)
  if (path.startsWith('/general-accounts')) return handleGeneralAccountsPost(db, path, body)
  // IMPORTANT: check '/setup/complete' BEFORE the generic '/setup' check.
  // Otherwise '/setup/complete' would match '/setup' and call handleSetup()
  // (which is a no-op) instead of handleCompleteSetup() (which actually
  // sets the admin password and clears the needsSetup flag).
  // This was the root cause of the "must complete setup first" error
  // after the wizard was completed.
  if (path.includes('/setup/complete')) return handleCompleteSetup(db, body)
  if (path.includes('/setup') && !path.includes('/setup-db')) return handleSetup(db, body)

  if (!schema) throw new Error(`الجدول ${tableName} غير مدعوم`)
  const id = body.id || generateUUID()
  const snakeBody = objToSnake(body)

  if (tableName === 'products') {
    // Category is mandatory for every real product. This protects the SKU
    // engine and prevents uncategorized items from entering the POS.
    if (!snakeBody.category_id) throw new Error('لا يمكن حفظ المنتج بدون فئة')
    await ensureCategorySkuCode(db, String(snakeBody.category_id))
    if (!snakeBody.sku || !String(snakeBody.sku).trim()) {
      snakeBody.sku = await generateProductSku(db, String(snakeBody.category_id))
    }
    // Product form exposes one commercial acquisition value (شراء/جملة).
    // Keep the legacy DB fields synchronized for compatibility.
    const commercialCost = snakeBody.purchase_cost ?? snakeBody.wholesale_price
    if (commercialCost !== undefined) {
      const n = Number(commercialCost)
      if (!Number.isFinite(n) || n < 0) throw new Error('سعر الشراء/الجملة غير صالح')
      snakeBody.purchase_cost = n
      snakeBody.wholesale_price = n
    }
    // FIX: selling_price had no server-side floor, so a tampered/buggy
    // client request could save a negative selling price straight into
    // the products table — every sale of that product would then reduce
    // the invoice total (subtotal += negative lineTotal), letting a POS
    // transaction pay the customer instead of charging them.
    if (snakeBody.selling_price !== undefined) {
      const sp = Number(snakeBody.selling_price)
      if (!Number.isFinite(sp) || sp < 0) throw new Error('سعر البيع غير صالح')
      snakeBody.selling_price = sp
    }
  }

  // Map openingStock → current_stock for products
  if (tableName === 'categories') {
    if (snakeBody.dead_stock_days_override !== undefined) {
      const days = Number(snakeBody.dead_stock_days_override)
      snakeBody.dead_stock_days_override = Number.isFinite(days) && days >= 1 ? Math.min(3650, Math.floor(days)) : null
    }
    if (!snakeBody.sku_code) {
      // Category codes are generated once and then remain stable. This gives
      // every category/subcategory a distinct semantic prefix for product SKUs.
      // We cannot call ensureCategorySkuCode until the row exists, so it is
      // applied immediately after the upsert below.
    }
  }
  if (tableName === 'products') {
    // FIX: a negative opening stock used to be accepted at face value and
    // written directly into products.current_stock on creation. Every
    // other stock path (sales, purchases, refunds, adjustments) is
    // guarded — either by an explicit check or by the DB-level
    // prevent_negative_inventory triggers on stock_movements — but this
    // one bypasses stock_movements entirely on the INSERT, so those
    // triggers never see it and current_stock could start negative.
    if (snakeBody.opening_stock !== undefined) {
      const os = Number(snakeBody.opening_stock)
      if (!Number.isFinite(os) || os < 0) throw new Error('المخزون الافتتاحي لا يمكن أن يكون بالسالب')
      snakeBody.opening_stock = os
    }
    if (snakeBody.current_stock !== undefined) {
      const cs = Number(snakeBody.current_stock)
      if (!Number.isFinite(cs) || cs < 0) throw new Error('المخزون الحالي لا يمكن أن يكون بالسالب')
      snakeBody.current_stock = cs
    }
    if (snakeBody.opening_stock !== undefined && snakeBody.current_stock === undefined) {
      snakeBody.current_stock = snakeBody.opening_stock
    }
    delete snakeBody.opening_stock
    // Set avg_cost from purchase_cost if not provided
    if (snakeBody.avg_cost === undefined && snakeBody.purchase_cost !== undefined) {
      snakeBody.avg_cost = snakeBody.purchase_cost
    }
    if (snakeBody.dead_stock_days_override !== undefined) {
      const days = Number(snakeBody.dead_stock_days_override)
      snakeBody.dead_stock_days_override = Number.isFinite(days) && days >= 1 ? Math.min(3650, Math.floor(days)) : null
    }
  }

  // Convert JS booleans to SQLite integers (1/0) — same normalization
  // upsertRecord() already applies for server-synced rows (see below).
  // Without this, a product created locally with active:true / false could
  // be stored as the TEXT string "true"/"false" instead of 1/0 depending on
  // the SQL binding path, which then silently failed `WHERE active = 1`
  // queries (Inventory screen, dashboard counts) for that row until a
  // one-off migration cleanup ran. Normalizing here stops new rows from
  // reintroducing the bug that migration 005 patched retroactively.
  const BOOLEAN_COLUMNS_ON_WRITE = ['active', 'track_stock', 'allow_negative_stock']
  for (const col of BOOLEAN_COLUMNS_ON_WRITE) {
    if (col in snakeBody) {
      if (snakeBody[col] === true || snakeBody[col] === 'true') snakeBody[col] = 1
      else if (snakeBody[col] === false || snakeBody[col] === 'false') snakeBody[col] = 0
    }
  }

  if (!snakeBody.id) snakeBody.id = id
  normalizeNullableUnique(snakeBody)
  const columns = Object.keys(snakeBody).filter(k => schema.columns.includes(k))
  const values = columns.map(k => snakeBody[k])
  const existingBeforeWrite = tableName === 'products' ? await db.select('SELECT id FROM products WHERE id = ? LIMIT 1',[id]) : []
  const stmts: string[] = [upsertSql(schema.table, columns, values)]
  if (tableName === 'categories' && !snakeBody.sku_code) {
    // Category codes are generated after insertion because the category row
    // must exist first. Keep this follow-up in the same transaction by
    // generating the deterministic code in JS and updating the inserted row.
    const generated = await computeCategorySkuCode(db, String(snakeBody.name_ar || snakeBody.name || 'category'))
    snakeBody.sku_code = generated
    stmts.push(`UPDATE categories SET sku_code=${sqlEsc(generated)}, updated_at=datetime('now') WHERE id=${sqlEsc(id)}`)
  }
  if (tableName === 'products' && existingBeforeWrite.length === 0) {
    const opening = Number(snakeBody.current_stock || 0)
    if (Number.isFinite(opening) && opening > 0) {
      const warehouseId = await resolveDefaultWarehouseId(db, snakeBody.store_id || null)
      stmts.push(`INSERT OR IGNORE INTO stock_movements (id, client_txn_id, product_id, warehouse_id, type, quantity, ref_type, ref_id, note, user_id, sync_status, created_at) VALUES ${sqlVals([generateUUID(), `${id}:OPENING_STOCK`, id, warehouseId, 'OPENING_STOCK', Math.trunc(opening), 'Product', id, 'مخزون افتتاحي', null, 'pending', new Date().toISOString()])}`)
    }
  }
  const journalPayload = { ...body }
  if (snakeBody.sku !== undefined && journalPayload.sku === undefined) journalPayload.sku = snakeBody.sku
  if (snakeBody.sku_code !== undefined && journalPayload.skuCode === undefined) journalPayload.skuCode = snakeBody.sku_code
  const operationJournalSql = await buildOperationJournalStatement(db, tableName, id, journalPayload)
  stmts.push(operationJournalSql)
  await atomicExec(db, stmts)
  const rows = await db.select(`SELECT * FROM ${schema.table} WHERE id = ?`, [id])
  return rowToCamel(rows[0])
}

// ============================================================
// PUT
// ============================================================
async function handlePut(db, tableName: string, path: string, entityId: string, options: RequestInit): Promise<any> {
  const body = JSON.parse(options.body as string)
  const schema = SCHEMA[tableName]
  if (!schema) throw new Error(`الجدول ${tableName} غير مدعوم`)

  // Special handlers for tables that don't fit the generic id-keyed UPDATE pattern.
  // - users: must hash body.password via bcrypt before touching password_hash.
  // - settings: uses `key` as PRIMARY KEY, not `id`; body may be a batch array.
  if (tableName === 'users') return handleUpdateUser(db, entityId, body)
  if (tableName === 'settings') return handlePutSettings(db, body)
  if (path.startsWith('/general-accounts')) return handleGeneralAccountsPut(db, entityId || '', body)

  const snakeBody = objToSnake(body)
  if (tableName === 'products') {
    const existingProduct = (await db.select('SELECT category_id,purchase_cost,wholesale_price,sku FROM products WHERE id=? LIMIT 1',[entityId]))[0]
    if (!existingProduct) throw new Error('المنتج غير موجود')
    const nextCategory = snakeBody.category_id !== undefined ? snakeBody.category_id : existingProduct.category_id
    if (!nextCategory) throw new Error('لا يمكن حفظ المنتج بدون فئة')
    snakeBody.category_id = nextCategory
    await ensureCategorySkuCode(db, String(nextCategory))
    const commercialCost = snakeBody.purchase_cost ?? snakeBody.wholesale_price
    if (commercialCost !== undefined) {
      const n = Number(commercialCost)
      if (!Number.isFinite(n) || n < 0) throw new Error('سعر الشراء/الجملة غير صالح')
      snakeBody.purchase_cost = n
      snakeBody.wholesale_price = n
    }
    // FIX: same negative-price gap as handlePost — editing a product's
    // selling price had no floor, so it could be saved negative and
    // invert every sale total for that product.
    if (snakeBody.selling_price !== undefined) {
      const sp = Number(snakeBody.selling_price)
      if (!Number.isFinite(sp) || sp < 0) throw new Error('سعر البيع غير صالح')
      snakeBody.selling_price = sp
    }
  }
  if (tableName === 'categories' && snakeBody.dead_stock_days_override !== undefined) {
    const days = Number(snakeBody.dead_stock_days_override)
    snakeBody.dead_stock_days_override = Number.isFinite(days) && days >= 1 ? Math.min(3650, Math.floor(days)) : null
  }
  if (tableName === 'products') {
    // current_stock is derived from stock_movements. It may only be changed by
    // inventory operations/restore, never by generic product editing.
    delete snakeBody.current_stock
    delete snakeBody.pending_stock_delta
  }
  if (tableName === 'products' && snakeBody.dead_stock_days_override !== undefined) {
    const days = Number(snakeBody.dead_stock_days_override)
    snakeBody.dead_stock_days_override = Number.isFinite(days) && days >= 1 ? Math.min(3650, Math.floor(days)) : null
  }
  // Same boolean normalization as handlePost — see the comment there.
  // Toggling "active" from the Products edit form goes through this path.
  const BOOLEAN_COLUMNS_ON_WRITE = ['active', 'track_stock', 'allow_negative_stock']
  for (const col of BOOLEAN_COLUMNS_ON_WRITE) {
    if (col in snakeBody) {
      if (snakeBody[col] === true || snakeBody[col] === 'true') snakeBody[col] = 1
      else if (snakeBody[col] === false || snakeBody[col] === 'false') snakeBody[col] = 0
    }
  }
  normalizeNullableUnique(snakeBody)
  const columns = Object.keys(snakeBody).filter(k => schema.columns.includes(k) && k !== 'id')
  const values = columns.map(k => snakeBody[k])

  // Bump updated_at on every UPDATE so delta sync (WHERE updated_at > ?)
  // picks up the change. Only applies when the table actually has an
  // updated_at column (per schema.columns).
  const setClauses = columns.map(k => `${k} = ?`)
  if (schema.columns.includes('updated_at')) {
    setClauses.push("updated_at = datetime('now')")
  }

  if (setClauses.length === 0) {
    // Nothing to update — return the unchanged row.
    const noChangeRows = await db.select(`SELECT * FROM ${schema.table} WHERE id = ?`, [entityId])
    return rowToCamel(noChangeRows[0])
  }

  values.push(entityId)
  const operationJournalSql = await buildOperationJournalStatement(db, tableName, entityId, body, 'UPDATE')
  await atomicExec(db, [
    updateSql(`${schema.table}`, setClauses, values, entityId),
    operationJournalSql,
  ])
  const rows = await db.select(`SELECT * FROM ${schema.table} WHERE id = ?`, [entityId])
  return rowToCamel(rows[0])
}

// ============================================================
// DELETE
// ============================================================
async function handleDelete(db, tableName: string, entityId: string): Promise<any> {
  await requirePermission(db, 'data.delete')
  // Tables that have a `deleted_at` column (migration 002) → soft delete.
  // The row is marked deleted but kept for sync + historical reporting.
  // Per PHASE-1C spec, audit_logs is intentionally NOT soft-deleted
  // (audit logs are immutable historical records; hard-delete on demand).
  const SOFT_DELETE_TABLES = [
    'products', 'categories', 'customers', 'suppliers', 'users',
    'sales', 'sale_items', 'stock_movements', 'cash_sessions', 'cash_movements',
    'expenses', 'loyalty_accounts', 'loyalty_transactions', 'purchases',
    'purchase_items',
  ]
  // Subset of soft-delete tables that ALSO have an `active` column —
  // we toggle it to 0 so legacy `WHERE active = 1` queries keep working.
  const ACTIVE_TABLES = new Set(['products', 'customers', 'suppliers', 'users', 'loyalty_campaigns'])

  const stmts: string[] = []
  if (SOFT_DELETE_TABLES.includes(tableName)) {
    let supplierIdToRecalc: string | null = null
    if (tableName === 'purchases') {
      const beforeDelete = await db.select('SELECT supplier_id FROM purchases WHERE id = ? LIMIT 1', [entityId])
      supplierIdToRecalc = beforeDelete[0]?.supplier_id || null
    }
    const setClause = ACTIVE_TABLES.has(tableName)
      ? "deleted_at = datetime('now'), active = 0"
      : "deleted_at = datetime('now')"
    stmts.push(`UPDATE ${tableName} SET ${setClause} WHERE id = ${sqlEsc(entityId)}`)
    if (tableName === 'purchases' && supplierIdToRecalc) {
      stmts.push(`UPDATE suppliers SET balance=MAX(0,
        COALESCE((SELECT SUM(p.total) FROM purchases p WHERE p.supplier_id=suppliers.id AND p.deleted_at IS NULL),0)
        - COALESCE((SELECT SUM(pp.amount) FROM purchase_payments pp JOIN purchases px ON px.id=pp.purchase_id WHERE pp.supplier_id=suppliers.id AND px.deleted_at IS NULL),0)),
        updated_at=datetime('now') WHERE id=${sqlEsc(supplierIdToRecalc)}`)
    }
  } else {
    // Tables without soft-delete (audit_logs, sync_queue, sync_metadata,
    // sale_payments, expense_categories, loyalty_tiers, etc.) — hard delete.
    stmts.push(`DELETE FROM ${tableName} WHERE id = ${sqlEsc(entityId)}`)
  }
  stmts.push(await buildOperationJournalStatement(db, tableName, entityId, {}, 'DELETE'))
  await atomicExec(db, stmts)
  return { id: entityId, deleted: true }
}

// ============================================================
// SPECIAL HANDLERS
// ============================================================

async function handleLogin(db, body: any): Promise<any> {
  const { username, password } = body
  if (!username || !password) throw new Error('ادخل اسم المستخدم وكلمة المرور')

  // ─── SETUP WIZARD CHECK ───
  // If system.needsSetup = 'true', login is blocked until the admin
  // completes the setup wizard (sets a real password). This prevents
  // anyone from logging in with the random seed password.
  const setupRows = await db.select("SELECT value FROM settings WHERE key = 'system.needsSetup' LIMIT 1")
  if (setupRows[0]?.value === 'true') {
    throw new Error('يجب إعداد النظام أولاً — أكمل معالج الإعداد')
  }

  // users is soft-deletable (migration 002) — exclude tombstoned accounts.
  const rows = await db.select('SELECT * FROM users WHERE username = ? AND deleted_at IS NULL LIMIT 1', [username])
  const user = rows[0]
  if (!user) throw new Error('اسم المستخدم غير موجود')
  if (!user.active) throw new Error('هذا الحساب معطل')
  const bcrypt = await import('bcryptjs')
  let valid = false
  try {
    valid = await bcrypt.compare(password, user.password_hash)
  } catch (e) {
    logger.error(`[Login] bcrypt error: ${sqlErrorMsg(e)}`)
  }
  if (!valid) throw new Error('كلمة المرور غير صحيحة')
  try {
    await db.execute(
      `INSERT INTO audit_logs (id, user_id, action, entity, entity_id, created_at) VALUES (?, ?, 'LOGIN', 'User', ?, datetime('now'))`,
      [generateUUID(), user.id, user.id]
    )
  } catch (auditError) { void auditError /* audit logging must not block login */ }

  // Desktop is intentionally offline-first. Do not send the local user's
  // credentials to any remote service from the desktop login path. Sync is
  // disabled in this build, so a server-issued token has no purpose here.
  const token = user.id

  return {
    token,
    user: {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      permissions: JSON.parse(user.permissions || '[]'),
      phone: user.phone,
      // SECURITY: PIN is NOT returned to the client. PIN is server-side only.
      // If PIN login is needed in the future, add it as a dedicated desktop authentication action.
      pin: null,
    }
  }
}

// ============================================================
// CREATE SALE — ATOMIC multi-table write via single execute() call
// ============================================================
// CRITICAL: tauri-plugin-sql does NOT support BEGIN/COMMIT across
// separate execute() calls. Each call may use a different pooled
// connection, causing "cannot commit - no transaction is active".
//
// FIX: concatenate ALL SQL statements into ONE execute() call.
// SQLite wraps the entire batch in an implicit transaction —
// if ANY statement fails, the WHOLE batch rolls back atomically.
// Values are inlined as escaped SQL literals (sqlEsc helper).
//
// IDEMPOTENCY: before creating, check if a sale with this clientTxnId
// already exists → return it (prevents duplicates from retries).
//
// STOCK VALIDATION: before decrementing, verify stock >= quantity.
// Reject sale if insufficient (unless allow_negative_stock = 1).
// ============================================================

async function handleCreateSale(db, body: any): Promise<any> {
  // ─── AUTH: get userId from session, NEVER from body ───
  const authUser = await requirePermission(db, 'sale.create')

  // ─── ZOD VALIDATION ───
  const parsed = createSaleSchema.safeParse(body)
  if (!parsed.success) throw new Error(zodError(parsed.error))
  const { items, customerId, discountAmount, taxAmount: _clientTaxAmount, taxExempt, total: _total, paidAmount, paymentMethod, paymentDetails, note, loyaltyRedeem } = parsed.data
  const userId = authUser.id  // ← from session, not body

  // Settings → الضرائب → "تفعيل الضريبة" is a store-wide switch — honor it
  // The desktop layer validates the same values server-side equivalent, so a stale/tampered client can't
  // still charge tax after the owner turned it off, or after the cashier
  // marked this specific invoice tax-exempt.
  const taxEnabledRows = await db.select("SELECT value FROM settings WHERE key = 'tax.enabled' LIMIT 1")
  const taxGloballyDisabled = taxEnabledRows[0]?.value === 'false'
  const effectiveTaxExempt = !!taxExempt || taxGloballyDisabled

  const saleId = generateUUID()
  const clientTxnId = parsed.data.clientTxnId || saleId
  const invoiceNumber = `LOCAL-${Date.now()}-${generateUUID().slice(0, 8).toUpperCase()}`
  const now = new Date().toISOString()

  // ─── IDEMPOTENCY CHECK ───
  // If this clientTxnId already exists, return the existing sale.
  // This prevents duplicate sales from sync retries or double-clicks.
  const existing = await db.select(
    'SELECT * FROM sales WHERE client_txn_id = ? LIMIT 1',
    [clientTxnId]
  )
  if (existing[0]) {
    logger.debug(`[Desktop API] Sale ${clientTxnId} already exists — returning (idempotent)`)
    const s = existing[0]
    return {
      id: s.id,
      clientTxnId: s.client_txn_id,
      invoiceNumber: s.invoice_number,
      customerId: s.customer_id,
      user: { name: 'الكاشير' },
      items: JSON.parse(s.items_json || '[]'),
      subtotal: s.subtotal,
      discountAmount: s.discount_amount,
      taxAmount: s.tax_amount,
      total: s.total,
      paidAmount: s.paid_amount,
      changeAmount: s.change_amount,
      paymentMethod: s.payment_method,
      loyaltyEarned: s.loyalty_earned,
      createdAt: s.created_at,
      idempotent: true,
    }
  }

  // ─── REQUIRE AN OPEN CASH REGISTER ───
  // Previously a sale could be completed with no open cash_session at all:
  // the code further below only *looked up* an open session to attach the
  // resulting cash movement to, and silently skipped recording that
  // movement if none was open — so the sale itself still went through
  // (stock decremented, invoice printed) but it was invisible to the
  // register/cash reconciliation, exactly the gap that let operations
  // happen "off the books". Now a sale simply cannot be created until a
  // register is opened, so every sale is guaranteed to be tied to a
  // session and counted correctly when that session is closed.
  const openRegisterRows = await db.select("SELECT id FROM cash_sessions WHERE status = 'OPEN' AND deleted_at IS NULL LIMIT 1")
  if (!openRegisterRows[0]) {
    throw new Error('لا يمكن إتمام عملية بيع قبل فتح الخزنة. من فضلك افتح الخزنة أولاً من شاشة الخزنة.')
  }

  // ─── PRE-VALIDATE PRODUCTS + STOCK, RECOMPUTE TOTALS SERVER-SIDE ───
  // Read all products first, check existence AND stock availability.
  //
  // IMPORTANT (calculation-correctness fix): `subtotal` here is the PURE
  // pre-tax amount (price × qty), matching the definition used everywhere
  // else in the app (pos.tsx cart totals, reports.tsx tax-rate column,
  // subtotal. `taxAmount` is summed separately from the
  // real product tax rates in the database — never trusted blindly from
  // the client — so a tampered or stale client value can't skew figures.
  // Previously this function summed (price×qty + tax) into `subtotal`,
  // which silently double-counted tax in every report that read the
  // subtotal/tax columns (e.g. the tax-rate breakdown and "gross before
  // tax" totals were wrong for every offline sale).
  let subtotal = 0
  let computedTaxAmount = 0
  const itemsData: any[] = []
  // Validate stock against the TOTAL requested quantity per product, not each
  // duplicate line independently. Two cart lines for the same product must
  // still be bounded by the same available stock.
  const saleQtyByProduct = new Map<string, number>()
  for (const item of items) {
    saleQtyByProduct.set(item.productId, (saleQtyByProduct.get(item.productId) || 0) + item.quantity)
  }
  const saleProductsById = new Map<string, any>()
  for (const [productId, totalQty] of saleQtyByProduct.entries()) {
    const productRows = await db.select('SELECT * FROM products WHERE id = ? AND deleted_at IS NULL LIMIT 1', [productId])
    const product = productRows[0]
    if (!product) throw new Error(`المنتج غير موجود: ${productId}`)
    saleProductsById.set(productId, product)
    const currentStock = Number(product.current_stock || 0)
    const allowNegative = product.allow_negative_stock === 1 || product.allow_negative_stock === 'true' || product.allow_negative_stock === true
    if (product.track_stock !== 0 && !allowNegative && currentStock < totalQty) {
      throw new Error(`المخزون غير كافي للمنتج "${product.name_ar || product.name}". المتوفر: ${currentStock}، المطلوب: ${totalQty}`)
    }
  }

  for (const item of items) {
    const product = saleProductsById.get(item.productId)
    const lineTotal = item.pointsRedeemed ? 0 : product.selling_price * item.quantity
    const lineTax = (item.pointsRedeemed || effectiveTaxExempt) ? 0 : round2(lineTotal * (product.tax_rate / 100))
    subtotal += lineTotal
    computedTaxAmount += lineTax
    // FIX: product_name is a denormalized snapshot — it's what every
    // future reprint (Sales tab, refunds, sync) actually reads back, since
    // it never re-joins the live product row. A points-redeemed line used
    // to snapshot the plain product name, so once the sale was saved there
    // was no way left to tell "٠ ج.م بالنقاط" apart from a manual
    // free/discounted item. Tag it here, once, at the only point the
    // information (pointsRedeemed) is actually available.
    const baseName = product.name_ar || product.name
    itemsData.push({
      productId: item.productId,
      productName: item.pointsRedeemed ? `${baseName} (بالنقاط)` : baseName,
      quantity: item.quantity,
      unitPrice: item.pointsRedeemed ? 0 : product.selling_price,
      taxRate: item.pointsRedeemed ? 0 : product.tax_rate,
      taxAmount: lineTax,
      total: round2(lineTotal + lineTax),
      costAtSale: product.avg_cost,
    })
  }
  subtotal = round2(subtotal)
  computedTaxAmount = round2(computedTaxAmount)

  // ─── LOYALTY REDEMPTION: validate against the real balance and compute
  // the discount server-side — never trust a client-supplied EGP amount
  // for this. Previously `loyaltyRedeem` was accepted and stored on the
  // sale row purely as a label: it was never subtracted from the
  // customer's loyalty_accounts balance, never logged as a REDEEM
  // transaction, and never actually reflected in the price charged
  // (safeDiscount below only ever saw the *manual* discount from the
  // cart, not the loyalty one) — so redeeming points in the POS looked
  // like it worked but didn't cost the customer anything or discount
  // the sale at all.
  let effectiveLoyaltyRedeem = 0
  let loyaltyDiscountAmount = 0
  if (customerId && loyaltyRedeem > 0) {
    const loyaltyCfgRows = await db.select(
      "SELECT key, value FROM settings WHERE key IN ('loyalty.enabled', 'loyalty.egpPerPoint')"
    )
    const cfg: Record<string, string> = {}
    for (const s of loyaltyCfgRows) cfg[s.key] = s.value
    const loyaltyEnabled = cfg['loyalty.enabled'] !== 'false'
    if (loyaltyEnabled) {
      const egpPerPoint = parseFloat(cfg['loyalty.egpPerPoint'] ?? '0.05') || 0
      const acctRows = await db.select('SELECT points FROM loyalty_accounts WHERE customer_id = ?', [customerId])
      const availablePoints = acctRows[0]?.points || 0
      if (loyaltyRedeem > availablePoints) {
        throw new Error(`رصيد النقاط غير كافٍ. المتاح: ${availablePoints} نقطة`)
      }
      effectiveLoyaltyRedeem = loyaltyRedeem
      loyaltyDiscountAmount = round2(effectiveLoyaltyRedeem * egpPerPoint)
    }
  }

  // Discount: trust the client for the *manual* discount amount, but the
  // loyalty portion is always the server-computed loyaltyDiscountAmount
  // above — never client-supplied. Clamp the combined total so a sale can
  // never legally go negative regardless of what was sent.
  const safeDiscount = Math.min(Math.max((discountAmount || 0) + loyaltyDiscountAmount, 0), round2(subtotal + computedTaxAmount))
  // ─── TAX: never trust a client-supplied EGP amount here either — same
  // reasoning as the loyalty discount above. Previously this did
  // `(taxAmount && taxAmount > 0) ? taxAmount : computedTaxAmount`, which
  // treated a client-sent 0 as "not provided" and silently fell back to
  // computedTaxAmount — so a tax-exempt sale (or one made while the store's
  // global tax switch was off) still got real tax recomputed and stamped
  // onto the saved invoice, which is what then showed up on the printed
  // receipt. The server now always uses its own computedTaxAmount, which
  // already honors effectiveTaxExempt above.
  const finalTaxAmount = computedTaxAmount
  const finalTotal = round2(Math.max(0, subtotal + finalTaxAmount - safeDiscount))
  const paid = paidAmount === undefined || paidAmount === null ? finalTotal : round2(paidAmount)
  const change = validateFullSalePayment(finalTotal, paid)

  const splitRows = Array.isArray((paymentDetails as any)?.splits) ? (paymentDetails as any).splits : []
  const paymentRows: Array<{method:'CASH'|'CARD'|'TRANSFER'|'OTHER'; amount:number}> = []
  if (paymentMethod === 'SPLIT') {
    if (!splitRows.length) throw new Error('الدفع المقسم يحتاج تفاصيل الدفعات')
    for (const raw of splitRows) {
      const m = String(raw?.method || '').toUpperCase()
      if (!['CASH','CARD','TRANSFER','OTHER'].includes(m)) throw new Error('طريقة دفع غير صالحة داخل الدفع المقسم')
      const amount = round2(Number(raw?.amount))
      if (!Number.isFinite(amount) || amount <= 0) continue
      paymentRows.push({method:m as any, amount})
    }
    const splitTotal = round2(paymentRows.reduce((sum,p)=>sum+p.amount,0))
    if (Math.abs(splitTotal-finalTotal) > 0.009) throw new Error(`مجموع الدفعات المقسمة (${splitTotal}) لا يساوي إجمالي الفاتورة (${finalTotal})`)
  } else {
    paymentRows.push({method:(paymentMethod || 'CASH') as any, amount:finalTotal})
  }
  const cashPortion = round2(paymentRows.filter(p=>p.method==='CASH').reduce((s,p)=>s+p.amount,0))

  // ─── LOYALTY POINTS: registered customers only, and only when the
  // loyalty program is enabled — read the real rate from settings
  // instead of a hardcoded "1 point per 10 EGP". The rule is sourced
  // from loyalty.pointsPerEgp in the desktop settings.
  // table; previously the desktop build ignored settings entirely and
  // always used a fixed divide-by-10, so changing the rate (or
  // disabling the program) in Settings had no effect on the desktop app.
  let loyaltyEarned = 0
  if (customerId && !effectiveLoyaltyRedeem) {
    const loyaltySettings = await db.select(
      "SELECT key, value FROM settings WHERE key IN ('loyalty.enabled', 'loyalty.pointsPerEgp')"
    )
    const settingsMap: Record<string, string> = {}
    for (const s of loyaltySettings) settingsMap[s.key] = s.value
    const loyaltyEnabled = settingsMap['loyalty.enabled'] !== 'false' // default: enabled
    if (loyaltyEnabled) {
      const rate = parseFloat(settingsMap['loyalty.pointsPerEgp'] ?? '0.1') || 0
      loyaltyEarned = Math.floor(finalTotal * rate)

      // ─── PRODUCT CAMPAIGN BONUS ───
      // Campaigns (see loyalty.tsx CampaignsTab / migration 008) are now
      // "buy this specific product, earn N extra points" — set per product
      // in Settings/Loyalty by the owner. Previously loyalty_campaigns rows
      // were created and listed in the UI but NEVER read anywhere during a
      // sale, so campaigns had zero real effect. This looks up any active
      // campaign for each purchased product and adds bonus_points × qty.
      const productIds = [...new Set(itemsData.map(i => i.productId))]
      if (productIds.length) {
        const placeholders = productIds.map(() => '?').join(',')
        const campaigns = await db.select(
          `SELECT * FROM loyalty_campaigns
           WHERE (active = 1 OR active = 'true') AND product_id IN (${placeholders})
             AND date(start_date) <= date(?) AND date(end_date) >= date(?)`,
          [...productIds, now, now]
        )
        if (campaigns.length) {
          const bonusByProduct = new Map<string, number>()
          for (const c of campaigns) bonusByProduct.set(c.product_id, (bonusByProduct.get(c.product_id) || 0) + (c.bonus_points || 0))
          for (const item of itemsData) {
            const bonus = bonusByProduct.get(item.productId)
            if (bonus) loyaltyEarned += bonus * item.quantity
          }
        }
      }
    }
  }

  // ─── FETCH OPEN CASH SESSION (for CASH payments) ───
  let cashSessionId: string | null = null
  if (cashPortion > 0) {
    const sessions = await db.select("SELECT id, user_id FROM cash_sessions WHERE status = 'OPEN' AND deleted_at IS NULL ORDER BY opened_at DESC LIMIT 1")
    const cashSession = sessions[0]
    if (!cashSession) throw new Error('لا يمكن إتمام البيع النقدي بدون خزنة مفتوحة')
    if (cashSession.user_id && cashSession.user_id !== userId) throw new Error('لا تملك صلاحية استخدام هذه الخزنة')
    cashSessionId = cashSession.id
  }

  const saleWarehouseId = await resolveDefaultWarehouseId(db, null)

  // ─── ATOMIC EXECUTE: all writes in ONE transaction ───
  // Previously this used 6+ separate db.execute() calls. If any call
  // after the first failed (network blip, constraint violation), the
  // database was left in an inconsistent state: sale recorded but
  // stock not decremented, or stock decremented but loyalty not
  // awarded, etc.
  //
  // FIX: build all statements as a single SQL batch and execute via
  // atomicExec(), which wraps them in BEGIN;...;COMMIT;. If ANY
  // statement fails, the entire batch rolls back — no partial writes.
  // Values are inlined as escaped SQL literals (sqlEsc) because
  // tauri-plugin-sql only supports ? placeholders for the FIRST
  // statement in a multi-statement execute().
  const stmts: string[] = [
    // 1. Sale header
    `INSERT INTO sales (id, client_txn_id, invoice_number, customer_id, user_id, items_json, subtotal, discount_amount, tax_amount, total, paid_amount, change_amount, payment_method, payment_details, loyalty_earned, loyalty_redeemed, note, status, sync_status, created_at, updated_at)
     VALUES ${sqlVals([saleId, clientTxnId, invoiceNumber, customerId || null, userId, JSON.stringify(itemsData),
       subtotal, safeDiscount, finalTaxAmount, finalTotal, paid, change,
       paymentMethod || 'CASH', JSON.stringify({splits: paymentRows}), loyaltyEarned, effectiveLoyaltyRedeem, note || '', 'COMPLETED', 'pending', now, now])}`,
  ]

  // 2. Sale items + stock decrement + stock movements
  for (const item of itemsData) {
    stmts.push(
      `INSERT INTO sale_items (id, sale_id, product_id, product_name, quantity, unit_price, tax_amount, total, cost_at_sale)
       VALUES ${sqlVals([generateUUID(), saleId, item.productId, item.productName, item.quantity, item.unitPrice, item.taxAmount, item.total, item.costAtSale])}`
    )
    stmts.push(
      `INSERT INTO stock_movements (id, client_txn_id, product_id, warehouse_id, type, quantity, ref_type, ref_id, note, sync_status, created_at)
       VALUES ${sqlVals([generateUUID(), `${clientTxnId}:${item.productId}:STOCK`, item.productId, saleWarehouseId, 'SALE', -item.quantity, 'Sale', saleId, invoiceNumber, 'pending', now])}`
    )
  }

  // 3. Payment records — SPLIT is normalized into one row per method.
  for (const [paymentIndex, p] of paymentRows.entries()) {
    stmts.push(
      `INSERT INTO sale_payments (id, client_txn_id, sale_id, method, amount, created_at, sync_status)
       VALUES ${sqlVals([generateUUID(), `${clientTxnId}:PAY:${paymentIndex}`, saleId, p.method, p.amount, now, 'pending'])}`
    )
  }

  // 4. Loyalty earn (if applicable)
  if (customerId && loyaltyEarned > 0) {
    stmts.push(
      `INSERT INTO loyalty_accounts (id, customer_id, points, total_earned, total_redeemed, tier, updated_at)
       VALUES ${sqlVals([generateUUID(), customerId, loyaltyEarned, loyaltyEarned, 0, 'BRONZE', now])}
       ON CONFLICT(customer_id) DO UPDATE SET points = points + ${sqlEsc(loyaltyEarned)}, total_earned = total_earned + ${sqlEsc(loyaltyEarned)}, updated_at = ${sqlEsc(now)}`
    )
    stmts.push(
      `INSERT INTO loyalty_transactions (id, client_txn_id, customer_id, type, points, ref_type, ref_id, note, sync_status, created_at)
       VALUES ${sqlVals([generateUUID(), `${clientTxnId}:LOYALTY`, customerId, 'EARN', loyaltyEarned, 'Sale', saleId, `نقاط من ${invoiceNumber}`, 'pending', now])}`
    )
  }

  // 4b. Loyalty redeem (if applicable) — actually debit the balance and
  // log the transaction, which previously never happened (see comment
  // above where effectiveLoyaltyRedeem/loyaltyDiscountAmount are computed).
  if (customerId && effectiveLoyaltyRedeem > 0) {
    stmts.push(
      `UPDATE loyalty_accounts SET points = points - ${sqlEsc(effectiveLoyaltyRedeem)}, total_redeemed = total_redeemed + ${sqlEsc(effectiveLoyaltyRedeem)}, updated_at = ${sqlEsc(now)} WHERE customer_id = ${sqlEsc(customerId)}`
    )
    stmts.push(
      `INSERT INTO loyalty_transactions (id, client_txn_id, customer_id, type, points, ref_type, ref_id, note, sync_status, created_at)
       VALUES ${sqlVals([generateUUID(), `${clientTxnId}:LOYALTY_REDEEM`, customerId, 'REDEEM', -effectiveLoyaltyRedeem, 'Sale', saleId, `استبدال نقاط في ${invoiceNumber} (خصم ${loyaltyDiscountAmount})`, 'pending', now])}`
    )
  }

  // 5. Cash movement (if CASH + open session)
  if (cashSessionId) {
    stmts.push(
      `INSERT INTO cash_movements (id, client_txn_id, session_id, type, amount, note, ref_type, ref_id, sync_status, created_at)
       VALUES ${sqlVals([generateUUID(), `${clientTxnId}:CASH`, cashSessionId, 'SALE', cashPortion, invoiceNumber, 'Sale', saleId, 'pending', now])}`
    )
  }

  // 6. Automatic General Ledger entry — generated from the same sale transaction.
  const saleJournalLines: Array<{accountId:string; debit?:number; credit?:number; note?:string}> = []
  for (const p of paymentRows) saleJournalLines.push({accountId:p.method==='CASH' ? 'ga-cash' : (p.method==='CARD' || p.method==='TRANSFER' ? 'ga-bank' : 'ga-cash-outside'), debit:p.amount})
  const netRevenue = round2(Math.max(0, finalTotal - finalTaxAmount))
  saleJournalLines.push({accountId:'ga-sales', credit:netRevenue, note:`مبيعات ${invoiceNumber}`})
  if (finalTaxAmount > 0) saleJournalLines.push({accountId:'ga-sales-tax', credit:finalTaxAmount, note:`ضريبة مبيعات ${invoiceNumber}`})
  const saleCogs = round2(itemsData.reduce((sum,i)=>sum + Math.max(0,Number(i.costAtSale||0))*i.quantity,0))
  if (saleCogs > 0) {
    saleJournalLines.push({accountId:'ga-cogs', debit:saleCogs})
    saleJournalLines.push({accountId:'ga-inventory', credit:saleCogs})
  }
  stmts.push(...autoJournalStatements({
    entryId: generateUUID(), clientTxnId:`${clientTxnId}:GL`, entryNo:makeJournalEntryNo('S',clientTxnId,now), entryDate:now,
    description:`بيع ${invoiceNumber}`, referenceType:'Sale', referenceId:saleId, userId, lines:saleJournalLines
  }))

  // 6. Audit log
  stmts.push(
    `INSERT INTO audit_logs (id, user_id, action, entity, entity_id, after, created_at)
     VALUES ${sqlVals([generateUUID(), userId, 'CREATE_SALE', 'Sale', saleId, JSON.stringify({ total: finalTotal, items: itemsData.length, paymentMethod }), now])}`
  )

  // 7. Local operation journal entry
  stmts.push(
    `INSERT INTO sync_queue (entity_type, entity_id, client_txn_id, operation, payload, status, created_at)
     VALUES ${sqlVals(['Sale', saleId, clientTxnId, 'CREATE', JSON.stringify({ ...parsed.data, clientTxnId, invoiceNumber, userId }), 'PENDING', now])}`
  )

  try {
    await atomicExec(db, stmts)
  } catch (e) {
    if (isUniqueConstraintError(e)) {
      const raced = await db.select('SELECT id, client_txn_id, invoice_number FROM sales WHERE client_txn_id = ? LIMIT 1', [clientTxnId])
      if (raced[0]) return { id: raced[0].id, clientTxnId: raced[0].client_txn_id, invoiceNumber: raced[0].invoice_number, idempotent: true }
    }
    throw new Error(`فشل إنشاء البيع: ${sqlErrorMsg(e)}`)
  }

  return {
    id: saleId,
    clientTxnId,
    invoiceNumber,
    customerId,
    user: { name: 'الكاشير' },
    items: itemsData.map(i => ({ product: { nameAr: i.productName, name: i.productName }, quantity: i.quantity, unitPrice: i.unitPrice, total: i.total })),
    subtotal,
    discountAmount: safeDiscount,
    taxAmount: finalTaxAmount,
    total: finalTotal,
    paidAmount: paid,
    changeAmount: change,
    paymentMethod: paymentMethod || 'CASH',
    loyaltyEarned,
    createdAt: now,
  }
}

async function handleCreateCustomer(db, body: any): Promise<any> {
  await requirePermission(db, 'customers.create')
  const id = generateUUID()
  const { name, phone, email, address, tier } = body
  if (phone) {
    // customers is soft-deletable — only consider live rows for the duplicate check.
    const existing = await db.select('SELECT * FROM customers WHERE phone = ? AND deleted_at IS NULL LIMIT 1', [phone])
    if (existing[0]) return rowToCamel(existing[0])
  }
  const customerJournalSql = await buildOperationJournalStatement(db, 'customers', id, body)
  await atomicExec(db, [
    `INSERT INTO customers (id, name, phone, email, address, tier, active, loyalty_points, total_earned, total_redeemed, created_at, updated_at) VALUES ${sqlVals([id, name, phone || null, email || null, address || null, tier || 'BRONZE', 1, 0, 0, 0, new Date().toISOString(), new Date().toISOString()])}`,
    `INSERT INTO loyalty_accounts (id, customer_id, points, total_earned, total_redeemed, tier, updated_at) VALUES ${sqlVals([generateUUID(), id, 0, 0, 0, tier || 'BRONZE', new Date().toISOString()])}`,
    customerJournalSql,
  ])
  const rows = await db.select('SELECT * FROM customers WHERE id = ?', [id])
  const customer = rowToCamel(rows[0])
  customer.loyaltyAccount = { points: 0, totalEarned: 0, totalRedeemed: 0, tier: tier || 'BRONZE' }
  return customer
}

// ============================================================
// CREATE EXPENSE — wraps the insert + cash_movement + audit_log
// in a single SQLite transaction so partial failures cannot leave
// the books out of balance. Adds client_txn_id (migration 002)
// for sync-push idempotency. CASH expenses also record an EXPENSE
// movement on the currently-open cash session so the expected-cash
// calculation stays accurate.
// ============================================================
async function handleCreateExpense(db, body: any): Promise<any> {
  await requirePermission(db, 'expense.create')
  // ─── AUTH: get userId from session, NEVER from body ───
  const authUser = await requireUser(db)

  // ─── ZOD VALIDATION ───
  const parsed = expenseSchema.safeParse(body)
  if (!parsed.success) throw new Error(zodError(parsed.error))
  const { categoryId, amount, paymentMethod, note, date } = parsed.data
  const userId = authUser.id  // ← from session, not body

  const id = body.id || generateUUID()
  const clientTxnId = parsed.data.clientTxnId || id
  const method = paymentMethod
  const now = date || new Date().toISOString()

  // IDEMPOTENCY CHECK
  const existing = await db.select('SELECT id FROM expenses WHERE client_txn_id = ? LIMIT 1', [clientTxnId])
  if (existing[0]) return { id: existing[0].id, clientTxnId, idempotent: true }

  // Pre-fetch cash session for CASH expenses and never allow the
  // physical drawer to become negative.
  let cashSessionId: string | null = null
  if (method === 'CASH') {
    const sessions = await db.select("SELECT id, user_id, opening_balance FROM cash_sessions WHERE status = 'OPEN' AND deleted_at IS NULL ORDER BY opened_at DESC LIMIT 1")
    const cashSession = sessions[0]
    if (!cashSession) throw new Error('لا يمكن تسجيل مصروف نقدي بدون خزنة مفتوحة')
    if (cashSession.user_id && cashSession.user_id !== userId) throw new Error('لا تملك صلاحية استخدام هذه الخزنة')
    const movements = await db.select('SELECT type, amount FROM cash_movements WHERE session_id = ? AND deleted_at IS NULL ORDER BY created_at ASC', [cashSession.id])
    const currentExpected = calculateExpectedCash(cashSession.opening_balance, movements)
    if (round2(currentExpected - amount) < 0) {
      throw new Error(`لا يمكن تسجيل المصروف: رصيد الخزنة المتاح ${round2(currentExpected)} ج.م`)
    }
    cashSessionId = cashSession.id
  }

  // Build atomic SQL batch
  const stmts: string[] = [
    `INSERT INTO expenses (id, client_txn_id, category_id, user_id, amount, payment_method, note, date, sync_status, created_at, updated_at)
     VALUES ${sqlVals([id, clientTxnId, categoryId || null, userId, amount, method, note || '', now, 'pending', now, now])}`,
  ]

  if (cashSessionId) {
    stmts.push(
      `INSERT INTO cash_movements (id, client_txn_id, session_id, type, amount, note, ref_type, ref_id, sync_status, created_at)
       VALUES ${sqlVals([generateUUID(), `${clientTxnId}:CASH`, cashSessionId, 'EXPENSE', amount, note || 'مصروف نقدي', 'Expense', id, 'pending', now])}`
    )
  }

  stmts.push(
    `INSERT INTO audit_logs (id, user_id, action, entity, entity_id, after, created_at)
     VALUES ${sqlVals([generateUUID(), userId, 'CREATE_EXPENSE', 'Expense', id, JSON.stringify({ amount, method, categoryId, note }), now])}`
  )

  const expenseCategoryRow = await db.select('SELECT name, name_ar FROM expense_categories WHERE id = ? LIMIT 1', [categoryId]).catch(()=>[])
  const expenseCategoryText = `${expenseCategoryRow[0]?.name_ar || ''} ${expenseCategoryRow[0]?.name || ''}`.toLowerCase()
  const expenseCode = expenseCategoryText.includes('إيجار') || expenseCategoryText.includes('rent') ? '6010'
    : expenseCategoryText.includes('كهرب') || expenseCategoryText.includes('مياه') || expenseCategoryText.includes('غاز') || expenseCategoryText.includes('utilit') ? '6020'
    : expenseCategoryText.includes('راتب') || expenseCategoryText.includes('salary') || expenseCategoryText.includes('wage') ? '6030'
    : expenseCategoryText.includes('تسويق') || expenseCategoryText.includes('marketing') || expenseCategoryText.includes('إعلان') ? '6040'
    : expenseCategoryText.includes('صيان') || expenseCategoryText.includes('maint') ? '6050'
    : expenseCategoryText.includes('نقل') || expenseCategoryText.includes('transport') ? '6060'
    : expenseCategoryText.includes('بنك') || expenseCategoryText.includes('bank') || expenseCategoryText.includes('دفع') || expenseCategoryText.includes('payment') ? '6070'
    : expenseCategoryText.includes('إهلاك') || expenseCategoryText.includes('depreciation') ? '6080' : '7100'
  const expenseAccountRow = await db.select('SELECT id FROM general_accounts WHERE code = ? LIMIT 1', [expenseCode]).catch(()=>[])
  const expenseAccount = expenseAccountRow[0]?.id || 'ga-expenses'
  const expenseLines:any[] = [
    {accountId:expenseAccount, debit:amount, note:note || 'مصروف'},
    {accountId:method==='CASH' ? 'ga-cash' : ((method==='CARD' || method==='TRANSFER') ? 'ga-bank' : 'ga-cash-outside'), credit:amount, note:'سداد مصروف'}
  ]
  stmts.push(...autoJournalStatements({
    entryId:generateUUID(), clientTxnId:`${clientTxnId}:GL`, entryNo:makeJournalEntryNo('E',clientTxnId,now), entryDate:now,
    description:note || 'مصروف', referenceType:'Expense', referenceId:id, userId, lines:expenseLines
  }))

  stmts.push(
    `INSERT INTO sync_queue (entity_type, entity_id, client_txn_id, operation, payload, status, created_at)
     VALUES ${sqlVals(['Expense', id, clientTxnId, 'CREATE', JSON.stringify({ ...body, clientTxnId }), 'PENDING', now])}`
  )

  try {
    await atomicExec(db, stmts)
  } catch (e) {
    if (isUniqueConstraintError(e)) {
      const raced = await db.select('SELECT id FROM expenses WHERE client_txn_id = ? LIMIT 1', [clientTxnId])
      if (raced[0]) return { id: raced[0].id, clientTxnId, idempotent: true }
    }
    throw new Error(`فشل إنشاء المصروف: ${sqlErrorMsg(e)}`)
  }

  return { id, clientTxnId, ...body }
}

// ============================================================
// CASH OPEN — atomically close any already-open session then open
// a new one with an OPENING cash_movement. Wrapped in BEGIN/COMMIT
// so a crash mid-way cannot leave two OPEN sessions or a missing
// opening movement.
// ============================================================
async function handleCashOpen(db, body: any): Promise<any> {
  await requirePermission(db, 'cash.open')
  // ─── AUTH: get userId from session, NEVER from body ───
  const authUser = await requireUser(db)

  // ─── ZOD VALIDATION ───
  const parsed = cashOpenSchema.safeParse(body)
  if (!parsed.success) throw new Error(zodError(parsed.error))
  const { openingBalance } = parsed.data
  const userId = authUser.id  // ← from session, not body

  const clientTxnId = parsed.data.clientTxnId || generateUUID()
  // Durable idempotency identity lives on the session row itself. The unique
  // index remains authoritative even when the response is lost and the same
  // request is retried before the sync queue is inspected.
  const existingByTxn = await db.select(
    'SELECT id, user_id, opening_balance, status, opened_at, client_txn_id FROM cash_sessions WHERE client_txn_id = ? LIMIT 1',
    [clientTxnId]
  )
  if (existingByTxn[0]) return { ...rowToCamel(existingByTxn[0]), clientTxnId, idempotent: true }

  // Never silently close another operator's active register. If the current
  // user already has an open session, return it instead of creating a second
  // one; otherwise require the existing session to be closed first.
  const openSessions = await db.select(
    "SELECT id, user_id, opening_balance, status, opened_at FROM cash_sessions WHERE status = 'OPEN' AND deleted_at IS NULL ORDER BY opened_at DESC LIMIT 1"
  )
  if (openSessions[0]) {
    const active = openSessions[0]
    if (active.user_id === userId) {
      return { ...rowToCamel(active), clientTxnId, idempotent: true, alreadyOpen: true }
    }
    throw new Error('هناك خزنة مفتوحة بالفعل لمستخدم آخر. أغلق الخزنة الحالية أولاً قبل فتح خزنة جديدة.')
  }

  const id = generateUUID()
  const now = new Date().toISOString()

  const stmts: string[] = [
    // 1. Open new session
    `INSERT INTO cash_sessions (id, client_txn_id, user_id, opening_balance, status, opened_at, updated_at)
     VALUES ${sqlVals([id, clientTxnId, userId, openingBalance, 'OPEN', now, now])}`,
    // 2. Opening movement is an audit/display row only. It is excluded by
    // calculateExpectedCash, so openingBalance cannot be counted twice.
    `INSERT INTO cash_movements (id, session_id, type, amount, note, ref_type, ref_id, sync_status, created_at)
     VALUES ${sqlVals([generateUUID(), id, 'OPENING', openingBalance, 'افتتاح الكاش', 'CashSession', id, 'pending', now])}`,
    // 3. Local operation journal
    `INSERT INTO sync_queue (entity_type, entity_id, client_txn_id, operation, payload, status, created_at)
     VALUES ${sqlVals(['CashSession', id, clientTxnId, 'CREATE', JSON.stringify({ ...parsed.data, clientTxnId, userId }), 'PENDING', now])}`,
  ]

  try {
    await atomicExec(db, stmts)
  } catch (e) {
    if (isUniqueConstraintError(e)) {
      const raced = await db.select('SELECT id, user_id, opening_balance, status, opened_at, client_txn_id FROM cash_sessions WHERE client_txn_id = ? LIMIT 1', [clientTxnId])
      if (raced[0]) return { ...rowToCamel(raced[0]), clientTxnId, idempotent: true }
    }
    throw new Error(`فشل فتح الكاش: ${sqlErrorMsg(e)}`)
  }

  return { id, clientTxnId, ...body, status: 'OPEN' }
}

async function handleCashMovement(db, body: any): Promise<any> {
  await requirePermission(db, 'cash.open')
  const authUser = await requireUser(db)
  const parsed = z.object({
    sessionId: z.string().min(1, 'معرف الجلسة مطلوب'),
    type: z.enum(['CASH_IN', 'CASH_OUT', 'EXPENSE']),
    amount: z.number().positive('المبلغ يجب أن يكون أكبر من صفر'),
    note: z.string().max(500).optional().default(''),
    userId: z.string().optional(), // ignored — authenticated user is authoritative
    clientTxnId: z.string().min(1).optional(),
  }).safeParse(body)
  if (!parsed.success) throw new Error(zodError(parsed.error))

  const { sessionId, type, amount, note } = parsed.data
  const clientTxnId = parsed.data.clientTxnId || generateUUID()
  const now = new Date().toISOString()

  const duplicate = await db.select(
    'SELECT id, session_id, type, amount, note, created_at FROM cash_movements WHERE client_txn_id = ? LIMIT 1',
    [clientTxnId]
  )
  if (duplicate[0]) {
    const existing = rowToCamel(duplicate[0])
    return { id: existing.id, sessionId: existing.sessionId, type: existing.type, amount: existing.amount, note: existing.note, createdAt: existing.createdAt, idempotent: true }
  }

  const sessions = await db.select(
    'SELECT id, user_id, status FROM cash_sessions WHERE id = ? AND deleted_at IS NULL LIMIT 1',
    [sessionId]
  )
  const session = sessions[0]
  if (!session) throw new Error('الجلسة غير موجودة')
  if (session.status !== 'OPEN') throw new Error('لا يمكن إضافة حركة على خزنة مغلقة')
  // CASH_OUT / EXPENSE must never drive the drawer below zero.
  if (type === 'CASH_OUT' || type === 'EXPENSE') {
    const movements = await db.select('SELECT type, amount FROM cash_movements WHERE session_id = ? AND deleted_at IS NULL ORDER BY created_at ASC', [sessionId])
    const currentExpected = calculateExpectedCash(session.opening_balance, movements)
    if (round2(currentExpected - amount) < 0) {
      throw new Error(`لا يمكن تنفيذ الحركة: رصيد الخزنة المتاح ${round2(currentExpected)} ج.م ولا يسمح بأن يصبح بالسالب`)
    }
  }
  if (session.user_id && session.user_id !== authUser.id) {
    throw new Error('لا تملك صلاحية تعديل هذه الخزنة')
  }

  const id = generateUUID()
  const statements = [
    `INSERT INTO cash_movements (id, client_txn_id, session_id, type, amount, note, sync_status, created_at)
     VALUES ${sqlVals([id, clientTxnId, sessionId, type, amount, note, 'pending', now])}`,
    `INSERT INTO sync_queue (entity_type, entity_id, client_txn_id, operation, payload, status, created_at)
     VALUES ${sqlVals(['CashMovement', id, clientTxnId, 'CREATE', JSON.stringify({ ...parsed.data, id, clientTxnId, createdAt: now, userId: authUser.id }), 'PENDING', now])}`,
  ]

  try {
    await atomicExec(db, statements)
  } catch (e) {
    if (isUniqueConstraintError(e)) {
      const raced = await db.select('SELECT id, session_id, type, amount, note, created_at FROM cash_movements WHERE client_txn_id = ? LIMIT 1', [clientTxnId])
      if (raced[0]) { const existing = rowToCamel(raced[0]); return { id: existing.id, sessionId: existing.sessionId, type: existing.type, amount: existing.amount, note: existing.note, createdAt: existing.createdAt, clientTxnId, idempotent: true } }
    }
    throw new Error(`فشل تسجيل حركة الكاش: ${sqlErrorMsg(e)}`)
  }

  return { id, sessionId, type, amount, note, clientTxnId, createdAt: now }
}

// ============================================================
// CASH CLOSE — computes expected vs actual cash, marks the session
// CLOSED, and records a CLOSING movement + audit entry. The reads
// (session + movements) happen BEFORE BEGIN so validation errors
// propagate cleanly without an aborted transaction.
// ============================================================
async function handleCashClose(db, body: any): Promise<any> {
  await requirePermission(db, 'cash.close')
  // ─── AUTH: get userId from session, NEVER from body ───
  const authUser = await requireUser(db)

  // ─── ZOD VALIDATION ───
  const parsed = cashCloseSchema.safeParse(body)
  if (!parsed.success) throw new Error(zodError(parsed.error))
  const { sessionId, actualCash } = parsed.data
  if (actualCash < 0) throw new Error('رصيد الخزنة لا يمكن أن يكون بالسالب')
  const userId = authUser.id  // ← from session, not body

  const existingQueue = await db.select(
    "SELECT entity_id FROM sync_queue WHERE client_txn_id = ? AND entity_type = 'CashSessionClose' LIMIT 1",
    [parsed.data.clientTxnId || '']
  )
  if (parsed.data.clientTxnId && existingQueue[0]?.entity_id === sessionId) {
    const existing = await db.select('SELECT * FROM cash_sessions WHERE id = ? LIMIT 1', [sessionId])
    if (existing[0]) return { sessionId, expectedCash: existing[0].expected_cash, actualCash: existing[0].closing_balance, difference: existing[0].difference, idempotent: true }
  }

  const sessions = await db.select('SELECT * FROM cash_sessions WHERE id = ? AND deleted_at IS NULL', [sessionId])
  const session = sessions[0]
  if (!session) throw new Error('الجلسة غير موجودة')
  if (session.status !== 'OPEN') throw new Error('الخزنة مغلقة بالفعل')
  if (session.user_id && session.user_id !== userId) throw new Error('لا تملك صلاحية إغلاق هذه الخزنة')
  const movements = await db.select('SELECT * FROM cash_movements WHERE session_id = ? AND deleted_at IS NULL ORDER BY created_at ASC', [sessionId])
  // FIX: this used to sum every movement with a plain `+`, so CASH_OUT
  // (withdrawals), EXPENSE, and REFUND — which pull cash OUT of the
  // drawer — were being ADDED to the expected total instead of
  // subtracted. That made "expected cash" too high the moment a
  // withdrawal happened, so closing right after a cash-out produced a
  // large negative difference. Match the signed logic already used by
  // Keep the cash summary consistent with the live desktop cash view.
  const expected = calculateExpectedCash(session.opening_balance, movements)
  const difference = round2(actualCash - expected)

  const now = new Date().toISOString()
  const clientTxnId = parsed.data.clientTxnId || generateUUID()
  const stmts: string[] = [
    `UPDATE cash_sessions SET closing_balance = ${sqlEsc(actualCash)}, expected_cash = ${sqlEsc(expected)}, difference = ${sqlEsc(difference)}, status = 'CLOSED', closed_at = datetime('now'), updated_at = datetime('now') WHERE id = ${sqlEsc(sessionId)} AND status = 'OPEN'`,
    // A database trigger (migration 027) rejects the CLOSING movement unless
    // this UPDATE actually left the session CLOSED. Unlike RAISE() in a
    // normal SELECT, that guard is valid SQLite and rolls back the batch.
    // NOTE: this INSERT previously had 9 columns but only 8 values, so every
    // value silently shifted one column to the left — 'type' held a number,
    // 'amount' held Arabic text, etc. That corrupted this row's data and
    // broke any report that summed cash_movements.amount for this session.
    // Fixed to align 1:1 with the declared columns.
    `INSERT INTO cash_movements (id, client_txn_id, session_id, type, amount, note, ref_type, ref_id, sync_status, created_at)
     VALUES ${sqlVals([generateUUID(), `${clientTxnId}:CLOSING`, sessionId, 'CLOSING', actualCash || 0, 'إغلاق الكاش', 'CashSession', sessionId, 'pending', now])}`,
    `INSERT INTO audit_logs (id, user_id, action, entity, entity_id, after, created_at)
     VALUES ${sqlVals([generateUUID(), userId || null, 'CLOSE_CASH', 'CashSession', sessionId, JSON.stringify({ expected, actualCash, difference }), now])}`,
    `INSERT INTO sync_queue (entity_type, entity_id, client_txn_id, operation, payload, status, created_at)
     VALUES ${sqlVals(['CashSessionClose', sessionId, clientTxnId, 'UPDATE', JSON.stringify({ sessionId, actualCash, clientTxnId, userId }), 'PENDING', now])}`,
  ]

  try {
    await atomicExec(db, stmts)
  } catch (e) {
    if (isUniqueConstraintError(e)) {
      const raced = await db.select("SELECT entity_id FROM sync_queue WHERE client_txn_id = ? AND entity_type = 'CashSessionClose' LIMIT 1", [clientTxnId])
      if (raced[0]?.entity_id === sessionId) { const existing = await db.select('SELECT * FROM cash_sessions WHERE id = ? LIMIT 1',[sessionId]); if (existing[0]) return { sessionId, expectedCash: existing[0].expected_cash, actualCash: existing[0].closing_balance, difference: existing[0].difference, clientTxnId, idempotent: true } }
    }
    throw new Error(`فشل إغلاق الكاش: ${sqlErrorMsg(e)}`)
  }

  return { sessionId, expectedCash: expected, actualCash, difference, clientTxnId }
}

async function handleInventoryAdjust(db, body: any): Promise<any> {
  await requirePermission(db, 'inventory.adjust')
  // ─── AUTH: require logged-in user ───
  const authUser = await requireUser(db)

  const { productId, newQuantity, reason } = body
  if (!productId) throw new Error('المنتج مطلوب')
  if (typeof newQuantity !== 'number' || newQuantity < 0) throw new Error('الكمية الجديدة غير صحيحة')
  const clientTxnId = typeof body.clientTxnId === 'string' && body.clientTxnId.trim() ? body.clientTxnId.trim() : generateUUID()
  const duplicate = await db.select(
    'SELECT id, product_id FROM stock_movements WHERE client_txn_id = ? LIMIT 1',
    [clientTxnId]
  )
  if (duplicate[0]) return { productId: duplicate[0].product_id, clientTxnId, movementId: duplicate[0].id, idempotent: true }

  const products = await db.select('SELECT * FROM products WHERE id = ? AND deleted_at IS NULL', [productId])
  const product = products[0]
  if (!product) throw new Error('المنتج غير موجود')
  const oldQty = product.current_stock
  const diff = newQuantity - oldQty
  const warehouseId = await resolveDefaultWarehouseId(db, product.store_id || null)
  const now = new Date().toISOString()

  // ─── ATOMIC: movement + audit + sync. current_stock is trigger-derived. ───
  const movementId = generateUUID()
  const stmts: string[] = [
    `INSERT INTO stock_movements (id, client_txn_id, product_id, warehouse_id, type, quantity, note, sync_status, created_at)
     VALUES ${sqlVals([movementId, clientTxnId, productId, warehouseId, 'ADJUSTMENT', diff, reason || 'تسوية مخزون', 'pending', now])}`,
    `INSERT INTO sync_queue (entity_type, entity_id, client_txn_id, operation, payload, status, created_at)
     VALUES ${sqlVals(['StockMovement', movementId, clientTxnId, 'CREATE', JSON.stringify({ id: movementId, productId, warehouseId, type: 'ADJUSTMENT', quantity: diff, newQuantity, reason, clientTxnId }), 'PENDING', now])}`,
    `INSERT INTO audit_logs (id, user_id, action, entity, entity_id, after, created_at)
     VALUES ${sqlVals([generateUUID(), authUser.id, 'INVENTORY_ADJUST', 'Product', productId, JSON.stringify({ oldQty, newQty: newQuantity, diff, reason }), now])}`,
  ]

  try {
    await atomicExec(db, stmts)
  } catch (e) {
    if (isUniqueConstraintError(e)) {
      const raced = await db.select('SELECT id, product_id FROM stock_movements WHERE client_txn_id = ? LIMIT 1', [clientTxnId])
      if (raced[0]) return { productId: raced[0].product_id, clientTxnId, movementId: raced[0].id, idempotent: true }
    }
    throw new Error(`فشل تسوية مخزون: ${sqlErrorMsg(e)}`)
  }

  return { productId, oldQuantity: oldQty, newQuantity, clientTxnId, movementId }
}

// ============================================================
// LOYALTY REDEEM — deduct points from customer's loyalty account
// ============================================================
// ============================================================
// CATEGORIES — GET (list + single) — see the FIX comment at the
// handleGet dispatch site above for why this exists.
// ============================================================
async function handleCategoriesGet(db, entityId: string | null): Promise<any> {
  const rows = await db.select('SELECT * FROM categories WHERE deleted_at IS NULL ORDER BY name ASC')
  const allCats = rows.map((r) => {
    const c = rowToCamel(r)
    c.children = []
    c.productCount = 0
    return c
  })
  const catMap = new Map<string, any>(allCats.map((c): [string, any] => [c.id, c]))
  for (const c of allCats) {
    if (c.parentId && catMap.has(c.parentId)) {
      catMap.get(c.parentId).children.push(c)
    }
  }

  const productRows = await db.select('SELECT id, category_id FROM products WHERE deleted_at IS NULL LIMIT 5000')
  for (const c of allCats) {
    c.productCount = productRows.filter((p) => p.category_id === c.id).length
  }

  if (entityId) {
    const found = catMap.get(entityId)
    if (!found) return null
    // The "manage products" dialog in categories.tsx reads detail.products
    // (an array with id/name/nameAr/sku/sellingPrice/active) to list what's
    // currently in the category.
    // `select: { id, name, nameAr, sku, sellingPrice, active }`.
    const productDetailRows = await db.select(
      'SELECT id, name, name_ar, sku, selling_price, active FROM products WHERE category_id = ? AND deleted_at IS NULL',
      [entityId]
    )
    found.products = productDetailRows.map((p) => rowToCamel(p))
    return found
  }

  return allCats
}

async function handleLoyaltyRedeem(db, body: any): Promise<any> {
  await requirePermission(db, 'loyalty.redeem')
  // ─── AUTH: require logged-in user ───
  await requireUser(db)

  // ─── ZOD VALIDATION ───
  const parsed = loyaltyRedeemSchema.safeParse(body)
  if (!parsed.success) throw new Error(zodError(parsed.error))
  const { customerId, points, note } = parsed.data
  const clientTxnId = parsed.data.clientTxnId || generateUUID()
  const duplicate = await db.select(
    'SELECT id, customer_id, type, points, note, created_at FROM loyalty_transactions WHERE client_txn_id = ? LIMIT 1',
    [clientTxnId]
  )
  if (duplicate[0]) {
    const live = await db.select('SELECT * FROM loyalty_accounts WHERE customer_id = ? AND deleted_at IS NULL LIMIT 1', [customerId])
    return { account: live[0] ? rowToCamel(live[0]) : null, transaction: rowToCamel(duplicate[0]), idempotent: true }
  }

  // loyalty_accounts is soft-deletable — exclude tombstoned accounts.
  const accounts = await db.select('SELECT * FROM loyalty_accounts WHERE customer_id = ? AND deleted_at IS NULL LIMIT 1', [customerId])
  const account = accounts[0]
  if (!account) throw new Error('حساب الولاء غير موجود')
  if (account.points < points) {
    throw new Error(`الرصيد غير كافي. المتاح: ${account.points} نقطة`)
  }

  const newPoints = account.points - points
  const newRedeemed = account.total_redeemed + points
  const now = new Date().toISOString()
  const transactionId = generateUUID()

  // ─── ATOMIC: update account + log transaction + sync queue ───
  const stmts: string[] = [
    // The desktop request queue serializes all local writes, while migration
    // 027 adds a database-side non-negative-points invariant. The conditional
    // UPDATE therefore cannot silently drive the account below zero.
    `UPDATE loyalty_accounts SET points = ${sqlEsc(newPoints)}, total_redeemed = ${sqlEsc(newRedeemed)}, updated_at = ${sqlEsc(now)} WHERE customer_id = ${sqlEsc(customerId)} AND points >= ${sqlEsc(points)}`,
    `INSERT INTO loyalty_transactions (id, client_txn_id, customer_id, type, points, note, sync_status, created_at)
     VALUES ${sqlVals([transactionId, clientTxnId, customerId, 'REDEEM', -points, note, 'pending', now])}`,
    `INSERT INTO sync_queue (entity_type, entity_id, client_txn_id, operation, payload, status, created_at)
     VALUES ${sqlVals(['LoyaltyTransaction', transactionId, clientTxnId, 'CREATE', JSON.stringify({ customerId, points, note, clientTxnId }), 'PENDING', now])}`,
  ]

  try {
    await atomicExec(db, stmts)
  } catch (e) {
    if (isUniqueConstraintError(e)) {
      const raced = await db.select('SELECT * FROM loyalty_transactions WHERE client_txn_id = ? LIMIT 1', [clientTxnId])
      if (raced[0]) {
        const live = await db.select('SELECT * FROM loyalty_accounts WHERE customer_id = ? AND deleted_at IS NULL LIMIT 1', [customerId])
        return { account: live[0] ? rowToCamel(live[0]) : null, transaction: rowToCamel(raced[0]), idempotent: true }
      }
    }
    throw new Error(`فشل استبدال النقاط: ${sqlErrorMsg(e)}`)
  }

  return {
    account: { ...rowToCamel(account), points: newPoints, totalRedeemed: newRedeemed },
    transaction: { id: transactionId, clientTxnId, customerId, type: 'REDEEM', points: -points, note: note || 'استبدال نقاط' },
  }
}

// ============================================================
// LOYALTY REFUND — reverses a previous /loyalty/redeem deduction.
// Centralized desktop category handling avoids duplicate update paths.
//
// the desktop loyalty refund handler): a "استبدال بالنقاط" cart line in
// pos.tsx deducts points via /loyalty/redeem the moment it's added to the
// cart, not at checkout — so cancelling that line, lowering its quantity,
// or clearing the whole sale before checkout must credit those points
// back, or the customer permanently loses them for a product they never
// received. Idempotent via client_txn_id, same as handleLoyaltyRedeem's
// sibling REDEEM transactions, so a retried request never double-refunds.
// ============================================================
async function handleLoyaltyRefund(db, body: any): Promise<any> {
  await requireUser(db)

  const parsed = loyaltyRefundSchema.safeParse(body)
  if (!parsed.success) throw new Error(zodError(parsed.error))
  const { customerId, points, note } = parsed.data
  const clientTxnId = body.clientTxnId || generateUUID()

  const already = await db.select(
    'SELECT * FROM loyalty_transactions WHERE client_txn_id = ? LIMIT 1',
    [clientTxnId]
  )
  if (already[0]) {
    const accounts = await db.select('SELECT * FROM loyalty_accounts WHERE customer_id = ? AND deleted_at IS NULL LIMIT 1', [customerId])
    return { account: accounts[0] ? rowToCamel(accounts[0]) : null, transaction: rowToCamel(already[0]), idempotent: true }
  }

  const accounts = await db.select('SELECT * FROM loyalty_accounts WHERE customer_id = ? AND deleted_at IS NULL LIMIT 1', [customerId])
  const account = accounts[0]
  if (!account) throw new Error('حساب الولاء غير موجود')

  const newPoints = account.points + points
  const newRedeemed = Math.max(0, account.total_redeemed - points)
  const now = new Date().toISOString()

  const stmts: string[] = [
    `UPDATE loyalty_accounts SET points = ${sqlEsc(newPoints)}, total_redeemed = ${sqlEsc(newRedeemed)}, updated_at = ${sqlEsc(now)} WHERE customer_id = ${sqlEsc(customerId)}`,
    `INSERT INTO loyalty_transactions (id, client_txn_id, customer_id, type, points, note, sync_status, created_at)
     VALUES ${sqlVals([generateUUID(), clientTxnId, customerId, 'REVERSE', points, note, 'pending', now])}`,
    `INSERT INTO sync_queue (entity_type, entity_id, client_txn_id, operation, payload, status, created_at)
     VALUES ${sqlVals(['LoyaltyTransaction', generateUUID(), clientTxnId, 'CREATE', JSON.stringify({ customerId, points, note }), 'PENDING', now])}`,
  ]

  try {
    await atomicExec(db, stmts)
  } catch (e) {
    if (isUniqueConstraintError(e)) {
      const raced = await db.select('SELECT * FROM loyalty_transactions WHERE client_txn_id = ? LIMIT 1', [clientTxnId])
      if (raced[0]) { const live = await db.select('SELECT * FROM loyalty_accounts WHERE customer_id = ? AND deleted_at IS NULL LIMIT 1', [customerId]); return { account: live[0] ? rowToCamel(live[0]) : null, transaction: rowToCamel(raced[0]), idempotent: true } }
    }
    throw new Error(`فشل استرجاع النقاط: ${sqlErrorMsg(e)}`)
  }

  return {
    account: { ...rowToCamel(account), points: newPoints, totalRedeemed: newRedeemed },
    transaction: { customerId, type: 'REVERSE', points, note: note || 'استرجاع نقاط' },
    message: 'تم استرجاع النقاط بنجاح',
  }
}

// ============================================================
// CATEGORY — ASSIGN PRODUCTS — bulk-move a list of products into one
// category in one action.
// (the desktop category assignment handler).
//
// IMPORTANT: this is dispatched by an explicit path.includes() check in
// handlePost BEFORE the generic tableName branch — getTableName() maps
// '/categories/{id}/assign-products' to tableName 'categories' the same
// way it maps '/sales/{id}/refund' to 'sales', and the generic entityId
// parser (desktopApiFetch) grabs the LAST path segment as the id, which
// for this route is the literal string "assign-products", not the actual
// category id. Left unhandled, the generic POST path fell through to a
// plain INSERT into categories with body {productIds:[...]} — none of
// which match a real column — producing "NOT NULL constraint failed:
// categories.name". The category id is parsed out of the path here
// instead, the same way handleSaleRefund/handlePurchasePayment already do
// for their own "/{id}/action" routes.
// ============================================================
async function handleCategoryAssignProducts(db, path: string, body: any): Promise<any> {
  const user = await requireUser(db)
  const pathParts = path.split('?')[0].split('/').filter(Boolean)
  const idx = pathParts.indexOf('assign-products')
  const categoryId = idx > 0 ? pathParts[idx - 1] : null
  if (!categoryId) throw new Error('معرف الفئة غير صالح')

  const parsed = assignProductsSchema.safeParse(body)
  if (!parsed.success) throw new Error(zodError(parsed.error))
  const { productIds } = parsed.data

  const catRows = await db.select('SELECT * FROM categories WHERE id = ? AND deleted_at IS NULL LIMIT 1', [categoryId])
  const category = catRows[0]
  if (!category) throw new Error('الفئة غير موجودة')

  const now = new Date().toISOString()
  const stmts: string[] = productIds.map((pid: string) =>
    `UPDATE products SET category_id = ${sqlEsc(categoryId)}, updated_at = ${sqlEsc(now)} WHERE id = ${sqlEsc(pid)}`
  )
  stmts.push(
    `INSERT INTO audit_logs (id, user_id, action, entity, entity_id, after, created_at)
     VALUES ${sqlVals([generateUUID(), user.id, 'CATEGORY_PRODUCTS_ASSIGNED', 'Category', categoryId, JSON.stringify({ productIds }), now])}`
  )

  // Queue each moved product inside the same transaction as its UPDATE.
  // A failed journal insert must roll back the corresponding category move.
  for (const pid of productIds) {
    stmts.push(await buildOperationJournalStatement(db, 'products', pid, { id: pid, categoryId }, 'UPDATE'))
  }

  try {
    await atomicExec(db, stmts)
  } catch (e) {
    throw new Error(`فشل نقل المنتجات: ${sqlErrorMsg(e)}`)
  }

  return { updated: productIds.length, message: `تم نقل ${productIds.length} منتج إلى ${category.name_ar || category.name}` }
}

// ============================================================
// CATEGORY — BULK PRICE CHANGE
// (the desktop bulk-price handler). Same path-parsing
// concern as handleCategoryAssignProducts above — dispatched explicitly
// before the generic categories branch so "bulk-price" is never mistaken
// for a category id.
// ============================================================
async function handleCategoryBulkPrice(db, path: string, body: any): Promise<any> {
  const user = await requireUser(db)
  const pathParts = path.split('?')[0].split('/').filter(Boolean)
  const idx = pathParts.indexOf('bulk-price')
  const categoryId = idx > 0 ? pathParts[idx - 1] : null
  if (!categoryId) throw new Error('معرف الفئة غير صالح')

  const parsed = bulkPriceSchema.safeParse(body)
  if (!parsed.success) throw new Error(zodError(parsed.error))
  const { mode, value, field, includeSubcategories } = parsed.data

  const catRows = await db.select('SELECT * FROM categories WHERE id = ? AND deleted_at IS NULL LIMIT 1', [categoryId])
  const category = catRows[0]
  if (!category) throw new Error('الفئة غير موجودة')

  const categoryIds = [categoryId]
  if (includeSubcategories) {
    const subs = await db.select('SELECT id FROM categories WHERE parent_id = ? AND deleted_at IS NULL', [categoryId])
    categoryIds.push(...subs.map((s) => s.id))
  }

  const placeholders = categoryIds.map(() => '?').join(',')
  const products = await db.select(
    `SELECT * FROM products WHERE category_id IN (${placeholders}) AND deleted_at IS NULL`,
    categoryIds
  )

  const fields: Array<'selling_price' | 'wholesale_price'> =
    field === 'both' ? ['selling_price', 'wholesale_price'] : [field === 'wholesalePrice' ? 'wholesale_price' : 'selling_price']

  const applyChange = (price: number) => {
    const raw = mode === 'PERCENT' ? price * (1 + value / 100) : price + value
    return Math.max(0, Math.round(raw * 100) / 100)
  }

  const now = new Date().toISOString()
  const stmts: string[] = []
  for (const p of products) {
    const sets = fields.map((f) => `${f} = ${sqlEsc(applyChange(Number((p as any)[f]) || 0))}`)
    sets.push(`updated_at = ${sqlEsc(now)}`)
    stmts.push(`UPDATE products SET ${sets.join(', ')} WHERE id = ${sqlEsc(p.id)}`)
  }
  stmts.push(
    `INSERT INTO audit_logs (id, user_id, action, entity, entity_id, after, created_at)
     VALUES ${sqlVals([generateUUID(), user.id, 'CATEGORY_BULK_PRICE_CHANGE', 'Category', categoryId, JSON.stringify({ mode, value, field, includeSubcategories, updatedCount: products.length }), now])}`
  )

  // Keep every product price change paired with its sync journal entry in
  // the same atomic unit. Do not use best-effort journaling here: a missing
  // queue row would make the local state diverge from the sync state.
  for (const p of products) {
    stmts.push(await buildOperationJournalStatement(db, 'products', p.id, { id: p.id }, 'UPDATE'))
  }

  try {
    if (stmts.length > 0) await atomicExec(db, stmts)
  } catch (e) {
    throw new Error(`فشل تغيير الأسعار: ${sqlErrorMsg(e)}`)
  }

  return { updated: products.length, categoryName: category.name_ar || category.name, message: `تم تحديث سعر ${products.length} منتج` }
}

// ============================================================
// PLATFORM LOCK — lock/unlock the system
// ============================================================
async function handlePlatformLock(db, body: any): Promise<any> {
  const authUser = await requirePermission(db, 'system.lock')
  const { locked, reason } = body
  await atomicExec(db, [
    `INSERT OR REPLACE INTO settings (key, value, category) VALUES ${sqlVals(['system.locked', locked ? 'true' : 'false', 'system'])}`,
    `INSERT OR REPLACE INTO settings (key, value, category) VALUES ${sqlVals(['system.lockedReason', reason || '', 'system'])}`,
    `INSERT INTO audit_logs (id, user_id, action, entity, after, created_at) VALUES ${sqlVals([generateUUID(), authUser.id, locked ? 'SYSTEM_LOCKED' : 'SYSTEM_UNLOCKED', 'System', JSON.stringify({ locked, reason }), new Date().toISOString()])}`,
  ])
  return { locked, reason: reason || '' }
}

// ============================================================
// SETUP — initial system setup (already done by seedAdminUser in desktop)
// ============================================================
async function handleSetup(db, _body: any): Promise<any> {
  // In desktop mode, seedAdminUser already runs on first launch.
  // Just check if admin exists and return appropriate response.
  const users = await db.select('SELECT COUNT(*) as count FROM users')
  if (users[0]?.count > 0) {
    return { alreadySetup: true, message: 'النظام تم إعداده بالفعل' }
  }
  // If no users, force seed
  await seedAdminUser(db)
  return { success: true, message: 'تم إعداد النظام بنجاح' }
}

// ============================================================
// COMPLETE SETUP — sets the admin password and clears the
// needsSetup flag. This is called by the setup wizard UI after
// the user enters their desired admin password.
//
// SECURITY: This endpoint is ONLY callable while
// system.needsSetup = 'true'. Once the password is set, the
// flag is cleared and this endpoint refuses further calls.
// ============================================================
async function handleCompleteSetup(db, body: any): Promise<any> {
  // Verify setup is still pending
  const setupRows = await db.select("SELECT value FROM settings WHERE key = 'system.needsSetup' LIMIT 1")
  if (setupRows[0]?.value !== 'true') {
    throw new Error('النظام تم إعداده بالفعل')
  }

  const { password, storeName } = body || {}
  if (!password || password.length < 6) {
    throw new Error('كلمة المرور يجب أن تكون 6 أحرف على الأقل')
  }

  const bcrypt = await import('bcryptjs')
  const passwordHash = await bcrypt.hash(password, 12)  // OWASP recommended rounds

  // Update admin password
  const adminRows = await db.select("SELECT id FROM users WHERE username = 'admin' AND deleted_at IS NULL LIMIT 1")
  if (!adminRows[0]) throw new Error('حساب المدير غير موجود')
  const setupStatements: string[] = [
    `UPDATE users SET password_hash=${sqlEsc(passwordHash)}, updated_at=datetime('now') WHERE id=${sqlEsc(adminRows[0].id)}`,
  ]
  if (storeName) {
    setupStatements.push(`INSERT OR REPLACE INTO settings (key, value, category) VALUES ${sqlVals(['store.name', storeName, 'general'])}`)
  }
  setupStatements.push("INSERT OR REPLACE INTO settings (key, value, category) VALUES ('system.needsSetup', 'false', 'system')")
  setupStatements.push(`INSERT INTO audit_logs (id, user_id, action, entity, entity_id, after, created_at)
       VALUES ${sqlVals([generateUUID(), adminRows[0].id, 'SETUP_COMPLETE', 'User', adminRows[0].id, JSON.stringify({ storeName, passwordChanged: true }), new Date().toISOString()])}`)
  await atomicExec(db, setupStatements)

  return { success: true, message: 'تم إعداد النظام بنجاح — يمكنك تسجيل الدخول الآن' }
}

// ============================================================
// SALE REFUND — multi-table atomic write that creates the
// sale_return + sale_return_items, restores stock, logs RETURN
// stock_movements, reverses loyalty points, updates sale status,
// and queues for sync.
//
// ATOMIC EXECUTION: tauri-plugin-sql does NOT support BEGIN/COMMIT
// across separate execute() calls (each call may use a different
// pooled connection, causing "cannot commit - no transaction is
// active"). All writes are concatenated into ONE execute() call;
// SQLite wraps the entire batch in an implicit transaction — if ANY
// statement fails, the WHOLE batch rolls back atomically.
//
// IDEMPOTENCY: before creating, check if a sale_return with this
// clientTxnId already exists → return it (prevents duplicates from
// retries or double-clicks).
// ============================================================
async function handleSaleRefund(db, path: string, body: any): Promise<any> {
  await requirePermission(db, 'sale.refund')
  // ─── AUTH: get userId from session, NEVER from body ───
  const authUser = await requireUser(db)

  // ─── ZOD VALIDATION ───
  const parsed = refundSchema.safeParse(body)
  if (!parsed.success) throw new Error(zodError(parsed.error))
  const { items, reason, refundMethod } = parsed.data
  const userId = authUser.id  // ← from session, not body

  // Extract sale ID from path: /sales/{id}/refund
  const pathParts = path.split('/').filter(Boolean)
  const saleId = pathParts[1] // ['sales', '{id}', 'refund']
  if (!saleId) throw new Error('معرف الفاتورة مطلوب')

  const returnId = generateUUID()
  const clientTxnId = parsed.data.clientTxnId || returnId
  const returnNumber = `RET-${Date.now()}-${generateUUID().slice(0, 8).toUpperCase()}`
  const now = new Date().toISOString()

  // ─── IDEMPOTENCY CHECK ───
  // If this clientTxnId already exists, return the existing sale_return.
  // Prevents duplicate refunds from sync retries or double-clicks.
  const existing = await db.select('SELECT id FROM sale_returns WHERE client_txn_id = ? LIMIT 1', [clientTxnId])
  if (existing[0]) return { id: existing[0].id, idempotent: true }

  // ─── PRE-VALIDATION READS ───
  // Reads happen BEFORE building the atomic batch so user-facing errors
  // throw cleanly without an aborted transaction.
  const sales = await db.select('SELECT * FROM sales WHERE id = ? AND deleted_at IS NULL LIMIT 1', [saleId])
  const sale = sales[0]
  if (!sale) throw new Error('الفاتورة غير موجودة')
  if (sale.status === 'REFUNDED') throw new Error('الفاتورة مستردة بالكامل')

  const saleItems = await db.select('SELECT * FROM sale_items WHERE sale_id = ? AND deleted_at IS NULL', [saleId])

  // ─── DOUBLE-REFUND GUARD ───
  // Sum quantities already returned per sale_item across ALL previous
  // returns for this sale (not just check against the original sold
  // quantity). Without this, the same item could be refunded in full
  // multiple times — inflating stock back in and paying out cash that
  // was never actually collected. See tests/refund.test.ts
  // "should block refund exceeding original quantity" for the intended
  // behaviour this mirrors.
  const previousReturns = await db.select(
    `SELECT sri.sale_item_id as sale_item_id, SUM(sri.quantity) as qty
     FROM sale_return_items sri
     JOIN sale_returns sr ON sri.sale_return_id = sr.id
     WHERE sr.sale_id = ?
     GROUP BY sri.sale_item_id`,
    [saleId]
  )
  const alreadyReturnedMap: Record<string, number> = {}
  for (const r of previousReturns) alreadyReturnedMap[r.sale_item_id] = Number(r.qty) || 0

  let refundTotal = 0
  let loyaltyReversed = 0
  const returnItems: any[] = []

  for (const ret of items) {
    const saleItem = saleItems.find((si) => si.id === ret.saleItemId)
    if (!saleItem) throw new Error('صنف غير موجود في الفاتورة')
    if (ret.quantity > saleItem.quantity) throw new Error('كمية الإرجاع أكبر من المباعة')
    const alreadyReturned = alreadyReturnedMap[saleItem.id] || 0
    const maxRefundable = saleItem.quantity - alreadyReturned
    if (ret.quantity > maxRefundable) {
      throw new Error(
        `الكمية أكبر من المتاح للإرجاع لـ "${saleItem.product_id}" (أقصى كمية: ${maxRefundable}, المطلوب: ${ret.quantity})`
      )
    }
    const lineTotal = round2((saleItem.total / saleItem.quantity) * ret.quantity)
    refundTotal += lineTotal
    returnItems.push({
      id: generateUUID(),
      saleItemId: saleItem.id,
      productId: saleItem.product_id,
      quantity: ret.quantity,
      unitPrice: saleItem.unit_price,
      total: lineTotal,
    })
  }
  refundTotal = round2(refundTotal)

  // ─── FULL vs PARTIAL: does this refund close out every item on the sale? ───
  const fullyRefunded = saleItems.every((si) => {
    const returnedSoFar = (alreadyReturnedMap[si.id] || 0) + (returnItems.find(ri => ri.saleItemId === si.id)?.quantity || 0)
    return returnedSoFar >= si.quantity
  })

  if (sale.loyalty_earned > 0 && sale.customer_id) {
    loyaltyReversed = Math.floor(sale.loyalty_earned * (refundTotal / sale.total))
  }

  const returnWarehouseId = await resolveDefaultWarehouseId(db, null)

  // ─── BUILD ATOMIC SQL BATCH ───
  const stmts: string[] = []

  // 1. Sale return header (with idempotency key from migration 002)
  stmts.push(
    `INSERT INTO sale_returns (id, client_txn_id, return_number, sale_id, user_id, subtotal, tax_amount, total, refund_method, reason, status, loyalty_reversed, created_at)
     VALUES ${sqlVals([returnId, clientTxnId, returnNumber, saleId, userId, refundTotal, 0, refundTotal, refundMethod || 'CASH', reason || 'إرجاع', 'COMPLETED', loyaltyReversed, now])}`
  )

  // 2. Return items + restore stock + log RETURN movement
  for (const ret of returnItems) {
    stmts.push(
      `INSERT INTO sale_return_items (id, sale_return_id, sale_item_id, product_id, quantity, unit_price, total)
       VALUES ${sqlVals([ret.id, returnId, ret.saleItemId, ret.productId, ret.quantity, ret.unitPrice, ret.total])}`
    )
    stmts.push(
      `INSERT INTO stock_movements (id, client_txn_id, product_id, warehouse_id, type, quantity, ref_type, ref_id, note, sync_status, created_at)
       VALUES ${sqlVals([generateUUID(), `${clientTxnId}:${ret.productId}:STOCK`, ret.productId, returnWarehouseId, 'RETURN', ret.quantity, 'SaleReturn', returnId, `إرجاع - ${returnNumber}`, 'pending', now])}`
    )
  }

  // 3. Reverse loyalty points
  if (loyaltyReversed > 0 && sale.customer_id) {
    stmts.push(
      `UPDATE loyalty_accounts SET points = MAX(0, points - ${sqlEsc(loyaltyReversed)}), updated_at = ${sqlEsc(now)} WHERE customer_id = ${sqlEsc(sale.customer_id)}`
    )
    stmts.push(
      `INSERT INTO loyalty_transactions (id, client_txn_id, customer_id, type, points, ref_type, ref_id, note, sync_status, created_at)
       VALUES ${sqlVals([generateUUID(), clientTxnId, sale.customer_id, 'REVERSE', -loyaltyReversed, 'SaleReturn', returnId, `عكس نقاط - ${returnNumber}`, 'pending', now])}`
    )
  }

  // 4. Mark sale as fully or partially refunded
  stmts.push(
    `UPDATE sales SET status = ${sqlEsc(fullyRefunded ? 'REFUNDED' : 'PARTIAL_REFUND')}, updated_at = ${sqlEsc(now)} WHERE id = ${sqlEsc(saleId)}`
  )

  // 4b. Cash drawer movement — a refund paid out in cash must reduce the
  // drawer just like a sale increases it, otherwise the end-of-shift cash
  // count (expected vs actual) will be wrong by the refunded amount.
  if ((refundMethod || 'CASH') === 'CASH' && refundTotal > 0) {
    const openSessions = await db.select("SELECT id, user_id, opening_balance FROM cash_sessions WHERE status = 'OPEN' AND deleted_at IS NULL ORDER BY opened_at DESC LIMIT 1")
    const cashSession = openSessions[0]
    if (!cashSession) throw new Error('لا يمكن إتمام المرتجع النقدي بدون خزنة مفتوحة')
    if (cashSession.user_id && cashSession.user_id !== userId) throw new Error('لا تملك صلاحية استخدام هذه الخزنة')
    const cashMovements = await db.select('SELECT type, amount FROM cash_movements WHERE session_id = ? AND deleted_at IS NULL ORDER BY created_at ASC', [cashSession.id])
    const currentExpected = calculateExpectedCash(cashSession.opening_balance, cashMovements)
    if (round2(currentExpected - refundTotal) < 0) {
      throw new Error(`لا يمكن صرف المرتجع نقدًا: رصيد الخزنة المتاح ${round2(currentExpected)} ج.م`)
    }
    stmts.push(
      `INSERT INTO cash_movements (id, client_txn_id, session_id, type, amount, note, ref_type, ref_id, sync_status, created_at)
       VALUES ${sqlVals([generateUUID(), `${clientTxnId}:CASH`, cashSession.id, 'REFUND', refundTotal, returnNumber, 'SaleReturn', returnId, 'pending', now])}`
    )
  }

  const returnTax = round2(returnItems.reduce((sum, r) => {
    const source = saleItems.find((si)=>si.id===r.saleItemId)
    if (!source || !Number(source.quantity)) return sum
    const perUnitTax = Number(source.tax_amount || 0) / Number(source.quantity)
    return sum + perUnitTax * Number(r.quantity || 0)
  }, 0))
  const returnGross = round2(Math.max(0, refundTotal))
  const returnNet = round2(Math.max(0, returnGross - returnTax))
  const returnCost = round2(returnItems.reduce((sum,r)=>sum + Math.max(0,Number((saleItems.find((si)=>si.id===r.saleItemId)?.cost_at_sale)||0))*r.quantity,0))
  const refundAccount = 'ga-sales'
  const refundCreditAccount = (refundMethod||'CASH')==='CASH' ? 'ga-cash' : 'ga-bank'
  const returnLines:any[] = [
    {accountId:refundAccount, debit:returnNet, note:`مرتجع ${returnNumber}`},
    ...(returnTax > 0 ? [{accountId:'ga-sales-tax', debit:returnTax, note:`عكس ضريبة ${returnNumber}`}] : []),
    {accountId:refundCreditAccount, credit:returnGross, note:`رد قيمة ${returnNumber}`},
  ]
  if (returnCost > 0) {
    returnLines.push({accountId:'ga-inventory', debit:returnCost, note:`إعادة مخزون ${returnNumber}`})
    returnLines.push({accountId:'ga-cogs', credit:returnCost, note:`عكس تكلفة ${returnNumber}`})
  }
  stmts.push(...autoJournalStatements({
    entryId:generateUUID(), clientTxnId:`${clientTxnId}:GL`, entryNo:makeJournalEntryNo('R',clientTxnId,now), entryDate:now,
    description:`مرتجع ${returnNumber}`, referenceType:'SaleReturn', referenceId:returnId, userId, lines:returnLines
  }))

  // 5. Queue for sync (inside the same atomic batch — no separate addToOperationJournal call)
  stmts.push(
    `INSERT INTO sync_queue (entity_type, entity_id, client_txn_id, operation, payload, status, created_at)
     VALUES ${sqlVals(['SaleReturn', returnId, clientTxnId, 'CREATE', JSON.stringify({ saleId, items, reason, refundMethod, userId }), 'PENDING', now])}`
  )

  // ─── EXECUTE ATOMICALLY ───
  // Single execute() with all statements → implicit SQLite transaction.
  // No BEGIN/COMMIT needed — SQLite wraps the batch atomically.
  try {
    await atomicExec(db, stmts)
  } catch (e) {
    if (isUniqueConstraintError(e)) {
      const raced = await db.select('SELECT id, sale_id, total, refund_method, status FROM sale_returns WHERE client_txn_id = ? LIMIT 1', [clientTxnId])
      if (raced[0]) return { id: raced[0].id, returnNumber: raced[0].return_number, saleId: raced[0].sale_id, refundTotal: raced[0].total, refundMethod: raced[0].refund_method, status: raced[0].status, clientTxnId, idempotent: true }
    }
    throw new Error(`فشل إرجاع الفاتورة: ${sqlErrorMsg(e)}`)
  }

  return {
    id: returnId,
    returnNumber,
    saleId,
    refundTotal,
    loyaltyReversed,
    items: returnItems,
  }
}

// ============================================================
// CREATE USER — special handler because users.password must be
// hashed with bcrypt before being stored as password_hash. The
// generic handlePost would store the raw password and break login.
// Also enforces username uniqueness and seeds permissions based
// on role when not explicitly provided. NEVER pushes the plaintext
// password to the local operation journal — only the hashed password_hash is
// stored locally and the sync payload strips `password`.
// ============================================================
async function handleCreateUser(db, body: any): Promise<any> {
  await requirePermission(db, 'users.manage')
  const id = body.id || generateUUID()
  const { name, username, email, phone, role, pin, active, password } = body
  if (!username) throw new Error('اسم المستخدم مطلوب')
  if (!password) throw new Error('كلمة المرور مطلوبة')

  // Check username uniqueness — exclude soft-deleted rows.
  const existing = await db.select('SELECT id FROM users WHERE username = ? AND deleted_at IS NULL LIMIT 1', [username])
  if (existing[0]) throw new Error('اسم المستخدم موجود بالفعل')

  const bcrypt = await import('bcryptjs')
  const passwordHash = await bcrypt.hash(password, 12)  // OWASP recommended rounds
  const normalizedPin = pin ? String(pin).trim() : ''
  const pinHash = normalizedPin ? await bcrypt.hash(normalizedPin, 12) : null
  const effectiveRole = role || 'CASHIER'
  const permissions = Array.isArray(body.permissions) ? body.permissions : getRolePermissions(effectiveRole)

  // Keep user row + operation journal atomic. The journal payload is scrubbed
  // so plaintext credentials never enter local sync/audit storage.
  const userJournalSql = await buildOperationJournalStatement(db, 'users', id, { ...body, password: undefined })
  await atomicExec(db, [
    `INSERT INTO users (id, email, username, password_hash, name, phone, role, permissions, active, pin, created_at, updated_at)
     VALUES ${sqlVals([id, email || `${username}@local`, username, passwordHash, name || username, phone || null, effectiveRole, JSON.stringify(permissions), active !== false ? 1 : 0, pinHash, new Date().toISOString(), new Date().toISOString()])}`,
    userJournalSql,
  ])
  const rows = await db.select('SELECT id, email, username, name, phone, role, permissions, active, created_at FROM users WHERE id = ?', [id])
  const user = rowToCamel(rows[0])
  user.permissions = JSON.parse(user.permissions || '[]')
  return user
}

// ============================================================
// UPDATE USER — special handler so we never accidentally write
// plaintext passwords to password_hash. If body.password is
// present we re-hash with bcrypt; otherwise the existing hash is
// left untouched. Other updatable fields: name, email, phone,
// role, permissions, active, pin. Always bumps updated_at so
// delta sync picks up the change.
// ============================================================
async function handleUpdateUser(db, entityId: string, body: any): Promise<any> {
  await requirePermission(db, 'users.manage')
  const { name, email, phone, role, permissions, active, pin, password } = body

  // Role changes reset to the central defaults unless the UI explicitly
  // supplies a custom permissions array. This prevents a role update from
  // silently leaving permissions from the previous role behind.
  const effectivePermissions = role !== undefined && !Array.isArray(permissions)
    ? getRolePermissions(role)
    : permissions

  const cols: string[] = []
  const vals: any[] = []

  if (name !== undefined) { cols.push('name = ?'); vals.push(name) }
  if (email !== undefined) { cols.push('email = ?'); vals.push(email) }
  if (phone !== undefined) { cols.push('phone = ?'); vals.push(phone) }
  if (role !== undefined) { cols.push('role = ?'); vals.push(role) }
  if (effectivePermissions !== undefined) { cols.push('permissions = ?'); vals.push(JSON.stringify(effectivePermissions)) }
  if (active !== undefined) { cols.push('active = ?'); vals.push(active ? 1 : 0) }
  if (pin !== undefined) {
    const normalizedPin = pin ? String(pin).trim() : ''
    const bcrypt = await import('bcryptjs')
    const pinHash = normalizedPin ? await bcrypt.hash(normalizedPin, 12) : null
    cols.push('pin = ?'); vals.push(pinHash)
  }

  if (password) {
    const bcrypt = await import('bcryptjs')
    const passwordHash = await bcrypt.hash(password, 12)  // OWASP recommended rounds
    cols.push('password_hash = ?')
    vals.push(passwordHash)
  }

  if (cols.length === 0) {
    // Nothing to update — return the existing row.
    const emptyRows = await db.select('SELECT id, email, username, name, phone, role, permissions, active, created_at, updated_at FROM users WHERE id = ?', [entityId])
    const emptyUser = rowToCamel(emptyRows[0])
    if (emptyUser) emptyUser.permissions = JSON.parse(emptyUser.permissions || '[]')
    return emptyUser
  }

  cols.push("updated_at = datetime('now')")
  vals.push(entityId)

  // Don't push plaintext password to local operation journal. Keep the user
  // update and journal row atomic.
  const userJournalSql = await buildOperationJournalStatement(db, 'users', entityId, { ...body, password: undefined }, 'UPDATE')
  await atomicExec(db, [
    updateSql('users', cols, vals, entityId),
    userJournalSql,
  ])

  const rows = await db.select('SELECT id, email, username, name, phone, role, permissions, active, created_at, updated_at FROM users WHERE id = ?', [entityId])
  const user = rowToCamel(rows[0])
  if (user) user.permissions = JSON.parse(user.permissions || '[]')
  return user
}

// ============================================================
// PUT SETTINGS — settings uses `key` as PRIMARY KEY (not `id`),
// so the generic handlePut (`WHERE id = ?`) cannot update it.
// Body can be either:
//   - { settings: [{key, value, category}, ...] }  (batch from settings.tsx)
//   - { key, value, category }                      (single)
// Uses INSERT OR REPLACE so missing settings get created and
// existing ones updated in place. Each row also bumps updated_at
// for delta-sync support.
// ============================================================
async function handlePutSettings(db, body: any): Promise<any> {
  await requirePermission(db, 'settings.edit')
  const items: Array<{ key: string, value: any, category?: string }> =
    Array.isArray(body.settings) ? body.settings : [body]

  const stmts = items.filter(item => Boolean(item.key)).map(item =>
    `INSERT OR REPLACE INTO settings (key, value, category, updated_at) VALUES ${sqlVals([item.key, String(item.value ?? ''), item.category || 'general', new Date().toISOString()])}`
  )
  if (stmts.length) await atomicExec(db, stmts)
  return { saved: items.length, keys: items.map(i => i.key) }
}

// ============================================================
// CREATE PURCHASE — multi-table atomic write that creates the
// purchase header, all purchase_items, increments stock on hand,
// recalculates weighted-average cost, logs a PURCHASE
// stock_movement per line, updates the supplier's running balance
// when the purchase is on account, and queues the whole thing for
// sync.
//
// ATOMIC EXECUTION: tauri-plugin-sql does NOT support BEGIN/COMMIT
// across separate execute() calls (each call may use a different
// pooled connection, causing "cannot commit - no transaction is
// active"). All writes are concatenated into ONE execute() call;
// SQLite wraps the entire batch in an implicit transaction — if ANY
// statement fails, the WHOLE batch rolls back atomically.
//
// IDEMPOTENCY: before creating, check if a purchase with this
// clientTxnId already exists → return it (prevents duplicates from
// retries or double-clicks).
//
// PRE-READS: the per-product stock + avg_cost lookup that used to
// happen INSIDE the transaction now happens BEFORE building the
// atomic batch — db.select() cannot be part of a multi-statement
// execute() batch.
// ============================================================
async function handleCreatePurchase(db, body: any): Promise<any> {
  const authUser = await requirePermission(db, 'purchase.create')
  const id = body.id || generateUUID()
  const clientTxnId = body.clientTxnId || id
  const { invoiceNumber, supplierId, status, note } = body
  const paymentSource = normalizePurchasePaymentSource(body.paymentSource ?? body.paymentMethod)
  const paymentMethod = paymentSource === 'CASHBOX' ? 'CASH' : paymentSource
  const userId = authUser.id

  if (!body.items || body.items.length === 0) throw new Error('لا توجد أصناف في الفاتورة')

  // ─── NORMALIZE NUMERIC INPUT ───
  // Quantities/costs arrive from the create-purchase form as STRINGS
  // (raw <input> state). JS's `+` operator concatenates instead of adding
  // when one side is a string (e.g. 20 + "5" === "205", NOT 25) — that is
  // exactly why stock looked like it wasn't summing onto the existing
  // quantity: the "new" number was landing right next to the old one
  // instead of being added to it. Coercing every numeric field to Number
  // up front makes all the math below real arithmetic.
  const items = body.items.map((it) => ({
    productId: String(it.productId || ''),
    quantity: Number(it.quantity),
    unitCost: Number(it.unitCost),
    taxRate: Number(it.taxRate) || 0,
  }))
  if (items.some((it) => !it.productId || !Number.isInteger(it.quantity) || it.quantity <= 0)) {
    throw new Error('بيانات أصناف الشراء غير صحيحة: الكمية يجب أن تكون رقمًا صحيحًا أكبر من صفر')
  }
  if (items.some((it) => !Number.isFinite(it.unitCost) || it.unitCost < 0)) {
    throw new Error('تكلفة الشراء غير صحيحة')
  }
  if (items.some((it) => !Number.isFinite(it.taxRate) || it.taxRate < 0 || it.taxRate > 100)) {
    throw new Error('نسبة الضريبة غير صحيحة')
  }
  const taxAmount = Number(body.taxAmount) || 0
  const discountAmount = Number(body.discountAmount) || 0

  const purchaseStatus = status || 'RECEIVED'
  const now = new Date().toISOString()
  const finalSubtotal = body.subtotal !== undefined
    ? Number(body.subtotal) || 0
    : items.reduce((s, i) => s + i.quantity * i.unitCost, 0)
  // FIX: total used to fall back to `subtotal` alone when the caller
  // didn't pass `total` explicitly (the create-purchase form never does),
  // silently dropping tax/discount from the stored invoice total and from
  // the supplier balance calculated off it.
  const finalTotal = body.total !== undefined
    ? Number(body.total) || 0
    : finalSubtotal + taxAmount - discountAmount
  const finalPaid = body.paidAmount !== undefined && body.paidAmount !== null
    ? Number(body.paidAmount) || 0
    : finalTotal
  if (!Number.isFinite(finalPaid) || finalPaid < 0 || finalPaid > finalTotal + 0.01) {
    throw new Error('المبلغ المدفوع غير صالح أو أكبر من إجمالي الفاتورة')
  }
  const invNo = invoiceNumber || `PUR-${Date.now()}-${generateUUID().slice(0, 8).toUpperCase()}`
  if (!supplierId) throw new Error('اختر المورد أولًا')
  const supplierExists = await db.select('SELECT id FROM suppliers WHERE id = ? AND deleted_at IS NULL LIMIT 1', [supplierId])
  if (!supplierExists[0]) throw new Error('المورد غير موجود')

  // ─── IDEMPOTENCY CHECK ───
  // If this clientTxnId already exists, return the existing purchase.
  // Prevents duplicate purchases from sync retries or double-clicks.
  const existing = await db.select('SELECT id FROM purchases WHERE client_txn_id = ? LIMIT 1', [clientTxnId])
  if (existing[0]) return { id: existing[0].id, idempotent: true }

  // A paid purchase is a real cash/bank outflow. Legacy Uni Kasher treated
  // paid purchase amounts as CASH, so preserve that default while making
  // the method explicit. CASH payments must belong to the current user's
  // open drawer and can never exceed the available expected cash.
  let purchaseCashSession: any = null
  if (finalPaid > 0 && paymentSource === 'CASHBOX') {
    const sessionRows = await db.select(
      "SELECT id, user_id, opening_balance FROM cash_sessions WHERE status='OPEN' AND deleted_at IS NULL ORDER BY opened_at DESC LIMIT 1"
    )
    purchaseCashSession = sessionRows[0] || null
    if (!purchaseCashSession) throw new Error('لا يمكن تسجيل دفع نقدي للمورد بدون خزنة مفتوحة')
    if (purchaseCashSession.user_id && purchaseCashSession.user_id !== userId) throw new Error('لا تملك صلاحية استخدام هذه الخزنة')
    const movements = await db.select(
      'SELECT type, amount FROM cash_movements WHERE session_id = ? AND deleted_at IS NULL ORDER BY created_at ASC',
      [purchaseCashSession.id]
    )
    const expected = calculateExpectedCash(purchaseCashSession.opening_balance, movements)
    if (finalPaid > expected + 0.01) throw new Error(`المبلغ المدفوع (${finalPaid.toFixed(2)}) أكبر من النقدية المتاحة في الخزنة (${expected.toFixed(2)})`)
  }

  // ─── PRE-FETCH PRODUCT DATA ───
  // We need current_stock + avg_cost for each item to compute the new
  // weighted-average cost. These reads MUST happen BEFORE building the
  // atomic batch — db.select() cannot be part of a multi-statement
  // execute() batch.
  const itemsData: any[] = []
  const purchaseState = new Map<string, { oldQty:number; oldCost:number; runningQty:number; runningCost:number }>()
  for (const item of items) {
    const itemId = generateUUID()
    const lineTotal = item.quantity * item.unitCost
    if (!purchaseState.has(item.productId)) {
      const productRows = await db.select('SELECT current_stock, avg_cost FROM products WHERE id = ? AND deleted_at IS NULL', [item.productId])
      const product = productRows[0]
      if (!product) throw new Error(`المنتج غير موجود: ${item.productId}`)
      purchaseState.set(item.productId, { oldQty: Number(product.current_stock)||0, oldCost: Number(product.avg_cost)||0, runningQty: 0, runningCost: 0 })
    }
    const state = purchaseState.get(item.productId)!
    state.runningQty += item.quantity
    state.runningCost += item.quantity * item.unitCost
    const newQty = state.oldQty + state.runningQty
    const newAvg = newQty > 0 ? ((state.oldQty * state.oldCost) + state.runningCost) / newQty : item.unitCost
    itemsData.push({ item, itemId, lineTotal, productFound: true, newQty, newAvg })
  }

  // ─── BUILD ATOMIC SQL BATCH ───
  const warehouseId = body.warehouseId || await resolveDefaultWarehouseId(db, null)

  const stmts: string[] = []

  // 1. Purchase header (with idempotency key from migration 002)
  stmts.push(
    `INSERT INTO purchases (id, client_txn_id, invoice_number, supplier_id, user_id, warehouse_id, subtotal, tax_amount, discount_amount, total, paid_amount, payment_method, status, note, created_at, updated_at)
     VALUES ${sqlVals([id, clientTxnId, invNo, supplierId || null, userId || null, warehouseId || null, finalSubtotal, taxAmount || 0, discountAmount || 0, finalTotal, finalPaid, paymentMethod, purchaseStatus, note || '', now, now])}`
  )

  // 2. Purchase items + stock update + weighted-avg cost + movement log
  for (const d of itemsData) {
    stmts.push(
      `INSERT INTO purchase_items (id, purchase_id, product_id, quantity, unit_cost, tax_rate, total)
       VALUES ${sqlVals([d.itemId, id, d.item.productId, d.item.quantity, d.item.unitCost, d.item.taxRate || 0, d.lineTotal])}`
    )
    if (d.productFound && d.newQty !== null && d.newAvg !== null) {
      const isLastForProduct = itemsData.findLastIndex((x) => x.item.productId === d.item.productId) === itemsData.indexOf(d)
      stmts.push(
        `INSERT INTO stock_movements (id, client_txn_id, product_id, warehouse_id, type, quantity, ref_type, ref_id, note, sync_status, created_at)
         VALUES ${sqlVals([generateUUID(), `${clientTxnId}:${d.item.productId}:STOCK`, d.item.productId, warehouseId, 'PURCHASE', d.item.quantity, 'Purchase', id, `شراء - ${invNo}`, 'pending', now])}`
      )
      // FIX: newAvg (weighted-average cost) was computed above for every
      // purchase but never written back to products.avg_cost — this
      // function's own docstring says it "recalculates weighted-average
      // cost", but no UPDATE ever existed, so avg_cost stayed frozen at
      // whatever it was when the product was first created. That silently
      // fed a stale cost into every sale's costAtSale snapshot, the profit
      // report (calculateProfitSummary), inventory valuation
      // (current_stock * avg_cost), and the sale COGS/inventory ledger
      // lines. Only write once per product per purchase — on the LAST line
      // for that product — since newAvg already accumulates every earlier
      // line for the same product in this invoice.
      if (isLastForProduct) {
        stmts.push(
          `UPDATE products SET avg_cost = ${sqlEsc(round2(d.newAvg))}, updated_at = ${sqlEsc(now)} WHERE id = ${sqlEsc(d.item.productId)}`
        )
      }
    }
  }

  // 3. If on account (paid < total), increase supplier balance by the unpaid portion
  if (supplierId && finalPaid < finalTotal) {
    const unpaid = finalTotal - finalPaid
    stmts.push(
      `UPDATE suppliers SET balance = COALESCE(balance, 0) + ${sqlEsc(unpaid)}, updated_at = ${sqlEsc(now)} WHERE id = ${sqlEsc(supplierId)}`
    )
  }

  // Every supplier payment gets its own immutable history row. This makes
  // lifetime paid totals correct even when one invoice is settled in several steps.
  if (finalPaid > 0) {
    stmts.push(
      `INSERT INTO purchase_payments (id, client_txn_id, purchase_id, supplier_id, amount, source, method, note, user_id, paid_at, created_at)
       VALUES ${sqlVals([generateUUID(), `${clientTxnId}:PAYMENT`, id, supplierId || null, finalPaid, paymentSource, paymentMethod, note || '', userId, now, now])}`
    )
  }

  // 4. Paid supplier amount = real cash/bank outflow. CASH is written into
  // the same drawer ledger used by the rest of the POS, so the financial
  // dashboard and daily cash reconciliation see the exact same event.
  if (finalPaid > 0 && paymentSource === 'CASHBOX' && purchaseCashSession) {
    const cashMovementTxnId = `${clientTxnId}:PURCHASE:CASH`
    const cashMovementId = generateUUID()
    const cashPayload = {
      id: cashMovementId, clientTxnId: cashMovementTxnId, sessionId: purchaseCashSession.id,
      type: 'CASH_OUT', amount: finalPaid, note: `شراء - ${invNo}`, refType: 'Purchase', refId: id,
    }
    stmts.push(
      `INSERT INTO cash_movements (id, client_txn_id, session_id, type, amount, note, ref_type, ref_id, sync_status, created_at)
       VALUES ${sqlVals([cashMovementId, cashMovementTxnId, purchaseCashSession.id, 'CASH_OUT', finalPaid, `شراء - ${invNo}`, 'Purchase', id, 'pending', now])}`
    )
    stmts.push(
      `INSERT INTO sync_queue (entity_type, entity_id, client_txn_id, operation, payload, status, created_at)
       VALUES ${sqlVals(['CashMovement', cashMovementId, cashMovementTxnId, 'CREATE', JSON.stringify(cashPayload), 'PENDING', now])}`
    )
  }

  // Automatic General Ledger entry for purchase + immediate payment/AP.
  const purchaseNet = round2(Math.max(0, finalSubtotal - discountAmount))
  const purchaseTax = round2(Math.max(0, taxAmount))
  const unpaidAmount = round2(Math.max(0, finalTotal - finalPaid))
  const purchaseLines: Array<{accountId:string; debit?:number; credit?:number; note?:string}> = [
    {accountId:'ga-inventory', debit:purchaseNet, note:`مخزون من ${invNo}`},
  ]
  if (purchaseTax > 0) purchaseLines.push({accountId:'ga-purchase-tax', debit:purchaseTax, note:`ضريبة مشتريات ${invNo}`})
  if (finalPaid > 0) purchaseLines.push({accountId:paymentSource==='CASHBOX' ? 'ga-cash' : (paymentSource==='CARD' || paymentSource==='TRANSFER' ? 'ga-bank' : 'ga-cash-outside'), credit:finalPaid, note:`دفع شراء ${invNo}`})
  if (unpaidAmount > 0) purchaseLines.push({accountId:'ga-suppliers', credit:unpaidAmount, note:`مستحق للمورد ${invNo}`})
  stmts.push(...autoJournalStatements({
    entryId:generateUUID(), clientTxnId:`${clientTxnId}:GL`, entryNo:makeJournalEntryNo('P',clientTxnId,now), entryDate:now,
    description:`شراء ${invNo}`, referenceType:'Purchase', referenceId:id, userId, lines:purchaseLines
  }))

  // 5. Queue for sync (inside the same atomic batch — no separate addToOperationJournal call)
  stmts.push(
    `INSERT INTO sync_queue (entity_type, entity_id, client_txn_id, operation, payload, status, created_at)
     VALUES ${sqlVals(['Purchase', id, clientTxnId, 'CREATE', JSON.stringify({ ...body, clientTxnId }), 'PENDING', now])}`
  )

  // ─── EXECUTE ATOMICALLY ───
  // Single execute() with all statements → implicit SQLite transaction.
  // No BEGIN/COMMIT needed — SQLite wraps the batch atomically.
  try {
    await atomicExec(db, stmts)
  } catch (e) {
    if (isUniqueConstraintError(e)) {
      const raced = await db.select('SELECT id, client_txn_id, invoice_number FROM purchases WHERE client_txn_id = ? LIMIT 1', [clientTxnId])
      if (raced[0]) return { id: raced[0].id, clientTxnId: raced[0].client_txn_id, invoiceNumber: raced[0].invoice_number, idempotent: true }
    }
    throw new Error(`فشل إنشاء الفاتورة: ${sqlErrorMsg(e)}`)
  }

  return { id, clientTxnId, ...body, paymentMethod, paymentSource }
}

// ============================================================
// PAY REMAINING BALANCE ON A PURCHASE INVOICE
// POST /purchases/{id}/pay  { amount, note? }
// Lets a supplier's outstanding balance on a specific purchase be settled
// (fully or partially) from the Purchases screen — increases the
// purchase's paid_amount, recalculates its status, and reduces the
// supplier's overall running balance by the same amount.
// ============================================================
async function handlePurchasePayment(db, path: string, body: any): Promise<any> {
  const authUser = await requirePermission(db, 'purchase.create')
  const pathParts = path.split('?')[0].split('/').filter(Boolean)
  const payIdx = pathParts.indexOf('pay')
  const purchaseId = payIdx > 0 ? pathParts[payIdx - 1] : null
  if (!purchaseId) throw new Error('فاتورة الشراء غير محددة')

  const amount = Number(body.amount) || 0
  if (amount <= 0) throw new Error('قيمة السداد يجب أن تكون أكبر من صفر')
  const paymentSource = normalizePurchasePaymentSource(body.paymentSource ?? body.paymentMethod)
  const paymentMethod = paymentSource === 'CASHBOX' ? 'CASH' : paymentSource

  const rows = await db.select('SELECT * FROM purchases WHERE id = ? AND deleted_at IS NULL LIMIT 1', [purchaseId])
  const purchase = rows[0]
  if (!purchase) throw new Error('فاتورة الشراء غير موجودة')

  const total = Number(purchase.total) || 0
  const alreadyPaid = Number(purchase.paid_amount) || 0
  const remaining = total - alreadyPaid
  if (remaining <= 0) throw new Error('لا يوجد مبلغ متبقٍ على هذه الفاتورة')
  if (amount > remaining + 0.01) throw new Error('المبلغ المدخل أكبر من المتبقي على الفاتورة')

  let payCashSession: any = null
  if (paymentSource === 'CASHBOX') {
    const sessionRows = await db.select(
      "SELECT id, user_id, opening_balance FROM cash_sessions WHERE status='OPEN' AND deleted_at IS NULL ORDER BY opened_at DESC LIMIT 1"
    )
    payCashSession = sessionRows[0] || null
    if (!payCashSession) throw new Error('لا يمكن سداد المورد نقدًا بدون خزنة مفتوحة')
    if (payCashSession.user_id && payCashSession.user_id !== authUser.id) throw new Error('لا تملك صلاحية استخدام هذه الخزنة')
    const movements = await db.select(
      'SELECT type, amount FROM cash_movements WHERE session_id = ? AND deleted_at IS NULL ORDER BY created_at ASC',
      [payCashSession.id]
    )
    const expected = calculateExpectedCash(payCashSession.opening_balance, movements)
    if (amount > expected + 0.01) throw new Error(`المبلغ المدفوع (${amount.toFixed(2)}) أكبر من النقدية المتاحة في الخزنة (${expected.toFixed(2)})`)
  }

  const newPaid = Math.min(alreadyPaid + amount, total)
  const newStatus = newPaid >= total ? 'PAID' : 'PARTIAL'
  const now = new Date().toISOString()
  const clientTxnId = body.clientTxnId || generateUUID()
  const duplicate = await db.select(
    "SELECT id FROM purchase_payments WHERE client_txn_id = ? LIMIT 1",
    [clientTxnId + ':HISTORY']
  )
  const queuedDuplicate = await db.select(
    "SELECT entity_id FROM sync_queue WHERE client_txn_id = ? AND entity_type = 'PurchasePayment' LIMIT 1",
    [clientTxnId]
  )
  if (duplicate[0] || queuedDuplicate[0]) {
    const updated = await db.select('SELECT * FROM purchases WHERE id = ?', [purchaseId])
    return { ...rowToCamel(updated[0]), idempotent: true }
  }

  const stmts: string[] = [
    `UPDATE purchases SET paid_amount = ${sqlEsc(newPaid)}, payment_method = ${sqlEsc(paymentMethod)}, status = ${sqlEsc(newStatus)}, updated_at = ${sqlEsc(now)} WHERE id = ${sqlEsc(purchaseId)}`,
  ]
  if (purchase.supplier_id) {
    stmts.push(
      `UPDATE suppliers SET balance = MAX(0, COALESCE(balance, 0) - ${sqlEsc(amount)}), updated_at = ${sqlEsc(now)} WHERE id = ${sqlEsc(purchase.supplier_id)}`
    )
  }

  // Every additional settlement must also create an immutable payment-history row.
  // Without this, the invoice paid_amount changed but supplier-level totals and
  // the payment history stayed unchanged after the second/third payment.
  stmts.push(
    `INSERT INTO purchase_payments (id, client_txn_id, purchase_id, supplier_id, amount, source, method, note, user_id, paid_at, created_at)
     VALUES ${sqlVals([generateUUID(), clientTxnId + ':HISTORY', purchaseId, purchase.supplier_id || null, amount, paymentSource, paymentMethod, body.note || null, authUser.id, now, now])}`
  )

  if (paymentSource === 'CASHBOX' && payCashSession) {
    const cashMovementTxnId = `${clientTxnId}:PURCHASE_PAYMENT:CASH`
    const cashMovementId = generateUUID()
    const cashPayload = {
      id: cashMovementId, clientTxnId: cashMovementTxnId, sessionId: payCashSession.id,
      type: 'CASH_OUT', amount, note: `سداد مورد - ${purchase.invoice_number}`,
      refType: 'PurchasePayment', refId: purchaseId,
    }
    stmts.push(
      `INSERT INTO cash_movements (id, client_txn_id, session_id, type, amount, note, ref_type, ref_id, sync_status, created_at)
       VALUES ${sqlVals([cashMovementId, cashMovementTxnId, payCashSession.id, 'CASH_OUT', amount, `سداد مورد - ${purchase.invoice_number}`, 'PurchasePayment', purchaseId, 'pending', now])}`
    )
    stmts.push(
      `INSERT INTO sync_queue (entity_type, entity_id, client_txn_id, operation, payload, status, created_at)
       VALUES ${sqlVals(['CashMovement', cashMovementId, cashMovementTxnId, 'CREATE', JSON.stringify(cashPayload), 'PENDING', now])}`
    )
  }
  // Automatic General Ledger entry for a subsequent supplier settlement.
  stmts.push(...autoJournalStatements({
    entryId: generateUUID(), clientTxnId: `${clientTxnId}:GL`,
    entryNo: makeJournalEntryNo('PP', clientTxnId, now), entryDate: now,
    description: `سداد مورد - ${purchase.invoice_number}`, referenceType: 'PurchasePayment',
    referenceId: purchaseId, userId: authUser.id,
    lines: [
      { accountId: 'ga-suppliers', debit: amount, note: `خفض مديونية المورد - ${purchase.invoice_number}` },
      { accountId: paymentSource === 'CASHBOX' ? 'ga-cash' : (paymentSource === 'CARD' || paymentSource === 'TRANSFER' ? 'ga-bank' : 'ga-cash-outside'), credit: amount, note: `سداد فعلي - ${purchase.invoice_number}` },
    ]
  }))

  stmts.push(
    `INSERT INTO sync_queue (entity_type, entity_id, client_txn_id, operation, payload, status, created_at)
     VALUES ${sqlVals(['PurchasePayment', purchaseId, clientTxnId, 'UPDATE', JSON.stringify({ purchaseId, amount, paymentMethod, paymentSource, note: body.note || null, clientTxnId }), 'PENDING', now])}`
  )

  try {
    await atomicExec(db, stmts)
  } catch (e) {
    if (isUniqueConstraintError(e)) {
      const raced = await db.select('SELECT purchase_id, amount FROM purchase_payments WHERE client_txn_id = ? LIMIT 1', [clientTxnId + ':HISTORY'])
      if (raced[0]) { const updated = await db.select('SELECT * FROM purchases WHERE id = ?', [purchaseId]); return { ...rowToCamel(updated[0]), idempotent: true, paymentAmount: raced[0].amount } }
    }
    throw new Error(`فشل تسجيل السداد: ${sqlErrorMsg(e)}`)
  }

  const updated = await db.select('SELECT * FROM purchases WHERE id = ?', [purchaseId])
  return rowToCamel(updated[0])
}

async function handleCash(db, _path: string): Promise<any> {
  // cash_sessions + cash_movements both carry deleted_at (migration 002).
  const sessions = await db.select("SELECT * FROM cash_sessions WHERE status = 'OPEN' AND deleted_at IS NULL ORDER BY opened_at DESC LIMIT 1")
  if (sessions.length === 0) return null
  const session = rowToCamel(sessions[0])
  // Join the session owner: handleCashMovement() enforces that every
  // movement in a session belongs to the register owner, so the session
  // owner IS the acting user for each row. Surface it for the cash table.
  const movements = await db.select(
    `
    SELECT cm.*, u.name AS user_name, u.username AS user_username
      FROM cash_movements cm
      JOIN cash_sessions cs ON cs.id = cm.session_id
      LEFT JOIN users u ON u.id = cs.user_id
      WHERE cm.session_id = ? AND cm.deleted_at IS NULL
      ORDER BY cm.created_at DESC
    `
    ,
    [sessions[0].id]
  )
  session.movements = movements.map(rowToCamel)
  session.expectedCash = calculateExpectedCash(session.openingBalance, movements)
  // Attach the register owner (acting user) so the header badge and subtitle
  // can show a real name instead of a dash. cash_sessions.user_id is NOT NULL,
  // so this join always resolves for real sessions.
  const ownerRows = await db.select(
    'SELECT u.id, u.name, u.username FROM users u WHERE u.id = ? LIMIT 1',
    [sessions[0].user_id]
  )
  session.user = ownerRows[0] ? rowToCamel(ownerRows[0]) : null
  session.userName = ownerRows[0]?.name || ownerRows[0]?.username || null
  return session
}

// ============================================================
// GENERAL ACCOUNTING — chart of accounts, journal entries and monthly
// operating summary. Waste is an owner-configured percentage deducted
// from monthly operating profit; it is NOT physical stock destruction.
// ============================================================
const GENERAL_ACCOUNT_TYPES = ['ASSET','LIABILITY','EQUITY','REVENUE','COGS','EXPENSE'] as const
// These schemas are created lazily. Keeping them out of module evaluation makes
// utility modules (for example receipt rendering) independent from validation
// initialization during tests and printing.
const getGeneralAccountSchema = () => z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(120),
  nameAr: z.string().min(1).max(120),
  accountType: z.enum(GENERAL_ACCOUNT_TYPES),
  parentId: z.string().nullable().optional(),
  openingBalance: z.number().min(0).optional().default(0),
})
const getJournalEntrySchema = () => z.object({
  entryDate: z.string().min(1),
  description: z.string().min(2).max(250),
  lines: z.array(z.object({
    accountId: z.string().min(1),
    debit: z.number().min(0).optional().default(0),
    credit: z.number().min(0).optional().default(0),
    note: z.string().max(250).optional().default(''),
  }).refine(v => (v.debit || 0) > 0 || (v.credit || 0) > 0, { message: 'كل سطر قيد يجب أن يحتوي على مدين أو دائن' })).min(2),
  referenceType: z.string().max(50).optional(),
  referenceId: z.string().max(120).optional(),
  clientTxnId: z.string().optional(),
})

function monthBounds(path: string): { dateFrom?: string, dateTo?: string } {
  const url = new URL(`http://x${path}`)
  const from = url.searchParams.get('dateFrom') || undefined
  const to = url.searchParams.get('dateTo') || undefined
  return { dateFrom: from, dateTo: to }
}

async function generalOperatingSummary(db, dateFrom?: string, dateTo?: string): Promise<any> {
  const toExclusive = (date?: string) => {
    if (!date) return undefined
    const d = new Date(`${date}T00:00:00`)
    if (Number.isNaN(d.getTime())) return date
    d.setDate(d.getDate() + 1)
    return d.toISOString()
  }
  const endExclusive = toExclusive(dateTo)
  const buildRange = (column: string, args: any[]) => {
    const parts: string[] = []
    if (dateFrom) { parts.push(`${column} >= ?`); args.push(dateFrom) }
    if (endExclusive) { parts.push(`${column} < ?`); args.push(endExclusive) }
    return parts.length ? ` AND ${parts.join(' AND ')}` : ''
  }

  // ------------------------------------------------------------------
  // REAL SYSTEM EVENTS — sales + returns + expenses.
  // This dashboard is intentionally derived from the operational tables
  // instead of relying on manually-posted accounting entries.
  // ------------------------------------------------------------------
  const salesArgs: any[] = []
  const salesRows = await db.select(
    `SELECT s.id, s.created_at, s.total, s.tax_amount, s.status,
            si.id AS sale_item_id, si.quantity, si.total AS item_total,
            si.tax_amount AS item_tax, si.cost_at_sale
     FROM sales s
     JOIN sale_items si ON si.sale_id = s.id
     WHERE s.deleted_at IS NULL${buildRange('s.created_at', salesArgs)}`,
    salesArgs
  )

  const returnArgs: any[] = []
  const returnRows = await db.select(
    `SELECT sr.id, sr.created_at, sr.total, sr.tax_amount, sr.subtotal,
            sri.sale_item_id, sri.quantity, si.cost_at_sale, sri.unit_price
     FROM sale_returns sr
     JOIN sale_return_items sri ON sri.sale_return_id = sr.id
     LEFT JOIN sale_items si ON si.id = sri.sale_item_id
     WHERE sr.status = 'COMPLETED'${buildRange('sr.created_at', returnArgs)}`,
    returnArgs
  )

  const expenseArgs: any[] = []
  const expenseRows = await db.select(
    `SELECT e.id, e.date, e.amount, e.payment_method, e.category_id,
            ec.name_ar category_name_ar, ec.name category_name
     FROM expenses e
     LEFT JOIN expense_categories ec ON ec.id = e.category_id
     WHERE e.deleted_at IS NULL${buildRange('e.date', expenseArgs)}`,
    expenseArgs
  )

  const monthBucket = (map: Map<string, any>, value: any) => {
    const key = String(value || '').slice(0, 7) || 'unknown'
    if (!map.has(key)) map.set(key, {
      revenue: 0, cogs: 0, returns: 0, expenses: 0,
      manualRevenue: 0, manualCogs: 0, manualExpenses: 0,
    })
    return map.get(key)!
  }

  const monthly = new Map<string, any>()
  let revenue = 0
  let cogs = 0
  let returnRevenue = 0
  let returnCogs = 0
  const seenSales = new Set<string>()

  for (const r of salesRows) {
    const qty = Math.max(0, Number(r.quantity || 0))
    const saleNetRevenue = Math.max(0, Number(r.total || 0) - Number(r.tax_amount || 0))
    const itemRevenueBeforeDiscount = Math.max(0, Number(r.item_total || 0) - Number(r.item_tax || 0))
    const saleSubtotal = Math.max(0, Number(r.subtotal || 0))
    const allocatedItemRevenue = saleSubtotal > 0
      ? itemRevenueBeforeDiscount * (saleNetRevenue / saleSubtotal)
      : 0
    const costLine = Math.max(0, Number(r.cost_at_sale || 0)) * qty

    // Revenue is counted once per sale from the saved invoice total, which
    // already includes manual + loyalty discounts and excludes tax.
    // COGS stays item-based because each sale line preserves cost_at_sale.
    if (!seenSales.has(String(r.id))) {
      const b = monthBucket(monthly, r.created_at)
      b.revenue += saleNetRevenue
      revenue += saleNetRevenue
      seenSales.add(String(r.id))
    }
    cogs += costLine
    const b = monthBucket(monthly, r.created_at)
    b.cogs += costLine

    // Keep the allocated revenue available for diagnostics/audits even when
    // a sale contains multiple items. It intentionally does not add to
    // `revenue` a second time.
    void allocatedItemRevenue
  }

  for (const r of returnRows) {
    const qty = Math.max(0, Number(r.quantity || 0))
    const unitCost = Math.max(0, Number(r.cost_at_sale || 0))
    const refundSubtotal = Number(r.subtotal ?? ((Number(r.total || 0) - Number(r.tax_amount || 0))))
    const cost = unitCost * qty
    returnRevenue += Math.max(0, refundSubtotal)
    returnCogs += Math.max(0, cost)
    const b = monthBucket(monthly, r.created_at)
    b.returns += Math.max(0, refundSubtotal)
    b.revenue -= Math.max(0, refundSubtotal)
    b.cogs -= Math.max(0, cost)
  }

  revenue = round2(Math.max(0, revenue - returnRevenue))
  cogs = round2(Math.max(0, cogs - returnCogs))

  let operatingExpenses = 0
  const expensesByCategory = new Map<string, { category: string; amount: number; count: number }>()
  const paymentMethods = new Map<string, number>()
  for (const e of expenseRows) {
    const amount = Math.max(0, Number(e.amount || 0))
    operatingExpenses += amount
    const b = monthBucket(monthly, e.date)
    b.expenses += amount
    const category = e.category_name_ar || e.category_name || 'أخرى'
    const item = expensesByCategory.get(category) || { category, amount: 0, count: 0 }
    item.amount += amount
    item.count++
    expensesByCategory.set(category, item)
    const method = String(e.payment_method || 'OTHER')
    paymentMethods.set(method, round2((paymentMethods.get(method) || 0) + amount))
  }
  operatingExpenses = round2(operatingExpenses)

  // ------------------------------------------------------------------
  // MANUAL GENERAL JOURNAL = adjustments only.
  // We never replace the real operational numbers with journal totals.
  // This keeps the dashboard faithful to the POS while still allowing
  // deep accounting adjustments (other income/expense, corrections...).
  // ------------------------------------------------------------------
  const journalArgs: any[] = []
  const journalWhere = [`e.status='POSTED' AND COALESCE(e.entry_source,'MANUAL')='MANUAL'${buildRange('e.entry_date', journalArgs)}`]
  const journalRows = await db.select(
    `SELECT e.entry_date, a.account_type, SUM(l.debit) debit, SUM(l.credit) credit
     FROM general_journal_lines l
     JOIN general_journal_entries e ON e.id=l.journal_entry_id
     JOIN general_accounts a ON a.id=l.account_id
     WHERE ${journalWhere.join(' AND ')}
     GROUP BY e.entry_date, a.account_type`,
    journalArgs
  )

  let manualRevenue = 0
  let manualExpense = 0
  let manualCogs = 0
  for (const r of journalRows) {
    const type = r.account_type
    const debit = Number(r.debit || 0)
    const credit = Number(r.credit || 0)
    const b = monthBucket(monthly, r.entry_date)
    if (type === 'REVENUE') {
      const amount = credit - debit
      manualRevenue += amount
      b.manualRevenue += amount
    } else if (type === 'EXPENSE') {
      const amount = debit - credit
      manualExpense += amount
      b.manualExpenses += amount
    } else if (type === 'COGS') {
      const amount = debit - credit
      manualCogs += amount
      b.manualCogs += amount
    }
  }
  manualRevenue = round2(manualRevenue)
  manualExpense = round2(manualExpense)
  manualCogs = round2(manualCogs)

  const journalAdjustment = round2(manualRevenue - manualExpense - manualCogs)
  const grossProfit = round2(revenue - cogs)
  const operatingProfitBeforeWaste = round2(grossProfit - operatingExpenses + journalAdjustment)

  const cfg = await db.select("SELECT value FROM settings WHERE key='general.wasteRate' LIMIT 1")
  const wasteRate = Math.min(100, Math.max(0, Number(cfg[0]?.value || 0) || 0))

  let wasteProvision = 0
  const monthlyProfit = Array.from(monthly.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, b]) => {
      const netRev = round2(b.revenue + b.manualRevenue)
      const netCogs = round2(b.cogs + b.manualCogs)
      const exp = round2(b.expenses + b.manualExpenses)
      const gross = round2(netRev - netCogs)
      const op = round2(gross - exp)
      const waste = round2(Math.max(0, op) * wasteRate / 100)
      wasteProvision = round2(wasteProvision + waste)
      return {
        month,
        revenue: netRev,
        cogs: netCogs,
        expenses: exp,
        grossProfit: gross,
        operatingProfitBeforeWaste: op,
        wasteProvision: waste,
        netProfitAfterWaste: round2(op - waste),
      }
    })

  // ------------------------------------------------------------------
  // OPERATIONAL SNAPSHOT — current position regardless of date filter.
  // ------------------------------------------------------------------
  const cashRows = await db.select(
    "SELECT id, opening_balance FROM cash_sessions WHERE status='OPEN' AND deleted_at IS NULL"
  )
  let currentCash = 0
  for (const session of cashRows) {
    const movements = await db.select(
      'SELECT type, amount FROM cash_movements WHERE session_id = ? AND deleted_at IS NULL ORDER BY created_at ASC',
      [session.id]
    )
    currentCash += calculateExpectedCash(Number(session.opening_balance || 0), movements)
  }
  currentCash = round2(Math.max(0, currentCash))

  const inventoryRows = await db.select(
    "SELECT COALESCE(current_stock,0) current_stock, COALESCE(avg_cost,0) avg_cost FROM products WHERE deleted_at IS NULL AND active != 0"
  )
  const inventoryValue = round2(inventoryRows.reduce((sum, p) => sum + Math.max(0, Number(p.current_stock || 0)) * Math.max(0, Number(p.avg_cost || 0)), 0))

  const deadSnapshot = await getDeadStockSnapshot(db)
  const defaultDeadDays = deadSnapshot.defaultDays
  const deadStockProducts = deadSnapshot.products
  const deadStockValue = deadSnapshot.value

  const payablesRows = await db.select("SELECT COALESCE(SUM(CASE WHEN balance > 0 THEN balance ELSE 0 END),0) balance FROM suppliers WHERE deleted_at IS NULL")
  const supplierPayables = round2(Number(payablesRows[0]?.balance || 0))

  const purchaseArgs: any[] = []
  const purchaseWhere = [`p.deleted_at IS NULL${buildRange('p.created_at', purchaseArgs)}`]
  const purchaseRows = await db.select(
    `SELECT COALESCE(SUM(p.total),0) total,
            COALESCE(SUM(p.paid_amount),0) paid,
            COUNT(*) count
     FROM purchases p
     WHERE ${purchaseWhere.join(' AND ')}`,
    purchaseArgs
  )
  const purchasesTotal = round2(Number(purchaseRows[0]?.total || 0))
  const purchasesPaid = round2(Number(purchaseRows[0]?.paid || 0))
  const purchasesCount = Number(purchaseRows[0]?.count || 0)

  const salesCountArgs: any[] = []
  const salesCountRows = await db.select(`SELECT COUNT(*) count FROM sales s WHERE s.deleted_at IS NULL${buildRange('s.created_at', salesCountArgs)}`, salesCountArgs)
  const salesCount = Number(salesCountRows[0]?.count || 0)
  const returnsTotal = round2(returnRevenue)

  // Payment mix from actual sales in this period.
  const mixArgs: any[] = []
  const mixRows = await db.select(
    `SELECT COALESCE(sp.method, s.payment_method, 'OTHER') AS payment_method,
            COALESCE(SUM(CASE WHEN sp.id IS NULL THEN s.total ELSE sp.amount END),0) AS amount,
            COUNT(DISTINCT s.id) AS count
     FROM sales s
     LEFT JOIN sale_payments sp ON sp.sale_id = s.id
     WHERE s.deleted_at IS NULL${buildRange('s.created_at', mixArgs)}
     GROUP BY COALESCE(sp.method, s.payment_method, 'OTHER')`,
    mixArgs
  )
  const salePaymentMix = mixRows.map((r) => ({
    method: r.payment_method || 'OTHER',
    amount: round2(Number(r.amount || 0)),
    count: Number(r.count || 0),
  })).sort((a:any,b:any)=>b.amount-a.amount)

  // Only explicit positive operating profit gets a waste provision.
  const netProfitAfterWaste = round2(operatingProfitBeforeWaste - wasteProvision)
  const expenseBreakdown = Array.from(expensesByCategory.values())
    .map(v => ({ ...v, amount: round2(v.amount) }))
    .sort((a, b) => b.amount - a.amount)

  return {
    revenue,
    cogs,
    grossProfit,
    operatingExpenses,
    manualRevenue,
    manualExpense,
    manualCogs,
    journalAdjustment,
    operatingProfitBeforeWaste,
    wasteRate,
    wasteProvision,
    netProfitAfterWaste,
    marginPercent: revenue > 0 ? round2((netProfitAfterWaste / revenue) * 100) : 0,
    salesCount,
    returnsTotal,
    returnsCount: returnRows.length,
    expenseCount: expenseRows.length,
    purchaseCount: purchasesCount,
    purchasesTotal,
    purchasesPaid,
    purchasesOutstanding: round2(Math.max(0, purchasesTotal - purchasesPaid)),
    currentCash,
    inventoryValue,
    deadStockDays: defaultDeadDays,
    deadStockCount: deadStockProducts.length,
    deadStockValue,
    deadStockProducts,
    supplierPayables,
    expenseBreakdown,
    salePaymentMix,
    expensePaymentMix: Array.from(paymentMethods.entries()).map(([method, amount]) => ({ method, amount: round2(amount) })).sort((a,b)=>b.amount-a.amount),
    monthlyProfit,
    deepBreakdown: [
      { key: 'sales', label: 'صافي المبيعات', value: revenue, kind: 'income' },
      { key: 'cogs', label: 'تكلفة البضاعة المباعة', value: cogs, kind: 'cost' },
      { key: 'grossProfit', label: 'مجمل الربح', value: grossProfit, kind: 'profit' },
      { key: 'expenses', label: 'المصروفات التشغيلية', value: operatingExpenses, kind: 'cost' },
      { key: 'manualAdjustment', label: 'التسويات المحاسبية اليدوية', value: journalAdjustment, kind: 'adjustment' },
      { key: 'operatingProfit', label: 'الربح التشغيلي قبل الهالك', value: operatingProfitBeforeWaste, kind: 'profit' },
      { key: 'waste', label: `الهالك (${wasteRate}%)`, value: wasteProvision, kind: 'waste' },
      { key: 'netProfit', label: 'صافي الربح بعد الهالك', value: netProfitAfterWaste, kind: 'profit' },
    ],
  }
}

async function handleGeneralAccountsGet(db, path:string):Promise<any>{
  const {dateFrom,dateTo}=monthBounds(path)
  const accounts=await db.select(`SELECT * FROM general_accounts WHERE active != 'false' ORDER BY code`)
  const entryArgs:any[]=[]
  const entryRange:string[]=["e.status='POSTED'"]
  if(dateFrom){entryRange.push('e.entry_date >= ?');entryArgs.push(dateFrom)}
  if(dateTo){entryRange.push('e.entry_date <= ?');entryArgs.push(dateTo)}
  const entries=await db.select(`SELECT e.*, u.name user_name,
      COALESCE(SUM(l.debit),0) total_debit, COALESCE(SUM(l.credit),0) total_credit
    FROM general_journal_entries e LEFT JOIN users u ON u.id=e.user_id
    LEFT JOIN general_journal_lines l ON l.journal_entry_id=e.id
    WHERE ${entryRange.join(' AND ')} GROUP BY e.id ORDER BY e.entry_date DESC, e.created_at DESC LIMIT 500`,entryArgs)
  const balances=await db.select(`SELECT l.account_id, COALESCE(SUM(l.debit),0) debit, COALESCE(SUM(l.credit),0) credit
    FROM general_journal_lines l JOIN general_journal_entries e ON e.id=l.journal_entry_id WHERE e.status='POSTED' GROUP BY l.account_id`)
  const bm=new Map<string,any>()
  for(const b of balances) bm.set(b.account_id,b)
  const accountsOut=accounts.map((a)=>{
    const b=bm.get(a.id)||{debit:0,credit:0}
    const debitTypes=['ASSET','COGS','EXPENSE']
    const opening=Number(a.opening_balance||0)
    const balance=debitTypes.includes(a.account_type) ? opening+Number(b.debit)-Number(b.credit) : opening+Number(b.credit)-Number(b.debit)
    return {...rowToCamel(a), balance:round2(balance), debit:round2(Number(b.debit||0)), credit:round2(Number(b.credit||0))}
  })
  const entryIds=entries.map((e)=>e.id)
  const lines=entryIds.length ? await db.select(`SELECT l.*, a.code account_code, a.name_ar account_name_ar, a.name account_name FROM general_journal_lines l JOIN general_accounts a ON a.id=l.account_id WHERE l.journal_entry_id IN (${entryIds.map(()=>'?').join(',')}) ORDER BY l.journal_entry_id`,entryIds) : []
  const byEntry=new Map<string,any[]>()
  for(const l of lines){ if(!byEntry.has(l.journal_entry_id))byEntry.set(l.journal_entry_id,[]); byEntry.get(l.journal_entry_id)!.push(rowToCamel(l)) }
  const journalEntries=entries.map((e)=>({...rowToCamel(e), user:e.user_name?{name:e.user_name}:null, lines:byEntry.get(e.id)||[]}))
  const summary=await generalOperatingSummary(db,dateFrom,dateTo)
  // System accounts are views over the live POS state, not standalone ledgers.
  // Keep the journal debit/credit figures for audit, but expose the real operational
  // balance alongside them so the General Accounts screen cannot drift away from
  // sales, cash, inventory or supplier data.
  const liveByCode: Record<string, number> = {
    '1000': Number(summary.currentCash || 0),
    '1200': Number(summary.inventoryValue || 0),
    '2000': Number(summary.supplierPayables || 0),
    '4000': Number(summary.revenue || 0),
    '5000': Number(summary.cogs || 0),
    '6000': Number(summary.operatingExpenses || 0),
    '6100': Number(summary.wasteProvision || 0),
  }
  for (const a of accountsOut) {
    const live = liveByCode[a.code]
    if (a.isSystem === 'true' || a.isSystem === true) {
      a.balanceSource = live !== undefined ? 'OPERATIONS' : 'JOURNAL'
      a.operationalBalance = live !== undefined ? round2(live) : null
    }
  }
  return {accounts:accountsOut,journalEntries,summary}
}

async function handleGeneralAccountsPost(db:any,path:string,body:any):Promise<any>{
  const action=body?.action || (path.endsWith('/journal')?'journal':'account')
  if(action==='account'){
    await requirePermission(db,'accounts.post')
    const auth=await requireUser(db); if(auth.role!=='OWNER'&&auth.role!=='ADMIN'&&auth.permissions.includes('all')===false) throw new Error('إدارة دليل الحسابات متاحة للإدارة فقط')
    const parsed=getGeneralAccountSchema().safeParse(body); if(!parsed.success) throw new Error(zodError(parsed.error))
    const a=parsed.data; const id=generateUUID()
    await atomicExec(db,[`INSERT INTO general_accounts (id,code,name,name_ar,account_type,parent_id,opening_balance,active,is_system) VALUES ${sqlVals([id,a.code.trim(),a.name.trim(),a.nameAr.trim(),a.accountType,a.parentId||null,a.openingBalance||0,1,0])}`])
    return rowToCamel((await db.select('SELECT * FROM general_accounts WHERE id=?',[id]))[0])
  }
  if(action==='journal'){
    await requirePermission(db,'accounts.post'); const auth=await requireUser(db)
    const parsed=getJournalEntrySchema().safeParse(body); if(!parsed.success) throw new Error(zodError(parsed.error))
    const totalDebit=round2(parsed.data.lines.reduce((s,l)=>s+(l.debit||0),0))
    const totalCredit=round2(parsed.data.lines.reduce((s,l)=>s+(l.credit||0),0))
    if(totalDebit<=0 || totalCredit<=0 || Math.abs(totalDebit-totalCredit)>0.009) throw new Error('القيد غير متوازن — إجمالي المدين يجب أن يساوي إجمالي الدائن')
    const accountIds=parsed.data.lines.map(l=>l.accountId)
    const existing=await db.select(`SELECT id FROM general_accounts WHERE id IN (${accountIds.map(()=>'?').join(',')}) AND active!='false'`,accountIds)
    if(existing.length!==new Set(accountIds).size) throw new Error('يوجد حساب غير موجود أو غير نشط')
    const entryId=generateUUID(); const clientTxnId=parsed.data.clientTxnId||entryId
    const dupe=await db.select('SELECT id FROM general_journal_entries WHERE client_txn_id=?',[clientTxnId]); if(dupe[0]) return {id:dupe[0].id,idempotent:true}
    // entry_no must be UNIQUE (see db/sqlite-schema.sql). entryId is already a
    // fresh UUID, so deriving the suffix from it (instead of Math.random())
    // makes collisions impossible instead of merely unlikely.
    const now=new Date().toISOString(); const no=`J-${Date.now()}-${entryId.replace(/-/g,'').slice(0,8).toUpperCase()}`
    const stmts=[`INSERT INTO general_journal_entries (id,client_txn_id,entry_no,entry_date,description,reference_type,reference_id,user_id,status,entry_source,created_at,updated_at) VALUES (${sqlVals([entryId,clientTxnId,no,parsed.data.entryDate,parsed.data.description,parsed.data.referenceType||null,parsed.data.referenceId||null,auth.id,'POSTED','MANUAL',now,now])})`]
    for(const l of parsed.data.lines) stmts.push(`INSERT INTO general_journal_lines (id,journal_entry_id,account_id,debit,credit,note) VALUES (${sqlVals([generateUUID(),entryId,l.accountId,round2(l.debit||0),round2(l.credit||0),l.note||''])})`)
    stmts.push(`INSERT INTO audit_logs (id,user_id,action,entity,entity_id,after,created_at) VALUES (${sqlVals([generateUUID(),auth.id,'GENERAL_JOURNAL_POSTED','GeneralJournalEntry',entryId,JSON.stringify({entryNo:no,description:parsed.data.description,totalDebit,totalCredit}),now])})`)
    await atomicExec(db,stmts)
    return {id:entryId,entryNo:no,clientTxnId,totalDebit,totalCredit}
  }
  throw new Error('إجراء محاسبي غير مدعوم')
}

async function handleGeneralAccountsPut(db:any,entityId:string,body:any):Promise<any>{
  await requirePermission(db,'accounts.post')
  const pathAction=body?.action
  if(pathAction==='waste'){
    const auth=await requireUser(db)
    if(auth.role!=='OWNER'&&auth.role!=='ADMIN'&&!auth.permissions.includes('general.waste.manage')) throw new Error('تغيير نسبة الهالك متاح للإدارة فقط')
    const rate=Number(body.rate)
    if(!Number.isFinite(rate)||rate<0||rate>100) throw new Error('نسبة الهالك يجب أن تكون بين 0% و100%')
    await atomicExec(db,[`INSERT OR REPLACE INTO settings (key,value,category,updated_at) VALUES ${sqlVals(['general.wasteRate',String(round2(rate)),'general',new Date().toISOString()])}`])
    return {rate:round2(rate)}
  }
  const parsed=getGeneralAccountSchema().partial().safeParse(body); if(!parsed.success) throw new Error(zodError(parsed.error))
  if(!entityId) throw new Error('حساب غير محدد')
  const current=(await db.select('SELECT * FROM general_accounts WHERE id=?',[entityId]))[0]; if(!current) throw new Error('الحساب غير موجود')
  const a=parsed.data; const sets:string[]=[]; const vals:any[]=[]
  const map:any={code:'code',name:'name',nameAr:'name_ar',accountType:'account_type',parentId:'parent_id',openingBalance:'opening_balance'}
  for(const [k,col] of Object.entries(map)){ if((a as any)[k]!==undefined){sets.push(`${col}=?`);vals.push((a as any)[k])} }
  if(!sets.length) return rowToCamel(current)
  const updateSql = `UPDATE general_accounts SET ${sets.join(', ')} WHERE id=${sqlEsc(entityId)}`
  await atomicExec(db,[updateSql])
  return rowToCamel((await db.select('SELECT * FROM general_accounts WHERE id=?',[entityId]))[0])
}

// ============================================================
// REPORTS — GET /reports?type=...&dateFrom=...&dateTo=...&groupBy=...
// ============================================================
// FIX: this endpoint did not exist at all in the desktop build. Every
// /reports request fell through handleGet's generic table lookup,
// found no 'reports' table in SCHEMA, and silently returned `[]` —
// so every report screen in the desktop app showed "no data" no
// matter what, with no error.
// (the web version) field-for-field so the Reports UI — which reads
// data.summary / data.sales / data.products / etc. — renders exactly
// the same way in both web and desktop.
// ============================================================
async function handleReports(db, path: string): Promise<any> {
  const url = new URL(`http://x${path}`)
  const type = url.searchParams.get('type') || 'sales'
  const dateFrom = url.searchParams.get('dateFrom')
  const dateTo = url.searchParams.get('dateTo')
  const groupBy = url.searchParams.get('groupBy')

  // Shared date-range WHERE fragment. `col` is the column to filter on
  // (varies per report: sales.created_at, expenses.date, etc.)
  const dateClause = (col: string, args: any[]): string => {
    const parts: string[] = []
    if (dateFrom) { parts.push(`${col} >= ?`); args.push(dateFrom) }
    if (dateTo) { parts.push(`${col} <= ?`); args.push(dateTo) }
    return parts.length ? ' AND ' + parts.join(' AND ') : ''
  }

  switch (type) {
    case 'sales': {
      const args: unknown[] = []
      const sql = `SELECT s.*, c.name as customer_name, u.name as cashier_name
                   FROM sales s
                   LEFT JOIN customers c ON s.customer_id = c.id
                   LEFT JOIN users u ON s.user_id = u.id
                   WHERE s.deleted_at IS NULL AND s.status != 'REFUNDED'${dateClause('s.created_at', args)}
                   ORDER BY s.created_at DESC LIMIT 2000`
      const rows = await db.select(sql, args)
      const sales = rows.map((r) => ({
        ...rowToCamel(r),
        customer: r.customer_name ? { name: r.customer_name } : null,
        user: r.cashier_name ? { name: r.cashier_name } : null,
      }))
      // FIX: a PARTIAL_REFUND sale passes the `status != 'REFUNDED'` filter
      // above (correctly — it's still partly real revenue), but was then
      // summed at its full original subtotal/tax/total with nothing
      // subtracted for the part actually returned. Net out the refunded
      // amount (from sale_returns) for every partially-refunded sale before
      // aggregating — uses the same desktop report definitions.
      const partialIds = sales.filter((s) => s.status === 'PARTIAL_REFUND').map((s) => s.id)
      const refundedBySale = new Map<string, { total: number; tax: number; subtotal: number }>()
      if (partialIds.length > 0) {
        const placeholders = partialIds.map(() => '?').join(',')
        const returnRows = await db.select(
          `SELECT sale_id, total, tax_amount, subtotal FROM sale_returns WHERE sale_id IN (${placeholders})`,
          partialIds
        )
        for (const r of returnRows) {
          const acc = refundedBySale.get(r.sale_id) || { total: 0, tax: 0, subtotal: 0 }
          acc.total += r.total || 0
          acc.tax += r.tax_amount || 0
          acc.subtotal += (r.subtotal ?? ((r.total || 0) - (r.tax_amount || 0)))
          refundedBySale.set(r.sale_id, acc)
        }
      }
      const netOf = (s) => refundedBySale.get(s.id) || { total: 0, tax: 0, subtotal: 0 }
      const netTotal = (s) => Math.max(0, s.total - netOf(s).total)
      const netTax = (s) => Math.max(0, s.taxAmount - netOf(s).tax)
      const netSubtotal = (s) => Math.max(0, s.subtotal - netOf(s).subtotal)
      for (const sale of sales as any[]) {
        sale.netSubtotal = round2(netSubtotal(sale))
        sale.netTaxAmount = round2(netTax(sale))
        sale.netTotal = round2(netTotal(sale))
      }
      const summary = {
        count: sales.length,
        totalSubtotal: round2(sales.reduce((s, x) => s + netSubtotal(x), 0)),
        totalDiscount: round2(sales.reduce((s, x) => s + x.discountAmount, 0)),
        totalTax: round2(sales.reduce((s, x) => s + netTax(x), 0)),
        total: round2(sales.reduce((s, x) => s + netTotal(x), 0)),
        totalPaid: round2(sales.reduce((s, x) => s + x.paidAmount, 0)),
      }
      let grouped: any[] | null = null
      if (groupBy === 'day' || groupBy === 'month' || groupBy === 'week') {
        const map = new Map<string, { count: number; total: number }>()
        for (const s of sales) {
          const d = new Date(s.createdAt)
          let key: string
          if (groupBy === 'day') key = d.toISOString().slice(0, 10)
          else if (groupBy === 'month') key = d.toISOString().slice(0, 7)
          else key = `${d.toISOString().slice(0, 7)}-W${Math.floor(d.getDate() / 7) + 1}`
          if (!map.has(key)) map.set(key, { count: 0, total: 0 })
          const e = map.get(key)!
          e.count++
          e.total = round2(e.total + netTotal(s))
        }
        grouped = Array.from(map.entries()).map(([key, v]) => ({ key, ...v }))
      }
      return { summary, sales, grouped }
    }

    case 'profit': {
      const args: unknown[] = []
      const sql = `SELECT si.*, p.name as p_name, p.name_ar as p_name_ar, p.sku as p_sku
                   FROM sale_items si
                   JOIN sales s ON si.sale_id = s.id
                   LEFT JOIN products p ON si.product_id = p.id
                   WHERE s.deleted_at IS NULL AND s.status != 'REFUNDED'${dateClause('s.created_at', args)}`
      const rows = await db.select(sql, args)
      const saleItemIds = rows.map((r) => r.id)
      const returnedQty = new Map<string, number>()
      if (saleItemIds.length) {
        const placeholders = saleItemIds.map(() => '?').join(',')
        const rr = await db.select(
          `SELECT sri.sale_item_id, SUM(sri.quantity) AS qty
           FROM sale_return_items sri JOIN sale_returns sr ON sr.id = sri.sale_return_id
           WHERE sr.status = 'COMPLETED' AND sri.sale_item_id IN (${placeholders})
           GROUP BY sri.sale_item_id`, saleItemIds
        )
        for (const r of rr) returnedQty.set(r.sale_item_id, Number(r.qty || 0))
      }
      const items = rows.flatMap((r) => {
        const qty = Math.max(0, Number(r.quantity) - (returnedQty.get(r.id) || 0))
        if (qty <= 0) return []
        const ratio = Number(r.quantity) > 0 ? qty / Number(r.quantity) : 0
        return [{ ...rowToCamel(r), quantity: qty, total: Number(r.total) * ratio, taxAmount: Number(r.tax_amount || 0) * ratio, product: { id: r.product_id, name: r.p_name, nameAr: r.p_name_ar, sku: r.p_sku } }]
      })
      const revenue = round2(items.reduce((sum, it) => sum + (it.total - it.taxAmount), 0))
      const tax = round2(items.reduce((sum, it) => sum + it.taxAmount, 0))
      const cost = round2(items.reduce((sum, it) => sum + it.costAtSale * it.quantity, 0))
      const netProfit = round2(revenue - cost)
      const margin = revenue > 0 ? round2((netProfit / revenue) * 100) : 0
      let byProduct: any[] | null = null
      if (groupBy === 'product') {
        const map = new Map<string, any>()
        for (const it of items) {
          const p = it.product
          if (!p?.id) continue
          if (!map.has(p.id)) map.set(p.id, { name: p.name, nameAr: p.nameAr, sku: p.sku, units: 0, revenue: 0, tax: 0, cost: 0, profit: 0 })
          const e = map.get(p.id)!
          e.units += it.quantity
          e.revenue = round2(e.revenue + (it.total - it.taxAmount))
          e.tax = round2(e.tax + it.taxAmount)
          e.cost = round2(e.cost + it.costAtSale * it.quantity)
          e.profit = round2(e.revenue - e.cost)
        }
        byProduct = Array.from(map.values()).sort((a, b) => b.profit - a.profit)
      }
      return { summary: { revenue, tax, cost, netProfit, grossProfit: netProfit, marginPercent: margin, itemCount: items.length }, items, byProduct }
    }

    case 'inventory': {
      const rows = await db.select(
        `SELECT p.*, c.name as category_name FROM products p
         LEFT JOIN categories c ON p.category_id = c.id
         WHERE p.deleted_at IS NULL AND (p.track_stock = 1 OR p.track_stock = 'true')`
      )
      const products = rows.map((r) => {
        const stock = r.current_stock || 0
        const avgCost = r.avg_cost || 0
        const stockValue = round2(stock * avgCost)
        const potentialRevenue = round2(stock * (r.selling_price || 0))
        const status = stock <= 0 ? 'OUT_OF_STOCK' : stock <= r.reorder_level ? 'LOW_STOCK' : 'IN_STOCK'
        return {
          id: r.id, name: r.name, nameAr: r.name_ar, sku: r.sku,
          category: r.category_name ? { name: r.category_name } : null,
          stock, avgCost, stockValue, sellingPrice: r.selling_price,
          potentialRevenue, reorderLevel: r.reorder_level, status,
        }
      })
      const summary = {
        totalProducts: products.length,
        totalUnits: products.reduce((s, r) => s + r.stock, 0),
        totalStockValue: round2(products.reduce((s, r) => s + r.stockValue, 0)),
        totalPotentialRevenue: round2(products.reduce((s, r) => s + r.potentialRevenue, 0)),
        outOfStock: products.filter((r) => r.status === 'OUT_OF_STOCK').length,
        lowStock: products.filter((r) => r.status === 'LOW_STOCK').length,
      }
      return { summary, products }
    }

    case 'product': {
      const args: unknown[] = []
      const sql = `SELECT si.*, p.name as p_name, p.name_ar as p_name_ar, p.sku as p_sku
                   FROM sale_items si
                   JOIN sales s ON si.sale_id = s.id
                   LEFT JOIN products p ON si.product_id = p.id
                   WHERE s.deleted_at IS NULL AND s.status != 'REFUNDED'${dateClause('s.created_at', args)}`
      const rows = await db.select(sql, args)
      const saleItemIds = rows.map((r) => r.id)
      const returnedQty = new Map<string, number>()
      if (saleItemIds.length) {
        const placeholders = saleItemIds.map(() => '?').join(',')
        const rr = await db.select(
          `SELECT sri.sale_item_id, SUM(sri.quantity) AS qty
           FROM sale_return_items sri JOIN sale_returns sr ON sr.id = sri.sale_return_id
           WHERE sr.status = 'COMPLETED' AND sri.sale_item_id IN (${placeholders})
           GROUP BY sri.sale_item_id`, saleItemIds
        )
        for (const r of rr) returnedQty.set(r.sale_item_id, Number(r.qty || 0))
      }
      const map = new Map<string, any>()
      for (const r of rows) {
        if (!r.product_id) continue
        const qty = Math.max(0, Number(r.quantity) - (returnedQty.get(r.id) || 0))
        if (qty <= 0) continue
        const ratio = Number(r.quantity) > 0 ? qty / Number(r.quantity) : 0
        const revenue = (Number(r.total) - Number(r.tax_amount || 0)) * ratio
        const cost = Number(r.cost_at_sale) * qty
        if (!map.has(r.product_id)) map.set(r.product_id, { product: { id: r.product_id, name: r.p_name, nameAr: r.p_name_ar, sku: r.p_sku }, units: 0, revenue: 0, cost: 0, profit: 0 })
        const e = map.get(r.product_id)!
        e.units += qty
        e.revenue = round2(e.revenue + revenue)
        e.cost = round2(e.cost + cost)
        e.profit = round2(e.revenue - e.cost)
      }
      const products = Array.from(map.values()).sort((a, b) => b.revenue - a.revenue)
      return { summary: { productCount: products.length, totalUnits: products.reduce((sum, r) => sum + r.units, 0), totalRevenue: round2(products.reduce((sum, r) => sum + r.revenue, 0)), totalProfit: round2(products.reduce((sum, r) => sum + r.profit, 0)) }, products }
    }

    case 'customer':
    case 'customers': {
      const args: unknown[] = []
      const sql = `SELECT s.id, s.customer_id, s.total, c.name, c.phone, c.tier
                   FROM sales s JOIN customers c ON s.customer_id = c.id
                   WHERE s.deleted_at IS NULL AND s.status != 'REFUNDED' AND s.customer_id IS NOT NULL${dateClause('s.created_at', args)}`
      const rows = await db.select(sql, args)
      const saleIds = rows.map((r) => r.id)
      const refundedBySale = new Map<string, number>()
      if (saleIds.length) {
        const placeholders = saleIds.map(() => '?').join(',')
        const rr = await db.select(`SELECT sale_id, SUM(total) AS refunded FROM sale_returns WHERE status = 'COMPLETED' AND sale_id IN (${placeholders}) GROUP BY sale_id`, saleIds)
        for (const r of rr) refundedBySale.set(r.sale_id, Number(r.refunded || 0))
      }
      const map = new Map<string, any>()
      for (const r of rows) {
        if (!map.has(r.customer_id)) map.set(r.customer_id, { customer: { id: r.customer_id, name: r.name, phone: r.phone, tier: r.tier }, orders: 0, total: 0 })
        const e = map.get(r.customer_id)!
        e.orders++
        e.total = round2(e.total + Math.max(0, Number(r.total) - (refundedBySale.get(r.id) || 0)))
      }
      const customers = Array.from(map.values()).sort((a, b) => b.total - a.total)
      const totalOrders = customers.reduce((sum, r) => sum + r.orders, 0)
      const totalRevenue = round2(customers.reduce((sum, r) => sum + r.total, 0))
      return { summary: { customerCount: customers.length, totalOrders, totalRevenue, avgOrderValue: totalOrders > 0 ? round2(totalRevenue / totalOrders) : 0 }, customers }
    }

    case 'supplier':
    case 'suppliers': {
      const args: unknown[] = []
      const sql = `SELECT p.supplier_id, p.total, s.name, s.phone, s.balance, p.created_at
                   FROM purchases p JOIN suppliers s ON p.supplier_id = s.id
                   WHERE p.deleted_at IS NULL${dateClause('p.created_at', args)}`
      const rows = await db.select(sql, args)
      const paidRows = await db.select(`SELECT pp.supplier_id, COALESCE(SUM(pp.amount),0) paid FROM purchase_payments pp JOIN purchases p ON p.id=pp.purchase_id WHERE p.deleted_at IS NULL GROUP BY pp.supplier_id`)
      const paidMap = new Map(paidRows.map((r)=>[r.supplier_id, Number(r.paid||0)]))
      const map = new Map<string, any>()
      for (const r of rows) {
        if (!map.has(r.supplier_id)) {
          map.set(r.supplier_id, { supplier: { id: r.supplier_id, name: r.name, phone: r.phone, balance: r.balance }, purchases: 0, total: 0, paid: 0, balance: 0 })
        }
        const e = map.get(r.supplier_id)!
        e.purchases++
        e.total = round2(e.total + r.total)
        e.paid = round2(Number(paidMap.get(r.supplier_id) || 0))
        e.balance = round2(Math.max(0, Number(r.balance || 0)))
      }
      const suppliers = Array.from(map.values()).sort((a, b) => b.total - a.total)
      const summary = {
        supplierCount: suppliers.length,
        totalPurchases: round2(suppliers.reduce((s, r) => s + r.total, 0)),
        totalPaid: round2(suppliers.reduce((s, r) => s + r.paid, 0)),
        totalBalance: round2(suppliers.reduce((s, r) => s + r.balance, 0)),
      }
      return { summary, suppliers }
    }

    case 'cash': {
      const args: unknown[] = []
      const sql = `SELECT cs.*, u.name as user_name, u.username as user_username
                   FROM cash_sessions cs LEFT JOIN users u ON cs.user_id = u.id
                   WHERE 1=1${dateClause('cs.opened_at', args)}
                   ORDER BY cs.opened_at DESC LIMIT 200`
      const sessRows = await db.select(sql, args)
      const sessions: any[] = []
      for (const r of sessRows) {
        const movRows = await db.select('SELECT * FROM cash_movements WHERE session_id = ?', [r.id])
        const totalIn = round2(movRows.filter((m) => ['CASH_IN', 'SALE'].includes(m.type)).reduce((s, m) => s + Math.abs(Number(m.amount) || 0), 0))
        const totalOut = round2(movRows.filter((m) => ['CASH_OUT', 'REFUND', 'EXPENSE'].includes(m.type)).reduce((s, m) => s + Math.abs(m.amount), 0))
        sessions.push({
          id: r.id,
          user: r.user_name ? { name: r.user_name, username: r.user_username } : null,
          openingBalance: r.opening_balance, closingBalance: r.closing_balance,
          expectedCash: r.expected_cash, difference: r.difference, status: r.status,
          openedAt: r.opened_at, closedAt: r.closed_at,
          movementCount: movRows.length, totalIn, totalOut,
        })
      }
      const summary = {
        sessionCount: sessions.length,
        totalOpening: round2(sessions.reduce((s, r) => s + r.openingBalance, 0)),
        totalClosing: round2(sessions.reduce((s, r) => s + (r.closingBalance || 0), 0)),
        totalDifference: round2(sessions.reduce((s, r) => s + (r.difference || 0), 0)),
      }
      return { summary, sessions }
    }

    case 'expense': {
      const args: unknown[] = []
      const sql = `SELECT e.*, ec.name as category_name, ec.name_ar as category_name_ar, u.name as user_name
                   FROM expenses e
                   LEFT JOIN expense_categories ec ON e.category_id = ec.id
                   LEFT JOIN users u ON e.user_id = u.id
                   WHERE 1=1${dateClause('e.date', args)}
                   ORDER BY e.date DESC LIMIT 2000`
      const rows = await db.select(sql, args)
      const expenses = rows.map((r) => ({
        ...rowToCamel(r),
        category: { id: r.category_id, name: r.category_name, nameAr: r.category_name_ar },
        user: r.user_name ? { name: r.user_name } : null,
      }))
      let byCategory: any[] | null = null
      if (groupBy === 'category') {
        const map = new Map<string, any>()
        for (const e of expenses) {
          const key = e.categoryId || 'none'
          if (!map.has(key)) map.set(key, { name: e.category?.nameAr || e.category?.name || 'غير مصنف', total: 0, count: 0 })
          const en = map.get(key)!
          en.total = round2(en.total + e.amount)
          en.count++
        }
        byCategory = Array.from(map.values()).sort((a, b) => b.total - a.total)
      }
      const byMethod: Record<string, number> = {}
      for (const e of expenses) byMethod[e.paymentMethod] = round2((byMethod[e.paymentMethod] || 0) + e.amount)
      const summary = { count: expenses.length, total: round2(expenses.reduce((s, e) => s + e.amount, 0)), byMethod }
      return { summary, expenses, byCategory }
    }

    case 'loyalty': {
      const rows = await db.select(
        `SELECT la.*, c.name, c.phone, c.tier as customer_tier FROM loyalty_accounts la
         JOIN customers c ON la.customer_id = c.id
         WHERE la.deleted_at IS NULL AND c.deleted_at IS NULL ORDER BY la.points DESC`
      )
      const accounts = rows.map((r) => ({
        customer: { id: r.customer_id, name: r.name, phone: r.phone, tier: r.customer_tier },
        points: r.points, totalEarned: r.total_earned, totalRedeemed: r.total_redeemed, tier: r.tier,
      }))
      const byTier: Record<string, number> = {}
      for (const a of accounts) byTier[a.tier] = (byTier[a.tier] || 0) + 1
      const summary = {
        accountCount: accounts.length,
        totalPoints: accounts.reduce((s, r) => s + r.points, 0),
        totalEarned: accounts.reduce((s, r) => s + r.totalEarned, 0),
        totalRedeemed: accounts.reduce((s, r) => s + r.totalRedeemed, 0),
        byTier,
      }
      return { summary, accounts }
    }

    case 'tax': {
      const args: unknown[] = []
      const sql = `SELECT * FROM sales WHERE deleted_at IS NULL AND status != 'REFUNDED'${dateClause('created_at', args)}`
      const rows = await db.select(sql, args)
      const sales = rows.map((r) => rowToCamel(r))
      const saleIds = sales.map((s) => s.id)
      let itemLevelTax = 0
      let returnedTax = 0
      if (saleIds.length) {
        const placeholders = saleIds.map(() => '?').join(',')
        const taxRows = await db.select(`SELECT COALESCE(SUM(tax_amount),0) as total FROM sale_items WHERE sale_id IN (${placeholders})`, saleIds)
        itemLevelTax = Number(taxRows[0]?.total || 0)
        const rr = await db.select(
          `SELECT sri.sale_item_id, SUM(sri.quantity) AS qty, si.quantity AS original_qty, si.tax_amount
           FROM sale_return_items sri JOIN sale_returns sr ON sr.id = sri.sale_return_id
           JOIN sale_items si ON si.id = sri.sale_item_id
           WHERE sr.status = 'COMPLETED' AND si.sale_id IN (${placeholders})
           GROUP BY sri.sale_item_id, si.quantity, si.tax_amount`, saleIds
        )
        for (const r of rr) returnedTax += Number(r.tax_amount || 0) / Number(r.original_qty || 1) * Number(r.qty || 0)
      }
      const saleReturnRows = saleIds.length ? await db.select(`SELECT sale_id, SUM(subtotal) AS subtotal, SUM(tax_amount) AS tax, SUM(total) AS total FROM sale_returns WHERE status = 'COMPLETED' AND sale_id IN (${saleIds.map(() => '?').join(',')}) GROUP BY sale_id`, saleIds) : []
      const refunded = new Map<string, any>()
      for (const r of saleReturnRows) refunded.set(r.sale_id, r)
      for (const sale of sales as any[]) {
        sale.netSubtotal = round2(Math.max(0, sale.subtotal - Number(refunded.get(sale.id)?.subtotal || 0)))
        sale.netTaxAmount = round2(Math.max(0, sale.taxAmount - Number(refunded.get(sale.id)?.tax || 0)))
        sale.netTotal = round2(Math.max(0, sale.total - Number(refunded.get(sale.id)?.total || 0)))
      }
      const summary = {
        count: sales.length,
        totalSubtotal: round2(sales.reduce((sum, x) => sum + Math.max(0, x.subtotal - Number(refunded.get(x.id)?.subtotal || 0)), 0)),
        totalTax: round2(sales.reduce((sum, x) => sum + Math.max(0, x.taxAmount - Number(refunded.get(x.id)?.tax || 0)), 0)),
        total: round2(sales.reduce((sum, x) => sum + Math.max(0, x.total - Number(refunded.get(x.id)?.total || 0)), 0)),
        itemLevelTax: round2(itemLevelTax - returnedTax),
      }
      return { summary, sales }
    }

    case 'returns': {
      const args: unknown[] = []
      const sql = `SELECT sr.*, s.invoice_number as sale_invoice, s.status as sale_status,
                       s.total as sale_total,
                       c.name as customer_name, c.phone as customer_phone,
                       u.name as user_name
                   FROM sale_returns sr
                   JOIN sales s ON sr.sale_id = s.id
                   LEFT JOIN customers c ON s.customer_id = c.id
                   LEFT JOIN users u ON sr.user_id = u.id
                   WHERE sr.status = 'COMPLETED'${dateClause('sr.created_at', args)}
                   ORDER BY sr.created_at DESC LIMIT 2000`
      const rows = await db.select(sql, args)
      const returnIds = rows.length > 0 ? rows.map((r) => r.id) : []

      // Fetch return items for all returns
      const returnItemsMap = new Map<string, any[]>()
      if (returnIds.length > 0) {
        const placeholders = returnIds.map(() => '?').join(',')
        const itemRows = await db.select(
          `SELECT sri.*, p.name as p_name, p.name_ar as p_name_ar, p.sku as p_sku
           FROM sale_return_items sri
           LEFT JOIN products p ON sri.product_id = p.id
           WHERE sri.sale_return_id IN (${placeholders})`,
          returnIds
        )
        for (const ir of itemRows) {
          const list = returnItemsMap.get(ir.sale_return_id) || []
          list.push({
            id: ir.id, productId: ir.product_id, saleItemId: ir.sale_item_id,
            quantity: ir.quantity, unitPrice: ir.unit_price, total: ir.total,
            product: ir.p_name ? { id: ir.product_id, name: ir.p_name, nameAr: ir.p_name_ar, sku: ir.p_sku } : null,
          })
          returnItemsMap.set(ir.sale_return_id, list)
        }
      }

      const returns = rows.map((r) => ({
        ...rowToCamel(r),
        sale: {
          id: r.sale_id, invoiceNumber: r.sale_invoice, status: r.sale_status, total: r.sale_total,
          customer: r.customer_name ? { name: r.customer_name, phone: r.customer_phone } : null,
        },
        user: r.user_name ? { id: r.user_id, name: r.user_name } : null,
        items: returnItemsMap.get(r.id) || [],
      }))

      const summary = {
        count: returns.length,
        fullRefunds: returns.filter((r) => r.sale?.status === 'REFUNDED').length,
        partialRefunds: returns.filter((r) => r.sale?.status === 'PARTIAL_REFUND').length,
        totalRefunded: round2(returns.reduce((s, r) => s + (r.total || 0), 0)),
        totalTaxRefunded: round2(returns.reduce((s, r) => s + (r.taxAmount || 0), 0)),
        avgRefundAmount: returns.length > 0 ? round2(returns.reduce((s, r) => s + (r.total || 0), 0) / returns.length) : 0,
        topReasons: (() => {
          const m = new Map<string, number>()
          for (const r of returns) {
            if (r.reason) m.set(r.reason, (m.get(r.reason) || 0) + 1)
          }
          return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([reason, count]) => ({ reason, count }))
        })(),
      }

      // Top returned products
      const prodMap = new Map<string, { product: any; quantity: number; totalRefunded: number }>()
      for (const r of returns) {
        for (const item of (r.items || [])) {
          const key = item.productId
          if (!prodMap.has(key)) prodMap.set(key, { product: item.product, quantity: 0, totalRefunded: 0 })
          const e = prodMap.get(key)!
          e.quantity += item.quantity
          e.totalRefunded = round2(e.totalRefunded + (item.total || 0))
        }
      }
      const topReturnedProducts = Array.from(prodMap.values()).sort((a, b) => b.totalRefunded - a.totalRefunded).slice(0, 10)

      return { summary, returns, topReturnedProducts }
    }

    default:
      throw new Error(`نوع التقرير غير معروف: ${type}`)
  }
}



/** Single source of truth for dead-stock classification across Desktop. */
async function getDeadStockSnapshot(db): Promise<any> {
  const cfgRows = await db.select("SELECT value FROM settings WHERE key='inventory.deadStockDays' LIMIT 1")
  const defaultDays = normalizeDeadStockDays(cfgRows[0]?.value, 60)
  const rows = await db.select(`
    SELECT p.id, COALESCE(p.name_ar,p.name) AS name,
           p.created_at AS product_created_at,
           p.current_stock AS stock, p.avg_cost AS avg_cost,
           p.dead_stock_days_override AS product_override_days,
           c.id AS category_id, c.name AS category_name, c.name_ar AS category_name_ar,
           c.dead_stock_days_override AS category_override_days,
           pc.id AS subcategory_id, pc.name AS subcategory_name, pc.name_ar AS subcategory_name_ar,
           pc.dead_stock_days_override AS subcategory_override_days,
           (SELECT MAX(s.created_at)
              FROM sale_items si
              JOIN sales s ON s.id=si.sale_id
              LEFT JOIN (
                SELECT sri.sale_item_id, SUM(sri.quantity) AS returned_qty
                FROM sale_return_items sri
                JOIN sale_returns sr ON sr.id=sri.sale_return_id
                WHERE sr.status='COMPLETED'
                GROUP BY sri.sale_item_id
              ) rr ON rr.sale_item_id=si.id
             WHERE si.product_id=p.id
               AND s.deleted_at IS NULL
               AND s.status!='REFUNDED'
               AND MAX(0,COALESCE(si.quantity,0)-COALESCE(rr.returned_qty,0))>0
           ) AS last_net_sale_at,
           (SELECT MAX(sm.created_at)
              FROM stock_movements sm
             WHERE sm.product_id=p.id
               AND sm.quantity > 0
               AND sm.type IN ('PURCHASE','RETURN','ADJUSTMENT','TRANSFER_IN','OPENING_STOCK')
               AND sm.deleted_at IS NULL
           ) AS last_stock_in_at
      FROM products p
      LEFT JOIN categories c ON c.id=p.category_id AND c.deleted_at IS NULL
      LEFT JOIN categories pc ON pc.id=c.parent_id AND pc.deleted_at IS NULL
     WHERE p.deleted_at IS NULL
       AND (p.active=1 OR p.active='true')
       AND (p.track_stock=1 OR p.track_stock='true')
       AND COALESCE(p.current_stock,0)>0`)
  const now = Date.now()
  const products = rows.map((r) => {
    const policy = resolveDeadStockDays(r.product_override_days, r.subcategory_override_days, r.category_override_days, defaultDays)
    const saleTs = r.last_net_sale_at ? new Date(String(r.last_net_sale_at)).getTime() : 0
    const stockInTs = r.last_stock_in_at ? new Date(String(r.last_stock_in_at)).getTime() : 0
    const createdTs = r.product_created_at ? new Date(String(r.product_created_at)).getTime() : 0
    const candidates = [saleTs, stockInTs, createdTs].filter((v: number) => Number.isFinite(v) && v > 0)
    const lastActivityTs = candidates.length ? Math.max(...candidates) : 0
    const lastActivityAt = lastActivityTs ? new Date(lastActivityTs).toISOString() : null
    const ageDays = lastActivityTs ? Math.max(0, Math.floor((now - lastActivityTs) / 86400000)) : null
    const stock = Math.max(0, Number(r.stock || 0))
    const avgCost = Math.max(0, Number(r.avg_cost || 0))
    const value = round2(stock * avgCost)
    const dead = isDeadStock(lastActivityAt, now, policy.days)
    const activitySource = saleTs >= stockInTs && saleTs >= createdTs ? 'sale' : stockInTs >= createdTs ? 'stock_in' : 'created'
    return {
      id: r.id, name: r.name, nameAr: r.name, stock,
      avgCost: round2(avgCost), value, deadStockDays: policy.days,
      lastSaleAt: r.last_net_sale_at || null,
      lastActivityAt,
      ageDays,
      categoryId: r.category_id || null,
      categoryName: r.category_name_ar || r.category_name || null,
      subcategoryId: r.subcategory_id || null,
      subcategoryName: r.subcategory_name_ar || r.subcategory_name || null,
      deadStockSource: policy.source,
      activitySource,
      isDead: dead,
    }
  }).filter((p) => p.isDead).sort((a, b: any) => b.value - a.value)
  const totalValue = round2(products.reduce((sum, p) => sum + p.value, 0))
  const oldestProducts = [...products].sort((a, b: any) => Number(b.ageDays || 0) - Number(a.ageDays || 0) || Number(b.value || 0) - Number(a.value || 0))
  return {
    defaultDays,
    products,
    topProducts: products.slice(0, 20),
    oldestProducts: oldestProducts.slice(0, 20),
    count: products.length,
    value: totalValue,
  }
}

async function handleDashboard(db): Promise<any> {
  const [todaySales, products, customers, lowStock, outOfStock, pendingSync] = await Promise.all([
    // Net sales: subtract every COMPLETED return attached to each sale.
    // A partial return therefore reduces dashboard sales instead of leaving gross totals.
    db.select(`SELECT COUNT(*) as count, COALESCE(SUM(
      CASE WHEN status = 'REFUNDED' THEN 0
           ELSE MAX(0, total - COALESCE((SELECT SUM(sr.total) FROM sale_returns sr WHERE sr.sale_id = sales.id AND sr.status = 'COMPLETED'), 0))
      END
    ), 0) as total
    FROM sales
    WHERE date(created_at, 'localtime') = date('now', 'localtime') AND deleted_at IS NULL`),
    // Same active-column fix as handleInventory() below — 'active = 1' alone
    // excluded products added after the initial seed from every dashboard count.
    db.select("SELECT COUNT(*) as count FROM products WHERE (active = 1 OR active = 'true') AND deleted_at IS NULL"),
    db.select("SELECT COUNT(*) as count FROM customers WHERE (active = 1 OR active = 'true') AND deleted_at IS NULL"),
    db.select("SELECT COUNT(*) as count FROM products WHERE current_stock <= reorder_level AND current_stock > 0 AND (active = 1 OR active = 'true') AND deleted_at IS NULL"),
    db.select("SELECT COUNT(*) as count FROM products WHERE current_stock <= 0 AND (active = 1 OR active = 'true') AND deleted_at IS NULL"),
    // sync_queue has no deleted_at column.
    db.select("SELECT COUNT(*) as count FROM sync_queue WHERE status = 'PENDING'"),
  ])
  const inventoryValue = await db.select("SELECT COALESCE(SUM(current_stock * avg_cost), 0) as value FROM products WHERE (active = 1 OR active = 'true') AND deleted_at IS NULL")

  // ─── PROFIT (today) — revenue minus cost, excluding tax (tax isn't profit) ───
  const todayProfitRows = await db.select(
    `SELECT COALESCE(SUM(
       CASE WHEN COALESCE(s.subtotal,0) > 0
            THEN MAX(0, (s.total - s.tax_amount) / s.subtotal) * MAX(0, si.total - si.tax_amount)
            ELSE 0 END
       - MAX(0, si.cost_at_sale) * MAX(0, si.quantity - COALESCE((SELECT SUM(sri.quantity)
           FROM sale_return_items sri
           JOIN sale_returns sr ON sr.id = sri.sale_return_id
           WHERE sri.sale_item_id = si.id AND sr.status = 'COMPLETED'), 0))
     ), 0) as profit
     FROM sale_items si JOIN sales s ON si.sale_id = s.id
     WHERE date(s.created_at, 'localtime') = date('now', 'localtime') AND s.deleted_at IS NULL`
  )
  const todayProfit = round2(todayProfitRows[0]?.profit || 0)
  const todaySalesTotal = todaySales[0]?.total || 0
  const profitMargin = todaySalesTotal > 0 ? round2((todayProfit / todaySalesTotal) * 100) : 0

  // ─── WEEK / MONTH TOTALS + WEEK-OVER-WEEK GROWTH ───
  const [weekRows, prevWeekRows, monthRows, newCustomersRows] = await Promise.all([
    db.select(`SELECT COALESCE(SUM(CASE WHEN status = 'REFUNDED' THEN 0 ELSE MAX(0, total - COALESCE((SELECT SUM(sr.total) FROM sale_returns sr WHERE sr.sale_id = sales.id AND sr.status = 'COMPLETED'), 0)) END), 0) as total
      FROM sales WHERE date(created_at, 'localtime') >= date('now', 'localtime', '-6 days') AND deleted_at IS NULL`),
    db.select(`SELECT COALESCE(SUM(CASE WHEN status = 'REFUNDED' THEN 0 ELSE MAX(0, total - COALESCE((SELECT SUM(sr.total) FROM sale_returns sr WHERE sr.sale_id = sales.id AND sr.status = 'COMPLETED'), 0)) END), 0) as total
      FROM sales WHERE date(created_at, 'localtime') >= date('now', 'localtime', '-13 days') AND date(created_at, 'localtime') < date('now', 'localtime', '-6 days') AND deleted_at IS NULL`),
    db.select(`SELECT COALESCE(SUM(CASE WHEN status = 'REFUNDED' THEN 0 ELSE MAX(0, total - COALESCE((SELECT SUM(sr.total) FROM sale_returns sr WHERE sr.sale_id = sales.id AND sr.status = 'COMPLETED'), 0)) END), 0) as total
      FROM sales WHERE date(created_at, 'localtime') >= date('now', 'localtime', '-29 days') AND deleted_at IS NULL`),
    db.select("SELECT COUNT(*) as count FROM customers WHERE date(created_at, 'localtime') >= date('now', 'localtime', '-29 days') AND deleted_at IS NULL"),
  ])
  const weekSales = weekRows[0]?.total || 0
  const prevWeekSales = prevWeekRows[0]?.total || 0
  const weekGrowth = prevWeekSales > 0 ? round2(((weekSales - prevWeekSales) / prevWeekSales) * 100) : (weekSales > 0 ? 100 : 0)
  const monthSales = monthRows[0]?.total || 0
  const newCustomersThisMonth = newCustomersRows[0]?.count || 0

  // ─── LAST 7 DAYS: sales + profit, one point per day (zero-filled) ───
  const [dailySalesRows, dailyProfitRows] = await Promise.all([
    db.select(
      `SELECT date(created_at, 'localtime') as day, COALESCE(SUM(
         CASE WHEN status = 'REFUNDED' THEN 0
              ELSE MAX(0, total - COALESCE((SELECT SUM(sr.total) FROM sale_returns sr WHERE sr.sale_id = sales.id AND sr.status = 'COMPLETED'), 0))
         END), 0) as sales
       FROM sales WHERE date(created_at, 'localtime') >= date('now', 'localtime', '-6 days') AND deleted_at IS NULL
       GROUP BY date(created_at)`
    ),
    db.select(
      `SELECT date(s.created_at, 'localtime') as day, COALESCE(SUM((si.unit_price - si.cost_at_sale) *
         MAX(0, si.quantity - COALESCE((SELECT SUM(sri.quantity) FROM sale_return_items sri JOIN sale_returns sr ON sr.id = sri.sale_return_id WHERE sri.sale_item_id = si.id AND sr.status = 'COMPLETED'), 0))
       ), 0) as profit
       FROM sale_items si JOIN sales s ON si.sale_id = s.id
       WHERE date(s.created_at, 'localtime') >= date('now', 'localtime', '-6 days') AND s.deleted_at IS NULL
       GROUP BY date(s.created_at)`
    ),
  ])
  const salesByDayMap: Record<string, number> = {}
  for (const r of dailySalesRows) salesByDayMap[r.day] = r.sales
  const profitByDayMap: Record<string, number> = {}
  for (const r of dailyProfitRows) profitByDayMap[r.day] = r.profit
  const WEEKDAY_AR = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
  const salesByDay: any[] = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() - i)
    const key = [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0'),
    ].join('-')
    salesByDay.push({
      day: WEEKDAY_AR[d.getDay()],
      sales: round2(salesByDayMap[key] || 0),
      profit: round2(profitByDayMap[key] || 0),
    })
  }

  // ─── SALES BY CATEGORY (last 30 days) ───
  const categoryRows = await db.select(
    `SELECT COALESCE(c.name_ar, c.name, 'أخرى') as name, COALESCE(SUM(si.total), 0) as value
     FROM sale_items si
     JOIN sales s ON si.sale_id = s.id
     JOIN products p ON si.product_id = p.id
     LEFT JOIN categories c ON p.category_id = c.id
     WHERE date(s.created_at, 'localtime') >= date('now', 'localtime', '-29 days') AND s.deleted_at IS NULL AND s.status != 'REFUNDED'
     GROUP BY c.id ORDER BY value DESC LIMIT 8`
  )
  const salesByCategory = categoryRows.map((r) => ({ name: r.name, value: round2(r.value) }))

  // ─── SALES BY PAYMENT METHOD (last 30 days) ───
  const PAYMENT_LABELS: Record<string, string> = { CASH: 'نقدي', CARD: 'بطاقة', TRANSFER: 'تحويل بنكي', WALLET: 'محفظة إلكترونية' }
  const paymentRows = await db.select(
    `SELECT payment_method as method, COALESCE(SUM(total), 0) as value, COUNT(*) as count
     FROM sales WHERE date(created_at, 'localtime') >= date('now', 'localtime', '-29 days') AND deleted_at IS NULL AND status != 'REFUNDED'
     GROUP BY payment_method`
  )
  const salesByPaymentMethod = paymentRows.map((r) => ({
    name: PAYMENT_LABELS[r.method] || r.method, method: r.method, value: round2(r.value), count: r.count,
  }))

  // ─── TOP PRODUCTS (last 30 days) ───
  const topProductRows = await db.select(
    `SELECT COALESCE(p.name_ar, p.name) as name, COALESCE(SUM(si.total), 0) as revenue, COALESCE(SUM(si.quantity), 0) as quantity
     FROM sale_items si JOIN sales s ON si.sale_id = s.id JOIN products p ON si.product_id = p.id
     WHERE date(s.created_at, 'localtime') >= date('now', 'localtime', '-29 days') AND s.deleted_at IS NULL AND s.status != 'REFUNDED'
     GROUP BY p.id ORDER BY revenue DESC LIMIT 5`
  )
  const topProducts = topProductRows.map((r) => ({ name: r.name, nameAr: r.name, revenue: round2(r.revenue), quantity: r.quantity }))

  // ─── RETURNS METRICS (today + week + month) ───
  const [todayReturnsRows, weekReturnsRows, monthReturnsRows] = await Promise.all([
    db.select("SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as total FROM sale_returns WHERE date(created_at, 'localtime') = date('now', 'localtime') AND status = 'COMPLETED'"),
    db.select("SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as total FROM sale_returns WHERE date(created_at, 'localtime') >= date('now', 'localtime', '-6 days') AND status = 'COMPLETED'"),
    db.select("SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as total FROM sale_returns WHERE date(created_at, 'localtime') >= date('now', 'localtime', '-29 days') AND status = 'COMPLETED'"),
  ])
  const todayReturnsTotal = round2(todayReturnsRows[0]?.total || 0)
  const todayReturnsCount = todayReturnsRows[0]?.count || 0
  const _weekReturnsTotal = round2(weekReturnsRows[0]?.total || 0)
  const monthReturnsTotal = round2(monthReturnsRows[0]?.total || 0)
  const todayGrossSalesRows = await db.select(
    "SELECT COALESCE(SUM(total), 0) as total FROM sales WHERE date(created_at, 'localtime') = date('now', 'localtime') AND deleted_at IS NULL"
  )
  const todayGrossSalesTotal = Number(todayGrossSalesRows[0]?.total || 0)
  const returnRate = todayGrossSalesTotal > 0 ? round2((todayReturnsTotal / todayGrossSalesTotal) * 100) : 0
  const monthGrossSalesRows = await db.select(
    "SELECT COALESCE(SUM(total), 0) as total FROM sales WHERE date(created_at, 'localtime') >= date('now', 'localtime', '-29 days') AND deleted_at IS NULL"
  )
  const monthGrossSalesTotal = Number(monthGrossSalesRows[0]?.total || 0)
  const monthReturnRate = monthGrossSalesTotal > 0 ? round2((monthReturnsTotal / monthGrossSalesTotal) * 100) : 0

  // ─── LEAST USED PRODUCTS (last 30 days) ───
  const leastUsedRows = await db.select(
    `SELECT COALESCE(p.name_ar, p.name) as name, COALESCE(SUM(si.total), 0) as revenue, COALESCE(SUM(si.quantity), 0) as quantity
     FROM sale_items si JOIN sales s ON si.sale_id = s.id JOIN products p ON si.product_id = p.id
     WHERE date(s.created_at, 'localtime') >= date('now', 'localtime', '-29 days') AND s.deleted_at IS NULL AND s.status != 'REFUNDED'
     GROUP BY p.id HAVING revenue > 0 ORDER BY revenue ASC LIMIT 5`
  )
  const leastUsedProducts = leastUsedRows.map((r) => ({ name: r.name, nameAr: r.name, revenue: round2(r.revenue), quantity: r.quantity }))

  // ─── DEAD STOCK — canonical rule shared across modules ───
  const deadSnapshot = await getDeadStockSnapshot(db)
  const oldestInventory = deadSnapshot.oldestProducts || deadSnapshot.topProducts
  const deadStockCount = deadSnapshot.count
  const deadStockValue = deadSnapshot.value
  const defaultDeadDays = deadSnapshot.defaultDays

  // ─── SMART INSIGHTS (enhanced) ───
  const insights: any[] = []
  if (weekGrowth > 5) {
    insights.push({ type: 'positive', message: `المبيعات ارتفعت ${weekGrowth}% مقارنة بالأسبوع الماضي` })
  } else if (weekGrowth < -5) {
    insights.push({ type: 'negative', message: `المبيعات انخفضت ${Math.abs(weekGrowth)}% مقارنة بالأسبوع الماضي` })
  }
  if ((outOfStock[0]?.count || 0) > 0) {
    insights.push({ type: 'warning', message: `${outOfStock[0].count} منتج نفد من المخزون تمامًا — يحتاج إعادة طلب` })
  }
  if ((lowStock[0]?.count || 0) > 0) {
    insights.push({ type: 'warning', message: `${lowStock[0].count} منتج على وشك النفاذ من المخزون` })
  }
  if (topProducts[0]) {
    insights.push({ type: 'info', message: `الأكثر مبيعًا هذا الشهر: ${topProducts[0].name} (${round2(topProducts[0].revenue)} ج.م)` })
  }
  // Least used product insight
  if (leastUsedProducts.length > 0 && leastUsedProducts[0].quantity > 0) {
    insights.push({ type: 'info', message: `أقل منتج مبيعًا: ${leastUsedProducts[0].name} (${leastUsedProducts[0].quantity} وحدة فقط)` })
  }
  // Oldest inventory insight
  if (oldestInventory.length > 0) {
    insights.push({ type: 'warning', message: `قيمة المخزون الراكد: ${round2(deadStockValue)} ج.م (${deadStockCount} منتج تجاوز مدة الركود المحددة)` })
  }
  // Returns insights
  if (todayReturnsCount > 0) {
    insights.push({ type: 'warning', message: `${todayReturnsCount} مرتجع اليوم بقيمة ${todayReturnsTotal} ج.م` })
  }
  if (monthReturnsTotal > 0) {
    insights.push({ type: 'info', message: `إجمالي المرتجعات هذا الشهر: ${monthReturnsTotal} ج.م (${monthReturnRate}% نسبة الإرجاع)` })
  }
  if (returnRate > 10) {
    insights.push({ type: 'negative', message: `نسبة الإرجاع مرتفعة: ${returnRate}% — يجب مراجعة جودة المنتجات` })
  }
  // Profit margin insight
  if (profitMargin > 30) {
    insights.push({ type: 'positive', message: `هامش الربح ممتاز: ${profitMargin}%` })
  } else if (profitMargin > 0 && profitMargin < 20) {
    insights.push({ type: 'warning', message: `هامش الربح منخفض: ${profitMargin}% — رااجع الأسعار والتكاليف` })
  }
  // New customers insight
  if (newCustomersThisMonth > 0) {
    insights.push({ type: 'positive', message: `${newCustomersThisMonth} عميل جديد هذا الشهر` })
  }
  insights.push({ type: 'info', message: `قيمة المخزون: ${round2(inventoryValue[0]?.value || 0)} ج.م` })

  return {
    todaySales: todaySalesTotal,
    todayCount: todaySales[0]?.count || 0,
    todayProfit,
    profitMargin,
    avgOrderValue: todaySales[0]?.count > 0 ? round2(todaySalesTotal / todaySales[0].count) : 0,
    weekSales: round2(weekSales),
    weekGrowth,
    monthSales: round2(monthSales),
    totalProducts: products[0]?.count || 0,
    totalCustomers: customers[0]?.count || 0,
    newCustomersThisMonth,
    lowStockCount: lowStock[0]?.count || 0,
    outOfStockCount: outOfStock[0]?.count || 0,
    inventoryValue: round2(inventoryValue[0]?.value || 0),
    pendingSync: pendingSync[0]?.count || 0,
    topProducts,
    salesByDay,
    salesByCategory,
    salesByPaymentMethod,
    insights,
    todayReturns: todayReturnsTotal,
    todayReturnsCount,
    monthReturns: monthReturnsTotal,
    returnRate,
    leastUsedProducts,
    oldestInventory,
    deadStockCount,
    deadStockValue,
    deadStockDays: defaultDeadDays,
  }
}

async function handleInventory(db, path: string): Promise<any> {
  // products is soft-deletable — filter deleted_at IS NULL alongside active.
  // FIX: this used to filter `p.active = 1` only. The `active` column is
  // declared TEXT DEFAULT 'true' in the schema, and products created from
  // the Products screen send a JS boolean which SQLite's TEXT affinity can
  // end up storing as the string '1' or 'true' depending on the binding
  // path — never a bare INTEGER 1. So `active = 1` silently matched only
  // older rows (inserted with a literal 1) and excluded every
  // product added afterwards from the Products screen — it never showed up
  // in Inventory even though it existed and was visible in Products. Same
  // relaxed check already used by the generic list query (line ~1338).
  //
  // FIX: this used to ignore the query string entirely (search/filter never
  // reached SQLite), and never returned isLowStock/isOutOfStock — only a
  // `status` string the frontend (inventory.tsx) doesn't read at all. It
  // reads `p.isLowStock` / `p.isOutOfStock`, so both were always undefined
  // (falsy) here: every row rendered as "متوفر" regardless of real stock,
  // and the "منخفض"/"نفد" filter buttons plus the search box did nothing
  // in desktop/offline mode. Parse the query params consistently for the UI
  // does and compute the same two booleans so status + filters both work.
  const url = new URL(`http://x${path}`)
  const search = url.searchParams.get('search') || ''
  const filter = url.searchParams.get('filter') // lowStock | outOfStock
  const categoryId = url.searchParams.get('categoryId')
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '500'), 2000)

  const products = await db.select("SELECT p.*, c.name as category_name, c.name_ar as category_name_ar FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE (p.active = 1 OR p.active = 'true') AND p.deleted_at IS NULL ORDER BY p.name")
  let mapped = products.map((p) => {
    const currentStock = p.current_stock
    const isOutOfStock = currentStock <= 0
    const isLowStock = !isOutOfStock && currentStock <= p.reorder_level
    return {
      ...rowToCamel(p),
      categoryName: p.category_name,
      categoryNameAr: p.category_name_ar,
      currentStock,
      stockValue: currentStock * p.avg_cost,
      isLowStock,
      isOutOfStock,
      status: isOutOfStock ? 'out_of_stock' : isLowStock ? 'low_stock' : 'in_stock',
    }
  })

  if (categoryId) mapped = mapped.filter((p) => p.categoryId === categoryId)
  if (search) {
    const q = search.toLowerCase()
    mapped = mapped.filter((p) =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.nameAr || '').toLowerCase().includes(q) ||
      (p.sku || '').toLowerCase().includes(q) ||
      (p.barcode || '').toLowerCase().includes(q)
    )
  }
  if (filter === 'lowStock') mapped = mapped.filter((p) => p.isLowStock)
  else if (filter === 'outOfStock') mapped = mapped.filter((p) => p.isOutOfStock)

  const summaryBeforePagination = {
    totalStockValue: round2(mapped.reduce((s, p) => s + Math.max(0, Number(p.stockValue || 0)), 0)),
    totalProducts: mapped.length,
    lowStockCount: mapped.filter((p) => p.isLowStock).length,
    outOfStockCount: mapped.filter((p) => p.isOutOfStock).length,
  }
  mapped = mapped.slice(0, limit)
  return {
    products: mapped,
    summary: summaryBeforePagination,
  }
}

async function handlePlatform(db): Promise<any> {
  // All counted tables (products, customers, sales, users, expenses,
  // stock_movements) carry a deleted_at column from migration 002 —
  // filter them out so platform stats reflect live rows only.
  // audit_logs and sync_queue have no deleted_at (audit_logs is
  // hard-deleted per PHASE-1C spec) — no filter applied there.
  const [products, customers, sales, users, expenses, stockMovements, auditLogs, pendingSync] = await Promise.all([
    db.select('SELECT COUNT(*) as count FROM products WHERE deleted_at IS NULL'),
    db.select('SELECT COUNT(*) as count FROM customers WHERE deleted_at IS NULL'),
    db.select('SELECT COUNT(*) as count FROM sales WHERE deleted_at IS NULL'),
    db.select('SELECT COUNT(*) as count FROM users WHERE deleted_at IS NULL'),
    db.select('SELECT COUNT(*) as count FROM expenses WHERE deleted_at IS NULL'),
    db.select('SELECT COUNT(*) as count FROM stock_movements WHERE deleted_at IS NULL'),
    db.select('SELECT COUNT(*) as count FROM audit_logs'),
    db.select("SELECT COUNT(*) as count FROM sync_queue WHERE status = 'PENDING'"),
  ])
  return {
    systemLocked: false,
    database: {
      totalRecords: products[0].count + customers[0].count + sales[0].count + users[0].count,
      tables: {
        products: products[0].count,
        customers: customers[0].count,
        sales: sales[0].count,
        users: users[0].count,
        expenses: expenses[0].count,
        stockMovements: stockMovements[0].count,
        auditLogs: auditLogs[0].count,
        pendingSync: pendingSync[0].count,
      },
    },
  }
}

function upsertSql(table: string, columns: string[], values: unknown[]): string {
  const updateCols = columns.filter((column) => column !== 'id')
  const primarySet = updateCols.length
    ? `DO UPDATE SET ${updateCols.map((column) => `${column} = excluded.${column}`).join(', ')}`
    : 'DO NOTHING'
  return `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${sqlVals(values)} ON CONFLICT(id) ${primarySet}`
}

function updateSql(table: string, setClauses: string[], values: unknown[], entityId: string): string {
  const assignments = setClauses.map((clause, index) => {
    const marker = `?`
    if (clause.includes(marker)) {
      const [column] = clause.split('=')
      return `${column.trim()} = ${sqlEsc(values[index])}`
    }
    return clause
  })
  return `UPDATE ${table} SET ${assignments.join(', ')} WHERE id = ${sqlEsc(entityId)}`
}

async function computeCategorySkuCode(db, categoryName: string): Promise<string> {
  const base = deriveCategorySkuBase(categoryName)
  const used = await db.select("SELECT sku_code FROM categories WHERE sku_code IS NOT NULL")
  const usedSet = new Set((used || []).map((r) => String(r.sku_code || '').toUpperCase()))
  let code = base
  let n = 2
  while (usedSet.has(code)) code = `${base}${n++}`.slice(0, 8)
  return code
}

async function buildOperationJournalStatement(db, entityType: string, entityId: string, payload: any, operation: string = 'CREATE'): Promise<string> {
  const clientTxnId = payload.clientTxnId || entityId
  const deviceId = await getDeviceId(db)
  return `INSERT OR REPLACE INTO sync_queue
      (entity_type, entity_id, client_txn_id, device_id, operation, payload, status, attempts, created_at, updated_at)
     VALUES ${sqlVals([entityType, entityId, clientTxnId, deviceId, operation, JSON.stringify(payload), 'PENDING', 0, new Date().toISOString(), new Date().toISOString()])}`
}


// ============================================================
// LOCAL DEVICE OPERATION JOURNAL ID
// ============================================================
// This identifier is non-secret and is used only to correlate local
// operation-journal rows for idempotency and audit diagnostics. It is
// never sent over the network in Desktop-only mode.
// ============================================================
let _deviceId: string | null = null
async function getDeviceId(db): Promise<string> {
  if (_deviceId) return _deviceId
  const existing = await db.select("SELECT value FROM settings WHERE key='system.deviceId' LIMIT 1")
  if (existing[0]?.value) {
    _deviceId = String(existing[0].value)
    return _deviceId
  }
  _deviceId = generateUUID()
  await db.execute("INSERT OR IGNORE INTO settings (key,value,category,updated_at) VALUES ('system.deviceId',?,'system',datetime('now'))", [_deviceId])
  return _deviceId
}
