require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const db = require('./database');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);
const FROM_NUMBER = process.env.TWILIO_WHATSAPP_FROM; // e.g. whatsapp:+14155238886

// ── Conversation states ──────────────────────────────────────────────────────
const STATE = {
  AWAITING_PIN:        'AWAITING_PIN',
  CONFIRMING_SESSION:  'CONFIRMING_SESSION',
  IN_ASSESSMENT:       'IN_ASSESSMENT',
  ASSESSMENT_COMPLETE: 'ASSESSMENT_COMPLETE',
};

const QUESTIONS_PER_SESSION = 10;
const PASS_THRESHOLD = 80; // percent

// ── Helpers ──────────────────────────────────────────────────────────────────

function shuffleOptions(question) {
  // Returns question with shuffled A/B/C/D and correct_answer updated
  const opts = [
    { label: 'A', text: question.option_a },
    { label: 'B', text: question.option_b },
    { label: 'C', text: question.option_c },
    { label: 'D', text: question.option_d },
  ];
  const originalCorrectText = opts.find(o => o.label === question.correct_answer.toUpperCase()).text;

  // Fisher-Yates shuffle
  for (let i = opts.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [opts[i], opts[j]] = [opts[j], opts[i]];
  }

  const newCorrectLabel = opts.find(o => o.text === originalCorrectText).label;

  return {
    ...question,
    option_a: opts[0].text,
    option_b: opts[1].text,
    option_c: opts[2].text,
    option_d: opts[3].text,
    correct_answer: newCorrectLabel,
  };
}

function formatQuestion(question, index, total) {
  return (
    `📝 *Question ${index + 1} of ${total}*\n\n` +
    `${question.question_text}\n\n` +
    `A) ${question.option_a}\n` +
    `B) ${question.option_b}\n` +
    `C) ${question.option_c}\n` +
    `D) ${question.option_d}\n\n` +
    `_Reply with A, B, C, or D_`
  );
}

function normalizeAnswer(text) {
  const t = (text || '').trim().toUpperCase();
  if (['A', 'B', 'C', 'D'].includes(t)) return t;
  return null;
}

async function sendWhatsApp(to, body) {
  try {
    await twilioClient.messages.create({
      from: FROM_NUMBER,
      to: to.startsWith('whatsapp:') ? to : `whatsapp:${to}`,
      body,
    });
  } catch (err) {
    console.error('❌ Twilio send error:', err.message);
  }
}

async function notifyOpsTeam(advancementRequest, schoolName, session) {
  const ops = await db.getOpsTeam();
  if (!ops.length) {
    console.warn('⚠️  No ops team members found in DB — set them up via /admin/ops');
    return;
  }

  const msgBody =
    `🎓 *TAKMIL Advancement Request*\n\n` +
    `🏫 School: ${schoolName}\n` +
    `📚 Subject: ${session.subject}\n` +
    `🎯 Level: ${session.level} → ${session.level + 1}\n` +
    `📊 Score: ${advancementRequest.score_pct}%\n` +
    `✅ Threshold: ${PASS_THRESHOLD}%\n\n` +
    `To *approve* advancement, reply:\n` +
    `*APPROVE ${advancementRequest.id}*\n\n` +
    `To *reject*, reply:\n` +
    `*REJECT ${advancementRequest.id} <reason>*`;

  for (const opsUser of ops) {
    await sendWhatsApp(opsUser.phone, msgBody);
  }
}

async function notifyTeacherOfDecision(teacherPhone, decision, level, subject, reason) {
  if (decision === 'APPROVED') {
    await sendWhatsApp(
      teacherPhone,
      `✅ *Advancement Approved!*\n\n` +
      `The cohort has been approved to advance from *Level ${level}* to *Level ${level + 1}* in *${subject}*.\n\n` +
      `A 7-day check-in has been scheduled. Keep up the great work! 🌟`
    );
  } else {
    await sendWhatsApp(
      teacherPhone,
      `ℹ️ *Advancement Decision*\n\n` +
      `The advancement request for Level ${level} ${subject} was not approved at this time.\n` +
      `${reason ? `Reason: ${reason}\n` : ''}` +
      `Continue practice and request a re-assessment. 💪`
    );
  }
}

// ── Main message router ──────────────────────────────────────────────────────

async function handleMessage(rawPhone, incomingText) {
  const phone = rawPhone.replace('whatsapp:', '');
  const text = (incomingText || '').trim();
  const upper = text.toUpperCase();

  // ── Check if this is an Ops team member ─────────────────────────────────
  const isOps = await db.isOpsPhone(phone);
  if (isOps) {
    return handleOpsMessage(phone, text, upper);
  }

  // ── Teacher flow ─────────────────────────────────────────────────────────
  let session = await db.getSession(phone);

  if (!session) {
    // Brand new user
    await db.upsertSession(phone, { state: STATE.AWAITING_PIN });
    session = await db.getSession(phone);
  }

  // Global command: RESET or START OVER
  if (upper === 'RESET' || upper === 'START OVER') {
    await db.clearSession(phone);
    return (
      `🔄 Session cleared.\n\n` +
      `Welcome to *TAKMIL Assessment Bot*! 🌟\n\n` +
      `Please enter your *PIN* (provided by your Ops coordinator) to begin.`
    );
  }

  // Global command: HELP
  if (upper === 'HELP') {
    return (
      `*TAKMIL Bot — Help*\n\n` +
      `📌 *PIN* — Start a new assessment session\n` +
      `📌 *RESET* — Clear your current session\n` +
      `📌 *STATUS* — View your current session info\n\n` +
      `During assessment: reply *A*, *B*, *C*, or *D*`
    );
  }

  // Global command: STATUS
  if (upper === 'STATUS') {
    if (!session || session.state === STATE.AWAITING_PIN) {
      return `📋 No active session. Please enter your PIN to start.`;
    }
    return (
      `📋 *Current Session*\n` +
      `Subject: ${session.subject}\n` +
      `Level: ${session.level}\n` +
      `Progress: ${session.current_index}/${(session.question_ids || []).length} questions\n` +
      `State: ${session.state}`
    );
  }

  // ── State machine ────────────────────────────────────────────────────────
  switch (session.state) {
    case STATE.AWAITING_PIN:
      return handlePinEntry(phone, text, session);

    case STATE.CONFIRMING_SESSION:
      return handleSessionConfirmation(phone, text, session);

    case STATE.IN_ASSESSMENT:
      return handleAssessmentAnswer(phone, text, session);

    case STATE.ASSESSMENT_COMPLETE:
      return (
        `✅ Your assessment is complete.\n\n` +
        `Send *RESET* to start a new session, or contact your Ops coordinator for a new PIN.`
      );

    default:
      await db.clearSession(phone);
      return `Something went wrong. Please enter your PIN to start fresh.`;
  }
}

// ── State handlers ───────────────────────────────────────────────────────────

async function handlePinEntry(phone, text, session) {
  if (!text || text.length < 4) {
    return (
      `👋 Welcome to *TAKMIL Assessment Bot*!\n\n` +
      `Please enter the *6-character PIN* provided by your Ops coordinator to begin.`
    );
  }

  const pinRecord = await db.validatePin(text);
  if (!pinRecord) {
    return (
      `❌ *Invalid or expired PIN.*\n\n` +
      `Please check the PIN sent by your Ops coordinator and try again.\n` +
      `PINs are valid for 24 hours.`
    );
  }

  // PIN is valid — store in session, ask for confirmation
  await db.upsertSession(phone, {
    state: STATE.CONFIRMING_SESSION,
    pin_id: pinRecord.id,
    school_id: pinRecord.school_id,
    level: pinRecord.level,
    subject: pinRecord.subject,
  });

  return (
    `✅ *PIN Accepted!*\n\n` +
    `📋 *Session Details:*\n` +
    `🏫 School: ${pinRecord.school_name}\n` +
    `📚 Subject: ${pinRecord.subject}\n` +
    `🎯 Level: ${pinRecord.level}\n` +
    `👥 Cohort Size: ${pinRecord.cohort_size || 'Not specified'}\n\n` +
    `This session will assess *${QUESTIONS_PER_SESSION} questions*.\n\n` +
    `Reply *YES* to begin the assessment, or *NO* to cancel.`
  );
}

async function handleSessionConfirmation(phone, text, session) {
  const upper = text.toUpperCase();

  if (upper === 'NO' || upper === 'CANCEL') {
    await db.clearSession(phone);
    return `Session cancelled. Send your PIN when ready to begin.`;
  }

  if (upper !== 'YES' && upper !== 'START' && upper !== 'BEGIN') {
    return `Please reply *YES* to start the assessment or *NO* to cancel.`;
  }

  // Fetch and randomize questions
  const questions = await db.getRandomQuestions(session.level, session.subject, QUESTIONS_PER_SESSION);

  if (!questions || questions.length < QUESTIONS_PER_SESSION) {
    return (
      `⚠️ Not enough questions available for Level ${session.level} ${session.subject}.\n` +
      `Please contact your Ops coordinator.`
    );
  }

  // Shuffle options for each question and store IDs
  const shuffledQuestions = questions.map(shuffleOptions);
  const questionIds = shuffledQuestions.map(q => q.id);

  // Store serialized shuffled questions in session
  await db.upsertSession(phone, {
    state: STATE.IN_ASSESSMENT,
    question_ids: questionIds,
    current_index: 0,
    answers: JSON.stringify(shuffledQuestions.map(q => ({
      id: q.id,
      correct: q.correct_answer,
      chosen: null,
    }))),
    score: 0,
    started_at: new Date().toISOString(),
  });

  await db.activatePin(session.pin_id);

  // Return first question
  return (
    `🚀 *Assessment Started!*\n` +
    `Subject: ${session.subject} | Level: ${session.level}\n\n` +
    formatQuestion(shuffledQuestions[0], 0, QUESTIONS_PER_SESSION)
  );
}

async function handleAssessmentAnswer(phone, text, session) {
  const answer = normalizeAnswer(text);

  if (!answer) {
    const currentIdx = session.current_index;
    const answers = typeof session.answers === 'string'
      ? JSON.parse(session.answers) : session.answers;

    return (
      `Please reply with *A*, *B*, *C*, or *D*.\n\n` +
      `_Question ${currentIdx + 1} of ${QUESTIONS_PER_SESSION} still waiting for your answer._`
    );
  }

  // Parse current answers array
  let answers = typeof session.answers === 'string'
    ? JSON.parse(session.answers) : session.answers;

  const currentIdx = session.current_index;
  const currentAnswerEntry = answers[currentIdx];

  // Record the answer (neutral — no right/wrong feedback)
  currentAnswerEntry.chosen = answer;
  const isCorrect = answer === currentAnswerEntry.correct;
  const newScore = session.score + (isCorrect ? 1 : 0);

  const newIndex = currentIdx + 1;
  const ids = Array.isArray(session.question_ids) ? session.question_ids : JSON.parse(session.question_ids || '[]');
  const total = ids.length;

  if (newIndex < total) {
    // More questions remain
    await db.upsertSession(phone, {
      current_index: newIndex,
      answers: JSON.stringify(answers),
      score: newScore,
    });

    // Fetch the next question from DB (re-shuffled options stored in answers)
    const nextQuestion = await db.getQuestionById(answers[newIndex].id);
    const shuffled = {
      ...nextQuestion,
      correct_answer: answers[newIndex].correct,
      // Reconstruct options from stored correct_answer mapping
    };

    // For display, we need to show the shuffled options — we stored correct answer label
    // but need to re-fetch raw options. Use stored correct answer to show proper question.
    return (
      `✅ *Answer recorded.*\n\n` +
      formatQuestion(nextQuestion, newIndex, total)
    );
  }

  // ── Assessment complete ──────────────────────────────────────────────────
  await db.upsertSession(phone, {
    state: STATE.ASSESSMENT_COMPLETE,
    current_index: newIndex,
    answers: JSON.stringify(answers),
    score: newScore,
    completed_at: new Date().toISOString(),
  });

  const scorePct = Math.round((newScore / total) * 100);
  const passed = scorePct >= PASS_THRESHOLD;

  // Save assessment record
  const assessment = await db.saveAssessment({
    pinId: session.pin_id,
    schoolId: session.school_id,
    teacherPhone: phone,
    level: session.level,
    subject: session.subject,
    totalQuestions: total,
    correctAnswers: newScore,
    scorePct,
    passed,
    answersDetail: answers,
  });

  let resultMessage =
    `🎉 *Assessment Complete!*\n\n` +
    `📊 *Results:*\n` +
    `Subject: ${session.subject} | Level: ${session.level}\n` +
    `Score: *${newScore}/${total}* (${scorePct}%)\n\n`;

  if (passed) {
    resultMessage +=
      `✅ *Cohort meets the ${PASS_THRESHOLD}% competency threshold!*\n\n` +
      `An advancement request has been submitted to the Ops team.\n` +
      `You will be notified once a decision is made.`;

    // Create advancement request and notify ops
    const req = await db.createAdvancementRequest({
      assessmentId: assessment.id,
      pinId: session.pin_id,
      schoolId: session.school_id,
      level: session.level,
      subject: session.subject,
      scorePct,
    });

    // Get school name for notification
    const schoolResult = await db.pool.query(
      'SELECT name FROM schools WHERE id = $1', [session.school_id]
    );
    const schoolName = schoolResult.rows[0]?.name || 'Unknown School';

    await notifyOpsTeam(req, schoolName, session);
  } else {
    const gap = PASS_THRESHOLD - scorePct;
    resultMessage +=
      `📈 *Score is ${gap}% below the ${PASS_THRESHOLD}% threshold.*\n\n` +
      `The Ops team will be notified. A re-assessment will be scheduled within 7 days.\n` +
      `Keep practicing! 💪`;

    // Schedule re-assessment
    const schedDate = new Date();
    schedDate.setDate(schedDate.getDate() + 7);
    await db.pool.query(`
      INSERT INTO reassessment_schedule
        (school_id, level, subject, scheduled_date, reason, triggered_by_assessment)
      VALUES ($1,$2,$3,$4,$5,$6)
    `, [
      session.school_id, session.level, session.subject,
      schedDate.toISOString().split('T')[0],
      `Below threshold: ${scorePct}%`,
      assessment.id,
    ]);
  }

  return resultMessage;
}

// ── Ops handler ──────────────────────────────────────────────────────────────

async function handleOpsMessage(phone, text, upper) {
  // APPROVE <id>
  const approveMatch = upper.match(/^APPROVE\s+(\d+)$/);
  if (approveMatch) {
    const requestId = parseInt(approveMatch[1]);
    const req = await db.getAdvancementRequest(requestId);

    if (!req) return `❌ Advancement request #${requestId} not found.`;
    if (req.status !== 'PENDING') return `ℹ️ Request #${requestId} is already ${req.status}.`;

    await db.approveAdvancement(requestId, phone);

    // Find the teacher phone from the assessment
    const assResult = await db.pool.query(
      'SELECT teacher_phone FROM assessments WHERE id = $1', [req.assessment_id]
    );
    const teacherPhone = assResult.rows[0]?.teacher_phone;
    if (teacherPhone) {
      await notifyTeacherOfDecision(teacherPhone, 'APPROVED', req.level, req.subject, null);
    }

    return (
      `✅ *Approved!*\n\n` +
      `Advancement request #${requestId} for *${req.school_name}* (${req.subject}, Level ${req.level}→${req.level + 1}) has been approved.\n` +
      `Teacher notified. 7-day follow-up scheduled.`
    );
  }

  // REJECT <id> <reason>
  const rejectMatch = text.match(/^REJECT\s+(\d+)\s*(.*)/i);
  if (rejectMatch) {
    const requestId = parseInt(rejectMatch[1]);
    const reason = rejectMatch[2]?.trim() || 'No reason provided';
    const req = await db.getAdvancementRequest(requestId);

    if (!req) return `❌ Advancement request #${requestId} not found.`;
    if (req.status !== 'PENDING') return `ℹ️ Request #${requestId} is already ${req.status}.`;

    await db.rejectAdvancement(requestId, phone, reason);

    const assResult = await db.pool.query(
      'SELECT teacher_phone FROM assessments WHERE id = $1', [req.assessment_id]
    );
    const teacherPhone = assResult.rows[0]?.teacher_phone;
    if (teacherPhone) {
      await notifyTeacherOfDecision(teacherPhone, 'REJECTED', req.level, req.subject, reason);
    }

    return `✅ Request #${requestId} rejected. Teacher notified.`;
  }

  // OPS HELP
  if (upper === 'HELP' || upper === 'OPS HELP') {
    return (
      `*TAKMIL Ops Bot — Commands*\n\n` +
      `✅ *APPROVE <id>* — Approve a cohort advancement\n` +
      `❌ *REJECT <id> <reason>* — Reject with optional reason\n` +
      `📊 *STATS* — View assessment summary\n` +
      `📋 *PENDING* — List pending approvals`
    );
  }

  // STATS
  if (upper === 'STATS') {
    const stats = await db.getAnalyticsSummary();
    return (
      `📊 *TAKMIL Assessment Stats*\n\n` +
      `Total Assessments: ${stats.total_assessments}\n` +
      `Schools Assessed: ${stats.schools_assessed}\n` +
      `Average Score: ${stats.avg_score}%\n` +
      `Passed: ${stats.passed_count}\n` +
      `Below Threshold: ${stats.failed_count}\n` +
      `Advancements Approved: ${stats.advancements_approved}`
    );
  }

  // PENDING
  if (upper === 'PENDING') {
    const result = await db.pool.query(`
      SELECT ar.id, s.name AS school, ar.subject, ar.level, ar.score_pct
      FROM advancement_requests ar
      JOIN schools s ON s.id = ar.school_id
      WHERE ar.status = 'PENDING'
      ORDER BY ar.created_at DESC
      LIMIT 10
    `);
    if (!result.rows.length) return `📋 No pending advancement requests.`;
    const lines = result.rows.map(r =>
      `#${r.id} | ${r.school} | ${r.subject} Lvl${r.level} | ${r.score_pct}%`
    );
    return `📋 *Pending Requests:*\n\n${lines.join('\n')}`;
  }

  return (
    `👋 Hello, Ops!\n\n` +
    `Send *HELP* to see available commands.`
  );
}

// ── Express routes ───────────────────────────────────────────────────────────

// Main WhatsApp webhook
app.post('/webhook', async (req, res) => {
  const { From: from, Body: body } = req.body;

  if (!from || body === undefined) {
    return res.status(400).send('Bad request');
  }

  console.log(`📩 [${new Date().toISOString()}] From: ${from} | Body: "${body}"`);

  try {
    const reply = await handleMessage(from, body);
    // Respond via Twilio TwiML
    res.set('Content-Type', 'text/xml');
    res.send(
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<Response><Message>${escapeXml(reply)}</Message></Response>`
    );
  } catch (err) {
    console.error('❌ Error handling message:', err);
    res.set('Content-Type', 'text/xml');
    res.send(
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<Response><Message>Sorry, something went wrong. Please try again.</Message></Response>`
    );
  }
});

function escapeXml(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ── Admin REST API ──────────────────────────────────────────────────────────

// Health check
app.get('/', (req, res) => res.json({ status: 'ok', service: 'TAKMIL Bot', version: '2.0' }));

// Generate a PIN (Ops use)
app.post('/admin/pins/generate', async (req, res) => {
  const { schoolId, level, subject, cohortSize, issuedBy } = req.body;
  if (!schoolId || !level || !subject) {
    return res.status(400).json({ error: 'schoolId, level, subject required' });
  }
  try {
    const pin = await db.generatePin(schoolId, level, subject, cohortSize || 0, issuedBy || 'admin');
    res.json({ success: true, pin: pin.pin, expiresAt: pin.expires_at });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add school
app.post('/admin/schools', async (req, res) => {
  const { name, province, district, contactName, contactPhone } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    const result = await db.pool.query(
      `INSERT INTO schools (name, province, district, contact_name, contact_phone)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [name, province, district, contactName, contactPhone]
    );
    res.json({ success: true, school: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add ops team member
app.post('/admin/ops', async (req, res) => {
  const { phone, name, role } = req.body;
  if (!phone || !name) return res.status(400).json({ error: 'phone and name required' });
  try {
    const result = await db.pool.query(
      `INSERT INTO ops_team (phone, name, role) VALUES ($1,$2,$3)
       ON CONFLICT (phone) DO UPDATE SET name=$2, role=$3, is_active=TRUE RETURNING *`,
      [phone, name, role || 'ops']
    );
    res.json({ success: true, ops: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List pending advancement requests
app.get('/admin/advancements/pending', async (req, res) => {
  try {
    const result = await db.pool.query(`
      SELECT ar.*, s.name AS school_name, s.province
      FROM advancement_requests ar
      JOIN schools s ON s.id = ar.school_id
      WHERE ar.status = 'PENDING'
      ORDER BY ar.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Analytics summary
app.get('/admin/analytics', async (req, res) => {
  try {
    const summary = await db.getAnalyticsSummary();

    const bySubject = await db.pool.query(`
      SELECT subject, COUNT(*) AS count, ROUND(AVG(score_pct),1) AS avg_score
      FROM assessments GROUP BY subject ORDER BY subject
    `);

    const byLevel = await db.pool.query(`
      SELECT level, COUNT(*) AS count, ROUND(AVG(score_pct),1) AS avg_score,
             SUM(CASE WHEN passed THEN 1 ELSE 0 END) AS passed
      FROM assessments GROUP BY level ORDER BY level
    `);

    const upcoming = await db.pool.query(`
      SELECT rs.*, s.name AS school_name
      FROM reassessment_schedule rs
      JOIN schools s ON s.id = rs.school_id
      WHERE rs.completed = FALSE AND rs.scheduled_date >= CURRENT_DATE
      ORDER BY rs.scheduled_date ASC LIMIT 20
    `);

    res.json({
      summary,
      bySubject: bySubject.rows,
      byLevel: byLevel.rows,
      upcomingReassessments: upcoming.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Startup ──────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;

(async () => {
  try {
    await db.initializeDatabase();
    app.listen(PORT, () => {
      console.log(`🚀 TAKMIL Bot v2.0 running on port ${PORT}`);
      console.log(`📊 Admin API: http://localhost:${PORT}/admin`);
    });
  } catch (err) {
    console.error('❌ Failed to start:', err);
    process.exit(1);
  }
})();
