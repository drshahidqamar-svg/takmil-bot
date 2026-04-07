require('dotenv').config();
const express = require('express');
const twilio  = require('twilio');
const crypto  = require('crypto');

const {
  findStudent,
  createSession,
  saveResponse,
  completeSession,
  getAllSchoolsSummary,
  getRecentSessions
} = require('./database');

const app    = express();
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

app.use(express.urlencoded({ extended: false }));

// ─────────────────────────────────────────────
//  QUESTION BANK
// ─────────────────────────────────────────────

const QUESTIONS = [
  {
    id: 'URD-4-001', grade: 4, subject: 'Urdu',
    q: '"نادر نے کتاب کہاں رکھی؟"\n(Where did Nadir put the book?)',
    options: { A: 'میز پر (Table)', B: 'کرسی پر (Chair)', C: 'باغ میں (Garden)', D: 'الماری میں (Cupboard)' },
    correct: 'A'
  },
  {
    id: 'URD-4-002', grade: 4, subject: 'Urdu',
    q: '"خوشی" کا مترادف؟\n(Synonym for "happiness"?)',
    options: { A: 'غم (Sadness)', B: 'مسرت (Joy)', C: 'تکلیف (Pain)', D: 'پریشانی (Worry)' },
    correct: 'B'
  },
  {
    id: 'URD-4-003', grade: 4, subject: 'Urdu',
    q: 'جملے میں فاعل؟\n"بچے باغ میں کھیلتے ہیں"',
    options: { A: 'باغ (Garden)', B: 'بچے (Children)', C: 'کھیلتے (Play)', D: 'میں (In)' },
    correct: 'B'
  },
  {
    id: 'URD-4-004', grade: 4, subject: 'Urdu',
    q: '"بارش کے بعد ہوا ___ ہو گئی"\n(After rain the air became ___)',
    options: { A: 'گرم (Hot)', B: 'خشک (Dry)', C: 'ٹھنڈی (Cool)', D: 'تیز (Fast)' },
    correct: 'C'
  },
  {
    id: 'URD-4-005', grade: 4, subject: 'Urdu',
    q: 'کہانی میں مرکزی کردار؟\n(Main character in the story?)',
    options: { A: 'استاد (Teacher)', B: 'نادر (Nadir)', C: 'امی (Mother)', D: 'دوست (Friend)' },
    correct: 'B'
  },
  {
    id: 'MTH-4-001', grade: 4, subject: 'Math',
    q: '۲۴ ÷ ۶ = ؟\n(24 ÷ 6 = ?)',
    options: { A: '3', B: '4', C: '5', D: '6' },
    correct: 'B'
  },
  {
    id: 'MTH-4-002', grade: 4, subject: 'Math',
    q: '۱۲۵ + ۷۵ = ؟\n(125 + 75 = ?)',
    options: { A: '190', B: '200', C: '210', D: '220' },
    correct: 'B'
  },
  {
    id: 'MTH-4-003', grade: 4, subject: 'Math',
    q: 'ایک کتاب ۱۵ روپے کی، ۴ کتابیں؟\n(One book = Rs 15. Cost of 4 books?)',
    options: { A: 'Rs 45', B: 'Rs 55', C: 'Rs 60', D: 'Rs 70' },
    correct: 'C'
  },
  {
    id: 'URD-3-001', grade: 3, subject: 'Urdu',
    q: 'گائے کے بچے کو کیا کہتے ہیں؟\n(What is a baby cow called?)',
    options: { A: 'بچھڑا (Calf)', B: 'پلا (Puppy)', C: 'بچہ (Child)', D: 'مینڈھا (Ram)' },
    correct: 'A'
  },
  {
    id: 'MTH-3-001', grade: 3, subject: 'Math',
    q: '۵ × ۷ = ؟\n(5 × 7 = ?)',
    options: { A: '30', B: '35', C: '40', D: '45' },
    correct: 'B'
  },
  {
    id: 'MTH-5-001', grade: 5, subject: 'Math',
    q: 'مستطیل: لمبائی ۸cm، چوڑائی ۵cm\n(Rectangle 8cm × 5cm — Area?)',
    options: { A: '30 cm²', B: '35 cm²', C: '40 cm²', D: '45 cm²' },
    correct: 'C'
  },
];

// ─────────────────────────────────────────────
//  SESSION STATE
// ─────────────────────────────────────────────

const sessions = new Map();

// ─────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────

function getQuestions(grade, subject, count = 5) {
  const pool = QUESTIONS.filter(q => q.grade === grade && q.subject === subject);
  return [...pool].sort(() => Math.random() - 0.5).slice(0, Math.min(count, pool.length));
}

function formatQuestion(q, number, total) {
  return (
    `📝 *Question ${number} of ${total}*\n\n` +
    `${q.q}\n\n` +
    `A) ${q.options.A}\n` +
    `B) ${q.options.B}\n` +
    `C) ${q.options.C}\n` +
    `D) ${q.options.D}\n\n` +
    `Reply *A, B, C or D*`
  );
}

function checkAnomalies(session) {
  const flags   = [];
  const total   = session.responseTimes.length;
  const avgTime = session.responseTimes.reduce((a, b) => a + b, 0) / total;

  if (avgTime < 8)                                flags.push('SPEED_ANOMALY');
  if (session.score === session.questions.length) flags.push('PERFECT_SCORE');

  return { flags, avgTime: Math.round(avgTime * 10) / 10 };
}

function logSession(session) {
  const pct = Math.round(session.score / session.questions.length * 100);

  completeSession(
    session.sessionId,
    session.score,
    session.questions.length,
    session.anomaly.avgTime,
    session.anomaly.flags
  );

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('SESSION SAVED TO DATABASE');
  console.log(`Student  : ${session.student.name} (${session.student.student_id})`);
  console.log(`School   : ${session.student.school}`);
  console.log(`Subject  : ${session.subject}`);
  console.log(`Score    : ${session.score}/${session.questions.length} (${pct}%)`);
  console.log(`Avg time : ${session.anomaly.avgTime}s per question`);
  console.log(`Flags    : ${session.anomaly.flags.length ? session.anomaly.flags.join(', ') : 'None'}`);
  console.log(`Time     : ${new Date().toISOString()}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

async function sendMessage(to, body) {
  try {
    await client.messages.create({
      from: 'whatsapp:' + process.env.TWILIO_WHATSAPP_NUMBER,
      to:   'whatsapp:+' + to,
      body
    });
  } catch (err) {
    console.error('Send error:', err.message);
  }
}

// ─────────────────────────────────────────────
//  CONVERSATION STATE MACHINE
// ─────────────────────────────────────────────

async function handleMessage(from, incomingMsg) {
  const msg     = incomingMsg.trim();
  let   session = sessions.get(from);

  // ── No session → greet ──
  if (!session) {
    sessions.set(from, { state: 'AWAITING_ID', attempts: 0 });
    await sendMessage(from,
      'Assalamu Alaikum! 👋\n' +
      'Welcome to *TAKMIL Assessment Bot*.\n\n' +
      'Please reply with the *Student ID* to begin.\n' +
      '_(Example: TK-4-001)_'
    );
    return;
  }

  // ── Waiting for Student ID ──
  if (session.state === 'AWAITING_ID') {
    const student = findStudent(msg);

    if (!student) {
      session.attempts += 1;
      if (session.attempts >= 3) {
        sessions.delete(from);
        await sendMessage(from,
          '❌ Student ID not found after 3 attempts.\n\nSend any message to try again.'
        );
        return;
      }
      await sendMessage(from,
        `❌ ID "*${msg}*" not found. Please check and try again.\n` +
        `(Attempt ${session.attempts} of 3)`
      );
      return;
    }

    session.state   = 'AWAITING_CONFIRMATION';
    session.student = student;

    await sendMessage(from,
      `✓ Found: *${student.name}*\n` +
      `Grade ${student.grade} · ${student.school}\n\n` +
      `Today's assessment: *Urdu* 📖\n` +
      `5 questions · ~5 minutes\n\n` +
      `Reply *YES* to begin or *NO* to cancel.`
    );
    return;
  }

  // ── Waiting for YES / NO ──
  if (session.state === 'AWAITING_CONFIRMATION') {
    const answer = msg.toUpperCase();

    if (answer === 'NO') {
      sessions.delete(from);
      await sendMessage(from, 'Session cancelled. Send any message to start again.');
      return;
    }
    if (answer !== 'YES') {
      await sendMessage(from, 'Please reply *YES* to begin or *NO* to cancel.');
      return;
    }

    const questions = getQuestions(session.student.grade, 'Urdu', 5);

    if (questions.length === 0) {
      sessions.delete(from);
      await sendMessage(from,
        '⚠️ No questions available for this grade yet.\nPlease contact TAKMIL support.'
      );
      return;
    }

    const sessionId = crypto.randomUUID();
    createSession(sessionId, session.student.student_id, session.student.school_id, 'Urdu');

    session.state             = 'IN_ASSESSMENT';
    session.sessionId         = sessionId;
    session.subject           = 'Urdu';
    session.questions         = questions;
    session.currentQ          = 0;
    session.score             = 0;
    session.answers           = [];
    session.responseTimes     = [];
    session.questionStartTime = Date.now();

    await sendMessage(from, formatQuestion(questions[0], 1, questions.length));
    return;
  }

  // ── Answering questions ──
  if (session.state === 'IN_ASSESSMENT') {
    const answer = msg.toUpperCase().trim();

    if (!['A', 'B', 'C', 'D'].includes(answer)) {
      await sendMessage(from, '⚠️ Please reply with *A*, *B*, *C*, or *D* only.');
      return;
    }

    const responseTime = (Date.now() - session.questionStartTime) / 1000;
    const currentQ     = session.questions[session.currentQ];
    const isCorrect    = answer === currentQ.correct;

    if (isCorrect) session.score++;

    saveResponse(
      session.sessionId,
      currentQ.id,
      answer,
      currentQ.correct,
      isCorrect,
      Math.round(responseTime * 10) / 10
    );

    session.responseTimes.push(responseTime);
    session.answers.push({
      questionId:   currentQ.id,
      given:        answer,
      correct:      currentQ.correct,
      isCorrect,
      responseTime: Math.round(responseTime * 10) / 10
    });

    session.currentQ++;

    // More questions remain
    if (session.currentQ < session.questions.length) {
      session.questionStartTime = Date.now();
      const isLast  = session.currentQ === session.questions.length - 1;
      const prefix  = isLast ? '⏺ Logged. *Last question!*\n\n' : '⏺ Logged.\n\n';
      await sendMessage(from,
        prefix + formatQuestion(
          session.questions[session.currentQ],
          session.currentQ + 1,
          session.questions.length
        )
      );
      return;
    }

    // All done — close session
    session.state   = 'COMPLETE';
    session.anomaly = checkAnomalies(session);
    logSession(session);

    const pct = Math.round(session.score / session.questions.length * 100);
    let finalMsg =
      `✅ *Assessment Complete!*\n\n` +
      `👤 ${session.student.name} · Grade ${session.student.grade}\n` +
      `📊 Score: ${session.score}/${session.questions.length} *(${pct}%)*\n` +
      `⏱ Avg response: ${session.anomaly.avgTime}s\n` +
      `🔒 Results saved to TAKMIL\n\n` +
      `_شکریہ — جزاک اللہ خیر_ 🌟`;

    if (session.anomaly.flags.length > 0) {
      finalMsg += '\n\n⚠️ _This session has been flagged for review._';
    }

    await sendMessage(from, finalMsg);
    sessions.delete(from);
    return;
  }

  // Safety net
  sessions.delete(from);
  await sendMessage(from, 'Starting fresh.\n\nPlease reply with the *Student ID* to begin.');
}

// ─────────────────────────────────────────────
//  ROUTES
// ─────────────────────────────────────────────

app.post('/webhook', async (req, res) => {
  const from = req.body.From?.replace('whatsapp:', '').replace('+', '');
  const body = req.body.Body || '';

  console.log(`[${new Date().toLocaleTimeString()}]  FROM: ${from}  MSG: "${body}"`);

  if (!from || !body) return res.status(400).send('Bad request');

  res.status(200).send('<Response></Response>');
  await handleMessage(from, body);
});

app.get('/', (req, res) => {
  const summary = getAllSchoolsSummary();
  const recent  = getRecentSessions(10);

  let html = `
    <html><head><title>TAKMIL Dashboard</title>
    <style>
      body  { font-family: Arial, sans-serif; padding: 24px; background: #f5f5f5; }
      h2    { color: #1a4a8a; }
      h3    { color: #0f6e56; margin-top: 32px; }
      table { border-collapse: collapse; width: 100%; background: white;
              border-radius: 8px; overflow: hidden; margin-top: 8px; }
      th    { background: #1a4a8a; color: white; padding: 10px 14px;
              text-align: left; font-size: 13px; }
      td    { padding: 9px 14px; font-size: 13px;
              border-bottom: 1px solid #eee; }
      tr:last-child td { border-bottom: none; }
      .flag { color: #a32d2d; font-weight: bold; }
      .ok   { color: #0f6e56; }
      .stat { display: inline-block; background: white; border-radius: 8px;
              padding: 12px 20px; margin: 0 8px 16px 0; font-size: 13px;
              border: 1px solid #ddd; }
      .stat b { display: block; font-size: 22px; color: #1a4a8a; }
    </style></head><body>

    <h2>TAKMIL Assessment Dashboard</h2>
    <div>
      <div class="stat"><b>${sessions.size}</b>Active sessions</div>
      <div class="stat"><b>${summary.reduce((a, s) => a + s.total_sessions, 0)}</b>Total sessions</div>
      <div class="stat"><b>${summary.reduce((a, s) => a + s.flagged_count, 0)}</b>Flagged sessions</div>
    </div>

    <h3>Schools</h3>
    <table>
      <tr>
        <th>School</th><th>Sessions</th><th>Avg Score</th>
        <th>Avg Response</th><th>Flagged</th>
      </tr>`;

  summary.forEach(s => {
    const flagClass = s.flagged_count > 0 ? 'flag' : 'ok';
    html += `<tr>
      <td>${s.school_name}</td>
      <td>${s.total_sessions}</td>
      <td>${s.avg_score ?? '—'}%</td>
      <td>${s.avg_response_sec ?? '—'}s</td>
      <td class="${flagClass}">${s.flagged_count > 0 ? s.flagged_count + ' flagged' : '✓ clean'}</td>
    </tr>`;
  });

  html += `</table>
    <h3>Recent sessions</h3>
    <table>
      <tr>
        <th>Student</th><th>Grade</th><th>School</th><th>Subject</th>
        <th>Score</th><th>Avg time</th><th>Flags</th><th>Completed</th>
      </tr>`;

  recent.forEach(r => {
    const flagClass = r.flags !== 'NONE' ? 'flag' : 'ok';
    html += `<tr>
      <td>${r.student_name}</td>
      <td>${r.grade}</td>
      <td>${r.school_name}</td>
      <td>${r.subject}</td>
      <td>${r.score_pct}%</td>
      <td>${r.avg_response_sec}s</td>
      <td class="${flagClass}">${r.flags}</td>
      <td>${r.completed_at}</td>
    </tr>`;
  });

  html += `</table></body></html>`;
  res.send(html);
});

// ─────────────────────────────────────────────
//  START
// ─────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n✅  TAKMIL bot running on port ${PORT}`);
  console.log(`📱  Webhook  →  http://localhost:${PORT}/webhook`);
  console.log(`🌐  Dashboard →  http://localhost:${PORT}/\n`);
});