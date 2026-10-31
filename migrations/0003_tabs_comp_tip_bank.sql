-- Comp drinks (ly mời), tips, open tabs and bank-transfer auto-confirmation.

ALTER TABLE order_line ADD COLUMN comp INTEGER NOT NULL DEFAULT 0;
ALTER TABLE order_line ADD COLUMN comp_reason TEXT;
ALTER TABLE order_line ADD COLUMN comp_by TEXT;
ALTER TABLE order_line ADD COLUMN sent_at INTEGER;

ALTER TABLE sale_order ADD COLUMN comp_total INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sale_order ADD COLUMN tip_total INTEGER NOT NULL DEFAULT 0;

ALTER TABLE payment ADD COLUMN tip INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payment ADD COLUMN bank_txn_id TEXT;

CREATE INDEX idx_order_status ON sale_order(status);

-- Incoming bank transfers from SePay / Casso webhooks.
CREATE TABLE bank_txn (
  id TEXT PRIMARY KEY,              -- '<provider>:<provider id>' — dedup key
  provider TEXT NOT NULL,
  amount INTEGER NOT NULL,
  content TEXT,
  account TEXT,
  bank TEXT,
  reference TEXT,
  txn_at TEXT,
  code TEXT,                        -- parsed short order code, e.g. 'A-012'
  status TEXT NOT NULL DEFAULT 'unmatched' CHECK (status IN ('unmatched','claimed','matched','ignored')),
  order_id TEXT,
  note TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_bank_code ON bank_txn(code, status);
CREATE INDEX idx_bank_created ON bank_txn(created_at);
