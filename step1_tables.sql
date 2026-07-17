CREATE TABLE IF NOT EXISTS regional_coordinators (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  region TEXT NOT NULL,
  phone TEXT DEFAULT '',
  password TEXT DEFAULT 'takmil123',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS school_coordinators (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  regional_coordinator_id INTEGER REFERENCES regional_coordinators(id),
  phone TEXT DEFAULT '',
  created_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE schools ADD COLUMN IF NOT EXISTS identifier TEXT;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS region TEXT;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS regional_coordinator_id INTEGER;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS school_coordinator_id INTEGER;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS teacher_phone TEXT DEFAULT '';
