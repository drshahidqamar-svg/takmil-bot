// add-teacher-admin-routes.js
// Adds school/teacher-phone management API routes to routes/admin.js
// Run from takmil-bot folder: node add-teacher-admin-routes.js

const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'routes', 'admin.js');
let content = fs.readFileSync(filePath, 'utf8');

if (content.includes('// ── TEACHER PHONE ADMIN ROUTES (auto-added)')) {
  console.log('Routes already added. Nothing to do.');
  process.exit(0);
}

const newRoutes = `

// ── TEACHER PHONE ADMIN ROUTES (auto-added) ──────────────────────────────────
// Lets an admin update teacher_phone on an existing school without raw SQL.
// Note: GET /admin/schools/list already exists above and returns teacher_phone.

// Search schools by name/identifier (used by the teachers-admin.html search box)
router.get('/admin/schools/search', async (req, res) => {
  try {
    const q = '%' + (req.query.q || '') + '%';
    const result = await db.pool.query(
      \`SELECT id, name, identifier, region, province, teacher_phone, contact_name
       FROM schools
       WHERE name ILIKE $1 OR identifier ILIKE $1
       ORDER BY name LIMIT 100\`,
      [q]
    );
    res.json(result.rows);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Update a single school's teacher phone (+ optional contact name)
router.put('/admin/schools/:id/teacher-phone', async (req, res) => {
  try {
    const { teacher_phone, contact_name } = req.body;
    if (!teacher_phone || !teacher_phone.trim()) {
      return res.status(400).json({ error: 'teacher_phone is required' });
    }
    const phone = teacher_phone.trim();
    if (!/^\\+\\d{10,15}$/.test(phone)) {
      return res.status(400).json({ error: 'Phone must be in international format, e.g. +923001234567' });
    }
    const result = await db.pool.query(
      \`UPDATE schools
       SET teacher_phone = $1,
           contact_name  = COALESCE($2, contact_name)
       WHERE id = $3
       RETURNING id, name, identifier, region, teacher_phone, contact_name\`,
      [phone, contact_name || null, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'School not found' });
    res.json(result.rows[0]);
  } catch(err) { res.status(500).json({ error: err.message }); }
});
`;

// Find the last line and append before it (before module.exports)
if (content.includes('module.exports')) {
  content = content.replace(/module\.exports\s*=/, newRoutes + '\nmodule.exports =');
} else {
  content = content + newRoutes;
}

fs.writeFileSync(filePath, content, 'utf8');
console.log('✅ Teacher phone admin routes added to routes/admin.js');
console.log('\nNow run:');
console.log('git add routes/admin.js');
console.log('git commit -m "Add teacher phone admin routes"');
console.log('git push');
