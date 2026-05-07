// helpers/whatsapp.js — Shared WhatsApp sending helpers
const twilio = require('twilio');

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);
const FROM_NUMBER = process.env.TWILIO_WHATSAPP_FROM;

async function sendWhatsApp(to, body) {
  try {
    const toNum = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
    await twilioClient.messages.create({ from: FROM_NUMBER, to: toNum, body });
  } catch (err) {
    console.error(`❌ Twilio send error to ${to}:`, err.message);
  }
}

// Alias used by video-verify module
async function sendWA(to, body) {
  return sendWhatsApp(to, body);
}

function escapeXml(str) {
  return (str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

module.exports = { sendWhatsApp, sendWA, escapeXml, twilioClient, FROM_NUMBER };
