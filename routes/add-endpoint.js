const fs = require('fs');
const file = './routes/admin.js';
let content = fs.readFileSync(file, 'utf8');

if (content.includes('/api/questions/generate-ai')) {
  console.log('Endpoint already exists');
} else {
  const proxy = `
// Question Generator AI proxy
router.post('/api/questions/generate-ai', async (req, res) => {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(req.body)
    });
    res.json(await response.json());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

`;
  content = content.replace('module.exports = { router };', proxy + 'module.exports = { router };');
  fs.writeFileSync(file, content, 'utf8');
  console.log('Done! generate-ai endpoint added.');
}
