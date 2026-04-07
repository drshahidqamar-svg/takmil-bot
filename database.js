const Database = require('better-sqlite3');
const path     = require('path');

const db = new Database(path.join(__dirname, 'takmil.db'));
db.pragma('journal_mode = WAL');

// ─────────────────────────────────────────────
//  CREATE TABLES
// ─────────────────────────────────────────────

db.exec(`

  CREATE TABLE IF NOT EXISTS schools (
    school_id   TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    district    TEXT,
    city        TEXT,
    active      INTEGER DEFAULT 1,
    created_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS students (
    student_id  TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    grade       INTEGER NOT NULL,
    school_id   TEXT NOT NULL,
    active      INTEGER DEFAULT 1,
    created_at  TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (school_id) REFERENCES schools(school_id)
  );

  CREATE TABLE IF NOT EXISTS sessions (
    session_id        TEXT PRIMARY KEY,
    student_id        TEXT NOT NULL,
    school_id         TEXT NOT NULL,
    subject           TEXT NOT NULL,
    score             INTEGER,
    total_questions   INTEGER,
    score_pct         INTEGER,
    avg_response_sec  REAL,
    flags             TEXT,
    complete          INTEGER DEFAULT 0,
    started_at        TEXT DEFAULT (datetime('now')),
    completed_at      TEXT
  );

  CREATE TABLE IF NOT EXISTS session_responses (
    response_id       INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id        TEXT NOT NULL,
    question_id       TEXT NOT NULL,
    answer_given      TEXT,
    correct_answer    TEXT,
    is_correct        INTEGER,
    response_time_sec REAL,
    logged_at         TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (session_id) REFERENCES sessions(session_id)
  );

`);

// ─────────────────────────────────────────────
//  SEED DATA
// ─────────────────────────────────────────────

const seedSchool  = db.prepare(`INSERT OR IGNORE INTO schools  (school_id, name, district, city)    VALUES (@school_id, @name, @district, @city)`);
const seedStudent = db.prepare(`INSERT OR IGNORE INTO students (student_id, name, grade, school_id) VALUES (@student_id, @name, @grade, @school_id)`);

db.transaction(() => {
  seedSchool.run({ school_id: 'GUL', name: 'Gulshan Community School', district: 'Gulshan-e-Iqbal', city: 'Karachi' });
  seedSchool.run({ school_id: 'ALN', name: 'Al-Noor Community School', district: 'Orangi Town',     city: 'Karachi' });
  seedSchool.run({ school_id: 'MAD', name: 'Madina Girls School',      district: 'Landhi',          city: 'Karachi' });

  seedStudent.run({ student_id: 'TK-4-001', name: 'Aisha Malik',   grade: 4, school_id: 'GUL' });
  seedStudent.run({ student_id: 'TK-4-002', name: 'Hassan Ahmed',  grade: 4, school_id: 'GUL' });
  seedStudent.run({ student_id: 'TK-3-001', name: 'Fatima Khan',   grade: 3, school_id: 'ALN' });
  seedStudent.run({ student_id: 'TK-5-001', name: 'Omar Siddiqui', grade: 5, school_id: 'MAD' });
})();

// ─────────────────────────────────────────────
//  QUERY FUNCTIONS
// ─────────────────────────────────────────────

function findStudent(id) {
  return db.prepare(`
    SELECT  s.student_id, s.name, s.grade,
            sc.school_id, sc.name AS school
    FROM    students s
    JOIN    schools  sc ON s.school_id = sc.school_id
    WHERE   s.student_id = ? AND s.active = 1
  `).get(id.toUpperCase().trim());
}

function createSession(sessionId, studentId, schoolId, subject) {
  db.prepare(`
    INSERT INTO sessions (session_id, student_id, school_id, subject)
    VALUES (?, ?, ?, ?)
  `).run(sessionId, studentId, schoolId, subject);
}

function saveResponse(sessionId, questionId, answerGiven, correctAnswer, isCorrect, responseTimeSec) {
  db.prepare(`
    INSERT INTO session_responses
      (session_id, question_id, answer_given, correct_answer, is_correct, response_time_sec)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(sessionId, questionId, answerGiven, correctAnswer, isCorrect ? 1 : 0, responseTimeSec);
}

function completeSession(sessionId, score, totalQuestions, avgResponseSec, flags) {
  const pct = Math.round(score / totalQuestions * 100);
  db.prepare(`
    UPDATE sessions SET
      score            = ?,
      total_questions  = ?,
      score_pct        = ?,
      avg_response_sec = ?,
      flags            = ?,
      complete         = 1,
      completed_at     = datetime('now')
    WHERE session_id = ?
  `).run(score, totalQuestions, pct, avgResponseSec, flags.join(',') || 'NONE', sessionId);
}

function getAllSchoolsSummary() {
  return db.prepare(`
    SELECT  sc.school_id,
            sc.name                                              AS school_name,
            COUNT(se.session_id)                                 AS total_sessions,
            ROUND(AVG(se.score_pct))                             AS avg_score,
            ROUND(AVG(se.avg_response_sec), 1)                   AS avg_response_sec,
            SUM(CASE WHEN se.flags != 'NONE' THEN 1 ELSE 0 END) AS flagged_count
    FROM    schools sc
    LEFT JOIN sessions se ON sc.school_id = se.school_id AND se.complete = 1
    GROUP BY sc.school_id
    ORDER BY sc.name
  `).all();
}

function getRecentSessions(limit = 20) {
  return db.prepare(`
    SELECT  se.session_id,
            st.name  AS student_name,
            st.grade,
            sc.name  AS school_name,
            se.subject,
            se.score_pct,
            se.avg_response_sec,
            se.flags,
            se.completed_at
    FROM    sessions se
    JOIN    students st ON se.student_id = st.student_id
    JOIN    schools  sc ON se.school_id  = sc.school_id
    WHERE   se.complete = 1
    ORDER BY se.completed_at DESC
    LIMIT ?
  `).all(limit);
}

// ─────────────────────────────────────────────
//  EXPORTS
// ─────────────────────────────────────────────

module.exports = {
  findStudent,
  createSession,
  saveResponse,
  completeSession,
  getAllSchoolsSummary,
  getRecentSessions
};