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
        ADD COLUMN IF NOT EXISTS photo_data      TEXT,
        ADD COLUMN IF NOT EXISTS photo_mime_type VARCHAR(50),
        ADD COLUMN IF NOT EXISTS photo_expires_at TIMESTAMPTZ
    `);
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
    if (r.rows.length > 0) {
      console.log(`🗑️ Auto-deleted ${r.rows.length} expired photo(s)`);
    }
  } catch(e) { console.log('photo cleanup error:', e.message); }
}

// Run cleanup on startup and every hour
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

    const imageBuffer = await imgResp.arrayBuffer();
    const imageBytes  = Buffer.from(imageBuffer);
    const imageBase64 = imageBytes.toString('base64');
    if (imageBase64.length < 1000) throw new Error('Downloaded content too small — likely not a real image');

    // Claude Vision API — head count + projector detection
    const apiResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5-20251101',
        max_tokens: 256,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mimeType || 'image/jpeg', data: imageBase64 }
            },
            {
              type: 'text',
              text: `You are analyzing a classroom photo from a school in rural Pakistan. Analyze carefully and return ONLY a JSON object:
{
  "head_count": <count ALL people - students and teachers>,
  "projector_visible": <true if you can see ANY of: projector device, projected image on wall/board, bright rectangle of light on a surface, whiteboard with projected content, or any projection equipment>,
  "screen_visible": <true if you can see a whiteboard, wall, or surface with projected or written content>,
  "content_on_screen": <true if whiteboard/wall shows any content - written, projected, or displayed>,
  "students_facing_screen": <true if students are sitting and facing toward a board or screen>,
  "confidence": "high|medium|low",
  "lesson_verified": <true if students are present AND (projector OR whiteboard with content is visible)>,
  "note": "<describe what you see>"
}
IMPORTANT: In Pakistani classrooms projectors are often small portable devices placed on boxes or tables. Look carefully for subtle projectors.`
            }
          ]
        }]
      })
    });

    const apiData = await apiResp.json();
    if (apiData.error) throw new Error('Vision API error: ' + apiData.error.message);
    const rawText = apiData.content?.[0]?.text || '';

    let headCount = null, confidence = 'medium', note = '';
    const visionResult = {};
    try {
      const cleaned   = rawText.replace(/```json|```/g, '').trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const raw    = parsed.head_count ?? parsed.count ?? parsed.number ?? parsed.total;
        headCount    = raw !== undefined ? parseInt(raw) : null;
        confidence   = parsed.confidence || 'medium';
        note         = parsed.note || '';
        visionResult.projector_visible      = parsed.projector_visible || false;
        visionResult.screen_visible         = parsed.screen_visible || false;
        visionResult.content_on_screen      = parsed.content_on_screen || false;
        visionResult.students_facing_screen = parsed.students_facing_screen || false;
        visionResult.lesson_verified        = parsed.lesson_verified || false;
      }
    } catch(e) {}

    if (headCount === null || isNaN(headCount)) {
      const numMatches = rawText.match(/\b(\d+)\b/g);
      if (numMatches) {
        for (const m of numMatches) {
          const n = parseInt(m);
          if (n >= 1 && n <= 200) { headCount = n; break; }
        }
      }
    }
    console.log(`📸 Head count: ${headCount} (${confidence}) — ${note}`);

    // Find most recent feedback from this teacher (last 24 hours)
    const phoneNorm = from.replace('whatsapp:', '');
    const fbRow = await db.pool.query(`
      SELECT id, present, school_name, school_identifier FROM daily_feedback
      WHERE (teacher_phone=$1 OR teacher_phone=$2 OR teacher_phone=$3)
        AND created_at > NOW() - INTERVAL '24 hours'
      ORDER BY created_at DESC LIMIT 1
    `, [from, phoneNorm, 'whatsapp:' + phoneNorm]);

    if (!fbRow.rows.length) {
      return { headCount, message: `📸 Photo received! Counted ${headCount} people.\n\nNo feedback report found for today to compare with. Please submit your daily report first.` };
    }

    const fb       = fbRow.rows[0];
    const reported = parseInt(fb.present) || 0;
    const diff     = headCount !== null ? headCount - reported : null;
    const absDiff  = diff !== null ? Math.abs(diff) : null;
    const pctDiff  = reported > 0 && diff !== null ? Math.round(Math.abs(diff)/reported*100) : null;
    const flagged  = absDiff !== null && absDiff > 3 && pctDiff > 15;
    const flag     = flagged
      ? (diff > 0 ? `Photo shows ${diff} MORE than reported` : `Photo shows ${Math.abs(diff)} FEWER than reported`)
      : null;

    // Photo URL now served from DB via route
    const publicUrl = `/api/photo/${fb.id}`;
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours from now

    await db.pool.query(`
      UPDATE daily_feedback SET
        photo_url=$1, photo_data=$2, photo_mime_type=$3, photo_expires_at=$4,
        photo_head_count=$5, head_count_diff=$6,
        photo_verified=$7, photo_flag=$8,
        projector_visible=$9, lesson_verified=$10
      WHERE id=$11
    `, [publicUrl, imageBase64, mimeType || 'image/jpeg', expiresAt,
        headCount, diff, !flagged, flag,
        visionResult.projector_visible || false,
        visionResult.lesson_verified || false,
        fb.id]);

    let reply;
    if (headCount === null) {
      reply = `📸 Photo received but couldn't count people clearly. Please send a clearer photo.`;
    } else if (flagged) {
      reply = `📸 Photo verified — ⚠️ MISMATCH DETECTED\n\nPhoto head count: ${headCount}\nReported present: ${reported}\nDifference: ${diff > 0 ? '+' : ''}${diff} (${pctDiff}%)\n\nYour coordinator has been notified.`;
      try {
        const coordRow = await db.pool.query(`
          SELECT sc.phone FROM schools s
          JOIN school_coordinators sc ON sc.id=s.school_coordinator_id
          WHERE s.identifier=(SELECT school_identifier FROM daily_feedback WHERE id=$1) LIMIT 1
        `, [fb.id]);
        if (coordRow.rows[0]?.phone) {
          await sendWhatsApp(coordRow.rows[0].phone,
            `⚠️ Attendance Mismatch — ${fb.school_name}\n\nPhoto count: ${headCount}\nReported: ${reported}\nDifference: ${diff > 0 ? '+' : ''}${diff}\n\nPlease follow up.\n\nView photo: https://takmil-bot-production-0f51.up.railway.app${publicUrl}`
          );
        }
      } catch(e) { console.log('coordinator notify error:', e.message); }
    } else {
      reply = `📸 Photo verified — ✅ MATCH\n\nPhoto head count: ${headCount}\nReported present: ${reported}\n${diff !== 0 ? `Difference: ${diff > 0 ? '+' : ''}${diff} (within acceptable range)` : 'Exact match!'}\n\nThank you! 🎉`;
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
      `SELECT photo_data, photo_mime_type, photo_expires_at, school_name
       FROM daily_feedback WHERE id=$1`,
      [req.params.feedbackId]
    );
    if (!r.rows.length) return res.status(404).send('Photo not found');

    const row = r.rows[0];
    if (!row.photo_data) {
      // Photo expired and was deleted
      return res.status(410).send(`
        <html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#fef2f2">
        <p style="font-size:48px">🗑️</p>
        <h2 style="color:#b91c1c">Photo Deleted</h2>
        <p style="color:#6b7280">This photo from <strong>${row.school_name||'unknown school'}</strong> has been automatically deleted after 48 hours.</p>
        </body></html>
      `);
    }

    const expiresAt = new Date(row.photo_expires_at);
    const hoursLeft = Math.max(0, Math.round((expiresAt - Date.now()) / 3600000));

    res.set({
      'Content-Type': row.photo_mime_type || 'image/jpeg',
      'Cache-Control': 'private, max-age=3600',
      'X-Photo-Expires': expiresAt.toISOString(),
      'X-Hours-Remaining': hoursLeft
    });
    res.send(Buffer.from(row.photo_data, 'base64'));
  } catch(err) {
    console.log('photo serve error:', err.message);
    res.status(500).send('Error serving photo');
  }
});

// ── Photo list API for admin dashboard ───────────────────────────────────────
router.get('/api/photos', async (req, res) => {
  try {
    const { date, school } = req.query;
    const attDate = date || new Date().toISOString().split('T')[0];
    let where = 'WHERE df.report_date=$1::date';
    const params = [attDate];
    if (school) { params.push(school); where += ` AND df.school_identifier ILIKE $${params.length}`; }

    const r = await db.pool.query(`
      SELECT df.id, df.school_name, df.school_identifier,
             df.present, df.photo_head_count, df.head_count_diff,
             df.photo_verified, df.photo_flag, df.photo_url,
             df.photo_expires_at,
             (df.photo_data IS NOT NULL) AS photo_available,
             df.projector_visible, df.lesson_verified, df.created_at
      FROM daily_feedback df
      ${where}
      ORDER BY df.created_at DESC
    `, params);
    res.json({ date: attDate, photos: r.rows });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

module.exports = { router, handleClassPhoto };


// ── Main photo handler (called from chatbot /webhook) ─────────────────────────
async function handleClassPhoto(from, mediaUrl, mimeType) {
  try {
    console.log(`📸 Downloading photo from Twilio: ${mediaUrl}`);
    const authHeader = 'Basic ' + Buffer.from(
      process.env.TWILIO_ACCOUNT_SID + ':' + process.env.TWILIO_AUTH_TOKEN
    ).toString('base64');

    const imgResp = await fetch(mediaUrl, { headers: { Authorization: authHeader } });
    if (!imgResp.ok) throw new Error(`Failed to download image: ${imgResp.status}`);

    const imageBuffer  = await imgResp.arrayBuffer();
    const imageBytes   = Buffer.from(imageBuffer);
    const imageBase64  = imageBytes.toString('base64');
    if (imageBase64.length < 1000) throw new Error('Downloaded content too small — likely not a real image');

    const ext      = mimeType.includes('png') ? 'png' : mimeType.includes('gif') ? 'gif' : 'jpg';
    const filename = `photo_${Date.now()}_${from.replace(/[^0-9]/g,'')}.${ext}`;
    const filepath = path.join(PHOTOS_DIR, filename);
    fs.writeFileSync(filepath, imageBytes);
    const publicUrl = `/photos/${filename}`;

    // Claude Vision API — head count + projector detection
    const apiResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5-20251101',
        max_tokens: 256,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mimeType || 'image/jpeg', data: imageBase64 }
            },
            {
              type: 'text',
              text: `You are analyzing a classroom photo from a school in rural Pakistan. Analyze carefully and return ONLY a JSON object:
{
  "head_count": <count ALL people - students and teachers>,
  "projector_visible": <true if you can see ANY of: projector device, projected image on wall/board, bright rectangle of light on a surface, whiteboard with projected content, or any projection equipment>,
  "screen_visible": <true if you can see a whiteboard, wall, or surface with projected or written content>,
  "content_on_screen": <true if whiteboard/wall shows any content - written, projected, or displayed>,
  "students_facing_screen": <true if students are sitting and facing toward a board or screen>,
  "confidence": "high|medium|low",
  "lesson_verified": <true if students are present AND (projector OR whiteboard with content is visible)>,
  "note": "<describe what you see>"
}
IMPORTANT: In Pakistani classrooms projectors are often small portable devices placed on boxes or tables. Look carefully for subtle projectors.`
            }
          ]
        }]
      })
    });

    const apiData = await apiResp.json();
    if (apiData.error) throw new Error('Vision API error: ' + apiData.error.message);
    const rawText = apiData.content?.[0]?.text || '';

    let headCount = null, confidence = 'medium', note = '';
    const visionResult = {};
    try {
      const cleaned   = rawText.replace(/```json|```/g, '').trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const raw    = parsed.head_count ?? parsed.count ?? parsed.number ?? parsed.total;
        headCount    = raw !== undefined ? parseInt(raw) : null;
        confidence   = parsed.confidence || 'medium';
        note         = parsed.note || '';
        visionResult.projector_visible      = parsed.projector_visible || false;
        visionResult.screen_visible         = parsed.screen_visible || false;
        visionResult.content_on_screen      = parsed.content_on_screen || false;
        visionResult.students_facing_screen = parsed.students_facing_screen || false;
        visionResult.lesson_verified        = parsed.lesson_verified || false;
      }
    } catch(e) {}

    if (headCount === null || isNaN(headCount)) {
      const numMatches = rawText.match(/\b(\d+)\b/g);
      if (numMatches) {
        for (const m of numMatches) {
          const n = parseInt(m);
          if (n >= 1 && n <= 200) { headCount = n; break; }
        }
      }
    }
    console.log(`📸 Head count: ${headCount} (${confidence}) — ${note}`);

    // Find most recent feedback from this teacher (last 24 hours)
    const phoneNorm = from.replace('whatsapp:', '');
    const fbRow = await db.pool.query(`
      SELECT id, present, school_name, school_identifier FROM daily_feedback
      WHERE (teacher_phone=$1 OR teacher_phone=$2 OR teacher_phone=$3)
        AND created_at > NOW() - INTERVAL '24 hours'
      ORDER BY created_at DESC LIMIT 1
    `, [from, phoneNorm, 'whatsapp:' + phoneNorm]);

    if (!fbRow.rows.length) {
      return { headCount, message: `📸 Photo received! Counted ${headCount} people.\n\nNo feedback report found for today to compare with. Please submit your daily report first.` };
    }

    const fb       = fbRow.rows[0];
    const reported = parseInt(fb.present) || 0;
    const diff     = headCount !== null ? headCount - reported : null;
    const absDiff  = diff !== null ? Math.abs(diff) : null;
    const pctDiff  = reported > 0 && diff !== null ? Math.round(Math.abs(diff)/reported*100) : null;
    const flagged  = absDiff !== null && absDiff > 3 && pctDiff > 15;
    const flag     = flagged
      ? (diff > 0 ? `Photo shows ${diff} MORE than reported` : `Photo shows ${Math.abs(diff)} FEWER than reported`)
      : null;

    await db.pool.query(`
      UPDATE daily_feedback SET
        photo_url=$1, photo_head_count=$2, head_count_diff=$3,
        photo_verified=$4, photo_flag=$5, projector_visible=$6, lesson_verified=$7
      WHERE id=$8
    `, [publicUrl, headCount, diff, !flagged, flag,
        visionResult.projector_visible || false,
        visionResult.lesson_verified || false,
        fb.id]);

    let reply;
    if (headCount === null) {
      reply = `📸 Photo received but couldn't count people clearly. Please send a clearer photo.`;
    } else if (flagged) {
      reply = `📸 Photo verified — ⚠️ MISMATCH DETECTED\n\nPhoto head count: ${headCount}\nReported present: ${reported}\nDifference: ${diff > 0 ? '+' : ''}${diff} (${pctDiff}%)\n\nYour coordinator has been notified.`;
      try {
        const coordRow = await db.pool.query(`
          SELECT sc.phone FROM schools s
          JOIN school_coordinators sc ON sc.id=s.school_coordinator_id
          WHERE s.identifier=(SELECT school_identifier FROM daily_feedback WHERE id=$1) LIMIT 1
        `, [fb.id]);
        if (coordRow.rows[0]?.phone) {
          await sendWhatsApp(coordRow.rows[0].phone,
            `⚠️ Attendance Mismatch — ${fb.school_name}\n\nPhoto count: ${headCount}\nReported: ${reported}\nDifference: ${diff > 0 ? '+' : ''}${diff}\n\nPlease follow up.`
          );
        }
      } catch(e) { console.log('coordinator notify error:', e.message); }
    } else {
      reply = `📸 Photo verified — ✅ MATCH\n\nPhoto head count: ${headCount}\nReported present: ${reported}\n${diff !== 0 ? `Difference: ${diff > 0 ? '+' : ''}${diff} (within acceptable range)` : 'Exact match!'}\n\nThank you! 🎉`;
    }

    return { headCount, diff, flagged, message: reply };
  } catch(err) {
    console.log('photo handler error:', err.message);
    return { message: '📸 Photo received but could not process it. Please try again.' };
  }
}

// ── Photo API for admin dashboard ─────────────────────────────────────────────
router.get('/api/photos', async (req, res) => {
  try {
    const { date, school } = req.query;
    const attDate = date || new Date().toISOString().split('T')[0];
    let where = 'WHERE df.report_date=$1';
    const params = [attDate];
    if (school) { params.push(school); where += ` AND df.school_identifier ILIKE $${params.length}`; }

    const r = await db.pool.query(`
      SELECT df.id, df.school_name, df.school_identifier,
             df.present, df.photo_head_count, df.head_count_diff,
             df.photo_verified, df.photo_flag, df.photo_url,
             df.projector_visible, df.lesson_verified, df.created_at
      FROM daily_feedback df
      ${where}
      ORDER BY df.created_at DESC
    `, params);
    res.json({ date: attDate, photos: r.rows });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

module.exports = { router, handleClassPhoto };
