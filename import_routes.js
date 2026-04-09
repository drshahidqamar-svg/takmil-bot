// ── PASTE THESE ROUTES into index.js BEFORE the startup section ─────────────

const path = require('path');

// Serve import tool
app.get('/import', (req, res) => {
  res.sendFile(path.join(__dirname, 'import.html'));
});

// ── Bulk import: Questions ───────────────────────────────────────────────────
app.post('/admin/import/questions', async (req, res) => {
  const { rows } = req.body;
  if (!rows || !Array.isArray(rows)) return res.status(400).json({ error: 'rows array required' });

  let inserted = 0, skipped = 0, errors = 0;

  for (const row of rows) {
    try {
      // Map Excel columns to DB columns
      const questionId  = String(row.question_id || '').trim();
      const level       = parseInt(row.level) || 1;
      const subject     = String(row.subject || '').trim();
      const qText       = String(row.q_text_english || '').trim();
      const optA        = String(row.option_a || '').trim();
      const optB        = String(row.option_b || '').trim();
      const optC        = String(row.option_c || '').trim();
      const optD        = String(row.option_d || '').trim();
      const correctOpt  = String(row.correct_option || 'A').trim().toUpperCase();
      const topicTag    = String(row.topic_tag || '').trim();

      if (!questionId || !qText || !optA || !optB || !optC || !optD) {
        skipped++;
        continue;
      }

      // Use INSERT ... ON CONFLICT DO NOTHING to skip duplicates
      const result = await db.pool.query(`
        INSERT INTO questions
          (question_id, level, subject, q_text_english, option_a, option_b, option_c, option_d, correct_option, topic_tag, active, difficulty)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,1)
        ON CONFLICT (question_id) DO NOTHING
      `, [questionId, level, subject, qText, optA, optB, optC, optD, correctOpt, topicTag]);

      if (result.rowCount > 0) inserted++;
      else skipped++;

    } catch (err) {
      console.error('Question import error:', err.message, row.question_id);
      errors++;
    }
  }

  res.json({ inserted, skipped, errors });
});

// ── Bulk import: Schools ─────────────────────────────────────────────────────
app.post('/admin/import/schools', async (req, res) => {
  const { rows } = req.body;
  if (!rows || !Array.isArray(rows)) return res.status(400).json({ error: 'rows array required' });

  let inserted = 0, skipped = 0, errors = 0;

  for (const row of rows) {
    try {
      const name         = String(row.name || '').trim();
      const province     = String(row.province || '').trim();
      const district     = String(row.district || '').trim();
      const contactName  = String(row.contact_name || row.contactName || '').trim();
      const contactPhone = String(row.contact_phone || row.contactPhone || '').trim();

      if (!name) { skipped++; continue; }

      // Check for duplicate by name + district
      const exists = await db.pool.query(
        'SELECT id FROM schools WHERE name = $1 AND district = $2',
        [name, district]
      );
      if (exists.rows.length > 0) { skipped++; continue; }

      await db.pool.query(`
        INSERT INTO schools (name, province, district, contact_name, contact_phone)
        VALUES ($1,$2,$3,$4,$5)
      `, [name, province, district, contactName, contactPhone]);

      inserted++;
    } catch (err) {
      console.error('School import error:', err.message);
      errors++;
    }
  }

  res.json({ inserted, skipped, errors });
});

// ── Bulk import: Students ────────────────────────────────────────────────────
app.post('/admin/import/students', async (req, res) => {
  const { rows } = req.body;
  if (!rows || !Array.isArray(rows)) return res.status(400).json({ error: 'rows array required' });

  let inserted = 0, skipped = 0, errors = 0;

  // Ensure students table exists
  await db.pool.query(`
    CREATE TABLE IF NOT EXISTS students (
      id SERIAL PRIMARY KEY,
      school_id INTEGER REFERENCES schools(id),
      name VARCHAR(100),
      gender VARCHAR(10),
      age INTEGER,
      level INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  for (const row of rows) {
    try {
      const schoolId = parseInt(row.school_id) || null;
      const name     = String(row.name || '').trim();
      const gender   = String(row.gender || '').trim();
      const age      = parseInt(row.age) || null;
      const level    = parseInt(row.level) || 1;

      if (!name || !schoolId) { skipped++; continue; }

      await db.pool.query(`
        INSERT INTO students (school_id, name, gender, age, level)
        VALUES ($1,$2,$3,$4,$5)
      `, [schoolId, name, gender, age, level]);

      inserted++;
    } catch (err) {
      console.error('Student import error:', err.message);
      errors++;
    }
  }

  res.json({ inserted, skipped, errors });
});
