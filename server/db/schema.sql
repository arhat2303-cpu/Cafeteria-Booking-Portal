-- Bright Riders School – Digital Canteen Ordering & Payment Solution
-- Normalized Relational Schema (SQLite / ACID / Foreign Keys Enforced)

PRAGMA foreign_keys = ON;

-- 1. Core User Accounts (Shared Authentication System across all 4 Roles: Student, Parent, Chef, Admin)
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  role TEXT NOT NULL CHECK (role IN ('admin', 'parent', 'student', 'chef')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  permissions_json TEXT NOT NULL DEFAULT '{}',
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);

-- 2. Role Permissions Matrix
CREATE TABLE IF NOT EXISTS role_permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL CHECK (role IN ('admin', 'parent', 'student', 'chef')),
  permission_key TEXT NOT NULL,
  allowed INTEGER NOT NULL DEFAULT 1 CHECK (allowed IN (0, 1)),
  description TEXT,
  UNIQUE(role, permission_key)
);

-- 3. Active Authentication Sessions (Enables instant revocation on password reset / deactivation)
CREATE TABLE IF NOT EXISTS user_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_jti TEXT NOT NULL UNIQUE,
  ip_address TEXT,
  user_agent TEXT,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_jti ON user_sessions(token_jti);

-- 4. Parent Profiles
CREATE TABLE IF NOT EXISTS parent_profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  address TEXT,
  emergency_contact TEXT,
  preferred_payment_method TEXT DEFAULT 'digital_card',
  notifications_enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 5. Student Profiles
CREATE TABLE IF NOT EXISTS student_profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  student_code TEXT NOT NULL UNIQUE,
  class_name TEXT NOT NULL,
  section TEXT,
  house TEXT,
  allergies_notes TEXT,
  daily_spend_limit_fils INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_student_class ON student_profiles(class_name);

-- 6. Parent-Child Relationships
CREATE TABLE IF NOT EXISTS parent_student_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  student_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  relationship TEXT NOT NULL DEFAULT 'Parent',
  is_primary INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(parent_user_id, student_user_id)
);

CREATE INDEX IF NOT EXISTS idx_psl_parent ON parent_student_links(parent_user_id);
CREATE INDEX IF NOT EXISTS idx_psl_student ON parent_student_links(student_user_id);

-- 7. Chef Profiles
CREATE TABLE IF NOT EXISTS chef_profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  staff_code TEXT NOT NULL UNIQUE,
  station TEXT NOT NULL DEFAULT 'Main Canteen Kitchen',
  shift TEXT NOT NULL DEFAULT 'Morning & Lunch',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 9. Platform Settings
CREATE TABLE IF NOT EXISTS platform_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 10. Food Categories
CREATE TABLE IF NOT EXISTS food_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  icon TEXT DEFAULT 'utensils',
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 11. Menu Items (Exact prices stored in integer fils: 1 AED = 100 fils)
CREATE TABLE IF NOT EXISTS menu_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES food_categories(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  description TEXT,
  price_fils INTEGER NOT NULL CHECK (price_fils >= 0),
  image_url TEXT,
  is_available INTEGER NOT NULL DEFAULT 1 CHECK (is_available IN (0, 1)),
  is_vegetarian INTEGER NOT NULL DEFAULT 0 CHECK (is_vegetarian IN (0, 1)),
  calories INTEGER,
  allergens TEXT,
  preparation_time_mins INTEGER DEFAULT 10,
  daily_stock_limit INTEGER,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_menu_category ON menu_items(category_id);
CREATE INDEX IF NOT EXISTS idx_menu_available ON menu_items(is_available);

-- 12. Food Availability & Specific Date Schedules
CREATE TABLE IF NOT EXISTS menu_availability_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  menu_item_id INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  day_of_week INTEGER CHECK (day_of_week IS NULL OR (day_of_week >= 0 AND day_of_week <= 6)),
  specific_date TEXT,
  is_available INTEGER NOT NULL DEFAULT 1 CHECK (is_available IN (0, 1)),
  special_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_menu_sched_item ON menu_availability_schedules(menu_item_id);
CREATE INDEX IF NOT EXISTS idx_menu_sched_date ON menu_availability_schedules(specific_date);

-- 13. Persistent Backend Shopping Carts
CREATE TABLE IF NOT EXISTS shopping_carts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  beneficiary_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  order_date TEXT,
  collection_slot TEXT,
  special_instructions TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS shopping_cart_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cart_id INTEGER NOT NULL REFERENCES shopping_carts(id) ON DELETE CASCADE,
  menu_item_id INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL CHECK (quantity > 0 AND quantity <= 50),
  item_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(cart_id, menu_item_id)
);

-- 14. Orders
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number TEXT NOT NULL UNIQUE,
  placed_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  beneficiary_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  beneficiary_role TEXT NOT NULL DEFAULT 'student' CHECK (beneficiary_role IN ('student')),
  order_date TEXT NOT NULL,
  collection_slot TEXT NOT NULL,
  subtotal_fils INTEGER NOT NULL CHECK (subtotal_fils >= 0),
  total_fils INTEGER NOT NULL CHECK (total_fils >= 0),
  currency TEXT NOT NULL DEFAULT 'AED',
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded')),
  order_status TEXT NOT NULL DEFAULT 'awaiting_payment' CHECK (
    order_status IN ('awaiting_payment', 'confirmed', 'preparing', 'ready_for_collection', 'collected', 'cancelled')
  ),
  special_instructions TEXT,
  idempotency_key TEXT UNIQUE,
  cancelled_at TEXT,
  cancelled_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  cancellation_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_orders_placed_by ON orders(placed_by_user_id);
CREATE INDEX IF NOT EXISTS idx_orders_beneficiary ON orders(beneficiary_user_id);
CREATE INDEX IF NOT EXISTS idx_orders_date_slot ON orders(order_date, collection_slot);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(order_status, payment_status);

-- 15. Order Items (Historical snapshots of exact item names & prices)
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id INTEGER REFERENCES menu_items(id) ON DELETE SET NULL,
  item_name_snapshot TEXT NOT NULL,
  category_name_snapshot TEXT,
  unit_price_fils INTEGER NOT NULL CHECK (unit_price_fils >= 0),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  line_total_fils INTEGER NOT NULL CHECK (line_total_fils >= 0),
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

-- 16. Payment Transactions (Never stores raw card numbers or CVVs)
CREATE TABLE IF NOT EXISTS payment_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_ref TEXT NOT NULL UNIQUE,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL CHECK (provider IN ('stripe', 'brs_sandbox_aed')),
  provider_session_id TEXT,
  amount_fils INTEGER NOT NULL CHECK (amount_fils >= 0),
  currency TEXT NOT NULL DEFAULT 'AED',
  status TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed', 'refunded')),
  payment_method_label TEXT,
  failure_reason TEXT,
  refund_reason TEXT,
  refunded_at TEXT,
  refunded_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  idempotency_key TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_payments_order ON payment_transactions(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payment_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payment_transactions(status);

-- 17. QR Verification Tokens (Unique per paid order, zero PII in token)
CREATE TABLE IF NOT EXISTS qr_verification_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  token_uid TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL UNIQUE,
  signed_token TEXT NOT NULL,
  is_used INTEGER NOT NULL DEFAULT 0 CHECK (is_used IN (0, 1)),
  issued_at TEXT NOT NULL DEFAULT (datetime('now')),
  used_at TEXT,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_qr_token_uid ON qr_verification_tokens(token_uid);

-- 18. Collection Records (UNIQUE order_id enforces single collection at DB level)
CREATE TABLE IF NOT EXISTS collection_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
  qr_token_id INTEGER REFERENCES qr_verification_tokens(id) ON DELETE SET NULL,
  verified_by_chef_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  verification_method TEXT NOT NULL CHECK (verification_method IN ('qr_scan', 'manual_order_lookup')),
  collected_at TEXT NOT NULL DEFAULT (datetime('now')),
  notes TEXT
);

-- 19. Order Status History
CREATE TABLE IF NOT EXISTS order_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  previous_status TEXT,
  new_status TEXT NOT NULL,
  changed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_order_history_order ON order_status_history(order_id);

-- 20. Administrative Activity Logs
CREATE TABLE IF NOT EXISTS admin_activity_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  details_json TEXT,
  ip_address TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_created ON admin_activity_logs(created_at DESC);

-- 21. Uploaded Food Images (Persists binary uploads across local disk & Netlify serverless deployments)
CREATE TABLE IF NOT EXISTS uploaded_files (
  filename TEXT PRIMARY KEY,
  mime_type TEXT NOT NULL,
  data BLOB NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

