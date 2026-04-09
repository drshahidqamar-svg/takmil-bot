// ── PASTE THESE ROUTES INTO index.js BEFORE THE STARTUP SECTION ──────────────
// Add after the existing /admin/analytics route

const path = require('path');

// Serve dashboard
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// List schools
app.get('/admin/schools/list', async (req, res) => {
  try {
    const r = await db.pool.query('SELECT * FROM schools ORDER BY id DESC');
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// List PINs
app.get('/admin/pins/list', async (req, res) => {
  try {
    const r = await db.pool.query(`
      SELECT p.*, s.name AS school_name
      FROM pins p
      LEFT JOIN schools s ON s.id = p.school_id
      ORDER BY p.created_at DESC LIMIT 50
    `);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// List ALL advancements (not just pending)
app.get('/admin/advancements/all', async (req, res) => {
  try {
    const r = await db.pool.query(`
      SELECT ar.*, s.name AS school_name
      FROM advancement_requests ar
      JOIN schools s ON s.id = ar.school_id
      ORDER BY ar.created_at DESC
    `);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// List ops team
app.get('/admin/ops/list', async (req, res) => {
  try {
    const r = await db.pool.query('SELECT * FROM ops_team ORDER BY id');
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// List reassessments
app.get('/admin/reassessments/list', async (req, res) => {
  try {
    const r = await db.pool.query(`
      SELECT rs.*, s.name AS school_name
      FROM reassessment_schedule rs
      JOIN schools s ON s.id = rs.school_id
      ORDER BY rs.scheduled_date ASC
    `);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
