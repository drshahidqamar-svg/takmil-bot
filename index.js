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

// ── Portal Routes (auto-added) ──
app.get('/coordinator',          (req, res) => res.sendFile(path.join(__dirname, 'coordinator-portal.html')));
app.get('/portal',               (req, res) => res.sendFile(path.join(__dirname, 'portal.html')));
app.get('/offline-portal',       (req, res) => res.sendFile(path.join(__dirname, 'offline-portal.html')));
app.get('/teacher-portal',       (req, res) => res.sendFile(path.join(__dirname, 'teacher-portal.html')));
app.get('/lessons-admin',        (req, res) => res.sendFile(path.join(__dirname, 'lessons-admin.html')));
app.get('/admin-portal', (req, res) => res.sendFile(path.join(__dirname, 'takmil-ops-console.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'assessment-dashboard.html')));
app.get('/assessment-dashboard', (req, res) => res.sendFile(path.join(__dirname, 'assessment-dashboard.html')));
app.get('/question-bank',        (req, res) => res.sendFile(path.join(__dirname, 'takmil-question-bank.html')));
app.get('/register',             (req, res) => res.sendFile(path.join(__dirname, 'register.html')));
app.get('/results',              (req, res) => res.sendFile(path.join(__dirname, 'results.html')));
app.get('/attendance',           (req, res) => res.sendFile(path.join(__dirname, 'attendance.html')));
app.get('/attendance-dashboard', (req, res) => res.sendFile(path.join(__dirname, 'attendance-dashboard.html')));
app.get('/pin-generator',        (req, res) => res.sendFile(path.join(__dirname, 'pin-generator.html')));
app.get('/analytics',            (req, res) => res.sendFile(path.join(__dirname, 'analytics.html')));
app.get('/import',               (req, res) => res.sendFile(path.join(__dirname, 'import.html')));
app.get('/assess',               (req, res) => res.sendFile(path.join(__dirname, 'assess.html')));
app.get('/compliance',           (req, res) => res.sendFile(path.join(__dirname, 'compliance.html')));
app.get('/feedback',             (req, res) => res.sendFile(path.join(__dirname, 'feedback.html')));
app.get('/level-advancement',    (req, res) => res.sendFile(path.join(__dirname, 'level-advancement.html')));
app.get('/image-portal',         (req, res) => res.sendFile(path.join(__dirname, 'image-portal.html')));
app.get('/picture-questions',    (req, res) => res.sendFile(path.join(__dirname, 'picture-questions.html')));
app.get('/takmil-classroom',     (req, res) => res.sendFile(path.join(__dirname, 'takmil-classroom.html')));


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
