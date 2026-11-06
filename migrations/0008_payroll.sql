-- Monthly payroll (v0.29): extra pay / deductions per person and month, payslips once paid,
-- and advances taken from the till (cash_movement reason 'advance' for a named person).
CREATE TABLE payroll_adjustment (
  id TEXT PRIMARY KEY,
  staff_id TEXT NOT NULL,
  month TEXT NOT NULL, -- YYYY-MM (business days)
  kind TEXT NOT NULL CHECK (kind IN ('allowance','bonus','advance','deduction')),
  amount INTEGER NOT NULL,
  note TEXT,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX idx_payadj_month ON payroll_adjustment(month);

CREATE TABLE payslip (
  id TEXT PRIMARY KEY,
  staff_id TEXT NOT NULL,
  month TEXT NOT NULL,
  net INTEGER NOT NULL,
  data_json TEXT NOT NULL, -- the payroll row as it was when paid
  method TEXT,
  ledger_id TEXT,
  paid_by TEXT,
  paid_at INTEGER NOT NULL,
  voided_at INTEGER
);
CREATE UNIQUE INDEX ux_payslip_live ON payslip(staff_id, month) WHERE voided_at IS NULL;

ALTER TABLE cash_movement ADD COLUMN for_staff_id TEXT;
