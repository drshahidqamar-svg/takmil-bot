const fs = require('fs');
const file = './takmil-question-bank.html';
let c = fs.readFileSync(file, 'utf8');

// Fix 1: applyFilters level comparison
c = c.replace(
  '(!activeLevel||q.level===activeLevel)&&',
  '(!activeLevel||parseInt(q.level)===parseInt((activeLevel.split("|")[1]||activeLevel).replace("L","")))&&'
);

// Fix 2: Expand level dropdown
c = c.replace(
  `<option value="L1">Level 1</option>
      <option value="L2">Level 2</option>
      <option value="L3">Level 3</option>
      <option value="L4">Level 4</option>
      <option value="L5">Level 5</option>`,
  `<optgroup label="Primary (1-12)">
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
      </optgroup>`
);

fs.writeFileSync(file, c, 'utf8');
console.log('Done!');
console.log('Filter fixed:', c.includes('parseInt(q.level)'));
console.log('Level 12:', c.includes('Primary — Level 12'));
