-- Floor plan (dine-in tables), table orders, staff time clock and work schedule.

CREATE TABLE dining_table (
  id TEXT PRIMARY KEY,
  area TEXT NOT NULL DEFAULT 'Trong nhà',
  name TEXT NOT NULL,
  seats INTEGER NOT NULL DEFAULT 4,
  x INTEGER NOT NULL DEFAULT 0,          -- grid column (0-based)
  y INTEGER NOT NULL DEFAULT 0,          -- grid row (0-based)
  w INTEGER NOT NULL DEFAULT 1,
  h INTEGER NOT NULL DEFAULT 1,
  shape TEXT NOT NULL DEFAULT 'square' CHECK (shape IN ('square','round','bar')),
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- A few tables to start with; add, rename or move them in Quản trị › Sơ đồ bàn.
INSERT INTO dining_table (id, area, name, seats, x, y, sort, created_at, updated_at) VALUES
  ('TBL01', 'Trong nhà', 'Bàn 1', 4, 0, 0, 1, 0, 0),
  ('TBL02', 'Trong nhà', 'Bàn 2', 4, 2, 0, 2, 0, 0),
  ('TBL03', 'Trong nhà', 'Bàn 3', 4, 4, 0, 3, 0, 0),
  ('TBL04', 'Trong nhà', 'Bàn 4', 4, 0, 2, 4, 0, 0),
  ('TBL05', 'Trong nhà', 'Bàn 5', 4, 2, 2, 5, 0, 0),
  ('TBL06', 'Trong nhà', 'Bàn 6', 4, 4, 2, 6, 0, 0);

ALTER TABLE sale_order ADD COLUMN table_id TEXT;
ALTER TABLE sale_order ADD COLUMN guests INTEGER;
ALTER TABLE sale_order ADD COLUMN prebill_at INTEGER;   -- pre-bill (tạm tính) printed; still unpaid
ALTER TABLE sale_order ADD COLUMN merged_into TEXT;     -- set on a tab merged into another (status 'void', totals 0)
CREATE INDEX idx_order_table ON sale_order(table_id, status);

-- Pay per hour (VND). Visible to the owner only.
ALTER TABLE staff ADD COLUMN hourly_rate INTEGER NOT NULL DEFAULT 0;

-- Time clock (chấm công). One row per clock-in; clock_out NULL while working.
CREATE TABLE time_entry (
  id TEXT PRIMARY KEY,
  staff_id TEXT NOT NULL,
  business_day TEXT NOT NULL,
  clock_in INTEGER NOT NULL,
  clock_out INTEGER,
  break_min INTEGER NOT NULL DEFAULT 0,
  device_id TEXT,
  source TEXT NOT NULL DEFAULT 'pos',   -- 'pos' | 'admin'
  note TEXT,
  edited_by TEXT,
  edited_at INTEGER,
  deleted_at INTEGER,                   -- soft delete so a late device push cannot bring it back
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_time_day ON time_entry(business_day);
CREATE INDEX idx_time_open ON time_entry(staff_id, clock_out);

-- Planned shifts (lịch làm). end < start means the shift ends after midnight.
CREATE TABLE work_schedule (
  id TEXT PRIMARY KEY,
  staff_id TEXT NOT NULL,
  day TEXT NOT NULL,                    -- business day
  start TEXT NOT NULL,                  -- 'HH:MM'
  end TEXT NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_schedule_day ON work_schedule(day);
