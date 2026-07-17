#!/bin/bash
# TAKMIL PIN Generator Script
# Run this from your project folder: bash generate_pins.sh
# Or on Windows with Git Bash: bash generate_pins.sh

API="https://takmil-bot-production-0f51.up.railway.app/admin/pins/generate"
ISSUED_BY="Shahid"

echo "=========================================="
echo "  TAKMIL Bulk PIN Generator"
echo "=========================================="
echo ""

generate_pin() {
  local SCHOOL_ID=$1
  local SCHOOL_NAME=$2
  local LEVEL=$3
  local SUBJECT=$4
  local COHORT=$5

  RESPONSE=$(curl -s -X POST "$API" \
    -H "Content-Type: application/json" \
    -d "{\"schoolId\": $SCHOOL_ID, \"level\": $LEVEL, \"subject\": \"$SUBJECT\", \"cohortSize\": $COHORT, \"issuedBy\": \"$ISSUED_BY\"}")

  PIN=$(echo $RESPONSE | grep -o '"pin":"[^"]*"' | cut -d'"' -f4)
  EXPIRES=$(echo $RESPONSE | grep -o '"expiresAt":"[^"]*"' | cut -d'"' -f4)

  printf "%-40s | Level %-2s | %-8s | PIN: %-8s\n" "$SCHOOL_NAME" "$LEVEL" "$SUBJECT" "$PIN"
}

# ── PUNJAB ────────────────────────────────────────────────────────────────────
echo "📍 PUNJAB"
echo "-------------------------------------------"
generate_pin 2  "GPS Lahore No.1"           1 "Math"    25
generate_pin 2  "GPS Lahore No.1"           1 "English" 25
generate_pin 2  "GPS Lahore No.1"           1 "Urdu"    25
generate_pin 2  "GPS Lahore No.1"           2 "Math"    20
generate_pin 2  "GPS Lahore No.1"           2 "English" 20
generate_pin 2  "GPS Lahore No.1"           2 "Urdu"    20
generate_pin 3  "GPS Lahore No.2"           1 "Math"    22
generate_pin 3  "GPS Lahore No.2"           1 "English" 22
generate_pin 3  "GPS Lahore No.2"           2 "Math"    18
generate_pin 4  "GPS Girls Shahdara"        1 "Urdu"    20
generate_pin 4  "GPS Girls Shahdara"        3 "Math"    15
generate_pin 5  "Community Al-Huda Gujran." 1 "Math"    25
generate_pin 6  "Noor ul Islam Faisalabad"  2 "English" 22
generate_pin 7  "GPS Boys Multan"           1 "Math"    20
generate_pin 8  "GPS Girls Multan"          1 "Urdu"    18
echo ""

# ── SINDH ─────────────────────────────────────────────────────────────────────
echo "📍 SINDH"
echo "-------------------------------------------"
generate_pin 17 "GPS Karachi North"         1 "Math"    30
generate_pin 17 "GPS Karachi North"         1 "English" 30
generate_pin 17 "GPS Karachi North"         1 "Urdu"    30
generate_pin 17 "GPS Karachi North"         2 "Math"    25
generate_pin 18 "GPS Karachi South"         1 "Math"    28
generate_pin 18 "GPS Karachi South"         2 "English" 24
generate_pin 19 "Al-Noor Community Hyd."   1 "Urdu"    20
generate_pin 20 "GPS Girls Sukkur"          2 "Math"    18
generate_pin 21 "GPS Larkana"               1 "English" 22
generate_pin 22 "Community School Khairpur" 3 "Math"    16
echo ""

# ── KPK ──────────────────────────────────────────────────────────────────────
echo "📍 KPK"
echo "-------------------------------------------"
generate_pin 27 "GPS Peshawar City"         1 "Math"    18
generate_pin 27 "GPS Peshawar City"         1 "English" 18
generate_pin 27 "GPS Peshawar City"         2 "Urdu"    15
generate_pin 28 "GPS Girls Peshawar"        1 "Urdu"    20
generate_pin 29 "Community School Mardan"   1 "Math"    22
generate_pin 30 "GPS Swat"                  2 "English" 16
generate_pin 31 "Al-Rasheed Abbottabad"     1 "Math"    14
generate_pin 33 "Community School Kohat"    3 "Urdu"    12
echo ""

# ── BALOCHISTAN ───────────────────────────────────────────────────────────────
echo "📍 BALOCHISTAN"
echo "-------------------------------------------"
generate_pin 37 "GPS Quetta"                1 "Math"    20
generate_pin 37 "GPS Quetta"                2 "English" 18
generate_pin 38 "GPS Girls Quetta"          1 "Urdu"    22
generate_pin 39 "Community School Turbat"   1 "Math"    15
generate_pin 40 "GPS Khuzdar"               2 "Math"    14
generate_pin 42 "GPS Gwadar"                1 "English" 12
echo ""

# ── GILGIT-BALTISTAN ──────────────────────────────────────────────────────────
echo "📍 GILGIT-BALTISTAN"
echo "-------------------------------------------"
generate_pin 45 "GPS Gilgit City"           1 "Math"    12
generate_pin 45 "GPS Gilgit City"           1 "English" 12
generate_pin 46 "Community School Skardu"   1 "Urdu"    10
generate_pin 47 "GPS Girls Hunza"           2 "Math"    8
generate_pin 48 "GPS Chilas"                1 "Math"    10
echo ""

# ── AJK ───────────────────────────────────────────────────────────────────────
echo "📍 AJK"
echo "-------------------------------------------"
generate_pin 49 "GPS Muzaffarabad"          1 "Math"    15
generate_pin 49 "GPS Muzaffarabad"          1 "Urdu"    15
generate_pin 50 "Community School Rawlkt."  2 "Math"    12
generate_pin 51 "GPS Girls Kotli"           1 "English" 10
echo ""

echo "=========================================="
echo "  All PINs generated successfully!"
echo "  Valid for 24 hours from now."
echo "=========================================="