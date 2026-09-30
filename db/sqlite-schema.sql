-- ============================================================================
-- NexFlow Desktop 2.0.9 — Canonical SQLite Schema
-- ============================================================================
-- Generated from the numbered desktop migrations (latest schema version: 27).
-- Runtime upgrades are performed by the versioned Tauri migrations. This file
-- is a parity/bootstrap snapshot and must match the final migration state.
-- Internal SQLite objects (sqlite_*) are intentionally omitted.
-- ============================================================================
PRAGMA foreign_keys = ON;

CREATE TABLE audit_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    action TEXT NOT NULL,
    entity TEXT,
    entity_id TEXT,
    before TEXT,
    after TEXT,
    created_at TEXT DEFAULT (datetime('now'))
, deleted_at TEXT, updated_at TEXT);

CREATE TABLE brands (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL, name_ar TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE cash_movements (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES cash_sessions(id),
    type TEXT NOT NULL,
    amount REAL NOT NULL,
    note TEXT, ref_type TEXT, ref_id TEXT,
    sync_status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now'))
, deleted_at TEXT, client_txn_id TEXT, updated_at TEXT);

CREATE TABLE cash_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    opening_balance REAL DEFAULT 0,
    closing_balance REAL,
    expected_cash REAL,
    difference REAL,
    status TEXT DEFAULT 'OPEN',
    opened_at TEXT DEFAULT (datetime('now')),
    closed_at TEXT
, deleted_at TEXT, updated_at TEXT, register_id TEXT REFERENCES registers(id), client_txn_id TEXT);

CREATE TABLE categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    name_ar TEXT,
    parent_id TEXT REFERENCES categories(id),
    color TEXT, icon TEXT,
    created_at TEXT DEFAULT (datetime('now'))
, deleted_at TEXT, updated_at TEXT, dead_stock_days_override INTEGER, sku_code TEXT);

CREATE TABLE customers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT UNIQUE,
    email TEXT, address TEXT, notes TEXT,
    birthday TEXT,
    tier TEXT DEFAULT 'BRONZE',
    active INTEGER DEFAULT 1,
    loyalty_points INTEGER DEFAULT 0,
    total_earned INTEGER DEFAULT 0,
    total_redeemed INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
, deleted_at TEXT);

CREATE TABLE expense_categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL, name_ar TEXT, color TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE expenses (
    id TEXT PRIMARY KEY,
    category_id TEXT,
    user_id TEXT NOT NULL REFERENCES users(id),
    amount REAL NOT NULL,
    payment_method TEXT DEFAULT 'CASH',
    note TEXT,
    date TEXT DEFAULT (datetime('now')),
    sync_status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now'))
, deleted_at TEXT, client_txn_id TEXT, updated_at TEXT);

CREATE TABLE general_accounts (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (account_type IN ('ASSET','LIABILITY','EQUITY','REVENUE','COGS','EXPENSE')),
  parent_id TEXT REFERENCES general_accounts(id) ON DELETE SET NULL,
  opening_balance REAL NOT NULL DEFAULT 0 CHECK (opening_balance >= 0),
  active TEXT NOT NULL DEFAULT 'true',
  is_system TEXT NOT NULL DEFAULT 'false',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE general_journal_entries (
  id TEXT PRIMARY KEY,
  client_txn_id TEXT UNIQUE,
  entry_no TEXT NOT NULL UNIQUE,
  entry_date TEXT NOT NULL,
  description TEXT NOT NULL,
  reference_type TEXT,
  reference_id TEXT,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED','VOID')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
, entry_source TEXT NOT NULL DEFAULT 'MANUAL' CHECK (entry_source IN ('MANUAL','AUTOMATIC')));

CREATE TABLE general_journal_lines (
  id TEXT PRIMARY KEY,
  journal_entry_id TEXT NOT NULL REFERENCES general_journal_entries(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES general_accounts(id) ON DELETE RESTRICT,
  debit REAL NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit REAL NOT NULL DEFAULT 0 CHECK (credit >= 0),
  note TEXT
);

CREATE TABLE invoice_sequences (
  id          TEXT PRIMARY KEY,
  store_id    TEXT,
  prefix      TEXT NOT NULL,
  next_number INTEGER NOT NULL DEFAULT 1 CHECK(next_number >= 1),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(store_id, prefix)
);

CREATE TABLE loyalty_accounts (
    id TEXT PRIMARY KEY,
    customer_id TEXT UNIQUE NOT NULL REFERENCES customers(id),
    points INTEGER DEFAULT 0,
    total_earned INTEGER DEFAULT 0,
    total_redeemed INTEGER DEFAULT 0,
    tier TEXT DEFAULT 'BRONZE',
    updated_at TEXT DEFAULT (datetime('now'))
, deleted_at TEXT);

CREATE TABLE loyalty_campaigns (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    start_date TEXT,
    end_date TEXT,
    tier_filter TEXT,
    points_multiplier REAL DEFAULT 1.0,
    bonus_points INTEGER DEFAULT 0,
    min_purchase REAL DEFAULT 0,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
, product_id TEXT);

CREATE TABLE loyalty_tiers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    display_name TEXT NOT NULL,
    min_points INTEGER DEFAULT 0,
    earning_multiplier REAL DEFAULT 1.0,
    discount_percent REAL DEFAULT 0,
    color TEXT
);

CREATE TABLE loyalty_transactions (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES customers(id),
    type TEXT NOT NULL,
    points INTEGER NOT NULL,
    ref_type TEXT, ref_id TEXT,
    note TEXT,
    sync_status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now'))
, deleted_at TEXT, client_txn_id TEXT, updated_at TEXT);

CREATE TABLE products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL, name_ar TEXT,
    sku TEXT UNIQUE NOT NULL,
    barcode TEXT UNIQUE,
    category_id TEXT REFERENCES categories(id),
    brand_id TEXT REFERENCES brands(id),
    unit_id TEXT REFERENCES units(id),
    supplier_id TEXT REFERENCES suppliers(id),
    purchase_cost REAL DEFAULT 0,
    selling_price REAL DEFAULT 0,
    wholesale_price REAL DEFAULT 0,
    tax_rate REAL DEFAULT 0,
    min_stock INTEGER DEFAULT 0,
    reorder_level INTEGER DEFAULT 0,
    track_stock INTEGER DEFAULT 1,
    allow_negative_stock INTEGER DEFAULT 0,
    avg_cost REAL DEFAULT 0,
    image TEXT, description TEXT,
    active INTEGER DEFAULT 1,
    current_stock INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
, deleted_at TEXT, barcodes TEXT DEFAULT '[]', store_id TEXT, dead_stock_days_override INTEGER);

CREATE TABLE purchase_items (
    id TEXT PRIMARY KEY,
    purchase_id TEXT NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL REFERENCES products(id),
    quantity INTEGER NOT NULL,
    unit_cost REAL NOT NULL,
    tax_rate REAL DEFAULT 0,
    total REAL NOT NULL
, deleted_at TEXT, updated_at TEXT);

CREATE TABLE purchase_payments (
  id            TEXT PRIMARY KEY,
  client_txn_id TEXT NOT NULL UNIQUE,
  purchase_id   TEXT NOT NULL REFERENCES purchases(id) ON DELETE RESTRICT,
  supplier_id   TEXT REFERENCES suppliers(id) ON DELETE RESTRICT,
  amount        REAL NOT NULL CHECK (amount > 0),
  source        TEXT NOT NULL DEFAULT 'CASHBOX' CHECK (source IN ('CASHBOX','OUTSIDE_CASH','CARD','TRANSFER')),
  method        TEXT NOT NULL DEFAULT 'CASH',
  note          TEXT,
  user_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
  paid_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE purchases (
    id TEXT PRIMARY KEY,
    invoice_number TEXT,
    supplier_id TEXT,
    user_id TEXT,
    warehouse_id TEXT,
    subtotal REAL DEFAULT 0,
    tax_amount REAL DEFAULT 0,
    discount_amount REAL DEFAULT 0,
    total REAL DEFAULT 0,
    paid_amount REAL DEFAULT 0,
    status TEXT DEFAULT 'RECEIVED',
    note TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
, deleted_at TEXT, client_txn_id TEXT, payment_method TEXT NOT NULL DEFAULT 'CASH');

CREATE TABLE registers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    store_id TEXT REFERENCES stores(id),
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE sale_items (
    id TEXT PRIMARY KEY,
    sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL REFERENCES products(id),
    quantity INTEGER NOT NULL,
    unit_price REAL NOT NULL,
    discount_amount REAL DEFAULT 0,
    tax_amount REAL DEFAULT 0,
    total REAL NOT NULL,
    cost_at_sale REAL DEFAULT 0
, deleted_at TEXT, updated_at TEXT, product_name TEXT);

CREATE TABLE sale_payments (
  id          TEXT PRIMARY KEY,
  sale_id     TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  method      TEXT NOT NULL,
  amount      REAL NOT NULL,
  reference   TEXT,
  created_at  TEXT DEFAULT (datetime('now')),
  sync_status TEXT DEFAULT 'pending'
, client_txn_id TEXT);

CREATE TABLE sale_return_items (
    id TEXT PRIMARY KEY,
    sale_return_id TEXT NOT NULL REFERENCES sale_returns(id) ON DELETE CASCADE,
    sale_item_id TEXT,
    product_id TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price REAL NOT NULL,
    total REAL NOT NULL
);

CREATE TABLE sale_returns (
    id TEXT PRIMARY KEY,
    return_number TEXT UNIQUE NOT NULL,
    sale_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    subtotal REAL DEFAULT 0,
    tax_amount REAL DEFAULT 0,
    total REAL DEFAULT 0,
    refund_method TEXT DEFAULT 'CASH',
    reason TEXT,
    status TEXT DEFAULT 'COMPLETED',
    loyalty_reversed INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
, client_txn_id TEXT, updated_at TEXT);

CREATE TABLE sales (
    id TEXT PRIMARY KEY,
    client_txn_id TEXT UNIQUE,
    invoice_number TEXT UNIQUE NOT NULL,
    customer_id TEXT REFERENCES customers(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    items_json TEXT,
    subtotal REAL DEFAULT 0,
    discount_amount REAL DEFAULT 0,
    tax_amount REAL DEFAULT 0,
    total REAL DEFAULT 0,
    paid_amount REAL DEFAULT 0,
    change_amount REAL DEFAULT 0,
    payment_method TEXT DEFAULT 'CASH',
    payment_details TEXT,
    loyalty_earned INTEGER DEFAULT 0,
    loyalty_redeemed INTEGER DEFAULT 0,
    note TEXT,
    status TEXT DEFAULT 'COMPLETED',
    sync_status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
, deleted_at TEXT);

CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    category TEXT DEFAULT 'general'
, updated_at TEXT);

CREATE TABLE sku_sequences (
  sequence_key TEXT PRIMARY KEY,
  next_number INTEGER NOT NULL DEFAULT 1 CHECK(next_number >= 1),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE stock_adjustments (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    warehouse_id TEXT,
    old_quantity INTEGER NOT NULL,
    new_quantity INTEGER NOT NULL,
    reason TEXT NOT NULL,
    note TEXT,
    user_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE stock_levels (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL REFERENCES products(id),
    warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
    quantity INTEGER DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(product_id, warehouse_id)
);

CREATE TABLE stock_movements (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL REFERENCES products(id),
    type TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    ref_type TEXT, ref_id TEXT,
    note TEXT,
    sync_status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now'))
, deleted_at TEXT, client_txn_id TEXT, updated_at TEXT, warehouse_id TEXT, user_id TEXT);

CREATE TABLE stores (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    address TEXT, phone TEXT, email TEXT,
    currency TEXT DEFAULT 'EGP',
    receipt_footer TEXT,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE suppliers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL, phone TEXT, email TEXT,
    address TEXT, tax_id TEXT, balance REAL DEFAULT 0,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
, deleted_at TEXT, updated_at TEXT);

CREATE TABLE sync_metadata (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id     TEXT NOT NULL,
  entity_type   TEXT NOT NULL,
  last_pull_at  TEXT,
  last_push_at  TEXT,
  last_cursor   TEXT,
  server_version TEXT,
  sync_status   TEXT DEFAULT 'idle',
  last_error    TEXT,
  UNIQUE(device_id, entity_type)
);

CREATE TABLE sync_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    client_txn_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    payload TEXT,
    status TEXT DEFAULT 'PENDING',
    attempts INTEGER DEFAULT 0,
    error TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    synced_at TEXT
, updated_at TEXT, device_id TEXT);

CREATE TABLE units (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL, short_name TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT,
    role TEXT DEFAULT 'CASHIER',
    permissions TEXT DEFAULT '[]',
    active INTEGER DEFAULT 1,
    pin TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
, deleted_at TEXT);

CREATE TABLE warehouses (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    store_id TEXT REFERENCES stores(id),
    location TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_cash_movements_client_txn     ON cash_movements(client_txn_id);

CREATE INDEX idx_cash_movements_session_created
  ON cash_movements(session_id, created_at);

CREATE INDEX idx_cash_movements_session_type_date
  ON cash_movements(session_id, type, created_at);

CREATE INDEX idx_cash_sessions_active_status
  ON cash_sessions(status, deleted_at, opened_at);

CREATE INDEX idx_cash_sessions_client_txn
  ON cash_sessions(client_txn_id);

CREATE INDEX idx_categories_parent_dead_stock ON categories(parent_id, dead_stock_days_override);

CREATE INDEX idx_categories_sync ON categories(updated_at, deleted_at);

CREATE INDEX idx_categories_updated            ON categories(updated_at);

CREATE INDEX idx_customers_deleted             ON customers(deleted_at);

CREATE INDEX idx_customers_phone ON customers(phone);

CREATE INDEX idx_customers_sync ON customers(updated_at, deleted_at);

CREATE INDEX idx_customers_updated             ON customers(updated_at);

CREATE INDEX idx_expenses_client_txn           ON expenses(client_txn_id);

CREATE INDEX idx_ga_parent ON general_accounts(parent_id);

CREATE INDEX idx_ga_type ON general_accounts(account_type);

CREATE INDEX idx_general_journal_date ON general_journal_entries(entry_date);

CREATE INDEX idx_general_journal_reference ON general_journal_entries(reference_type, reference_id, entry_source);

CREATE INDEX idx_gje_date ON general_journal_entries(entry_date);

CREATE INDEX idx_gje_ref ON general_journal_entries(reference_type, reference_id);

CREATE INDEX idx_gje_source_date ON general_journal_entries(entry_source, entry_date);

CREATE INDEX idx_gjl_account ON general_journal_lines(account_id);

CREATE INDEX idx_gjl_entry ON general_journal_lines(journal_entry_id);

CREATE INDEX idx_invoice_sequences_store_prefix
  ON invoice_sequences(store_id, prefix);

CREATE INDEX idx_loyalty_transactions_client_txn ON loyalty_transactions(client_txn_id);

CREATE INDEX idx_products_barcode ON products(barcode);

CREATE INDEX idx_products_category ON products(category_id);

CREATE INDEX idx_products_deleted              ON products(deleted_at);

CREATE INDEX idx_products_sku ON products(sku);

CREATE INDEX idx_products_sync ON products(updated_at, deleted_at);

CREATE INDEX idx_products_updated              ON products(updated_at);

CREATE INDEX idx_purchase_payments_purchase ON purchase_payments(purchase_id);

CREATE INDEX idx_purchase_payments_supplier ON purchase_payments(supplier_id);

CREATE INDEX idx_purchase_payments_supplier_date
  ON purchase_payments(supplier_id, paid_at);

CREATE INDEX idx_purchases_client_txn          ON purchases(client_txn_id);

CREATE INDEX idx_purchases_payment_method ON purchases(payment_method);

CREATE INDEX idx_registers_store ON registers(store_id);

CREATE INDEX idx_sale_items_sale ON sale_items(sale_id);

CREATE INDEX idx_sale_payments_sale            ON sale_payments(sale_id);

CREATE INDEX idx_sale_payments_sale_id ON sale_payments(sale_id);

CREATE INDEX idx_sale_payments_txn ON sale_payments(client_txn_id);

CREATE INDEX idx_sales_client_txn              ON sales(client_txn_id);

CREATE INDEX idx_sales_created ON sales(created_at);

CREATE INDEX idx_sales_customer ON sales(customer_id);

CREATE INDEX idx_sales_sync ON sales(updated_at, deleted_at);

CREATE INDEX idx_sales_updated                 ON sales(updated_at);

CREATE INDEX idx_sku_sequences_updated ON sku_sequences(updated_at);

CREATE INDEX idx_stock_levels_product ON stock_levels(product_id);

CREATE INDEX idx_stock_levels_warehouse ON stock_levels(warehouse_id);

CREATE INDEX idx_stock_movements_client_txn    ON stock_movements(client_txn_id);

CREATE INDEX idx_stock_movements_product_wh_deleted ON stock_movements(product_id, warehouse_id, deleted_at);

CREATE INDEX idx_stock_movements_user ON stock_movements(user_id);

CREATE INDEX idx_stock_movements_warehouse ON stock_movements(warehouse_id);

CREATE INDEX idx_stock_product ON stock_movements(product_id);

CREATE INDEX idx_suppliers_sync ON suppliers(updated_at, deleted_at);

CREATE INDEX idx_suppliers_updated             ON suppliers(updated_at);

CREATE INDEX idx_sync_metadata_device          ON sync_metadata(device_id, entity_type);

CREATE INDEX idx_sync_queue_client_txn         ON sync_queue(client_txn_id);

CREATE INDEX idx_sync_queue_entity
  ON sync_queue(entity_type, entity_id, status);

CREATE INDEX idx_sync_queue_pending_created
  ON sync_queue(status, created_at, id);

CREATE INDEX idx_sync_queue_status             ON sync_queue(status);

CREATE INDEX idx_sync_status ON sync_queue(status);

CREATE UNIQUE INDEX uq_cash_movements_client_txn
  ON cash_movements(client_txn_id) WHERE client_txn_id IS NOT NULL;

CREATE UNIQUE INDEX uq_cash_sessions_client_txn
  ON cash_sessions(client_txn_id)
  WHERE client_txn_id IS NOT NULL;

CREATE UNIQUE INDEX uq_categories_sku_code ON categories(sku_code) WHERE sku_code IS NOT NULL;

CREATE UNIQUE INDEX uq_expenses_client_txn
  ON expenses(client_txn_id) WHERE client_txn_id IS NOT NULL;

CREATE UNIQUE INDEX uq_loyalty_transactions_client_txn
  ON loyalty_transactions(client_txn_id) WHERE client_txn_id IS NOT NULL;

CREATE UNIQUE INDEX uq_purchases_client_txn
  ON purchases(client_txn_id) WHERE client_txn_id IS NOT NULL;

CREATE UNIQUE INDEX uq_sale_payments_client_txn ON sale_payments(client_txn_id) WHERE client_txn_id IS NOT NULL;

CREATE UNIQUE INDEX uq_sale_returns_client_txn
  ON sale_returns(client_txn_id) WHERE client_txn_id IS NOT NULL;

CREATE UNIQUE INDEX uq_stock_movements_client_txn
  ON stock_movements(client_txn_id) WHERE client_txn_id IS NOT NULL;

CREATE UNIQUE INDEX uq_sync_queue_client_txn
  ON sync_queue(client_txn_id)
  WHERE client_txn_id IS NOT NULL;

CREATE TRIGGER prevent_multiple_open_cash_sessions_insert
BEFORE INSERT ON cash_sessions
FOR EACH ROW
WHEN COALESCE(NEW.status, 'OPEN') = 'OPEN'
  AND NEW.deleted_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM cash_sessions cs
    WHERE cs.status = 'OPEN'
      AND cs.deleted_at IS NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'هناك خزنة مفتوحة بالفعل. أغلق الخزنة الحالية أولاً.');
END;

CREATE TRIGGER prevent_multiple_open_cash_sessions_update
BEFORE UPDATE OF status, deleted_at ON cash_sessions
FOR EACH ROW
WHEN NEW.status = 'OPEN'
  AND NEW.deleted_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM cash_sessions cs
    WHERE cs.id <> NEW.id
      AND cs.status = 'OPEN'
      AND cs.deleted_at IS NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'هناك خزنة مفتوحة بالفعل. لا يمكن فتح خزنة أخرى.');
END;

CREATE TRIGGER prevent_negative_cash_closing
BEFORE UPDATE OF closing_balance, expected_cash ON cash_sessions
WHEN COALESCE(NEW.closing_balance, 0) < 0 OR COALESCE(NEW.expected_cash, 0) < 0
BEGIN
  SELECT RAISE(ABORT, 'رصيد الخزنة لا يمكن أن يكون بالسالب');
END;

CREATE TRIGGER prevent_negative_cash_movement
BEFORE INSERT ON cash_movements
WHEN NEW.type IN ('CASH_OUT', 'EXPENSE', 'REFUND')
BEGIN
  SELECT RAISE(ABORT, 'رصيد الخزنة لا يمكن أن يكون بالسالب')
  WHERE ROUND(
    COALESCE((SELECT opening_balance FROM cash_sessions WHERE id = NEW.session_id), 0)
    + COALESCE((
      SELECT SUM(
        CASE
          WHEN type IN ('SALE', 'CASH_IN') THEN ABS(COALESCE(amount, 0))
          WHEN type IN ('CASH_OUT', 'EXPENSE', 'REFUND') THEN -ABS(COALESCE(amount, 0))
          ELSE 0
        END
      )
      FROM cash_movements
      WHERE session_id = NEW.session_id
        AND deleted_at IS NULL
    ), 0)
    - ABS(COALESCE(NEW.amount, 0)), 2
  ) < 0;
END;

CREATE TRIGGER prevent_negative_cash_opening
BEFORE INSERT ON cash_sessions
WHEN COALESCE(NEW.opening_balance, 0) < 0
BEGIN
  SELECT RAISE(ABORT, 'رصيد الخزنة لا يمكن أن يكون بالسالب');
END;

CREATE TRIGGER prevent_negative_cash_opening_update
BEFORE UPDATE OF opening_balance ON cash_sessions
WHEN COALESCE(NEW.opening_balance, 0) < 0
BEGIN
  SELECT RAISE(ABORT, 'رصيد الخزنة لا يمكن أن يكون بالسالب');
END;

CREATE TRIGGER prevent_negative_inventory_insert
BEFORE INSERT ON stock_movements
FOR EACH ROW
WHEN EXISTS (SELECT 1 FROM products p WHERE p.id=NEW.product_id AND COALESCE(p.allow_negative_stock,0) NOT IN (1,'true'))
BEGIN
  SELECT RAISE(ABORT, 'رصيد المخزون لا يمكن أن يصبح بالسالب')
  WHERE COALESCE((SELECT SUM(sm.quantity) FROM stock_movements sm WHERE sm.product_id=NEW.product_id AND sm.deleted_at IS NULL),0)
        + CASE WHEN NEW.deleted_at IS NULL THEN COALESCE(NEW.quantity,0) ELSE 0 END < 0;
END;

CREATE TRIGGER prevent_negative_inventory_update
BEFORE UPDATE OF product_id, quantity, deleted_at ON stock_movements
FOR EACH ROW
WHEN EXISTS (SELECT 1 FROM products p WHERE p.id=NEW.product_id AND COALESCE(p.allow_negative_stock,0) NOT IN (1,'true'))
BEGIN
  SELECT RAISE(ABORT, 'رصيد المخزون لا يمكن أن يصبح بالسالب')
  WHERE COALESCE((SELECT SUM(sm.quantity) FROM stock_movements sm WHERE sm.product_id=NEW.product_id AND sm.id != OLD.id AND sm.deleted_at IS NULL),0)
        + CASE WHEN NEW.deleted_at IS NULL THEN COALESCE(NEW.quantity,0) ELSE 0 END < 0;
END;

CREATE TRIGGER trg_cash_closing_requires_closed_session
BEFORE INSERT ON cash_movements
FOR EACH ROW
WHEN NEW.type = 'CLOSING'
  AND NOT EXISTS (
    SELECT 1 FROM cash_sessions cs
    WHERE cs.id = NEW.session_id
      AND cs.status = 'CLOSED'
      AND cs.deleted_at IS NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'لا يمكن تسجيل حركة إغلاق قبل إغلاق الخزنة');
END;

CREATE TRIGGER trg_cash_closing_requires_closed_session_update
BEFORE UPDATE OF type, session_id ON cash_movements
FOR EACH ROW
WHEN NEW.type = 'CLOSING'
  AND NOT EXISTS (
    SELECT 1 FROM cash_sessions cs
    WHERE cs.id = NEW.session_id
      AND cs.status = 'CLOSED'
      AND cs.deleted_at IS NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'لا يمكن تحويل حركة إلى إغلاق قبل إغلاق الخزنة');
END;

CREATE TRIGGER trg_cash_movement_positive_insert
BEFORE INSERT ON cash_movements
FOR EACH ROW
WHEN COALESCE(NEW.amount, 0) < 0
  OR (NEW.type NOT IN ('OPENING', 'CLOSING') AND COALESCE(NEW.amount, 0) <= 0)
BEGIN
  SELECT RAISE(ABORT, 'قيمة حركة الخزنة يجب أن تكون موجبة، والصفر مسموح فقط للافتتاح والإغلاق');
END;

CREATE TRIGGER trg_cash_movement_positive_update
BEFORE UPDATE OF amount, type ON cash_movements
FOR EACH ROW
WHEN COALESCE(NEW.amount, 0) < 0
  OR (NEW.type NOT IN ('OPENING', 'CLOSING') AND COALESCE(NEW.amount, 0) <= 0)
BEGIN
  SELECT RAISE(ABORT, 'قيمة حركة الخزنة يجب أن تكون موجبة، والصفر مسموح فقط للافتتاح والإغلاق');
END;

CREATE TRIGGER trg_journal_line_nonnegative_insert
BEFORE INSERT ON general_journal_lines
FOR EACH ROW
WHEN COALESCE(NEW.debit,0) < 0 OR COALESCE(NEW.credit,0) < 0
     OR (COALESCE(NEW.debit,0) > 0 AND COALESCE(NEW.credit,0) > 0)
BEGIN
  SELECT RAISE(ABORT, 'سطر القيد المحاسبي يجب أن يحتوي على مدين أو دائن موجب فقط');
END;

CREATE TRIGGER trg_journal_line_nonnegative_update
BEFORE UPDATE OF debit, credit ON general_journal_lines
FOR EACH ROW
WHEN COALESCE(NEW.debit,0) < 0 OR COALESCE(NEW.credit,0) < 0
     OR (COALESCE(NEW.debit,0) > 0 AND COALESCE(NEW.credit,0) > 0)
BEGIN
  SELECT RAISE(ABORT, 'سطر القيد المحاسبي يجب أن يحتوي على مدين أو دائن موجب فقط');
END;

CREATE TRIGGER trg_loyalty_account_nonnegative
BEFORE UPDATE OF points, total_redeemed ON loyalty_accounts
FOR EACH ROW
WHEN COALESCE(NEW.points, 0) < 0 OR COALESCE(NEW.total_redeemed, 0) < 0
BEGIN
  SELECT RAISE(ABORT, 'رصيد نقاط الولاء لا يمكن أن يكون سالبًا');
END;

CREATE TRIGGER trg_purchase_payment_valid_insert
BEFORE INSERT ON purchase_payments FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'قيمة سداد المورد يجب أن تكون أكبر من صفر') WHERE COALESCE(NEW.amount,0) <= 0;
  SELECT RAISE(ABORT, 'سداد المورد أكبر من المتبقي على الفاتورة')
   WHERE (SELECT COALESCE(NEW.amount,0) + COALESCE(p.paid_amount,0) FROM purchases p WHERE p.id=NEW.purchase_id)
         > (SELECT COALESCE(p.total,0)+0.01 FROM purchases p WHERE p.id=NEW.purchase_id);
END;

CREATE TRIGGER trg_sale_payment_nonnegative
BEFORE INSERT ON sale_payments FOR EACH ROW
WHEN COALESCE(NEW.amount,0) <= 0
BEGIN
  SELECT RAISE(ABORT, 'قيمة دفعة البيع يجب أن تكون أكبر من صفر');
END;

CREATE TRIGGER trg_stockmovement_recalculate_product
AFTER INSERT ON stock_movements FOR EACH ROW
BEGIN
  UPDATE products SET current_stock=(SELECT COALESCE(SUM(quantity),0) FROM stock_movements WHERE product_id=NEW.product_id AND deleted_at IS NULL) WHERE id=NEW.product_id;
END;

CREATE TRIGGER trg_stockmovement_recalculate_product_update
AFTER UPDATE OF quantity, deleted_at ON stock_movements FOR EACH ROW
BEGIN
  UPDATE products SET current_stock=(SELECT COALESCE(SUM(quantity),0) FROM stock_movements WHERE product_id=NEW.product_id AND deleted_at IS NULL) WHERE id=NEW.product_id;
  UPDATE products SET current_stock=(SELECT COALESCE(SUM(quantity),0) FROM stock_movements WHERE product_id=OLD.product_id AND deleted_at IS NULL) WHERE id=OLD.product_id AND OLD.product_id != NEW.product_id;
END;

CREATE TRIGGER trg_stockmovement_upsert_stock_level_delete
AFTER DELETE ON stock_movements
FOR EACH ROW
BEGIN
  INSERT INTO stock_levels (id, product_id, warehouse_id, quantity, updated_at)
  SELECT OLD.product_id || ':' || OLD.warehouse_id, OLD.product_id, OLD.warehouse_id,
         COALESCE((SELECT SUM(quantity) FROM stock_movements WHERE product_id=OLD.product_id AND warehouse_id=OLD.warehouse_id AND deleted_at IS NULL),0),
         strftime('%Y-%m-%dT%H:%M:%fZ','now')
  ON CONFLICT(product_id, warehouse_id) DO UPDATE SET quantity=excluded.quantity, updated_at=excluded.updated_at;
END;

CREATE TRIGGER trg_stockmovement_upsert_stock_level_insert
AFTER INSERT ON stock_movements
FOR EACH ROW
BEGIN
  INSERT INTO stock_levels (id, product_id, warehouse_id, quantity, updated_at)
  VALUES (NEW.product_id || ':' || NEW.warehouse_id, NEW.product_id, NEW.warehouse_id,
          COALESCE((SELECT SUM(quantity) FROM stock_movements WHERE product_id=NEW.product_id AND warehouse_id=NEW.warehouse_id AND deleted_at IS NULL),0),
          strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  ON CONFLICT(product_id, warehouse_id) DO UPDATE SET
    quantity = excluded.quantity,
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER trg_stockmovement_upsert_stock_level_update
AFTER UPDATE OF product_id, warehouse_id, quantity, deleted_at ON stock_movements
FOR EACH ROW
BEGIN
  INSERT INTO stock_levels (id, product_id, warehouse_id, quantity, updated_at)
  VALUES (NEW.product_id || ':' || NEW.warehouse_id, NEW.product_id, NEW.warehouse_id,
          COALESCE((SELECT SUM(quantity) FROM stock_movements WHERE product_id=NEW.product_id AND warehouse_id=NEW.warehouse_id AND deleted_at IS NULL),0),
          strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  ON CONFLICT(product_id, warehouse_id) DO UPDATE SET quantity=excluded.quantity, updated_at=excluded.updated_at;
  INSERT INTO stock_levels (id, product_id, warehouse_id, quantity, updated_at)
  SELECT OLD.product_id || ':' || OLD.warehouse_id, OLD.product_id, OLD.warehouse_id,
         COALESCE((SELECT SUM(quantity) FROM stock_movements WHERE product_id=OLD.product_id AND warehouse_id=OLD.warehouse_id AND deleted_at IS NULL),0),
         strftime('%Y-%m-%dT%H:%M:%fZ','now')
  ON CONFLICT(product_id, warehouse_id) DO UPDATE SET quantity=excluded.quantity, updated_at=excluded.updated_at;
END;
