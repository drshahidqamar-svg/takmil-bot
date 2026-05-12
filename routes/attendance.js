// routes/attendance.js — Daily Feedback, Analytics, Student Attendance Register
// Portals: /feedback, /analytics, /register, /attendance
// APIs: /api/feedback, /api/analytics, /api/register/*

const router = require('express').Router();
const db     = require('../database');
const path   = require('path');

// ── Feedback message detection ────────────────────────────────────────────────
function isFeedbackMessage(text) {
  const t = text.toLowerCase();
  const hasAttendance = t.includes('present') && t.includes('absent');
  const hasSubject    = t.includes('subject') || t.includes('lesson no');
  const hasCheckin    = t.includes('check in') || t.includes('check-in') || t.includes('check out');
  const hasDate       = t.includes('date :') || t.includes('date:');
  const hasGrade      = t.includes('grade') || t.includes('level');
  return (hasAttendance && hasSubject) ||
         (hasCheckin && hasAttendance) ||
         (hasDate && hasAttendance && hasGrade);
}

// ── Daily feedback parser ─────────────────────────────────────────────────────
function parseFeedback(text, teacherPhone) {
  const val  = line => { const idx = line.indexOf(':'); return idx >= 0 ? line.slice(idx + 1).trim().replace(/\*/g, '').trim() : ''; };
  const bool = v => /^yes$/i.test(v.trim());
  const num  = v => { const n = parseInt(v); return isNaN(n) ? null : n; };

  const lines = text.split('\n').map(l => l.replace(/\*/g, '').trim()).filter(Boolean);

  const fb = {
    teacher_phone:     teacherPhone,
    school_name:       null,
    report_date:       null,
    check_in:          null,
    check_out:         null,
    grade:             null,
    level:             null,
    total_strength:    null,
    boys:              null,
    girls:             null,
    present:           null,
    absent:            null,
    leave_count:       null,
    assembly_conducted:false,
    child_of_day:      null,
    technology_used:   false,
    technology_reason: null,
    cr_media_shared:   false,
    tech_media_shared: false,
    subjects:          [],
    raw_message:       text,
    projector_shown:   null,
  };

  let currentSubject = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^check.?in/i.test(line))              { fb.check_in           = val(line); continue; }
    if (/^check.?out/i.test(line))             { fb.check_out          = val(line); continue; }
    if (/^date/i.test(line))                   { fb.report_date        = val(line); continue; }
    if (/^grade/i.test(line))                  { fb.grade              = val(line); continue; }
    if (/^level/i.test(line))                  { fb.level              = num(val(line)); continue; }
    if (/^total.?strength/i.test(line))        { fb.total_strength     = num(val(line)); continue; }
    if (/^boys/i.test(line))                   { fb.boys               = num(val(line)); continue; }
    if (/^girls/i.test(line))                  { fb.girls              = num(val(line)); continue; }
    if (/^present/i.test(line))                { fb.present            = num(val(line)); continue; }
    if (/^absent/i.test(line))                 { fb.absent             = num(val(line)); continue; }
    if (/^leave/i.test(line))                  { fb.leave_count        = num(val(line)); continue; }
    if (/^assembly.?conducted/i.test(line))    { fb.assembly_conducted = bool(val(line)); continue; }
    if (/^projector.?shown/i.test(line))       { fb.projector_shown    = bool(val(line)); continue; }
    if (/^name.?child/i.test(line))            { fb.child_of_day       = val(line); continue; }
    if (/^technology.?used/i.test(line))       { fb.technology_used    = bool(val(line)); continue; }
    if (/^if.?no.?reason/i.test(line))         { fb.technology_reason  = lines[i+1] || val(line); continue; }
    if (/^class.?room.*media/i.test(line))     { fb.cr_media_shared    = bool(val(line)); continue; }
    if (/^technology.*tech.*media/i.test(line)){ fb.tech_media_shared  = bool(val(line)); continue; }
    if (/^subject\s*:/i.test(line)) {
      if (currentSubject) fb.subjects.push(currentSubject);
      currentSubject = { subject: val(line), unit: null, lesson_no: null, topic: null, activity: null };
      continue;
    }
    if (currentSubject) {
      if (/^unit/i.test(line))       { currentSubject.unit      = val(line); continue; }
      if (/^lesson.?no/i.test(line)) { currentSubject.lesson_no = val(line); continue; }
      if (/^topic/i.test(line))      { currentSubject.topic     = val(line); continue; }
      if (/^activity/i.test(line))   { currentSubject.activity  = val(line); continue; }
    }
  }
  if (currentSubject) fb.subjects.push(currentSubject);

  if (fb.report_date) {
    const parts = fb.report_date.split('/');
    if (parts.length === 3) {
      const [a, b, y] = parts;
      // Try DD/MM/YYYY (Pakistani standard) and MM/DD/YYYY (US format)
      const ddmm = `${y}-${b.padStart(2,'0')}-${a.padStart(2,'0')}`;
      const mmdd = `${y}-${a.padStart(2,'0')}-${b.padStart(2,'0')}`;
      const today     = new Date();
      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      // If DD/MM puts date more than 7 days in the future, use MM/DD instead
      if ((new Date(ddmm) - today) > sevenDays && (new Date(mmdd) - today) <= sevenDays) {
        fb.report_date = mmdd;
      } else {
        fb.report_date = ddmm;
      }
    }
  } else {
    fb.report_date = new Date().toISOString().split('T')[0];
  }

  return fb;
}

// ── Save feedback to DB ───────────────────────────────────────────────────────
async function saveFeedback(fb) {
  let schoolName = null, schoolId = null;
  try {
    const sr = await db.pool.query(
      `SELECT id, name, identifier FROM schools WHERE teacher_phone=$1 LIMIT 1`,
      [fb.teacher_phone.replace('whatsapp:','')]
    );
    if (sr.rows[0]) {
      schoolName = sr.rows[0].name;
      schoolId   = sr.rows[0].id;
      fb.school_name = schoolName;
      fb.school_identifier = sr.rows[0].identifier;
    }
  } catch(e) {}

  await db.pool.query(`
    INSERT INTO daily_feedback
      (teacher_phone, school_name, school_identifier, report_date,
       check_in, check_out, grade, level, total_strength,
       boys, girls, present, absent, leave_count,
       assembly_conducted, child_of_day, technology_used, technology_reason,
       cr_media_shared, tech_media_shared, subjects, raw_message, projector_shown)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
    ON CONFLICT DO NOTHING`,
    [fb.teacher_phone, fb.school_name||null, fb.school_identifier||null,
     fb.report_date, fb.check_in, fb.check_out,
     fb.grade, fb.level, fb.total_strength,
     fb.boys, fb.girls, fb.present, fb.absent, fb.leave_count,
     fb.assembly_conducted, fb.child_of_day,
     fb.technology_used, fb.technology_reason,
     fb.cr_media_shared, fb.tech_media_shared,
     JSON.stringify(fb.subjects), fb.raw_message, fb.projector_shown ?? null]
  );
}

// ── HTML pages ────────────────────────────────────────────────────────────────
router.get('/analytics',  (req, res) => res.sendFile(path.join(__dirname, '../analytics.html')));
router.get('/feedback',   (req, res) => res.sendFile(path.join(__dirname, '../feedback.html')));
router.get('/register',   (req, res) => res.sendFile(path.join(__dirname, '../register.html')));
router.get('/register-sw.js', (req, res) => res.sendFile(path.join(__dirname, '../register-sw.js')));
router.get('/attendance', (req, res) => res.sendFile(path.join(__dirname, '../attendance-dashboard.html')));

// ── Analytics API ─────────────────────────────────────────────────────────────
router.get('/api/analytics', async (req, res) => {
  try {
    const { from, to } = req.query;
    const dateFrom = from || new Date(Date.now() - 29*24*60*60*1000).toISOString().split('T')[0];
    const dateTo   = to   || new Date().toISOString().split('T')[0];

    const dailyTrend = await db.pool.query(`
      SELECT f.report_date::date AS day,
        COUNT(DISTINCT f.id) AS submissions,
        (SELECT COUNT(*) FROM schools WHERE identifier IS NOT NULL) AS total_schools,
        ROUND(AVG(f.present * 100.0 / NULLIF(f.total_strength, 0)), 1) AS avg_attendance,
        SUM(CASE WHEN f.technology_used THEN 1 ELSE 0 END)    AS tech_count,
        SUM(CASE WHEN f.assembly_conducted THEN 1 ELSE 0 END) AS assembly_count
      FROM daily_feedback f
      WHERE f.report_date BETWEEN $1 AND $2
      GROUP BY f.report_date::date ORDER BY day ASC
    `, [dateFrom, dateTo]);

    const rcPerf = await db.pool.query(`
      SELECT rc.name AS rc_name, rc.region,
        COUNT(DISTINCT s.id) AS total_schools,
        COUNT(DISTINCT f.id) AS submissions,
        ROUND(COUNT(DISTINCT f.id)*100.0/NULLIF(COUNT(DISTINCT s.id),0),1) AS submission_rate,
        ROUND(AVG(f.present*100.0/NULLIF(f.total_strength,0)),1) AS avg_attendance,
        SUM(CASE WHEN f.technology_used THEN 1 ELSE 0 END)   AS tech_count,
        SUM(CASE WHEN f.assembly_conducted THEN 1 ELSE 0 END) AS assembly_count,
        SUM(f.present) AS total_present, SUM(f.total_strength) AS total_strength
      FROM regional_coordinators rc
      LEFT JOIN schools s ON s.regional_coordinator_id=rc.id AND s.identifier IS NOT NULL
      LEFT JOIN daily_feedback f ON (f.school_identifier=s.identifier OR f.school_name ILIKE s.name)
        AND f.report_date BETWEEN $1 AND $2
      GROUP BY rc.id,rc.name,rc.region ORDER BY submission_rate DESC NULLS LAST
    `, [dateFrom, dateTo]);

    const coordPerf = await db.pool.query(`
      SELECT sc.name AS coord_name, rc.name AS rc_name, rc.region,
        COUNT(DISTINCT s.id) AS total_schools,
        COUNT(DISTINCT f.id) AS submissions,
        ROUND(COUNT(DISTINCT f.id)*100.0/NULLIF(COUNT(DISTINCT s.id),0),1) AS submission_rate,
        ROUND(AVG(f.present*100.0/NULLIF(f.total_strength,0)),1) AS avg_attendance,
        SUM(CASE WHEN f.technology_used THEN 1 ELSE 0 END)   AS tech_count,
        SUM(CASE WHEN f.assembly_conducted THEN 1 ELSE 0 END) AS assembly_count
      FROM school_coordinators sc
      LEFT JOIN regional_coordinators rc ON rc.id=sc.regional_coordinator_id
      LEFT JOIN schools s ON s.school_coordinator_id=sc.id AND s.identifier IS NOT NULL
      LEFT JOIN daily_feedback f ON (f.school_identifier=s.identifier OR f.school_name ILIKE s.name)
        AND f.report_date BETWEEN $1 AND $2
      GROUP BY sc.id,sc.name,rc.name,rc.region ORDER BY submission_rate DESC NULLS LAST
    `, [dateFrom, dateTo]);

    const schoolPerf = await db.pool.query(`
      SELECT s.name AS school_name, s.identifier, s.region,
        rc.name AS rc_name, sc.name AS coord_name,
        COUNT(DISTINCT f.id) AS submissions,
        ROUND(COUNT(DISTINCT f.id)*100.0/NULLIF(($2::date-$1::date+1),0),1) AS submission_rate,
        ROUND(AVG(f.present*100.0/NULLIF(f.total_strength,0)),1) AS avg_attendance,
        SUM(CASE WHEN f.technology_used THEN 1 ELSE 0 END)   AS tech_count,
        SUM(CASE WHEN f.assembly_conducted THEN 1 ELSE 0 END) AS assembly_count,
        MAX(f.report_date) AS last_submission
      FROM schools s
      LEFT JOIN regional_coordinators rc ON rc.id=s.regional_coordinator_id
      LEFT JOIN school_coordinators   sc ON sc.id=s.school_coordinator_id
      LEFT JOIN daily_feedback f ON (f.school_identifier=s.identifier OR f.school_name ILIKE s.name)
        AND f.report_date BETWEEN $1 AND $2
      WHERE s.identifier IS NOT NULL
      GROUP BY s.id,s.name,s.identifier,s.region,rc.name,sc.name
      ORDER BY submission_rate DESC NULLS LAST
    `, [dateFrom, dateTo]);

    res.json({ dateFrom, dateTo,
      dailyTrend: dailyTrend.rows, rcPerf: rcPerf.rows,
      coordPerf: coordPerf.rows, schoolPerf: schoolPerf.rows });
  } catch(err) {
    console.log('analytics error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Feedback API ──────────────────────────────────────────────────────────────
router.get('/api/feedback', async (req, res) => {
  try {
    const date   = req.query.date   || new Date().toISOString().split('T')[0];
    const region = req.query.region || null;
    const params = [date];
    let regionJoin = '';
    if (region) { params.push(region); regionJoin = `AND s.region = $${params.length}`; }

    const r = await db.pool.query(`
      SELECT s.id, s.name, s.identifier, s.region,
        rc.name AS regional_coordinator, sc.name AS school_coordinator,
        f.id AS feedback_id, f.check_in, f.check_out,
        f.present, f.absent, f.total_strength,
        f.assembly_conducted, f.technology_used,
        f.cr_media_shared, f.subjects, f.child_of_day,
        f.teacher_phone AS reporter_phone, f.created_at AS submitted_at,
        f.photo_url, f.photo_head_count, f.head_count_diff,
        f.photo_verified, f.photo_flag,
        f.projector_visible, f.lesson_verified,
        (f.photo_data IS NOT NULL) AS photo_available,
        f.photo_expires_at
      FROM schools s
      LEFT JOIN regional_coordinators rc ON rc.id=s.regional_coordinator_id
      LEFT JOIN school_coordinators   sc ON sc.id=s.school_coordinator_id
      LEFT JOIN LATERAL (
        SELECT * FROM daily_feedback df
        WHERE (df.school_identifier=s.identifier OR df.school_name ILIKE s.name)
          AND df.report_date=$1::date
        ORDER BY df.created_at DESC LIMIT 1
      ) f ON true
      WHERE s.identifier IS NOT NULL ${regionJoin}
      ORDER BY s.region, s.name
    `, params);

    const schools      = r.rows;
    const total        = schools.length;
    const submitted    = schools.filter(s => s.feedback_id).length;
    const totalPresent = schools.reduce((a,s) => a + (parseInt(s.present)||0), 0);
    const totalStrength= schools.reduce((a,s) => a + (parseInt(s.total_strength)||0), 0);
    const byRegion = {};
    for (const s of schools) {
      const reg = s.region || 'Unknown';
      if (!byRegion[reg]) byRegion[reg] = [];
      byRegion[reg].push(s);
    }

    res.json({ date, total, submitted, missing: total - submitted,
      totalPresent, totalStrength, byRegion, schools });
  } catch(err) {
    console.log('feedback api error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Feedback Table API (full KPI data) ───────────────────────────────────────
router.get('/api/feedback/table', async (req, res) => {
  try {
    const { from, to, region, rc, coordinator } = req.query;
    const today = new Date().toISOString().split('T')[0];
    const dateFrom = from || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    const dateTo   = to || today;

    const r = await db.pool.query(`
      SELECT
        f.id, f.report_date, f.created_at AS submitted_at,
        s.name AS school_name, s.identifier, s.region, s.province,
        rc.name AS regional_coordinator, sc.name AS school_coordinator,
        f.teacher_phone,
        f.grade, f.level,
        f.total_strength, f.boys, f.girls,
        f.present, f.absent, f.leave_count,
        f.assembly_conducted, f.child_of_day,
        f.technology_used, f.technology_reason,
        f.cr_media_shared, f.tech_media_shared,
        f.check_in, f.check_out,
        f.projector_shown, f.lesson_verified,
        f.photo_url, f.photo_head_count, f.head_count_diff,
        f.photo_verified, f.photo_flag,
        (f.photo_data IS NOT NULL) AS photo_available,
        f.subjects, f.raw_message
      FROM daily_feedback f
      LEFT JOIN schools s ON (s.identifier = f.school_identifier OR s.name ILIKE f.school_name)
      LEFT JOIN regional_coordinators rc ON rc.id = s.regional_coordinator_id
      LEFT JOIN school_coordinators   sc ON sc.id = s.school_coordinator_id
      WHERE f.report_date::date BETWEEN $1::date AND $2::date
        AND (f.school_name IS NOT NULL AND f.school_name != '')
      ORDER BY f.report_date DESC, s.region, s.name
    `, [dateFrom, dateTo]);

    let rows = r.rows;

    // Post-query filters
    if (region)      rows = rows.filter(r => (r.region||'').toLowerCase().includes(region.toLowerCase()));
    if (rc)          rows = rows.filter(r => r.regional_coordinator === rc);
    if (coordinator) rows = rows.filter(r => r.school_coordinator === coordinator);

    // Expand subjects JSONB into per-subject fields
    const subjects = ['English','Math','Science','Islamiat','Urdu','Skill Development'];
    const expanded = rows.map(row => {
      const subs = (() => { try { return typeof row.subjects === 'string' ? JSON.parse(row.subjects) : (row.subjects||[]); } catch(e){ return []; } })();
      const subMap = {};
      for (const s of subs) { if(s.subject) subMap[s.subject] = s; }
      const subFields = {};
      for (const name of subjects) {
        const key = name.replace(' ','_').toLowerCase();
        const s   = subMap[name] || {};
        subFields[`${key}_unit`]     = s.unit     || '';
        subFields[`${key}_lesson`]   = s.lesson_no || '';
        subFields[`${key}_activity`] = s.activity  || '';
      }
      const att_pct = row.total_strength > 0
        ? Math.round(row.present * 100 / row.total_strength) : null;
      return { ...row, ...subFields, att_pct, subjects: undefined, raw_message: undefined };
    });

    // Build filter option lists
    const uniq = arr => [...new Set(arr.filter(Boolean))].sort();
    const filterOptions = {
      regions:      uniq(rows.map(r => r.region)),
      rcs:          uniq(rows.map(r => r.regional_coordinator)),
      coordinators: uniq(rows.map(r => r.school_coordinator)),
      grades:       uniq(rows.map(r => r.grade)),
    };

    res.json({ rows: expanded, total: expanded.length, dateFrom, dateTo, filterOptions });
  } catch(err) {
    console.log('feedback/table error:', err.message);
    res.status(500).json({ error: err.message, rows: [] });
  }
});

// ── Student Register API ──────────────────────────────────────────────────────
router.post('/api/register/import', async (req, res) => {
  try {
    const students = req.body;
    if (!Array.isArray(students)) return res.status(400).json({ error: 'Expected array' });
    let imported = 0, skipped = 0;
    for (const s of students) {
      try {
        await db.pool.query(`
          INSERT INTO students_register
            (school_identifier, roll_number, student_name, teacher_name, province, regional_coordinator, school_coordinator)
          VALUES ($1,$2,$3,$4,$5,$6,$7)
          ON CONFLICT (roll_number) DO UPDATE SET
            student_name=EXCLUDED.student_name, teacher_name=EXCLUDED.teacher_name
        `, [s.school_identifier, s.roll_number, s.student_name,
            s.teacher_name, s.province, s.regional_coordinator, s.school_coordinator]);
        imported++;
      } catch(e) { skipped++; }
    }
    res.json({ imported, skipped, total: students.length });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.get('/api/register/school-by-phone', async (req, res) => {
  const { phone } = req.query;
  if (!phone) return res.status(400).json({ error: 'Phone number required' });
  try {
    const digits = phone.replace(/[^0-9]/g, '');
    const r = await db.pool.query(
      `SELECT name, identifier FROM schools
       WHERE REGEXP_REPLACE(teacher_phone, '[^0-9]', '', 'g') = $1 LIMIT 1`, [digits]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Phone number not found. Contact your coordinator to register your number.' });
    res.json({ name: r.rows[0].name, identifier: r.rows[0].identifier });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.get('/api/register/students', async (req, res) => {
  try {
    const { school_code, date } = req.query;
    if (!school_code) return res.status(400).json({ error: 'school_code required' });
    const attDate = date || new Date().toISOString().split('T')[0];

    const r = await db.pool.query(`
      SELECT sr.id, sr.roll_number, sr.student_name, sr.teacher_name,
             sr.school_identifier, sa.status, sa.attendance_date
      FROM students_register sr
      LEFT JOIN student_attendance sa
        ON sa.roll_number=sr.roll_number AND sa.attendance_date=$2::date
      WHERE LOWER(sr.school_identifier)=LOWER($1) AND sr.active=TRUE
      ORDER BY sr.roll_number
    `, [school_code, attDate]);

    const school = await db.pool.query(
      `SELECT name, identifier FROM schools WHERE identifier ILIKE $1 OR name ILIKE $1 LIMIT 1`,
      [school_code]
    );

    res.json({
      school: school.rows[0] || { name: school_code, identifier: school_code },
      date: attDate, students: r.rows, total: r.rows.length,
      present: r.rows.filter(s => s.status === 'P').length,
      absent:  r.rows.filter(s => s.status === 'A').length,
      leave:   r.rows.filter(s => s.status === 'L').length,
    });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/register/submit', async (req, res) => {
  try {
    const { school_code, date, attendance, submitted_by } = req.body;
    if (date) {
      const submitted = new Date(date); submitted.setHours(0,0,0,0);
      const today     = new Date();     today.setHours(0,0,0,0);
      const yesterday = new Date(today); yesterday.setDate(today.getDate()-1);
      if (submitted > today)     return res.status(400).json({ error: 'Future dates are not allowed.' });
      if (submitted < yesterday) return res.status(400).json({ error: 'Attendance can only be submitted for today or yesterday.' });
    }
    if (!attendance?.length) return res.status(400).json({ error: 'No attendance data' });
    const attDate = date || new Date().toISOString().split('T')[0];

    for (const s of attendance) {
      await db.pool.query(`
        INSERT INTO student_attendance (roll_number, student_name, school_identifier, attendance_date, status, submitted_by)
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (roll_number, attendance_date)
        DO UPDATE SET status=EXCLUDED.status, submitted_by=EXCLUDED.submitted_by
      `, [s.roll_number, s.student_name, school_code, attDate, s.status, submitted_by || school_code]);
    }

    const present = attendance.filter(s => s.status === 'P').length;
    const absent  = attendance.filter(s => s.status === 'A').length;
    const leave   = attendance.filter(s => s.status === 'L').length;
    res.json({ saved: true, total: attendance.length, present, absent, leave });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.get('/api/register/history', async (req, res) => {
  try {
    const { school_code, date } = req.query;
    const attDate = date || new Date().toISOString().split('T')[0];
    let whereClause = 'WHERE sa.attendance_date=$1::date';
    const params = [attDate];
    if (school_code) { params.push(school_code); whereClause += ` AND sa.school_identifier ILIKE $${params.length}`; }

    const r = await db.pool.query(`
      SELECT sa.school_identifier, s.name AS school_name,
        COUNT(*) AS total,
        SUM(CASE WHEN sa.status='P' THEN 1 ELSE 0 END) AS present,
        SUM(CASE WHEN sa.status='A' THEN 1 ELSE 0 END) AS absent,
        SUM(CASE WHEN sa.status='L' THEN 1 ELSE 0 END) AS leave_count,
        ROUND(SUM(CASE WHEN sa.status='P' THEN 1 ELSE 0 END)*100.0/COUNT(*),1) AS attendance_pct,
        MAX(sa.created_at) AS submitted_at,
        json_agg(json_build_object('name',sa.student_name,'roll',sa.roll_number,'status',sa.status) ORDER BY sa.roll_number) AS students
      FROM student_attendance sa
      LEFT JOIN schools s ON s.identifier ILIKE sa.school_identifier
      ${whereClause}
      GROUP BY sa.school_identifier, s.name
      ORDER BY sa.school_identifier
    `, params);
    res.json({ date: attDate, records: r.rows });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.get('/api/register/absent', async (req, res) => {
  try {
    const attDate = req.query.date || new Date().toISOString().split('T')[0];
    const r = await db.pool.query(`
      SELECT sa.student_name, sa.roll_number, sa.school_identifier,
             s.name AS school_name, sa.attendance_date
      FROM student_attendance sa
      LEFT JOIN schools s ON s.identifier ILIKE sa.school_identifier
      WHERE sa.attendance_date=$1::date AND sa.status='A'
      ORDER BY sa.school_identifier, sa.student_name
    `, [attDate]);
    res.json({ date: attDate, absent: r.rows });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

module.exports = { router, isFeedbackMessage, parseFeedback, saveFeedback };
