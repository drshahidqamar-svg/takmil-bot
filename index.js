require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const db = require('./database');
const path = require('path');
const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);
const FROM_NUMBER = process.env.TWILIO_WHATSAPP_FROM;

// ── States ───────────────────────────────────────────────────────────────────
const STATE = {
  AWAITING_PIN:          'AWAITING_PIN',
  CONFIRMING_SESSION:    'CONFIRMING_SESSION',
  AWAITING_STUDENT_NAME: 'AWAITING_STUDENT_NAME',
  IN_ASSESSMENT:         'IN_ASSESSMENT',
  STUDENT_COMPLETE:      'STUDENT_COMPLETE',
  SESSION_COMPLETE:      'SESSION_COMPLETE',
};

const QUESTIONS_PER_SESSION = 10;
const PASS_THRESHOLD = 80;

// ── Helpers ──────────────────────────────────────────────────────────────────

function shuffleOptions(question) {
  const correctOption = (question.correct_option || question.correct_answer || 'A').toUpperCase();
  const opts = [
    { label: 'A', text: question.option_a },
    { label: 'B', text: question.option_b },
    { label: 'C', text: question.option_c },
    { label: 'D', text: question.option_d },
  ];
  const correctText = opts.find(o => o.label === correctOption)?.text;
  for (let i = opts.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [opts[i], opts[j]] = [opts[j], opts[i]];
  }
  return {
    ...question,
    option_a: opts[0].text,
    option_b: opts[1].text,
    option_c: opts[2].text,
    option_d: opts[3].text,
    correct_text: correctText,
    shuffled_correct: opts.find(o => o.text === correctText)?.label || 'A',
  };
}

function formatQuestion(q, index, total) {
  return (
    `📝 *Question ${index + 1} of ${total}*\n\n` +
    `${q.question_text}\n\n` +
    `A) ${q.option_a}\n` +
    `B) ${q.option_b}\n` +
    `C) ${q.option_c}\n` +
    `D) ${q.option_d}\n\n` +
    `_Reply with A, B, C, or D_`
  );
}

function normalizeAnswer(text) {
  const t = (text || '').trim().toUpperCase();
  return ['A', 'B', 'C', 'D'].includes(t) ? t : null;
}

function parseAnswers(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return []; }
  }
  return [];
}

async function sendWhatsApp(to, body) {
  try {
    const toNum = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
    await twilioClient.messages.create({ from: FROM_NUMBER, to: toNum, body });
  } catch (err) {
    console.error(`❌ Twilio send error to ${to}:`, err.message);
  }
}

async function notifyOpsTeam(req, schoolName, session) {
  const ops = await db.getOpsTeam();
  if (!ops.length) { console.warn('⚠️ No ops team members found'); return; }
  const msg =
    `🎓 *TAKMIL Advancement Request*\n\n` +
    `🏫 School: ${schoolName}\n` +
    `📚 Subject: ${session.subject}\n` +
    `🎯 Level: ${session.level} → ${session.level + 1}\n` +
    `📊 Cohort Score: ${req.score_pct}%\n` +
    `👥 Students Assessed: ${req.students_count || 0}\n` +
    `✅ Passed: ${req.students_passed || 0}\n` +
    `✅ Threshold: ${PASS_THRESHOLD}%\n\n` +
    `To *approve*, reply:\n*APPROVE ${req.id}*\n\n` +
    `To *reject*, reply:\n*REJECT ${req.id} <reason>*`;
  for (const o of ops) await sendWhatsApp(o.phone, msg);
}

async function notifyTeacher(phone, decision, level, subject, reason) {
  if (decision === 'APPROVED') {
    await sendWhatsApp(phone,
      `✅ *Advancement Approved!*\n\n` +
      `Cohort approved: *Level ${level}* → *Level ${level + 1}* in *${subject}*.\n\n` +
      `A 7-day check-in has been scheduled. Keep up the great work! 🌟`
    );
  } else {
    await sendWhatsApp(phone,
      `ℹ️ *Advancement Not Approved*\n\n` +
      `Level ${level} ${subject} request was not approved.\n` +
      `${reason ? `Reason: ${reason}\n` : ''}` +
      `Continue practice and request a re-assessment. 💪`
    );
  }
}

// ── Main router ──────────────────────────────────────────────────────────────

async function handleMessage(rawPhone, incomingText) {
  const phone = rawPhone.replace('whatsapp:', '');
  const text  = (incomingText || '').trim();
  const upper = text.toUpperCase();

  // RESET — always first
  if (upper === 'RESET' || upper === 'START OVER') {
    await db.clearSession(phone);
    return (
      `🔄 Session cleared.\n\n` +
      `Welcome to *TAKMIL Assessment Bot*! 🌟\n\n` +
      `Please enter your *PIN* to begin.`
    );
  }

  // Ops commands
  const isOps = await db.isOpsPhone(phone);
  const isOpsCmd = upper.startsWith('APPROVE') || upper.startsWith('REJECT') ||
                   upper === 'PENDING' || upper === 'STATS' || upper === 'OPS HELP';
  if (isOps && isOpsCmd) return handleOpsMessage(phone, text, upper);

  // Teacher flow
  let session = await db.getSession(phone);
  if (!session) {
    await db.upsertSession(phone, { state: STATE.AWAITING_PIN });
    session = await db.getSession(phone);
  }

  if (upper === 'HELP') {
    return (
      `*TAKMIL Bot — Help*\n\n` +
      `📌 Enter your *PIN* to start\n` +
      `📌 *RESET* — Clear session\n` +
      `📌 *STATUS* — View progress\n` +
      `📌 *DONE* — Finish session after last student\n\n` +
      `During assessment reply *A*, *B*, *C*, or *D*`
    );
  }

  if (upper === 'STATUS') {
    if (!session || session.state === STATE.AWAITING_PIN) {
      return `📋 No active session. Please enter your PIN.`;
    }
    const meta = parseAnswers(session.answers);
    return (
      `📋 *Current Session*\n` +
      `Subject: ${session.subject} | Level: ${session.level}\n` +
      `Progress: Q${session.current_index}/${meta.length}\n` +
      `State: ${session.state}`
    );
  }

  switch (session.state) {
    case STATE.AWAITING_PIN:          return handlePinEntry(phone, text);
    case STATE.CONFIRMING_SESSION:    return handleConfirmation(phone, text, session);
    case STATE.AWAITING_STUDENT_NAME: return handleStudentName(phone, text, session);
    case STATE.IN_ASSESSMENT:         return handleAnswer(phone, text, session);
    case STATE.STUDENT_COMPLETE:      return handleStudentComplete(phone, text, session);
    case STATE.SESSION_COMPLETE:
      return `✅ Session complete.\n\nSend *RESET* to start a new session.`;
    default:
      await db.clearSession(phone);
      return `Something went wrong. Please enter your PIN to start fresh.`;
  }
}

// ── PIN entry ────────────────────────────────────────────────────────────────

async function handlePinEntry(phone, text) {
  if (!text || text.length < 4) {
    return `👋 Welcome to *TAKMIL Assessment Bot*!\n\nPlease enter your *6-character PIN* to begin.`;
  }

  const pin = await db.validatePin(text);
  if (!pin) {
    return `❌ *Invalid or expired PIN.*\n\nPlease check your PIN and try again. PINs are valid for 24 hours.`;
  }

  await db.upsertSession(phone, {
    state:            STATE.CONFIRMING_SESSION,
    pin_id:           pin.id,
    school_id:        pin.school_id,
    level:            pin.level,
    subject:          pin.subject,
  });

  return (
    `✅ *PIN Accepted!*\n\n` +
    `📋 *Session Details:*\n` +
    `🏫 School: ${pin.school_name}\n` +
    `📚 Subject: ${pin.subject}\n` +
    `🎯 Level: ${pin.level}\n` +
    `👥 Cohort Size: ${pin.cohort_size || 'Not specified'}\n\n` +
    `Each student will answer *${QUESTIONS_PER_SESSION} questions* individually.\n\n` +
    `Reply *YES* to begin or *NO* to cancel.`
  );
}

// ── Session confirmation ─────────────────────────────────────────────────────

async function handleConfirmation(phone, text, session) {
  const upper = text.toUpperCase();
  if (upper === 'NO' || upper === 'CANCEL') {
    await db.clearSession(phone);
    return `Session cancelled. Send your PIN when ready.`;
  }
  if (!['YES', 'START', 'BEGIN'].includes(upper)) {
    return `Please reply *YES* to start or *NO* to cancel.`;
  }

  await db.activatePin(session.pin_id);

  // Initialize session_students tracking in DB
  await db.pool.query(`
    CREATE TABLE IF NOT EXISTS student_assessments (
      id SERIAL PRIMARY KEY,
      pin_id INTEGER REFERENCES pins(id),
      school_id INTEGER REFERENCES schools(id),
      teacher_phone VARCHAR(20),
      student_name VARCHAR(100) NOT NULL,
      level INTEGER NOT NULL,
      subject VARCHAR(20) NOT NULL,
      total_questions INTEGER DEFAULT 10,
      correct_answers INTEGER DEFAULT 0,
      score_pct NUMERIC(5,2) DEFAULT 0,
      passed BOOLEAN DEFAULT FALSE,
      answers_detail JSONB,
      recommendation TEXT,
      completed_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Store students_assessed count in session
  await db.pool.query(`
    UPDATE sessions SET
      state = $1,
      answers = '[]'::jsonb,
      score = 0,
      current_index = 0,
      updated_at = NOW()
    WHERE phone = $2
  `, [STATE.AWAITING_STUDENT_NAME, phone]);

  return (
    `🚀 *Session Started!*\n` +
    `${session.subject} | Level ${session.level}\n\n` +
    `👤 *Enter the name of Student 1:*\n\n` +
    `_Type the student's full name and send_`
  );
}

// ── Student name entry ───────────────────────────────────────────────────────

async function handleStudentName(phone, text, session) {
  const upper = text.toUpperCase();

  // DONE ends the session
  if (upper === 'DONE' || upper === 'FINISH' || upper === 'END') {
    return await finishSession(phone, session);
  }

  const studentName = text.trim();
  if (studentName.length < 2) {
    return `Please enter the student's full name (at least 2 characters).`;
  }

  // Fetch fresh questions for this student
  const questions = await db.getRandomQuestions(session.level, session.subject, QUESTIONS_PER_SESSION);
  if (!questions || questions.length < QUESTIONS_PER_SESSION) {
    return `⚠️ Not enough questions for Level ${session.level} ${session.subject}. Contact your Ops coordinator.`;
  }

  const shuffledQuestions = questions.map(shuffleOptions);
  const answersPayload = shuffledQuestions.map(q => ({
    id:            q.question_id || q.id,
    question_text: q.q_text_english || q.q_text_urdu || q.question_text || 'Question not available',
    option_a:      q.option_a,
    option_b:      q.option_b,
    option_c:      q.option_c,
    option_d:      q.option_d,
    correct: q.shuffled_correct || q.correct_option || q.correct_answer || 'A',
    chosen:        null,
  }));

  // Store student name and questions in session
  await db.pool.query(`
    UPDATE sessions SET
      state         = $1,
      current_index = 0,
      answers       = $2::jsonb,
      score         = 0,
      updated_at    = NOW()
    WHERE phone = $3
  `, [STATE.IN_ASSESSMENT, JSON.stringify(answersPayload), phone]);

  // Store student name temporarily in session metadata
  await db.pool.query(`
    UPDATE sessions SET started_at = NOW() WHERE phone = $1
  `, [phone]);

  // Save student name in a way we can retrieve it
  await db.pool.query(`
    UPDATE sessions SET subject = $1 WHERE phone = $2
  `, [session.subject, phone]);

  // Store student name in Redis-like fashion using question_ids field
  await db.pool.query(`
    UPDATE sessions SET question_ids = $1::integer[] WHERE phone = $2
  `, [[studentName.charCodeAt(0)], phone]);

  // Actually store student name properly - use a temp table approach
  await db.pool.query(`
    INSERT INTO student_assessments
      (pin_id, school_id, teacher_phone, student_name, level, subject, answers_detail)
    VALUES ($1, $2, $3, $4, $5, $6, '[]'::jsonb)
  `, [session.pin_id, session.school_id, phone, studentName, session.level, session.subject]);

  return (
    `👤 *Student: ${studentName}*\n\n` +
    `📝 *Question 1 of ${QUESTIONS_PER_SESSION}*\n\n` +
    `${answersPayload[0].question_text}\n\n` +
    `A) ${answersPayload[0].option_a}\n` +
    `B) ${answersPayload[0].option_b}\n` +
    `C) ${answersPayload[0].option_c}\n` +
    `D) ${answersPayload[0].option_d}\n\n` +
    `_Reply with A, B, C, or D_`
  );
}

// ── Answer handler ───────────────────────────────────────────────────────────

async function handleAnswer(phone, text, session) {
  const answers = parseAnswers(session.answers);
  const total   = answers.length;
  const idx     = session.current_index;

  const answer = normalizeAnswer(text);
  if (!answer) {
    return `Please reply *A*, *B*, *C*, or *D*.\n\n_Question ${idx + 1} of ${total} is still waiting._`;
  }

  // Record answer
  answers[idx].chosen = answer;
  const isCorrect = answer === answers[idx].correct;
  const newScore   = (session.score || 0) + (isCorrect ? 1 : 0);
  const newIndex   = idx + 1;

  if (newIndex < total) {
    // Save progress
    await db.pool.query(`
      UPDATE sessions SET
        current_index = $1,
        answers       = $2::jsonb,
        score         = $3,
        updated_at    = NOW()
      WHERE phone = $4
    `, [newIndex, JSON.stringify(answers), newScore, phone]);

    const next = answers[newIndex];
    return (
      `✅ *Answer recorded.*\n\n` +
      `📝 *Question ${newIndex + 1} of ${total}*\n\n` +
      `${next.question_text}\n\n` +
      `A) ${next.option_a}\n` +
      `B) ${next.option_b}\n` +
      `C) ${next.option_c}\n` +
      `D) ${next.option_d}\n\n` +
      `_Reply with A, B, C, or D_`
    );
  }

  // ── Student assessment complete ──────────────────────────────────────────
  const scorePct = Math.round((newScore / total) * 100);
  const passed   = scorePct >= PASS_THRESHOLD;
  const recommendation = passed
    ? `✅ Ready for Level ${session.level + 1}`
    : `📚 Needs re-assessment at Level ${session.level}`;

  // Save final answers and score
  await db.pool.query(`
    UPDATE sessions SET
      state         = $1,
      current_index = $2,
      answers       = $3::jsonb,
      score         = $4,
      updated_at    = NOW()
    WHERE phone = $5
  `, [STATE.STUDENT_COMPLETE, newIndex, JSON.stringify(answers), newScore, phone]);

  // Update the student_assessment record with results
  const finalSession = await db.getSession(phone);
  await db.pool.query(`
    UPDATE student_assessments SET
      correct_answers = $1,
      score_pct       = $2,
      passed          = $3,
      answers_detail  = $4::jsonb,
      recommendation  = $5,
      completed_at    = NOW()
    WHERE id = (
      SELECT id FROM student_assessments
      WHERE teacher_phone = $6
      ORDER BY id DESC LIMIT 1
    )
  `, [newScore, scorePct, passed, JSON.stringify(answers), recommendation, phone]);

  // Get student name from latest record
  const studentRec = await db.pool.query(`
    SELECT student_name FROM student_assessments
    WHERE teacher_phone = $1
    ORDER BY id DESC LIMIT 1
  `, [phone]);
  const studentName = studentRec.rows[0]?.student_name || 'Student';

  // Count students assessed so far
  const countRec = await db.pool.query(`
    SELECT COUNT(*) AS cnt FROM student_assessments
    WHERE teacher_phone = $1 AND pin_id = $2
  `, [phone, session.pin_id]);
  const studentsCount = parseInt(countRec.rows[0]?.cnt || 0);

  return (
    `🎉 *${studentName} — Complete!*\n\n` +
    `Score: *${newScore}/${total}* (${scorePct}%)\n` +
    `Result: ${recommendation}\n\n` +
    `─────────────────\n` +
    `👥 Students assessed: *${studentsCount}*\n\n` +
    `Type the *next student's name* to continue\n` +
    `or send *DONE* to finish the session.`
  );
}

// ── Student complete state ───────────────────────────────────────────────────

async function handleStudentComplete(phone, text, session) {
  const upper = text.toUpperCase();
  if (upper === 'DONE' || upper === 'FINISH' || upper === 'END') {
    return await finishSession(phone, session);
  }

  // Treat as new student name — move back to AWAITING_STUDENT_NAME
  await db.pool.query(`
    UPDATE sessions SET state = $1, updated_at = NOW() WHERE phone = $2
  `, [STATE.AWAITING_STUDENT_NAME, phone]);

  // Re-process as student name
  const updatedSession = await db.getSession(phone);
  return handleStudentName(phone, text, updatedSession);
}

// ── Finish session ───────────────────────────────────────────────────────────

async function finishSession(phone, session) {
  // Get all students from this session
  const studentsRec = await db.pool.query(`
    SELECT student_name, score_pct, passed, recommendation
    FROM student_assessments
    WHERE teacher_phone = $1 AND pin_id = $2
    ORDER BY id ASC
  `, [phone, session.pin_id]);

  // Get all students with their answers from session history
  const studentsRec = await db.pool.query(`
    SELECT sa.*, a.answers as session_answers
    FROM student_assessments sa
    LEFT JOIN sessions a ON a.phone = $1
    WHERE sa.teacher_phone = $1 AND sa.pin_id = $2
    ORDER BY sa.id ASC
  `, [phone, session.pin_id]);

  const students = studentsRec.rows;
  if (!students.length) {
    await db.clearSession(phone);
    return `No students were assessed. Session ended.\n\nSend your PIN to start a new session.`;
  }

  const totalStudents = students.length;
  const passedStudents = students.filter(s => s.passed).length;
  const avgScore = Math.round(students.reduce((sum, s) => sum + parseFloat(s.score_pct), 0) / totalStudents);
  const cohortPassed = avgScore >= PASS_THRESHOLD;

  // Save overall cohort assessment
  const assessment = await db.saveAssessment({
    pinId:          session.pin_id,
    schoolId:       session.school_id,
    teacherPhone:   phone,
    level:          session.level,
    subject:        session.subject,
    totalQuestions: totalStudents * QUESTIONS_PER_SESSION,
    correctAnswers: Math.round(avgScore * totalStudents * QUESTIONS_PER_SESSION / 100),
    scorePct:       avgScore,
    passed:         cohortPassed,
    answersDetail:  students,
  });

  // Build student summary
  const studentLines = students.map((s, i) =>
    `${i + 1}. ${s.student_name}: ${s.score_pct}% — ${s.passed ? '✅ Pass' : '📚 Reassess'}`
  ).join('\n');

  let resultMsg =
    `📊 *Session Complete!*\n\n` +
    `🏫 ${session.subject} | Level ${session.level}\n` +
    `👥 Students: ${totalStudents}\n` +
    `✅ Passed: ${passedStudents}/${totalStudents}\n` +
    `📈 Avg Score: ${avgScore}%\n\n` +
    `*Individual Results:*\n${studentLines}\n\n`;

  if (cohortPassed) {
    resultMsg += `✅ *Cohort meets the ${PASS_THRESHOLD}% threshold!*\nAdvancement request submitted to Ops.`;

    const req = await db.createAdvancementRequest({
      assessmentId:   assessment.id,
      pinId:          session.pin_id,
      schoolId:       session.school_id,
      level:          session.level,
      subject:        session.subject,
      scorePct:       avgScore,
      studentsCount:  totalStudents,
      studentsPassed: passedStudents,
    });

    const schoolRes  = await db.pool.query('SELECT name FROM schools WHERE id = $1', [session.school_id]);
    const schoolName = schoolRes.rows[0]?.name || 'Unknown School';
    await notifyOpsTeam({ ...req, students_count: totalStudents, students_passed: passedStudents }, schoolName, session);

  } else {
    resultMsg += `📈 Avg score ${PASS_THRESHOLD - avgScore}% below threshold. Re-assessment scheduled in 7 days.`;

    const schedDate = new Date();
    schedDate.setDate(schedDate.getDate() + 7);
    await db.pool.query(`
      INSERT INTO reassessment_schedule (school_id, level, subject, scheduled_date, reason, triggered_by_assessment)
      VALUES ($1,$2,$3,$4,$5,$6)
    `, [session.school_id, session.level, session.subject,
        schedDate.toISOString().split('T')[0],
        `Avg score ${avgScore}% below ${PASS_THRESHOLD}% threshold`,
        assessment.id]);
  }

  await db.pool.query(`
    UPDATE sessions SET state = $1, completed_at = NOW(), updated_at = NOW() WHERE phone = $2
  `, [STATE.SESSION_COMPLETE, phone]);

  return resultMsg;
}

// ── Ops handler ──────────────────────────────────────────────────────────────

async function handleOpsMessage(phone, text, upper) {
  const approveMatch = upper.match(/^APPROVE\s+(\d+)$/);
  if (approveMatch) {
    const id  = parseInt(approveMatch[1]);
    const req = await db.getAdvancementRequest(id);
    if (!req)                     return `❌ Request #${id} not found.`;
    if (req.status !== 'PENDING') return `ℹ️ Request #${id} is already ${req.status}.`;
    await db.approveAdvancement(id, phone);
    const res = await db.pool.query('SELECT teacher_phone FROM assessments WHERE id = $1', [req.assessment_id]);
    const tp  = res.rows[0]?.teacher_phone;
    if (tp) await notifyTeacher(tp, 'APPROVED', req.level, req.subject, null);
    return (
      `✅ *Approved!*\n\n` +
      `Request #${id} — ${req.school_name} | ${req.subject} Level ${req.level}→${req.level + 1}\n` +
      `Teacher notified. 7-day follow-up scheduled.`
    );
  }

  const rejectMatch = text.match(/^REJECT\s+(\d+)\s*(.*)/i);
  if (rejectMatch) {
    const id     = parseInt(rejectMatch[1]);
    const reason = rejectMatch[2]?.trim() || 'No reason provided';
    const req    = await db.getAdvancementRequest(id);
    if (!req)                     return `❌ Request #${id} not found.`;
    if (req.status !== 'PENDING') return `ℹ️ Request #${id} is already ${req.status}.`;
    await db.rejectAdvancement(id, phone, reason);
    const res = await db.pool.query('SELECT teacher_phone FROM assessments WHERE id = $1', [req.assessment_id]);
    const tp  = res.rows[0]?.teacher_phone;
    if (tp) await notifyTeacher(tp, 'REJECTED', req.level, req.subject, reason);
    return `✅ Request #${id} rejected. Teacher notified.`;
  }

  if (upper === 'STATS') {
    const s = await db.getAnalyticsSummary();
    const studentCount = await db.pool.query('SELECT COUNT(*) AS cnt FROM student_assessments');
    return (
      `📊 *TAKMIL Stats*\n\n` +
      `Assessments: ${s.total_assessments}\n` +
      `Students Assessed: ${studentCount.rows[0]?.cnt || 0}\n` +
      `Schools: ${s.schools_assessed}\n` +
      `Avg Score: ${s.avg_score}%\n` +
      `Passed: ${s.passed_count} | Below: ${s.failed_count}\n` +
      `Advancements Approved: ${s.advancements_approved}`
    );
  }

  if (upper === 'PENDING') {
    const res = await db.pool.query(`
      SELECT ar.id, s.name AS school, ar.subject, ar.level, ar.score_pct
      FROM advancement_requests ar
      JOIN schools s ON s.id = ar.school_id
      WHERE ar.status = 'PENDING'
      ORDER BY ar.created_at DESC LIMIT 10
    `);
    if (!res.rows.length) return `📋 No pending requests.`;
    return `📋 *Pending:*\n\n` + res.rows.map(r =>
      `#${r.id} | ${r.school} | ${r.subject} Lvl${r.level} | ${r.score_pct}%`
    ).join('\n');
  }

  return `👋 *Ops Commands:*\n\nAPPROVE <id>\nREJECT <id> <reason>\nSTATS\nPENDING`;
}

// ── Webhook ──────────────────────────────────────────────────────────────────

app.post('/webhook', async (req, res) => {
  const { From: from, Body: body } = req.body;
  if (!from || body === undefined) return res.status(400).send('Bad request');
  console.log(`📩 [${new Date().toISOString()}] From: ${from} | Msg: "${body}"`);
  try {
    const reply = await handleMessage(from, body);
    res.set('Content-Type', 'text/xml');
    res.send(
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<Response><Message>${escapeXml(reply)}</Message></Response>`
    );
  } catch (err) {
    console.error('❌ Webhook error:', err);
    res.set('Content-Type', 'text/xml');
    res.send(
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<Response><Message>Sorry, something went wrong. Please try again.</Message></Response>`
    );
  }
});

function escapeXml(str) {
  return (str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// ── Admin API ─────────────────────────────────────────────────────────────────

app.get('/', (req, res) => res.json({ status: 'ok', service: 'TAKMIL Bot', version: '3.0' }));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));
app.get('/import', (req, res) => res.sendFile(path.join(__dirname, 'import.html')));

app.post('/admin/pins/generate', async (req, res) => {
  const { schoolId, level, subject, cohortSize, issuedBy } = req.body;
  if (!schoolId || !level || !subject) return res.status(400).json({ error: 'schoolId, level, subject required' });
  try {
    const pin = await db.generatePin(schoolId, level, subject, cohortSize || 0, issuedBy || 'admin');
    res.json({ success: true, pin: pin.pin, expiresAt: pin.expires_at });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/admin/schools', async (req, res) => {
  const { name, province, district, contactName, contactPhone } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    const r = await db.pool.query(
      `INSERT INTO schools (name, province, district, contact_name, contact_phone) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [name, province, district, contactName, contactPhone]
    );
    res.json({ success: true, school: r.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/admin/ops', async (req, res) => {
  const { phone, name, role } = req.body;
  if (!phone || !name) return res.status(400).json({ error: 'phone and name required' });
  try {
    const r = await db.pool.query(
      `INSERT INTO ops_team (phone, name, role) VALUES ($1,$2,$3) ON CONFLICT (phone) DO UPDATE SET name=$2, role=$3, is_active=TRUE RETURNING *`,
      [phone, name, role || 'ops']
    );
    res.json({ success: true, ops: r.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/admin/schools/list', async (req, res) => {
  try {
    const r = await db.pool.query('SELECT * FROM schools ORDER BY created_at DESC');
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/admin/pins/list', async (req, res) => {
  try {
    const r = await db.pool.query(`
      SELECT p.*, s.name AS school_name FROM pins p
      LEFT JOIN schools s ON s.id = p.school_id
      ORDER BY p.created_at DESC LIMIT 100`);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/admin/advancements/pending', async (req, res) => {
  try {
    const r = await db.pool.query(`
      SELECT ar.*, s.name AS school_name, s.province FROM advancement_requests ar
      JOIN schools s ON s.id = ar.school_id WHERE ar.status = 'PENDING' ORDER BY ar.created_at DESC`);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/admin/advancements/all', async (req, res) => {
  try {
    const r = await db.pool.query(`
      SELECT ar.*, s.name AS school_name FROM advancement_requests ar
      JOIN schools s ON s.id = ar.school_id ORDER BY ar.created_at DESC`);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/admin/assessments/all', async (req, res) => {
  try {
    const r = await db.pool.query(`
      SELECT a.*, s.name AS school_name FROM assessments a
      LEFT JOIN schools s ON s.id = a.school_id ORDER BY a.completed_at DESC`);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Student assessments ───────────────────────────────────────────────────────

app.get('/admin/students/results', async (req, res) => {
  try {
    await db.pool.query(`
      CREATE TABLE IF NOT EXISTS student_assessments (
        id SERIAL PRIMARY KEY, pin_id INTEGER, school_id INTEGER,
        teacher_phone VARCHAR(20), student_name VARCHAR(100),
        level INTEGER, subject VARCHAR(20), total_questions INTEGER DEFAULT 10,
        correct_answers INTEGER DEFAULT 0, score_pct NUMERIC(5,2) DEFAULT 0,
        passed BOOLEAN DEFAULT FALSE, answers_detail JSONB,
        recommendation TEXT, completed_at TIMESTAMP DEFAULT NOW()
      )`);
    const r = await db.pool.query(`
      SELECT sa.*, s.name AS school_name, s.province
      FROM student_assessments sa
      LEFT JOIN schools s ON s.id = sa.school_id
      ORDER BY sa.completed_at DESC`);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/admin/students/results/:id', async (req, res) => {
  try {
    const r = await db.pool.query(`
      SELECT sa.*, s.name AS school_name FROM student_assessments sa
      LEFT JOIN schools s ON s.id = sa.school_id WHERE sa.id = $1`, [req.params.id]);
    res.json(r.rows[0] || null);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/admin/ops/list', async (req, res) => {
  try {
    const r = await db.pool.query('SELECT * FROM ops_team ORDER BY created_at ASC');
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/admin/reassessments/list', async (req, res) => {
  try {
    const r = await db.pool.query(`
      SELECT rs.*, s.name AS school_name FROM reassessment_schedule rs
      JOIN schools s ON s.id = rs.school_id ORDER BY rs.scheduled_date ASC`);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/admin/analytics', async (req, res) => {
  try {
    const summary   = await db.getAnalyticsSummary();
    const bySubject = await db.pool.query(`SELECT subject, COUNT(*) AS count, ROUND(AVG(score_pct),1) AS avg_score FROM assessments GROUP BY subject ORDER BY subject`);
    const byLevel   = await db.pool.query(`SELECT level, COUNT(*) AS count, ROUND(AVG(score_pct),1) AS avg_score, SUM(CASE WHEN passed THEN 1 ELSE 0 END) AS passed FROM assessments GROUP BY level ORDER BY level`);
    const upcoming  = await db.pool.query(`SELECT rs.*, s.name AS school_name FROM reassessment_schedule rs JOIN schools s ON s.id = rs.school_id WHERE rs.completed = FALSE AND rs.scheduled_date >= CURRENT_DATE ORDER BY rs.scheduled_date ASC LIMIT 20`);
    const studentStats = await db.pool.query(`SELECT COUNT(*) AS total, SUM(CASE WHEN passed THEN 1 ELSE 0 END) AS passed FROM student_assessments`).catch(() => ({ rows: [{ total: 0, passed: 0 }] }));
    res.json({ summary, bySubject: bySubject.rows, byLevel: byLevel.rows, upcomingReassessments: upcoming.rows, studentStats: studentStats.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/admin/import/questions', async (req, res) => {
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
        `INSERT INTO questions (question_id, level, subject, q_text_english, q_text_urdu, option_a, option_b, option_c, option_d, correct_option, topic_tag) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [questionId, level, subject, qText, qTextUrdu, optA, optB, optC, optD, correctOpt, topicTag]
      );
      inserted++;
    } catch (err) { lastError = err.message; errors++; }
  }
  res.json({ inserted, skipped, errors, lastError });
});

app.post('/admin/import/schools', async (req, res) => {
  const { rows } = req.body;
  if (!rows || !Array.isArray(rows)) return res.status(400).json({ error: 'rows array required' });
  let inserted = 0, skipped = 0, errors = 0;
  for (const row of rows) {
    try {
      const name = String(row.name || '').trim();
      if (!name) { skipped++; continue; }
      const exists = await db.pool.query('SELECT id FROM schools WHERE name = $1 AND district = $2', [name, row.district || '']);
      if (exists.rows.length > 0) { skipped++; continue; }
      await db.pool.query(`INSERT INTO schools (name, province, district, contact_name, contact_phone) VALUES ($1,$2,$3,$4,$5)`,
        [name, row.province || '', row.district || '', row.contact_name || '', row.contact_phone || '']);
      inserted++;
    } catch (err) { errors++; }
  }
  res.json({ inserted, skipped, errors });
});

app.post('/admin/import/students', async (req, res) => {
  const { rows } = req.body;
  if (!rows || !Array.isArray(rows)) return res.status(400).json({ error: 'rows array required' });
  let inserted = 0, skipped = 0, errors = 0;
  await db.pool.query(`CREATE TABLE IF NOT EXISTS students (id SERIAL PRIMARY KEY, school_id INTEGER REFERENCES schools(id), name VARCHAR(100), gender VARCHAR(10), age INTEGER, level INTEGER DEFAULT 1, created_at TIMESTAMP DEFAULT NOW())`);
  for (const row of rows) {
    try {
      const schoolId = parseInt(row.school_id) || null;
      const name = String(row.name || '').trim();
      if (!name || !schoolId) { skipped++; continue; }
      await db.pool.query(`INSERT INTO students (school_id, name, gender, age, level) VALUES ($1,$2,$3,$4,$5)`,
        [schoolId, name, row.gender || '', parseInt(row.age) || null, parseInt(row.level) || 1]);
      inserted++;
    } catch (err) { errors++; }
  }
  res.json({ inserted, skipped, errors });
});

app.get('/admin/debug/question', async (req, res) => {
  try {
    const r = await db.pool.query('SELECT * FROM questions LIMIT 1');
    res.json(r.rows[0] || {});
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
(async () => {
  try {
    await db.initializeDatabase();
    app.listen(PORT, () => console.log(`🚀 TAKMIL Bot v3.0 running on port ${PORT}`));
  } catch (err) {
    console.error('❌ Failed to start:', err);
    process.exit(1);
  }
})();
