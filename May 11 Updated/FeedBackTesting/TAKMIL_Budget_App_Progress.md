# TAKMIL Budget Approval System — Progress Summary
**Date:** 25 May 2026  
**File:** `BudgetApproval_Corporate.html` (single file, ~122KB, 2,200+ lines)  
**Type:** Front-end only — localStorage as database, no backend yet

---

## What Has Been Built

### 1. Core App Shell
- Single HTML file — works offline, no server needed
- **PWA enabled** — installable on Android and iOS (Add to Home Screen)
- **Corporate Slate colour theme** — soft navy/slate palette (#1B3557 header, #2260A8 accent), not the original bright Arctic Blue
- Fonts: Manrope + Plus Jakarta Sans
- Fully responsive — works on mobile and desktop
- Sticky header with logged-in user chip and Sign Out

---

### 2. Authentication & User Roles

| Role | Email | Password | What they can do |
|---|---|---|---|
| Program Manager (Stage 1) | zainab@takmil.org | zainab123 | Review + approve/decline with checklist |
| Board Member (Stage 2) | ihtzaz@takmil.org | ihtzaz123 | Approve/decline at Stage 2 |
| Finance Manager (Stage 3) | finance@takmil.org | finance123 | Approve/decline at Stage 3 |
| Finance Coordinator (Stage 4) | fincoord@takmil.org | fincoord123 | Approve/decline at Stage 4 |
| Finance Director (Stage 5) | director@takmil.org | director123 | Final approval at Stage 5 |
| Admin | qamar13@hotmail.com | teamlead | Full access + manage schools + import data |

> All emails are test placeholders — replace with real emails before go-live.

---

### 3. Budget Request Submission (4-Step Form)

**Step 1 — Submitter Information**
- Full Name, Email, Designation
- Quarter (Q1–Q4), Month
- School (dropdown from uploaded list)
- **Payment Deadline** (date picker) — new
- **Priority** — 3-button selector: Critical (<24 hrs) / Moderate (3 days) / Normal (7 days) — new

**Step 2 — Budget Category**
- **Budget Head** — 16 real TAKMIL categories (School Technology, Books, Salaries, Shipment Charges, School Visits, Skill Development Programme, Travelling Expense, Internet Allowance, Rents, Office Supplies, Fee & Subscription, Miscellaneous, School Supplies, Student Stationery & Printing, Additional Project, Financial Charges)
- **Sub-Budget Head** — multi-select tags per head (e.g. Technology + USB + Solar Panel together), removable chips

**Step 3 — Recipients & Bank Details**
- Up to **5 recipients**, dynamic add/remove
- Per recipient: Name, Role, Recipient Type (Team Member / External-Individual / External-Commercial Vendor), Email, Phone
- Per recipient: Amount, Tax Withholding Yes/No → Tax Amount → Net auto-calculates
- Per recipient: Bank Name, City, Branch Code, Province, Account Number, Account Title
- **Grand Total Bar** — live totals: Recipients count · Total Requested · Total Tax · Net Payable

**Step 4 — Justification & Attachments**
- Long-form justification (min 20 chars)
- File attachments (PDF, Word, Excel, images)

**After Submit:** Thank You screen with REQ-XXXX reference number, options to submit another or view all.

---

### 4. Approval Pipeline (5 Stages)

```
Zainab (PM) → Dr. Ihtzaz (Board) → Finance Manager → Finance Coordinator → Finance Director
   Stage 1          Stage 2              Stage 3              Stage 4              Stage 5
```

- Each approver only sees their action button when it's their stage
- Role-based: email matching determines who can act, not just role name
- Actions available at each stage: **Approve / Needs Info / Decline**
- Stage 1 (Zainab) has extra actions: **Duplicate** and **Resubmission**

**Zainab's Stage 1 approval modal includes a 7-item verification checklist:**
- Budget Verified
- School Data Verified
- Student Data Verified
- Additional Data Verified
- Vendor Verified
- Quote Verified
- Applicable Tax Verified

Each item has Yes / N/A / No toggle. Results are saved in the approval log and shown as colour-coded chips in the history.

**Approval log** visible on every request — shows each stage action, who took it, when, comment, and checklist results.

---

### 5. View Budget Requests (Admin / Approver Login Required)

**All Requests table:**
- Columns: Req ID · Date · Submitter · School · Budget Head + Sub Heads · Amount · Priority badge · Deadline · Status badge
- Click any row → opens detail modal with full information + pipeline visual + approval log
- Status badges: Pending / In Review / Approved / Declined / Needs Info / Resubmission / Duplicate

**Summary tab:**
- Tiles: Total / Approved / In Review / Needs Info / Declined / Total PKR Value
- Table: requests and amounts broken down by Budget Head

**Export:**
- **CSV** — all fields, compatible with Power BI / Excel
- **JSON** — full data dump

---

### 6. School Management (Admin only)

- **Add single school** — text input, Enter key supported, duplicate-safe (case-insensitive)
- **Upload CSV list** — drag-and-drop or browse, with:
  - File preview (first 50 rows)
  - Import stats: Total / New / Duplicates / Currently Saved
  - Import mode: Append or Replace entire list
  - Download sample CSV template
- **Search** — live filter appears when >5 schools registered
- **Remove** individual schools (pill × button)
- **Clear all** with confirmation
- Schools used as dropdown in submission form

---

### 7. Historical Data Import (Admin only)

- Appears as "Import Historical" button in the View tab (Admin only)
- Accepts Zainab's Review Sheet CSV format (the actual Google Form export)
- Maps columns automatically:
  - `Submitter Name`, `Budget Head`, `SubBudget Head`, `Quarter`, `Month`, `Amount Requested`
  - `Recipient 1`, `Recipient 2`
  - `Reviewed by Zainab`, `Approved by Zainab`, `Approved by Dr. Ihtzaz`
  - All 7 verification checklist columns
- Derives correct pipeline status per row:

| CSV state | Imported as |
|---|---|
| Zainab Yes + Ihtzaz Yes | In Review at Stage 3 |
| Zainab Yes, Ihtzaz pending | In Review at Stage 2 |
| Resubmission | Needs Info at Stage 1 |
| Duplicate | Declined |
| Zainab No | Declined |
| Not yet reviewed | Pending at Stage 1 |

- Approval log pre-filled with Zainab and Dr. Ihtzaz entries including checklist results
- Option to append to existing data or clear first
- 82 historical requests ready to import (Q1 Jan–Mar 2026 + Q2 Apr–May 2026)

---

## What Is NOT Built Yet

### Must-have before go-live
- [ ] **Real backend** — currently localStorage only (one browser, one device)
- [ ] **Multi-user simultaneous access** — two people can't use it at the same time right now
- [ ] **Real email notifications** — approvers have no way to know when something lands in their queue
- [ ] **Replace test emails** with real staff emails

### Nice-to-have / Phase 2
- [ ] **Recipient Type** validation against vendor registry
- [ ] **Attachment upload** — currently field exists but files aren't stored
- [ ] **Filters on requests table** — by status, quarter, budget head, submitter
- [ ] **Date range filter** for reports
- [ ] **PDF export** of individual request (for paper records)
- [ ] **Funds Release Date** field (visible in Zainab's sheet but not in form)
- [ ] **Approval Email Date** tracking
- [ ] **Dashboard** — charts for spend by head, approval turnaround times
- [ ] **Mobile push notifications**

---

## Next Steps Discussed

1. **Zainab reviews the app** — confirm pipeline, field names, and checklist items match her actual workflow
2. **Import historical data** — once form is confirmed stable, upload the 82 Q1/Q2 requests
3. **Backend decision** — Node/Express + PostgreSQL or Python/FastAPI (localStorage → API calls, front-end structure maps cleanly)
4. **Replace test credentials** with real staff emails

---

## File Reference

| Item | Value |
|---|---|
| Filename | BudgetApproval_Corporate.html |
| Size | ~122 KB |
| Lines | ~2,200 |
| Storage | Browser localStorage (key: `ba_requests`, `ba_schools`, `ba_counter`) |
| PWA manifest | Auto-generated at runtime |
| Fonts | Google Fonts (Manrope + Plus Jakarta Sans) |
| Dependencies | Zero — pure HTML/CSS/JS, no libraries |
