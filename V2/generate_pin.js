#!/usr/bin/env node
/**
 * TAKMIL PIN Generator — run this to create PINs for schools
 * Usage: node generate_pin.js
 *
 * Or via REST API:
 * POST /admin/pins/generate
 * Body: { schoolId, level, subject, cohortSize, issuedBy }
 */

require('dotenv').config();
const db = require('./database');
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(resolve => rl.question(q, resolve));

async function main() {
  console.log('\n🔑 TAKMIL PIN Generator\n');

  try {
    // List schools
    const schools = await db.pool.query('SELECT * FROM schools ORDER BY id');
    if (!schools.rows.length) {
      console.log('⚠️  No schools found. Create one first via POST /admin/schools');
      process.exit(1);
    }

    console.log('Available Schools:');
    schools.rows.forEach(s => console.log(`  ${s.id}. ${s.name} (${s.province || 'N/A'})`));

    const schoolIdStr = await ask('\nEnter school ID: ');
    const schoolId = parseInt(schoolIdStr);
    const school = schools.rows.find(s => s.id === schoolId);
    if (!school) { console.log('Invalid school ID'); process.exit(1); }

    const levelStr = await ask('Enter level (1-12): ');
    const level = parseInt(levelStr);
    if (level < 1 || level > 12) { console.log('Level must be 1-12'); process.exit(1); }

    const subject = await ask('Enter subject (Math/English/Urdu): ');
    if (!['Math', 'English', 'Urdu'].includes(subject)) {
      console.log('Subject must be Math, English, or Urdu'); process.exit(1);
    }

    const cohortStr = await ask('Enter cohort size (number of students being assessed): ');
    const cohortSize = parseInt(cohortStr) || 0;

    const issuedBy = await ask('Your name (PIN issuer): ');

    const pin = await db.generatePin(schoolId, level, subject, cohortSize, issuedBy);

    console.log('\n✅ PIN Generated Successfully!\n');
    console.log('─'.repeat(40));
    console.log(`  PIN:        ${pin.pin}`);
    console.log(`  School:     ${school.name}`);
    console.log(`  Subject:    ${subject}`);
    console.log(`  Level:      ${level}`);
    console.log(`  Cohort:     ${cohortSize} students`);
    console.log(`  Valid for:  24 hours`);
    console.log(`  Expires:    ${pin.expires_at.toLocaleString()}`);
    console.log('─'.repeat(40));
    console.log('\nSend this PIN to the teacher via WhatsApp or SMS.');
    console.log('The teacher will enter it in the TAKMIL Bot to begin assessment.\n');

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    rl.close();
    process.exit(0);
  }
}

main();
