const fs = require('fs');
const file = './takmil-question-bank.html';
let content = fs.readFileSync(file, 'utf8');

// Step 1: Replace level select options
const oldSelect = content.match(/<select[^>]*onchange="setLevel[^"]*"[^>]*>[\s\S]*?<\/select>/);
if (!oldSelect) { console.log('ERROR: Could not find level select'); process.exit(1); }

const newSelect = `<select class="sb-select" onchange="setLevel(this.value)">
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

content = content.replace(oldSelect[0], newSelect);

// Step 2: Replace setLevel function
content = content.replace(
  /function setLevel\([^)]*\)\s*\{[^}]*\}/,
  `function setLevel(val){
  activeLevel = val;
  // Parse "P|7" => level=7, grade=Primary  OR  "G6|1" => level=1, grade=Grade 6
  if(!val) { window._filterLevel=''; window._filterGrade=''; }
  else {
    const parts = val.split('|');
    window._filterLevel = parts[1] || '';
    window._filterGrade = parts[0]==='P' ? 'Primary' : 'Grade '+parts[0].replace('G','');
  }
  loading = false;
  loadFromAPI();
}`
);

// Step 3: Update loadFromAPI to pass level + grade_label
content = content.replace(
  /fetch\(['"]\/api\/questions\/bank[^'"]*['"]\)/,
  `fetch('/api/questions/bank?limit=500'+(activeSubject?'&subject='+encodeURIComponent(activeSubject):'')+(window._filterLevel?'&level='+window._filterLevel:'')+(window._filterGrade?'&grade_label='+encodeURIComponent(window._filterGrade):''))`
);

// Step 4: Map grade_label in question object
content = content.replace(
  "answer:   q.correct_answer || q.answer || '',",
  "answer:   q.correct_answer || q.answer || '',\n      grade_label: q.grade_label||'',\n      option_a: q.option_a||'', option_b: q.option_b||'', option_c: q.option_c||'', option_d: q.option_d||'',\n      question_type: q.question_type||'text',"
);

// Step 5: Show correct answer in rows
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
console.log('Level 12:', content.includes('Primary — Level 12'));
console.log('Grade 6:', content.includes('Grade 6 — Level 1'));
console.log('getAnswerHtml:', content.includes('getAnswerHtml'));
