// routes/level-advance.js — Level Advancement.
// Tablet PIN assessments, teacher portal, lessons tracking, compliance dashboard
// Portals: /assess, /portal, /offline-portal, /teacher-portal, /lessons-admin, /compliance, /results

const router = require('express').Router();
const db     = require('../database');
const path   = require('path');
const { PASS_THRESHOLD, QUESTIONS_PER_SESSION, shuffleOptions } = require('../helpers/questions');
const { sendWhatsApp, twilioClient, FROM_NUMBER } = require('../helpers/whatsapp');

// ── HTML pages ────────────────────────────────────────────────────────────────
router.get('/advance', (req, res) => res.sendFile(path.join(__dirname, '../level-advancement.html')));
router.get('/offline-portal', (req, res) => res.sendFile(path.join(__dirname, '../offline-portal.html')));
router.get('/coordinator-portal', (req, res) => res.sendFile(path.join(__dirname, '../coordinator-portal.html')));
router.get('/assess',        (req, res) => res.sendFile(path.join(__dirname, '../takmil-unified-portal.html')));
router.get('/level2',        (req, res) => res.sendFile(path.join(__dirname, '../takmil-level2-portal.html')));
router.get('/level3',        (req, res) => res.sendFile(path.join(__dirname, '../takmil-level3-portal.html')));
router.get('/jod-tod',       (req, res) => res.sendFile(path.join(__dirname, '../takmil-jod-tod-portal.html')));
router.get('/portal',        (req, res) => res.sendFile(path.join(__dirname, '../portal.html')));
router.get('/results',       (req, res) => res.sendFile(path.join(__dirname, '../results.html')));
router.get('/teacher-portal',(req, res) => res.sendFile(path.join(__dirname, '../teacher-portal.html')));
router.get('/lessons-admin', (req, res) => res.sendFile(path.join(__dirname, '../lessons-admin.html')));
router.get('/compliance',    (req, res) => res.sendFile(path.join(__dirname, '../compliance.html')));
router.get('/image-portal',  (req, res) => res.sendFile(path.join(__dirname, '../image-portal.html')));
router.get('/pdf-portal',    (req, res) => res.sendFile(path.join(__dirname, '../takmil-pdf-portal-v2.html')));
router.get('/bulk-assess',   (req, res) => res.sendFile(path.join(__dirname, '../takmil-bulk-assess.html')));
router.get('/pin-generator', (req, res) => res.sendFile(path.join(__dirname, '../pin-generator.html')));

// ── Coordinator login ─────────────────────────────────────────────────────────
router.post('/api/auth/coordinator-login', async (req, res) => {
  const { phone, password } = req.body;
  if (!phone || !password) return res.status(400).json({ error: 'Phone and password required' });

  const client = await db.pool.connect();
  try {
    const regional = await client.query(
      `SELECT rc.id, rc.name, rc.region, rc.phone,
              COALESCE(json_agg(json_build_object('id',s.id,'name',s.name,'identifier',s.identifier,'district',s.district)) FILTER (WHERE s.id IS NOT NULL),'[]'::json) AS schools
       FROM regional_coordinators rc
       LEFT JOIN schools s ON s.regional_coordinator_id=rc.id
       WHERE rc.phone=$1 AND rc.password=$2
       GROUP BY rc.id,rc.name,rc.region,rc.phone`, [phone, password]
    );
    if (regional.rows.length > 0) {
      const c = regional.rows[0];
      return res.status(200).json({ role:'regional', id:c.id, name:c.name, region:c.region, schools:c.schools });
    }

    const school = await client.query(
      `SELECT sc.id, sc.name, sc.phone, sc.regional_coordinator_id, rc.region,
              COALESCE(json_agg(json_build_object('id',s.id,'name',s.name,'identifier',s.identifier,'district',s.district)) FILTER (WHERE s.id IS NOT NULL),'[]'::json) AS schools
       FROM school_coordinators sc
       JOIN regional_coordinators rc ON rc.id=sc.regional_coordinator_id
       LEFT JOIN schools s ON s.regional_coordinator_id=rc.id
       WHERE sc.phone=$1 AND sc.password=$2
       GROUP BY sc.id,sc.name,sc.phone,sc.regional_coordinator_id,rc.region`, [phone, password]
    );
    if (school.rows.length > 0) {
      const c = school.rows[0];
      return res.status(200).json({ role:'school', id:c.id, name:c.name, region:c.region, schools:c.schools });
    }

    // Check bot_users (coordinators approved via WhatsApp registration)
    const botUser = await client.query(
      `SELECT * FROM bot_users WHERE phone=$1 AND active=TRUE`, [phone]
    );
    if (botUser.rows.length && password === 'takmil123') {
      const u = botUser.rows[0];
      let schools = [];
      try {
        const sr = await client.query(
          `SELECT id, name, identifier, district FROM schools
           WHERE ($1::text IS NULL OR region = $1)
           ORDER BY name LIMIT 200`,
          [u.region || null]
        );
        schools = sr.rows;
      } catch(e) { schools = []; }
      return res.status(200).json({ role: u.role, id: u.id, name: u.name, region: u.region || null, schools });
    }

    return res.status(401).json({ error: 'Invalid phone number or password' });
  } catch(err) {
    return res.status(500).json({ error: 'Server error. Please try again.' });
  } finally { client.release(); }
});

// ── Auth registration ─────────────────────────────────────────────────────────
router.post('/api/auth/register-request', async (req, res) => {
  const { name, phone, employee_id, role, region, province } = req.body;
  if (!name || !phone || !employee_id || !role) return res.status(400).json({ error: 'Name, phone, employee ID and role are required' });
  try {
    const existing = await db.pool.query(`SELECT phone FROM bot_users WHERE phone=$1`, [phone]);
    if (existing.rows.length) return res.status(400).json({ error: 'This phone number is already registered. Please login.' });
    const pending = await db.pool.query(`SELECT id, status FROM pending_registrations WHERE phone=$1`, [phone]);
    if (pending.rows.length) {
      const status = pending.rows[0].status;
      if (status === 'pending')  return res.status(400).json({ error: 'Your request is already pending approval. Please wait.' });
      if (status === 'rejected') return res.status(400).json({ error: 'Your previous request was rejected. Contact your supervisor.' });
    }
    await db.pool.query(
      `INSERT INTO pending_registrations (name,phone,employee_id,role,region,province) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (phone) DO UPDATE SET name=$1,employee_id=$3,role=$4,region=$5,province=$6,status='pending',requested_at=NOW()`,
      [name, phone, employee_id, role, region||null, province||null]
    );
    const adminPhone = process.env.ADMIN_PHONE || '+16024305897';
    try { await sendWhatsApp('whatsapp:' + adminPhone, `🆕 *New Access Request*\n\n👤 Name: ${name}\n📱 Phone: ${phone}\n🪪 Employee ID: ${employee_id}\n🎭 Role: ${role}\n\nTo approve reply:\nAPPROVE ${phone}\n\nTo reject reply:\nREJECT ${phone}`); } catch(e) {}
    res.json({ success: true, message: 'Request submitted! You will receive a WhatsApp message when approved.' });
  } catch(e) { res.status(500).json({ error: 'Server error. Please try again.' }); }
});

router.get('/api/auth/register-status', async (req, res) => {
  const { phone } = req.query;
  if (!phone) return res.status(400).json({ error: 'Phone required' });
  try {
    const active = await db.pool.query(`SELECT role FROM bot_users WHERE phone=$1`, [phone]);
    if (active.rows.length) return res.json({ status: 'active', role: active.rows[0].role });
    const r = await db.pool.query(`SELECT status, requested_at FROM pending_registrations WHERE phone=$1`, [phone]);
    if (!r.rows.length) return res.json({ status: 'not_found' });
    res.json({ status: r.rows[0].status, requested_at: r.rows[0].requested_at });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/api/auth/pending-registrations', async (req, res) => {
  try {
    const r = await db.pool.query(`SELECT * FROM pending_registrations ORDER BY requested_at DESC`);
    res.json({ registrations: r.rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Tablet Assessment PIN ─────────────────────────────────────────────────────
router.post('/api/assess/generate-pin', async (req, res) => {
  try {
    const { school_identifier, level, subjects, subject, created_by } = req.body;
    if (!school_identifier || !level) return res.status(400).json({ error: 'school_identifier and level required' });
    const subjectList = subjects || (subject ? [subject] : ['Math','English','Urdu']);
    const subjectStr  = Array.isArray(subjectList) ? subjectList.join(',') : subjectList;
    const pin_code    = Math.floor(100000 + Math.random() * 900000).toString();
    const expires_at  = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await db.pool.query(`UPDATE tablet_sessions SET active=FALSE WHERE school_identifier=$1 AND level=$2`,
      [school_identifier, parseInt(level)]);

    const r = await db.pool.query(`
      INSERT INTO tablet_sessions (pin_code, school_identifier, level, subject, created_by, expires_at)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING id
    `, [pin_code, school_identifier, parseInt(level), subjectStr, created_by||'coordinator', expires_at]);

    res.json({ pin_code, expires_at, session_id: r.rows[0].id, level, school_identifier, subjects: subjectList });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.get('/api/assess/session/:pin', async (req, res) => {
  try {
    const r = await db.pool.query(`
      SELECT ts.*, s.name AS school_name FROM tablet_sessions ts
      LEFT JOIN schools s ON s.identifier ILIKE ts.school_identifier
      WHERE ts.pin_code=$1 AND ts.active=TRUE AND ts.expires_at>NOW()
    `, [req.params.pin]);
    if (!r.rows.length) return res.status(404).json({ error: 'Invalid or expired PIN' });
    res.json(r.rows[0]);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.get('/api/assess/questions/:pin', async (req, res) => {
  try {
    const sess = await db.pool.query(
      `SELECT * FROM tablet_sessions WHERE pin_code=$1 AND active=TRUE AND expires_at>NOW()`, [req.params.pin]
    );
    if (!sess.rows.length) return res.status(404).json({ error: 'Invalid or expired PIN' });
    const s = sess.rows[0];
    const subjectList = s.subject && s.subject !== 'All'
      ? s.subject.split(',').map(x => x.trim())
      : ['Math', 'English', 'Urdu'];

    let allQuestions = [];
    if (parseInt(s.level) === 12) {
      const qs = await db.pool.query(`
        SELECT question_id AS id, COALESCE(q_text_english,q_text_urdu) AS question_text,
               q_text_urdu, q_text_english, option_a,option_b,option_c,option_d,
               correct_option, subject, level, image_url
        FROM questions WHERE active=1 AND level BETWEEN 1 AND 11 ORDER BY RANDOM() LIMIT $1
      `, [QUESTIONS_PER_SESSION * subjectList.length]);
      allQuestions = qs.rows;
    } else {
      for (const subj of subjectList) {
        const qs = await db.pool.query(`
          SELECT question_id AS id, COALESCE(q_text_english,q_text_urdu) AS question_text,
                 q_text_urdu, q_text_english, option_a,option_b,option_c,option_d,
                 correct_option, subject, level, image_url
          FROM questions WHERE active=1 AND level=$1::integer AND subject ILIKE $2
          ORDER BY RANDOM() LIMIT $3
        `, [parseInt(s.level), subj, QUESTIONS_PER_SESSION]);

        if (qs.rows.length === 0) {
          const fallback = await db.pool.query(`
            SELECT question_id AS id, COALESCE(q_text_english,q_text_urdu) AS question_text,
                   q_text_urdu, q_text_english, option_a,option_b,option_c,option_d,
                   correct_option, subject, level, image_url
            FROM questions WHERE active=1 AND subject ILIKE $1 ORDER BY RANDOM() LIMIT $2
          `, [subj, QUESTIONS_PER_SESSION]);
          allQuestions = allQuestions.concat(fallback.rows);
        } else {
          allQuestions = allQuestions.concat(qs.rows);
        }
      }
    }

    if (allQuestions.length < 1) return res.status(400).json({ error: 'Not enough questions for this level. Please approve more questions first.' });

    const questions = allQuestions.map(q => ({
      id: q.id, question_text: q.question_text, q_text_urdu: q.q_text_urdu,
      q_text_english: q.q_text_english, subject: q.subject, level: q.level, image_url: q.image_url,
      option_a: q.option_a, option_b: q.option_b, option_c: q.option_c, option_d: q.option_d,
      correct_option: (q.correct_option||'A').toUpperCase(),
    }));
    res.json({ session: s, questions, subjects: subjectList });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/assess/submit', async (req, res) => {
  try {
    const { pin, student_name, answers } = req.body;
    if (!pin || !student_name || !answers?.length) return res.status(400).json({ error: 'pin, student_name and answers required' });

    const sess = await db.pool.query(
      `SELECT * FROM tablet_sessions WHERE pin_code=$1 AND active=TRUE AND expires_at>NOW()`, [pin]
    );
    if (!sess.rows.length) return res.status(404).json({ error: 'Invalid or expired PIN' });
    const s = sess.rows[0];

    let correct = 0;
    for (const a of answers) {
      const isCorrect = (a.selected_option||'').toUpperCase().trim() === (a.correct_option||'').toUpperCase().trim();
      if (isCorrect) correct++;
    }
    const total    = answers.length;
    const scorePct = Math.round(correct / total * 100);
    const passed   = scorePct >= PASS_THRESHOLD;

    try {
      await db.pool.query(`
        INSERT INTO tablet_results (session_id, student_name, school_identifier, level, total_questions, correct_answers, score_pct, passed)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING
      `, [s.id, student_name, s.school_identifier, s.level, total, correct, scorePct, passed]);
    } catch(e) { console.log('tablet_results save note:', e.message); }

    try {
      for (const a of answers) {
        const isCorrect = (a.selected_option||'').toUpperCase().trim() === (a.correct_option||'').toUpperCase().trim();
        await db.pool.query(`
          INSERT INTO tablet_responses (session_id, student_name, school_identifier, level, question_id, selected_option, correct_option, is_correct, time_taken_secs)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        `, [s.id, student_name, s.school_identifier, s.level, a.question_id, a.selected_option, a.correct_option, isCorrect, a.time_taken_secs || 0]);
      }
    } catch(e) { console.log('tablet_responses save note:', e.message); }

    res.json({ saved: true, score_pct: scorePct, correct, total, passed });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.get('/api/assess/results/:pin', async (req, res) => {
  try {
    const sess = await db.pool.query(`SELECT * FROM tablet_sessions WHERE pin_code=$1`, [req.params.pin]);
    if (!sess.rows.length) return res.status(404).json({ error: 'Session not found' });
    const s = sess.rows[0];

    const results = await db.pool.query(`
      SELECT student_name, score_pct, correct_answers, total_questions, passed, completed_at
      FROM tablet_results WHERE session_id=$1 ORDER BY completed_at
    `, [s.id]);

    const students = results.rows;
    const total    = students.length;
    const passed   = students.filter(r => r.passed).length;
    const avgScore = total ? Math.round(students.reduce((a,r) => a + parseFloat(r.score_pct), 0) / total) : 0;

    const flags = await db.pool.query(`
      SELECT cf.topic, cf.fail_rate, cf.students_failed, cf.total_students, q.question_text
      FROM competency_flags cf
      LEFT JOIN questions q ON q.id=cf.question_id
      WHERE cf.school_identifier=$1 AND cf.level=$2 ORDER BY cf.fail_rate DESC
    `, [s.school_identifier, s.level]);

    res.json({ session: s, students, total, passed, avgScore, cohortPassed: avgScore >= PASS_THRESHOLD, competencyFlags: flags.rows });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── Portal session (online tablet portal) ────────────────────────────────────
router.post('/portal/session/start', async (req, res) => {
  const { pin, studentName, subject } = req.body;
  if (!pin || !studentName) return res.status(400).json({ error: 'PIN and student name required.' });
  try {
    const pinRec = await db.validatePin(pin);
    if (!pinRec) return res.status(401).json({ error: 'Invalid or expired PIN. Please ask your teacher.' });

    const isFinal        = parseInt(pinRec.level) === 0;
    const isMultiSubject = pinRec.subject === 'All' && !subject;
    let effectiveSubject = subject || pinRec.subject;

    if (isMultiSubject) return res.json({ isMultiSubject: true, level: pinRec.level, isFinal });

    let questions = [];
    if (isFinal) {
      for (const lvl of [1,2,3,4,5,6,7,8,9,10,11]) {
        const r = await db.pool.query(
          `SELECT * FROM questions WHERE subject=$1 AND topic_tag='final_assessment' AND level=$2 AND active=1 ORDER BY RANDOM() LIMIT 2`,
          [effectiveSubject, lvl]
        );
        questions = questions.concat(r.rows);
      }
    } else {
      const r = await db.pool.query(
        `SELECT * FROM questions WHERE subject=$1 AND level=$2 AND active=1 ORDER BY RANDOM() LIMIT 10`,
        [effectiveSubject, pinRec.level]
      );
      questions = r.rows;
    }

    if (!questions.length) return res.status(404).json({ error: 'No questions found for this assessment. Please contact your coordinator.' });

    const shuffled = questions.map(q => {
      const correctOption = (q.correct_option || 'A').toUpperCase();
      const opts = [
        { label: 'A', text: q.option_a }, { label: 'B', text: q.option_b },
        { label: 'C', text: q.option_c }, { label: 'D', text: q.option_d },
      ];
      const correctText = opts.find(o => o.label === correctOption)?.text;
      for (let i = opts.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [opts[i], opts[j]] = [opts[j], opts[i]];
      }
      return {
        id: q.question_id || q.id, level: q.level,
        question_text: q.q_text_english || q.question_text || '',
        q_text_urdu: q.q_text_urdu || '', image_url: q.image_url || null,
        option_a: opts[0].text, option_b: opts[1].text,
        option_c: opts[2].text, option_d: opts[3].text,
        correct: ['A','B','C','D'][opts.findIndex(o => o.text === correctText)] || 'A',
      };
    });

    await db.pool.query(`CREATE TABLE IF NOT EXISTS student_assessments (id SERIAL PRIMARY KEY, pin_id INTEGER, school_id INTEGER, teacher_phone VARCHAR(20), student_name VARCHAR(100), level INTEGER, subject VARCHAR(20), total_questions INTEGER DEFAULT 10, correct_answers INTEGER DEFAULT 0, score_pct NUMERIC(5,2) DEFAULT 0, passed BOOLEAN DEFAULT FALSE, answers_detail JSONB, recommendation TEXT, completed_at TIMESTAMP DEFAULT NOW())`);

    const saRec = await db.pool.query(`
      INSERT INTO student_assessments (pin_id, school_id, teacher_phone, student_name, level, subject, answers_detail)
      VALUES ($1,$2,'portal',$3,$4,$5,'[]'::jsonb) RETURNING id
    `, [pinRec.id, pinRec.school_id, studentName, pinRec.level, effectiveSubject]);

    res.json({ sessionId: saRec.rows[0].id, subject: effectiveSubject, level: pinRec.level, isFinal, questions: shuffled });
  } catch(err) {
    console.error('Portal start error:', err);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

router.post('/portal/session/submit', async (req, res) => {
  const { sessionId, answers, questions } = req.body;
  if (!sessionId || !answers || !questions) return res.status(400).json({ error: 'sessionId, answers, questions required.' });
  try {
    const total = questions.length;
    let score = 0;
    const levelScores = {};
    questions.forEach((q, i) => {
      const isRight = answers[i] === q.correct;
      if (isRight) score++;
      if (!levelScores[q.level]) levelScores[q.level] = { score: 0, total: 0 };
      levelScores[q.level].total++;
      if (isRight) levelScores[q.level].score++;
    });
    const pct    = Math.round((score / total) * 100);
    const passed = pct >= PASS_THRESHOLD;

    await db.pool.query(`
      UPDATE student_assessments SET correct_answers=$1, score_pct=$2, passed=$3,
        answers_detail=$4::jsonb, recommendation=$5, total_questions=$6, completed_at=NOW()
      WHERE id=$7
    `, [score, pct, passed, JSON.stringify({ answers, levelScores }), passed ? '✅ Passed via Portal' : '📚 Needs review', total, sessionId]);

    res.json({ score, total, pct, passed, levelScores });
  } catch(err) { res.status(500).json({ error: 'Failed to save results.' }); }
});

// ── Lesson Tracking ───────────────────────────────────────────────────────────
router.post('/api/lessons/complete', async (req, res) => {
  try {
    const { school_identifier, level, lesson_number, marked_by } = req.body;
    await db.pool.query(`
      INSERT INTO lesson_completions (school_identifier, level, lesson_number, marked_by)
      VALUES ($1,$2,$3,$4) ON CONFLICT (school_identifier, level, lesson_number) DO NOTHING
    `, [school_identifier, parseInt(level), parseInt(lesson_number), marked_by||'teacher']);
    const r = await db.pool.query(`SELECT COUNT(*) AS completed FROM lesson_completions WHERE school_identifier=$1 AND level=$2`, [school_identifier, parseInt(level)]);
    res.json({ saved: true, lessons_completed: parseInt(r.rows[0].completed) });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.get('/api/lessons/progress/:school_identifier', async (req, res) => {
  try {
    const r = await db.pool.query(`SELECT level, COUNT(*) AS completed FROM lesson_completions WHERE school_identifier=$1 GROUP BY level ORDER BY level`, [req.params.school_identifier]);
    res.json({ school: req.params.school_identifier, progress: r.rows });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.get('/api/cohort/:school_identifier', async (req, res) => {
  try {
    const r = await db.pool.query(`SELECT * FROM cohort_levels WHERE school_identifier=$1`, [req.params.school_identifier]);
    if (!r.rows.length) {
      await db.pool.query(`INSERT INTO cohort_levels (school_identifier, current_level) VALUES ($1,1) ON CONFLICT DO NOTHING`, [req.params.school_identifier]);
      return res.json({ school_identifier: req.params.school_identifier, current_level: 1, status: 'in_progress' });
    }
    res.json(r.rows[0]);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── Teacher Portal APIs ───────────────────────────────────────────────────────
router.post('/api/teacher/validate', async (req, res) => {
  try {
    const { school_code } = req.body;
    if (!school_code) return res.json({ valid: false, error: 'School code required.' });
    const school = await db.pool.query(`SELECT * FROM schools WHERE school_code=$1 OR identifier=$1 OR name ILIKE $1 LIMIT 1`, [school_code]);
    if (!school.rows.length) return res.json({ valid: false, error: 'School code not found.' });
    res.json({ valid: true, school_name: school.rows[0].name || school_code, school_id: school.rows[0].id });
  } catch(err) { res.json({ valid: true, school_name: req.body.school_code }); }
});

router.get('/api/teacher/videos', async (req, res) => {
  try {
    const { subject, level } = req.query;
    let query = `SELECT * FROM video_catalog WHERE 1=1`;
    const params = [];
    if (subject) { params.push(subject);       query += ` AND subject=$${params.length}`; }
    if (level)   { params.push(parseInt(level)); query += ` AND level=$${params.length}`; }
    query += ` ORDER BY subject, level, name LIMIT 500`;
    const r = await db.pool.query(query, params);
    if (r.rows.length) return res.json({ videos: r.rows });
    const q = await db.pool.query(`SELECT DISTINCT subject, level FROM questions WHERE active=true AND subject IN ('Math','English','Urdu','Science') ORDER BY subject,level LIMIT 50`);
    const videos = q.rows.map((row,i) => ({
      id: `${(row.subject||'').replace(/\s/g,'').toUpperCase()}-L${row.level}-${i}`,
      name: `${row.subject} — Level ${row.level}`, subject: row.subject, level: parseInt(row.level),
      unit: 'General', duration: 480
    }));
    res.json({ videos });
  } catch(err) { res.status(500).json({ videos: [], error: err.message }); }
});

router.post('/api/teacher/catalog/upload', async (req, res) => {
  try {
    const { videos } = req.body;
    if (!videos || !Array.isArray(videos)) return res.status(400).json({ error: 'videos array required' });
    let saved = 0;
    for (const v of videos) {
      await db.pool.query(`
        INSERT INTO video_catalog (id,name,subject,level,unit,package,filename,duration)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (id) DO UPDATE SET name=$2,subject=$3,level=$4,unit=$5,package=$6,filename=$7,duration=$8`,
        [v.id, v.name, v.subject, parseInt(v.level)||1, v.unit||'Unit 1', v.package||'', v.filename||'', parseInt(v.duration)||480]);
      saved++;
    }
    res.json({ saved, message: `${saved} videos in catalog` });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/lessons/start', async (req, res) => {
  try {
    const { video_id, video_name, subject, level, expected_duration, school_code, school_name, teacher_name, start_time, start_gps } = req.body;
    let school_id = null;
    try { const s = await db.pool.query(`SELECT id FROM schools WHERE school_code=$1 OR identifier=$1 OR name ILIKE $1 LIMIT 1`, [school_code]); school_id = s.rows[0]?.id || null; } catch(e) {}
    await db.pool.query(`
      INSERT INTO lessons (video_id,video_name,subject,level,expected_duration,school_id,school_code,school_name,teacher_name,start_time,start_gps_lat,start_gps_lng,start_gps_acc,status,created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'started',NOW())`,
      [video_id, video_name, subject, parseInt(level)||null, parseInt(expected_duration)||600, school_id, school_code, school_name, teacher_name,
       start_time || new Date().toISOString(), start_gps?.lat||null, start_gps?.lng||null, start_gps?.acc||null]);
    const mapsLink = start_gps ? `maps.google.com/?q=${start_gps.lat},${start_gps.lng}` : 'Location unavailable';
    const ops = await db.pool.query(`SELECT phone FROM ops_team WHERE is_active=TRUE LIMIT 1`);
    if (ops.rows[0]?.phone) await sendWhatsApp(ops.rows[0].phone, `▶️ *Lesson Started*\n\nSchool: ${school_name||school_code}\nTeacher: ${teacher_name}\nVideo: ${video_name}\n📍 ${mapsLink}`);
    res.json({ saved: true });
  } catch(err) { res.status(500).json({ saved: false, error: err.message }); }
});

router.post('/api/lessons/end', async (req, res) => {
  try {
    const { video_id, video_name, subject, level, expected_duration, school_code, school_name, teacher_name, start_time, end_time, actual_duration, coverage_pct, start_gps, end_gps, gps_match, status, flagged } = req.body;
    let school_id = null;
    try { const s = await db.pool.query(`SELECT id FROM schools WHERE school_code=$1 OR identifier=$1 OR name ILIKE $1 LIMIT 1`, [school_code]); school_id = s.rows[0]?.id || null; } catch(e) {}

    const updated = await db.pool.query(`
      UPDATE lessons SET end_time=$1,actual_duration=$2,coverage_pct=$3,end_gps_lat=$4,end_gps_lng=$5,gps_match=$6,status=$7,flagged=$8
      WHERE school_code=$9 AND video_id=$10 AND status='started' AND start_time=$11 RETURNING id`,
      [end_time, parseInt(actual_duration)||0, parseFloat(coverage_pct)||0, end_gps?.lat||null, end_gps?.lng||null, !!gps_match, status||'completed', !!flagged, school_code, video_id, start_time]);

    if (!updated.rows.length) {
      await db.pool.query(`
        INSERT INTO lessons (video_id,video_name,subject,level,expected_duration,school_id,school_code,school_name,teacher_name,start_time,end_time,actual_duration,coverage_pct,start_gps_lat,start_gps_lng,end_gps_lat,end_gps_lng,gps_match,status,flagged,created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,NOW())`,
        [video_id, video_name, subject, parseInt(level)||null, parseInt(expected_duration)||600, school_id, school_code, school_name, teacher_name,
         start_time, end_time, parseInt(actual_duration)||0, parseFloat(coverage_pct)||0,
         start_gps?.lat||null, start_gps?.lng||null, end_gps?.lat||null, end_gps?.lng||null, !!gps_match, status||'completed', !!flagged]);
    }

    const mins = Math.floor((actual_duration||0)/60);
    const secs = (actual_duration||0) % 60;
    const statusEmoji = status==='completed'?'✅':status==='short'?'⚠️':'🚨';
    const ops = await db.pool.query(`SELECT phone FROM ops_team WHERE is_active=TRUE LIMIT 1`);
    if (ops.rows[0]?.phone) await sendWhatsApp(ops.rows[0].phone, `${statusEmoji} *Lesson ${(status||'completed').toUpperCase()}*\n\nSchool: ${school_name||school_code}\nTeacher: ${teacher_name}\nVideo: ${video_name}\nDuration: ${mins}m ${secs}s\nCoverage: ${Math.round(coverage_pct||0)}%${flagged ? '\n\n⚠️ Flagged for review' : ''}`);
    res.json({ saved: true });
  } catch(err) { res.status(500).json({ saved: false, error: err.message }); }
});

router.get('/api/lessons', async (req, res) => {
  try {
    const { school_code, date, subject, status } = req.query;
    let query = `SELECT * FROM lessons WHERE 1=1`;
    const params = [];
    if (school_code) { params.push(school_code); query += ` AND (school_code=$${params.length} OR school_name ILIKE $${params.length})`; }
    if (date)        { params.push(date);         query += ` AND DATE(start_time)=$${params.length}`; }
    if (subject)     { params.push(subject);      query += ` AND subject=$${params.length}`; }
    if (status)      { params.push(status);       query += ` AND status=$${params.length}`; }
    query += ` ORDER BY start_time DESC LIMIT 200`;
    const r = await db.pool.query(query, params);
    res.json({ lessons: r.rows });
  } catch(err) { res.status(500).json({ lessons: [], error: err.message }); }
});

// ── Compliance Dashboard ──────────────────────────────────────────────────────
router.get('/api/compliance', async (req, res) => {
  try {
    const date   = req.query.date || new Date().toISOString().split('T')[0];
    const region = req.query.region || null;
    let regionFilter = '';
    const params = [date];
    if (region) { params.push(region); regionFilter = `AND s.region = $${params.length}`; }

    const r = await db.pool.query(`
      SELECT s.id, s.name, s.identifier, s.region,
        rc.name AS regional_coordinator, sc.name AS school_coordinator,
        COUNT(l.id) AS lesson_count, MAX(l.coverage_pct) AS max_coverage,
        MAX(l.start_time) AS last_lesson_time,
        BOOL_OR(l.status='completed') AS has_completed,
        BOOL_OR(l.flagged=TRUE) AS has_flagged
      FROM schools s
      LEFT JOIN regional_coordinators rc ON rc.id=s.regional_coordinator_id
      LEFT JOIN school_coordinators   sc ON sc.id=s.school_coordinator_id
      LEFT JOIN lessons l ON (l.school_code ILIKE s.identifier OR l.school_code ILIKE s.name OR l.school_name ILIKE s.name OR l.school_name ILIKE s.identifier)
        AND DATE(l.start_time AT TIME ZONE 'UTC')=$1::date
      WHERE s.identifier IS NOT NULL ${regionFilter}
      GROUP BY s.id,s.name,s.identifier,s.region,rc.name,sc.name
      ORDER BY s.region, s.name
    `, params);

    const schools = r.rows;
    const total   = schools.length;
    const active  = schools.filter(s => parseInt(s.lesson_count) > 0).length;
    const byRegion= {};
    for (const s of schools) {
      const reg = s.region || 'Unknown';
      if (!byRegion[reg]) byRegion[reg] = [];
      byRegion[reg].push(s);
    }
    res.json({ date, total, active, confirmed: schools.filter(s => s.has_completed).length,
      flagged: schools.filter(s => s.has_flagged && !s.has_completed).length,
      inactive: total - active, byRegion, schools });
  } catch(err) { res.status(500).json({ error: err.message, byRegion: {}, schools: [] }); }
});

// ── Results APIs ──────────────────────────────────────────────────────────────
router.get('/api/results/sessions', async (req, res) => {
  try {
    const { school, level, date_from, date_to } = req.query;
    let where = 'WHERE 1=1';
    const params = [];
    if (school)     { params.push(school);      where += ` AND ts.school_identifier ILIKE $${params.length}`; }
    if (level)      { params.push(parseInt(level)); where += ` AND ts.level=$${params.length}`; }
    if (date_from)  { params.push(date_from);   where += ` AND ts.created_at::date >= $${params.length}::date`; }
    if (date_to)    { params.push(date_to);     where += ` AND ts.created_at::date <= $${params.length}::date`; }

    const r = await db.pool.query(`
      SELECT ts.id, ts.pin_code, ts.school_identifier, ts.level, ts.created_at,
        s.name AS school_name, COUNT(tr.id) AS student_count,
        ROUND(AVG(tr.score_pct),1) AS avg_score,
        SUM(CASE WHEN tr.passed THEN 1 ELSE 0 END) AS passed_count,
        CASE WHEN AVG(tr.score_pct) >= 60 THEN true ELSE false END AS cohort_passed
      FROM tablet_sessions ts
      LEFT JOIN schools s ON s.identifier ILIKE ts.school_identifier
      LEFT JOIN tablet_results tr ON tr.session_id=ts.id
      ${where}
      GROUP BY ts.id,ts.pin_code,ts.school_identifier,ts.level,ts.created_at,s.name
      ORDER BY ts.created_at DESC LIMIT 200
    `, params);
    res.json({ sessions: r.rows });
  } catch(err) { res.status(500).json({ error: err.message, sessions: [] }); }
});

router.get('/api/results/session/:id', async (req, res) => {
  try {
    const sess = await db.pool.query(`SELECT ts.*, s.name AS school_name FROM tablet_sessions ts LEFT JOIN schools s ON s.identifier ILIKE ts.school_identifier WHERE ts.id=$1`, [req.params.id]);
    const students = await db.pool.query(`SELECT * FROM tablet_results WHERE session_id=$1 ORDER BY completed_at`, [req.params.id]);
    const rows = students.rows;
    const avg  = rows.length ? Math.round(rows.reduce((a,r)=>a+parseFloat(r.score_pct),0)/rows.length) : 0;
    res.json({ session: sess.rows[0], students: rows, avgScore: avg, cohortPassed: avg >= 80 });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.get('/api/results/school/:identifier', async (req, res) => {
  try {
    const r = await db.pool.query(`
      SELECT tr.student_name, COUNT(*) AS sessions_taken, ROUND(AVG(tr.score_pct),1) AS avg_score,
        MAX(tr.score_pct) AS best_score,
        SUM(CASE WHEN tr.passed THEN 1 ELSE 0 END) AS times_passed, MAX(tr.completed_at) AS last_assessed
      FROM tablet_results tr WHERE tr.school_identifier ILIKE $1
      GROUP BY tr.student_name ORDER BY avg_score DESC
    `, [req.params.identifier]);
    res.json({ students: r.rows });
  } catch(err) { res.status(500).json({ error: err.message }); }
});
// ── Level Advancement Console APIs ───────────────────────────────────────────
router.get('/api/console/schools-progress', async (req, res) => {
  try {
    const r = await db.pool.query(`
      SELECT 
        s.id, s.name, s.identifier, s.region, s.province,
        NULL AS year, NULL AS section,
        cl.current_level, cl.subject, cl.status,
        cl.lessons_completed, cl.total_lessons, cl.last_assessment,
        rc.name AS regional_coordinator,
        sc.name AS school_coordinator
      FROM schools s
      LEFT JOIN cohort_levels cl ON cl.school_identifier = s.identifier
      LEFT JOIN regional_coordinators rc ON rc.id = s.regional_coordinator_id
      LEFT JOIN school_coordinators   sc ON sc.id = s.school_coordinator_id
      WHERE s.identifier IS NOT NULL
      ORDER BY s.region, s.name
    `);
    res.json({ schools: r.rows });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/console/advance-level', async (req, res) => {
  try {
    const { school_identifier, subject } = req.body;
    if (!school_identifier) return res.status(400).json({ error: 'school_identifier required' });

    const current = await db.pool.query(`
      SELECT current_level FROM cohort_levels
      WHERE school_identifier=$1 AND subject=$2
    `, [school_identifier, subject || 'All']);

    if (!current.rows.length) return res.status(404).json({ error: 'School cohort not found' });

    const newLevel = parseInt(current.rows[0].current_level) + 1;

    await db.pool.query(`
      UPDATE cohort_levels SET current_level=$1, last_assessment=NOW(), updated_at=NOW()
      WHERE school_identifier=$2 AND subject=$3
    `, [newLevel, school_identifier, subject || 'All']);

    res.json({ success: true, new_level: newLevel, school_identifier });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.get('/api/console/level-history', async (req, res) => {
  try {
    const { school } = req.query;
    if (!school) return res.status(400).json({ error: 'school identifier required' });

    const r = await db.pool.query(`
      SELECT a.level, a.subject, a.score_pct, a.passed,
             a.completed_at, ar.status AS advancement_status
      FROM assessments a
      LEFT JOIN advancement_requests ar ON ar.assessment_id = a.id
      WHERE a.school_id = (
        SELECT id FROM schools WHERE identifier ILIKE $1 LIMIT 1
      )
      ORDER BY a.completed_at DESC LIMIT 50
    `, [school]);

    res.json({ history: r.rows });
  } catch(err) { res.status(500).json({ error: err.message }); }
});
router.get('/api/questions/count', async (req, res) => {
  try {
    const { level, subject } = req.query;
    let query = 'SELECT COUNT(*) FROM questions WHERE active=1';
    const params = [];
    if (level)   { params.push(parseInt(level)); query += ` AND level=$${params.length}`; }
    if (subject) { params.push(subject);          query += ` AND subject ILIKE $${params.length}`; }
    const r = await db.pool.query(query, params);
    res.json({ count: parseInt(r.rows[0].count) });
  } catch(err) { res.status(500).json({ count: 0, error: err.message }); }
});

// ── Assessment Dashboard API ──────────────────────────────────────────────────
router.get('/api/assessment-dashboard', async (req, res) => {
  try {
    const { from, to, year, month, week, rc, coordinator, grade, level, subject, student, school } = req.query;

    // ── Date range resolution ──
    const today = new Date();
    const fmt   = d => d.toISOString().split('T')[0];
    let dateFrom, dateTo = fmt(today);

    if (year && month) {
      const y = parseInt(year), m = parseInt(month);
      dateFrom = fmt(new Date(y, m - 1, 1));
      dateTo   = fmt(new Date(y, m, 0));
    } else if (year) {
      dateFrom = `${year}-01-01`;
      dateTo   = `${year}-12-31`;
    } else if (week) {
      const d = new Date(today);
      d.setDate(d.getDate() - 6);
      dateFrom = fmt(d);
    } else if (from) {
      dateFrom = from;
      dateTo   = to || fmt(today);
    } else {
      const d = new Date(today); d.setDate(d.getDate() - 29);
      dateFrom = fmt(d);
    }

    // ── Grade → level range ──
    let gradeWhere       = '';
    let gradeWhereTablet = '';
    if (grade === 'Primary')    { gradeWhere = ' AND sa.level BETWEEN 1 AND 5';  gradeWhereTablet = ' AND tr.level BETWEEN 1 AND 5'; }
    if (grade === 'Elementary') { gradeWhere = ' AND sa.level BETWEEN 6 AND 11'; gradeWhereTablet = ' AND tr.level BETWEEN 6 AND 11'; }

    // ── Portal assessments (student_assessments table) ──
    let portalParams = [dateFrom, dateTo];
    let portalWhere  = gradeWhere;
    if (level)   { portalParams.push(parseInt(level));  portalWhere += ` AND level=$${portalParams.length}`; }
    if (subject) { portalParams.push(subject);           portalWhere += ` AND subject ILIKE $${portalParams.length}`; }
    if (student) { portalParams.push('%'+student+'%');   portalWhere += ` AND student_name ILIKE $${portalParams.length}`; }
    if (school)  { portalParams.push('%'+school+'%');    portalWhere += ` AND s.name ILIKE $${portalParams.length}`; }

    let portalRows = [];
    try {
      const portalQ = await db.pool.query(`
        SELECT
          sa.id,
          sa.student_name,
          COALESCE(s.name, 'Unknown School')            AS school_name,
          COALESCE(s.identifier,'—')                    AS school_identifier,
          COALESCE(s.region,'—')                        AS region,
          COALESCE(s.province,'—')                      AS province,
          COALESCE(sa.teacher_phone,'—')                AS teacher_name,
          COALESCE(rc.name,'—')                         AS rc_name,
          COALESCE(sc.name,'—')                         AS coordinator_name,
          COALESCE(sa.subject,'—')                      AS subject,
          sa.level,
          CASE WHEN sa.level BETWEEN 1 AND 5 THEN 'Primary' ELSE 'Elementary' END AS grade,
          NULL::text                                    AS semester,
          sa.score_pct,
          sa.passed,
          sa.total_questions,
          sa.correct_answers,
          sa.completed_at,
          'portal'                                      AS source
        FROM student_assessments sa
        LEFT JOIN schools s ON s.id = sa.school_id
        LEFT JOIN regional_coordinators rc ON rc.id = s.regional_coordinator_id
        LEFT JOIN school_coordinators   sc ON sc.id = s.school_coordinator_id
        WHERE sa.completed_at::date BETWEEN $1::date AND $2::date
          AND (sa.score_pct IS NOT NULL AND sa.score_pct > 0)
          ${portalWhere}
        ORDER BY sa.completed_at DESC
        LIMIT 2000
      `, portalParams);
      portalRows = portalQ.rows;
    } catch(e) { console.log('portal query skip:', e.message); }

    // ── Tablet assessments (tablet_results table) ──
    let tabletParams = [dateFrom, dateTo];
    let tabletWhere  = gradeWhereTablet;
    if (level)   { tabletParams.push(parseInt(level));  tabletWhere += ` AND tr.level=$${tabletParams.length}`; }
    if (subject) { tabletParams.push(subject);           tabletWhere += ` AND ts.subject ILIKE $${tabletParams.length}`; }
    if (student) { tabletParams.push('%'+student+'%');   tabletWhere += ` AND tr.student_name ILIKE $${tabletParams.length}`; }
    if (school)  { tabletParams.push('%'+school+'%');    tabletWhere += ` AND s.name ILIKE $${tabletParams.length}`; }

    let tabletRows = [];
    try {
      const tabletQ = await db.pool.query(`
        SELECT
          tr.id,
          tr.student_name,
          COALESCE(s.name, tr.school_identifier)        AS school_name,
          tr.school_identifier,
          COALESCE(s.region,'—')                        AS region,
          COALESCE(s.province,'—')                      AS province,
          COALESCE(ts.created_by,'—')                   AS teacher_name,
          COALESCE(rc.name,'—')                         AS rc_name,
          COALESCE(sc.name,'—')                         AS coordinator_name,
          COALESCE(ts.subject,'—')                      AS subject,
          tr.level,
          CASE WHEN tr.level BETWEEN 1 AND 5 THEN 'Primary' ELSE 'Elementary' END AS grade,
          NULL::text                                    AS semester,
          tr.score_pct,
          tr.passed,
          tr.total_questions,
          tr.correct_answers,
          tr.completed_at,
          'tablet'                                      AS source
        FROM tablet_results tr
        LEFT JOIN tablet_sessions    ts ON ts.id = tr.session_id
        LEFT JOIN schools             s ON s.identifier ILIKE tr.school_identifier
        LEFT JOIN regional_coordinators rc ON rc.id = s.regional_coordinator_id
        LEFT JOIN school_coordinators   sc ON sc.id = s.school_coordinator_id
        WHERE tr.completed_at::date BETWEEN $1::date AND $2::date
          ${tabletWhere}
        ORDER BY tr.completed_at DESC
        LIMIT 2000
      `, tabletParams);
      tabletRows = tabletQ.rows;
    } catch(e) { console.log('tablet query skip:', e.message); }

    // ── Merge & sort ──
    let results = [...portalRows, ...tabletRows]
      .sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at));

    // ── Post-query filters (RC, coordinator) ──
    if (rc)          results = results.filter(r => r.rc_name === rc);
    if (coordinator) results = results.filter(r => r.coordinator_name === coordinator);

    // ── Build filter option lists from full unfiltered set ──
    const all = [...portalRows, ...tabletRows];
    const uniq = arr => [...new Set(arr.filter(Boolean))].sort();
    const filterOptions = {
      rcs:          uniq(all.map(r => r.rc_name).filter(v => v !== '—')),
      coordinators: uniq(all.map(r => r.coordinator_name).filter(v => v !== '—')),
      schools:      uniq(all.map(r => r.school_name).filter(v => v !== '—')),
      subjects:     uniq(all.map(r => r.subject).filter(v => v !== '—')),
      levels:       [...new Set(all.map(r => r.level).filter(Boolean))].sort((a,b)=>a-b),
    };

    // ── Stats ──
    const total    = results.length;
    const passed   = results.filter(r => r.passed).length;
    const avgScore = total ? Math.round(results.reduce((a,r) => a + parseFloat(r.score_pct||0), 0) / total) : 0;
    const passRate = total ? Math.round(passed / total * 100) : 0;

    res.json({ results, total, passed, failed: total - passed, avgScore, passRate, filterOptions, dateFrom, dateTo });
  } catch(err) {
    console.log('assessment-dashboard error:', err.message);
    res.status(500).json({ error: err.message, results: [], total:0, passed:0, failed:0, avgScore:0, passRate:0, filterOptions:{} });
  }
});

// ── /portal/offline/submit — save result from offline portal assessment ────────
router.post('/portal/offline/submit', async (req, res) => {
  try {
    const {
      pin, student_name, student_id,
      subject, level, score, total, pct, passed,
      overall_pct, overall_passed,
      timestamp, submission_mode,
      gps_lat, gps_lng, gps_accuracy,
    } = req.body;

    if (!pin || !student_name) {
      return res.status(400).json({ error: 'pin and student_name required' });
    }

    // Look up PIN to get school + session info
    let pinRecord = null;
    try {
      const pinRes = await db.pool.query(
        `SELECT * FROM pins WHERE pin_code = $1 LIMIT 1`,
        [pin.toUpperCase()]
      );
      if (pinRes.rows.length) pinRecord = pinRes.rows[0];
    } catch(e) {
      // Try tablet_sessions as fallback
      try {
        const sessRes = await db.pool.query(
          `SELECT * FROM tablet_sessions WHERE pin_code = $1 LIMIT 1`, [pin]
        );
        if (sessRes.rows.length) pinRecord = { school_id: null, school_identifier: sessRes.rows[0].school_identifier, level };
      } catch(e2) {}
    }

    // Auto-create student_assessments table if needed
    await db.pool.query(`
      CREATE TABLE IF NOT EXISTS student_assessments (
        id SERIAL PRIMARY KEY,
        pin_id INTEGER, school_id INTEGER,
        teacher_phone VARCHAR(20), student_name VARCHAR(100),
        student_id VARCHAR(50),
        level INTEGER, subject VARCHAR(30),
        total_questions INTEGER DEFAULT 0,
        correct_answers INTEGER DEFAULT 0,
        score_pct NUMERIC(5,2) DEFAULT 0,
        passed BOOLEAN DEFAULT FALSE,
        overall_pct NUMERIC(5,2),
        overall_passed BOOLEAN,
        answers_detail JSONB,
        recommendation TEXT,
        submission_mode TEXT DEFAULT 'offline',
        gps_lat NUMERIC(10,7), gps_lng NUMERIC(10,7), gps_accuracy INTEGER,
        completed_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await db.pool.query(`
      INSERT INTO student_assessments
        (pin_id, school_id, student_name, student_id, level, subject,
         total_questions, correct_answers, score_pct, passed,
         overall_pct, overall_passed,
         submission_mode, gps_lat, gps_lng, gps_accuracy, completed_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
    `, [
      pinRecord?.id     || null,
      pinRecord?.school_id || null,
      student_name,
      student_id || null,
      parseInt(level) || 1,
      subject || 'Unknown',
      parseInt(total)  || 0,
      parseInt(score)  || 0,
      parseFloat(pct)  || 0,
      passed || false,
      parseFloat(overall_pct)  || null,
      overall_passed || null,
      submission_mode || 'offline',
      gps_lat     || null,
      gps_lng     || null,
      gps_accuracy ? parseInt(gps_accuracy) : null,
      timestamp ? new Date(timestamp) : new Date(),
    ]);

    return res.json({ saved: true });
  } catch (err) {
    console.error('[portal/offline/submit] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── /api/assess/bundle/:pin — returns session + questions in one call for offline caching ──
router.get('/api/assess/bundle/:pin', async (req, res) => {
  try {
    // 1. Validate session
    const sessResult = await db.pool.query(`
      SELECT ts.*, s.name AS school_name
      FROM tablet_sessions ts
      LEFT JOIN schools s ON s.identifier ILIKE ts.school_identifier
      WHERE ts.pin_code=$1 AND ts.active=TRUE AND ts.expires_at>NOW()
    `, [req.params.pin]);

    if (!sessResult.rows.length) {
      return res.status(404).json({ error: 'Invalid or expired PIN' });
    }
    const session = sessResult.rows[0];

    // 2. Load questions (same logic as /api/assess/questions/:pin)
    const subjectList = session.subject && session.subject !== 'All'
      ? session.subject.split(',').map(x => x.trim())
      : ['Math', 'English', 'Urdu'];

    let allQuestions = [];
    if (parseInt(session.level) === 12) {
      const qs = await db.pool.query(`
        SELECT question_id AS id, COALESCE(q_text_english,q_text_urdu) AS question_text,
               q_text_urdu, q_text_english, option_a,option_b,option_c,option_d,
               correct_option, subject, level, image_url
        FROM questions WHERE active=1 AND level BETWEEN 1 AND 11
        ORDER BY RANDOM() LIMIT $1
      `, [QUESTIONS_PER_SESSION * subjectList.length]);
      allQuestions = qs.rows;
    } else {
      for (const subj of subjectList) {
        const qs = await db.pool.query(`
          SELECT question_id AS id, COALESCE(q_text_english,q_text_urdu) AS question_text,
                 q_text_urdu, q_text_english, option_a,option_b,option_c,option_d,
                 correct_option, subject, level, image_url
          FROM questions WHERE active=1 AND level=$1::integer AND subject ILIKE $2
          ORDER BY RANDOM() LIMIT $3
        `, [parseInt(session.level), subj, QUESTIONS_PER_SESSION]);

        if (qs.rows.length === 0) {
          const fallback = await db.pool.query(`
            SELECT question_id AS id, COALESCE(q_text_english,q_text_urdu) AS question_text,
                   q_text_urdu, q_text_english, option_a,option_b,option_c,option_d,
                   correct_option, subject, level, image_url
            FROM questions WHERE active=1 AND subject ILIKE $1
            ORDER BY RANDOM() LIMIT $2
          `, [subj, QUESTIONS_PER_SESSION]);
          allQuestions = allQuestions.concat(fallback.rows);
        } else {
          allQuestions = allQuestions.concat(qs.rows);
        }
      }
    }

    if (allQuestions.length < 1) {
      return res.status(400).json({ error: 'No questions available for this level/subject.' });
    }

    const questions = allQuestions.map(q => ({
      id:             q.id,
      question_text:  q.question_text,
      q_text_urdu:    q.q_text_urdu,
      q_text_english: q.q_text_english,
      subject:        q.subject,
      level:          q.level,
      image_url:      q.image_url || null,
      option_a:       q.option_a,
      option_b:       q.option_b,
      option_c:       q.option_c,
      option_d:       q.option_d,
      correct_option: (q.correct_option || 'A').toUpperCase(),
    }));

    // Return session + questions together — client caches this for offline use
    res.json({ session, questions, subjects: subjectList, cachedAt: new Date().toISOString() });

  } catch (err) {
    console.error('[assess/bundle] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── /api/assess/sync — accept single or batched offline results ───────────────
router.post('/api/assess/sync', async (req, res) => {
  try {
    const payload = req.body;
    if (!payload || !payload.pin || !payload.student_name) {
      return res.status(400).json({ saved: false, error: 'pin and student_name required' });
    }

    const { pin, student_name, answers, score_pct, correct, total, passed, submission_mode, submitted_at } = payload;

    // Validate PIN exists (even expired — offline submissions may arrive late)
    const sess = await db.pool.query(
      `SELECT * FROM tablet_sessions WHERE pin_code=$1 LIMIT 1`, [pin]
    );
    if (!sess.rows.length) {
      return res.status(404).json({ saved: false, error: 'Session PIN not found' });
    }
    const s = sess.rows[0];

    // Recalculate score from answers if provided, otherwise use pre-calculated values
    let finalCorrect = correct || 0;
    let finalTotal   = total || (answers?.length || 0);
    let finalScore   = score_pct || 0;
    let finalPassed  = passed || false;

    if (answers && answers.length > 0) {
      finalCorrect = 0;
      for (const a of answers) {
        if ((a.selected_option || '').toUpperCase().trim() === (a.correct_option || '').toUpperCase().trim()) {
          finalCorrect++;
        }
      }
      finalTotal  = answers.length;
      finalScore  = Math.round(finalCorrect / finalTotal * 100);
      finalPassed = finalScore >= (PASS_THRESHOLD || 60);
    }

    // Save to tablet_results
    try {
      await db.pool.query(`
        INSERT INTO tablet_results
          (session_id, student_name, school_identifier, level,
           total_questions, correct_answers, score_pct, passed,
           submission_mode, completed_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT DO NOTHING
      `, [
        s.id, student_name, s.school_identifier, s.level,
        finalTotal, finalCorrect, finalScore, finalPassed,
        submission_mode || 'offline',
        submitted_at ? new Date(submitted_at) : new Date(),
      ]);
    } catch(e) {
      // Add submission_mode column if missing
      try {
        await db.pool.query(`ALTER TABLE tablet_results ADD COLUMN IF NOT EXISTS submission_mode TEXT DEFAULT 'online'`);
        await db.pool.query(`
          INSERT INTO tablet_results
            (session_id, student_name, school_identifier, level,
             total_questions, correct_answers, score_pct, passed, completed_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
          ON CONFLICT DO NOTHING
        `, [s.id, student_name, s.school_identifier, s.level, finalTotal, finalCorrect, finalScore, finalPassed,
            submitted_at ? new Date(submitted_at) : new Date()]);
      } catch(e2) {
        console.log('[assess/sync] tablet_results save note:', e2.message);
      }
    }

    // Save individual answers to tablet_responses
    if (answers && answers.length > 0) {
      for (const a of answers) {
        try {
          const isCorrect = (a.selected_option || '').toUpperCase().trim() === (a.correct_option || '').toUpperCase().trim();
          await db.pool.query(`
            INSERT INTO tablet_responses
              (session_id, student_name, school_identifier, level,
               question_id, selected_option, correct_option, is_correct, time_taken_secs)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
          `, [s.id, student_name, s.school_identifier, s.level,
              a.question_id, a.selected_option, a.correct_option, isCorrect, a.time_taken_secs || 0]);
        } catch(e) { /* non-fatal */ }
      }
    }

    res.json({
      saved:   true,
      score_pct: finalScore,
      correct:   finalCorrect,
      total:     finalTotal,
      passed:    finalPassed,
      submission_mode: submission_mode || 'offline',
    });

  } catch (err) {
    console.error('[assess/sync] error:', err.message);
    res.status(500).json({ saved: false, error: err.message });
  }
});

module.exports = { router };
