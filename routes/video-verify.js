// routes/video-verify.js — Video Verification (WhatsApp daily session workflow)
// Facilitator submits video codes → Coordinator approves → Regional oversight

const router = require('express').Router();
const db     = require('../database');
const path   = require('path');
const { sendWA } = require('../helpers/whatsapp');

// NOTE: This module uses db.pool directly. The original code referenced
// a bare `pool` — that has been updated to db.pool throughout.

// ── Helper utilities ──────────────────────────────────────────────────────────
function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
    h |= 0;
  }
  return (Math.abs(h) % 900000 + 100000).toString();
}

function todayDateStr() {
  const n = new Date();
  return n.getFullYear() + '-' +
    String(n.getMonth() + 1).padStart(2, '0') + '-' +
    String(n.getDate()).padStart(2, '0');
}

// ── Role help messages ────────────────────────────────────────────────────────
function getRoleHelp(role) {
  const helps = {
    facilitator:
      `📱 *Facilitator Commands*\n\n` +
      `DAILY SCH-047 CODE1 CODE2 CODE3\n  Submit today's 3 video codes\n\n` +
      `MY STATUS\n  Check your school's progress\n\n` +
      `ROLE [name]\n  Switch role (for testing)`,

    coordinator:
      `📋 *Coordinator Commands*\n\n` +
      `APPROVE SCH-047\n  Approve today's session\n\n` +
      `REJECT SCH-047 [reason]\n  Reject with reason\n\n` +
      `STATUS SCH-047\n  Check one school's status\n\n` +
      `MY SCHOOLS\n  See all 10 schools today\n\n` +
      `UNLOCK ASSESS SCH-047\n  Release assessment PIN (when section complete)\n\n` +
      `ROLE [name]\n  Switch role`,

    regional:
      `🗺️ *Regional Coordinator Commands*\n\n` +
      `REGION STATUS\n  See all schools in your region\n\n` +
      `ROLE [name]\n  Switch role`,

    admin:
      `🏢 *Admin Commands*\n\n` +
      `ADMIN STATUS\n  Full system overview\n\n` +
      `RESET TEST\n  Reset SCH-047 test data\n\n` +
      `ROLE [name]\n  Switch role`
  };
  return helps[role] || `Send HELP after switching role.`;
}

// ── Get active role for a phone ───────────────────────────────────────────────
async function getActiveRole(phone) {
  const roleRow = await db.pool.query(
    `SELECT DISTINCT active_role FROM user_roles WHERE phone=$1 LIMIT 1`, [phone]
  );
  if (!roleRow.rows.length) return null;
  const activeRole = roleRow.rows[0].active_role;
  const entityRow = await db.pool.query(
    `SELECT entity_code, name FROM user_roles WHERE phone=$1 AND role=$2 LIMIT 1`,
    [phone, activeRole]
  );
  return entityRow.rows.length ? { role: activeRole, ...entityRow.rows[0] } : null;
}

// ── Main WhatsApp command handler (called from chatbot webhook) ───────────────
async function handleVideoCommands(from, msgBody, twilioRes) {
  const msg   = msgBody.trim();
  const upper = msg.toUpperCase();

  // ROLE SWITCH
  if (upper.startsWith('ROLE ')) {
    const newRole   = upper.split(' ')[1]?.toLowerCase();
    const validRoles= ['facilitator', 'coordinator', 'regional', 'admin'];
    if (!validRoles.includes(newRole)) {
      await sendWA(from, `❌ Unknown role.\n\nValid roles:\nROLE FACILITATOR\nROLE COORDINATOR\nROLE REGIONAL\nROLE ADMIN`);
      return true;
    }
    const check = await db.pool.query(
      `SELECT entity_code, name FROM user_roles WHERE phone=$1 AND role=$2`, [from, newRole]
    );
    if (!check.rows.length) {
      await sendWA(from, `❌ Your phone is not registered as ${newRole.toUpperCase()}.`);
      return true;
    }
    await db.pool.query(`UPDATE user_roles SET active_role=$1, updated_at=NOW() WHERE phone=$2`, [newRole, from]);
    const { entity_code, name } = check.rows[0];
    await sendWA(from,
      `✅ Role switched to: *${newRole.toUpperCase()}*\nName: ${name}\nEntity: ${entity_code}\n\n` + getRoleHelp(newRole)
    );
    return true;
  }

  // WHOAMI
  if (upper === 'WHOAMI' || upper === 'WHO AM I') {
    const r = await getActiveRole(from);
    if (!r) { await sendWA(from, `❓ You are not registered. Contact admin.`); return true; }
    await sendWA(from,
      `👤 You are currently acting as:\n*${r.role.toUpperCase()}*\n${r.name} | ${r.entity_code}\n\n` + getRoleHelp(r.role)
    );
    return true;
  }

  const roleInfo = await getActiveRole(from);
  if (!roleInfo) return false;

  // ── FACILITATOR COMMANDS ──────────────────────────────────────────
  if (roleInfo.role === 'facilitator') {

    if (upper.startsWith('DAILY ')) {
      const parts = msg.split(' ').filter(p => p.trim());
      if (parts.length < 5) {
        await sendWA(from, `❌ Wrong format.\n\nSend:\nDAILY SCH-047 CODE1 CODE2 CODE3\n\nExample:\nDAILY SCH-047 847293 563821 192847`);
        return true;
      }
      const schoolCode = parts[1].toUpperCase();
      const codes   = [parts[2], parts[3], parts[4]];
      const dateStr = todayDateStr();

      const school = await db.pool.query(`SELECT * FROM schools WHERE school_code=$1`, [schoolCode]);
      if (!school.rows.length) { await sendWA(from, `❌ School ${schoolCode} not found.`); return true; }

      const section = await db.pool.query(
        `SELECT sc.*, s.title FROM section_completions sc
         JOIN sections s ON s.section_code=sc.section_code
         WHERE sc.school_code=$1 AND sc.status='in_progress' ORDER BY sc.id DESC LIMIT 1`, [schoolCode]
      );
      if (!section.rows.length) { await sendWA(from, `❌ No active section found for ${schoolCode}. Contact coordinator.`); return true; }
      const sec = section.rows[0];

      const existing = await db.pool.query(
        `SELECT id, status FROM daily_sessions WHERE school_code=$1 AND session_date=$2`, [schoolCode, dateStr]
      );
      if (existing.rows.length && existing.rows[0].status !== 'rejected') {
        const st = existing.rows[0].status;
        await sendWA(from, st === 'approved'
          ? `✅ Today's session for ${schoolCode} is already APPROVED. Well done!`
          : `⏳ Already submitted for today. Awaiting coordinator approval.`
        );
        return true;
      }

      const q = existing.rows.length
        ? `UPDATE daily_sessions SET v1_code=$1,v2_code=$2,v3_code=$3,status='pending',submitted_at=NOW(),submitted_by=$4,topic=$5,section_code=$6 WHERE school_code=$7 AND session_date=$8`
        : `INSERT INTO daily_sessions (school_code,section_code,session_date,topic,v1_code,v2_code,v3_code,submitted_at,submitted_by,status) VALUES ($7,$6,$8,$5,$1,$2,$3,NOW(),$4,'pending')`;

      await db.pool.query(q, [codes[0], codes[1], codes[2], roleInfo.name, sec.title, sec.section_code, schoolCode, dateStr]);

      await sendWA(from,
        `✅ Daily report received!\n\nSchool: ${schoolCode}\nTopic: ${sec.title}\nDate: ${dateStr}\nCodes: ${codes.join(' | ')}\n\n⏳ Awaiting coordinator approval.`
      );

      const coordPhone = school.rows[0].coordinator_phone;
      if (coordPhone && coordPhone !== from) {
        await sendWA(coordPhone,
          `📋 *New daily report — ${schoolCode}*\nTopic: ${sec.title} | Date: ${dateStr}\nCodes: ${codes.join(' ')}\n\nReply:\nAPPROVE ${schoolCode}\nREJECT ${schoolCode} [reason]`
        );
      } else {
        await sendWA(from, `\n📌 *[TEST MODE — Switch to COORDINATOR role to approve]*\nSend: ROLE COORDINATOR\nThen: APPROVE ${schoolCode}`);
      }
      return true;
    }

    if (upper === 'MY STATUS' || upper.startsWith('STATUS SCH')) {
      const schoolCode = upper.includes('SCH') ? upper.split(' ')[1] : roleInfo.entity_code;
      const sc = await db.pool.query(
        `SELECT sc.approved_days, sc.total_days, sc.status, s.title
         FROM section_completions sc JOIN sections s ON s.section_code=sc.section_code
         WHERE sc.school_code=$1 AND sc.status IN ('in_progress','complete','assessment_unlocked') LIMIT 1`, [schoolCode]
      );
      if (!sc.rows.length) { await sendWA(from, `No active section found for ${schoolCode}.`); return true; }
      const r   = sc.rows[0];
      const pct = Math.round((r.approved_days / r.total_days) * 100);
      const bar = '█'.repeat(Math.floor(pct/10)) + '░'.repeat(10-Math.floor(pct/10));
      await sendWA(from, `📊 *${schoolCode} Progress*\nSection: ${r.title}\n${bar} ${pct}%\nDays approved: ${r.approved_days} / ${r.total_days}\nStatus: ${r.status.toUpperCase()}`);
      return true;
    }

    if (upper === 'HELP' || upper === '?') { await sendWA(from, getRoleHelp('facilitator')); return true; }
  }

  // ── COORDINATOR COMMANDS ──────────────────────────────────────────
  if (roleInfo.role === 'coordinator') {

    if (upper.startsWith('APPROVE ')) {
      const schoolCode = upper.split(' ')[1];
      const dateStr    = todayDateStr();

      const session = await db.pool.query(
        `SELECT * FROM daily_sessions WHERE school_code=$1 AND session_date=$2`, [schoolCode, dateStr]
      );
      if (!session.rows.length) { await sendWA(from, `❌ No submission found today for ${schoolCode}.`); return true; }
      if (session.rows[0].status === 'approved') { await sendWA(from, `✅ ${schoolCode} already approved today.`); return true; }

      await db.pool.query(`UPDATE daily_sessions SET status='approved', approved_by=$1, approved_at=NOW() WHERE school_code=$2 AND session_date=$3`, [from, schoolCode, dateStr]);

      const updated = await db.pool.query(
        `UPDATE section_completions
         SET approved_days=approved_days+1,
             status=CASE WHEN approved_days+1>=total_days THEN 'complete' ELSE status END,
             completed_at=CASE WHEN approved_days+1>=total_days THEN NOW() ELSE completed_at END
         WHERE school_code=$1 AND status='in_progress'
         RETURNING approved_days, total_days, status, section_code`, [schoolCode]
      );

      const sc  = updated.rows[0];
      const pct = Math.round((sc.approved_days / sc.total_days) * 100);
      const bar = '█'.repeat(Math.floor(pct/10)) + '░'.repeat(10-Math.floor(pct/10));
      let reply = `✅ *APPROVED* — ${schoolCode}\nDate: ${dateStr}\n${bar} ${pct}%\nSection progress: ${sc.approved_days}/${sc.total_days} days\n`;
      if (sc.status === 'complete') {
        reply += `\n🎉 *SECTION COMPLETE!*\nAll ${sc.total_days} days approved.\nSend: UNLOCK ASSESS ${schoolCode}\nto release the assessment PIN.`;
      }
      await sendWA(from, reply);

      const school = await db.pool.query(`SELECT facilitator_phone FROM schools WHERE school_code=$1`, [schoolCode]);
      if (school.rows.length && school.rows[0].facilitator_phone !== from) {
        await sendWA(school.rows[0].facilitator_phone, `✅ Today's session APPROVED by coordinator!\n${schoolCode} | Day ${sc.approved_days}/${sc.total_days}`);
      } else {
        await sendWA(from, `\n📌 *[TEST MODE]* Facilitator would receive approval notification.`);
      }
      return true;
    }

    if (upper.startsWith('REJECT ')) {
      const parts      = msg.split(' ');
      const schoolCode = parts[1].toUpperCase();
      const reason     = parts.slice(2).join(' ') || 'No reason given';
      const dateStr    = todayDateStr();
      await db.pool.query(`UPDATE daily_sessions SET status='rejected', reject_reason=$1, approved_by=$2, approved_at=NOW() WHERE school_code=$3 AND session_date=$4`, [reason, from, schoolCode, dateStr]);
      await sendWA(from, `❌ Rejected ${schoolCode}. Reason: ${reason}`);
      const school = await db.pool.query(`SELECT facilitator_phone FROM schools WHERE school_code=$1`, [schoolCode]);
      if (school.rows.length && school.rows[0].facilitator_phone !== from) {
        await sendWA(school.rows[0].facilitator_phone, `❌ Today's session was REJECTED.\nSchool: ${schoolCode}\nReason: ${reason}\n\nPlease resubmit today.`);
      } else {
        await sendWA(from, `\n📌 *[TEST MODE]* Facilitator would receive rejection: "${reason}"`);
      }
      return true;
    }

    if (upper.startsWith('STATUS ')) {
      const schoolCode = upper.split(' ')[1];
      const sessions   = await db.pool.query(
        `SELECT session_date, status, v1_code, v2_code, v3_code, submitted_at FROM daily_sessions WHERE school_code=$1 ORDER BY session_date DESC LIMIT 7`, [schoolCode]
      );
      const sc = await db.pool.query(
        `SELECT sc.approved_days, sc.total_days, sc.status, s.title
         FROM section_completions sc JOIN sections s ON s.section_code=sc.section_code
         WHERE sc.school_code=$1 LIMIT 1`, [schoolCode]
      );
      if (!sc.rows.length) { await sendWA(from, `No data for ${schoolCode}`); return true; }
      const r = sc.rows[0];
      let reply = `📊 *${schoolCode} Status*\nSection: ${r.title}\nDays approved: ${r.approved_days}/${r.total_days}\n\nLast 7 days:\n`;
      sessions.rows.forEach(s => {
        const icon = s.status==='approved'?'✅':s.status==='rejected'?'❌':'⏳';
        reply += `${icon} ${s.session_date} — ${s.status}\n`;
      });
      await sendWA(from, reply);
      return true;
    }

    if (upper === 'MY SCHOOLS' || upper === 'SCHOOLS') {
      const rows = await db.pool.query(
        `SELECT sc.school_code, sc.approved_days, sc.total_days, sc.status, ds.status as today_status
         FROM section_completions sc
         LEFT JOIN daily_sessions ds ON ds.school_code=sc.school_code AND ds.session_date=CURRENT_DATE
         WHERE sc.status IN ('in_progress','complete') ORDER BY sc.school_code`
      );
      let reply = `📋 *My Schools — ${todayDateStr()}*\n\n`;
      rows.rows.forEach(r => {
        const today = r.today_status==='approved'?'✅':r.today_status==='pending'?'⏳':r.today_status==='rejected'?'❌':'○';
        const pct = Math.round((r.approved_days/r.total_days)*100);
        reply += `${today} ${r.school_code}: ${r.approved_days}/${r.total_days} days (${pct}%)\n`;
      });
      reply += `\nLegend: ✅ today approved  ⏳ pending  ❌ rejected  ○ not submitted`;
      await sendWA(from, reply);
      return true;
    }

    if (upper.startsWith('UNLOCK ASSESS ') || upper.startsWith('UNLOCK ')) {
      const schoolCode = upper.split(' ').pop();
      const sc = await db.pool.query(`SELECT * FROM section_completions WHERE school_code=$1 AND status='complete'`, [schoolCode]);
      if (!sc.rows.length) {
        const prog = await db.pool.query(`SELECT approved_days, total_days FROM section_completions WHERE school_code=$1`, [schoolCode]);
        if (prog.rows.length) {
          const r = prog.rows[0];
          await sendWA(from, `❌ Cannot unlock yet.\n${schoolCode} has only ${r.approved_days}/${r.total_days} days approved.\nAll days must be coordinator-approved before assessment is released.`);
        } else {
          await sendWA(from, `❌ No active section found for ${schoolCode}.`);
        }
        return true;
      }

      const pinResult = await db.pool.query(
        `SELECT pin FROM pins WHERE school_id=(SELECT id FROM schools WHERE school_code=$1) AND subject='Math' AND is_used=FALSE LIMIT 1`, [schoolCode]
      );
      let pin = pinResult.rows.length ? pinResult.rows[0].pin : Math.floor(100000 + Math.random() * 900000).toString();

      await db.pool.query(
        `UPDATE section_completions SET status='assessment_unlocked', assessment_pin=$1, pin_sent_at=NOW() WHERE school_code=$2 AND status='complete'`, [pin, schoolCode]
      );

      await sendWA(from, `🎉 *Assessment UNLOCKED — ${schoolCode}*\n\nPIN: *${pin}*\nPortal: https://takmil-bot-production-0f51.up.railway.app/level5\n\nFacilitator has been notified.`);

      const school = await db.pool.query(`SELECT facilitator_phone FROM schools WHERE school_code=$1`, [schoolCode]);
      if (school.rows.length && school.rows[0].facilitator_phone !== from) {
        await sendWA(school.rows[0].facilitator_phone, `🎉 Assessment is ready!\n\nPIN: *${pin}*\nOpen: https://takmil-bot-production-0f51.up.railway.app/level5\n\nGet students on tablets and begin!`);
      } else {
        await sendWA(from, `\n📌 *[TEST MODE]* Facilitator would receive PIN: ${pin}`);
      }
      return true;
    }

    if (upper === 'HELP' || upper === '?') { await sendWA(from, getRoleHelp('coordinator')); return true; }
  }

  // ── REGIONAL COORDINATOR COMMANDS ────────────────────────────────
  if (roleInfo.role === 'regional') {
    if (upper === 'REGION STATUS' || upper === 'STATUS') {
      const rows = await db.pool.query(
        `SELECT sc.school_code, sc.approved_days, sc.total_days,
                ROUND(sc.approved_days::numeric/sc.total_days*100) as pct,
                COUNT(CASE WHEN ds.status='approved' AND ds.session_date=CURRENT_DATE THEN 1 END) as today_ok
         FROM section_completions sc
         LEFT JOIN daily_sessions ds ON ds.school_code=sc.school_code
         WHERE sc.status IN ('in_progress','complete','assessment_unlocked')
         GROUP BY sc.school_code,sc.approved_days,sc.total_days ORDER BY pct ASC`
      );
      const total   = rows.rows.length;
      const onTrack = rows.rows.filter(r => r.pct >= 80).length;
      const today   = rows.rows.filter(r => parseInt(r.today_ok) > 0).length;
      let reply = `📊 *Regional Status — ${todayDateStr()}*\nSchools: ${total} | On track: ${onTrack} | Submitted today: ${today}\n\nBottom 5 schools:\n`;
      rows.rows.slice(0, 5).forEach(r => {
        reply += `⚠ ${r.school_code}: ${r.approved_days}/${r.total_days} (${r.pct}%)\n`;
      });
      await sendWA(from, reply);
      return true;
    }
    if (upper === 'HELP' || upper === '?') { await sendWA(from, getRoleHelp('regional')); return true; }
  }

  // ── ADMIN COMMANDS ─────────────────────────────────────────────────
  if (roleInfo.role === 'admin') {
    if (upper === 'ADMIN STATUS' || upper === 'STATUS ALL') {
      const total    = await db.pool.query(`SELECT COUNT(*) as c FROM schools`);
      const sections = await db.pool.query(`SELECT status, COUNT(*) as c FROM section_completions GROUP BY status`);
      const today    = await db.pool.query(`SELECT status, COUNT(*) as c FROM daily_sessions WHERE session_date=CURRENT_DATE GROUP BY status`);
      let reply = `🏢 *Admin Overview — ${todayDateStr()}*\nTotal schools: ${total.rows[0]?.c || 0}\n\nSection status:\n`;
      sections.rows.forEach(r => reply += `  ${r.status}: ${r.c}\n`);
      reply += `\nToday's submissions:\n`;
      today.rows.forEach(r => reply += `  ${r.status}: ${r.c}\n`);
      reply += `\nPower BI: https://app.powerbi.com (full dashboard)`;
      await sendWA(from, reply);
      return true;
    }

    if (upper === 'RESET TEST') {
      await db.pool.query(`DELETE FROM daily_sessions WHERE school_code='SCH-047' AND session_date=CURRENT_DATE`);
      await db.pool.query(`UPDATE section_completions SET approved_days=0, status='in_progress', completed_at=NULL, assessment_pin=NULL WHERE school_code='SCH-047'`);
      await sendWA(from, `🔄 Test data reset for SCH-047. You can run the full test again.`);
      return true;
    }
    if (upper === 'HELP' || upper === '?') { await sendWA(from, getRoleHelp('admin')); return true; }
  }

  return false;
}

// ── Ops console page ──────────────────────────────────────────────────────────
router.get('/console', (req, res) => res.sendFile(path.join(__dirname, '../takmil-ops-console.html')));
router.get('/health',  (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

router.get('/admin/session-status', async (req, res) => {
  try {
    const school = req.query.school || 'SCH-047';
    const sc     = await db.pool.query(
      `SELECT sc.approved_days, sc.total_days, sc.status, s.title as section_title
       FROM section_completions sc JOIN sections s ON s.section_code=sc.section_code
       WHERE sc.school_code=$1 ORDER BY sc.id DESC LIMIT 1`, [school]
    );
    const today       = await db.pool.query(`SELECT status FROM daily_sessions WHERE school_code=$1 AND session_date=CURRENT_DATE`, [school]);
    const sysTotal    = await db.pool.query(`SELECT COUNT(*) as c FROM schools`);
    const sysActive   = await db.pool.query(`SELECT COUNT(*) as c FROM section_completions WHERE status IN ('in_progress','complete')`);
    const sysTodaySub = await db.pool.query(`SELECT COUNT(*) as c FROM daily_sessions WHERE session_date=CURRENT_DATE`);
    const sysUnlocked = await db.pool.query(`SELECT COUNT(*) as c FROM section_completions WHERE status='assessment_unlocked'`);
    res.json({
      school_code: school,
      approved_days: sc.rows[0]?.approved_days ?? 0,
      total_days: sc.rows[0]?.total_days ?? 0,
      status: sc.rows[0]?.status ?? 'no_section',
      section_title: sc.rows[0]?.section_title ?? '—',
      today_status: today.rows[0]?.status ?? null,
      system: {
        total_schools: sysTotal.rows[0]?.c ?? 0,
        active_sections: sysActive.rows[0]?.c ?? 0,
        today_submitted: sysTodaySub.rows[0]?.c ?? 0,
        unlocked: sysUnlocked.rows[0]?.c ?? 0,
      }
    });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

module.exports = { router, handleVideoCommands };
