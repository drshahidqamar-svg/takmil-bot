// routes/chatbot-ai.js — AI-Powered Role-Based WhatsApp Assistant
// Checks bot_users table → fetches role-specific data → calls Claude API
// Roles: leadership, ops, me, hr, coordinator, school_coordinator

const router = require('express').Router();
const db     = require('../database');
const { sendWhatsApp } = require('../helpers/whatsapp');

// ── Check if phone is a registered bot user ───────────────────────────────────
async function getBotUser(phone) {
  try {
    const clean = phone.replace('whatsapp:', '').replace(/[^0-9+]/g, '');
    const r = await db.pool.query(
      `SELECT * FROM bot_users WHERE phone=$1 AND active=TRUE LIMIT 1`,
      [clean]
    );
    return r.rows[0] || null;
  } catch(e) { return null; }
}

// ── Fetch live data header (shown on every response) ─────────────────────────
async function getDataHeader() {
  try {
    const today = new Date().toISOString().split('T')[0];
    const schools    = await db.pool.query(`SELECT COUNT(*) AS c FROM schools`);
    const students   = await db.pool.query(`SELECT COUNT(*) AS c FROM students_register`);
    const attendance = await db.pool.query(`SELECT COUNT(DISTINCT school_identifier) AS c FROM daily_feedback WHERE report_date=$1`, [today]);
    const tested     = await db.pool.query(`SELECT COUNT(*) AS c FROM student_assessments WHERE completed_at >= NOW() - INTERVAL '7 days'`);
    return {
      date:       today,
      schools:    parseInt(schools.rows[0]?.c    || 0),
      students:   parseInt(students.rows[0]?.c   || 0),
      attendance: parseInt(attendance.rows[0]?.c || 0),
      tested:     parseInt(tested.rows[0]?.c     || 0),
    };
  } catch(e) { return { date: new Date().toISOString().split('T')[0], schools: 0, students: 0, attendance: 0, tested: 0 }; }
}

function formatDataHeader(h) {
  return `📅 ${h.date} | 🏫 ${h.schools} schools | 👥 ${h.students} students | ✅ ${h.attendance} submissions today | 📝 ${h.tested} tested this week`;
}

// ── Fetch role-specific data for Claude context ───────────────────────────────
async function fetchRoleData(user, command) {
  const today = new Date().toISOString().split('T')[0];
  const data  = {};

  try {
    if (user.role === 'leadership') {
      const byProvince = await db.pool.query(`SELECT province, COUNT(*) AS schools FROM schools GROUP BY province ORDER BY schools DESC`);
      const assessments= await db.pool.query(`SELECT subject, ROUND(AVG(score_pct),1) AS avg_score, COUNT(*) AS total FROM assessments GROUP BY subject ORDER BY subject`);
      const advanced   = await db.pool.query(`SELECT COUNT(*) AS c FROM advancement_requests WHERE status='APPROVED'`);
      data.byProvince  = byProvince.rows;
      data.assessments = assessments.rows;
      data.advanced    = parseInt(advanced.rows[0]?.c || 0);
    }

    if (user.role === 'ops') {
      const missing = await db.pool.query(`
        SELECT s.name, s.identifier, s.region FROM schools s
        WHERE s.identifier IS NOT NULL
          AND s.identifier NOT IN (
            SELECT school_identifier FROM daily_feedback WHERE report_date=$1
          ) LIMIT 20`, [today]);
      const readyToAdvance = await db.pool.query(`
        SELECT cl.school_identifier, cl.current_level, cl.subject
        FROM cohort_levels cl
        JOIN (
          SELECT school_id, level, subject, AVG(score_pct) AS avg_score
          FROM assessments WHERE passed=TRUE
          GROUP BY school_id, level, subject
        ) a ON a.school_id=(SELECT id FROM schools WHERE identifier=cl.school_identifier LIMIT 1)
          AND a.level=cl.current_level AND a.subject=cl.subject
        WHERE a.avg_score >= 80 LIMIT 10`).catch(() => ({ rows: [] }));
      const flagged = await db.pool.query(`SELECT COUNT(*) AS c FROM daily_feedback WHERE report_date=$1 AND photo_flag IS NOT NULL`, [today]);
      const flaggedLessons = await db.pool.query(`SELECT COUNT(*) AS c FROM lessons WHERE flagged=TRUE AND DATE(start_time)=$1`, [today]);
      data.missingSchools  = missing.rows;
      data.readyToAdvance  = readyToAdvance.rows;
      data.flaggedPhotos   = parseInt(flagged.rows[0]?.c || 0);
      data.flaggedLessons  = parseInt(flaggedLessons.rows[0]?.c || 0);
    }

    if (user.role === 'me') {
      const scores = await db.pool.query(`SELECT subject, level, ROUND(AVG(score_pct),1) AS avg, COUNT(*) AS total, SUM(CASE WHEN passed THEN 1 ELSE 0 END) AS passed FROM assessments GROUP BY subject,level ORDER BY subject,level`);
      const weakest= await db.pool.query(`SELECT subject, level, ROUND(AVG(score_pct),1) AS avg FROM assessments GROUP BY subject,level ORDER BY avg ASC LIMIT 5`);
      const weekly = await db.pool.query(`SELECT COUNT(*) AS c FROM student_assessments WHERE completed_at >= NOW() - INTERVAL '7 days'`);
      data.scores  = scores.rows;
      data.weakest = weakest.rows;
      data.weeklyAssessed = parseInt(weekly.rows[0]?.c || 0);
    }

    if (user.role === 'hr') {
      const lessons = await db.pool.query(`SELECT COUNT(*) AS c, AVG(actual_duration) AS avg_dur, SUM(CASE WHEN flagged THEN 1 ELSE 0 END) AS flagged FROM lessons WHERE DATE(start_time)=$1`, [today]);
      const shortest= await db.pool.query(`SELECT teacher_name, school_name, actual_duration, coverage_pct FROM lessons WHERE DATE(start_time)=$1 ORDER BY actual_duration ASC LIMIT 5`, [today]);
      data.lessonsToday = lessons.rows[0];
      data.shortestLessons = shortest.rows;
    }

    if (user.role === 'coordinator' || user.role === 'school_coordinator') {
      const regionFilter = user.region ? `AND s.region=$1` : '';
      const params = user.region ? [user.region, today] : [today];
      const mySchools = await db.pool.query(`
        SELECT s.name, s.identifier,
          CASE WHEN df.id IS NOT NULL THEN 'submitted' ELSE 'missing' END AS status
        FROM schools s
        LEFT JOIN daily_feedback df ON df.school_identifier=s.identifier AND df.report_date=$${params.length}
        WHERE s.identifier IS NOT NULL ${user.region ? `AND s.region=$1` : ''}
        LIMIT 30`, params);
      const myScores = await db.pool.query(`
        SELECT a.subject, ROUND(AVG(a.score_pct),1) AS avg_score, COUNT(*) AS total
        FROM assessments a
        JOIN schools s ON s.id=a.school_id
        WHERE 1=1 ${user.region ? `AND s.region='${user.region}'` : ''}
        GROUP BY a.subject ORDER BY a.subject`);
      data.mySchools = mySchools.rows;
      data.myScores  = myScores.rows;
    }

  } catch(e) { console.log('fetchRoleData error:', e.message); }

  return data;
}

// ── Role menu messages ────────────────────────────────────────────────────────
function getRoleMenu(role) {
  const menus = {
    leadership:
      `👑 *Leadership Commands*\n\nSUMMARY — overall stats\nPROVINCE — compare provinces\nGRADUATES — graduation pipeline\nGROWTH — month over month\n\nOr ask any question in plain English`,
    ops:
      `⚙️ *Ops Commands*\n\nPENDING — what needs action today\nATTENDANCE — who hasn't submitted\nADVANCE — schools ready to move up\nFLAGS — photo/lesson flags\n\nOr ask any question in plain English`,
    me:
      `📊 *M&E Commands*\n\nSCORES — assessment scores\nWEAK — lowest performing areas\nTRENDS — score trends\n\nOr ask any question in plain English`,
    hr:
      `👩‍💼 *HR Commands*\n\nTEACHERS — teacher activity\nCOMPLIANCE — lesson compliance\n\nOr ask any question in plain English`,
    coordinator:
      `🗺️ *Coordinator Commands*\n\nATTENDANCE — your region status\nSCORES — your region scores\n\nOr ask any question in plain English`,
    school_coordinator:
      `🏫 *School Coordinator Commands*\n\nATTENDANCE — your schools today\nSCORES — assessment results\n\nOr ask any question in plain English`,
  };
  return menus[role] || `Send MENU to see your commands.`;
}

// ── Main AI handler ───────────────────────────────────────────────────────────
async function handleBotUserMessage(user, text) {
  const upper = text.trim().toUpperCase();

  // MENU command
  if (upper === 'MENU' || upper === 'HELP' || upper === 'START') {
    return getRoleMenu(user.role);
  }

  // Fetch live data
  const header = await getDataHeader();
  const headerText = formatDataHeader(header);
  const roleData = await fetchRoleData(user, upper);

  // Build Claude prompt
  const prompt = `You are the TAKMIL WhatsApp assistant. Answer the user's question using ONLY the real data provided below.

STRICT RULES:
1. NEVER invent numbers — if data is missing, say "no data yet"
2. Keep response under 300 characters (WhatsApp friendly)
3. Use *bold* for key numbers
4. End with one action item or suggestion
5. Always reference actual numbers from the data

USER ROLE: ${user.role}
USER NAME: ${user.name || 'Team Member'}
${user.region ? `USER REGION: ${user.region}` : ''}

LIVE DATA:
${JSON.stringify({ header, roleData }, null, 2)}

USER QUESTION: ${text}

Respond in plain English. Start directly with the answer — no greeting needed.`;

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data   = await resp.json();
    const answer = data.content?.[0]?.text || 'Unable to generate response. Please try again.';

    return `${headerText}\n\n${answer}`;
  } catch(e) {
    console.log('AI chatbot error:', e.message);
    return `${headerText}\n\n❌ Could not process your question. Please try again.`;
  }
}

// ── Export handler to be used in chatbot.js webhook ───────────────────────────
module.exports = { getBotUser, handleBotUserMessage };
