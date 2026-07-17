// fix-duplicate-routes.js
// Run from your takmil-bot folder: node fix-duplicate-routes.js
// Removes the first (broken) duplicate routes, keeps the correct ones added later

const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'routes', 'admin.js');
let content = fs.readFileSync(filePath, 'utf8');

// ── 1. Remove the one-liner /admin/students/results (line ~333) ───────────────
// It queries assessments table with sa.completed_at which may not exist
const oldStudentsResults = `router.get('/admin/students/results',   async (req, res) => { try { const r = await db.pool.query(\`SELECT sa.*, s.name AS school_name, s.province FROM student_assessments sa LEFT JOIN schools s ON s.id=sa.school_id ORDER BY sa.completed_at DESC\`); res.json(r.rows); } catch(e) { res.status(500).json({ error: e.message }); }});`;
if (content.includes(oldStudentsResults)) {
  content = content.replace(oldStudentsResults, '// /admin/students/results — moved below to correct version');
  console.log('✅ Removed duplicate /admin/students/results (one-liner)');
} else {
  console.log('⚠️  Could not find exact one-liner for /admin/students/results — trying fallback...');
  // Fallback: use regex to remove the one-liner version
  const regex = /router\.get\('\/admin\/students\/results',\s+async \(req, res\) => \{ try \{ const r = await db\.pool\.query\(`SELECT sa\.\*, s\.name AS school_name, s\.province FROM student_assessments sa LEFT JOIN schools s ON s\.id=sa\.school_id ORDER BY sa\.completed_at DESC`\); res\.json\(r\.rows\); \} catch\(e\) \{ res\.status\(500\)\.json\(\{ error: e\.message \}\); \}\}\);/;
  if (regex.test(content)) {
    content = content.replace(regex, '// /admin/students/results — moved below to correct version');
    console.log('✅ Removed duplicate /admin/students/results (regex fallback)');
  } else {
    console.log('❌ Could not remove /admin/students/results duplicate — please check manually');
  }
}

// ── 2. Remove the first /admin/analytics route (lines ~337-346) ───────────────
// It uses db.getAnalyticsSummary() + queries assessments table (not student_assessments)
const oldAnalytics = `router.get('/admin/analytics', async (req, res) => {
  try {
    const summary    = await db.getAnalyticsSummary();
    const bySubject  = await db.pool.query(\`SELECT subject, COUNT(*) AS count, ROUND(AVG(score_pct),1) AS avg_score FROM assessments GROUP BY subject ORDER BY subject\`);
    const byLevel    = await db.pool.query(\`SELECT level, COUNT(*) AS count, ROUND(AVG(score_pct),1) AS avg_score, SUM(CASE WHEN passed THEN 1 ELSE 0 END) AS passed FROM assessments GROUP BY level ORDER BY level\`);
    const upcoming   = await db.pool.query(\`SELECT rs.*, s.name AS school_name FROM reassessment_schedule rs JOIN schools s ON s.id=rs.school_id WHERE rs.completed=FALSE AND rs.scheduled_date>=CURRENT_DATE ORDER BY rs.scheduled_date ASC LIMIT 20\`);
    const studentStats = await db.pool.query(\`SELECT COUNT(*) AS total, SUM(CASE WHEN passed THEN 1 ELSE 0 END) AS passed FROM student_assessments\`).catch(() => ({ rows: [{ total: 0, passed: 0 }] }));
    res.json({ summary, bySubject: bySubject.rows, byLevel: byLevel.rows, upcomingReassessments: upcoming.rows, studentStats: studentStats.rows[0] });
  } catch(err) { res.status(500).json({ error: err.message }); }
});`;

if (content.includes(oldAnalytics)) {
  content = content.replace(oldAnalytics, '// /admin/analytics — moved below to correct version');
  console.log('✅ Removed duplicate /admin/analytics (getAnalyticsSummary version)');
} else {
  // Regex fallback
  const regex2 = /router\.get\('\/admin\/analytics',\s*async \(req, res\) => \{\s*try \{\s*const summary\s*=\s*await db\.getAnalyticsSummary\(\);[\s\S]*?res\.json\(\{ summary, bySubject[\s\S]*?\}\);\s*\} catch\(err\) \{ res\.status\(500\)\.json\(\{ error: err\.message \}\); \}\s*\}\);/;
  if (regex2.test(content)) {
    content = content.replace(regex2, '// /admin/analytics — moved below to correct version');
    console.log('✅ Removed duplicate /admin/analytics (regex fallback)');
  } else {
    console.log('❌ Could not remove /admin/analytics duplicate — please check manually');
  }
}

// ── 3. Remove duplicate one-liners for routes that are properly defined below ─
const oneLinerDups = [
  { name: '/admin/schools/list',        pattern: /router\.get\('\/admin\/schools\/list',\s+async \(req, res\) => \{ try \{ const r = await db\.pool\.query\('SELECT \* FROM schools ORDER BY created_at DESC'\); res\.json\(r\.rows\); \} catch\(e\) \{ res\.status\(500\)\.json\(\{ error: e\.message \}\); \}\}\);/ },
  { name: '/admin/pins/list',           pattern: /router\.get\('\/admin\/pins\/list',\s+async \(req, res\) => \{ try \{ const r = await db\.pool\.query\(`SELECT p\.\*, s\.name AS school_name FROM pins p LEFT JOIN schools s ON s\.id=p\.school_id ORDER BY p\.created_at DESC LIMIT 100`\); res\.json\(r\.rows\); \} catch\(e\) \{ res\.status\(500\)\.json\(\{ error: e\.message \}\); \}\}\);/ },
  { name: '/admin/advancements/all',    pattern: /router\.get\('\/admin\/advancements\/all',\s+async \(req, res\) => \{ try \{ const r = await db\.pool\.query\(`SELECT ar\.\*, s\.name AS school_name FROM advancement_requests ar JOIN schools s ON s\.id=ar\.school_id ORDER BY ar\.created_at DESC`\); res\.json\(r\.rows\); \} catch\(e\) \{ res\.status\(500\)\.json\(\{ error: e\.message \}\); \}\}\);/ },
  { name: '/admin/assessments/all',     pattern: /router\.get\('\/admin\/assessments\/all',\s+async \(req, res\) => \{ try \{ const r = await db\.pool\.query\(`SELECT a\.\*, s\.name AS school_name FROM assessments a LEFT JOIN schools s ON s\.id=a\.school_id ORDER BY a\.completed_at DESC`\); res\.json\(r\.rows\); \} catch\(e\) \{ res\.status\(500\)\.json\(\{ error: e\.message \}\); \}\}\);/ },
  { name: '/admin/ops/list (one-liner)',pattern: /router\.get\('\/admin\/ops\/list',\s+async \(req, res\) => \{ try \{ const r = await db\.pool\.query\('SELECT \* FROM ops_team ORDER BY created_at ASC'\); res\.json\(r\.rows\); \} catch\(e\) \{ res\.status\(500\)\.json\(\{ error: e\.message \}\); \}\}\);/ },
];

for (const { name, pattern } of oneLinerDups) {
  if (pattern.test(content)) {
    content = content.replace(pattern, `// ${name} — defined below`);
    console.log(`✅ Removed duplicate one-liner: ${name}`);
  } else {
    console.log(`ℹ️  No one-liner duplicate found for ${name} (may already be clean)`);
  }
}

// ── Write the cleaned file ────────────────────────────────────────────────────
fs.writeFileSync(filePath, content, 'utf8');
console.log('\n✅ Done! routes/admin.js cleaned.');
console.log('Now run: git add routes/admin.js && git commit -m "Fix duplicate admin routes" && git push');
