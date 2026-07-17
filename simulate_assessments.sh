#!/bin/bash
# ============================================================
# TAKMIL Assessment Simulator
# Simulates multiple teachers completing assessments
# Run: bash simulate_assessments.sh
# ============================================================

BASE_URL="https://takmil-bot-production-0f51.up.railway.app"
WEBHOOK="$BASE_URL/webhook"
PIN_API="$BASE_URL/admin/pins/generate"

# Colors
GREEN='\033[0;32m'
AMBER='\033[0;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
GRAY='\033[0;37m'
BOLD='\033[1m'
NC='\033[0m'

TOTAL_PASS=0
TOTAL_FAIL=0
TOTAL_ERRORS=0

echo -e "${BOLD}============================================${NC}"
echo -e "${BOLD}   TAKMIL Assessment Simulator v1.0${NC}"
echo -e "${BOLD}============================================${NC}"
echo ""

# ── Send a WhatsApp message via webhook ─────────────────────
send_msg() {
  local PHONE=$1
  local MSG=$2
  curl -s -X POST "$WEBHOOK" \
    --data-urlencode "From=whatsapp:$PHONE" \
    --data-urlencode "Body=$MSG" \
    > /dev/null
  sleep 0.5
}

# ── Get a PIN for a school/level/subject ────────────────────
get_pin() {
  local SCHOOL_ID=$1
  local LEVEL=$2
  local SUBJECT=$3
  local COHORT=$4
  local RESPONSE=$(curl -s -X POST "$PIN_API" \
    -H "Content-Type: application/json" \
    -d "{\"schoolId\": $SCHOOL_ID, \"level\": $LEVEL, \"subject\": \"$SUBJECT\", \"cohortSize\": $COHORT, \"issuedBy\": \"Simulator\"}")
  echo $RESPONSE | grep -o '"pin":"[^"]*"' | cut -d'"' -f4
}

# ── Get answer options from webhook response ─────────────────
get_options() {
  local PHONE=$1
  local RESPONSE=$(curl -s -X POST "$WEBHOOK" \
    --data-urlencode "From=whatsapp:$PHONE" \
    --data-urlencode "Body=STATUS")
  echo "$RESPONSE"
}

# ── Run one full assessment ──────────────────────────────────
run_assessment() {
  local SCHOOL_ID=$1
  local SCHOOL_NAME=$2
  local LEVEL=$3
  local SUBJECT=$4
  local COHORT=$5
  local PROVINCE=$6
  # Use school ID + level + subject as unique phone to avoid session conflicts
  local PHONE="+1555$(printf '%04d' $SCHOOL_ID)$(printf '%02d' $LEVEL)${SUBJECT:0:1}"

  printf "${BLUE}%-35s${NC} | L%-2s | %-8s | " "$SCHOOL_NAME" "$LEVEL" "$SUBJECT"

  # Step 1: Generate PIN
  local PIN=$(get_pin $SCHOOL_ID $LEVEL $SUBJECT $COHORT)
  if [ -z "$PIN" ]; then
    echo -e "${RED}✗ Failed to generate PIN${NC}"
    ((TOTAL_ERRORS++))
    return
  fi

  # Step 2: RESET session
  send_msg "$PHONE" "RESET"
  sleep 0.3

  # Step 3: Send PIN
  local PIN_RESP=$(curl -s -X POST "$WEBHOOK" \
    --data-urlencode "From=whatsapp:$PHONE" \
    --data-urlencode "Body=$PIN")
  sleep 0.5

  # Check PIN accepted
  if ! echo "$PIN_RESP" | grep -q "PIN Accepted"; then
    echo -e "${RED}✗ PIN rejected${NC}"
    ((TOTAL_ERRORS++))
    return
  fi

  # Step 4: Send YES
  send_msg "$PHONE" "YES"
  sleep 1

  # Step 5: Answer all 10 questions
  # We always answer A - the correct answer after shuffle is random
  # but we track actual score from the result
  for i in {1..10}; do
    # Rotate answers to get variety: mostly correct answers
    local ANSWERS=("A" "B" "C" "D" "A" "B" "A" "A" "B" "A")
    send_msg "$PHONE" "${ANSWERS[$((i-1))]}"
    sleep 0.3
  done

  sleep 1

  # Step 6: Get final result
  local RESULT=$(curl -s -X POST "$WEBHOOK" \
    --data-urlencode "From=whatsapp:$PHONE" \
    --data-urlencode "Body=STATUS")

  # Extract score from recent assessment via API
  local SCORE_RESP=$(curl -s "$BASE_URL/admin/analytics")
  local LAST_SCORE=$(echo $SCORE_RESP | grep -o '"avg_score":"[^"]*"' | head -1 | cut -d'"' -f4)

  echo -e "${GREEN}✓${NC} PIN: ${BOLD}$PIN${NC} | Assessment complete"

  ((TOTAL_PASS++))
}

# ══════════════════════════════════════════════════════════════
# TEST MATRIX
# Format: run_assessment SCHOOL_ID "Name" LEVEL SUBJECT COHORT PROVINCE
# ══════════════════════════════════════════════════════════════

echo -e "${BOLD}📍 PUNJAB${NC}"
echo -e "${GRAY}------------------------------------------------------------${NC}"
run_assessment 2  "GPS Lahore No.1"          1 "Math"    25 "Punjab"
run_assessment 2  "GPS Lahore No.1"          1 "English" 25 "Punjab"
run_assessment 2  "GPS Lahore No.1"          1 "Urdu"    25 "Punjab"
run_assessment 2  "GPS Lahore No.1"          2 "Math"    20 "Punjab"
run_assessment 2  "GPS Lahore No.1"          2 "English" 20 "Punjab"
run_assessment 3  "GPS Lahore No.2"          1 "Math"    22 "Punjab"
run_assessment 3  "GPS Lahore No.2"          2 "Urdu"    18 "Punjab"
run_assessment 4  "GPS Girls Shahdara"       1 "Urdu"    20 "Punjab"
run_assessment 5  "Community Al-Huda Guj."   1 "Math"    25 "Punjab"
run_assessment 6  "Noor ul Islam Fsd."       2 "English" 22 "Punjab"
echo ""

echo -e "${BOLD}📍 SINDH${NC}"
echo -e "${GRAY}------------------------------------------------------------${NC}"
run_assessment 17 "GPS Karachi North"        1 "Math"    30 "Sindh"
run_assessment 17 "GPS Karachi North"        1 "English" 30 "Sindh"
run_assessment 17 "GPS Karachi North"        2 "Math"    25 "Sindh"
run_assessment 18 "GPS Karachi South"        1 "Urdu"    28 "Sindh"
run_assessment 18 "GPS Karachi South"        2 "English" 24 "Sindh"
run_assessment 19 "Al-Noor Hyderabad"        1 "Math"    20 "Sindh"
run_assessment 20 "GPS Girls Sukkur"         2 "Urdu"    18 "Sindh"
run_assessment 21 "GPS Larkana"              1 "English" 22 "Sindh"
run_assessment 22 "Community Khairpur"       3 "Math"    16 "Sindh"
echo ""

echo -e "${BOLD}📍 KPK${NC}"
echo -e "${GRAY}------------------------------------------------------------${NC}"
run_assessment 27 "GPS Peshawar City"        1 "Math"    18 "KPK"
run_assessment 27 "GPS Peshawar City"        1 "English" 18 "KPK"
run_assessment 27 "GPS Peshawar City"        2 "Urdu"    15 "KPK"
run_assessment 28 "GPS Girls Peshawar"       1 "Urdu"    20 "KPK"
run_assessment 29 "Community Mardan"         1 "Math"    22 "KPK"
run_assessment 30 "GPS Swat"                 2 "English" 16 "KPK"
run_assessment 31 "Al-Rasheed Abbottabad"    1 "Math"    14 "KPK"
run_assessment 33 "Community Kohat"          3 "Urdu"    12 "KPK"
echo ""

echo -e "${BOLD}📍 BALOCHISTAN${NC}"
echo -e "${GRAY}------------------------------------------------------------${NC}"
run_assessment 37 "GPS Quetta"               1 "Math"    20 "Balochistan"
run_assessment 37 "GPS Quetta"               2 "English" 18 "Balochistan"
run_assessment 38 "GPS Girls Quetta"         1 "Urdu"    22 "Balochistan"
run_assessment 39 "Community Turbat"         1 "Math"    15 "Balochistan"
run_assessment 40 "GPS Khuzdar"              2 "Math"    14 "Balochistan"
run_assessment 42 "GPS Gwadar"               1 "English" 12 "Balochistan"
echo ""

echo -e "${BOLD}📍 GILGIT-BALTISTAN${NC}"
echo -e "${GRAY}------------------------------------------------------------${NC}"
run_assessment 45 "GPS Gilgit City"          1 "Math"    12 "GB"
run_assessment 45 "GPS Gilgit City"          1 "English" 12 "GB"
run_assessment 46 "Community Skardu"         1 "Urdu"    10 "GB"
run_assessment 47 "GPS Girls Hunza"          2 "Math"    8  "GB"
run_assessment 48 "GPS Chilas"               1 "Math"    10 "GB"
echo ""

echo -e "${BOLD}📍 AJK${NC}"
echo -e "${GRAY}------------------------------------------------------------${NC}"
run_assessment 49 "GPS Muzaffarabad"         1 "Math"    15 "AJK"
run_assessment 49 "GPS Muzaffarabad"         1 "Urdu"    15 "AJK"
run_assessment 50 "Community Rawalakot"      2 "Math"    12 "AJK"
run_assessment 51 "GPS Girls Kotli"          1 "English" 10 "AJK"
echo ""

# ── Summary ──────────────────────────────────────────────────
echo -e "${BOLD}============================================${NC}"
echo -e "${BOLD}   Simulation Complete!${NC}"
echo -e "${BOLD}============================================${NC}"
echo -e "  ${GREEN}Completed : $TOTAL_PASS assessments${NC}"
echo -e "  ${RED}Errors    : $TOTAL_ERRORS${NC}"
echo ""
echo -e "  View results at:"
echo -e "  ${BLUE}$BASE_URL/dashboard${NC}"
echo -e "${BOLD}============================================${NC}"
