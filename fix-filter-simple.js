const fs = require('fs');
const file = './takmil-question-bank.html';
let content = fs.readFileSync(file, 'utf8');

// Fix setLevel to store just the level number
const oldSetLevel = content.match(/function setLevel\([^)]*\)\s*\{[\s\S]*?\n\}/);
if (oldSetLevel) {
  content = content.replace(oldSetLevel[0],
    `function setLevel(l){
  activeLevel = l;
  // Extract level number: "P|7" -> 7, "G6|1" -> 1, "L7" -> 7, "" -> 0
  if(!l) { window._lvlNum = 0; }
  else if(l.includes('|')) { window._lvlNum = parseInt(l.split('|')[1]); }
  else { window._lvlNum = parseInt(l.replace('L','')); }
  applyFilters();
}`
  );
  console.log('setLevel fixed');
}

// Fix applyFilters level comparison
content = content.replace(
  /\(!activeLevel\|\|q\.level===activeLevel\)/,
  '(!activeLevel||parseInt(q.level)===window._lvlNum)'
);
// Also try alternate format
content = content.replace(
  /\(!activeLevel\|\|q\.level==activeLevel\)/,
  '(!activeLevel||parseInt(q.level)===window._lvlNum)'
);

fs.writeFileSync(file, content, 'utf8');
console.log('Done!');
console.log('_lvlNum in setLevel:', content.includes('_lvlNum'));
console.log('parseInt in applyFilters:', content.includes('parseInt(q.level)'));
