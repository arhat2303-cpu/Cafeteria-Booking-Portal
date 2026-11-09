# Bright Riders Digital Canteen — API Reference

All endpoints are served under `/api/*` and enforce `HttpOnly` session cookie authentication (`brs_canteen_session`) or `Authorization: Bearer <jwt>` across the **4 official roles** (`student`, `parent`, `chef`, `admin`).

---

## 1. System & Real-Time Events
- `GET /api/health` — Service health & active payment mode (`stripe` | `brs_sandbox_aed`).
- `GET /api/events/stream` — Authenticated Server-Sent Events (SSE) stream pushing `order.created`, `order.updated`, `order.collected`, `menu.updated`, `payment.updated`, and `settings.updated` (returns `{ mode: 'polling' }` on serverless platforms).

---

## 2. Authentication & Profile (`/api/auth`)
- `GET /api/auth/public-config` — Public school name, campus, break slots, cancellation cutoff, and payment mode.
- `POST /api/auth/login` — Authenticate user (`{ username, password, expectedRole? }`).
- `POST /api/auth/register` — Parent self-registration (`{ fullName, username, password, email, phone, address, studentCode?, relationship? }`).
- `POST /api/auth/logout` — Revoke current session in `user_sessions` and clear cookie.
- `GET /api/auth/me` — Current user profile, role metadata, and linked children/parents.
- `PUT /api/auth/profile` — Update contact details, address, or linked child dietary/allergy notes.
- `POST /api/auth/change-password` — Verify current password, hash new password, and revoke other sessions.
- `POST /api/auth/link-child` *(Parent)* — Link an enrolled student via `{ studentCode, studentUsername, relationship }`.

---

## 3. Canteen Menu & Scheduling (`/api/menu`)
- `GET /api/menu?date=YYYY-MM-DD&search=...` — Retrieve active categories, exact AED prices, and date-aware scheduled availability.
- `POST /api/menu/categories` / `PUT /api/menu/categories/:id` / `DELETE /api/menu/categories/:id` *(Admin)* — Manage food categories.
- `POST /api/menu/upload-image` *(Admin)* — Multipart food image upload (`JPEG`/`PNG`/`WEBP`, max 5 MB, magic-byte verified, persisted in SQLite `uploaded_files`).
- `POST /api/menu/items` / `PUT /api/menu/items/:id` / `PATCH /api/menu/items/:id/availability` / `DELETE /api/menu/items/:id` *(Admin)* — Full menu item CRUD.
- `POST /api/menu/items/:id/schedules` / `DELETE /api/menu/schedules/:scheduleId` *(Admin)* — Manage weekday (`0-6`) and date-specific (`YYYY-MM-DD`) availability rules.
- `POST /api/menu/bulk-import` *(Admin)* — Bulk import structured official school canteen categories and items.

---

## 4. Persistent Shopping Cart (`/api/cart`) — *Parent Only*
- `GET /api/cart` — Fetch current parent's persistent cart and itemised AED totals.
- `PUT /api/cart/meta` — Update `{ beneficiaryUserId, orderDate, collectionSlot, specialInstructions }`.
- `POST /api/cart/items` — Add item `{ menuItemId, quantity, itemNotes }`.
- `PATCH /api/cart/items/:menuItemId` — Update quantity (`<= 0` removes item).
- `DELETE /api/cart` — Clear shopping cart.

---

## 5. Orders & QR Passes (`/api/orders`)
- `POST /api/orders` *(Parent)* — Create order for a linked child from cart or items array with `idempotencyKey`.
- `GET /api/orders` — Role-scoped order list (`Parent` sees orders placed; `Student` sees their paid orders; `Admin` supports full filters).
- `GET /api/orders/:id` — Retrieve single order with status timeline.
- `GET /api/orders/:id/qr` *(Parent, Student, Admin)* — Retrieve unique cryptographic QR verification token & PNG Data URL for a paid order.
- `POST /api/orders/:id/cancel` *(Parent, Admin)* — Cancel eligible order (automatically triggers refund & QR revocation if paid).
- `PATCH /api/orders/:id/status` *(Admin)* — Administrative status override.

---

## 6. Digital Payments (`/api/payments`)
- `POST /api/payments/checkout` *(Parent)* — Process Stripe AED Checkout or UAE AED Sandbox payment (`{ orderId, paymentMethodType, sandboxOutcome, idempotencyKey }`), preventing duplicate payments (`409`).
- `GET /api/payments/stripe/verify-session` *(Parent)* — Verify completed Stripe Checkout session.
- `POST /api/payments/:transactionId/resolve-pending` *(Parent, Admin)* — Authorize or decline a pending sandbox payment.
- `GET /api/payments` *(Parent, Admin)* — Payment history & transaction ledger.
- `POST /api/payments/:transactionId/refund` *(Admin)* — Issue payment refund and record audit entry.

---

## 7. Chef Kitchen Display & QR Scanner (`/api/chef`) — *Chef & Admin*
- `GET /api/chef/orders` — Paid kitchen queue grouped/filtered by `date`, `slot`, `status`, and `search`.
- `PATCH /api/chef/orders/:id/prep-status` — Mark paid order as `preparing` or `ready_for_collection`.
- `POST /api/chef/verify-qr` — Validate scanned QR code (`{ qrPayload }`) against HMAC signature and database state.
- `POST /api/chef/verify-order` — Manual Order ID verification backup (`{ orderNumber }`).
- `POST /api/chef/confirm-collection` — Atomically record student meal collection and lock QR token against reuse (`409` on duplicate attempt).

---

## 8. Administration & Analytics (`/api/admin`) — *Admin Only*
- `GET /api/admin/overview` — User counts (`student`, `parent`, `chef`, `admin`), order counts, daily/weekly/monthly/total AED revenue, 14-day revenue series, popular items, and class breakdown.
- `GET /api/admin/users` / `POST /api/admin/users` / `PUT /api/admin/users/:id` / `PATCH /api/admin/users/:id/status` / `POST /api/admin/users/:id/reset-password` / `DELETE /api/admin/users/:id` — Full lifecycle user management across the 4 official roles.
- `POST /api/admin/parent-links` / `DELETE /api/admin/parent-links/:linkId` — Manage Parent-Student relationships.
- `GET /api/admin/reports` & `GET /api/admin/reports/export?type=...` — Comprehensive analytics & CSV downloads (`daily_sales`, `weekly_sales`, `monthly_sales`, `popular_items`, `student_orders`, `class_orders`, `payments`).
- `GET /api/admin/settings` / `PUT /api/admin/settings` — Update school canteen policies (`cancellationCutoffMinutes`, `collectionSlots`).
- `GET /api/admin/audit-logs` — Inspect administrative activity audit trail.
