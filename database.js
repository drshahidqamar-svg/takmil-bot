const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_PUBLIC_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function initializeDatabase() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── Core questions table (already seeded) ──────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS questions (
        id SERIAL PRIMARY KEY,
        level INTEGER NOT NULL,
        subject VARCHAR(20) NOT NULL,
        question_text TEXT NOT NULL,
        option_a TEXT NOT NULL,
        option_b TEXT NOT NULL,
        option_c TEXT NOT NULL,
        option_d TEXT NOT NULL,
        correct_answer CHAR(1) NOT NULL,
        topic VARCHAR(100),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // ── Schools ────────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS schools (
        id SERIAL PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        province VARCHAR(100),
        district VARCHAR(100),
        contact_name VARCHAR(100),
        contact_phone VARCHAR(20),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // ── Teachers ───────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS teachers (
        id SERIAL PRIMARY KEY,
        phone VARCHAR(20) UNIQUE NOT NULL,
        name VARCHAR(100),
        school_id INTEGER REFERENCES schools(id),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // ── PINs (issued by Ops, locked to school+level+subject) ───────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS pins (
        id SERIAL PRIMARY KEY,
        pin VARCHAR(8) UNIQUE NOT NULL,
        school_id INTEGER REFERENCES schools(id),
        level INTEGER NOT NULL CHECK (level BETWEEN 1 AND 12),
        subject VARCHAR(20) NOT NULL CHECK (subject IN ('Math', 'English', 'Urdu')),
        cohort_size INTEGER DEFAULT 0,
        issued_by VARCHAR(50),
        created_at TIMESTAMP DEFAULT NOW(),
        expires_at TIMESTAMP NOT NULL,
        activated_at TIMESTAMP,
        invalidated_at TIMESTAMP,
        is_active BOOLEAN DEFAULT TRUE
      )
    `);

    // ── Sessions (one per teacher phone, tracks current assessment state) ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id SERIAL PRIMARY KEY,
        phone VARCHAR(20) UNIQUE NOT NULL,
        pin_id INTEGER REFERENCES pins(id),
        school_id INTEGER REFERENCES schools(id),
        level INTEGER,
        subject VARCHAR(20),
        state VARCHAR(30) NOT NULL DEFAULT 'AWAITING_PIN',
        question_ids INTEGER[] DEFAULT '{}',
        current_index INTEGER DEFAULT 0,
        answers JSONB DEFAULT '[]',
        score INTEGER DEFAULT 0,
        started_at TIMESTAMP,
        completed_at TIMESTAMP,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // ── Assessments (completed assessment records) ─────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS assessments (
        id SERIAL PRIMARY KEY,
        pin_id INTEGER REFERENCES pins(id),
        school_id INTEGER REFERENCES schools(id),
        teacher_phone VARCHAR(20) NOT NULL,
        level INTEGER NOT NULL,
        subject VARCHAR(20) NOT NULL,
        total_questions INTEGER NOT NULL,
        correct_answers INTEGER NOT NULL,
        score_pct NUMERIC(5,2) NOT NULL,
        passed BOOLEAN NOT NULL,
        answers_detail JSONB,
        completed_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // ── Advancement requests (sent to Ops when cohort hits 80%) ───────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS advancement_requests (
        id SERIAL PRIMARY KEY,
        assessment_id INTEGER REFERENCES assessments(id),
        pin_id INTEGER REFERENCES pins(id),
        school_id INTEGER REFERENCES schools(id),
        level INTEGER NOT NULL,
        subject VARCHAR(20) NOT NULL,
        score_pct NUMERIC(5,2) NOT NULL,
        status VARCHAR(20) DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
        approved_by VARCHAR(20),
        approved_at TIMESTAMP,
        rejection_reason TEXT,
        ops_notified_at TIMESTAMP DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // ── Re-assessment schedule ─────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS reassessment_schedule (
        id SERIAL PRIMARY KEY,
        school_id INTEGER REFERENCES schools(id),
        level INTEGER NOT NULL,
        subject VARCHAR(20) NOT NULL,
        scheduled_date DATE NOT NULL,
        reason TEXT,
        triggered_by_assessment INTEGER REFERENCES assessments(id),
        completed BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // ── Ops team registry ──────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS ops_team (
        id SERIAL PRIMARY KEY,
        phone VARCHAR(20) UNIQUE NOT NULL,
        name VARCHAR(100) NOT NULL,
        role VARCHAR(50) DEFAULT 'ops',
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query('COMMIT');
    console.log('✅ Database schema initialized');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Database init failed:', err);
    throw err;
  } finally {
    client.release();
  }
}

// ── PIN queries ──────────────────────────────────────────────────────────────

async function validatePin(pin) {
  const result = await pool.query(`
    SELECT p.*, s.name AS school_name, s.province, s.district
    FROM pins p
    JOIN schools s ON s.id = p.school_id
    WHERE p.pin = $1
      AND p.is_active = TRUE
      AND p.expires_at > NOW()
      AND p.invalidated_at IS NULL
  `, [pin.toUpperCase()]);
  return result.rows[0] || null;
}

async function activatePin(pinId) {
  await pool.query(`
    UPDATE pins SET activated_at = NOW() WHERE id = $1 AND activated_at IS NULL
  `, [pinId]);
}

async function generatePin(schoolId, level, subject, cohortSize, issuedBy) {
  const pin = generatePinCode();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
  const result = await pool.query(`
    INSERT INTO pins (pin, school_id, level, subject, cohort_size, issued_by, expires_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *
  `, [pin, schoolId, level, subject, cohortSize, issuedBy, expiresAt]);
  return result.rows[0];
}

function generatePinCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
  let pin = '';
  for (let i = 0; i < 6; i++) pin += chars[Math.floor(Math.random() * chars.length)];
  return pin;
}

// ── Session queries ──────────────────────────────────────────────────────────

async function getSession(phone) {
  const result = await pool.query(
    'SELECT * FROM sessions WHERE phone = $1', [phone]
  );
  return result.rows[0] || null;
}

async function upsertSession(phone, data) {
  const existing = await getSession(phone);
  if (existing) {
    const fields = Object.keys(data);
    const setClauses = fields.map((f, i) => `${f} = $${i + 2}`).join(', ');
    await pool.query(
      `UPDATE sessions SET ${setClauses}, updated_at = NOW() WHERE phone = $1`,
      [phone, ...fields.map(f => data[f])]
    );
  } else {
    const fields = ['phone', ...Object.keys(data)];
    const values = [phone, ...Object.values(data)];
    const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
    await pool.query(
      `INSERT INTO sessions (${fields.join(', ')}) VALUES (${placeholders})`,
      values
    );
  }
  return getSession(phone);
}

async function clearSession(phone) {
  await pool.query(`
    UPDATE sessions SET
      state = 'AWAITING_PIN', pin_id = NULL, school_id = NULL,
      level = NULL, subject = NULL, question_ids = '{}',
      current_index = 0, answers = '[]', score = 0,
      started_at = NULL, completed_at = NULL, updated_at = NOW()
    WHERE phone = $1
  `, [phone]);
}

// ── Question queries ─────────────────────────────────────────────────────────

async function getRandomQuestions(level, subject, count = 10) {
  const result = await pool.query(`
    SELECT id, question_text, option_a, option_b, option_c, option_d, correct_answer, topic
    FROM questions
    WHERE level = $1 AND subject = $2
    ORDER BY RANDOM()
    LIMIT $3
  `, [level, subject, count]);
  return result.rows;
}

async function getQuestionById(id) {
  const result = await pool.query('SELECT * FROM questions WHERE id = $1', [id]);
  return result.rows[0] || null;
}

// ── Assessment queries ───────────────────────────────────────────────────────

async function saveAssessment(data) {
  const result = await pool.query(`
    INSERT INTO assessments
      (pin_id, school_id, teacher_phone, level, subject, total_questions,
       correct_answers, score_pct, passed, answers_detail)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    RETURNING *
  `, [
    data.pinId, data.schoolId, data.teacherPhone, data.level, data.subject,
    data.totalQuestions, data.correctAnswers, data.scorePct, data.passed,
    JSON.stringify(data.answersDetail)
  ]);
  return result.rows[0];
}

// ── Advancement request queries ──────────────────────────────────────────────

async function createAdvancementRequest(data) {
  const result = await pool.query(`
    INSERT INTO advancement_requests
      (assessment_id, pin_id, school_id, level, subject, score_pct)
    VALUES ($1,$2,$3,$4,$5,$6)
    RETURNING *
  `, [data.assessmentId, data.pinId, data.schoolId, data.level, data.subject, data.scorePct]);
  return result.rows[0];
}

async function getAdvancementRequest(id) {
  const result = await pool.query(`
    SELECT ar.*, s.name AS school_name, s.province
    FROM advancement_requests ar
    JOIN schools s ON s.id = ar.school_id
    WHERE ar.id = $1
  `, [id]);
  return result.rows[0] || null;
}

async function approveAdvancement(requestId, opsPhone) {
  await pool.query(`
    UPDATE advancement_requests
    SET status = 'APPROVED', approved_by = $2, approved_at = NOW()
    WHERE id = $1 AND status = 'PENDING'
  `, [requestId, opsPhone]);
  // Schedule re-assessment 7 days out for the class (optional record)
  const req = await getAdvancementRequest(requestId);
  if (req) {
    const schedDate = new Date();
    schedDate.setDate(schedDate.getDate() + 7);
    await pool.query(`
      INSERT INTO reassessment_schedule (school_id, level, subject, scheduled_date, reason)
      VALUES ($1, $2, $3, $4, 'Post-advancement 7-day check')
    `, [req.school_id, req.level + 1, req.subject, schedDate.toISOString().split('T')[0]]);
  }
}

async function rejectAdvancement(requestId, opsPhone, reason) {
  await pool.query(`
    UPDATE advancement_requests
    SET status = 'REJECTED', approved_by = $2, approved_at = NOW(), rejection_reason = $3
    WHERE id = $1 AND status = 'PENDING'
  `, [requestId, opsPhone, reason]);
}

// ── Ops team queries ─────────────────────────────────────────────────────────

async function getOpsTeam() {
  const result = await pool.query(
    'SELECT * FROM ops_team WHERE is_active = TRUE ORDER BY id'
  );
  return result.rows;
}

async function isOpsPhone(phone) {
  const result = await pool.query(
    'SELECT id FROM ops_team WHERE phone = $1 AND is_active = TRUE', [phone]
  );
  return result.rows.length > 0;
}

// ── Analytics queries ────────────────────────────────────────────────────────

async function getAnalyticsSummary() {
  const result = await pool.query(`
    SELECT
      COUNT(DISTINCT a.id) AS total_assessments,
      ROUND(AVG(a.score_pct), 1) AS avg_score,
      COUNT(DISTINCT a.school_id) AS schools_assessed,
      SUM(CASE WHEN a.passed THEN 1 ELSE 0 END) AS passed_count,
      SUM(CASE WHEN NOT a.passed THEN 1 ELSE 0 END) AS failed_count,
      COUNT(DISTINCT ar.id) FILTER (WHERE ar.status = 'APPROVED') AS advancements_approved
    FROM assessments a
    LEFT JOIN advancement_requests ar ON ar.assessment_id = a.id
  `);
  return result.rows[0];
}

module.exports = {
  pool,
  initializeDatabase,
  validatePin,
  activatePin,
  generatePin,
  getSession,
  upsertSession,
  clearSession,
  getRandomQuestions,
  getQuestionById,
  saveAssessment,
  createAdvancementRequest,
  getAdvancementRequest,
  approveAdvancement,
  rejectAdvancement,
  getOpsTeam,
  isOpsPhone,
  getAnalyticsSummary,
};
