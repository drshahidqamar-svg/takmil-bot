// move-home-button.js
// Removes old bottom-left Home button and adds a clean top Home button
// Run from takmil-bot folder: node move-home-button.js

const fs = require('fs');
const path = require('path');

function findHtmlFiles(dir, found = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) findHtmlFiles(full, found);
    else if (entry.name.endsWith('.html')) found.push(full);
  }
  return found;
}

// Skip the hub (it IS the home)
const SKIP = ['hub.html', 'hub5.html', 'index.html'];
const files = findHtmlFiles(__dirname).filter(f => !SKIP.some(s => f.endsWith(s)));

// New top home button — sits above everything, full-width bar style
const NEW_BUTTON = `
  <!-- Home Button Top Bar -->
  <div style="
    width:100%;
    background:#15803D;
    padding:8px 20px;
    display:flex;
    align-items:center;
    gap:10px;
    position:sticky;
    top:0;
    z-index:9999;
    box-shadow:0 2px 8px rgba(0,0,0,0.15);
  ">
    <a href="/" style="
      display:inline-flex;
      align-items:center;
      gap:7px;
      background:rgba(255,255,255,0.18);
      color:#ffffff;
      text-decoration:none;
      font-family:'Segoe UI',sans-serif;
      font-size:13px;
      font-weight:700;
      padding:5px 16px;
      border-radius:20px;
      border:1.5px solid rgba(255,255,255,0.35);
      transition:background 0.15s;
    " onmouseover="this.style.background='rgba(255,255,255,0.28)'"
       onmouseout="this.style.background='rgba(255,255,255,0.18)'">
      ⌂ Home
    </a>
    <span style="color:rgba(255,255,255,0.6);font-size:12px;font-family:'Segoe UI',sans-serif;">
      TAKMIL Monitoring Hub
    </span>
  </div>`;

let updated = 0, skipped = 0;

files.forEach(filePath => {
  let content = fs.readFileSync(filePath, 'utf8');

  // Remove ALL old home button variants (bottom-left fixed)
  // Pattern 1: <!-- Home Button (auto-added) --> block
  content = content.replace(/\n?\s*<!-- Home Button \(auto-added\) -->[\s\S]*?<\/a>/g, '');
  // Pattern 2: <!-- Home Button Top Bar --> (already new style — skip re-adding)
  const alreadyNew = content.includes('<!-- Home Button Top Bar -->');

  // Remove stray old ⌂ Home anchor if still present
  content = content.replace(/\n?\s*<a href="\/" style="[\s\S]{50,400}?⌂ Home<\/a>/g, '');

  if (alreadyNew) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`SKIP (already new): ${path.relative(__dirname, filePath)}`);
    skipped++;
    return;
  }

  // Insert new button right after <body...> tag
  if (/<body[^>]*>/i.test(content)) {
    content = content.replace(/(<body[^>]*>)/i, `$1\n${NEW_BUTTON}`);
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`UPDATED: ${path.relative(__dirname, filePath)}`);
    updated++;
  } else {
    console.log(`NO BODY: ${path.relative(__dirname, filePath)}`);
    skipped++;
  }
});

console.log('\n---------------------------------');
console.log(`Updated : ${updated} file(s)`);
console.log(`Skipped : ${skipped} file(s)`);
console.log('---------------------------------');
if (updated > 0) {
  console.log('\nNow run:');
  console.log('git add *.html; git commit -m "Move Home button to top bar"; git push');
}
