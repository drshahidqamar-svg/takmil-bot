-- ═══════════════════════════════════════════════════════
-- TAKMIL BOT — Video Session Tracking Tables
-- Run this in Railway PostgreSQL (copy into query editor)
-- ═══════════════════════════════════════════════════════

-- 1. SCHOOLS table (if not already exists)
CREATE TABLE IF NOT EXISTS schools (
  id           SERIAL PRIMARY KEY,
  school_code  VARCHAR(20) UNIQUE NOT NULL,  -- e.g. SCH-047
  name         VARCHAR(100),
  region       VARCHAR(50),
  coordinator_phone VARCHAR(20),
  facilitator_phone VARCHAR(20),
  current_level     INT DEFAULT 1,
  current_subject   VARCHAR(20) DEFAULT 'Math',
  created_at   TIMESTAMP DEFAULT NOW()
);

-- 2. SECTIONS table — a section = one topic block (e.g. "Multiplication")
--    Admin defines sections upfront. Each section has N required session days.
CREATE TABLE IF NOT EXISTS sections (
  id            SERIAL PRIMARY KEY,
  section_code  VARCHAR(30) UNIQUE NOT NULL,  -- e.g. SEC-L5-MATH-01
  title         VARCHAR(100) NOT NULL,         -- e.g. "Multiplication"
  level         INT NOT NULL,
  subject       VARCHAR(20) NOT NULL,
  required_days INT NOT NULL DEFAULT 22,       -- days that must be approved
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMP DEFAULT NOW()
);

-- 3. DAILY_SESSIONS — one row per school per day
CREATE TABLE IF NOT EXISTS daily_sessions (
  id             SERIAL PRIMARY KEY,
  school_code    VARCHAR(20) NOT NULL,
  section_code   VARCHAR(30) NOT NULL,
  session_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  topic          VARCHAR(100),

  -- Video 1
  v1_name        VARCHAR(200),
  v1_code        VARCHAR(10),
  v1_verified    BOOLEAN DEFAULT FALSE,
  v1_started_at  VARCHAR(20),

  -- Video 2
  v2_name        VARCHAR(200),
  v2_code        VARCHAR(10),
  v2_verified    BOOLEAN DEFAULT FALSE,
  v2_started_at  VARCHAR(20),

  -- Video 3
  v3_name        VARCHAR(200),
  v3_code        VARCHAR(10),
  v3_verified    BOOLEAN DEFAULT FALSE,
  v3_started_at  VARCHAR(20),

  -- Submission
  submitted_at   TIMESTAMP,
  submitted_by   VARCHAR(100),   -- facilitator name

  -- Approval
  status         VARCHAR(20) DEFAULT 'pending',  -- pending / approved / rejected
  approved_by    VARCHAR(20),    -- coordinator phone
  approved_at    TIMESTAMP,
  reject_reason  VARCHAR(200),

  UNIQUE(school_code, session_date)
);

-- 4. SECTION_COMPLETIONS — unlocks assessment when all days approved
CREATE TABLE IF NOT EXISTS section_completions (
  id              SERIAL PRIMARY KEY,
  school_code     VARCHAR(20) NOT NULL,
  section_code    VARCHAR(30) NOT NULL,
  total_days      INT NOT NULL,
  approved_days   INT DEFAULT 0,
  status          VARCHAR(20) DEFAULT 'in_progress',  -- in_progress / complete / assessment_unlocked
  completed_at    TIMESTAMP,
  assessment_pin  VARCHAR(10),
  pin_sent_at     TIMESTAMP,
  UNIQUE(school_code, section_code)
);

-- 5. USER_ROLES — maps phone numbers to roles (for testing: one phone, multiple roles)
CREATE TABLE IF NOT EXISTS user_roles (
  id           SERIAL PRIMARY KEY,
  phone        VARCHAR(20) NOT NULL,
  role         VARCHAR(20) NOT NULL,   -- facilitator / coordinator / regional / admin
  entity_code  VARCHAR(30),            -- school code, coordinator ID, region, or 'HQ'
  name         VARCHAR(100),
  active_role  VARCHAR(20),            -- currently acting role (for multi-role testers)
  updated_at   TIMESTAMP DEFAULT NOW(),
  UNIQUE(phone, role, entity_code)
);

-- ═══════════════════════════════════════════════════
-- SEED DATA — insert test school, section, and roles
-- ═══════════════════════════════════════════════════

-- Test school
INSERT INTO schools (school_code, name, region, facilitator_phone, coordinator_phone, current_level, current_subject)
VALUES ('SCH-047', 'TAKMIL Test School', 'Region-A', 'whatsapp:+16024305897', 'whatsapp:+16024305897', 5, 'Math')
ON CONFLICT (school_code) DO NOTHING;

-- Test section
INSERT INTO sections (section_code, title, level, subject, required_days)
VALUES ('SEC-L5-MATH-01', 'Multiplication', 5, 'Math', 5)
ON CONFLICT (section_code) DO NOTHING;

-- Section completion tracker
INSERT INTO section_completions (school_code, section_code, total_days, approved_days, status)
VALUES ('SCH-047', 'SEC-L5-MATH-01', 5, 0, 'in_progress')
ON CONFLICT (school_code, section_code) DO NOTHING;

-- Register test phone as ALL roles (for Shahid's testing)
INSERT INTO user_roles (phone, role, entity_code, name, active_role)
VALUES
  ('whatsapp:+16024305897', 'facilitator',  'SCH-047',        'Shahid (Facilitator)',   'facilitator'),
  ('whatsapp:+16024305897', 'coordinator',  'COORD-01',       'Shahid (Coordinator)',   'facilitator'),
  ('whatsapp:+16024305897', 'regional',     'Region-A',       'Shahid (Regional)',      'facilitator'),
  ('whatsapp:+16024305897', 'admin',        'HQ',             'Shahid (Admin)',         'facilitator')
ON CONFLICT (phone, role, entity_code) DO NOTHING;
