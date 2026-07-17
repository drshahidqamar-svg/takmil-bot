const fs = require('fs');
const file = './routes/admin.js';
let c = fs.readFileSync(file, 'utf8');

const newRoutes = `
// ── Students API ──────────────────────────────────────────────────────────────
router.get('/api/students', async (req, res) => {
  try {
    const { school_id } = req.query;
    let q = 'SELECT * FROM students WHERE is_active=true';
    const params = [];
    if(school_id){ params.push(parseInt(school_id)); q += ' AND school_id=$1'; }
    q += ' ORDER BY name ASC';
    const r = await db.pool.query(q, params);
    res.json({ students: r.rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/students', async (req, res) => {
  try {
    const { name, school_id, grade_label, level } = req.body;
    if(!name) return res.status(400).json({ error: 'Name required' });
    const r = await db.pool.query(
      'INSERT INTO students (name, school_id, grade_label, level) VALUES ($1,$2,$3,$4) RETURNING *',
      [name, school_id||null, grade_label||'Primary', level||1]
    );
    res.json({ student: r.rows[0] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/students/bulk', async (req, res) => {
  try {
    const { students } = req.body;
    if(!students || !students.length) return res.json({ imported: 0 });
    let imported = 0;
    for(const s of students) {
      if(!s.name) continue;
      await db.pool.query(
        'INSERT INTO students (name, school_id, grade_label, level) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
        [s.name, s.school_id||null, s.grade_label||'Primary', s.level||1]
      );
      imported++;
    }
    res.json({ imported });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── PIN Management API ────────────────────────────────────────────────────────
router.get('/api/pins/active', async (req, res) => {
  try {
    const { school_id } = req.query;
    let q = \`SELECT p.*, s.name AS school_name 
              FROM pins p LEFT JOIN schools s ON s.id=p.school_id 
              WHERE p.is_active=true AND p.expires_at > NOW()\`;
    const params = [];
    if(school_id){ params.push(parseInt(school_id)); q += \` AND p.school_id=$\${params.length}\`; }
    q += ' ORDER BY p.created_at DESC';
    const r = await db.pool.query(q, params);
    res.json({ pins: r.rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/pins/:pin/revoke', async (req, res) => {
  try {
    await db.pool.query('UPDATE pins SET is_active=false, invalidated_at=NOW() WHERE pin=$1', [req.params.pin]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Schools list for dropdowns ────────────────────────────────────────────────
router.get('/api/schools', async (req, res) => {
  try {
    const r = await db.pool.query('SELECT id, name, identifier, region FROM schools ORDER BY name ASC');
    res.json({ schools: r.rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

`;

c = c.replace('module.exports = { router };', newRoutes + 'module.exports = { router };');
fs.writeFileSync(file, c, 'utf8');

// Syntax check
const { execSync } = require('child_process');
try {
  execSync('node --check routes/admin.js');
  console.log('Syntax: OK');
} catch(e) { console.log('Syntax ERROR:', e.message); }

console.log('Students API added:', c.includes('/api/students'));
console.log('Pins API added:', c.includes('/api/pins/active'));
console.log('Schools API added:', c.includes('/api/schools'));
