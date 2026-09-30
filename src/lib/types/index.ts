// ============================================================
// SHARED TYPES — Uni Kasher
// ============================================================
// This module is the single source of truth for entity shapes
// across the POS system. React/Tauri uses these shapes at the UI boundary,
// while SQLite rows are mapped explicitly by the desktop data layer.
//
// CONVENTIONS:
//   - All field names use camelCase (frontend-friendly).
//   - The SQLite layer maps snake_case DB columns to these camelCase fields
//     via explicit row-mappers. There is no second web data model.
//   - No `any` is allowed — use `unknown` + runtime guards if
//     the shape is genuinely dynamic, or define a dedicated
//     interface.
//   - Dates are represented as ISO 8601 strings (`string`) to
//     stay JSON-serialisable across the wire and SQLite TEXT.
//
// SYNC EXTENSIONS:
//   Every mutable entity carries optional sync metadata:
//     - clientTxnId?: string   — idempotency key (UUID)
//     - syncStatus?: SyncStatus — 'pending' | 'synced' | 'failed' | 'conflict'
//     - deletedAt?: string | null — soft-delete marker (NULL = active)
//     - updatedAt?: string     — last-write-wins resolution
// ============================================================

// ------------------------------------------------------------
// ENUMS / LITERAL UNIONS
// ------------------------------------------------------------

/** CRUD operation type tracked by the sync queue. */
export type OperationType = 'CREATE' | 'UPDATE' | 'DELETE'

/**
 * Lifecycle status of a sync queue item.
 * - PENDING: queued, waiting for next sync cycle
 * - PROCESSING: sync engine is currently pushing it
 * - SYNCED: server acknowledged the change
 * - FAILED: max attempts exceeded or server rejected
 * - CONFLICT: server reported a conflicting newer version
 */
export type SyncOperationStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'SYNCED'
  | 'FAILED'
  | 'CONFLICT'

/**
 * Per-row sync state stored on entity tables (products, sales, …).
 * Distinct from `SyncOperationStatus` (which is the queue lifecycle)
 * and `SyncStatus` (which is the aggregate sync snapshot).
 */
export type EntitySyncStatus = 'pending' | 'synced' | 'failed' | 'conflict'

/** User roles — drives UI permissions and sidebar visibility. */
export type UserRole =
  | 'OWNER'
  | 'ADMIN'
  | 'MANAGER'
  | 'CASHIER'
  | 'WAREHOUSE'
  | 'ACCOUNTANT'
  | 'PLATFORM'

/** Payment methods supported by the POS. */
export type PaymentMethod = 'CASH' | 'CARD' | 'TRANSFER' | 'SPLIT' | 'OTHER'

/** Sale lifecycle. */
export type SaleStatus =
  | 'COMPLETED'
  | 'HELD'
  | 'REFUNDED'
  | 'PARTIAL_REFUND'

/** Purchase lifecycle. */
export type PurchaseStatus = 'PENDING' | 'RECEIVED' | 'PARTIAL' | 'PAID'

/** Cash session lifecycle. */
export type CashSessionStatus = 'OPEN' | 'CLOSED'

/** Cash movement types. */
export type CashMovementType =
  | 'OPENING'
  | 'CLOSING'
  | 'SALE'
  | 'CASH_IN'
  | 'CASH_OUT'
  | 'REFUND'
  | 'EXPENSE'

/** Stock movement types. */
export type StockMovementType =
  | 'PURCHASE'
  | 'SALE'
  | 'RETURN'
  | 'ADJUSTMENT'
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT'
  | 'DAMAGE'
  | 'OPENING_STOCK'

/** Loyalty transaction types. */
export type LoyaltyTxnType =
  | 'EARN'
  | 'REDEEM'
  | 'EXPIRE'
  | 'REVERSE'
  | 'BONUS'
  | 'ADJUSTMENT'

/** Loyalty tiers. */
export type LoyaltyTierName = 'BRONZE' | 'SILVER' | 'GOLD' | 'VIP'

/** Stock adjustment reasons. */
export type StockAdjustmentReason =
  | 'DAMAGE'
  | 'LOSS'
  | 'THEFT'
  | 'COUNT'
  | 'CORRECTION'
  | 'SAMPLE'
  | 'OTHER'

/**
 * How a sync conflict is resolved.
 * - SERVER_WINS: discard local version, take server's
 * - CLIENT_WINS: force-push local version
 * - MERGE: user manually picks fields
 * - SKIP: leave local pending, defer to user
 */
export type ConflictResolution =
  | 'SERVER_WINS'
  | 'CLIENT_WINS'
  | 'MERGE'
  | 'SKIP'

/** Entities that the sync engine knows how to push/pull. */
export type EntityType =
  | 'Product'
  | 'Category'
  | 'Customer'
  | 'Supplier'
  | 'Sale'
  | 'SaleItem'
  | 'SalePayment'
  | 'Purchase'
  | 'PurchaseItem'
  | 'StockMovement'
  | 'StockAdjustment'
  | 'CashSession'
  | 'CashMovement'
  | 'Expense'
  | 'ExpenseCategory'
  | 'LoyaltyAccount'
  | 'LoyaltyTransaction'
  | 'User'
  | 'Setting'

// ------------------------------------------------------------
// BASE / MIXIN FIELDS
// ------------------------------------------------------------

/**
 * Fields shared by every tracked entity.
 * Applied via TypeScript intersection (`Entity & TrackedFields`).
 */
export interface TrackedFields {
  /** Idempotency key — prevents duplicate writes on retry. */
  clientTxnId?: string | null
  /** Sync state of this row. */
  syncStatus?: EntitySyncStatus
  /** Soft-delete marker. NULL or undefined means active. */
  deletedAt?: string | null
  /** Last-write-wins timestamp (ISO 8601). */
  updatedAt?: string
  /** Creation timestamp (ISO 8601). */
  createdAt?: string
}

// ------------------------------------------------------------
// AUTH & USERS
// ------------------------------------------------------------

export interface User extends TrackedFields {
  id: string
  email: string
  username: string
  /** Never expose to the client in API responses — kept here for internal type alignment. */
  passwordHash?: string
  name: string
  phone?: string | null
  role: UserRole
  /** JSON-encoded array of permission strings. */
  permissions: string[]
  active: boolean
  /** Quick login PIN. */
  pin?: string | null
}

// ------------------------------------------------------------
// PRODUCTS & CATALOG
// ------------------------------------------------------------

export interface Category extends TrackedFields {
  id: string
  name: string
  nameAr?: string | null
  parentId?: string | null
  color?: string | null
  icon?: string | null
  /** Convenience counts populated by the API. */
  productCount?: number
  children?: Category[]
}

export interface Brand extends TrackedFields {
  id: string
  name: string
  nameAr?: string | null
}

export interface Unit extends TrackedFields {
  id: string
  name: string
  shortName?: string | null
}

export interface Supplier extends TrackedFields {
  id: string
  name: string
  phone?: string | null
  email?: string | null
  address?: string | null
  taxId?: string | null
  /** Outstanding balance owed to supplier (positive = we owe). */
  balance: number
  active: boolean
  /** Convenience aggregate populated by API. */
  totalPurchases?: number
  lastPurchaseAt?: string | null
}

export interface Product extends TrackedFields {
  id: string
  name: string
  nameAr?: string | null
  sku: string
  barcode?: string | null
  /** JSON-encoded array of secondary barcodes (stored as TEXT in SQLite). */
  barcodes?: string | string[]
  categoryId?: string | null
  brandId?: string | null
  unitId?: string | null
  supplierId?: string | null
  storeId?: string | null

  // Pricing
  purchaseCost: number
  sellingPrice: number
  wholesalePrice: number
  taxRate: number

  // Inventory
  minStock: number
  reorderLevel: number
  trackStock: boolean
  allowNegativeStock: boolean

  /** Weighted-average cost — recomputed on every purchase. */
  avgCost: number

  image?: string | null
  description?: string | null
  active: boolean

  /** Aggregated stock across all warehouses (computed by API). */
  currentStock: number

  // Embedded relations (optional — only populated by detail endpoints)
  category?: Category | null
  supplier?: Supplier | null
  stockLevels?: StockLevel[]
}

export interface StockLevel {
  id: string
  productId: string
  warehouseId: string
  quantity: number
  updatedAt?: string
}

// ------------------------------------------------------------
// INVENTORY MOVEMENTS
// ------------------------------------------------------------

/** Alias — the codebase uses both names; align on `InventoryMovement`. */
export interface InventoryMovement extends TrackedFields {
  id: string
  productId: string
  warehouseId?: string | null
  type: StockMovementType
  /** Positive = stock in, negative = stock out. */
  quantity: number
  refType?: string | null
  refId?: string | null
  note?: string | null
  userId?: string | null
  /** Embedded for UI convenience. */
  productName?: string
  productSku?: string
}

/** Backwards-compatible alias. */
export type StockMovement = InventoryMovement

export interface StockAdjustment extends TrackedFields {
  id: string
  productId: string
  warehouseId?: string | null
  oldQuantity: number
  newQuantity: number
  reason: StockAdjustmentReason
  note?: string | null
  userId?: string | null
  productName?: string
}

// ------------------------------------------------------------
// SALES
// ------------------------------------------------------------

export interface SaleItem extends TrackedFields {
  id: string
  saleId: string
  productId: string
  quantity: number
  unitPrice: number
  discountAmount: number
  taxAmount: number
  total: number
  /** Captured at sale time for profit reports. */
  costAtSale: number
  /** Embedded for UI convenience. */
  productName?: string
  productSku?: string
  productBarcode?: string
}

export interface SalePayment extends TrackedFields {
  id: string
  saleId: string
  method: PaymentMethod
  amount: number
  /** Optional reference (card last 4, transfer ref, etc.). */
  reference?: string | null
}

export interface Sale extends TrackedFields {
  id: string
  /** Server-side invoice number — populated after successful sync. */
  invoiceNumber: string
  customerId?: string | null
  customerName?: string | null
  userId: string
  storeId?: string | null
  registerId?: string | null

  subtotal: number
  discountAmount: number
  discountType?: 'PERCENT' | 'FIXED' | null
  taxAmount: number
  total: number
  paidAmount: number
  changeAmount: number

  status: SaleStatus
  paymentMethod: PaymentMethod
  /** JSON-encoded split-payment details. */
  paymentDetails?: string | null

  loyaltyEarned: number
  loyaltyRedeemed: number

  note?: string | null
  held: boolean

  // Embedded relations (optional — only populated by detail endpoints)
  items?: SaleItem[]
  payments?: SalePayment[]
  customer?: Customer | null
}

export interface SaleReturn extends TrackedFields {
  id: string
  returnNumber: string
  saleId: string
  userId: string
  subtotal: number
  taxAmount: number
  total: number
  refundMethod: PaymentMethod
  reason?: string | null
  status: SaleStatus
  loyaltyReversed: number
  items?: SaleReturnItem[]
}

export interface SaleReturnItem {
  id: string
  saleReturnId: string
  saleItemId?: string | null
  productId: string
  quantity: number
  unitPrice: number
  total: number
}

// ------------------------------------------------------------
// PURCHASES
// ------------------------------------------------------------

export interface PurchaseItem extends TrackedFields {
  id: string
  purchaseId: string
  productId: string
  quantity: number
  unitCost: number
  taxRate: number
  total: number
  productName?: string
  productSku?: string
}

export interface Purchase extends TrackedFields {
  id: string
  invoiceNumber?: string | null
  supplierId?: string | null
  storeId?: string | null
  warehouseId?: string | null
  userId?: string | null

  subtotal: number
  taxAmount: number
  discountAmount: number
  total: number
  paidAmount: number
  status: PurchaseStatus

  note?: string | null

  // Embedded
  supplier?: Supplier | null
  items?: PurchaseItem[]
}

// ------------------------------------------------------------
// CUSTOMERS & LOYALTY
// ------------------------------------------------------------

export interface Customer extends TrackedFields {
  id: string
  name: string
  phone?: string | null
  email?: string | null
  address?: string | null
  notes?: string | null
  birthday?: string | null
  tier: LoyaltyTierName
  active: boolean

  /** Convenience denormalised loyalty summary. */
  loyaltyPoints?: number
  totalEarned?: number
  totalRedeemed?: number

  // Embedded
  loyaltyAccount?: LoyaltyAccount | null
}

export interface LoyaltyAccount extends TrackedFields {
  id: string
  customerId: string
  points: number
  totalEarned: number
  totalRedeemed: number
  tier: LoyaltyTierName
}

export interface LoyaltyTransaction extends TrackedFields {
  id: string
  customerId: string
  type: LoyaltyTxnType
  /** Positive for earn/bonus, negative for redeem/expire/reverse. */
  points: number
  refType?: string | null
  refId?: string | null
  note?: string | null
  customerName?: string
}

export interface LoyaltyTier {
  id: string
  name: LoyaltyTierName
  displayName: string
  minPoints: number
  earningMultiplier: number
  discountPercent: number
  color?: string | null
}

export interface LoyaltyCampaign extends TrackedFields {
  id: string
  name: string
  description?: string | null
  startDate?: string | null
  endDate?: string | null
  tierFilter?: string | null
  pointsMultiplier: number
  bonusPoints: number
  minPurchase: number
  active: boolean
}

// ------------------------------------------------------------
// CASH REGISTER
// ------------------------------------------------------------

export interface CashSession extends TrackedFields {
  id: string
  /** Optional in single-register setups. */
  registerId?: string | null
  userId: string
  openingBalance: number
  closingBalance?: number | null
  expectedCash?: number | null
  difference?: number | null
  status: CashSessionStatus
  openedAt: string
  closedAt?: string | null

  // Embedded
  movements?: CashMovement[]
  user?: Pick<User, 'id' | 'name' | 'username'> | null
}

export interface CashMovement extends TrackedFields {
  id: string
  sessionId: string
  type: CashMovementType
  amount: number
  note?: string | null
  refType?: string | null
  refId?: string | null
}

// ------------------------------------------------------------
// EXPENSES
// ------------------------------------------------------------

export interface ExpenseCategory extends TrackedFields {
  id: string
  name: string
  nameAr?: string | null
  color?: string | null
  expenseCount?: number
  totalAmount?: number
}

export interface Expense extends TrackedFields {
  id: string
  categoryId?: string | null
  userId: string
  amount: number
  paymentMethod: PaymentMethod
  note?: string | null
  date: string

  // Embedded
  category?: ExpenseCategory | null
  user?: Pick<User, 'id' | 'name'> | null
}

// ------------------------------------------------------------
// SETTINGS
// ------------------------------------------------------------

export interface Setting extends TrackedFields {
  /** Settings are keyed by string (no separate id). */
  id?: string
  key: string
  value: string
  category: string
}

// ------------------------------------------------------------
// AUDIT LOG
// ------------------------------------------------------------

export interface AuditLog extends TrackedFields {
  id: string
  userId?: string | null
  action: string
  entity?: string | null
  entityId?: string | null
  /** JSON snapshots. */
  before?: string | null
  after?: string | null
  ipAddress?: string | null
  device?: string | null
  user?: Pick<User, 'id' | 'name' | 'username'> | null
}

// ------------------------------------------------------------
// SYNC LAYER
// ------------------------------------------------------------

/**
 * A single sync operation — one row in the sync queue.
 * Mirrors the SQLite `sync_queue` table but uses camelCase.
 */
export interface SyncQueueItem {
  /** Auto-increment integer PK in SQLite; undefined before insert. */
  id?: number
  /** Logical device identifier. */
  deviceId?: string | null
  entityType: EntityType
  entityId: string
  /** Idempotency key — server dedupes on this. */
  clientTxnId: string
  operation: OperationType
  /** JSON-encoded payload to push. */
  payload: string
  status: SyncOperationStatus
  attempts: number
  /** Maximum attempts before marking FAILED permanently. */
  maxAttempts?: number
  error?: string | null
  createdAt: string
  syncedAt?: string | null
}

/**
 * High-level operation descriptor used by the sync engine when
 * batching changes for push. Decoupled from queue storage so
 * the engine can build batches without touching SQLite directly.
 */
export interface SyncOperation<T = unknown> {
  entityType: EntityType
  entityId: string
  clientTxnId: string
  operation: OperationType
  /** Strongly-typed payload (entity shape). */
  payload: T
  /** Optional device identifier for multi-device debugging. */
  deviceId?: string
  /** Original local timestamp — for conflict ordering. */
  clientTimestamp: string
}

/**
 * Aggregate status snapshot — used by the connection store
 * and Settings → Sync tab to render sync health.
 */
export interface SyncStatus {
  online: boolean
  syncing: boolean
  /** Number of items still in PENDING state. */
  pendingCount: number
  /** Items permanently FAILED (exceeded maxAttempts). */
  failedCount: number
  /** Items in CONFLICT state — require user resolution. */
  conflictCount: number
  lastSyncAt?: string | null
  lastError?: string | null
  /** ISO timestamp of the next scheduled sync. */
  nextSyncAt?: string | null
}

/**
 * Result returned by `runFullSync()` and surfaced to the UI.
 */
export interface SyncResult {
  pushed: number
  pulled: number
  errors: number
  conflicts: number
  /** Wall-clock duration in milliseconds. */
  durationMs: number
  /** Per-entity breakdown of pushed counts. */
  byEntity?: Partial<Record<EntityType, number>>
  /** First error message encountered, if any. */
  lastError?: string | null
}

/**
 * Describes a conflict detected by the server.
 * The client resolves by picking one of `ConflictResolution`.
 */
export interface SyncConflict {
  entityType: EntityType
  entityId: string
  clientTxnId: string
  /** Server's version of the record. */
  serverVersion: Record<string, unknown>
  /** Local version that was rejected. */
  localVersion: Record<string, unknown>
  /** Server-side timestamp — usually the updatedAt field. */
  serverTimestamp: string
  /** Local timestamp. */
  clientTimestamp: string
  /** Field-level diff (only present for UPDATE conflicts). */
  diff?: Array<{ field: string; serverValue: unknown; localValue: unknown }>
  /** Resolution chosen by the user (null until resolved). */
  resolution?: ConflictResolution | null
}

// ------------------------------------------------------------
// API ENVELOPE
// ------------------------------------------------------------

/** Standard success envelope returned by the desktop data layer. */
export interface ApiSuccess<T> {
  success: true
  data: T
  message?: string
}

/** Standard error envelope. */
export interface ApiError {
  success: false
  error: string
  code?: string
  details?: unknown
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError

/** Paginated list envelope. */
export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
}

// ------------------------------------------------------------
// CONVENIENCE TYPE GUARDS
// ------------------------------------------------------------

export function isApiSuccess<T>(res: ApiResponse<T>): res is ApiSuccess<T> {
  return res.success === true
}

export function isApiError<T>(res: ApiResponse<T>): res is ApiError {
  return res.success === false
}
