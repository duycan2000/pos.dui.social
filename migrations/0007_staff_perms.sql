-- Per-person permissions (v0.24). JSON array of permission keys from shared/perms.ts;
-- NULL = the role's defaults (manager: everything except owner-only; staff: selling only).
ALTER TABLE staff ADD COLUMN perms TEXT;
