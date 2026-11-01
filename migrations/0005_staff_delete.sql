-- Deleting a staff member who has history keeps the row (names stay on old orders, timesheets, audit log)
-- but hides it everywhere; staff without any history are removed completely.
ALTER TABLE staff ADD COLUMN deleted_at INTEGER;
