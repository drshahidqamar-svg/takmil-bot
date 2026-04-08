# TAKMIL Bot v2.0 — Setup & Deployment Guide

## What's New in v2.0
- ✅ PIN-based session unlock (6-char, 24-hour expiry, locked to school+level+subject)
- ✅ Question randomization with option shuffling
- ✅ 80% competency threshold enforcement
- ✅ 3-person Ops approval flow via WhatsApp
- ✅ 7-day re-assessment scheduling
- ✅ Admin REST API for school/ops/PIN management
- ✅ Analytics endpoint (by subject, level, school)

---

## Step 1 — Run DB Migration

The new schema adds 6 tables. Run the bot once and it auto-creates them:

```bash
node index.js
```

Or apply manually in Railway's Postgres console:
- pins, sessions, schools, teachers, assessments, advancement_requests,
  reassessment_schedule, ops_team

---

## Step 2 — Add Your Ops Team

Via REST API (or use curl from Railway shell):

```bash
curl -X POST https://takmil-bot-production-0f51.up.railway.app/admin/ops \
  -H "Content-Type: application/json" \
  -d '{"phone": "+923001234567", "name": "Ahmed (Ops Lead)", "role": "ops"}'
```

Repeat for each of the 3 ops members. Their WhatsApp numbers go here.

---

## Step 3 — Add a School

```bash
curl -X POST https://takmil-bot-production-0f51.up.railway.app/admin/schools \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Government Primary School Lahore",
    "province": "Punjab",
    "district": "Lahore",
    "contactName": "Mr. Khan",
    "contactPhone": "+923009876543"
  }'
```

---

## Step 4 — Generate a PIN for a Teacher

**Option A — CLI (Railway shell or local):**
```bash
node generate_pin.js
```

**Option B — REST API:**
```bash
curl -X POST https://takmil-bot-production-0f51.up.railway.app/admin/pins/generate \
  -H "Content-Type: application/json" \
  -d '{
    "schoolId": 1,
    "level": 3,
    "subject": "Math",
    "cohortSize": 28,
    "issuedBy": "Ahmed"
  }'
```

Response: `{ "pin": "A4KR7X", "expiresAt": "2025-06-15T10:00:00Z" }`

Send the PIN to the teacher via WhatsApp.

---

## Teacher Flow (WhatsApp)

```
Teacher: A4KR7X
Bot: ✅ PIN Accepted! School: GPS Lahore | Math | Level 3 | 28 students
     Reply YES to begin.

Teacher: YES
Bot: 🚀 Assessment Started!
     📝 Question 1 of 10 ...

Teacher: B
Bot: ✅ Answer recorded.
     📝 Question 2 of 10 ...

[... 10 questions ...]

Bot: 🎉 Assessment Complete!
     Score: 8/10 (80%) ✅ Threshold met!
     Advancement request submitted to Ops.
```

---

## Ops Approval Flow (WhatsApp)

Ops team automatically receives:
```
🎓 TAKMIL Advancement Request
🏫 GPS Lahore | 📚 Math | Level 3→4 | 80%
Reply: APPROVE 12  OR  REJECT 12 <reason>
```

Any 1 of 3 ops members can approve:
```
Ops: APPROVE 12
Bot: ✅ Approved! Teacher notified. 7-day follow-up scheduled.
```

---

## Admin Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Health check |
| POST | `/admin/schools` | Add a school |
| POST | `/admin/ops` | Add ops team member |
| POST | `/admin/pins/generate` | Generate a PIN |
| GET | `/admin/advancements/pending` | List pending requests |
| GET | `/admin/analytics` | Full analytics summary |

---

## Environment Variables (Railway)

```
DATABASE_URL=postgresql://...  (already set)
TWILIO_ACCOUNT_SID=ACxxxx
TWILIO_AUTH_TOKEN=xxxx
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
NODE_ENV=production
PORT=3000
```

---

## Teacher Commands

| Command | Description |
|---------|-------------|
| `<PIN>` | Start session |
| `YES` | Confirm and begin assessment |
| `A/B/C/D` | Answer current question |
| `STATUS` | View session progress |
| `RESET` | Clear session |
| `HELP` | Show help |

## Ops Commands

| Command | Description |
|---------|-------------|
| `APPROVE <id>` | Approve advancement |
| `REJECT <id> <reason>` | Reject with reason |
| `PENDING` | List pending requests |
| `STATS` | View analytics summary |
| `HELP` | Show help |

---

## Next Build Phases

- [ ] Excel bulk import (schools + students)
- [ ] Web analytics dashboard (React)
- [ ] Demographic tracking (gender/age/topic)
- [ ] Automated 7-day re-assessment PIN re-issue
- [ ] Multi-language bot responses (Urdu)
