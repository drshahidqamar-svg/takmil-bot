// routes/admin.js — Admin APIs & Question Bank
// Portals: /question-bank, /dashboard, /import, /bulk-assess
// APIs: /admin/questions/*, /api/questions/*, /api/generate-questions

const router = require('express').Router();
const db     = require('../database');
const path   = require('path');

// ── HTML pages ────────────────────────────────────────────────────────────────
router.get('/dashboard',     (req, res) => res.sendFile(path.join(__dirname, '../dashboard.html')));
router.get('/import',        (req, res) => res.sendFile(path.join(__dirname, '../import.html')));
router.get('/question-bank', (req, res) => res.sendFile(path.join(__dirname, '../takmil-question-bank.html')));

// ── Question Bank CRUD ────────────────────────────────────────────────────────
router.get('/admin/questions/all', async (req, res) => {
  try {
    const { level, subject, topic, video_id, status, source_type } = req.query;
    let query = `SELECT *, (active=1) AS is_approved,
      CASE WHEN active=-1 THEN 'flagged' WHEN active=1 THEN 'approved' ELSE 'pending' END AS status,
      COALESCE(q_text_english, q_text_urdu) AS question_text
      FROM questions WHERE 1=1`;
    const params = [];
    if (level)       { params.push(parseInt(level)); query += ` AND level=$${params.length}`; }
    if (subject)     { params.push(subject);         query += ` AND subject=$${params.length}`; }
    if (topic)       { params.push(topic);           query += ` AND topic_tag=$${params.length}`; }
    if (video_id)    { params.push(video_id);        query += ` AND video_id=$${params.length}`; }
    if (source_type) { params.push(source_type);     query += ` AND source_type=$${params.length}`; }
    if (status === 'approved') query += ` AND active=1`;
    if (status === 'pending')  query += ` AND (active=0 OR active IS NULL)`;
    if (status === 'flagged')  query += ` AND active=-1`;
    query += ` ORDER BY created_at DESC LIMIT 500`;
    const result = await db.pool.query(query, params);
    res.json({ questions: result.rows, count: result.rows.length });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.get('/api/questions', async (req, res) => {
  try {
    const { level, subject, topic, video_id, limit = 12 } = req.query;
    let query = `SELECT * FROM questions WHERE active=1`;
    const params = [];
    if (level)    { params.push(parseInt(level)); query += ` AND level=$${params.length}`; }
    if (subject)  { params.push(subject);         query += ` AND subject=$${params.length}`; }
    if (topic)    { params.push(topic);           query += ` AND topic_tag=$${params.length}`; }
    if (video_id) { params.push(video_id);        query += ` AND video_id=$${params.length}`; }
    params.push(parseInt(limit)); query += ` ORDER BY RANDOM() LIMIT $${params.length}`;
    const result = await db.pool.query(query, params);
    res.json({ questions: result.rows, count: result.rows.length });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.post('/admin/questions', async (req, res) => {
  try {
    const { question_id, level, subject, topic_tag, question_text, question_text_ur, option_a, option_b, option_c, option_d, correct_option, is_approved } = req.body;
    if (!question_id || !level || !subject) return res.status(400).json({ error: 'question_id, level, subject required' });
    const r = await db.pool.query(`
      INSERT INTO questions (question_id, level, subject, topic_tag, q_text_english, q_text_urdu, option_a, option_b, option_c, option_d, correct_option, active, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
      ON CONFLICT (question_id) DO UPDATE SET level=$2,subject=$3,topic_tag=$4,q_text_english=$5,q_text_urdu=$6,option_a=$7,option_b=$8,option_c=$9,option_d=$10,correct_option=$11,active=$12
      RETURNING *, (active=1) AS is_approved, COALESCE(q_text_english, q_text_urdu) AS question_text`,
      [question_id, parseInt(level), subject, topic_tag||null, question_text||null, question_text_ur||null,
       option_a, option_b, option_c, option_d, correct_option, is_approved ? 1 : 0]);
    res.json({ question: r.rows[0] });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.put('/admin/questions/:id', async (req, res) => {
  try {
    const { question_id, level, subject, topic_tag, question_text, option_a, option_b, option_c, option_d, correct_option, is_approved } = req.body;
    const r = await db.pool.query(`
      UPDATE questions SET question_id=$1,level=$2,subject=$3,topic_tag=$4,q_text_english=$5,
        option_a=$6,option_b=$7,option_c=$8,option_d=$9,correct_option=$10,active=$11
      WHERE id=$12
      RETURNING *, (active=1) AS is_approved, COALESCE(q_text_english, q_text_urdu) AS question_text`,
      [question_id, parseInt(level), subject, topic_tag||null, question_text,
       option_a, option_b, option_c, option_d, correct_option, is_approved ? 1 : 0, req.params.id]);
    res.json({ question: r.rows[0] });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.post('/admin/questions/:id/approve', async (req, res) => {
  try {
    await db.pool.query(`UPDATE questions SET active=1 WHERE id=$1`, [req.params.id]);
    res.json({ approved: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.post('/admin/questions/:id/flag', async (req, res) => {
  try {
    await db.pool.query(`UPDATE questions SET active=-1 WHERE id=$1`, [req.params.id]);
    res.json({ flagged: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.post('/admin/questions/approve-all', async (req, res) => {
  try {
    const r = await db.pool.query(`UPDATE questions SET active=1 WHERE active=0 OR active IS NULL RETURNING question_id`);
    res.json({ approved: r.rowCount, message: `${r.rowCount} questions approved` });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.post('/admin/questions/approve-by-qid', async (req, res) => {
  try {
    const { question_id } = req.body;
    await db.pool.query(`UPDATE questions SET active=1 WHERE question_id=$1`, [question_id]);
    res.json({ approved: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── Question import/export ────────────────────────────────────────────────────
router.post('/api/questions/save', async (req, res) => {
  try {
    const { questions, level, subject, topic } = req.body;
    if (!questions || !Array.isArray(questions)) return res.status(400).json({ error: 'questions array required' });
    // FIX: use level from each question object (set by mapToQuestionBank) — never fall back to 1
    let saved = 0;
    for (const q of questions) {
      const qLevel = parseInt(q.level || level);
      if (!qLevel) { continue; } // skip if no level at all
      await db.pool.query(`
        INSERT INTO questions (question_id, level, subject, topic_tag, q_text_english, q_text_urdu,
          option_a, option_b, option_c, option_d, correct_option, question_type, active, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,1,NOW())
        ON CONFLICT (question_id) DO UPDATE SET
          level=$2, subject=$3, topic_tag=$4,
          q_text_english=COALESCE(NULLIF($5,''), questions.q_text_english),
          q_text_urdu=COALESCE(NULLIF($6,''), questions.q_text_urdu),
          option_a=$7, option_b=$8, option_c=$9, option_d=$10,
          correct_option=$11, question_type=$12, active=1`,
        [q.question_id, qLevel, q.subject || subject, q.topic_tag || topic || null,
         q.question_text || q.q_text_english || null, q.q_text_urdu || null,
         q.option_a, q.option_b, q.option_c, q.option_d,
         q.correct_option, q.question_type || 'MCQ']);
      saved++;
    }
    res.json({ saved, message: `${saved} questions saved to database` });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/questions/csv-update', async (req, res) => {
  try {
    const { question_id, level, subject, topic_tag, question_text, image_url, option_a, option_b, option_c, option_d, correct_option } = req.body;
    if (!question_id) return res.status(400).json({ error: 'question_id required' });
    const r = await db.pool.query(`
      INSERT INTO questions (question_id, level, subject, topic_tag, q_text_english, q_text_urdu, image_url, question_type, option_a, option_b, option_c, option_d, correct_option, active, created_at)
      VALUES ($1,$2,$3,$4,$5,'',$6, CASE WHEN $6 IS NOT NULL AND $6!='' THEN 'picture' ELSE 'text' END, $7,$8,$9,$10,$11,0,NOW())
      ON CONFLICT (question_id) DO UPDATE SET
        level=$2,
        q_text_english=COALESCE(NULLIF($5,''), questions.q_text_english),
        image_url=COALESCE(NULLIF($6,''), questions.image_url),
        option_a=COALESCE(NULLIF($7,''), questions.option_a),
        option_b=COALESCE(NULLIF($8,''), questions.option_b),
        option_c=COALESCE(NULLIF($9,''), questions.option_c),
        option_d=COALESCE(NULLIF($10,''), questions.option_d),
        correct_option=COALESCE(NULLIF($11,''), questions.correct_option)
      RETURNING (xmax=0) AS inserted`,
      [question_id, parseInt(level), subject, topic_tag||'curriculum',
       question_text||null, image_url||null, option_a||null, option_b||null, option_c||null, option_d||null, correct_option||'A']);
    res.json({ inserted: !!r.rows[0]?.inserted, updated: !r.rows[0]?.inserted });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.get('/api/questions/export', async (req, res) => {
  try {
    const { subject, level, status } = req.query;
    let query = `SELECT question_id, subject, level, topic_tag, COALESCE(q_text_english,q_text_urdu) as question_text, q_text_urdu, image_url, option_a, option_b, option_c, option_d, correct_option, active, created_at FROM questions WHERE 1=1`;
    const params = [];
    if (subject) { params.push(subject);         query += ` AND subject=$${params.length}`; }
    if (level)   { params.push(parseInt(level)); query += ` AND level=$${params.length}`; }
    if (status === 'approved') query += ` AND active=1`;
    if (status === 'pending')  query += ` AND (active=0 OR active IS NULL)`;
    query += ` ORDER BY subject,level,question_id`;
    const r = await db.pool.query(query, params);

    const escape = v => v == null ? '' : '"' + String(v).replace(/"/g, '""') + '"';
    const headers = ['question_id','subject','level','topic_tag','question_text','question_urdu','image_url','option_a','option_b','option_c','option_d','correct_option','status','created_at'];
    let csv = headers.join(',') + '\n';
    r.rows.forEach(row => {
      csv += [escape(row.question_id), escape(row.subject), escape(row.level), escape(row.topic_tag),
        escape(row.question_text), escape(row.q_text_urdu), escape(row.image_url),
        escape(row.option_a), escape(row.option_b), escape(row.option_c), escape(row.option_d),
        escape(row.correct_option),
        escape(row.active===1?'approved':row.active===-1?'flagged':'pending'),
        escape(row.created_at?row.created_at.toISOString().split('T')[0]:'')
      ].join(',') + '\n';
    });
    const filename = 'TAKMIL_Questions_' + new Date().toISOString().split('T')[0] + '.csv';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('\uFEFF' + csv);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── Question Bank dashboard route ─────────────────────────────────────────────
router.get('/api/questions/bank', async (req, res) => {
  try {
    const { subject, level, status, limit = 2000 } = req.query;
    let query = `SELECT
      question_id AS id, subject, level, topic_tag,
      COALESCE(q_text_english, q_text_urdu) AS question,
      q_text_english, q_text_urdu, image_url,
      option_a, option_b, option_c, option_d, correct_option,
      CASE WHEN active=1 THEN 'approved' WHEN active=-1 THEN 'flagged' ELSE 'pending' END AS status,
      active, created_at
      FROM questions WHERE 1=1`;
    const params = [];
    if (subject) { params.push(subject);         query += ` AND subject=$${params.length}`; }
    if (level)   { params.push(parseInt(level)); query += ` AND level=$${params.length}`; }
    if (status === 'approved') query += ` AND active=1`;
    if (status === 'pending')  query += ` AND (active=0 OR active IS NULL)`;
    if (status === 'flagged')  query += ` AND active=-1`;
    params.push(parseInt(limit));
    query += ` ORDER BY subject, level, created_at DESC LIMIT $${params.length}`;
    const result = await db.pool.query(query, params);
    res.json({ questions: result.rows, count: result.rows.length });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── Question import (POST /api/questions/import) ──────────────────────────────
// FIX: ON CONFLICT now updates level, subject, active so re-imports correct wrong-level questions
router.post('/api/questions/import', async (req, res) => {
  try {
    const { questions } = req.body;
    if (!questions || !Array.isArray(questions)) return res.status(400).json({ error: 'questions array required' });
    let imported = 0, skipped = 0, errors = 0, lastError = '';
    for (const row of questions) {
      try {
        const questionId  = String(row.question_id || '').trim() || ('IMPORT-' + Date.now() + '-' + Math.random());
        const level       = parseInt(row.level) || 1;
        const subject     = String(row.subject || '').trim();
        const qText       = String(row.q_text_english || row.question || '').trim();
        const qTextUrdu   = String(row.q_text_urdu || '').trim();
        const optA        = String(row.option_a || '').trim();
        const optB        = String(row.option_b || '').trim();
        const optC        = String(row.option_c || '').trim();
        const optD        = String(row.option_d || '').trim();
        const correctOpt  = String(row.correct_option || row.answer || 'A').trim().toUpperCase();
        const topicTag    = String(row.topic_tag || row.topic || '').trim();
        const imageUrl    = String(row.image_url || '').trim() || null;
        const activeVal   = row.active !== undefined ? parseInt(row.active) : 0;
        const qType       = String(row.question_type || (imageUrl ? 'picture' : 'MCQ')).trim();
        if (!qText) { skipped++; continue; }
        await db.pool.query(`
          INSERT INTO questions
            (question_id, level, subject, topic_tag, q_text_english, q_text_urdu,
             image_url, question_type, option_a, option_b, option_c, option_d,
             correct_option, active, created_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
          ON CONFLICT (question_id) DO UPDATE SET
            level          = $2,
            subject        = $3,
            topic_tag      = COALESCE(NULLIF($4,''), questions.topic_tag),
            q_text_english = COALESCE(NULLIF($5,''), questions.q_text_english),
            q_text_urdu    = COALESCE(NULLIF($6,''), questions.q_text_urdu),
            image_url      = COALESCE(NULLIF($7,''), questions.image_url),
            question_type  = $8,
            option_a=$9, option_b=$10, option_c=$11, option_d=$12,
            correct_option=$13, active=$14`,
          [questionId, level, subject, topicTag, qText, qTextUrdu,
           imageUrl, qType, optA, optB, optC, optD, correctOpt, activeVal]);
        imported++;
      } catch(err) { lastError = err.message; errors++; }
    }
    res.json({ imported, skipped, errors, lastError });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── Approve/flag via question bank HTML ───────────────────────────────────────
router.post('/api/questions/:id/approve', async (req, res) => {
  try {
    await db.pool.query(`UPDATE questions SET active=1 WHERE question_id=$1`, [req.params.id]);
    res.json({ approved: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/questions/approve-all', async (req, res) => {
  try {
    const r = await db.pool.query(`UPDATE questions SET active=1 WHERE active=0 OR active IS NULL RETURNING question_id`);
    res.json({ approved: r.rowCount });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.get('/api/questions/breakdown', async (req, res) => {
  try {
    const r = await db.pool.query(`
      SELECT subject, level, COUNT(*) as total,
        SUM(CASE WHEN active=1 THEN 1 ELSE 0 END) as approved,
        SUM(CASE WHEN active=0 OR active IS NULL THEN 1 ELSE 0 END) as pending
      FROM questions GROUP BY subject,level ORDER BY subject,level
    `);
    const bySubject = {};
    r.rows.forEach(row => {
      if (!bySubject[row.subject]) bySubject[row.subject] = [];
      bySubject[row.subject].push({ level: row.level, total: parseInt(row.total), approved: parseInt(row.approved), pending: parseInt(row.pending) });
    });
    res.json(bySubject);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.get('/api/questions/mislabeled', async (req, res) => {
  try {
    const r = await db.pool.query(`
      SELECT subject, level, question_id, COALESCE(q_text_english,q_text_urdu) as question_text,
        COUNT(*) OVER (PARTITION BY subject) as subject_total
      FROM questions WHERE subject IN ('Level 1','Level 2','Level 3','Unknown')
      ORDER BY subject,level,question_id LIMIT 20`);
    const counts = await db.pool.query(`SELECT subject, COUNT(*) as total FROM questions WHERE subject IN ('Level 1','Level 2','Level 3','Unknown') GROUP BY subject ORDER BY subject`);
    res.json({ samples: r.rows, counts: counts.rows });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/questions/fix-subjects', async (req, res) => {
  try {
    const { old_subjects, new_subject } = req.body;
    if (!old_subjects || !new_subject) return res.status(400).json({ error: 'old_subjects array and new_subject required' });
    const placeholders = old_subjects.map((_, i) => `$${i + 2}`).join(',');
    const r = await db.pool.query(`UPDATE questions SET subject=$1 WHERE subject IN (${placeholders}) RETURNING question_id`, [new_subject, ...old_subjects]);
    res.json({ fixed: r.rowCount, new_subject, message: `${r.rowCount} questions updated to ${new_subject}` });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── Picture questions ─────────────────────────────────────────────────────────
router.post('/api/questions/save-picture', async (req, res) => {
  try {
    const { question_id, level, subject, topic_tag, question_text, image_url, option_a, option_b, option_c, option_d, correct_option } = req.body;
    if (!question_id || !image_url) return res.status(400).json({ error: 'question_id and image_url required' });
    await db.pool.query(`
      INSERT INTO questions (question_id, level, subject, topic_tag, q_text_english, q_text_urdu, image_url, question_type, option_a, option_b, option_c, option_d, correct_option, active, created_at)
      VALUES ($1,$2,$3,$4,$5,'',$6,'picture',$7,$8,$9,$10,$11,0,NOW())
      ON CONFLICT (question_id) DO UPDATE SET level=$2,q_text_english=$5,image_url=$6,option_a=$7,option_b=$8,option_c=$9,option_d=$10,correct_option=$11`,
      [question_id, parseInt(level), subject, topic_tag||'picture', question_text, image_url, option_a, option_b, option_c, option_d, correct_option]);
    res.json({ saved: true, message: 'Picture question saved as pending' });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── AI Question Generator (legacy transcript route) ───────────────────────────
router.post('/api/generate-questions', async (req, res) => {
  try {
    const { transcript, subject, level, topic, name } = req.body;
    if (!transcript) return res.status(400).json({ error: 'transcript required' });

    const topicSafe = (topic||'TOPIC').toUpperCase().replace(/[^A-Z0-9]/g,'_');
    const prompt = `You are an educational assessment expert for TAKMIL Foundation which educates out-of-school children in rural Pakistan.

Generate exactly 12 multiple-choice questions based on this video transcript.

Requirements:
- Language: bilingual (English question + Urdu translation)
- Level: ${level} (${level <= 3 ? 'basic' : level <= 7 ? 'intermediate' : 'advanced'})
- Subject: ${subject}
- Topic: ${topic || 'General'}
- 4 options (A, B, C, D), one correct
- Age-appropriate for out-of-school rural Pakistani children

Return ONLY valid JSON array:
[{
  "question_id": "${subject.substring(0,3).toUpperCase()}_L${level}_${topicSafe}_001",
  "q_text_english": "English question",
  "q_text_urdu": "اردو سوال",
  "option_a": "Option A", "option_b": "Option B", "option_c": "Option C", "option_d": "Option D",
  "correct_option": "A",
  "topic_tag": "${topic||'curriculum'}"
}]

Transcript excerpt:
${transcript.substring(0, 3000)}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5-20251101',
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data    = await response.json();
    const rawText = data.content?.[0]?.text || '';
    const cleaned = rawText.replace(/```json|```/g, '').trim();
    const match   = cleaned.match(/\[[\s\S]*\]/);
    if (!match) return res.status(400).json({ error: 'Failed to generate questions', raw: rawText.substring(0, 500) });

    const questions = JSON.parse(match[0]);
    res.json({ questions, count: questions.length, subject, level, topic });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── Question Generator AI proxy ───────────────────────────────────────────────
router.post('/api/questions/generate-ai', async (req, res) => {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Admin: schools, ops, pins ─────────────────────────────────────────────────
router.post('/admin/pins/generate', async (req, res) => {
  const { schoolId, level, subject, cohortSize, issuedBy, teacherPhone } = req.body;
  if (!schoolId || level === undefined || !subject) return res.status(400).json({ error: 'schoolId, level, subject required' });
  try {
    const pin = await db.generatePin(schoolId, parseInt(level), subject, cohortSize || 0, issuedBy || 'admin');
    if (teacherPhone) {
      const { sendWhatsApp: sw, twilioClient: tc, FROM_NUMBER: fn } = require('../helpers/whatsapp');
      const schoolRes = await db.pool.query('SELECT name FROM schools WHERE id=$1', [schoolId]);
      const schoolName = schoolRes.rows[0]?.name || 'your school';
      try {
        const toNum = teacherPhone.startsWith('whatsapp:') ? teacherPhone : `whatsapp:${teacherPhone}`;
        await tc.messages.create({ from: fn, to: toNum, body: `*TAKMIL Assessment PIN*\n\nSchool: ${schoolName}\nLevel: ${level}\nSubject: ${subject}\n\n*PIN: ${pin.pin}*\n\nValid for 24 hours.` });
      } catch(e) { console.log('WhatsApp failed:', e.message); }
    }
    res.json({ success: true, pin: pin.pin, expiresAt: pin.expires_at, whatsappSent: !!teacherPhone });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.post('/admin/schools', async (req, res) => {
  const { name, province, district, contactName, contactPhone } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    const r = await db.pool.query(`INSERT INTO schools (name,province,district,contact_name,contact_phone) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [name, province, district, contactName, contactPhone]);
    res.json({ success: true, school: r.rows[0] });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.post('/admin/ops', async (req, res) => {
  const { phone, name, role } = req.body;
  if (!phone || !name) return res.status(400).json({ error: 'phone and name required' });
  try {
    const r = await db.pool.query(`INSERT INTO ops_team (phone,name,role) VALUES ($1,$2,$3) ON CONFLICT (phone) DO UPDATE SET name=$2,role=$3,is_active=TRUE RETURNING *`, [phone, name, role||'ops']);
    res.json({ success: true, ops: r.rows[0] });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.get('/admin/advancements/pending', async (req, res) => {
  try {
    const r = await db.pool.query(`SELECT ar.*, s.name AS school_name, s.province FROM advancement_requests ar JOIN schools s ON s.id=ar.school_id WHERE ar.status='PENDING' ORDER BY ar.created_at DESC`);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/admin/debug/question', async (req, res) => {
  try {
    const r = await db.pool.query('SELECT * FROM questions LIMIT 1');
    res.json(r.rows[0] || {});
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/admin/import/questions', async (req, res) => {
  const { rows } = req.body;
  if (!rows || !Array.isArray(rows)) return res.status(400).json({ error: 'rows array required' });
  let inserted = 0, skipped = 0, errors = 0, lastError = '';
  for (const row of rows) {
    try {
      const questionId = String(row.question_id || '').trim();
      const level      = parseInt(row.level) || 1;
      const subject    = String(row.subject || '').trim();
      const qText      = String(row.q_text_english || '').trim();
      const qTextUrdu  = String(row.q_text_urdu || row.q_text_english || '').trim();
      const optA       = String(row.option_a || '').trim();
      const optB       = String(row.option_b || '').trim();
      const optC       = String(row.option_c || '').trim();
      const optD       = String(row.option_d || '').trim();
      const correctOpt = String(row.correct_option || 'A').trim().toUpperCase();
      const topicTag   = String(row.topic_tag || '').trim();
      if (!qText || !optA || !optB || !optC || !optD) { skipped++; continue; }
      await db.pool.query(
        `INSERT INTO questions (question_id,level,subject,q_text_english,q_text_urdu,option_a,option_b,option_c,option_d,correct_option,topic_tag)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (question_id) DO UPDATE SET level=$2,subject=$3`,
        [questionId, level, subject, qText, qTextUrdu, optA, optB, optC, optD, correctOpt, topicTag]);
      inserted++;
    } catch(err) { lastError = err.message; errors++; }
  }
  res.json({ inserted, skipped, errors, lastError });
});

router.post('/admin/reassessments/list', async (req, res) => {
  try {
    const r = await db.pool.query(`SELECT rs.*, s.name AS school_name FROM reassessment_schedule rs JOIN schools s ON s.id=rs.school_id ORDER BY rs.scheduled_date ASC`);
    res.json(r.rows);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── DASHBOARD API ROUTES ──────────────────────────────────────────────────────
router.get('/admin/analytics', async (req, res) => {
  try {
    const summary = await db.pool.query(`
      SELECT
        COUNT(*)::int                                                      AS total_assessments,
        COUNT(DISTINCT school_id)::int                                     AS schools_assessed,
        ROUND(AVG(score_pct)::numeric, 1)::float                          AS avg_score,
        COUNT(CASE WHEN passed = true  THEN 1 END)::int                   AS passed_count,
        COUNT(CASE WHEN passed = false THEN 1 END)::int                   AS failed_count
      FROM student_assessments
    `);
    const bySubject = await db.pool.query(`
      SELECT subject, COUNT(*)::int AS count, ROUND(AVG(score_pct)::numeric, 1)::float AS avg_score
      FROM student_assessments GROUP BY subject ORDER BY count DESC
    `);
    const byLevel = await db.pool.query(`
      SELECT level, COUNT(*)::int AS count, ROUND(AVG(score_pct)::numeric, 1)::float AS avg_score,
             COUNT(CASE WHEN passed = true THEN 1 END)::int AS passed
      FROM student_assessments GROUP BY level ORDER BY level
    `);
    let advCount = 0;
    try {
      const adv = await db.pool.query(`SELECT COUNT(*)::int AS n FROM advancement_requests WHERE status='approved'`);
      advCount = adv.rows[0]?.n || 0;
    } catch(e) {
      try {
        const adv2 = await db.pool.query(`SELECT COUNT(*)::int AS n FROM advancement_requests WHERE approved=true`);
        advCount = adv2.rows[0]?.n || 0;
      } catch(e2) {}
    }
    const s = summary.rows[0];
    s.advancements_approved = advCount;
    res.json({ summary: s, bySubject: bySubject.rows, byLevel: byLevel.rows });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.get('/admin/students/results', async (req, res) => {
  try {
    const result = await db.pool.query(`
      SELECT sa.*, s.name AS school_name, s.province
      FROM student_assessments sa
      LEFT JOIN schools s ON sa.school_id = s.id
      ORDER BY COALESCE(sa.completed_at, sa.assessed_at) DESC NULLS LAST
    `);
    res.json(result.rows);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.get('/admin/schools/list', async (req, res) => {
  try {
    const result = await db.pool.query(`SELECT * FROM schools ORDER BY name`);
    res.json(result.rows);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.get('/admin/pins/list', async (req, res) => {
  try {
    const result = await db.pool.query(`
      SELECT p.*, s.name AS school_name FROM pins p
      LEFT JOIN schools s ON p.school_id = s.id
      ORDER BY p.id DESC LIMIT 200
    `);
    res.json(result.rows);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.get('/admin/assessments/all', async (req, res) => {
  try {
    const result = await db.pool.query(`
      SELECT sa.*, s.name AS school_name FROM student_assessments sa
      LEFT JOIN schools s ON sa.school_id = s.id
      ORDER BY COALESCE(sa.completed_at, sa.assessed_at) DESC NULLS LAST LIMIT 500
    `);
    res.json(result.rows);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.get('/admin/advancements/list', async (req, res) => {
  try {
    const result = await db.pool.query(`
      SELECT ar.*, s.name AS school_name FROM advancement_requests ar
      LEFT JOIN schools s ON ar.school_id = s.id ORDER BY ar.id DESC
    `);
    res.json(result.rows);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.get('/admin/ops/list', async (req, res) => {
  try {
    const result = await db.pool.query(`SELECT * FROM ops_team ORDER BY id DESC`);
    res.json(result.rows);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.get('/admin/reassessments/list', async (req, res) => {
  try {
    const result = await db.pool.query(`
      SELECT rs.*, s.name AS school_name FROM reassessment_schedule rs
      LEFT JOIN schools s ON rs.school_id = s.id ORDER BY rs.scheduled_date DESC
    `);
    res.json(result.rows);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.post('/admin/questions/approve-all', async (req, res) => {
  try {
    const result = await db.pool.query(`UPDATE questions SET active=1 WHERE (active=0 OR active IS NULL) RETURNING id`);
    res.json({ approved: result.rows.length });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.post('/admin/questions/approve-by-qid', async (req, res) => {
  try {
    const { question_id } = req.body;
    await db.pool.query(`UPDATE questions SET active=1 WHERE question_id=$1`, [question_id]);
    res.json({ approved: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.post('/admin/questions/:id/flag', async (req, res) => {
  try {
    await db.pool.query(`UPDATE questions SET active=-1 WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.put('/admin/questions/:id', async (req, res) => {
  try {
    const b = req.body;
    await db.pool.query(`
      UPDATE questions SET
        question_id=$1, topic_tag=$2, level=$3, subject=$4,
        q_text_english=$5, q_text_urdu=$6,
        option_a=$7, option_b=$8, option_c=$9, option_d=$10,
        correct_option=$11, source_type=$12, video_id=$13,
        approved_by=$14,
        active=CASE WHEN $14 IS NOT NULL AND $14 != '' THEN 1 ELSE active END
      WHERE id=$15`,
      [b.question_id, b.topic_tag, parseInt(b.level), b.subject,
       b.question_text, b.question_text_ur,
       b.option_a, b.option_b, b.option_c, b.option_d,
       b.correct_option, b.source_type, b.video_id || null,
       b.approved_by || null, req.params.id]
    );
    res.json({ ok: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.post('/admin/questions', async (req, res) => {
  try {
    const b = req.body;
    const result = await db.pool.query(`
      INSERT INTO questions
        (question_id, topic_tag, level, subject, q_text_english, q_text_urdu,
         option_a, option_b, option_c, option_d, correct_option,
         source_type, video_id, approved_by, active)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      RETURNING id`,
      [b.question_id, b.topic_tag, parseInt(b.level), b.subject,
       b.question_text, b.question_text_ur,
       b.option_a, b.option_b, b.option_c, b.option_d,
       b.correct_option, b.source_type, b.video_id || null,
       b.approved_by || null,
       b.approved_by ? 1 : 0]
    );
    res.json({ id: result.rows[0].id });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── Analytics page API ────────────────────────────────────────────────────────
router.get('/api/analytics', async (req, res) => {
  try {
    const { from, to } = req.query;
    const dateFrom = from || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    const dateTo   = to   || new Date().toISOString().split('T')[0];

    let dailyTrend = [];
    try {
      const dt = await db.pool.query(`
        SELECT DATE(created_at) AS day,
          COUNT(DISTINCT school_id)::int AS submissions,
          (SELECT COUNT(*)::int FROM schools) AS total_schools,
          ROUND(AVG(attendance_pct)::numeric, 1)::float AS avg_attendance,
          COALESCE(SUM(tech_used::int), 0)::int AS tech_count,
          COALESCE(SUM(assembly_held::int), 0)::int AS assembly_count
        FROM daily_feedback
        WHERE DATE(created_at) BETWEEN $1 AND $2
        GROUP BY DATE(created_at) ORDER BY day
      `, [dateFrom, dateTo]);
      dailyTrend = dt.rows;
    } catch(e) {
      try {
        const dt2 = await db.pool.query(`
          SELECT DATE(COALESCE(completed_at, assessed_at)) AS day,
            COUNT(*)::int AS submissions,
            (SELECT COUNT(*)::int FROM schools) AS total_schools,
            ROUND(AVG(score_pct)::numeric,1)::float AS avg_attendance,
            0::int AS tech_count, 0::int AS assembly_count
          FROM student_assessments
          WHERE DATE(COALESCE(completed_at, assessed_at)) BETWEEN $1 AND $2
          GROUP BY DATE(COALESCE(completed_at, assessed_at)) ORDER BY day
        `, [dateFrom, dateTo]);
        dailyTrend = dt2.rows;
      } catch(e2) {}
    }

    let rcPerf = [];
    try {
      const rc = await db.pool.query(`
        SELECT rc.name AS rc_name, rc.region,
          COUNT(DISTINCT s.id)::int AS total_schools,
          COUNT(DISTINCT sa.id)::int AS submissions,
          CASE WHEN COUNT(DISTINCT s.id)>0
            THEN ROUND((COUNT(DISTINCT sa.id)::numeric/COUNT(DISTINCT s.id))*100,1)
            ELSE 0 END::float AS submission_rate,
          ROUND(AVG(sa.score_pct)::numeric,1)::float AS avg_attendance,
          0::int AS tech_count, 0::int AS assembly_count
        FROM regional_coordinators rc
        LEFT JOIN school_coordinators sc ON sc.regional_coordinator_id = rc.id
        LEFT JOIN schools s ON s.id = sc.school_id
        LEFT JOIN student_assessments sa ON sa.school_id = s.id
          AND DATE(COALESCE(sa.completed_at,sa.assessed_at)) BETWEEN $1 AND $2
        GROUP BY rc.id, rc.name, rc.region ORDER BY submission_rate DESC
      `, [dateFrom, dateTo]);
      rcPerf = rc.rows;
    } catch(e) {}

    let coordPerf = [];
    try {
      const co = await db.pool.query(`
        SELECT sc.name AS coord_name, rc.name AS rc_name, rc.region,
          COUNT(DISTINCT s.id)::int AS total_schools,
          CASE WHEN COUNT(DISTINCT s.id)>0
            THEN ROUND((COUNT(DISTINCT sa.id)::numeric/COUNT(DISTINCT s.id))*100,1)
            ELSE 0 END::float AS submission_rate,
          ROUND(AVG(sa.score_pct)::numeric,1)::float AS avg_attendance,
          0::int AS tech_count, 0::int AS assembly_count
        FROM school_coordinators sc
        LEFT JOIN regional_coordinators rc ON rc.id = sc.regional_coordinator_id
        LEFT JOIN schools s ON s.coordinator_id = sc.id
        LEFT JOIN student_assessments sa ON sa.school_id = s.id
          AND DATE(COALESCE(sa.completed_at,sa.assessed_at)) BETWEEN $1 AND $2
        GROUP BY sc.id, sc.name, rc.name, rc.region ORDER BY submission_rate DESC
      `, [dateFrom, dateTo]);
      coordPerf = co.rows;
    } catch(e) {}

    let schoolPerf = [];
    try {
      const sp = await db.pool.query(`
        SELECT s.name AS school_name, s.province AS region, sc.name AS coord_name,
          COUNT(sa.id)::int AS submissions,
          CASE WHEN COUNT(sa.id)>0
            THEN ROUND(COUNT(sa.id)::numeric/GREATEST(($2::date - $1::date + 1),1)*100,1)
            ELSE 0 END::float AS submission_rate,
          ROUND(AVG(sa.score_pct)::numeric,1)::float AS avg_attendance,
          0::int AS tech_count,
          MAX(COALESCE(sa.completed_at,sa.assessed_at)) AS last_submission
        FROM schools s
        LEFT JOIN school_coordinators sc ON sc.id = s.coordinator_id
        LEFT JOIN student_assessments sa ON sa.school_id = s.id
          AND DATE(COALESCE(sa.completed_at,sa.assessed_at)) BETWEEN $1 AND $2
        GROUP BY s.id, s.name, s.province, sc.name ORDER BY submissions DESC
      `, [dateFrom, dateTo]);
      schoolPerf = sp.rows;
    } catch(e) {}

    res.json({ dailyTrend, rcPerf, coordPerf, schoolPerf });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

module.exports = { router };
