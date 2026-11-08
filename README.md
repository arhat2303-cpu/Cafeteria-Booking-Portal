# Bright Riders School — Digital Canteen Ordering & Payment Solution (`SmartCanteen`)

A complete, full-stack, role-based cashless canteen ordering, digital AED payment, kitchen preparation, and QR-verified meal collection platform built specifically for **Bright Riders School (Abu Dhabi, UAE)**.

---

## 1. Platform Overview

**Bright Riders SmartCanteen** replaces physical cash handling and fragmented paper menus with one secure, real-time school dining ecosystem across **five distinct user roles**:

| Role | Portal Capabilities |
| :--- | :--- |
| **Administrator** | Executive KPI & 14-day revenue analytics, complete User Management across all 5 roles, Parent-Student account linking, Menu & Category CRUD with food image uploads & date/weekday scheduling, Order & Payment Management, Refunds, CSV report exports, and Security Activity Logs. |
| **Parent** | Self-registration & secure login, linked child selector, live canteen menu browsing with date-aware availability, persistent shopping cart, collection break-slot scheduling, special kitchen notes, itemized AED digital checkout, live order progress tracking, payment receipts, order cancellation, and child QR Pass access. |
| **Student** | Dedicated cashless campus dining pass showing student profile, upcoming pre-paid meals, food quantities, break collection times, live preparation status, and single-use scannable Order QR Codes — zero cash required. |
| **Teacher** | Faculty dining portal with staff profile, canteen menu browsing, personal meal ordering & digital checkout (configurable by Administrator), live order tracking, and personal QR Meal Collection Pass. |
| **Chef** | Mobile- and tablet-optimized Kitchen Display System (KDS) grouped by collection break slot, allergy & special-instruction alerts, one-tap *Preparing* / *Ready for Collection* status updates, live WebRTC **Camera QR Scanner**, QR PNG image scanner, Manual Order ID lookup, and atomic single-use **Confirm Collection** verification. |

---

## 2. Technology Stack & Architecture

- **Frontend**: React 18, TypeScript, Vite 5, Tailwind CSS, Lucide Icons, `qrcode`, `jsqr` (WebRTC camera & canvas QR decoder), custom interactive SVG data visualizations, and real-time Server-Sent Events (`EventSource`).
- **Backend**: Node.js 22, Express 4, TypeScript (`tsx`), `bcryptjs` (12-round password hashing), `jsonwebtoken` + `user_sessions` revocation table, `busboy` (multipart upload with binary magic-byte verification), and `stripe` (official Stripe SDK for UAE AED Checkout).
- **Database**: Persistent relational **SQLite** (`node:sqlite` in WAL mode with `PRAGMA foreign_keys = ON` and `BEGIN IMMEDIATE` ACID transactions) across **20 normalized tables** (`server/db/schema.sql`).

### Database Entities (`server/db/schema.sql`)
1. `users` — Shared authentication table for `admin`, `parent`, `student`, `teacher`, and `chef`
2. `role_permissions` — Role-level permission matrix
3. `user_sessions` — Active JWT sessions (`token_jti`) enabling instant revocation on password reset or deactivation
4. `parent_profiles` — Parent contact & residential details
5. `student_profiles` — Student ID (`BRS-STU-...`), Class, Section, House, and Allergy/Dietary alerts
6. `parent_student_links` — Verified many-to-many Parent-Child relationships
7. `teacher_profiles` — Staff ID (`BRS-TCH-...`), Department, Homeroom, ordering override
8. `chef_profiles` — Kitchen Staff ID (`BRS-CHF-...`), Station, Shift
9. `platform_settings` — School configuration, collection break slots, cancellation cutoff, and `teacher_ordering_enabled`
10. `food_categories` — Menu categories & display order
11. `menu_items` — Exact menu items stored in integer **fils** (`1 AED = 100 fils`) for exact financial precision
12. `menu_availability_schedules` — Day-of-week schedules and specific-date menu overrides
13. `shopping_carts` & 14. `shopping_cart_items` — Persistent server-side shopping carts
15. `orders` — Order records (`BRS-YYYYMMDD-XXXXX`) with idempotency protection
16. `order_items` — Historical item name and unit price snapshots
17. `payment_transactions` — Digital payment ledger (`TXN-BRS-...`) supporting `succeeded`, `failed`, `pending`, and `refunded` states (never stores card numbers or CVVs)
18. `qr_verification_tokens` — Cryptographic HMAC-SHA256 signed tokens (`BRSQR.v1.<uid>.<hmac>`) containing zero student PII
19. `collection_records` — Single-use meal collection audit records (`UNIQUE(order_id)` prevents double collection)
20. `order_status_history` & `admin_activity_logs` — Complete operational and administrative audit trails

---

## 3. Security & QR Verification Design

- **Zero Hardcoded Secrets**: No passwords, API keys, or secrets exist in frontend source code or committed repository files. On first local run, `server/config.ts` generates strong 256-bit cryptographic secrets into a gitignored `.env` file.
- **Session Revocation**: Authentication uses `HttpOnly`, `SameSite=Lax` cookies backed by `user_sessions`. Resetting a user's password or deactivating an account immediately revokes active sessions on the backend.
- **Strict Ownership & RBAC**: Every sensitive endpoint enforces role and ownership checks on the backend (Parents can only view/order for linked children; Students only see their own paid orders; Chefs cannot modify users, prices, or payment settings).
- **Cryptographic Zero-PII QR Codes**: Every paid order receives a unique `BRSQR.v1.<128-bit-uid>.<hmac-sha256>` token verified with `crypto.timingSafeEqual` and locked inside an atomic SQLite `BEGIN IMMEDIATE` transaction upon collection so no QR code can ever be forged, guessed, or collected twice.
- **Binary Image Upload Validation**: Uploaded food photos are validated against both MIME whitelists and raw magic-byte file headers (`JPEG`, `PNG`, `WEBP`, max 5 MB).

---

## 4. Digital Payment Configuration (Stripe UAE AED + Sandbox Mode)

### Option A: Sandbox / Test Mode (Default when `STRIPE_SECRET_KEY` is blank)
When no live Stripe credentials are provided, the checkout interface operates as a **clearly labelled UAE AED Sandbox Payment Environment**:
- Supports testing **Authorized Payment (Success)**, **Declined Authorization (Failed)**, and **Pending Bank Authorization (Pending)**.
- Enforces idempotency and duplicate-payment prevention (`409 Conflict`).
- Supports Parent pre-preparation cancellations with automatic refund status updates, as well as Administrator refunds.

### Option B: Live / Test Stripe UAE AED Gateway
To connect real Stripe Checkout in **UAE Dirhams (`AED`)**, add the following keys to `.env`:
```env
STRIPE_SECRET_KEY=sk_live_or_test_...
STRIPE_PUBLISHABLE_KEY=pk_live_or_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
PUBLIC_APP_URL=https://your-school-domain.ae
```
Once `STRIPE_SECRET_KEY` is set, `/api/payments/checkout` automatically creates PCI-compliant Stripe Checkout Sessions in `AED` and verifies payment completion before issuing order QR codes.

---

## 5. Installation & Local Development

### Prerequisites
- **Node.js v22.5+** (uses Node's built-in native SQLite engine `node:sqlite`)
- **npm v10+**

### Setup
```bash
# 1. Install dependencies
npm install

# 2. (Optional) Copy .env.example to .env and customize secrets / Stripe keys
# If omitted, strong local secrets are generated automatically into .env on first start
cp .env.example .env

# 3. Initialize the SQLite database schema & bootstrap accounts
npm run db:init

# 4. Start the unified full-stack development server on http://0.0.0.0:3000
npm run dev
```

---

## 6. Running Automated End-to-End Tests

Run the full integration test suite against an isolated SQLite database:
```bash
npm test
```
`tests/e2e.test.ts` verifies:
1. Authentication for all 5 roles + invalid credential rejection
2. Strict backend RBAC & ownership isolation
3. Admin user creation, parent-student linking, editing, password reset session revocation, activation/deactivation, and deletion
4. Food image magic-byte validation, menu CRUD, AED price editing, and date-specific availability scheduling
5. Failed, Pending, and Succeeded digital payments + duplicate payment prevention (`409`)
6. Student QR pass generation (zero PII) & Chef preparation workflow (`confirmed → preparing → ready_for_collection → collected`)
7. Forged QR rejection, unpaid order rejection, valid QR verification, and atomic double-collection prevention (`409`)
8. Teacher ordering administrative toggle, CSV report exports, and SQLite disk persistence across restarts

---

## 7. Production Build & Deployment

```bash
# Compile TypeScript check & build optimized Vite client bundle into dist/client
npx tsc --noEmit
npm run build

# Run production server
npm start
```

For production deployment at Bright Riders School:
1. Provision a Linux VM or container running **Node.js 22 LTS** behind HTTPS (`Nginx` / `Caddy` / Cloud Load Balancer) — HTTPS is required by browsers to enable WebRTC camera access (`getUserMedia`) on Chef tablets and phones.
2. Mount a persistent volume for `server/data/` (SQLite WAL database) and `server/uploads/menu/` (uploaded food images), and schedule daily `sqlite3 .backup` snapshots.
3. Configure strong `JWT_SECRET`, `QR_HMAC_SECRET`, and live UAE `STRIPE_SECRET_KEY` values in `.env`.

---

## 8. Additional Documentation
- [`docs/API_REFERENCE.md`](./docs/API_REFERENCE.md) — Complete REST & SSE API endpoint reference
- [`docs/DEMONSTRATION_VIDEO_GUIDE.md`](./docs/DEMONSTRATION_VIDEO_GUIDE.md) — Complete 10-Scene Exhibition Demonstration Video Storyboard, Narration Script & Recording Guide
