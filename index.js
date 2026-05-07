// index.js — TAKMIL Bot v3.0 — Entry Point
// ─────────────────────────────────────────
// This file ONLY starts the server and mounts routes.
// To fix a bug, open ONLY the relevant route file:
//
//   Application          File
//   ─────────────────────────────────────────────────────
//   WhatsApp Bot         routes/chatbot.js
//   Attendances          routes/attendance.js
//   Photo Verification   routes/photo-verify.js
//   Video Verification   routes/video-verify.js
//   Level Advancement    routes/level-advance.js
//   Admin / Question Bank routes/admin.js
//
//   Shared WhatsApp      helpers/whatsapp.js
//   Shared Question Logic helpers/questions.js

require('dotenv').config();
const express = require('express');
const path    = require('path');
const fs      = require('fs');
const db      = require('./database');
const app     = express();

// ── Static files & CORS ───────────────────────────────────────────────────────
const PHOTOS_DIR = path.join(__dirname, 'public', 'photos');
if (!fs.existsSync(PHOTOS_DIR)) fs.mkdirSync(PHOTOS_DIR, { recursive: true });
app.use('/photos', express.static(path.join(__dirname, 'public', 'photos')));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// ── Load route modules ────────────────────────────────────────────────────────
const { router: chatbotRouter, registerHandlers } = require('./routes/chatbot');
const { router: attendanceRouter, isFeedbackMessage, parseFeedback, saveFeedback } = require('./routes/attendance');
const { router: photoRouter, handleClassPhoto } = require('./routes/photo-verify');
const { router: videoRouter, handleVideoCommands } = require('./routes/video-verify');
const { router: levelAdvanceRouter } = require('./routes/level-advance');
const { router: adminRouter } = require('./routes/admin');

// Wire cross-module handlers into the chatbot webhook
registerHandlers(handleClassPhoto, handleVideoCommands, isFeedbackMessage, parseFeedback, saveFeedback);

// ── Mount all routes ──────────────────────────────────────────────────────────
app.use('/', chatbotRouter);      // /webhook, WhatsApp bot state machine
app.use('/', attendanceRouter);   // /register, /attendance, /analytics, /feedback, /api/register/*
app.use('/', photoRouter);        // /api/photos
app.use('/', videoRouter);        // /console, /health, /admin/session-status
app.use('/', levelAdvanceRouter); // /assess, /portal, /teacher-portal, /lessons-admin, /compliance, /results, /api/assess/*, /api/lessons/*
app.use('/', adminRouter);        // /dashboard, /import, /question-bank, /admin/*, /api/questions/*, /api/generate-questions

// ── Root/hub ──────────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'hub.html')));
app.get('/hub', (req, res) => res.sendFile(path.join(__dirname, 'hub.html')));
app.get('/classroom', (req, res) => res.sendFile(path.join(__dirname, 'takmil-classroom.html')));

// ── Start server ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
(async () => {
  try {
    await db.initializeDatabase();
    app.listen(PORT, () => console.log(`🚀 TAKMIL Bot v3.0 running on port ${PORT}`));
  } catch(err) {
    console.error('❌ Failed to start:', err);
    process.exit(1);
  }
})();
