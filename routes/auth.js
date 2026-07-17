// routes/auth.js - Login/logout and admin user management
// --------------------------------------------------------------------------
const express = require('express');
const router  = express.Router();
const path    = require('path');
const db      = require('../database');
const {
  hashPassword, verifyPassword, issueToken,
  setSessionCookie, clearSessionCookie, requireRole,
} = require('../helpers/auth');

// -- Login page --------------------------------------------------------------
router.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'login.html'));
});

// -- POST /api/auth/login ----------------------------------------------------
router.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    const r = await db.pool.query(
      'SELECT * FROM platform_users WHERE LOWER(username) = LOWER($1) AND active = TRUE',
      [username.trim()]
    );
    const user = r.rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid username or password' });

    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid username or password' });

    await db.pool.query('UPDATE platform_users SET last_login = NOW() WHERE id = $1', [user.id]);

    const token = issueToken(user);
    setSessionCookie(res, token);

    // Tell the frontend where to send the user based on their role
    const redirectTo = user.role === 'admin' ? '/hub' : '/coordinator';
    res.json({
      success: true,
      redirectTo,
      user: { id: user.id, name: user.name, role: user.role, linked_name: user.linked_name },
    });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// -- POST /api/auth/logout ---------------------------------------------------
router.post('/api/auth/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ success: true });
});

// -- GET /api/auth/me --------------------------------------------------------
// Used by pages to check who's logged in and render role-appropriate UI.
const { requireAuth } = require('../helpers/auth');
router.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// ==========================================================================
// Admin-only user management
// ==========================================================================

router.get('/admin-users', requireRole(['admin']), (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'admin-users.html'));
});

// List all users
router.get('/api/admin/users', requireRole(['admin']), async (req, res) => {
  try {
    const r = await db.pool.query(`
      SELECT id, name, username, role, linked_name, active, created_at, last_login
      FROM platform_users ORDER BY role, name
    `);
    res.json({ users: r.rows });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Create a user
router.post('/api/admin/users', requireRole(['admin']), async (req, res) => {
  try {
    const { name, username, password, role, linked_name } = req.body;
    if (!name || !username || !password || !role) {
      return res.status(400).json({ error: 'name, username, password, and role are required' });
    }
    if (!['admin','regional_coordinator','coordinator'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    if (role !== 'admin' && !linked_name) {
      return res.status(400).json({ error: 'linked_name is required for regional_coordinator and coordinator roles (must match their name in the roster)' });
    }
    const password_hash = await hashPassword(password);
    const r = await db.pool.query(`
      INSERT INTO platform_users (name, username, password_hash, role, linked_name, created_by)
      VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING id, name, username, role, linked_name, active, created_at
    `, [name.trim(), username.trim(), password_hash, role, linked_name || null, req.user.id]);
    res.json({ success: true, user: r.rows[0] });
  } catch(err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Username already exists' });
    res.status(500).json({ error: err.message });
  }
});

// Edit a user (name, role, linked_name, active - password optional)
router.put('/api/admin/users/:id', requireRole(['admin']), async (req, res) => {
  try {
    const { name, role, linked_name, active, password } = req.body;
    if (role && !['admin','regional_coordinator','coordinator'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    if (password) {
      const password_hash = await hashPassword(password);
      await db.pool.query(
        'UPDATE platform_users SET password_hash=$1 WHERE id=$2',
        [password_hash, req.params.id]
      );
    }
    const r = await db.pool.query(`
      UPDATE platform_users
      SET name=COALESCE($1,name), role=COALESCE($2,role),
          linked_name=$3, active=COALESCE($4,active)
      WHERE id=$5
      RETURNING id, name, username, role, linked_name, active
    `, [name || null, role || null, linked_name || null, active !== undefined ? active : null, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'User not found' });
    res.json({ success: true, user: r.rows[0] });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Delete a user
router.delete('/api/admin/users/:id', requireRole(['admin']), async (req, res) => {
  try {
    if (parseInt(req.params.id) === req.user.id) {
      return res.status(400).json({ error: "You can't delete your own account while logged in as it." });
    }
    await db.pool.query('DELETE FROM platform_users WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Helper for the admin-users page: distinct RC/coordinator names from the
// roster, so an admin can pick a valid linked_name instead of typing freely
router.get('/api/admin/roster-names', requireRole(['admin']), async (req, res) => {
  try {
    const rcs = await db.pool.query(`
      SELECT DISTINCT regional_coordinator AS name FROM students_register
      WHERE active = true AND regional_coordinator IS NOT NULL AND regional_coordinator != ''
      ORDER BY name
    `);
    const coords = await db.pool.query(`
      SELECT DISTINCT school_coordinator AS name FROM students_register
      WHERE active = true AND school_coordinator IS NOT NULL AND school_coordinator != ''
      ORDER BY name
    `);
    res.json({
      regionalCoordinators: rcs.rows.map(r => r.name),
      coordinators: coords.rows.map(r => r.name),
    });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

module.exports = { router };
