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
  IN_FINAL_ASSESSMENT:   'IN_FINAL_ASSESSMENT',
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
    shuffled_correct: ['A','B','C','D'][opts.findIndex(o => o.text === correctText)] || 'A',
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

// ── Final Assessment: load 2 random questions per level ──────────────────────
async function loadFinalAssessmentQuestions(subject) {
  const levels = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  let all = [];
  for (const lvl of levels) {
    const res = await db.pool.query(
      `SELECT * FROM questions
       WHERE subject = $1 AND topic_tag = 'final_assessment' AND level = $2
       ORDER BY RANDOM() LIMIT 2`,
      [subject, lvl]
    );
    all = all.concat(res.rows);
  }
  return all;
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

  if (upper === 'RESET' || upper === 'START OVER') {
    await db.clearSession(phone);
    return (
      `🔄 Session cleared.\n\n` +
      `Welcome to *TAKMIL Assessment Bot*! 🌟\n\n` +
      `Please enter your *PIN* to begin.`
    );
  }

  const isOps = await db.isOpsPhone(phone);
  const isOpsCmd = upper.startsWith('APPROVE') || upper.startsWith('REJECT') ||
                   upper === 'PENDING' || upper === 'STATS' || upper === 'OPS HELP';
  if (isOps && isOpsCmd) return handleOpsMessage(phone, text, upper);

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
    case STATE.IN_FINAL_ASSESSMENT:   return handleFinalAnswer(phone, text, session);
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

  // ── Final Assessment detection (level = 0) ───────────────────────────────
  if (parseInt(pin.level) === 0) {
    await db.upsertSession(phone, {
      state:               STATE.CONFIRMING_SESSION,
      pin_id:              pin.id,
      school_id:           pin.school_id,
      level:               0,
      subject:             pin.subject,
      is_final_assessment: true,
    });
    return (
      `✅ *PIN Accepted!*\n\n` +
      `📋 *FINAL ASSESSMENT*\n` +
      `🏫 School: ${pin.school_name}\n` +
      `📚 Subject: ${pin.subject}\n` +
      `🎯 Covers: All Levels (L1–L11)\n` +
      `📝 Questions: 22 (2 per level)\n\n` +
      `Reply *YES* to begin or *NO* to cancel.`
    );
  }

  await db.upsertSession(phone, {
    state:     STATE.CONFIRMING_SESSION,
    pin_id:    pin.id,
    school_id: pin.school_id,
    level:     pin.level,
    subject:   pin.subject,
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
    `${session.subject} | ${parseInt(session.level) === 0 ? 'Final Assessment' : 'Level ' + session.level}\n\n` +
    `👤 *Enter the name of Student 1:*\n\n` +
    `_Type the student's full name and send_`
  );
}

// ── Student name entry ───────────────────────────────────────────────────────

async function handleStudentName(phone, text, session) {
  const upper = text.toUpperCase();

  if (upper === 'DONE' || upper === 'FINISH' || upper === 'END') {
    return await finishSession(phone, session);
  }

  const studentName = text.trim();
  if (studentName.length < 2) {
    return `Please enter the student's full name (at least 2 characters).`;
  }

  // ── Final Assessment flow ─────────────────────────────────────────────────
  if (session.is_final_assessment || parseInt(session.level) === 0) {
    const finalQs = await loadFinalAssessmentQuestions(session.subject);
    if (!finalQs || finalQs.length < 22) {
      return `⚠️ Final Assessment questions not found. Please import the Final Assessment xlsx first.`;
    }
    const shuffled = finalQs.map(shuffleOptions);
    const answersPayload = shuffled.map(q => ({
      id:            q.question_id || q.id,
      level:         q.level,
      question_text: q.q_text_english || q.question_text || 'Question not available',
      option_a: q.option_a, option_b: q.option_b,
      option_c: q.option_c, option_d: q.option_d,
      correct: q.shuffled_correct || q.correct_option || 'A',
      chosen: null,
    }));

    await db.pool.query(`
      UPDATE sessions SET
        state         = $1,
        current_index = 0,
        answers       = $2::jsonb,
        score         = 0,
        updated_at    = NOW()
      WHERE phone = $3
    `, [STATE.IN_FINAL_ASSESSMENT, JSON.stringify(answersPayload), phone]);

    await db.pool.query(`
      INSERT INTO student_assessments
        (pin_id, school_id, teacher_phone, student_name, level, subject, answers_detail)
      VALUES ($1,$2,$3,$4,0,$5,'[]'::jsonb)
    `, [session.pin_id, session.school_id, phone, studentName, session.subject]);

    const q1 = answersPayload[0];
    return (
      `👤 *Student: ${studentName}*\n` +
      `📋 *FINAL ASSESSMENT — ${session.subject}*\n` +
      `22 questions across all levels\n\n` +
      `📝 *Question 1 of 22* _(Level ${q1.level})_\n\n` +
      `${q1.question_text}\n\n` +
      `A) ${q1.option_a}\nB) ${q1.option_b}\nC) ${q1.option_c}\nD) ${q1.option_d}\n\n` +
      `_Reply with A, B, C, or D_`
    );
  }

  // ── Regular level assessment ──────────────────────────────────────────────
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

  await db.pool.query(`
    UPDATE sessions SET
      state         = $1,
      current_index = 0,
      answers       = $2::jsonb,
      score         = 0,
      updated_at    = NOW()
    WHERE phone = $3
  `, [STATE.IN_ASSESSMENT, JSON.stringify(answersPayload), phone]);

  await db.pool.query(`UPDATE sessions SET started_at = NOW() WHERE phone = $1`, [phone]);
  await db.pool.query(`UPDATE sessions SET subject = $1 WHERE phone = $2`, [session.subject, phone]);
  await db.pool.query(`UPDATE sessions SET question_ids = $1::integer[] WHERE phone = $2`, [[studentName.charCodeAt(0)], phone]);

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

  answers[idx].chosen = answer;
  const isCorrect = answer === answers[idx].correct;
  const newScore   = (session.score || 0) + (isCorrect ? 1 : 0);
  const newIndex   = idx + 1;

  if (newIndex < total) {
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

  await db.pool.query(`
    UPDATE sessions SET
      state         = $1,
      current_index = $2,
      answers       = $3::jsonb,
      score         = $4,
      updated_at    = NOW()
    WHERE phone = $5
  `, [STATE.STUDENT_COMPLETE, newIndex, JSON.stringify(answers), newScore, phone]);

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
  `, [newScore, scorePct, passed, JSON.stringify(finalSession.answers || answers), recommendation, phone]);

  const studentRec = await db.pool.query(`
    SELECT student_name FROM student_assessments
    WHERE teacher_phone = $1
    ORDER BY id DESC LIMIT 1
  `, [phone]);
  const studentName = studentRec.rows[0]?.student_name || 'Student';

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

// ── Final Assessment answer handler ──────────────────────────────────────────

async function handleFinalAnswer(phone, text, session) {
  const answers = parseAnswers(session.answers);
  const total   = answers.length;
  const idx     = session.current_index;

  const answer = normalizeAnswer(text);
  if (!answer) {
    return `Please reply *A*, *B*, *C*, or *D*.\n\n_Question ${idx + 1} of ${total} is still waiting._`;
  }

  answers[idx].chosen  = answer;
  const isCorrect      = answer === answers[idx].correct;
  const newScore       = (session.score || 0) + (isCorrect ? 1 : 0);
  const newIndex       = idx + 1;

  if (newIndex < total) {
    await db.pool.query(`
      UPDATE sessions SET current_index=$1, answers=$2::jsonb, score=$3, updated_at=NOW()
      WHERE phone=$4
    `, [newIndex, JSON.stringify(answers), newScore, phone]);

    const next = answers[newIndex];
    return (
      `${isCorrect ? '✅' : '❌'} *Answer recorded.*\n\n` +
      `📝 *Question ${newIndex + 1} of ${total}* _(Level ${next.level})_\n\n` +
      `${next.question_text}\n\n` +
      `A) ${next.option_a}\nB) ${next.option_b}\nC) ${next.option_c}\nD) ${next.option_d}\n\n` +
      `_Reply with A, B, C, or D_`
    );
  }

  // ── All 22 done ───────────────────────────────────────────────────────────
  const scorePct = Math.round((newScore / total) * 100);
  const passed   = scorePct >= PASS_THRESHOLD;

  const levelScores = {};
  for (const a of answers) {
    if (!levelScores[a.level]) levelScores[a.level] = { score: 0, total: 0 };
    levelScores[a.level].total++;
    if (a.chosen === a.correct) levelScores[a.level].score++;
  }
  let breakdown = '';
  for (let lvl = 1; lvl <= 11; lvl++) {
    const ls  = levelScores[lvl] || { score: 0, total: 2 };
    const bar = ls.score === 2 ? '🟢' : ls.score === 1 ? '🟡' : '🔴';
    breakdown += `${bar} L${lvl}: ${ls.score}/${ls.total}\n`;
  }

  await db.pool.query(`
    UPDATE sessions SET state=$1, current_index=$2, answers=$3::jsonb, score=$4, updated_at=NOW()
    WHERE phone=$5
  `, [STATE.STUDENT_COMPLETE, newIndex, JSON.stringify(answers), newScore, phone]);

  const recommendation = passed ? `✅ Completed Final Assessment` : `📚 Needs review`;
  await db.pool.query(`
    UPDATE student_assessments SET
      correct_answers=$1, score_pct=$2, passed=$3,
      answers_detail=$4::jsonb, recommendation=$5, completed_at=NOW()
    WHERE id=(SELECT id FROM student_assessments WHERE teacher_phone=$6 ORDER BY id DESC LIMIT 1)
  `, [newScore, scorePct, passed, JSON.stringify(answers), recommendation, phone]);

  await db.pool.query(`
    INSERT INTO assessments (pin_id, school_id, teacher_phone, level, subject,
      total_questions, correct_answers, score_pct, passed, answers_detail, completed_at)
    VALUES ($1,$2,$3,0,$4,$5,$6,$7,$8,$9::jsonb,NOW())
  `, [session.pin_id, session.school_id, phone, session.subject,
      total, newScore, scorePct, passed, JSON.stringify(levelScores)]);

  const studentRec = await db.pool.query(
    `SELECT student_name FROM student_assessments WHERE teacher_phone=$1 ORDER BY id DESC LIMIT 1`,
    [phone]
  );
  const studentName = studentRec.rows[0]?.student_name || 'Student';

  const countRec = await db.pool.query(
    `SELECT COUNT(*) AS cnt FROM student_assessments WHERE teacher_phone=$1 AND pin_id=$2`,
    [phone, session.pin_id]
  );
  const studentsCount = parseInt(countRec.rows[0]?.cnt || 0);

  return (
    `🎓 *${studentName} — FINAL ASSESSMENT COMPLETE!*\n\n` +
    `Score: *${newScore}/${total} (${scorePct}%)*\n` +
    `Result: *${passed ? '✅ PASSED' : '❌ NEEDS REVIEW'}*\n\n` +
    `📊 *Level Breakdown:*\n${breakdown}\n` +
    `🟢 Strong  🟡 Partial  🔴 Needs Work\n\n` +
    `─────────────────\n` +
    `👥 Students assessed: *${studentsCount}*\n\n` +
    `Type the *next student's name* to continue\n` +
    `or send *DONE* to finish.`
  );
}

// ── Student complete state ───────────────────────────────────────────────────

async function handleStudentComplete(phone, text, session) {
  const upper = text.toUpperCase();
  if (upper === 'DONE' || upper === 'FINISH' || upper === 'END') {
    return await finishSession(phone, session);
  }

  await db.pool.query(`
    UPDATE sessions SET state = $1, updated_at = NOW() WHERE phone = $2
  `, [STATE.AWAITING_STUDENT_NAME, phone]);

  const updatedSession = await db.getSession(phone);
  return handleStudentName(phone, text, updatedSession);
}

// ── Finish session ───────────────────────────────────────────────────────────

async function finishSession(phone, session) {
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

  const totalStudents  = students.length;
  const passedStudents = students.filter(s => s.passed).length;
  const avgScore       = Math.round(students.reduce((sum, s) => sum + parseFloat(s.score_pct), 0) / totalStudents);
  const cohortPassed   = avgScore >= PASS_THRESHOLD;

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
    const handled = await handleVideoCommands(from, body, res);
    if (handled) return;

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
app.get('/image-portal', (req, res) => res.sendFile(path.join(__dirname, 'image-portal.html')));
app.get('/pdf-portal', (req, res) => res.sendFile(path.join(__dirname, 'takmil-pdf-portal.html')));
app.get('/pdf-portal', (req, res) => res.sendFile(path.join(__dirname, 'takmil-pdf-portal-v2.html')));
app.get('/level2', (req,res) => res.sendFile(path.join(__dirname,'takmil-level2-portal.html')));
app.get('/assess', (req,res) => res.sendFile(path.join(__dirname,'takmil-unified-portal.html')));
app.get('/level3', (req,res) => res.sendFile(path.join(__dirname,'takmil-level3-portal.html')));
app.get('/jod-tod', (req,res) => res.sendFile(path.join(__dirname,'takmil-jod-tod-portal.html')));
// ══════════════════════════════════════════════════════════════════
// ADD THESE TWO BLOCKS TO index.js
// Paste BLOCK A anywhere after the existing app.get('/import') line
// ══════════════════════════════════════════════════════════════════

// ── BLOCK A: Serve portal.html ────────────────────────────────────
app.get('/portal', (req, res) => res.sendFile(path.join(__dirname, 'portal.html')));

// ── BLOCK B: Portal session start ────────────────────────────────
app.post('/portal/session/start', async (req, res) => {
  const { pin, studentName, subject } = req.body;
  if (!pin || !studentName) return res.status(400).json({ error: 'PIN and student name required.' });

  try {
    const pinRec = await db.validatePin(pin);
    if (!pinRec) return res.status(401).json({ error: 'Invalid or expired PIN. Please ask your teacher.' });

    const isFinal = parseInt(pinRec.level) === 0;
    const isMultiSubject = pinRec.subject === 'All' && !subject;
    let questions = [];
    let effectiveSubject = subject || pinRec.subject;

    // If All-subject PIN and no specific subject requested → return isMultiSubject flag
    if (isMultiSubject) {
      return res.json({ isMultiSubject: true, level: pinRec.level, isFinal });
    }

    if (isFinal) {
      const levels = [1,2,3,4,5,6,7,8,9,10,11];
      for (const lvl of levels) {
        const r = await db.pool.query(
          `SELECT * FROM questions
           WHERE subject=$1 AND topic_tag='final_assessment' AND level=$2 AND active=1
           ORDER BY RANDOM() LIMIT 2`,
          [effectiveSubject, lvl]
        );
        questions = questions.concat(r.rows);
      }
    } else {
      const r = await db.pool.query(
        `SELECT * FROM questions
         WHERE subject=$1 AND level=$2 AND active=1
         ORDER BY RANDOM() LIMIT 10`,
        [effectiveSubject, pinRec.level]
      );
      questions = r.rows;
    }

    if (!questions.length) {
      return res.status(404).json({ error: `No questions found for this assessment. Please contact your coordinator.` });
    }

    // Shuffle options for each question
    const shuffled = questions.map(q => {
      const correctOption = (q.correct_option || 'A').toUpperCase();
      const opts = [
        { label: 'A', text: q.option_a },
        { label: 'B', text: q.option_b },
        { label: 'C', text: q.option_c },
        { label: 'D', text: q.option_d },
      ];
      const correctText = opts.find(o => o.label === correctOption)?.text;
      for (let i = opts.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [opts[i], opts[j]] = [opts[j], opts[i]];
      }
      const shuffledCorrect = ['A','B','C','D'][opts.findIndex(o => o.text === correctText)] || 'A';
      return {
        id:            q.question_id || q.id,
        level:         q.level,
        question_text: q.q_text_english || q.question_text || '',
        q_text_urdu:   q.q_text_urdu || '',
        image_url:     q.image_url || null,
        option_a:      opts[0].text,
        option_b:      opts[1].text,
        option_c:      opts[2].text,
        option_d:      opts[3].text,
        correct:       shuffledCorrect,
      };
    });

    // Create student_assessment record
    await db.pool.query(`
      CREATE TABLE IF NOT EXISTS student_assessments (
        id SERIAL PRIMARY KEY, pin_id INTEGER, school_id INTEGER,
        teacher_phone VARCHAR(20), student_name VARCHAR(100),
        level INTEGER, subject VARCHAR(20), total_questions INTEGER DEFAULT 10,
        correct_answers INTEGER DEFAULT 0, score_pct NUMERIC(5,2) DEFAULT 0,
        passed BOOLEAN DEFAULT FALSE, answers_detail JSONB,
        recommendation TEXT, completed_at TIMESTAMP DEFAULT NOW()
      )
    `);

    const saRec = await db.pool.query(`
      INSERT INTO student_assessments
        (pin_id, school_id, teacher_phone, student_name, level, subject, answers_detail)
      VALUES ($1,$2,'portal',$3,$4,$5,'[]'::jsonb)
      RETURNING id
    `, [pinRec.id, pinRec.school_id, studentName, pinRec.level, effectiveSubject]);

    res.json({
      sessionId:   saRec.rows[0].id,
      subject:     effectiveSubject,
      level:       pinRec.level,
      isFinal,
      questions:   shuffled,
    });

  } catch (err) {
    console.error('Portal start error:', err);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// ── BLOCK C: Portal session submit ───────────────────────────────
app.post('/portal/session/submit', async (req, res) => {
  const { sessionId, answers, questions } = req.body;
  if (!sessionId || !answers || !questions) {
    return res.status(400).json({ error: 'sessionId, answers, questions required.' });
  }

  try {
    const total  = questions.length;
    let score    = 0;
    const levelScores = {};

    questions.forEach((q, i) => {
      const chosen  = answers[i];
      const correct = q.correct;
      const isRight = chosen === correct;
      if (isRight) score++;

      if (!levelScores[q.level]) levelScores[q.level] = { score: 0, total: 0 };
      levelScores[q.level].total++;
      if (isRight) levelScores[q.level].score++;
    });

    const pct    = Math.round((score / total) * 100);
    const passed = pct >= PASS_THRESHOLD;
    const recommendation = passed ? '✅ Passed via Portal' : '📚 Needs review';

    await db.pool.query(`
      UPDATE student_assessments SET
        correct_answers = $1, score_pct = $2, passed = $3,
        answers_detail  = $4::jsonb, recommendation = $5,
        total_questions = $6, completed_at = NOW()
      WHERE id = $7
    `, [score, pct, passed, JSON.stringify({ answers, levelScores }), recommendation, total, sessionId]);

    res.json({ score, total, pct, passed, levelScores });

  } catch (err) {
    console.error('Portal submit error:', err);
    res.status(500).json({ error: 'Failed to save results.' });
  }
});


app.post('/admin/pins/generate', async (req, res) => {
  const { schoolId, level, subject, cohortSize, issuedBy, teacherPhone } = req.body;
  if (!schoolId || level === undefined || !subject) return res.status(400).json({ error: 'schoolId, level, subject required' });
  try {
    const pin = await db.generatePin(schoolId, level, subject, cohortSize || 0, issuedBy || 'admin');

    // Auto-send WhatsApp to teacher if phone provided
    if (teacherPhone) {
      const schoolRes = await db.pool.query('SELECT name FROM schools WHERE id=$1', [schoolId]);
      const schoolName = schoolRes.rows[0]?.name || 'your school';
      const msg = `*TAKMIL Assessment PIN*\n\nSchool: ${schoolName}\nLevel: ${level}\nSubject: ${subject}\n\n*PIN: ${pin.pin}*\n\nShare this PIN with students. Valid for 24 hours.\n\nطالب علموں کو یہ PIN دیں۔`;
      try {
        const toNum = teacherPhone.startsWith('whatsapp:') ? teacherPhone : `whatsapp:${teacherPhone}`;
        console.log(`📱 Sending WhatsApp to ${toNum} from ${FROM_NUMBER}`);
        const msg_result = await twilioClient.messages.create({ from: FROM_NUMBER, to: toNum, body: msg });
        console.log(`✅ WhatsApp sent, SID: ${msg_result.sid}`);
      } catch (twilioErr) {
        console.log(`❌ WhatsApp failed: ${twilioErr.message} (code: ${twilioErr.code})`);
      }
    }

    res.json({ success: true, pin: pin.pin, expiresAt: pin.expires_at, whatsappSent: !!teacherPhone });
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

    // ── Video module and question bank routes are defined above ──

// ── CODE VERIFICATION ────────────────────────────────────────────
// Same formula used in the HTML player — must stay in sync
function verifyVideoCode(schoolCode, videoName, dateStr, slotIndex) {
  const raw = schoolCode + '|' + videoName + '|' + dateStr + '|V' + (slotIndex + 1);
  let h = 0;
  for (let i = 0; i < raw.length; i++) {
    h = ((h << 5) - h) + raw.charCodeAt(i);
    h |= 0;
  }
  return (Math.abs(h) % 900000 + 100000).toString();
}

function todayDateStr() {
  const n = new Date();
  return n.getFullYear() + '-' +
    String(n.getMonth() + 1).padStart(2, '0') + '-' +
    String(n.getDate()).padStart(2, '0');
}

// ── SEND WHATSAPP MESSAGE ─────────────────────────────────────────
async function sendWA(to, body) {
  try {
    await twilioClient.messages.create({
      from: process.env.TWILIO_WHATSAPP_FROM,
      to,
      body
    });
  } catch (e) {
    console.error('sendWA error:', e.message);
  }
}

// ── GET ACTIVE ROLE ───────────────────────────────────────────────
async function getActiveRole(phone) {
  const res = await pool.query(
    `SELECT active_role, entity_code, name FROM user_roles
     WHERE phone = $1 AND role = (SELECT active_role FROM user_roles WHERE phone = $1 LIMIT 1)
     LIMIT 1`,
    [phone]
  );
  if (!res.rows.length) return null;
  // Get the active_role from any row for this phone
  const roleRow = await pool.query(
    `SELECT DISTINCT active_role FROM user_roles WHERE phone = $1 LIMIT 1`, [phone]
  );
  if (!roleRow.rows.length) return null;
  const activeRole = roleRow.rows[0].active_role;
  const entityRow = await pool.query(
    `SELECT entity_code, name FROM user_roles WHERE phone = $1 AND role = $2 LIMIT 1`,
    [phone, activeRole]
  );
  return entityRow.rows.length ? { role: activeRole, ...entityRow.rows[0] } : null;
}

// ── MAIN MESSAGE ROUTER ───────────────────────────────────────────
// ADD THIS inside your existing webhook handler where you process inbound messages
// Look for: app.post('/webhook', ...) or similar
// Add this call: await handleVideoCommands(from, body, res)

async function handleVideoCommands(from, msgBody, twilioRes) {
  const msg = msgBody.trim();
  const upper = msg.toUpperCase();

  // ── ROLE SWITCH ─────────────────────────────────────────────────
  // Format: ROLE FACILITATOR  or  ROLE COORDINATOR  or  ROLE REGIONAL  or  ROLE ADMIN
  if (upper.startsWith('ROLE ')) {
    const newRole = upper.split(' ')[1]?.toLowerCase();
    const validRoles = ['facilitator', 'coordinator', 'regional', 'admin'];
    if (!validRoles.includes(newRole)) {
      await sendWA(from,
        `❌ Unknown role.\n\nValid roles:\nROLE FACILITATOR\nROLE COORDINATOR\nROLE REGIONAL\nROLE ADMIN`
      );
      return true;
    }
    // Check this phone has that role registered
    const check = await pool.query(
      `SELECT entity_code, name FROM user_roles WHERE phone = $1 AND role = $2`, [from, newRole]
    );
    if (!check.rows.length) {
      await sendWA(from, `❌ Your phone is not registered as ${newRole.toUpperCase()}.`);
      return true;
    }
    await pool.query(
      `UPDATE user_roles SET active_role = $1, updated_at = NOW() WHERE phone = $2`, [newRole, from]
    );
    const { entity_code, name } = check.rows[0];
    await sendWA(from,
      `✅ Role switched to: *${newRole.toUpperCase()}*\n` +
      `Name: ${name}\n` +
      `Entity: ${entity_code}\n\n` +
      getRoleHelp(newRole)
    );
    return true;
  }

  // ── WHOAMI ──────────────────────────────────────────────────────
  if (upper === 'WHOAMI' || upper === 'WHO AM I') {
    const r = await getActiveRole(from);
    if (!r) {
      await sendWA(from, `❓ You are not registered. Contact admin.`);
      return true;
    }
    await sendWA(from,
      `👤 You are currently acting as:\n*${r.role.toUpperCase()}*\n${r.name} | ${r.entity_code}\n\n` +
      getRoleHelp(r.role)
    );
    return true;
  }

  // ── GET ACTIVE ROLE ──────────────────────────────────────────────
  const roleInfo = await getActiveRole(from);
  if (!roleInfo) return false; // not a registered user — let other handlers deal with it

  // ════════════════════════════════════════════════════════════════
  // FACILITATOR COMMANDS
  // ════════════════════════════════════════════════════════════════
  if (roleInfo.role === 'facilitator') {

    // DAILY REPORT
    // Format: DAILY SCH-047 Topic Name | V1:filename|code | V2:filename|code | V3:filename|code
    // Simplified format: DAILY SCH-047 847293 563821 192847
    if (upper.startsWith('DAILY ')) {
      const parts = msg.split(' ').filter(p => p.trim());
      // parts[0]=DAILY parts[1]=SCH-047 parts[2]=code1 parts[3]=code2 parts[4]=code3
      if (parts.length < 5) {
        await sendWA(from,
          `❌ Wrong format.\n\nSend:\nDAILY SCH-047 CODE1 CODE2 CODE3\n\nExample:\nDAILY SCH-047 847293 563821 192847`
        );
        return true;
      }
      const schoolCode = parts[1].toUpperCase();
      const codes = [parts[2], parts[3], parts[4]];
      const dateStr = todayDateStr();

      // Get school details
      const school = await pool.query(
        `SELECT * FROM schools WHERE school_code = $1`, [schoolCode]
      );
      if (!school.rows.length) {
        await sendWA(from, `❌ School ${schoolCode} not found.`);
        return true;
      }

      // Get active section
      const section = await pool.query(
        `SELECT sc.*, s.title FROM section_completions sc
         JOIN sections s ON s.section_code = sc.section_code
         WHERE sc.school_code = $1 AND sc.status = 'in_progress'
         ORDER BY sc.id DESC LIMIT 1`,
        [schoolCode]
      );
      if (!section.rows.length) {
        await sendWA(from, `❌ No active section found for ${schoolCode}. Contact coordinator.`);
        return true;
      }
      const sec = section.rows[0];

      // Check if already submitted today
      const existing = await pool.query(
        `SELECT id, status FROM daily_sessions WHERE school_code=$1 AND session_date=$2`,
        [schoolCode, dateStr]
      );
      if (existing.rows.length && existing.rows[0].status !== 'rejected') {
        const st = existing.rows[0].status;
        await sendWA(from,
          st === 'approved'
            ? `✅ Today's session for ${schoolCode} is already APPROVED. Well done!`
            : `⏳ Already submitted for today. Awaiting coordinator approval.`
        );
        return true;
      }

      // NOTE: For full verification, video filenames would be in the report message.
      // In simplified mode, we accept codes as submitted (coordinator does final human check).
      // Store the session
      const q = existing.rows.length
        ? `UPDATE daily_sessions SET v1_code=$1,v2_code=$2,v3_code=$3,status='pending',
             submitted_at=NOW(),submitted_by=$4,topic=$5,section_code=$6
           WHERE school_code=$7 AND session_date=$8`
        : `INSERT INTO daily_sessions
             (school_code,section_code,session_date,topic,v1_code,v2_code,v3_code,submitted_at,submitted_by,status)
           VALUES ($7,$6,$8,$5,$1,$2,$3,NOW(),$4,'pending')`;

      await pool.query(q, [
        codes[0], codes[1], codes[2],
        roleInfo.name,
        sec.title,
        sec.section_code,
        schoolCode,
        dateStr
      ]);

      await sendWA(from,
        `✅ Daily report received!\n\n` +
        `School: ${schoolCode}\n` +
        `Topic: ${sec.title}\n` +
        `Date: ${dateStr}\n` +
        `Codes: ${codes.join(' | ')}\n\n` +
        `⏳ Awaiting coordinator approval.`
      );

      // Alert coordinator
      const coordPhone = school.rows[0].coordinator_phone;
      if (coordPhone && coordPhone !== from) {
        await sendWA(coordPhone,
          `📋 *New daily report — ${schoolCode}*\n` +
          `Topic: ${sec.title} | Date: ${dateStr}\n` +
          `Codes: ${codes.join(' ')}\n\n` +
          `Reply:\nAPPROVE ${schoolCode}\nREJECT ${schoolCode} [reason]`
        );
      } else {
        // Coordinator is same phone (testing mode) — show reminder
        await sendWA(from,
          `\n📌 *[TEST MODE — Switch to COORDINATOR role to approve]*\n` +
          `Send: ROLE COORDINATOR\nThen: APPROVE ${schoolCode}`
        );
      }
      return true;
    }

    // MY STATUS — facilitator checks their school's progress
    if (upper === 'MY STATUS' || upper.startsWith('STATUS SCH')) {
      const schoolCode = upper.includes('SCH') ? upper.split(' ')[1] : roleInfo.entity_code;
      const sc = await pool.query(
        `SELECT sc.approved_days, sc.total_days, sc.status, s.title
         FROM section_completions sc JOIN sections s ON s.section_code=sc.section_code
         WHERE sc.school_code=$1 AND sc.status IN ('in_progress','complete','assessment_unlocked')
         LIMIT 1`, [schoolCode]
      );
      if (!sc.rows.length) {
        await sendWA(from, `No active section found for ${schoolCode}.`);
        return true;
      }
      const r = sc.rows[0];
      const pct = Math.round((r.approved_days / r.total_days) * 100);
      const bar = '█'.repeat(Math.floor(pct/10)) + '░'.repeat(10-Math.floor(pct/10));
      await sendWA(from,
        `📊 *${schoolCode} Progress*\n` +
        `Section: ${r.title}\n` +
        `${bar} ${pct}%\n` +
        `Days approved: ${r.approved_days} / ${r.total_days}\n` +
        `Status: ${r.status.toUpperCase()}`
      );
      return true;
    }

    // HELP
    if (upper === 'HELP' || upper === '?') {
      await sendWA(from, getRoleHelp('facilitator'));
      return true;
    }
  }

  // ════════════════════════════════════════════════════════════════
  // COORDINATOR COMMANDS
  // ════════════════════════════════════════════════════════════════
  if (roleInfo.role === 'coordinator') {

    // APPROVE SCH-047
    if (upper.startsWith('APPROVE ')) {
      const schoolCode = upper.split(' ')[1];
      const dateStr = todayDateStr();

      const session = await pool.query(
        `SELECT * FROM daily_sessions WHERE school_code=$1 AND session_date=$2`, [schoolCode, dateStr]
      );
      if (!session.rows.length) {
        await sendWA(from, `❌ No submission found today for ${schoolCode}.`);
        return true;
      }
      if (session.rows[0].status === 'approved') {
        await sendWA(from, `✅ ${schoolCode} already approved today.`);
        return true;
      }

      // Approve
      await pool.query(
        `UPDATE daily_sessions SET status='approved', approved_by=$1, approved_at=NOW()
         WHERE school_code=$2 AND session_date=$3`,
        [from, schoolCode, dateStr]
      );

      // Increment approved_days in section_completions
      const updated = await pool.query(
        `UPDATE section_completions
         SET approved_days = approved_days + 1,
             status = CASE WHEN approved_days + 1 >= total_days THEN 'complete' ELSE status END,
             completed_at = CASE WHEN approved_days + 1 >= total_days THEN NOW() ELSE completed_at END
         WHERE school_code=$1 AND status='in_progress'
         RETURNING approved_days, total_days, status, section_code`,
        [schoolCode]
      );

      const sc = updated.rows[0];
      const pct = Math.round((sc.approved_days / sc.total_days) * 100);
      const bar = '█'.repeat(Math.floor(pct/10)) + '░'.repeat(10-Math.floor(pct/10));

      let reply =
        `✅ *APPROVED* — ${schoolCode}\n` +
        `Date: ${dateStr}\n` +
        `${bar} ${pct}%\n` +
        `Section progress: ${sc.approved_days}/${sc.total_days} days\n`;

      if (sc.status === 'complete') {
        reply +=
          `\n🎉 *SECTION COMPLETE!*\n` +
          `All ${sc.total_days} days approved.\n` +
          `Send: UNLOCK ASSESS ${schoolCode}\nto release the assessment PIN.`;
      }

      await sendWA(from, reply);

      // Notify facilitator
      const school = await pool.query(`SELECT facilitator_phone FROM schools WHERE school_code=$1`, [schoolCode]);
      if (school.rows.length && school.rows[0].facilitator_phone !== from) {
        await sendWA(school.rows[0].facilitator_phone,
          `✅ Today's session APPROVED by coordinator!\n${schoolCode} | Day ${sc.approved_days}/${sc.total_days}`
        );
      } else {
        await sendWA(from, `\n📌 *[TEST MODE]* Facilitator would receive approval notification.`);
      }
      return true;
    }

    // REJECT SCH-047 reason text
    if (upper.startsWith('REJECT ')) {
      const parts = msg.split(' ');
      const schoolCode = parts[1].toUpperCase();
      const reason = parts.slice(2).join(' ') || 'No reason given';
      const dateStr = todayDateStr();

      await pool.query(
        `UPDATE daily_sessions SET status='rejected', reject_reason=$1, approved_by=$2, approved_at=NOW()
         WHERE school_code=$3 AND session_date=$4`,
        [reason, from, schoolCode, dateStr]
      );

      await sendWA(from, `❌ Rejected ${schoolCode}. Reason: ${reason}`);

      const school = await pool.query(`SELECT facilitator_phone FROM schools WHERE school_code=$1`, [schoolCode]);
      if (school.rows.length && school.rows[0].facilitator_phone !== from) {
        await sendWA(school.rows[0].facilitator_phone,
          `❌ Today's session was REJECTED.\nSchool: ${schoolCode}\nReason: ${reason}\n\nPlease resubmit today.`
        );
      } else {
        await sendWA(from, `\n📌 *[TEST MODE]* Facilitator would receive rejection: "${reason}"`);
      }
      return true;
    }

    // STATUS SCH-047 — coordinator checks one school
    if (upper.startsWith('STATUS ')) {
      const schoolCode = upper.split(' ')[1];
      const sessions = await pool.query(
        `SELECT session_date, status, v1_code, v2_code, v3_code, submitted_at
         FROM daily_sessions WHERE school_code=$1
         ORDER BY session_date DESC LIMIT 7`,
        [schoolCode]
      );
      const sc = await pool.query(
        `SELECT sc.approved_days, sc.total_days, sc.status, s.title
         FROM section_completions sc JOIN sections s ON s.section_code=sc.section_code
         WHERE sc.school_code=$1 LIMIT 1`, [schoolCode]
      );
      if (!sc.rows.length) { await sendWA(from, `No data for ${schoolCode}`); return true; }
      const r = sc.rows[0];
      let reply = `📊 *${schoolCode} Status*\nSection: ${r.title}\nDays approved: ${r.approved_days}/${r.total_days}\n\nLast 7 days:\n`;
      sessions.rows.forEach(s => {
        const icon = s.status==='approved'?'✅':s.status==='rejected'?'❌':'⏳';
        reply += `${icon} ${s.session_date} — ${s.status}\n`;
      });
      await sendWA(from, reply);
      return true;
    }

    // MY SCHOOLS — show all 10 schools status
    if (upper === 'MY SCHOOLS' || upper === 'SCHOOLS') {
      // In real system, filter by coordinator. In test, show SCH-047
      const rows = await pool.query(
        `SELECT sc.school_code, sc.approved_days, sc.total_days, sc.status,
                ds.status as today_status
         FROM section_completions sc
         LEFT JOIN daily_sessions ds ON ds.school_code=sc.school_code AND ds.session_date=CURRENT_DATE
         WHERE sc.status IN ('in_progress','complete')
         ORDER BY sc.school_code`
      );
      let reply = `📋 *My Schools — ${todayDateStr()}*\n\n`;
      rows.rows.forEach(r => {
        const today = r.today_status === 'approved' ? '✅' : r.today_status === 'pending' ? '⏳' : r.today_status === 'rejected' ? '❌' : '○';
        const pct = Math.round((r.approved_days/r.total_days)*100);
        reply += `${today} ${r.school_code}: ${r.approved_days}/${r.total_days} days (${pct}%)\n`;
      });
      reply += `\nLegend: ✅ today approved  ⏳ pending  ❌ rejected  ○ not submitted`;
      await sendWA(from, reply);
      return true;
    }

    // UNLOCK ASSESS SCH-047 — coordinator releases assessment PIN
    if (upper.startsWith('UNLOCK ASSESS ') || upper.startsWith('UNLOCK ')) {
      const schoolCode = upper.split(' ').pop();
      const sc = await pool.query(
        `SELECT * FROM section_completions WHERE school_code=$1 AND status='complete'`, [schoolCode]
      );
      if (!sc.rows.length) {
        // Check progress
        const prog = await pool.query(
          `SELECT approved_days, total_days FROM section_completions WHERE school_code=$1`, [schoolCode]
        );
        if (prog.rows.length) {
          const r = prog.rows[0];
          await sendWA(from,
            `❌ Cannot unlock yet.\n${schoolCode} has only ${r.approved_days}/${r.total_days} days approved.\n` +
            `All days must be coordinator-approved before assessment is released.`
          );
        } else {
          await sendWA(from, `❌ No active section found for ${schoolCode}.`);
        }
        return true;
      }

      // Get a PIN from the existing pins table or generate a temporary one
      const pinResult = await pool.query(
        `SELECT pin FROM pins WHERE school_id = (SELECT id FROM schools WHERE school_code=$1)
         AND subject='Math' AND is_used=FALSE LIMIT 1`,
        [schoolCode]
      );

      let pin = pinResult.rows.length ? pinResult.rows[0].pin : Math.floor(100000 + Math.random() * 900000).toString();

      await pool.query(
        `UPDATE section_completions SET status='assessment_unlocked', assessment_pin=$1, pin_sent_at=NOW()
         WHERE school_code=$2 AND status='complete'`,
        [pin, schoolCode]
      );

      await sendWA(from,
        `🎉 *Assessment UNLOCKED — ${schoolCode}*\n\n` +
        `PIN: *${pin}*\n` +
        `Portal: https://takmil-bot-production-0f51.up.railway.app/level5\n\n` +
        `Facilitator has been notified.`
      );

      const school = await pool.query(`SELECT facilitator_phone FROM schools WHERE school_code=$1`, [schoolCode]);
      if (school.rows.length && school.rows[0].facilitator_phone !== from) {
        await sendWA(school.rows[0].facilitator_phone,
          `🎉 Assessment is ready!\n\nPIN: *${pin}*\n` +
          `Open: https://takmil-bot-production-0f51.up.railway.app/level5\n\n` +
          `Get students on tablets and begin!`
        );
      } else {
        await sendWA(from,
          `\n📌 *[TEST MODE]* Facilitator would receive PIN: ${pin}\n` +
          `Switch to FACILITATOR role to simulate receiving it.`
        );
      }
      return true;
    }

    // HELP
    if (upper === 'HELP' || upper === '?') {
      await sendWA(from, getRoleHelp('coordinator'));
      return true;
    }
  }

  // ════════════════════════════════════════════════════════════════
  // REGIONAL COORDINATOR COMMANDS
  // ════════════════════════════════════════════════════════════════
  if (roleInfo.role === 'regional') {

    if (upper === 'REGION STATUS' || upper === 'STATUS') {
      const rows = await pool.query(
        `SELECT sc.school_code, sc.approved_days, sc.total_days,
                ROUND(sc.approved_days::numeric/sc.total_days*100) as pct,
                COUNT(CASE WHEN ds.status='approved' AND ds.session_date=CURRENT_DATE THEN 1 END) as today_ok
         FROM section_completions sc
         LEFT JOIN daily_sessions ds ON ds.school_code=sc.school_code
         WHERE sc.status IN ('in_progress','complete','assessment_unlocked')
         GROUP BY sc.school_code,sc.approved_days,sc.total_days
         ORDER BY pct ASC`
      );
      const total = rows.rows.length;
      const onTrack = rows.rows.filter(r => r.pct >= 80).length;
      const today = rows.rows.filter(r => parseInt(r.today_ok) > 0).length;
      let reply = `📊 *Regional Status — ${todayDateStr()}*\n`;
      reply += `Schools: ${total} | On track: ${onTrack} | Submitted today: ${today}\n\n`;
      reply += `Bottom 5 schools:\n`;
      rows.rows.slice(0, 5).forEach(r => {
        reply += `⚠ ${r.school_code}: ${r.approved_days}/${r.total_days} (${r.pct}%)\n`;
      });
      await sendWA(from, reply);
      return true;
    }

    if (upper === 'HELP' || upper === '?') {
      await sendWA(from, getRoleHelp('regional'));
      return true;
    }
  }

  // ════════════════════════════════════════════════════════════════
  // ADMIN COMMANDS
  // ════════════════════════════════════════════════════════════════
  if (roleInfo.role === 'admin') {

    if (upper === 'ADMIN STATUS' || upper === 'STATUS ALL') {
      const total = await pool.query(`SELECT COUNT(*) as c FROM schools`);
      const sections = await pool.query(
        `SELECT status, COUNT(*) as c FROM section_completions GROUP BY status`
      );
      const today = await pool.query(
        `SELECT status, COUNT(*) as c FROM daily_sessions WHERE session_date=CURRENT_DATE GROUP BY status`
      );
      let reply = `🏢 *Admin Overview — ${todayDateStr()}*\n`;
      reply += `Total schools: ${total.rows[0]?.c || 0}\n\n`;
      reply += `Section status:\n`;
      sections.rows.forEach(r => reply += `  ${r.status}: ${r.c}\n`);
      reply += `\nToday's submissions:\n`;
      today.rows.forEach(r => reply += `  ${r.status}: ${r.c}\n`);
      reply += `\nPower BI: https://app.powerbi.com (full dashboard)`;
      await sendWA(from, reply);
      return true;
    }

    // RESET TEST — wipe today's test data so you can redo the test
    if (upper === 'RESET TEST') {
      await pool.query(`DELETE FROM daily_sessions WHERE school_code='SCH-047' AND session_date=CURRENT_DATE`);
      await pool.query(`UPDATE section_completions SET approved_days=0, status='in_progress', completed_at=NULL, assessment_pin=NULL WHERE school_code='SCH-047'`);
      await sendWA(from, `🔄 Test data reset for SCH-047. You can run the full test again.`);
      return true;
    }

    if (upper === 'HELP' || upper === '?') {
      await sendWA(from, getRoleHelp('admin'));
      return true;
    }
  }

  return false; // not handled by this module
}

// ── ROLE HELP MESSAGES ────────────────────────────────────────────
function getRoleHelp(role) {
  const helps = {
    facilitator:
      `📱 *Facilitator Commands*\n\n` +
      `DAILY SCH-047 CODE1 CODE2 CODE3\n  Submit today's 3 video codes\n\n` +
      `MY STATUS\n  Check your school's progress\n\n` +
      `ROLE [name]\n  Switch role (for testing)`,

    coordinator:
      `📋 *Coordinator Commands*\n\n` +
      `APPROVE SCH-047\n  Approve today's session\n\n` +
      `REJECT SCH-047 [reason]\n  Reject with reason\n\n` +
      `STATUS SCH-047\n  Check one school's status\n\n` +
      `MY SCHOOLS\n  See all 10 schools today\n\n` +
      `UNLOCK ASSESS SCH-047\n  Release assessment PIN (when section complete)\n\n` +
      `ROLE [name]\n  Switch role`,

    regional:
      `🗺️ *Regional Coordinator Commands*\n\n` +
      `REGION STATUS\n  See all schools in your region\n\n` +
      `ROLE [name]\n  Switch role`,

    admin:
      `🏢 *Admin Commands*\n\n` +
      `ADMIN STATUS\n  Full system overview\n\n` +
      `RESET TEST\n  Reset SCH-047 test data\n\n` +
      `ROLE [name]\n  Switch role`
  };
  return helps[role] || `Send HELP after switching role.`;
}

// ── INTEGRATE INTO EXISTING WEBHOOK ──────────────────────────────
// In your existing webhook handler, find where you process the message body
// and ADD this line BEFORE your existing command handling:
//
//   const handled = await handleVideoCommands(from, body, res);
//   if (handled) return;
//
// This lets the video module handle its commands first,
// then falls through to existing PIN/assessment logic.
app.get('/console', (req, res) => {
  res.sendFile(path.join(__dirname, 'takmil-ops-console.html'));
});

app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// ── Admin session status (used by ops console sidebar) ────────────
app.get('/admin/session-status', async (req, res) => {
  try {
    const school = req.query.school || 'SCH-047';
    const sc = await db.pool.query(
      `SELECT sc.approved_days, sc.total_days, sc.status, s.title as section_title
       FROM section_completions sc
       JOIN sections s ON s.section_code = sc.section_code
       WHERE sc.school_code = $1 ORDER BY sc.id DESC LIMIT 1`, [school]
    );
    const today      = await db.pool.query(`SELECT status FROM daily_sessions WHERE school_code=$1 AND session_date=CURRENT_DATE`, [school]);
    const sysTotal   = await db.pool.query(`SELECT COUNT(*) as c FROM schools`);
    const sysActive  = await db.pool.query(`SELECT COUNT(*) as c FROM section_completions WHERE status IN ('in_progress','complete')`);
    const sysTodaySub= await db.pool.query(`SELECT COUNT(*) as c FROM daily_sessions WHERE session_date=CURRENT_DATE`);
    const sysUnlocked= await db.pool.query(`SELECT COUNT(*) as c FROM section_completions WHERE status='assessment_unlocked'`);
    res.json({
      school_code:   school,
      approved_days: sc.rows[0]?.approved_days ?? 0,
      total_days:    sc.rows[0]?.total_days ?? 0,
      status:        sc.rows[0]?.status ?? 'no_section',
      section_title: sc.rows[0]?.section_title ?? '—',
      today_status:  today.rows[0]?.status ?? null,
      system: {
        total_schools:   sysTotal.rows[0]?.c ?? 0,
        active_sections: sysActive.rows[0]?.c ?? 0,
        today_submitted: sysTodaySub.rows[0]?.c ?? 0,
        unlocked:        sysUnlocked.rows[0]?.c ?? 0,
      }
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════════════
// QUESTION BANK MANAGER — all routes
// ══════════════════════════════════════════════════════════════════

app.get('/question-bank', (req, res) => {
  res.sendFile(path.join(__dirname, 'takmil-question-bank.html'));
});

// Get all questions with optional filters
// NOTE: DB uses 'active' (int) not 'is_approved'. We alias for the frontend.
// active=1 → approved, active=0 → pending, active=-1 → flagged
app.get('/admin/questions/all', async (req, res) => {
  try {
    const { level, subject, topic, video_id, status, source_type } = req.query;
    let query = `SELECT *,
      (active = 1) AS is_approved,
      CASE WHEN active = -1 THEN 'flagged' WHEN active = 1 THEN 'approved' ELSE 'pending' END AS status,
      COALESCE(q_text_english, q_text_urdu) AS question_text
      FROM questions WHERE 1=1`;
    const params = [];
    if (level)       { params.push(level);       query += ` AND level = $${params.length}`; }
    if (subject)     { params.push(subject);     query += ` AND subject = $${params.length}`; }
    if (topic)       { params.push(topic);       query += ` AND topic_tag = $${params.length}`; }
    if (video_id)    { params.push(video_id);    query += ` AND video_id = $${params.length}`; }
    if (source_type) { params.push(source_type); query += ` AND source_type = $${params.length}`; }
    if (status === 'approved') query += ` AND active = 1`;
    if (status === 'pending')  query += ` AND (active = 0 OR active IS NULL)`;
    if (status === 'flagged')  query += ` AND active = -1`;
    query += ` ORDER BY created_at DESC LIMIT 500`;
    const result = await db.pool.query(query, params);
    res.json({ questions: result.rows, count: result.rows.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get approved questions for portals (random)
app.get('/api/questions', async (req, res) => {
  try {
    const { level, subject, topic, video_id, limit = 12 } = req.query;
    let query = `SELECT * FROM questions WHERE active = 1`;
    const params = [];
    if (level)    { params.push(level);    query += ` AND level = $${params.length}`; }
    if (subject)  { params.push(subject);  query += ` AND subject = $${params.length}`; }
    if (topic)    { params.push(topic);    query += ` AND topic_tag = $${params.length}`; }
    if (video_id) { params.push(video_id); query += ` AND video_id = $${params.length}`; }
    params.push(parseInt(limit));
    query += ` ORDER BY RANDOM() LIMIT $${params.length}`;
    const result = await db.pool.query(query, params);
    res.json({ questions: result.rows, count: result.rows.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Add a single question
app.post('/admin/questions', async (req, res) => {
  try {
    const { question_id, level, subject, topic_tag, question_text,
            question_text_ur, option_a, option_b, option_c, option_d,
            correct_option, source_type, video_id, is_approved } = req.body;
    if (!question_id || !level || !subject)
      return res.status(400).json({ error: 'question_id, level, subject required' });
    const r = await db.pool.query(`
      INSERT INTO questions
        (question_id, level, subject, topic_tag, q_text_english, q_text_urdu,
         option_a, option_b, option_c, option_d, correct_option, active, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
      ON CONFLICT (question_id) DO UPDATE SET
        level=$2, subject=$3, topic_tag=$4, q_text_english=$5, q_text_urdu=$6,
        option_a=$7, option_b=$8, option_c=$9, option_d=$10,
        correct_option=$11, active=$12
      RETURNING *, (active=1) AS is_approved,
        COALESCE(q_text_english, q_text_urdu) AS question_text`,
      [question_id, level, subject, topic_tag||null, question_text||null,
       question_text_ur||null, option_a, option_b, option_c, option_d,
       correct_option, is_approved ? 1 : 0]);
    res.json({ question: r.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Edit a question
app.put('/admin/questions/:id', async (req, res) => {
  try {
    const { question_id, level, subject, topic_tag, question_text,
            option_a, option_b, option_c, option_d, correct_option,
            source_type, video_id, is_approved } = req.body;
    const r = await db.pool.query(`
      UPDATE questions SET
        question_id=$1, level=$2, subject=$3, topic_tag=$4, q_text_english=$5,
        option_a=$6, option_b=$7, option_c=$8, option_d=$9, correct_option=$10,
        active=$11
      WHERE id=$12
      RETURNING *, (active=1) AS is_approved,
        COALESCE(q_text_english, q_text_urdu) AS question_text`,
      [question_id, level, subject, topic_tag||null, question_text,
       option_a, option_b, option_c, option_d, correct_option,
       is_approved ? 1 : 0, req.params.id]);
    res.json({ question: r.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// CSV import - update or insert a single question
app.post('/api/questions/csv-update', async (req, res) => {
  try {
    const { question_id, level, subject, topic_tag, question_text,
            image_url, option_a, option_b, option_c, option_d, correct_option } = req.body;
    if (!question_id) return res.status(400).json({ error: 'question_id required' });

    const r = await db.pool.query(`
      INSERT INTO questions
        (question_id, level, subject, topic_tag, q_text_english, q_text_urdu,
         image_url, question_type, option_a, option_b, option_c, option_d,
         correct_option, active, created_at)
      VALUES ($1,$2,$3,$4,$5,'',$6,
        CASE WHEN $6 IS NOT NULL AND $6 != '' THEN 'picture' ELSE 'text' END,
        $7,$8,$9,$10,$11,0,NOW())
      ON CONFLICT (question_id) DO UPDATE SET
        q_text_english = COALESCE(NULLIF($5,''), questions.q_text_english),
        image_url      = COALESCE(NULLIF($6,''), questions.image_url),
        option_a       = COALESCE(NULLIF($7,''), questions.option_a),
        option_b       = COALESCE(NULLIF($8,''), questions.option_b),
        option_c       = COALESCE(NULLIF($9,''), questions.option_c),
        option_d       = COALESCE(NULLIF($10,''), questions.option_d),
        correct_option = COALESCE(NULLIF($11,''), questions.correct_option)
      RETURNING (xmax = 0) AS inserted`,
      [question_id, parseInt(level)||1, subject, topic_tag||'curriculum',
       question_text||null, image_url||null,
       option_a||null, option_b||null, option_c||null, option_d||null,
       correct_option||'A']);

    const inserted = r.rows[0]?.inserted;
    res.json({ inserted: !!inserted, updated: !inserted });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Bulk approve all pending questions
app.post('/admin/questions/approve-all', async (req, res) => {
  try {
    const r = await db.pool.query(
      `UPDATE questions SET active=1 WHERE active=0 OR active IS NULL RETURNING question_id`
    );
    res.json({ approved: r.rowCount, message: `${r.rowCount} questions approved` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Approve by question_id string
app.post('/admin/questions/approve-by-qid', async (req, res) => {
  try {
    const { question_id } = req.body;
    await db.pool.query(`UPDATE questions SET active=1 WHERE question_id=$1`, [question_id]);
    res.json({ approved: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Approve a question
app.post('/admin/questions/:id/approve', async (req, res) => {
  try {
    await db.pool.query(`UPDATE questions SET active=1 WHERE id=$1`, [req.params.id]);
    res.json({ approved: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Flag a question
app.post('/admin/questions/:id/flag', async (req, res) => {
  try {
    await db.pool.query(`UPDATE questions SET active=-1 WHERE id=$1`, [req.params.id]);
    res.json({ flagged: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Bulk import from Claude JSON
app.post('/api/questions/save', async (req, res) => {
  try {
    const { questions, video_id, level, subject, topic, approved_by } = req.body;
    if (!questions || !Array.isArray(questions))
      return res.status(400).json({ error: 'questions array required' });
    let saved = 0;
    for (const q of questions) {
      await db.pool.query(`
        INSERT INTO questions
          (question_id, level, subject, topic_tag, q_text_english,
           option_a, option_b, option_c, option_d, correct_option, active, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,NOW())
        ON CONFLICT (question_id) DO UPDATE SET
          active=1, q_text_english=$5`,
        [q.question_id, level, subject, topic||null,
         q.question_text || q.q_text_english || null,
         q.option_a, q.option_b, q.option_c, q.option_d, q.correct_option]);
      saved++;
    }
    res.json({ saved, message: `${saved} questions saved to database` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── New tool pages ────────────────────────────────────────────────
app.get('/bulk-assess', (req, res) => res.sendFile(path.join(__dirname, 'takmil-bulk-assess.html')));

// ── AI Question Generator — called by bulk-assess page ────────────
app.post('/api/generate-questions', async (req, res) => {
  try {
    const { transcript, subject, level, topic, name } = req.body;
    if (!transcript) return res.status(400).json({ error: 'transcript required' });

    const topicSafe = (topic||'TOPIC').toUpperCase().replace(/[^A-Z0-9]/g,'_');
    const prompt = `You are an educational assessment expert for TAKMIL Foundation which educates out-of-school children in rural Pakistan.

Generate exactly 12 multiple choice questions based on this video transcript.

VIDEO INFO:
- Name: ${name}
- Subject: ${subject}
- Level: ${level} (primary school, ages 8-12)
- Topic: ${topic}

TRANSCRIPT:
${transcript}

RULES:
1. Questions based ONLY on what is in the transcript
2. Grade-appropriate for Level ${level} students
3. Each question has exactly 4 options (A, B, C, D)
4. Wrong options must be plausible not obviously wrong
5. Mix question types: recall, understanding, application
6. Keep language simple and clear
7. question_id format: ${(subject||'SUB').toUpperCase()}-L${level}-${topicSafe}-001 increment last 3 digits

Respond ONLY with a valid JSON array no explanation no markdown just JSON:
[{"question_id":"...","question_text":"...","option_a":"...","option_b":"...","option_c":"...","option_d":"...","correct_option":"A"}]`;

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set in Railway variables' });

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 3000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const bodyText = await aiRes.text();
    if (!aiRes.ok) {
      console.error('Anthropic API error:', aiRes.status, bodyText);
      return res.status(500).json({ error: 'Claude API error: ' + aiRes.status + ' — ' + bodyText.substring(0,200) });
    }

    const data = JSON.parse(bodyText);
    const text = data.content?.[0]?.text || '';
    const start = text.indexOf('[');
    const end   = text.lastIndexOf(']');
    if (start === -1) return res.status(500).json({ error: 'No JSON array in Claude response: ' + text.substring(0,200) });

    const questions = JSON.parse(text.substring(start, end + 1));
    res.json({ questions, count: questions.length });

  } catch (err) {
    console.error('generate-questions error:', err);
    res.status(500).json({ error: err.message });
  }
});


// Video bank — list all processed videos
app.get('/api/video-bank', async (req, res) => {
  try {
    const r = await db.pool.query(`SELECT * FROM video_question_bank ORDER BY created_at DESC`);
    res.json({ videos: r.rows, total: r.rows.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Stats endpoint — shows question counts by date ────────────────
app.get('/api/schema', async (req, res) => {
  try {
    const cols = await db.pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'questions'
      ORDER BY ordinal_position
    `);
    const tables = await db.pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' ORDER BY table_name
    `);
    res.json({ columns: cols.rows, tables: tables.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/stats', async (req, res) => {
  try {
    const byDate = await db.pool.query(`
      SELECT
        DATE(created_at) as date,
        COUNT(*) as total,
        SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) as approved,
        SUM(CASE WHEN active = 0 OR active IS NULL THEN 1 ELSE 0 END) as pending
      FROM questions
      GROUP BY DATE(created_at)
      ORDER BY date DESC
      LIMIT 30
    `);
    const totals = await db.pool.query(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) as approved,
        SUM(CASE WHEN active = 0 OR active IS NULL THEN 1 ELSE 0 END) as pending
      FROM questions
    `);
    res.json({ totals: totals.rows[0], by_date: byDate.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Auto generate + save — called by takmil_auto_generate.py ─────
app.post('/api/auto-generate-save', async (req, res) => {
  try {
    const { transcript, subject, level, video_name } = req.body;
    if (!transcript) return res.status(400).json({ error: 'transcript required' });

    const subjectClean = (subject || 'GEN').replace(/__.*/, '').trim();
    const levelNum     = (level || '').replace(/[^0-9]/g, '') || '1';
    const topicSafe    = (video_name || 'VIDEO').toUpperCase().replace(/[^A-Z0-9]/g, '_').substring(0, 20);

    const prompt = `You are an educational assessment expert for TAKMIL Foundation which educates out-of-school children in rural Pakistan.

Generate exactly 12 multiple choice questions based on this video transcript.

VIDEO INFO:
- File: ${video_name}
- Subject: ${subjectClean}
- Level: ${levelNum} (primary school, ages 8-12)

TRANSCRIPT:
${transcript.substring(0, 6000)}

RULES:
1. Questions based ONLY on what is in the transcript
2. Grade-appropriate for Level ${levelNum} students
3. Each question has exactly 4 options (A, B, C, D)
4. Wrong options must be plausible not obviously wrong
5. Mix question types: recall, understanding, application
6. Keep language simple and clear
7. question_id format: ${subjectClean.toUpperCase().replace(/[^A-Z0-9]/g,'')}-L${levelNum}-${topicSafe}-001 incrementing last 3 digits

Respond ONLY with a valid JSON array, no explanation, no markdown, just the JSON array:
[{"question_id":"...","question_text":"...","option_a":"...","option_b":"...","option_c":"...","option_d":"...","correct_option":"A"}]`;

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 3000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const bodyText = await aiRes.text();
    if (!aiRes.ok) return res.status(500).json({ error: 'Claude API error: ' + aiRes.status });

    const data     = JSON.parse(bodyText);
    const text     = data.content?.[0]?.text || '';
    const start    = text.indexOf('[');
    const end      = text.lastIndexOf(']');
    if (start === -1) return res.status(500).json({ error: 'No JSON in Claude response' });

    const questions = JSON.parse(text.substring(start, end + 1));

    // Save to DB as pending
    let saved = 0;
    for (const q of questions) {
      await db.pool.query(`
        INSERT INTO questions
          (question_id, level, subject, topic_tag, q_text_english, q_text_urdu,
           option_a, option_b, option_c, option_d, correct_option,
           active, created_at)
        VALUES ($1,$2,$3,$4,$5,'',$6,$7,$8,$9,$10,0,NOW())
        ON CONFLICT (question_id) DO NOTHING`,
        [q.question_id, parseInt(levelNum), subjectClean, 'curriculum',
         q.question_text, q.option_a, q.option_b, q.option_c, q.option_d,
         q.correct_option]);
      saved++;
    }

    res.json({ saved, count: saved, message: `${saved} questions saved as pending` });
  } catch (err) {
    console.error('auto-generate-save error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Sync endpoints for coordinator portal
app.get('/api/sync/pending', async (req, res) => {
  try {
    const pending = await db.pool.query(`
      SELECT COUNT(*) as pending FROM student_assessments
      WHERE synced_at IS NULL OR synced_at = ''`);
    const today = await db.pool.query(`
      SELECT COUNT(*) as today FROM student_assessments
      WHERE DATE(created_at) = CURRENT_DATE`);
    const recent = await db.pool.query(`
      SELECT student_name, level, subject,
        COALESCE(score_pct, 0) as overall_pct,
        assessed_at, created_at,
        TRUE as synced
      FROM student_assessments
      ORDER BY created_at DESC LIMIT 10`);
    res.json({
      pending: parseInt(pending.rows[0]?.pending || 0),
      today: parseInt(today.rows[0]?.today || 0),
      recent: recent.rows
    });
  } catch(err) { res.status(500).json({ error: err.message, pending: 0, today: 0, recent: [] }); }
});

app.post('/api/sync/push', async (req, res) => {
  // This endpoint is called by coordinator to trigger a sync
  // In practice the student portal already saves directly via /portal/offline/submit
  // This just returns current counts
  try {
    const r = await db.pool.query(`SELECT COUNT(*) as total FROM student_assessments WHERE DATE(created_at) = CURRENT_DATE`);
    res.json({ synced: parseInt(r.rows[0]?.total || 0), message: 'Sync complete' });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Offline PWA routes
app.get('/offline-portal', (req, res) => res.sendFile(path.join(__dirname, 'offline-portal.html')));
app.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Service-Worker-Allowed', '/');
  res.sendFile(path.join(__dirname, 'sw.js'));
});
app.get('/manifest.json', (req, res) => res.sendFile(path.join(__dirname, 'manifest.json')));

// Offline sync endpoint — receives results from tablets
app.post('/portal/offline/submit', async (req, res) => {
  try {
    const {
      pin, student_name, student_id, subject, level,
      score, total, pct, passed,
      timestamp, gps_lat, gps_lng, gps_accuracy
    } = req.body;

    // Find pin record
    const pinRec = await db.pool.query(
      `SELECT * FROM pins WHERE pin=$1`, [pin]
    );
    const school_id = pinRec.rows[0]?.school_id || 1;
    const pin_id    = pinRec.rows[0]?.id || null;

    // Save assessment result
    await db.pool.query(`
      INSERT INTO student_assessments
        (pin_id, school_id, teacher_phone, student_name, student_id,
         level, subject, score_pct, passed,
         gps_lat, gps_lng, gps_accuracy,
         assessed_at, created_at)
      VALUES ($1,$2,'offline',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
      ON CONFLICT DO NOTHING`,
      [pin_id, school_id, student_name, student_id || null,
       parseInt(level), subject,
       parseFloat(pct) || 0, !!passed,
       gps_lat || null, gps_lng || null, gps_accuracy || null,
       timestamp || new Date().toISOString()]
    );

    res.json({ synced: true });
  } catch(err) {
    console.log('offline submit error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Picture questions creator
app.get('/picture-questions', (req, res) => {
  res.sendFile(path.join(__dirname, 'picture-questions.html'));
});

// Coordinator portal
app.get('/coordinator', (req, res) => {
  res.sendFile(path.join(__dirname, 'coordinator-portal.html'));
});

// Save a picture question
app.post('/api/questions/picture', async (req, res) => {
  try {
    const { question_id, level, subject, topic_tag, question_text,
            image_url, option_a, option_b, option_c, option_d, correct_option } = req.body;
    if (!image_url) return res.status(400).json({ error: 'image_url required' });
    if (!question_id || !level || !subject) return res.status(400).json({ error: 'question_id, level, subject required' });

    await db.pool.query(`
      INSERT INTO questions
        (question_id, level, subject, topic_tag, q_text_english, q_text_urdu,
         image_url, question_type, option_a, option_b, option_c, option_d,
         correct_option, active, created_at)
      VALUES ($1,$2,$3,$4,$5,'',$6,'picture',$7,$8,$9,$10,$11,0,NOW())
      ON CONFLICT (question_id) DO UPDATE SET
        q_text_english=$5, image_url=$6, option_a=$7, option_b=$8,
        option_c=$9, option_d=$10, correct_option=$11`,
      [question_id, parseInt(level), subject, topic_tag || 'picture',
       question_text, image_url, option_a, option_b, option_c, option_d, correct_option]);

    res.json({ saved: true, message: 'Picture question saved as pending' });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Export questions to CSV
app.get('/api/questions/export', async (req, res) => {
  try {
    const { subject, level, status } = req.query;
    let query = `SELECT question_id, subject, level, topic_tag,
      COALESCE(q_text_english, q_text_urdu) as question_text,
      q_text_urdu, image_url, option_a, option_b, option_c, option_d,
      correct_option, active, created_at
      FROM questions WHERE 1=1`;
    const params = [];
    if (subject) { params.push(subject); query += ` AND subject=$${params.length}`; }
    if (level)   { params.push(level);   query += ` AND level=$${params.length}`; }
    if (status === 'approved') query += ` AND active=1`;
    if (status === 'pending')  query += ` AND (active=0 OR active IS NULL)`;
    query += ` ORDER BY subject, level, question_id`;

    const r = await db.pool.query(query, params);

    // Build CSV
    const headers = ['question_id','subject','level','topic_tag','question_text','question_urdu','image_url','option_a','option_b','option_c','option_d','correct_option','status','created_at'];
    const escape  = v => v == null ? '' : '"' + String(v).replace(/"/g, '""') + '"';

    let csv = headers.join(',') + '\n';
    r.rows.forEach(row => {
      csv += [
        escape(row.question_id),
        escape(row.subject),
        escape(row.level),
        escape(row.topic_tag),
        escape(row.question_text),
        escape(row.q_text_urdu),
        escape(row.image_url),
        escape(row.option_a),
        escape(row.option_b),
        escape(row.option_c),
        escape(row.option_d),
        escape(row.correct_option),
        escape(row.active === 1 ? 'approved' : row.active === -1 ? 'flagged' : 'pending'),
        escape(row.created_at ? row.created_at.toISOString().split('T')[0] : '')
      ].join(',') + '\n';
    });

    const filename = 'TAKMIL_Questions_' + new Date().toISOString().split('T')[0] + '.csv';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    res.send('\uFEFF' + csv); // BOM for Excel UTF-8
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Questions breakdown by subject and level
app.get('/api/questions/breakdown', async (req, res) => {
  try {
    const r = await db.pool.query(`
      SELECT subject, level, COUNT(*) as total,
        SUM(CASE WHEN active=1 THEN 1 ELSE 0 END) as approved,
        SUM(CASE WHEN active=0 OR active IS NULL THEN 1 ELSE 0 END) as pending
      FROM questions
      GROUP BY subject, level
      ORDER BY subject, level
    `);
    // Format as easy-to-read table
    const bySubject = {};
    r.rows.forEach(row => {
      if (!bySubject[row.subject]) bySubject[row.subject] = [];
      bySubject[row.subject].push({
        level: row.level,
        total: parseInt(row.total),
        approved: parseInt(row.approved),
        pending: parseInt(row.pending)
      });
    });
    res.json(bySubject);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Add GPS and offline columns to student_assessments
    try {
      await db.pool.query(`ALTER TABLE student_assessments ADD COLUMN IF NOT EXISTS student_id TEXT`);
      await db.pool.query(`ALTER TABLE student_assessments ADD COLUMN IF NOT EXISTS score_pct NUMERIC`);
      await db.pool.query(`ALTER TABLE student_assessments ADD COLUMN IF NOT EXISTS passed BOOLEAN`);
      await db.pool.query(`ALTER TABLE student_assessments ADD COLUMN IF NOT EXISTS gps_lat NUMERIC`);
      await db.pool.query(`ALTER TABLE student_assessments ADD COLUMN IF NOT EXISTS gps_lng NUMERIC`);
      await db.pool.query(`ALTER TABLE student_assessments ADD COLUMN IF NOT EXISTS gps_accuracy NUMERIC`);
      await db.pool.query(`ALTER TABLE student_assessments ADD COLUMN IF NOT EXISTS assessed_at TIMESTAMP`);
    } catch(e) { console.log('GPS columns note:', e.message); }

// Add image_url column if not exists
    try {
      await db.pool.query(`ALTER TABLE questions ADD COLUMN IF NOT EXISTS image_url TEXT`);
      await db.pool.query(`ALTER TABLE questions ADD COLUMN IF NOT EXISTS question_type TEXT DEFAULT 'text'`);
      console.log('image_url column ready');
    } catch(e) { console.log('image column note:', e.message); }

// Remove subject check constraint to allow 'All' subject PINs
    try {
      await db.pool.query(`ALTER TABLE pins DROP CONSTRAINT IF EXISTS pins_subject_check`);
    } catch(e) { /* ignore if already removed */ }

    app.listen(PORT, () => console.log(`🚀 TAKMIL Bot v3.0 running on port ${PORT}`));
  } catch (err) {
    console.error('❌ Failed to start:', err);
    process.exit(1);
  }
})();