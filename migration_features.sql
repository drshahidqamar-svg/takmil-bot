-- ════════════════════════════════════════════════════════════════════════════
--  TAKMIL — Migration: 4 New Features
--  Run once in Railway PostgreSQL console
--
--  Feature 1: submission_mode (online/offline tracking)
--  Feature 2: Future date — no schema change needed (enforced in code)
--  Feature 3: school_pin — secure login per school
--  Feature 4: GPS columns — lat, lng, accuracy, distance from school
-- ════════════════════════════════════════════════════════════════════════════

-- ── Feature 1: Track online vs offline submissions ────────────────────────────
ALTER TABLE daily_feedback
  ADD COLUMN IF NOT EXISTS submission_mode TEXT DEFAULT 'unknown';
-- Values: 'online' | 'offline' | 'unknown'
-- 'offline' = submitted while no internet, synced later

-- ── Feature 3: PIN per school ─────────────────────────────────────────────────
ALTER TABLE schools
  ADD COLUMN IF NOT EXISTS school_pin VARCHAR(4);
-- 4-digit PIN set by admin, teacher must enter it after phone verification.
-- If NULL: first teacher to log in sets the PIN automatically.

-- ── Feature 4: GPS coordinates captured at submission ─────────────────────────
ALTER TABLE daily_feedback
  ADD COLUMN IF NOT EXISTS gps_lat         NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS gps_lng         NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS gps_accuracy_m  INTEGER,
  ADD COLUMN IF NOT EXISTS gps_distance_m  INTEGER;
-- gps_lat / gps_lng: where the teacher was when they submitted
-- gps_accuracy_m: GPS accuracy in metres (lower = more precise)
-- gps_distance_m: calculated distance from school (populated by trigger below)

-- Optional: add school coordinates if not already present
ALTER TABLE schools
  ADD COLUMN IF NOT EXISTS latitude  NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS longitude NUMERIC(10,7);

-- ── Useful index for filtering by submission mode ─────────────────────────────
CREATE INDEX IF NOT EXISTS idx_df_submission_mode
  ON daily_feedback (submission_mode);

CREATE INDEX IF NOT EXISTS idx_df_gps
  ON daily_feedback (gps_lat, gps_lng)
  WHERE gps_lat IS NOT NULL;

-- ════════════════════════════════════════════════════════════════════════════
--  ADMIN QUERIES — use these to manage PINs and school locations
-- ════════════════════════════════════════════════════════════════════════════

-- Set a PIN for a school:
-- UPDATE schools SET school_pin = '1234' WHERE identifier = 'SchoolIdentifierHere';

-- Set school GPS coordinates (needed for distance check):
-- UPDATE schools SET latitude = 24.8607, longitude = 67.0011 WHERE identifier = 'SchoolIdentifierHere';

-- View all schools with/without PIN:
-- SELECT name, identifier, teacher_phone, school_pin,
--        CASE WHEN school_pin IS NULL THEN '❌ No PIN' ELSE '✅ PIN set' END AS pin_status
-- FROM schools ORDER BY region, name;

-- ════════════════════════════════════════════════════════════════════════════
--  DASHBOARD QUERIES — use these in feedback-table to show new data
-- ════════════════════════════════════════════════════════════════════════════

-- See online vs offline breakdown:
SELECT
  submission_mode,
  COUNT(*)                                    AS total,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 1) AS pct
FROM daily_feedback
WHERE report_date >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY submission_mode;

-- Flag submissions that came from far away (> 500m from school):
SELECT
  f.school_name,
  f.report_date,
  f.teacher_phone,
  f.gps_lat,
  f.gps_lng,
  f.gps_distance_m,
  f.submission_mode
FROM daily_feedback f
WHERE f.gps_distance_m > 500
  AND f.report_date >= CURRENT_DATE - INTERVAL '7 days'
ORDER BY f.gps_distance_m DESC;

-- All offline submissions from last 7 days:
SELECT school_name, report_date, present, submission_mode, created_at
FROM daily_feedback
WHERE submission_mode = 'offline'
  AND report_date >= CURRENT_DATE - INTERVAL '7 days'
ORDER BY created_at DESC;
