# Bright Riders SmartCanteen — API Reference

All endpoints are served under `/api/*` and enforce `HttpOnly` session cookie authentication (`brs_canteen_session`) or `Authorization: Bearer <jwt>`.

---

## 1. System & Real-Time Events
- `GET /api/health` — Service health & active payment mode (`stripe` | `brs_sandbox_aed`).
- `GET /api/events/stream` — Authenticated Server-Sent Events (SSE) stream pushing `order.created`, `order.updated`, `order.collected`, `menu.updated`, `payment.updated`, and `settings.updated`.

---

## 2. Authentication & Profile (`/api/auth`)
- `GET /api/auth/public-config` — Public school name, campus, break slots, and payment mode.
- `POST /api/auth/login` — Authenticate any of the 5 roles (`{ username, password }`).
- `POST /api/auth/register` — Parent self-registration (`{ fullName, username, password, email, phone, address, studentCode?, relationship? }`).
- `POST /api/auth/logout` — Revoke current session in `user_sessions` and clear cookie.
- `GET /api/auth/me` — Current user profile, role metadata, and linked children/parents.
- `PUT /api/auth/profile` — Update contact details, address, or linked child dietary/allergy notes.
- `POST /api/auth/change-password` — Verify current password, hash new password, and revoke other sessions.
- `POST /api/auth/link-child` *(Parent)* — Link an enrolled student via `{ studentCode, studentUsername, relationship }`.

---

## 3. Canteen Menu & Scheduling (`/api/menu`)
- `GET /api/menu?date=YYYY-MM-DD&search=...` — Retrieve active categories, exact AED prices, and date-aware scheduled availability.
- `POST /api/menu/categories` *(Admin)* — Create food category.
- `PUT /api/menu/categories/:id` *(Admin)* — Edit food category.
- `DELETE /api/menu/categories/:id` *(Admin)* — Delete empty food category.
- `POST /api/menu/upload-image` *(Admin)* — Multipart food image upload (`JPEG`/`PNG`/`WEBP`, max 5 MB, magic-byte verified).
- `POST /api/menu/items` *(Admin)* — Add menu item (`{ categoryId, name, description, priceAed, imageUrl, isVegetarian, calories, allergens }`).
- `PUT /api/menu/items/:id` *(Admin)* — Edit menu item details or AED price.
- `PATCH /api/menu/items/:id/availability` *(Admin)* — Toggle item availability.
- `DELETE /api/menu/items/:id` *(Admin)* — Delete menu item.
- `POST /api/menu/items/:id/schedules` *(Admin)* — Schedule weekday (`dayOfWeek: 0-6`) or date-specific (`specificDate: YYYY-MM-DD`) availability.
- `DELETE /api/menu/schedules/:scheduleId` *(Admin)* — Remove schedule rule.
- `POST /api/menu/bulk-import` *(Admin)* — Bulk import structured official school canteen categories and items.

---

## 4. Persistent Shopping Cart (`/api/cart`) — *Parent & Teacher*
- `GET /api/cart` — Fetch current user's persistent cart and itemized AED totals.
- `PUT /api/cart/meta` — Update `{ beneficiaryUserId, orderDate, collectionSlot, specialInstructions }`.
- `POST /api/cart/items` — Add item `{ menuItemId, quantity, itemNotes }`.
- `PATCH /api/cart/items/:menuItemId` — Update quantity (`<= 0` removes item).
- `DELETE /api/cart` — Clear shopping cart.

---

## 5. Orders & QR Passes (`/api/orders`)
- `POST /api/orders` *(Parent, Teacher)* — Create order from cart or items array with `idempotencyKey`.
- `GET /api/orders` — Role-scoped order list (supports Admin filters: `status`, `paymentStatus`, `date`, `studentId`, `className`, `search`).
- `GET /api/orders/:id` — Retrieve single order with status timeline.
- `GET /api/orders/:id/qr` *(Parent, Student, Teacher, Admin)* — Retrieve unique cryptographic QR verification token & PNG Data URL for a paid order.
- `POST /api/orders/:id/cancel` *(Parent, Teacher, Admin)* — Cancel eligible order (automatically triggers refund & QR revocation if paid).
- `PATCH /api/orders/:id/status` *(Admin)* — Administrative status override.

---

## 6. Digital Payments (`/api/payments`)
- `POST /api/payments/checkout` *(Parent, Teacher)* — Process Stripe AED Checkout or UAE AED Sandbox payment (`{ orderId, paymentMethodType, sandboxOutcome, idempotencyKey }`), preventing duplicate payments (`409`).
- `GET /api/payments/stripe/verify-session` — Verify completed Stripe Checkout session.
- `POST /api/payments/:transactionId/resolve-pending` — Authorize or decline a pending sandbox payment.
- `GET /api/payments` *(Parent, Teacher, Admin)* — Payment history & transaction ledger.
- `POST /api/payments/:transactionId/refund` *(Admin)* — Issue payment refund and record audit entry.

---

## 7. Chef Kitchen Display & QR Scanner (`/api/chef`) — *Chef & Admin*
- `GET /api/chef/orders` — Paid kitchen queue grouped/filtered by `date`, `slot`, `status`, and `search`.
- `PATCH /api/chef/orders/:id/prep-status` — Mark paid order as `preparing` or `ready_for_collection`.
- `POST /api/chef/verify-qr` — Validate scanned QR code (`{ qrPayload }`) against HMAC signature and database state.
- `POST /api/chef/verify-order` — Manual Order ID verification backup (`{ orderNumber }`).
- `POST /api/chef/confirm-collection` — Atomically record student/staff meal collection and lock QR token against reuse (`409` on duplicate attempt).

---

## 8. Administration & Analytics (`/api/admin`) — *Admin Only*
- `GET /api/admin/overview` — User counts, order counts, daily/weekly/monthly/total AED revenue, 14-day revenue series, popular items, and class breakdown.
- `GET /api/admin/users` / `POST /api/admin/users` / `PUT /api/admin/users/:id` / `PATCH /api/admin/users/:id/status` / `POST /api/admin/users/:id/reset-password` / `DELETE /api/admin/users/:id` — Full lifecycle user management.
- `POST /api/admin/parent-links` / `DELETE /api/admin/parent-links/:linkId` — Manage Parent-Student relationships.
- `GET /api/admin/reports` — Comprehensive sales, popularity, student, class-wise, and completion rate analytics.
- `GET /api/admin/reports/export?type=...` — Download CSV report (`daily_sales`, `weekly_sales`, `monthly_sales`, `popular_items`, `student_orders`, `class_orders`, `payments`).
- `GET /api/admin/settings` / `PUT /api/admin/settings` — Update school canteen policies (`teacherOrderingEnabled`, `cancellationCutoffMinutes`, `collectionSlots`).
- `GET /api/admin/audit-logs` — Inspect administrative activity audit trail.
