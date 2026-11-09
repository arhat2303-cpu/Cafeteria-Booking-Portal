# Bright Riders Digital Canteen — School Food Ordering & Payment Portal

A complete, production-ready, full-stack cashless school food ordering, digital AED payment, kitchen preparation, and single-use QR meal collection portal built for **Bright Riders School (Abu Dhabi, UAE)**.

---

## 1. Platform Overview

**Bright Riders Digital Canteen** (`SCHOOL FOOD ORDERING & PAYMENT PORTAL`) features a dark obsidian technical-grid interface with the official Bright Riders School crest and connects **four dedicated school roles** around one real-time relational database:

| Role | Portal Capabilities |
| :--- | :--- |
| **Student** | Dedicated cashless campus dining pass displaying student profile, upcoming pre-ordered meals, item quantities, collection break slots, live kitchen preparation status, and single-use optical QR meal passes — zero physical cash required. |
| **Parent** | Self-registration & role-scoped sign-in, linked child selector, official 28-item Bright Riders SEHHI menu browser with photos/search/filters & date-aware availability, persistent shopping cart, break-slot scheduling, special kitchen notes, itemised AED checkout, receipts, eligible pre-prep cancellations, and child QR Pass access. |
| **Chef** | Separate tablet- and mobile-ready Kitchen Display System (KDS) grouped by collection break slot, allergy & special-instruction callouts, one-tap *Preparing* / *Ready for Collection* status updates, live WebRTC **Camera QR Scanner**, QR PNG image scanner, Manual Order ID verification, and atomic single-use **Confirm Collection**. |
| **Admin** | Executive KPI & 14-day AED revenue analytics, full User Management across all 4 roles (`Student`, `Parent`, `Chef`, `Admin`), Parent-Student account linking, Menu & Category CRUD with food image uploads & date/weekday scheduling, Order & Payment Management, Refunds, CSV report exports, and Security Audit Logs. |

---

## 2. Technology Stack & Architecture

- **Frontend**: React 18, TypeScript, Vite 5, Tailwind CSS (Dark Obsidian Blueprint-Grid design system), Lucide Icons, `qrcode`, `jsqr` (WebRTC camera & canvas QR decoder), custom SVG data visualisations, and real-time Server-Sent Events (`EventSource`) with serverless polling fallback.
- **Backend**: Node.js 22, Express 4, TypeScript (`tsx`), `bcryptjs` (12-round password hashing), `jsonwebtoken` + `user_sessions` revocation table, `busboy` (multipart upload with binary magic-byte verification), and `stripe` (official Stripe SDK for UAE AED Checkout).
- **Database**: Persistent relational **SQLite** running on the **self-contained `sql.js` WebAssembly engine** (`sql-wasm-inline.js`, SQLite 3 compiled to WASM with the binary embedded in the bundle). It needs **zero native addons and zero experimental Node modules**, so it runs identically on Node 18, 20, 22, AWS Lambda and Netlify Functions. ACID `BEGIN IMMEDIATE` transactions, `foreign_keys = ON`, atomic temp-file-then-rename disk writes locally, and automatic binary snapshot persistence through **Netlify Blobs** when deployed serverlessly.

### Core Database Tables (`server/db/schema.sql`)
1. `users` — Shared authentication table restricted to `admin`, `parent`, `student`, and `chef`
2. `role_permissions` — Role-level permission matrix
3. `user_sessions` — Active JWT sessions (`token_jti`) enabling instant revocation on password reset or deactivation
4. `parent_profiles` — Parent contact & Abu Dhabi residential details
5. `student_profiles` — Student ID (`BRS-STU-...`), Class, Section, House, and Allergy/Dietary alerts
6. `parent_student_links` — Verified many-to-many Parent-Child relationships
7. `chef_profiles` — Kitchen Staff ID (`BRS-CHF-...`), Station, Shift
8. `platform_settings` — School configuration, collection break slots, and cancellation cutoff window
9. `food_categories` & `menu_items` — Menu categories and items stored in integer **fils** (`1 AED = 100 fils`)
10. `menu_availability_schedules` — Day-of-week schedules and specific-date menu overrides
11. `shopping_carts` & `shopping_cart_items` — Persistent server-side parent shopping carts
12. `orders` & `order_items` — Order records (`BRS-YYYYMMDD-XXXXX`) with historical price snapshots and idempotency keys
13. `payment_transactions` — Digital payment ledger (`TXN-BRS-...`) supporting `succeeded`, `failed`, `pending`, and `refunded` states (zero card numbers or CVVs stored)
14. `qr_verification_tokens` — Cryptographic HMAC-SHA256 signed tokens (`BRSQR.v1.<uid>.<hmac>`) containing zero student PII
15. `collection_records` — Single-use meal collection audit records (`UNIQUE(order_id)` prevents double collection)
16. `uploaded_files` — Persistent binary food photo storage for serverless & local environments
17. `order_status_history` & `admin_activity_logs` — Complete operational and administrative audit trails

---

## 3. Security, Permanent Admin Bootstrap & Zero Demo Content

- **Demo accounts and clean initialization**: Fresh initialization creates two permanent administrators and one demo account for each of Student, Parent and Chef. Select the matching portal and use username `12345`, password `abcd`. Demo accounts are intentionally weak and must not be used for real users or sensitive data. No demo orders or payments are created.
- **Zero Plaintext Secrets**: No passwords, API keys, or secrets exist in frontend code or committed repository files, and no administrator credentials are ever displayed on the website.
- **Role-Portal Sign-In Validation & Session Revocation**: `POST /api/auth/login` validates both credentials and the selected role portal (`expectedRole`). Sessions use `HttpOnly`, `SameSite=Lax` cookies backed by `user_sessions`, revoking active sessions immediately upon password reset or account deactivation.
- **Cryptographic Zero-PII QR Codes**: Every paid order receives a unique `BRSQR.v1.<128-bit-uid>.<hmac-sha256>` token verified with `crypto.timingSafeEqual` and locked inside an atomic SQLite `BEGIN IMMEDIATE` transaction upon collection.

---

## 4. Digital Payment Configuration (Stripe UAE AED + Sandbox Mode)

### Option A: UAE AED Sandbox Mode (Default when `STRIPE_SECRET_KEY` is blank)
When no live Stripe credentials are configured, checkout operates as a **clearly labelled UAE AED Sandbox Payment Environment**:
- Supports testing **Authorized Payment (`succeeded`)**, **Declined Authorization (`failed`)**, and **Pending Bank Authorization (`pending`)**.
- Enforces idempotency and duplicate-payment prevention (`409 Conflict`).
- Supports Parent pre-preparation cancellations with automatic refund status updates, as well as Administrator refunds.

### Option B: Live / Test Stripe UAE AED Gateway
To connect real Stripe Checkout in **UAE Dirhams (`AED`)**, add the following keys to `.env` (or Netlify Environment Variables):
```env
STRIPE_SECRET_KEY=sk_live_or_test_...
STRIPE_PUBLISHABLE_KEY=pk_live_or_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
PUBLIC_APP_URL=https://your-school-domain.ae
```

---

## 5. Official Bright Riders School SEHHI Canteen Menu (`server/db/official-menu.ts`)

All **28 items** across **4 categories** from the official printed **Bright Riders School ADFSA & ADEK SEHHI (Al Thabiah)** canteen menu are stored dynamically in SQLite and remain 100% editable by Administrators in **Menu Management**:
- **BREAKFAST (14 items)**: *Mini Veg pizza* (`3 AED`), *Baked Samosa (Veg / Chicken)* (`3 AED`), *Mini sandwich (Labneh Cucumber, Chicken tikka, Paneer Tikka, Sweet Corn)* (`3 AED`), *Fresh Fruit Cup* (`6 AED`), *Plain Croissant* (`5 AED`), *Chicken Club Sandwich* (`5 AED/pc`), *Fatayer (Cheese / Zaatar)* (`5 AED`), *Fatayer (Chicken Cheese / Labneh Zaatar, Zaatar Cheese)* (`6 AED`), *Pizza Fatayer* (`7 AED`), *Tacos (Veg / Non Veg)* (`7 AED`), *Veg club Toast* (`7 AED/pc`), *Labneh Falafel wraps* (`9 AED`), *Paneer Tikka Wrap* (`9 AED`), *Chicken Tikka (Sandwich / Wrap)* (`9 AED`).
- **HOT MEALS (7 items)**: *Veg Burger (Baked)* (`10 AED`), *Grilled Chicken Burger* (`10 AED`), *Nuggets Baked (4 PCS)* (`8 AED`), *Veg Fried Rice* (`12 AED`), *Plain Pasta (white / mix sauce)* (`12 AED`), *Chicken /Paneer Curry and Steam Rice* *(price obscured by camera flash glare on source scan — stored unguessed at `0 AED` and marked inactive until set by Admin)*, *Chicken biriyani (less oil)* (`13 AED`).
- **SNACKS & DESSERT (4 items)**: *Plain Air-Popped Popcorn* (`3 AED`), *Fruit Dessert (Low Fat)* (`9 AED`), *English cake Slice (Saffron / Vanilla)* (`2 AED`), *Low Fat Milk cake (Sugar less)* (`9 AED`).
- **DRINKS (3 items)**: *Fruit Juice / Milk* (`3 AED`), *Water* (`1.5 AED`), *Laben - up* (`3 AED`).

---

## 6. Installation, Testing & Local Development

```bash
# 1. Install dependencies (Node.js 18+ — no native modules, no experimental flags)
npm install

# 2. Initialize the SQLite database (2 permanent Admins + 28 official SEHHI menu items)
npm run db:init

# 3. Run the full 12-suite End-to-End Integration Test Suite
npm test

# 4. Build production client & Netlify Function bundle, or start full-stack server on 0.0.0.0:3000
npm run build
npm start
```

### Verifying the deployed Netlify artifact (recommended before every deployment)

These harnesses load the **exact artifact Netlify deploys** (`dist/functions/api.cjs`) and run it with
`require('node:sqlite')` deliberately blocked (`ERR_UNKNOWN_BUILTIN_MODULE`) — i.e. the AWS Lambda
runtime that previously returned `502 Bad Gateway` on sign-in.

```bash
# Sign-in / menu / routing checks against the serverless bundle over real HTTP
npm run verify:serverless

# Two genuine cold starts, with the SQLite snapshot round-tripping through a mock Netlify Blobs API
npm run verify:blobs

# Drives the real React login page (4 role cards → Admin form → submit) against the bundle
npm run verify:login-ui

# All of the above, after a fresh build
npm run verify
```

The live-credential checks read the permanent Admin passwords from the environment
(`BRS_ADMIN_ONE_PASSWORD` / `BRS_ADMIN_TWO_PASSWORD`) and are skipped when those are unset, so no
plaintext password is ever stored in this repository.

---

## 7. Deploying to Netlify (Zero-Config Ready)

This repository is pre-configured to deploy out-of-the-box on **Netlify** via [`netlify.toml`](./netlify.toml) and [`.nvmrc`](./.nvmrc):
1. Push this repository to GitHub and import it in **Netlify → Add new site → Import an existing project**.
2. Netlify automatically detects `Build command: npm run build`, `Publish directory: dist/client`, `Functions directory: dist/functions`, and `Node.js 22`. The function is bundled as a **self-contained CommonJS file with no `node:*`-experimental or native dependencies**, which is what makes sign-in reliable across every Lambda runtime generation.
3. Strongly recommended production environment variables in **Netlify → Site configuration → Environment variables**:
   - `JWT_SECRET` — strong random 64-character secret
   - `QR_HMAC_SECRET` — strong random 64-character secret
   - *(Optional)* `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`
4. Click **Deploy site** — all 4 role portals, the 2 permanent Administrator accounts, and the 28-item Bright Riders SEHHI menu persist automatically via `@netlify/blobs`.

### Shared database and account reset

Netlify Functions use one strongly consistent Blobs snapshot for both administrators. Storage failures and concurrent writes fail visibly instead of reporting a successful change that was not saved. The account reset runs once, preserving the two permanent administrators and creating three demo profiles. If existing non-admin users have order, payment or collection history, the reset and demo seeding are skipped to protect financial records; consult the function logs and handle the history manually. The deployment must have Netlify Blobs configured with strong consistency. The demo password is intentionally insecure; do not use this setup with real student or financial data.

The snapshot-based serverless storage is not a substitute for a transactional database for live payment processing: a conflict or storage failure after an external payment provider call may require reconciliation. Use a transactional database and payment reconciliation before accepting real payments.
