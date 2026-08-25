// reset-password.js
// One-time password reset for a platform_users account.
// Usage: node reset-password.js <username> <newPassword>
// Example: node reset-password.js shahid MyNewPass123!

require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./database');

async function main() {
  const [,, username, newPassword] = process.argv;

  if (!username || !newPassword) {
    console.error('Usage: node reset-password.js <username> <newPassword>');
    process.exit(1);
  }
  if (newPassword.length < 6) {
    console.error('Password should be at least 6 characters.');
    process.exit(1);
  }

  try {
    const hash = await bcrypt.hash(newPassword, 10);

    const result = await db.pool.query(
      `UPDATE platform_users
       SET password_hash = $1
       WHERE LOWER(username) = LOWER($2)
       RETURNING id, name, username, role`,
      [hash, username]
    );

    if (!result.rows.length) {
      console.error(`❌ No user found with username "${username}". Check /admin-users or run: SELECT username FROM platform_users;`);
      process.exit(1);
    }

    console.log('✅ Password reset for:', result.rows[0]);
    console.log('New password is:', newPassword);
    console.log('You can now log in at /login with this username and password.');
  } catch (err) {
    console.error('❌ Error:', err.message || err);
  } finally {
    process.exit(0);
  }
}

main();
