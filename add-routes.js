// add-routes.js
// Adds all missing portal routes to index.js
// Run from takmil-bot folder: node add-routes.js

const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, 'index.js');
let content = fs.readFileSync(indexPath, 'utf8');

if (content.includes('// ── Portal Routes (auto-added) ──')) {
  console.log('Routes already added. Nothing to do.');
  process.exit(0);
}

const newRoutes = `
// ── Portal Routes (auto-added) ──
app.get('/coordinator',          (req, res) => res.sendFile(path.join(__dirname, 'coordinator-portal.html')));
app.get('/portal',               (req, res) => res.sendFile(path.join(__dirname, 'portal.html')));
app.get('/offline-portal',       (req, res) => res.sendFile(path.join(__dirname, 'offline-portal.html')));
app.get('/teacher-portal',       (req, res) => res.sendFile(path.join(__dirname, 'teacher-portal.html')));
app.get('/lessons-admin',        (req, res) => res.sendFile(path.join(__dirname, 'lessons-admin.html')));
app.get('/dashboard',            (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));
app.get('/question-bank',        (req, res) => res.sendFile(path.join(__dirname, 'takmil-question-bank.html')));
app.get('/register',             (req, res) => res.sendFile(path.join(__dirname, 'register.html')));
app.get('/results',              (req, res) => res.sendFile(path.join(__dirname, 'results.html')));
app.get('/attendance',           (req, res) => res.sendFile(path.join(__dirname, 'attendance.html')));
app.get('/attendance-dashboard', (req, res) => res.sendFile(path.join(__dirname, 'attendance-dashboard.html')));
app.get('/pin-generator',        (req, res) => res.sendFile(path.join(__dirname, 'pin-generator.html')));
app.get('/analytics',            (req, res) => res.sendFile(path.join(__dirname, 'analytics.html')));
app.get('/import',               (req, res) => res.sendFile(path.join(__dirname, 'import.html')));
app.get('/assess',               (req, res) => res.sendFile(path.join(__dirname, 'assess.html')));
app.get('/compliance',           (req, res) => res.sendFile(path.join(__dirname, 'compliance.html')));
app.get('/feedback',             (req, res) => res.sendFile(path.join(__dirname, 'feedback.html')));
app.get('/level-advancement',    (req, res) => res.sendFile(path.join(__dirname, 'level-advancement.html')));
app.get('/image-portal',         (req, res) => res.sendFile(path.join(__dirname, 'image-portal.html')));
app.get('/picture-questions',    (req, res) => res.sendFile(path.join(__dirname, 'picture-questions.html')));
app.get('/takmil-classroom',     (req, res) => res.sendFile(path.join(__dirname, 'takmil-classroom.html')));
`;

// Insert after the last existing app.get line (line with /classroom)
content = content.replace(
  `app.get('/classroom', (req, res) => res.sendFile(path.join(__dirname, 'takmil-classroom.html')));`,
  `app.get('/classroom', (req, res) => res.sendFile(path.join(__dirname, 'takmil-classroom.html')));
${newRoutes}`
);

fs.writeFileSync(indexPath, content, 'utf8');
console.log('✅ All routes added to index.js!');
console.log('\nNow run:');
console.log('git add index.js');
console.log('git commit -m "Add all missing portal routes"');
console.log('git push');
