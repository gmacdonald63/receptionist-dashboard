-- end_time is not always known for call-sourced appointments
ALTER TABLE appointments
  ALTER COLUMN end_time DROP NOT NULL;
