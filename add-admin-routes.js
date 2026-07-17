// add-admin-routes.js
// Adds all missing dashboard API routes to routes/admin.js
// Run from takmil-bot folder: node add-admin-routes.js

const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'routes', 'admin.js');
let content = fs.readFileSync(filePath, 'utf8');

if (content.includes('// ── DASHBOARD API ROUTES (auto-added)')) {
  console.log('Routes already added. Nothing to do.');
  process.exit(0);
}

const newRoutes = `

// ── DASHBOARD API ROUTES (auto-added) ────────────────────────────────────────

// Analytics summary for dashboard
router.get('/admin/analytics', async (req, res) => {
  try {
    const summary = await db.pool.query(\`
      SELECT
        COUNT(*)::int                                                      AS total_assessments,
        COUNT(DISTINCT school_id)::int                                     AS schools_assessed,
        ROUND(AVG(score_pct)::numeric, 1)::float                          AS avg_score,
        COUNT(CASE WHEN passed = true  THEN 1 END)::int                   AS passed_count,
        COUNT(CASE WHEN passed = false THEN 1 END)::int                   AS failed_count
      FROM student_assessments
    \`);

    const bySubject = await db.pool.query(\`
      SELECT subject,
             COUNT(*)::int                                     AS count,
             ROUND(AVG(score_pct)::numeric, 1)::float         AS avg_score
      FROM student_assessments
      GROUP BY subject ORDER BY count DESC
    \`);

    const byLevel = await db.pool.query(\`
      SELECT level,
             COUNT(*)::int                                              AS count,
             ROUND(AVG(score_pct)::numeric, 1)::float                 AS avg_score,
             COUNT(CASE WHEN passed = true THEN 1 END)::int           AS passed
      FROM student_assessments
      GROUP BY level ORDER BY level
    \`);

    let advCount = 0;
    try {
      const adv = await db.pool.query(
        \`SELECT COUNT(*)::int AS n FROM advancement_requests WHERE status='approved'\`
      );
      advCount = adv.rows[0]?.n || 0;
    } catch(e) {
      try {
        const adv2 = await db.pool.query(
          \`SELECT COUNT(*)::int AS n FROM advancement_requests WHERE approved=true\`
        );
        advCount = adv2.rows[0]?.n || 0;
      } catch(e2) {}
    }

    const s = summary.rows[0];
    s.advancements_approved = advCount;
    res.json({ summary: s, bySubject: bySubject.rows, byLevel: byLevel.rows });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// All student results with school info
router.get('/admin/students/results', async (req, res) => {
  try {
    const result = await db.pool.query(\`
      SELECT sa.*,
             s.name     AS school_name,
             s.province
      FROM student_assessments sa
      LEFT JOIN schools s ON sa.school_id = s.id
      ORDER BY COALESCE(sa.completed_at, sa.assessed_at) DESC NULLS LAST
    \`);
    res.json(result.rows);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Schools list
router.get('/admin/schools/list', async (req, res) => {
  try {
    const result = await db.pool.query(
      \`SELECT * FROM schools ORDER BY name\`
    );
    res.json(result.rows);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Add school
router.post('/admin/schools', async (req, res) => {
  try {
    const { name, province, district, contactName, contactPhone } = req.body;
    const result = await db.pool.query(
      \`INSERT INTO schools (name, province, district, contact_name, contact_phone)
       VALUES ($1,$2,$3,$4,$5) RETURNING *\`,
      [name, province, district, contactName, contactPhone]
    );
    res.json(result.rows[0]);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Pins list
router.get('/admin/pins/list', async (req, res) => {
  try {
    const result = await db.pool.query(\`
      SELECT p.*, s.name AS school_name
      FROM pins p
      LEFT JOIN schools s ON p.school_id = s.id
      ORDER BY p.id DESC LIMIT 200
    \`);
    res.json(result.rows);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Generate PIN
router.post('/admin/pins/generate', async (req, res) => {
  try {
    const { schoolId, level, subject, cohortSize, issuedBy } = req.body;
    const pin = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const result = await db.pool.query(
      \`INSERT INTO pins (pin, school_id, level, subject, cohort_size, issued_by, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *\`,
      [pin, schoolId, level, subject, cohortSize || 1, issuedBy || 'Admin', expiresAt]
    );
    res.json({ pin, expiresAt, record: result.rows[0] });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// All assessments with school info
router.get('/admin/assessments/all', async (req, res) => {
  try {
    const result = await db.pool.query(\`
      SELECT sa.*,
             s.name AS school_name
      FROM student_assessments sa
      LEFT JOIN schools s ON sa.school_id = s.id
      ORDER BY COALESCE(sa.completed_at, sa.assessed_at) DESC NULLS LAST
      LIMIT 500
    \`);
    res.json(result.rows);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Advancements list
router.get('/admin/advancements/list', async (req, res) => {
  try {
    const result = await db.pool.query(\`
      SELECT ar.*, s.name AS school_name
      FROM advancement_requests ar
      LEFT JOIN schools s ON ar.school_id = s.id
      ORDER BY ar.id DESC
    \`);
    res.json(result.rows);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Ops team list
router.get('/admin/ops/list', async (req, res) => {
  try {
    const result = await db.pool.query(\`SELECT * FROM ops_team ORDER BY id DESC\`);
    res.json(result.rows);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Add ops member
router.post('/admin/ops', async (req, res) => {
  try {
    const { phone, name, role } = req.body;
    const result = await db.pool.query(
      \`INSERT INTO ops_team (phone, name, role) VALUES ($1,$2,$3) RETURNING *\`,
      [phone, name, role]
    );
    res.json(result.rows[0]);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Reassessments list
router.get('/admin/reassessments/list', async (req, res) => {
  try {
    const result = await db.pool.query(\`
      SELECT rs.*, s.name AS school_name
      FROM reassessment_schedule rs
      LEFT JOIN schools s ON rs.school_id = s.id
      ORDER BY rs.scheduled_date DESC
    \`);
    res.json(result.rows);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Approve-all pending questions
router.post('/admin/questions/approve-all', async (req, res) => {
  try {
    const result = await db.pool.query(
      \`UPDATE questions SET active=1 WHERE (active=0 OR active IS NULL) RETURNING id\`
    );
    res.json({ approved: result.rows.length });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Approve by question_id string
router.post('/admin/questions/approve-by-qid', async (req, res) => {
  try {
    const { question_id } = req.body;
    await db.pool.query(
      \`UPDATE questions SET active=1 WHERE question_id=$1\`, [question_id]
    );
    res.json({ ok: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Approve single question by DB id
router.post('/admin/questions/:id/approve', async (req, res) => {
  try {
    await db.pool.query(
      \`UPDATE questions SET active=1 WHERE id=$1\`, [req.params.id]
    );
    res.json({ ok: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Flag question
router.post('/admin/questions/:id/flag', async (req, res) => {
  try {
    await db.pool.query(
      \`UPDATE questions SET active=-1 WHERE id=$1\`, [req.params.id]
    );
    res.json({ ok: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Update question
router.put('/admin/questions/:id', async (req, res) => {
  try {
    const b = req.body;
    await db.pool.query(\`
      UPDATE questions SET
        question_id=$1, topic_tag=$2, level=$3, subject=$4,
        q_text_english=$5, q_text_urdu=$6,
        option_a=$7, option_b=$8, option_c=$9, option_d=$10,
        correct_option=$11, source_type=$12, video_id=$13,
        approved_by=$14,
        active=CASE WHEN $14 IS NOT NULL AND $14 != '' THEN 1 ELSE active END
      WHERE id=$15\`,
      [b.question_id, b.topic_tag, b.level, b.subject,
       b.question_text, b.question_text_ur,
       b.option_a, b.option_b, b.option_c, b.option_d,
       b.correct_option, b.source_type, b.video_id || null,
       b.approved_by || null, req.params.id]
    );
    res.json({ ok: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Create new question
router.post('/admin/questions', async (req, res) => {
  try {
    const b = req.body;
    const result = await db.pool.query(\`
      INSERT INTO questions
        (question_id, topic_tag, level, subject, q_text_english, q_text_urdu,
         option_a, option_b, option_c, option_d, correct_option,
         source_type, video_id, approved_by, active)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      RETURNING id\`,
      [b.question_id, b.topic_tag, b.level, b.subject,
       b.question_text, b.question_text_ur,
       b.option_a, b.option_b, b.option_c, b.option_d,
       b.correct_option, b.source_type, b.video_id || null,
       b.approved_by || null,
       b.approved_by ? 1 : 0]
    );
    res.json({ id: result.rows[0].id });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── Analytics page API (/api/analytics) ──────────────────────────────────────
router.get('/api/analytics', async (req, res) => {
  try {
    const { from, to } = req.query;
    const dateFrom = from || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    const dateTo   = to   || new Date().toISOString().split('T')[0];

    // Daily trend from daily_feedback if it exists, else from student_assessments
    let dailyTrend = [];
    try {
      const dt = await db.pool.query(\`
        SELECT
          DATE(created_at)                                  AS day,
          COUNT(DISTINCT school_id)::int                    AS submissions,
          (SELECT COUNT(*)::int FROM schools)               AS total_schools,
          ROUND(AVG(attendance_pct)::numeric, 1)::float     AS avg_attendance,
          COALESCE(SUM(tech_used::int), 0)::int             AS tech_count,
          COALESCE(SUM(assembly_held::int), 0)::int         AS assembly_count
        FROM daily_feedback
        WHERE DATE(created_at) BETWEEN $1 AND $2
        GROUP BY DATE(created_at)
        ORDER BY day
      \`, [dateFrom, dateTo]);
      dailyTrend = dt.rows;
    } catch(e) {
      // Fallback: build daily trend from student_assessments
      try {
        const dt2 = await db.pool.query(\`
          SELECT
            DATE(COALESCE(completed_at, assessed_at))  AS day,
            COUNT(*)::int                               AS submissions,
            (SELECT COUNT(*)::int FROM schools)         AS total_schools,
            ROUND(AVG(score_pct)::numeric,1)::float     AS avg_attendance,
            0::int                                      AS tech_count,
            0::int                                      AS assembly_count
          FROM student_assessments
          WHERE DATE(COALESCE(completed_at, assessed_at)) BETWEEN $1 AND $2
          GROUP BY DATE(COALESCE(completed_at, assessed_at))
          ORDER BY day
        \`, [dateFrom, dateTo]);
        dailyTrend = dt2.rows;
      } catch(e2) {}
    }

    // RC performance
    let rcPerf = [];
    try {
      const rc = await db.pool.query(\`
        SELECT
          rc.name                                                    AS rc_name,
          rc.region,
          COUNT(DISTINCT s.id)::int                                  AS total_schools,
          COUNT(DISTINCT sa.id)::int                                 AS submissions,
          CASE WHEN COUNT(DISTINCT s.id)>0
            THEN ROUND((COUNT(DISTINCT sa.id)::numeric/COUNT(DISTINCT s.id))*100,1)
            ELSE 0 END::float                                        AS submission_rate,
          ROUND(AVG(sa.score_pct)::numeric,1)::float                AS avg_attendance,
          0::int                                                     AS tech_count,
          0::int                                                     AS assembly_count
        FROM regional_coordinators rc
        LEFT JOIN school_coordinators sc ON sc.regional_coordinator_id = rc.id
        LEFT JOIN schools s ON s.id = sc.school_id
        LEFT JOIN student_assessments sa ON sa.school_id = s.id
          AND DATE(COALESCE(sa.completed_at,sa.assessed_at)) BETWEEN $1 AND $2
        GROUP BY rc.id, rc.name, rc.region
        ORDER BY submission_rate DESC
      \`, [dateFrom, dateTo]);
      rcPerf = rc.rows;
    } catch(e) {}

    // Coordinator performance
    let coordPerf = [];
    try {
      const co = await db.pool.query(\`
        SELECT
          sc.name                                                       AS coord_name,
          rc.name                                                       AS rc_name,
          rc.region,
          COUNT(DISTINCT s.id)::int                                     AS total_schools,
          CASE WHEN COUNT(DISTINCT s.id)>0
            THEN ROUND((COUNT(DISTINCT sa.id)::numeric/COUNT(DISTINCT s.id))*100,1)
            ELSE 0 END::float                                           AS submission_rate,
          ROUND(AVG(sa.score_pct)::numeric,1)::float                   AS avg_attendance,
          0::int                                                        AS tech_count,
          0::int                                                        AS assembly_count
        FROM school_coordinators sc
        LEFT JOIN regional_coordinators rc ON rc.id = sc.regional_coordinator_id
        LEFT JOIN schools s ON s.coordinator_id = sc.id
        LEFT JOIN student_assessments sa ON sa.school_id = s.id
          AND DATE(COALESCE(sa.completed_at,sa.assessed_at)) BETWEEN $1 AND $2
        GROUP BY sc.id, sc.name, rc.name, rc.region
        ORDER BY submission_rate DESC
      \`, [dateFrom, dateTo]);
      coordPerf = co.rows;
    } catch(e) {}

    // School performance
    let schoolPerf = [];
    try {
      const sp = await db.pool.query(\`
        SELECT
          s.name                                                        AS school_name,
          s.province                                                    AS region,
          sc.name                                                       AS coord_name,
          COUNT(sa.id)::int                                             AS submissions,
          CASE WHEN COUNT(sa.id)>0
            THEN ROUND(COUNT(sa.id)::numeric/
              GREATEST(($2::date - $1::date + 1),1)*100,1)
            ELSE 0 END::float                                           AS submission_rate,
          ROUND(AVG(sa.score_pct)::numeric,1)::float                   AS avg_attendance,
          0::int                                                        AS tech_count,
          MAX(COALESCE(sa.completed_at,sa.assessed_at))                AS last_submission
        FROM schools s
        LEFT JOIN school_coordinators sc ON sc.id = s.coordinator_id
        LEFT JOIN student_assessments sa ON sa.school_id = s.id
          AND DATE(COALESCE(sa.completed_at,sa.assessed_at)) BETWEEN $1 AND $2
        GROUP BY s.id, s.name, s.province, sc.name
        ORDER BY submissions DESC
      \`, [dateFrom, dateTo]);
      schoolPerf = sp.rows;
    } catch(e) {}

    res.json({ dailyTrend, rcPerf, coordPerf, schoolPerf });
  } catch(err) { res.status(500).json({ error: err.message }); }
});
`;

// Find the last line and append before it (before module.exports)
if (content.includes('module.exports')) {
  content = content.replace(/module\.exports\s*=/, newRoutes + '\nmodule.exports =');
} else {
  content = content + newRoutes;
}

fs.writeFileSync(filePath, content, 'utf8');
console.log('✅ All dashboard API routes added to routes/admin.js');
console.log('\nNow run:');
console.log('git add routes/admin.js');
console.log('git commit -m "Add missing dashboard and analytics API routes"');
console.log('git push');
