// routes/photo-verify.js — AI Photo Verification (head count + lesson check)
// Photos stored in PostgreSQL — no filesystem dependency
// Auto-deleted after 48 hours

const router  = require('express').Router();
const db      = require('../database');
const { sendWhatsApp } = require('../helpers/whatsapp');

// ── Ensure photo columns exist ────────────────────────────────────────────────
async function ensurePhotoColumns() {
  try {
    await db.pool.query(`
      ALTER TABLE daily_feedback
        ADD COLUMN IF NOT EXISTS photo_data       TEXT,
        ADD COLUMN IF NOT EXISTS photo_mime_type  VARCHAR(50),
        ADD COLUMN IF NOT EXISTS photo_expires_at TIMESTAMPTZ
    `);
    console.log('✅ Photo columns ready');
  } catch(e) { console.log('photo column init:', e.message); }
}
ensurePhotoColumns();

// ── Auto-delete photos after 48 hours ────────────────────────────────────────
async function cleanupExpiredPhotos() {
  try {
    const r = await db.pool.query(`
      UPDATE daily_feedback
      SET photo_data = NULL, photo_mime_type = NULL
      WHERE photo_expires_at IS NOT NULL
        AND photo_expires_at < NOW()
        AND photo_data IS NOT NULL
      RETURNING id, school_name
    `);
    if (r.rows.length > 0) console.log(`🗑️ Auto-deleted ${r.rows.length} expired photo(s)`);
  } catch(e) { console.log('photo cleanup error:', e.message); }
}
cleanupExpiredPhotos();
setInterval(cleanupExpiredPhotos, 60 * 60 * 1000);

// ── Main photo handler (called from chatbot /webhook) ─────────────────────────
async function handleClassPhoto(from, mediaUrl, mimeType) {
  try {
    console.log(`📸 Downloading photo from Twilio: ${mediaUrl}`);
    const authHeader = 'Basic ' + Buffer.from(
      process.env.TWILIO_ACCOUNT_SID + ':' + process.env.TWILIO_AUTH_TOKEN
    ).toString('base64');

    const imgResp = await fetch(mediaUrl, { headers: { Authorization: authHeader } });
    if (!imgResp.ok) throw new Error(`Failed to download image: ${imgResp.status}`);

    const imageBytes  = Buffer.from(await imgResp.arrayBuffer());
    const imageBase64 = imageBytes.toString('base64');
    if (imageBase64.length < 1000) throw new Error('Downloaded content too small — not a real image');

    // ── Claude Vision — head count + lesson check ──────────────────────────
    const apiResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':    'application/json',
        'x-api-key':       process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5-20251101',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mimeType || 'image/jpeg', data: imageBase64 } },
            { type: 'text', text: `You are analyzing a classroom photo from a school in rural Pakistan.
Return ONLY valid JSON — no other text:
{
  "head_count": <integer: count ALL people visible - students AND teachers>,
  "projector_visible": <boolean: true if any projector, projected image, or whiteboard content visible>,
  "screen_visible": <boolean: true if whiteboard or projection surface visible>,
  "content_on_screen": <boolean: true if board/wall shows written or projected content>,
  "students_facing_screen": <boolean: true if students face a board or screen>,
  "confidence": "<high|medium|low>",
  "lesson_verified": <boolean: true if students present AND learning content visible>,
  "note": "<one sentence describing what you see>"
}
NOTE: Pakistani classrooms often use small portable projectors on tables or boxes.` }
          ]
        }]
      })
    });

    const apiData = await apiResp.json();
    if (apiData.error) throw new Error('Vision API: ' + apiData.error.message);
    const rawText = apiData.content?.[0]?.text || '';

    let headCount = null, note = '';
    const vis = {};
    try {
      const match = rawText.replace(/```json|```/g, '').trim().match(/\{[\s\S]*\}/);
      if (match) {
        const p   = JSON.parse(match[0]);
        const raw = p.head_count ?? p.count ?? p.number ?? p.total;
        headCount = raw !== undefined ? parseInt(raw) : null;
        note      = p.note || '';
        vis.projector_visible      = !!p.projector_visible;
        vis.screen_visible         = !!p.screen_visible;
        vis.content_on_screen      = !!p.content_on_screen;
        vis.students_facing_screen = !!p.students_facing_screen;
        vis.lesson_verified        = !!p.lesson_verified;
      }
    } catch(e) {}

    // Fallback: extract first reasonable number from text
    if (headCount === null || isNaN(headCount)) {
      for (const m of (rawText.match(/\b(\d+)\b/g) || [])) {
        const n = parseInt(m);
        if (n >= 1 && n <= 200) { headCount = n; break; }
      }
    }
    console.log(`📸 Head count: ${headCount} — ${note}`);

    // ── Find today's feedback for this teacher ──────────────────────────────
    const phoneNorm = from.replace('whatsapp:', '');
    const fbRow = await db.pool.query(`
      SELECT id, present, school_name, school_identifier FROM daily_feedback
      WHERE (teacher_phone=$1 OR teacher_phone=$2 OR teacher_phone=$3)
        AND created_at > NOW() - INTERVAL '24 hours'
      ORDER BY created_at DESC LIMIT 1
    `, [from, phoneNorm, 'whatsapp:' + phoneNorm]);

    if (!fbRow.rows.length) {
      return { headCount, message: `📸 Photo received! Counted ${headCount ?? '?'} people.\n\nNo feedback report found for today. Please submit your daily report first.` };
    }

    const fb       = fbRow.rows[0];
    const reported = parseInt(fb.present) || 0;
    const diff     = headCount !== null ? headCount - reported : null;
    const absDiff  = diff !== null ? Math.abs(diff) : null;
    const pctDiff  = reported > 0 && diff !== null ? Math.round(absDiff / reported * 100) : null;
    const flagged  = absDiff !== null && absDiff > 3 && pctDiff > 15;
    const flag     = flagged
      ? (diff > 0 ? `Photo shows ${diff} MORE than reported` : `Photo shows ${absDiff} FEWER than reported`)
      : null;

    // ── Save photo + results to DB ──────────────────────────────────────────
    const publicUrl = `/api/photo/${fb.id}`;
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

    await db.pool.query(`
      UPDATE daily_feedback SET
        photo_url         = $1,  photo_data        = $2,
        photo_mime_type   = $3,  photo_expires_at  = $4,
        photo_head_count  = $5,  head_count_diff   = $6,
        photo_verified    = $7,  photo_flag        = $8,
        projector_visible = $9,  lesson_verified   = $10
      WHERE id = $11
    `, [publicUrl, imageBase64, mimeType || 'image/jpeg', expiresAt,
        headCount, diff, !flagged, flag,
        vis.projector_visible || false, vis.lesson_verified || false,
        fb.id]);

    // ── Reply to teacher ────────────────────────────────────────────────────
    let reply;
    if (headCount === null) {
      reply = `📸 Photo received but couldn't count people clearly. Please send a clearer photo.`;
    } else if (flagged) {
      reply = `📸 Photo verified — ⚠️ MISMATCH DETECTED\n\nPhoto head count: ${headCount}\nReported present: ${reported}\nDifference: ${diff > 0 ? '+' : ''}${diff} (${pctDiff}%)\n\nYour coordinator has been notified.`;
      try {
        const cr = await db.pool.query(`
          SELECT sc.phone FROM schools s
          JOIN school_coordinators sc ON sc.id = s.school_coordinator_id
          WHERE s.identifier = (SELECT school_identifier FROM daily_feedback WHERE id=$1) LIMIT 1
        `, [fb.id]);
        if (cr.rows[0]?.phone) {
          await sendWhatsApp(cr.rows[0].phone,
            `⚠️ Attendance Mismatch — ${fb.school_name}\n\nPhoto count: ${headCount}\nReported: ${reported}\nDifference: ${diff > 0 ? '+' : ''}${diff}\n\nView photo (48h link):\nhttps://takmil-bot-production-0f51.up.railway.app${publicUrl}`
          );
        }
      } catch(e) { console.log('coordinator notify error:', e.message); }
    } else {
      reply = `📸 Photo verified — ✅ MATCH\n\nPhoto head count: ${headCount}\nReported present: ${reported}\n${diff !== 0 ? `Difference: ${diff > 0 ? '+' : ''}${diff} (within acceptable range)` : 'Exact match! 🎯'}\n\nThank you! 🎉`;
    }

    return { headCount, diff, flagged, message: reply };

  } catch(err) {
    console.log('photo handler error:', err.message);
    return { message: '📸 Photo received but could not process it. Please try again.' };
  }
}

// ── Serve photo from DB ───────────────────────────────────────────────────────
router.get('/api/photo/:feedbackId', async (req, res) => {
  try {
    const r = await db.pool.query(
      `SELECT photo_data, photo_mime_type, photo_expires_at, school_name FROM daily_feedback WHERE id=$1`,
      [req.params.feedbackId]
    );
    if (!r.rows.length) return res.status(404).send('Photo not found');
    const row = r.rows[0];

    if (!row.photo_data) {
      return res.status(410).send(`<html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#fef2f2">
        <p style="font-size:48px">🗑️</p><h2 style="color:#b91c1c">Photo Deleted</h2>
        <p style="color:#6b7280">Photo from <strong>${row.school_name||'this school'}</strong> was automatically deleted after 48 hours.</p>
      </body></html>`);
    }

    res.set({
      'Content-Type':      row.photo_mime_type || 'image/jpeg',
      'Cache-Control':     'private, max-age=3600',
      'X-Hours-Remaining': Math.max(0, Math.round((new Date(row.photo_expires_at) - Date.now()) / 3600000))
    });
    res.send(Buffer.from(row.photo_data, 'base64'));
  } catch(err) {
    console.log('photo serve error:', err.message);
    res.status(500).send('Error serving photo');
  }
});

// ── Photo list API ────────────────────────────────────────────────────────────
router.get('/api/photos', async (req, res) => {
  try {
    const { date, school } = req.query;
    const attDate = date || new Date().toISOString().split('T')[0];
    const params  = [attDate];
    let where     = 'WHERE df.report_date = $1::date';
    if (school) { params.push(school); where += ` AND df.school_identifier ILIKE $${params.length}`; }

    const r = await db.pool.query(`
      SELECT df.id, df.school_name, df.school_identifier,
             df.present, df.photo_head_count, df.head_count_diff,
             df.photo_verified, df.photo_flag, df.photo_url,
             df.photo_expires_at,
             (df.photo_data IS NOT NULL) AS photo_available,
             df.projector_visible, df.lesson_verified, df.created_at
      FROM daily_feedback df ${where}
      ORDER BY df.created_at DESC
    `, params);
    res.json({ date: attDate, photos: r.rows });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

module.exports = { router, handleClassPhoto };
