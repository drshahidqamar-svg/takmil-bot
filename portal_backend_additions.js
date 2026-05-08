// ══════════════════════════════════════════════════════════════════
// ADD THESE TWO BLOCKS TO index.js
// Paste BLOCK A anywhere after the existing app.get('/import') line
// ══════════════════════════════════════════════════════════════════

// ── BLOCK A: Serve portal.html ────────────────────────────────────
app.get('/portal', (req, res) => res.sendFile(path.join(__dirname, 'portal.html')));

// ── BLOCK B: Portal session start ────────────────────────────────
app.post('/portal/session/start', async (req, res) => {
  const { pin, studentName } = req.body;
  if (!pin || !studentName) return res.status(400).json({ error: 'PIN and student name required.' });

  try {
    const pinRec = await db.validatePin(pin);
    if (!pinRec) return res.status(401).json({ error: 'Invalid or expired PIN. Please ask your teacher.' });

    const isFinal = parseInt(pinRec.level) === 0;
    let questions = [];

    if (isFinal) {
      const levels = [1,2,3,4,5,6,7,8,9,10,11];
      for (const lvl of levels) {
        const r = await db.pool.query(
          `SELECT * FROM questions
           WHERE subject=$1 AND topic_tag='final_assessment' AND level=$2
           ORDER BY RANDOM() LIMIT 2`,
          [pinRec.subject, lvl]
        );
        questions = questions.concat(r.rows);
      }
    } else {
      const r = await db.pool.query(
        `SELECT * FROM questions
         WHERE subject=$1 AND level=$2
         ORDER BY RANDOM() LIMIT 10`,
        [pinRec.subject, pinRec.level]
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
    `, [pinRec.id, pinRec.school_id, studentName, pinRec.level, pinRec.subject]);

    res.json({
      sessionId:   saRec.rows[0].id,
      subject:     pinRec.subject,
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
