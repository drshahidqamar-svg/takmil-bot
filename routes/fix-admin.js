const fs = require('fs');
const file = './routes/admin.js';
let content = fs.readFileSync(file, 'utf8');

// Fix 1: $7::text cast
content = content.replace(
  "VALUES ($1,$2,$3,$4,$5,$6,$7,\n            CASE WHEN $7 IS NOT NULL",
  "VALUES ($1,$2,$3,$4,$5,$6,$7::text,\n            CASE WHEN $7::text IS NOT NULL"
);

// Fix 2: Replace hardcoded question_type with $14
content = content.replace(
  "THEN 'picture' ELSE 'text' END,\n            $8,$9,$10,$11,$12,$13,NOW())",
  "THEN 'picture' ELSE 'text' END),\n            $8,$9,$10,$11,$12,$13,NOW())"
);
content = content.replace(
  "THEN 'picture' ELSE 'text' END,\n            $8",
  "COALESCE(NULLIF($14,''), CASE WHEN $7::text IS NOT NULL AND $7::text!='' THEN 'picture' ELSE 'text' END),\n            $8"
);

// Fix 3: Add question_type to values array  
content = content.replace(
  "imageUrl, optA, optB, optC, optD, correctOpt, activeVal]);",
  "imageUrl, optA, optB, optC, optD, correctOpt, activeVal, row.question_type||null]);"
);

// Fix 4: Add generate-ai proxy if missing
if (!content.includes('/api/questions/generate-ai')) {
  const proxy = `
router.post('/api/questions/generate-ai', async (req, res) => {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(req.body)
    });
    res.json(await response.json());
  } catch (err) { res.status(500).json({ error: err.message }); }
});
`;
  content = content.replace('module.exports = { router };', proxy + '\nmodule.exports = { router };');
}

fs.writeFileSync(file, content, 'utf8');
console.log('Done! Fixes applied.');
