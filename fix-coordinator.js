const fs = require('fs');
const file = './coordinator-portal.html';
let c = fs.readFileSync(file, 'utf8');

// 1. Add new tab buttons
c = c.replace(
  '<button class="tab" onclick="switchTab(\'results\',this)">📊 Results</button>',
  '<button class="tab" onclick="switchTab(\'results\',this)">📊 Results</button>\n<button class="tab" onclick="switchTab(\'students\',this)">👨‍🎓 Students</button>\n<button class="tab" onclick="switchTab(\'pins\',this)">🔑 PINs</button>'
);

// 2. Add HTML tabs before </body>
const newHTML = `
<div id="tab-students" class="tab-content">
  <div class="card">
    <h3>Register Students</h3>
    <div class="grid2" style="margin-bottom:16px">
      <div class="field">
        <label>School</label>
        <select id="stu-school" style="width:100%;padding:8px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px"><option value="">-- Select School --</option></select>
      </div>
      <div class="field">
        <label>Grade and Level</label>
        <select id="stu-level" style="width:100%;padding:8px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px">
          <option value="">-- Select Level --</option>
          <optgroup label="Primary">
            <option value="Primary|1">Primary Level 1</option>
            <option value="Primary|2">Primary Level 2</option>
            <option value="Primary|3">Primary Level 3</option>
            <option value="Primary|4">Primary Level 4</option>
            <option value="Primary|5">Primary Level 5</option>
            <option value="Primary|6">Primary Level 6</option>
            <option value="Primary|7">Primary Level 7</option>
            <option value="Primary|8">Primary Level 8</option>
            <option value="Primary|9">Primary Level 9</option>
            <option value="Primary|10">Primary Level 10</option>
            <option value="Primary|11">Primary Level 11</option>
            <option value="Primary|12">Primary Level 12</option>
          </optgroup>
          <optgroup label="Grade 6">
            <option value="Grade 6|1">Grade 6 Level 1</option>
            <option value="Grade 6|2">Grade 6 Level 2</option>
            <option value="Grade 6|3">Grade 6 Level 3</option>
          </optgroup>
          <optgroup label="Grade 7">
            <option value="Grade 7|1">Grade 7 Level 1</option>
            <option value="Grade 7|2">Grade 7 Level 2</option>
            <option value="Grade 7|3">Grade 7 Level 3</option>
          </optgroup>
          <optgroup label="Grade 8">
            <option value="Grade 8|1">Grade 8 Level 1</option>
            <option value="Grade 8|2">Grade 8 Level 2</option>
            <option value="Grade 8|3">Grade 8 Level 3</option>
          </optgroup>
        </select>
      </div>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:16px">
      <input type="text" id="stu-name" placeholder="Student name" style="flex:1;padding:9px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px">
      <button onclick="addStudent()" style="padding:9px 20px;background:#1a3a2a;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer;font-size:13px">+ Add</button>
      <button onclick="loadStudents()" style="padding:9px 14px;border:1.5px solid #e2e8f0;border-radius:8px;background:#fff;cursor:pointer;font-size:13px">Refresh</button>
    </div>
    <div id="stu-list" style="font-size:13px;color:#64748b;padding:16px;text-align:center">Select a school to see students</div>
  </div>
</div>

<div id="tab-pins" class="tab-content">
  <div class="card">
    <h3>Active PINs</h3>
    <div style="display:flex;gap:8px;margin-bottom:14px">
      <select id="pin-school-filter" onchange="loadPins()" style="flex:1;padding:8px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px"><option value="">All Schools</option></select>
      <button onclick="loadPins()" style="padding:8px 14px;border:1.5px solid #e2e8f0;border-radius:8px;background:#fff;cursor:pointer;font-size:13px">Refresh</button>
    </div>
    <div id="pins-list" style="font-size:13px;color:#64748b">Loading...</div>
  </div>
</div>
`;
c = c.replace('</body>', newHTML + '</body>');

// 3. Add JS before </script>
const newJS = `
async function loadStudents(){
  const schoolId = document.getElementById('stu-school').value;
  const list = document.getElementById('stu-list');
  if(!schoolId){ list.innerHTML='Select a school above'; return; }
  list.innerHTML = 'Loading...';
  try{
    const r = await fetch(BASE+'/api/students?school_id='+schoolId);
    const d = await r.json();
    const rows = d.students || [];
    if(!rows.length){ list.innerHTML='No students registered yet'; return; }
    let html = '<table style="width:100%;border-collapse:collapse">';
    html += '<tr style="border-bottom:1px solid #e2e8f0;font-weight:700"><td style="padding:8px">Name</td><td style="padding:8px">Grade</td><td style="padding:8px">Level</td><td style="padding:8px">Enrolled</td></tr>';
    rows.forEach(function(s){
      html += '<tr style="border-bottom:1px solid #f0f0f0">';
      html += '<td style="padding:8px">' + s.name + '</td>';
      html += '<td style="padding:8px">' + (s.grade_label||'Primary') + '</td>';
      html += '<td style="padding:8px">L' + s.level + '</td>';
      html += '<td style="padding:8px;font-size:11px;color:#94a3b8">' + (s.enrolled_at||'').slice(0,10) + '</td>';
      html += '</tr>';
    });
    html += '</table>';
    list.innerHTML = html;
  }catch(e){ list.innerHTML='Error: '+e.message; }
}

async function addStudent(){
  const schoolId = document.getElementById('stu-school').value;
  const name = document.getElementById('stu-name').value.trim();
  const lvlVal = document.getElementById('stu-level').value;
  if(!schoolId||!name||!lvlVal){ alert('Please fill all fields'); return; }
  const parts = lvlVal.split('|');
  try{
    const r = await fetch(BASE+'/api/students',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name,school_id:parseInt(schoolId),grade_label:parts[0],level:parseInt(parts[1])})});
    const d = await r.json();
    if(d.error) throw new Error(d.error);
    document.getElementById('stu-name').value='';
    loadStudents();
  }catch(e){ alert('Failed: '+e.message); }
}

async function loadPins(){
  const schoolId = document.getElementById('pin-school-filter').value;
  const list = document.getElementById('pins-list');
  list.innerHTML='Loading...';
  try{
    const url = BASE+'/api/pins/active'+(schoolId?'?school_id='+schoolId:'');
    const r = await fetch(url);
    const d = await r.json();
    const pins = d.pins||[];
    if(!pins.length){ list.innerHTML='No active PINs found'; return; }
    let html = '<table style="width:100%;border-collapse:collapse">';
    html += '<tr style="border-bottom:1px solid #e2e8f0;font-weight:700;background:#f8fafc"><td style="padding:10px">PIN</td><td style="padding:10px">School</td><td style="padding:10px">Grade / Level</td><td style="padding:10px">Subject</td><td style="padding:10px">Expires</td><td style="padding:10px">Action</td></tr>';
    pins.forEach(function(p){
      html += '<tr style="border-bottom:1px solid #f0f0f0">';
      html += '<td style="padding:10px;font-family:monospace;font-size:18px;font-weight:800;color:#1a3a2a;letter-spacing:2px">' + p.pin + '</td>';
      html += '<td style="padding:10px;font-size:12px">' + (p.school_name||p.school_id||'') + '</td>';
      html += '<td style="padding:10px"><span style="background:#e8f5ee;color:#1a3a2a;padding:2px 8px;border-radius:5px;font-size:11px;font-weight:700">' + (p.grade_label||'Primary') + ' L' + p.level + '</span></td>';
      html += '<td style="padding:10px;font-size:12px">' + (p.subject||'All') + '</td>';
      html += '<td style="padding:10px;font-size:11px;color:#64748b">' + (p.expires_at||'').slice(0,10) + '</td>';
      html += '<td style="padding:10px"><button onclick="revokePin(\'' + p.pin + '\')" style="padding:4px 10px;background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;border-radius:6px;cursor:pointer;font-size:11px;font-weight:600">Revoke</button></td>';
      html += '</tr>';
    });
    html += '</table>';
    list.innerHTML = html;
  }catch(e){ list.innerHTML='Error: '+e.message; }
}

async function revokePin(pin){
  if(!confirm('Revoke PIN '+pin+'?')) return;
  try{
    await fetch(BASE+'/api/pins/'+pin+'/revoke',{method:'POST'});
    loadPins();
  }catch(e){ alert('Failed: '+e.message); }
}

async function populateStuSchools(){
  try{
    const r = await fetch(BASE+'/api/schools');
    const d = await r.json();
    const schools = d.schools||[];
    var opts = '<option value="">-- Select School --</option>' + schools.map(function(s){ return '<option value="'+s.id+'">'+s.name+'</option>'; }).join('');
    var pOpts = '<option value="">All Schools</option>' + schools.map(function(s){ return '<option value="'+s.id+'">'+s.name+'</option>'; }).join('');
    var ss = document.getElementById('stu-school');
    var ps = document.getElementById('pin-school-filter');
    if(ss) ss.innerHTML = opts;
    if(ps) ps.innerHTML = pOpts;
  }catch(e){}
}

document.addEventListener('DOMContentLoaded', function(){ populateStuSchools(); });
`;
c = c.replace('</script>', newJS + '\n</script>');

fs.writeFileSync(file, c, 'utf8');
console.log('Done!');
console.log('Students tab:', c.includes('tab-students'));
console.log('Pins tab:', c.includes('tab-pins'));
console.log('addStudent:', c.includes('async function addStudent'));
