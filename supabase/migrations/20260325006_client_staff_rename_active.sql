-- Rename client_staff.active → client_staff.is_active to match technicians.is_active convention.
-- Fixes naming inconsistency introduced in migration 20260325004.

ALTER TABLE client_staff RENAME COLUMN active TO is_active;
