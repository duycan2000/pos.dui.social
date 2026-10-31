-- Dui Social POS — P1 schema. Money = integer VND. Time = epoch ms. IDs = ULID text.

CREATE TABLE outlet (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tz_offset_min INTEGER NOT NULL DEFAULT 420,
  business_day_cutoff TEXT NOT NULL DEFAULT '05:00',
  business_type TEXT NOT NULL DEFAULT 'bar',
  vietqr_bank_bin TEXT,
  vietqr_account TEXT,
  vietqr_account_name TEXT,
  receipt_header TEXT,
  receipt_footer TEXT,
  settings_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE device (
  id TEXT PRIMARY KEY,
  outlet_id TEXT NOT NULL,
  order_prefix TEXT NOT NULL,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  last_seen_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE staff (
  id TEXT PRIMARY KEY,
  outlet_id TEXT NOT NULL,
  name TEXT NOT NULL,
  pin_salt TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','manager','staff')),
  active INTEGER NOT NULL DEFAULT 1,
  max_discount_pct INTEGER NOT NULL DEFAULT 0,
  cash_out_limit INTEGER NOT NULL DEFAULT 100000,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE staff_session (
  token_hash TEXT PRIMARY KEY,
  staff_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Menu (shared with the website)
CREATE TABLE category (
  id TEXT PRIMARY KEY,
  name_en TEXT NOT NULL,
  name_vi TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE item (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL,
  name_en TEXT NOT NULL,
  name_vi TEXT NOT NULL,
  desc_en TEXT,
  desc_vi TEXT,
  price INTEGER NOT NULL,
  image_key TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  sold_out INTEGER NOT NULL DEFAULT 0,
  show_on_web INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE item_price_history (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  old_price INTEGER NOT NULL,
  new_price INTEGER NOT NULL,
  staff_id TEXT,
  at INTEGER NOT NULL
);

CREATE TABLE modifier_group (
  id TEXT PRIMARY KEY,
  name_en TEXT NOT NULL,
  name_vi TEXT NOT NULL,
  selection TEXT NOT NULL DEFAULT 'single' CHECK (selection IN ('single','multi')),
  required INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE modifier_option (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  name_en TEXT NOT NULL,
  name_vi TEXT NOT NULL,
  price_delta INTEGER NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0,
  excludes_promo INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE item_modifier_group (
  item_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (item_id, group_id)
);

CREATE TABLE promotion (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'bogo',
  active INTEGER NOT NULL DEFAULT 1,
  start_date TEXT,
  end_date TEXT,
  days_of_week TEXT,          -- e.g. "1,2,3,4,5,6,0"; NULL = every day
  time_from TEXT,             -- "HH:MM" local; NULL = all hours
  time_to TEXT,
  rule_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE promotion_item (
  promotion_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  PRIMARY KEY (promotion_id, item_id)
);

-- Selling
CREATE TABLE drawer_session (
  id TEXT PRIMARY KEY,
  outlet_id TEXT NOT NULL,
  business_day TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  opened_by TEXT NOT NULL,
  opened_at INTEGER NOT NULL,
  opening_float INTEGER NOT NULL DEFAULT 0,
  opening_count_json TEXT,
  closed_by TEXT,
  closed_at INTEGER,
  counted_json TEXT,
  counted_total INTEGER,
  expected_total INTEGER,
  difference INTEGER,
  note TEXT,
  device_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_drawer_day ON drawer_session(business_day);

CREATE TABLE staff_shift (
  id TEXT PRIMARY KEY,
  staff_id TEXT NOT NULL,
  outlet_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  drawer_session_id TEXT,
  business_day TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE sale_order (
  id TEXT PRIMARY KEY,
  outlet_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  short_code TEXT NOT NULL,
  business_day TEXT NOT NULL,
  staff_id TEXT NOT NULL,
  staff_shift_id TEXT,
  drawer_session_id TEXT,
  order_type TEXT NOT NULL DEFAULT 'takeaway',
  customer_label TEXT,
  status TEXT NOT NULL CHECK (status IN ('open','awaiting_payment','paid','void')),
  subtotal INTEGER NOT NULL DEFAULT 0,
  promo_total INTEGER NOT NULL DEFAULT 0,
  discount_total INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  cost_total INTEGER NOT NULL DEFAULT 0,
  stock_applied INTEGER NOT NULL DEFAULT 0,
  sent_at INTEGER,
  paid_at INTEGER,
  void_reason TEXT,
  voided_by TEXT,
  approved_by TEXT,
  voided_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_order_code ON sale_order(outlet_id, business_day, short_code);
CREATE INDEX idx_order_day ON sale_order(business_day);
CREATE INDEX idx_order_updated ON sale_order(updated_at);

CREATE TABLE order_line (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  item_name TEXT NOT NULL,
  unit_price INTEGER NOT NULL,
  qty INTEGER NOT NULL,
  modifiers_json TEXT NOT NULL DEFAULT '[]',
  line_total INTEGER NOT NULL,
  line_cost INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','removed')),
  removed_by TEXT,
  removed_reason TEXT,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_line_order ON order_line(order_id);

CREATE TABLE order_adjustment (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  order_line_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('promo','discount')),
  promotion_id TEXT,
  amount INTEGER NOT NULL,
  reason TEXT,
  staff_id TEXT,
  approved_by TEXT
);
CREATE INDEX idx_adj_order ON order_adjustment(order_id);

CREATE TABLE payment (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  drawer_session_id TEXT,
  method TEXT NOT NULL CHECK (method IN ('cash','vietqr','card')),
  amount INTEGER NOT NULL,
  tendered INTEGER,
  change_given INTEGER NOT NULL DEFAULT 0,
  reference TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending','confirmed','cancelled')),
  confirmed_by TEXT,
  confirmed_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_payment_order ON payment(order_id);
CREATE INDEX idx_payment_drawer ON payment(drawer_session_id);

CREATE TABLE cash_movement (
  id TEXT PRIMARY KEY,
  drawer_session_id TEXT NOT NULL,
  business_day TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  note TEXT,
  photo_key TEXT,
  purchase_id TEXT,
  staff_id TEXT NOT NULL,
  approved_by TEXT,
  device_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_cash_drawer ON cash_movement(drawer_session_id);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  outlet_id TEXT,
  device_id TEXT,
  at INTEGER NOT NULL,
  actor_id TEXT,
  approver_id TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  before_json TEXT,
  after_json TEXT,
  reason TEXT
);
CREATE INDEX idx_audit_at ON audit_log(at);

-- Inventory & recipes
CREATE TABLE supplier (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  note TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE ingredient (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'raw' CHECK (kind IN ('raw','prepared')),
  base_unit TEXT NOT NULL DEFAULT 'ml',
  purchase_unit TEXT NOT NULL DEFAULT 'chai',
  base_per_purchase REAL NOT NULL DEFAULT 1,
  yield_pct REAL NOT NULL DEFAULT 100,
  avg_cost_per_base REAL NOT NULL DEFAULT 0,
  stock_base REAL NOT NULL DEFAULT 0,
  min_stock_base REAL NOT NULL DEFAULT 0,
  recipe_yield_base REAL NOT NULL DEFAULT 1000, -- prepared only: the recipe lines make this many base units
  default_supplier_id TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- owner_type: item | modifier_option | ingredient (sub-recipe of a prepared ingredient)
CREATE TABLE recipe_line (
  id TEXT PRIMARY KEY,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('item','modifier_option','ingredient')),
  owner_id TEXT NOT NULL,
  ingredient_id TEXT NOT NULL,
  qty_base REAL NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_recipe_owner ON recipe_line(owner_type, owner_id);

CREATE TABLE purchase (
  id TEXT PRIMARY KEY,
  supplier_id TEXT,
  business_day TEXT NOT NULL,
  payment_source TEXT NOT NULL CHECK (payment_source IN ('drawer','bank','supplier_debt','owner')),
  total INTEGER NOT NULL,
  photo_key TEXT,
  note TEXT,
  cash_movement_id TEXT,
  staff_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE purchase_line (
  id TEXT PRIMARY KEY,
  purchase_id TEXT NOT NULL,
  ingredient_id TEXT NOT NULL,
  qty_purchase_units REAL NOT NULL,
  unit_price INTEGER NOT NULL,
  line_total INTEGER NOT NULL,
  qty_base REAL NOT NULL
);

CREATE TABLE stock_movement (
  id TEXT PRIMARY KEY,
  ingredient_id TEXT NOT NULL,
  qty_delta REAL NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('sale','purchase','count','waste','batch','void')),
  ref_type TEXT,
  ref_id TEXT,
  unit_cost REAL NOT NULL DEFAULT 0,
  business_day TEXT,
  at INTEGER NOT NULL
);
CREATE INDEX idx_stock_ing ON stock_movement(ingredient_id);
CREATE INDEX idx_stock_ref ON stock_movement(ref_type, ref_id);

CREATE TABLE stocktake (
  id TEXT PRIMARY KEY,
  business_day TEXT NOT NULL,
  staff_id TEXT,
  note TEXT,
  variance_value INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE stocktake_line (
  id TEXT PRIMARY KEY,
  stocktake_id TEXT NOT NULL,
  ingredient_id TEXT NOT NULL,
  counted_base REAL NOT NULL,
  theoretical_base REAL NOT NULL,
  variance_base REAL NOT NULL,
  variance_value INTEGER NOT NULL
);

-- Finance: money in/out that is not POS sales and not drawer cash movements
CREATE TABLE ledger_entry (
  id TEXT PRIMARY KEY,
  business_day TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  category TEXT NOT NULL,
  amount INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('drawer','bank','owner','supplier_debt')),
  note TEXT,
  photo_key TEXT,
  ref_type TEXT,
  ref_id TEXT,
  staff_id TEXT,
  voided INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_ledger_day ON ledger_entry(business_day);
