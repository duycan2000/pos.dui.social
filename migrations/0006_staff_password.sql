-- Owner/manager sign-in with a login (email or username) and password. Needed to register a new device;
-- day-to-day selling still uses the PIN on devices that are already registered.
ALTER TABLE staff ADD COLUMN login TEXT;
ALTER TABLE staff ADD COLUMN pw_salt TEXT;
ALTER TABLE staff ADD COLUMN pw_hash TEXT;
CREATE UNIQUE INDEX idx_staff_login ON staff(login) WHERE login IS NOT NULL;
