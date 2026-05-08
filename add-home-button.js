// add-home-button.js
// Run from your takmil-bot folder: node add-home-button.js

const fs = require('fs');
const path = require('path');

// Auto-find all HTML files in the project (skips node_modules and .git)
function findHtmlFiles(dir, found = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findHtmlFiles(fullPath, found);
    } else if (entry.name.endsWith('.html')) {
      found.push(fullPath);
    }
  }
  return found;
}

// Skip the hub/home page itself
const SKIP_FILES = ['hub.html', 'hub5.html', 'index.html'];

const files = findHtmlFiles(__dirname).filter(f =>
  !SKIP_FILES.some(skip => f.endsWith(skip))
);

console.log(`\nFound ${files.length} HTML file(s):\n`);
files.forEach(f => console.log('  ' + path.relative(__dirname, f)));
console.log('');

const homeButton = `
  <!-- Home Button (auto-added) -->
  <a href="/" style="
    position: fixed;
    top: 12px;
    left: 12px;
    z-index: 9999;
    background: #15803D;
    color: #ffffff;
    text-decoration: none;
    font-family: 'Segoe UI', sans-serif;
    font-size: 13px;
    font-weight: 600;
    padding: 7px 14px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    gap: 6px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
  ">&#8962; Home</a>`;

let updated = 0;
let skipped = 0;

files.forEach(filePath => {
  let content = fs.readFileSync(filePath, 'utf8');

  // Skip if home button already added
  if (content.includes('Home Button (auto-added)')) {
    console.log(`SKIP (already done): ${path.relative(__dirname, filePath)}`);
    skipped++;
    return;
  }

  // Insert after <body> tag
  if (/<body[^>]*>/i.test(content)) {
    content = content.replace(/(<body[^>]*>)/i, `$1\n${homeButton}`);
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`UPDATED: ${path.relative(__dirname, filePath)}`);
    updated++;
  } else {
    console.log(`NO BODY TAG: ${path.relative(__dirname, filePath)}`);
    skipped++;
  }
});

console.log('\n---------------------------------');
console.log(`Updated : ${updated} file(s)`);
console.log(`Skipped : ${skipped} file(s)`);
console.log('---------------------------------');
if (updated > 0) {
  console.log('\nNow run:');
  console.log('git add . && git commit -m "Add home button to all portals" && git push');
}
