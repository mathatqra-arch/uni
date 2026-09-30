-- General accounting / chart of accounts for NexFlow Desktop.
CREATE TABLE IF NOT EXISTS general_accounts (
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
CREATE INDEX IF NOT EXISTS idx_ga_parent ON general_accounts(parent_id);
CREATE INDEX IF NOT EXISTS idx_ga_type ON general_accounts(account_type);

CREATE TABLE IF NOT EXISTS general_journal_entries (
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
);
CREATE INDEX IF NOT EXISTS idx_gje_date ON general_journal_entries(entry_date);
CREATE INDEX IF NOT EXISTS idx_gje_ref ON general_journal_entries(reference_type, reference_id);

CREATE TABLE IF NOT EXISTS general_journal_lines (
  id TEXT PRIMARY KEY,
  journal_entry_id TEXT NOT NULL REFERENCES general_journal_entries(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES general_accounts(id) ON DELETE RESTRICT,
  debit REAL NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit REAL NOT NULL DEFAULT 0 CHECK (credit >= 0),
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_gjl_entry ON general_journal_lines(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_gjl_account ON general_journal_lines(account_id);

INSERT OR IGNORE INTO general_accounts (id, code, name, name_ar, account_type, is_system) VALUES
('ga-cash','1000','Cash','النقدية والخزنة','ASSET','true'),
('ga-bank','1010','Bank','البنك','ASSET','true'),
('ga-inventory','1200','Inventory','المخزون','ASSET','true'),
('ga-suppliers','2000','Suppliers Payable','الموردون','LIABILITY','true'),
('ga-owner','3000','Owner Equity','رأس مال المالك','EQUITY','true'),
('ga-sales','4000','Sales Revenue','إيرادات المبيعات','REVENUE','true'),
('ga-cogs','5000','Cost of Goods Sold','تكلفة البضاعة المباعة','COGS','true'),
('ga-expenses','6000','Operating Expenses','المصروفات التشغيلية','EXPENSE','true'),
('ga-rent','6010','Rent','الإيجار','EXPENSE','true'),
('ga-utilities','6020','Utilities','الكهرباء والمياه والغاز','EXPENSE','true'),
('ga-salaries','6030','Salaries and Wages','الرواتب والأجور','EXPENSE','true'),
('ga-marketing','6040','Marketing','التسويق والإعلانات','EXPENSE','true'),
('ga-maintenance','6050','Maintenance','الصيانة','EXPENSE','true'),
('ga-transport','6060','Transportation','النقل والمواصلات','EXPENSE','true'),
('ga-bank-fees','6070','Bank and Payment Fees','رسوم البنوك والدفع الإلكتروني','EXPENSE','true'),
('ga-depreciation','6080','Depreciation','إهلاك الأصول','EXPENSE','true'),
('ga-waste','6100','Waste / Shrinkage','هالك ونواقص','EXPENSE','true'),
('ga-other-income','7000','Other Income','إيرادات أخرى','REVENUE','true'),
('ga-other-expense','7100','Other Expenses','مصروفات أخرى','EXPENSE','true');
