-- Reported recipes and dependency observations are inert metadata, never jobs.
ALTER TABLE memory_records ADD COLUMN IF NOT EXISTS revalidation JSONB;
ALTER TABLE memory_archive ADD COLUMN IF NOT EXISTS revalidation JSONB;
