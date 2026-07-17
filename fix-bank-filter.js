const fs = require('fs');
const file = './takmil-question-bank.html';
let content = fs.readFileSync(file, 'utf8');

// Fix 1: setLevel - extract level number and grade from dropdown value
const oldSetLevel = 'function setLevel(l){activeLevel=l;applyFilters();}';
const newSetLevel = `function setLevel(l){
  activeLevel = l;
  // Value format: "P|7" = Primary Level 7, "G6|1" = Grade 6 Level 1, "" = All
  if(!l) { window._lvlNum=0; window._lvlGrade=''; }
  else if(l.includes('|')) {
    const p=l.split('|');
    window._lvlNum = parseInt(p[1]);
    window._lvlGrade = p[0]==='P' ? 'Primary' : 'Grade '+p[0].replace('G','');
  } else {
    // Legacy L1-L12 format
    window._lvlNum = parseInt(l.replace('L',''));
    window._lvlGrade = 'Primary';
  }
  applyFilters();
}`;
content = content.replace(oldSetLevel, newSetLevel);

// Fix 2: applyFilters - use _lvlNum for level comparison (number vs number)
content = content.replace(
  '(!activeLevel||q.level===activeLevel)&&',
  '(!activeLevel||(parseInt(q.level)===window._lvlNum && (!window._lvlGrade||!q.grade_label||(q.grade_label||"").startsWith(window._lvlGrade))))&&'
);

// Fix 3: Expand level dropdown options to match generator
const oldOpts = content.match(/<select[^>]*onchange="setLevel[^"]*"[^>]*>[\s\S]*?<\/select>/);
if (oldOpts) {
  const newOpts = `<select class="sb-select" onchange="setLevel(this.value)">
      <option value="">All Levels</option>
      <optgroup label="Primary (1-12)">
        <option value="P|1">Primary — Level 1</option>
        <option value="P|2">Primary — Level 2</option>
        <option value="P|3">Primary — Level 3</option>
        <option value="P|4">Primary — Level 4</option>
        <option value="P|5">Primary — Level 5</option>
        <option value="P|6">Primary — Level 6</option>
        <option value="P|7">Primary — Level 7</option>
        <option value="P|8">Primary — Level 8</option>
        <option value="P|9">Primary — Level 9</option>
        <option value="P|10">Primary — Level 10</option>
        <option value="P|11">Primary — Level 11</option>
        <option value="P|12">Primary — Level 12</option>
      </optgroup>
      <optgroup label="Elementary Grade 6">
        <option value="G6|1">Grade 6 — Level 1</option>
        <option value="G6|2">Grade 6 — Level 2</option>
        <option value="G6|3">Grade 6 — Level 3</option>
      </optgroup>
      <optgroup label="Elementary Grade 7">
        <option value="G7|1">Grade 7 — Level 1</option>
        <option value="G7|2">Grade 7 — Level 2</option>
        <option value="G7|3">Grade 7 — Level 3</option>
      </optgroup>
      <optgroup label="Elementary Grade 8">
        <option value="G8|1">Grade 8 — Level 1</option>
        <option value="G8|2">Grade 8 — Level 2</option>
        <option value="G8|3">Grade 8 — Level 3</option>
      </optgroup>
    </select>`;
  content = content.replace(oldOpts[0], newOpts);
  console.log('Level dropdown expanded');
}

// Fix 4: Map grade_label in question object
if (!content.includes('grade_label: q.grade_label')) {
  content = content.replace(
    "answer:   q.correct_answer || q.answer || '',",
    "answer:   q.correct_answer || q.answer || '',\n      grade_label: q.grade_label||'',\n      option_a: q.option_a||'', option_b: q.option_b||'', option_c: q.option_c||'', option_d: q.option_d||'',\n      question_type: q.question_type||'text',"
  );
}

// Fix 5: Show answer in rows
if (!content.includes('getAnswerHtml')) {
  content = content.replace(
    'function renderTable(){',
    `function getAnswerHtml(q){
  const ans=q.answer||''; if(!ans) return '';
  const qt=(q.question_type||'text').toUpperCase().replace(/[^A-Z]/g,'');
  if(qt==='MCQ'||qt==='TEXT'||qt==='PICTURE'){
    const map={A:q.option_a,B:q.option_b,C:q.option_c,D:q.option_d};
    const txt=map[ans]||'';
    return '<div style="margin-top:3px;font-size:11px;color:#15803d;font-weight:600">\u2713 '+ans+(txt?' \u2014 '+txt:'')+'</div>';
  }
  return '<div style="margin-top:3px;font-size:11px;color:#15803d;font-weight:600">\u2713 '+ans+'</div>';
}
function renderTable(){`
  );
  content = content.replace(
    '<td class="question-cell">${q.question}</td>',
    '<td class="question-cell"><div>${q.question}</div>${getAnswerHtml(q)}</td>'
  );
}

fs.writeFileSync(file, content, 'utf8');
console.log('Done!');
console.log('setLevel fixed:', content.includes('_lvlNum'));
console.log('applyFilters fixed:', content.includes('_lvlNum'));
console.log('Level 12:', content.includes('Primary — Level 12'));
console.log('Grade 6:', content.includes('Grade 6 — Level 1'));
console.log('getAnswerHtml:', content.includes('getAnswerHtml'));
