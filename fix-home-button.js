// fix-home-button.js
// Repositions home button from top-left to bottom-left on all HTML files
// Run: node fix-home-button.js

const fs = require('fs');
const path = require('path');

function findHtmlFiles(dir, found = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) findHtmlFiles(fullPath, found);
    else if (entry.name.endsWith('.html')) found.push(fullPath);
  }
  return found;
}

const oldButton = `
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

const newButton = `
  <!-- Home Button (auto-added) -->
  <a href="/" style="
    position: fixed;
    bottom: 20px;
    left: 20px;
    z-index: 9999;
    background: #15803D;
    color: #ffffff;
    text-decoration: none;
    font-family: 'Segoe UI', sans-serif;
    font-size: 13px;
    font-weight: 600;
    padding: 8px 16px;
    border-radius: 30px;
    display: flex;
    align-items: center;
    gap: 6px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    opacity: 0.92;
  ">&#8962; Home</a>`;

const files = findHtmlFiles(__dirname);
let updated = 0;

files.forEach(filePath => {
  let content = fs.readFileSync(filePath, 'utf8');
  if (content.includes('Home Button (auto-added)') && content.includes('top: 12px')) {
    content = content.replace(oldButton, newButton);
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`FIXED: ${path.relative(__dirname, filePath)}`);
    updated++;
  }
});

console.log(`\nFixed: ${updated} file(s)`);
console.log('\nNow run:');
console.log('git add *.html; git commit -m "Fix home button position"; git push');
