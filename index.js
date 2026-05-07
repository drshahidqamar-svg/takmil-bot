// ═══════════════════════════════════════════════════════════════
//  STUDENT ATTENDANCE REGISTER
// ═══════════════════════════════════════════════════════════════

// ── Register PWA ──────────────────────────────────────────────
app.get('/register', (req, res) =>
  res.sendFile(path.join(__dirname, 'register.html'))
);

// ── Service Worker for Register PWA ──────────────────────────
app.get('/register-sw.js', (req, res) =>
  res.sendFile(path.join(__dirname, 'register-sw.js'))
);

// ── Attendance Page ──────────────────────────────────────────
app.get('/attendance', (req, res) =>
  res.sendFile(path.join(__dirname, 'attendance.html'))
);

// ── Main Hub ─────────────────────────────────────────────────
app.get('/', (req, res) =>
  res.sendFile(path.join(__dirname, 'hub.html'))
);

app.get('/hub', (req, res) =>
  res.sendFile(path.join(__dirname, 'hub.html'))
);

// ── Analytics Dashboard ─────────────────────────────────────
app.get('/analytics', (req, res) =>
  res.sendFile(path.join(__dirname, 'analytics.html'))
);

// ── Tablet Assessment Portal ────────────────────────────────
app.get('/assess', (req, res) =>
  res.sendFile(path.join(__dirname, 'assess.html'))
);

// ── Optional Additional Portals ─────────────────────────────
app.get('/portal', (req, res) =>
  res.sendFile(path.join(__dirname, 'portal.html'))
);

app.get('/coordinator', (req, res) =>
  res.sendFile(path.join(__dirname, 'coordinator.html'))
);


// ── Bulk student import endpoint ─────────────────────────────
app.post('/api/register/import', async (req, res) => {
  try {
    const students = req.body;

    if (!Array.isArray(students)) {
      return res.status(400).json({
        error: 'Expected array'
      });
    }

    let imported = 0;
    let skipped  = 0;

    for (const s of students) {
      try {
        await db.pool.query(`
          INSERT INTO students_register
            (
              school_identifier,
              roll_number,
              student_name,
              teacher_name,
              province,
              regional_coordinator,
              school_coordinator
            )
          VALUES ($1,$2,$3,$4,$5,$6,$7)

          ON CONFLICT (roll_number)
          DO UPDATE SET
            student_name = EXCLUDED.student_name,
            teacher_name = EXCLUDED.teacher_name
        `, [
          s.school_identifier,
          s.roll_number,
          s.student_name,
          s.teacher_name,
          s.province,
          s.regional_coordinator,
          s.school_coordinator
        ]);

        imported++;

      } catch (e) {
        skipped++;
      }
    }

    console.log(
      `Students imported: ${imported}, skipped: ${skipped}`
    );

    res.json({
      imported,
      skipped,
      total: students.length
    });

  } catch (err) {

    res.status(500).json({
      error: err.message
    });

  }
});