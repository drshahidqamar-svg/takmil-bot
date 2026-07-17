// scripts/create-first-admin.js
// ──────────────────────────────────────────────────────────────────────────
// One-time bootstrap script to create your FIRST admin account.
// Run this once, locally, after deploying the auth system:
//
//   node scripts/create-first-admin.js "Your Name" your_username your_password
//
// After this, log in at /login and use the "Manage Users" page in the hub
// to create every other account (RCs, coordinators, additional admins) —
// you won't need this script again.
// ──────────────────────────────────────────────────────────────────────────
require('dotenv').config();
const db = require('../database');
const { hashPassword } = require('../helpers/auth');

async function main() {
  const [name, username, password] = process.argv.slice(2);
  if (!name || !username || !password) {
    console.error('Usage: node scripts/create-first-admin.js "Full Name" username password');
    process.exit(1);
  }

  const password_hash = await hashPassword(password);

  try {
    const existing = await db.pool.query('SELECT id FROM platform_users WHERE LOWER(username) = LOWER($1)', [username]);
    if (existing.rows.length) {
      console.error(`❌ A user with username "${username}" already exists. Use the Manage Users page to edit them instead.`);
      process.exit(1);
    }

    const r = await db.pool.query(`
      INSERT INTO platform_users (name, username, password_hash, role, linked_name)
      VALUES ($1, $2, $3, 'admin', NULL)
      RETURNING id, name, username, role
    `, [name, username, password_hash]);

    console.log('✅ Admin account created:', r.rows[0]);
    console.log('   You can now log in at /login with this username and password.');
  } catch(err) {
    console.error('❌ Failed to create admin:', err.message);
    process.exit(1);
  } finally {
    await db.pool.end();
  }
}

main();
