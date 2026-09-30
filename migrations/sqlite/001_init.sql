-- ============================================================
-- LOCAL SQLite SCHEMA — preserves compatibility with the original schema
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
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
);

CREATE TABLE IF NOT EXISTS stores (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    address TEXT, phone TEXT, email TEXT,
    currency TEXT DEFAULT 'EGP',
    receipt_footer TEXT,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS warehouses (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    store_id TEXT REFERENCES stores(id),
    location TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    name_ar TEXT,
    parent_id TEXT REFERENCES categories(id),
    color TEXT, icon TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS brands (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL, name_ar TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS units (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL, short_name TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS suppliers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL, phone TEXT, email TEXT,
    address TEXT, tax_id TEXT, balance REAL DEFAULT 0,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
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
);

CREATE TABLE IF NOT EXISTS customers (
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
);

CREATE TABLE IF NOT EXISTS sales (
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
);

CREATE TABLE IF NOT EXISTS sale_items (
    id TEXT PRIMARY KEY,
    sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL REFERENCES products(id),
    quantity INTEGER NOT NULL,
    unit_price REAL NOT NULL,
    discount_amount REAL DEFAULT 0,
    tax_amount REAL DEFAULT 0,
    total REAL NOT NULL,
    cost_at_sale REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS stock_movements (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL REFERENCES products(id),
    type TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    ref_type TEXT, ref_id TEXT,
    note TEXT,
    sync_status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cash_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    opening_balance REAL DEFAULT 0,
    closing_balance REAL,
    expected_cash REAL,
    difference REAL,
    status TEXT DEFAULT 'OPEN',
    opened_at TEXT DEFAULT (datetime('now')),
    closed_at TEXT
);

CREATE TABLE IF NOT EXISTS cash_movements (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES cash_sessions(id),
    type TEXT NOT NULL,
    amount REAL NOT NULL,
    note TEXT, ref_type TEXT, ref_id TEXT,
    sync_status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY,
    category_id TEXT,
    user_id TEXT NOT NULL REFERENCES users(id),
    amount REAL NOT NULL,
    payment_method TEXT DEFAULT 'CASH',
    note TEXT,
    date TEXT DEFAULT (datetime('now')),
    sync_status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS expense_categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL, name_ar TEXT, color TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS loyalty_tiers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    display_name TEXT NOT NULL,
    min_points INTEGER DEFAULT 0,
    earning_multiplier REAL DEFAULT 1.0,
    discount_percent REAL DEFAULT 0,
    color TEXT
);

CREATE TABLE IF NOT EXISTS loyalty_accounts (
    id TEXT PRIMARY KEY,
    customer_id TEXT UNIQUE NOT NULL REFERENCES customers(id),
    points INTEGER DEFAULT 0,
    total_earned INTEGER DEFAULT 0,
    total_redeemed INTEGER DEFAULT 0,
    tier TEXT DEFAULT 'BRONZE',
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS loyalty_transactions (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES customers(id),
    type TEXT NOT NULL,
    points INTEGER NOT NULL,
    ref_type TEXT, ref_id TEXT,
    note TEXT,
    sync_status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    category TEXT DEFAULT 'general'
);

CREATE TABLE IF NOT EXISTS sync_queue (
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
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_sales_created ON sales(created_at);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_stock_product ON stock_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_sync_status ON sync_queue(status);

-- Additional tables (added v2)
CREATE TABLE IF NOT EXISTS loyalty_campaigns (
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
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    action TEXT NOT NULL,
    entity TEXT,
    entity_id TEXT,
    before TEXT,
    after TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS purchases (
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
);

CREATE TABLE IF NOT EXISTS purchase_items (
    id TEXT PRIMARY KEY,
    purchase_id TEXT NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL REFERENCES products(id),
    quantity INTEGER NOT NULL,
    unit_cost REAL NOT NULL,
    tax_rate REAL DEFAULT 0,
    total REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_adjustments (
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

CREATE TABLE IF NOT EXISTS sale_returns (
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
);

CREATE TABLE IF NOT EXISTS sale_return_items (
    id TEXT PRIMARY KEY,
    sale_return_id TEXT NOT NULL REFERENCES sale_returns(id) ON DELETE CASCADE,
    sale_item_id TEXT,
    product_id TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price REAL NOT NULL,
    total REAL NOT NULL
);
