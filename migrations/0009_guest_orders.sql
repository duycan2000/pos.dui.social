-- QR menu at the table (v0.30): each table's QR carries a secret token; guests' orders wait for staff to accept.
ALTER TABLE dining_table ADD COLUMN qr_token TEXT;
CREATE UNIQUE INDEX ux_table_qr ON dining_table(qr_token) WHERE qr_token IS NOT NULL;

CREATE TABLE guest_order (
  id TEXT PRIMARY KEY,
  table_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'order' CHECK (kind IN ('order','call','bill')),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','accepted','rejected')),
  lines_json TEXT NOT NULL DEFAULT '[]', -- [{item_id, name, qty, option_ids, options, unit_price, note}]
  total INTEGER NOT NULL DEFAULT 0,
  guest_name TEXT,
  note TEXT,
  lang TEXT,
  ip_hash TEXT,
  order_id TEXT,
  reason TEXT,
  handled_by TEXT,
  handled_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_guest_order_status ON guest_order(status, created_at);
CREATE INDEX idx_guest_order_table ON guest_order(table_id, created_at);
