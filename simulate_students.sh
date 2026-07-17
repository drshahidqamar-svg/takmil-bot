#!/bin/bash
# ============================================================
# TAKMIL Student Simulation
# 3 students × 2 schools × 2 levels = 4 class sessions
# Run: bash simulate_students.sh
# ============================================================

BASE_URL="https://takmil-bot-production-0f51.up.railway.app"
WEBHOOK="$BASE_URL/webhook"
PIN_API="$BASE_URL/admin/pins/generate"

GREEN='\033[0;32m'
AMBER='\033[0;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

echo -e "${BOLD}============================================${NC}"
echo -e "${BOLD}   TAKMIL Student Simulation v1.0${NC}"
echo -e "${BOLD}   3 students × 2 schools × 2 levels${NC}"
echo -e "${BOLD}============================================${NC}"
echo ""

# ── Helper: send webhook message ────────────────────────────
send() {
  local PHONE=$1
  local MSG=$2
  local RESP=$(curl -s -X POST "$WEBHOOK" \
    --data-urlencode "From=whatsapp:$PHONE" \
    --data-urlencode "Body=$MSG")
  echo "$RESP"
  sleep 0.8
}

# ── Helper: generate PIN ─────────────────────────────────────
get_pin() {
  local SCHOOL_ID=$1
  local LEVEL=$2
  local SUBJECT=$3
  local COHORT=$4
  local RESP=$(curl -s -X POST "$PIN_API" \
    -H "Content-Type: application/json" \
    -d "{\"schoolId\": $SCHOOL_ID, \"level\": $LEVEL, \"subject\": \"$SUBJECT\", \"cohortSize\": $COHORT, \"issuedBy\": \"Simulator\"}")
  echo $RESP | grep -o '"pin":"[^"]*"' | cut -d'"' -f4
}

# ── Helper: run one student assessment ──────────────────────
# Answers: We rotate to get realistic mix of correct/wrong
# CORRECT answers for shuffled questions = unpredictable
# So we send: A B C D A B A B C A → typical mixed answers
run_student() {
  local PHONE=$1
  local STUDENT_NAME=$2
  local STUDENT_NUM=$3

  echo -e "  ${BLUE}Student $STUDENT_NUM: $STUDENT_NAME${NC}"

  # Send student name
  send "$PHONE" "$STUDENT_NAME" > /dev/null
  sleep 0.5

  # Answer 10 questions with varied answers
  local ANSWERS=("A" "B" "A" "C" "B" "A" "D" "B" "A" "C")
  # Student 1: mostly A (tends to get ~30-40%)
  # Student 2: mix B,C (tends to get ~30-40%)
  # Student 3: mix A,B,C,D (tends to get ~30-40%)
  # Note: actual score depends on shuffle - this tests the recording not the scoring

  if [ "$STUDENT_NUM" == "1" ]; then
    ANSWERS=("A" "A" "A" "A" "A" "A" "A" "A" "A" "A")
  elif [ "$STUDENT_NUM" == "2" ]; then
    ANSWERS=("B" "C" "B" "D" "C" "B" "C" "D" "B" "C")
  else
    ANSWERS=("A" "B" "C" "D" "A" "B" "C" "D" "A" "B")
  fi

  for i in {0..9}; do
    RESP=$(send "$PHONE" "${ANSWERS[$i]}")
    sleep 0.3
  done

  echo -e "  ${GREEN}✓ $STUDENT_NAME answered all 10 questions${NC}"
}

# ── Run one full class session ───────────────────────────────
run_class() {
  local SCHOOL_ID=$1
  local SCHOOL_NAME=$2
  local LEVEL=$3
  local SUBJECT=$4
  local PHONE=$5  # unique virtual phone per class

  echo ""
  echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BOLD}🏫 $SCHOOL_NAME${NC}"
  echo -e "${BOLD}   Level $LEVEL | $SUBJECT | Phone: $PHONE${NC}"
  echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

  # Step 1: Generate PIN
  echo -e "${AMBER}[1/6] Generating PIN...${NC}"
  PIN=$(get_pin $SCHOOL_ID $LEVEL $SUBJECT 3)
  if [ -z "$PIN" ]; then
    echo -e "${RED}✗ Failed to generate PIN — skipping${NC}"
    return
  fi
  echo -e "${GREEN}    PIN: $PIN${NC}"

  # Step 2: RESET
  echo -e "${AMBER}[2/6] Resetting session...${NC}"
  send "$PHONE" "RESET" > /dev/null

  # Step 3: Enter PIN
  echo -e "${AMBER}[3/6] Entering PIN...${NC}"
  RESP=$(send "$PHONE" "$PIN")
  if echo "$RESP" | grep -q "PIN Accepted"; then
    echo -e "${GREEN}    PIN accepted ✓${NC}"
  else
    echo -e "${RED}    PIN rejected — skipping${NC}"
    return
  fi

  # Step 4: Confirm YES
  echo -e "${AMBER}[4/6] Starting session...${NC}"
  send "$PHONE" "YES" > /dev/null
  sleep 1

  # Step 5: 3 students
  echo -e "${AMBER}[5/6] Running 3 students...${NC}"
  run_student "$PHONE" "Fatima Bibi"    "1"
  sleep 0.5
  run_student "$PHONE" "Muhammad Ali"   "2"
  sleep 0.5
  run_student "$PHONE" "Ayesha Noor"    "3"
  sleep 0.5

  # Step 6: DONE
  echo -e "${AMBER}[6/6] Finishing session...${NC}"
  FINAL=$(send "$PHONE" "DONE")

  # Show result summary
  echo ""
  echo -e "${BOLD}📊 Session Result:${NC}"
  # Extract key lines from response
  echo "$FINAL" | sed 's/<[^>]*>//g' | grep -E "(Score|Result|Fatima|Muhammad|Ayesha|Cohort|Avg|Passed|threshold)" | head -15
  echo ""
}

# ══════════════════════════════════════════════════════════════
# SIMULATION MATRIX
# 2 Schools × 2 Levels × 1 Subject = 4 class sessions
# Each class has 3 students
# ══════════════════════════════════════════════════════════════

echo -e "${BOLD}Simulation Plan:${NC}"
echo "  School 2 (GPS Lahore No.1)  — Level 1 Math   — 3 students"
echo "  School 2 (GPS Lahore No.1)  — Level 2 English — 3 students"
echo "  School 17 (GPS Karachi)     — Level 1 Urdu    — 3 students"
echo "  School 17 (GPS Karachi)     — Level 2 Math    — 3 students"
echo ""
echo "Starting in 3 seconds..."
sleep 3

# Each class needs a unique phone number to avoid session conflicts
run_class 2  "GPS Lahore No.1"   1 "Math"    "+15550020100"
run_class 2  "GPS Lahore No.1"   2 "English" "+15550020200"
run_class 17 "GPS Karachi North" 1 "Urdu"    "+15550170100"
run_class 17 "GPS Karachi North" 2 "Math"    "+15550170200"

# ── Verify results in DB ─────────────────────────────────────
echo ""
echo -e "${BOLD}============================================${NC}"
echo -e "${BOLD}   Verifying Results in Database...${NC}"
echo -e "${BOLD}============================================${NC}"
echo ""

RESULTS=$(curl -s "$BASE_URL/admin/students/results")

if echo "$RESULTS" | grep -q "Fatima"; then
  echo -e "${GREEN}✓ Student records found in database${NC}"
  echo ""
  echo -e "${BOLD}Individual student results:${NC}"
  echo "$RESULTS" | python3 -c "
import json, sys
data = json.load(sys.stdin)
recent = [r for r in data if r.get('student_name') in ['Fatima Bibi','Muhammad Ali','Ayesha Noor']]
for r in recent[-12:]:
    passed = '✅ PASS' if r.get('passed') else '📚 REASSESS'
    print(f\"  {r.get('student_name','?'):<20} | {r.get('subject','?'):<8} | L{r.get('level','?')} | {r.get('score_pct','?')}% | {passed}\")
" 2>/dev/null || echo "$RESULTS" | head -c 500
else
  echo -e "${AMBER}⚠️  No student records yet — new index.js may not be deployed${NC}"
  echo -e "   Deploy the new index.js first, then run this script again"
fi

echo ""
echo -e "${BOLD}============================================${NC}"
echo -e "  View full results: $BASE_URL/dashboard"
echo -e "${BOLD}============================================${NC}"
