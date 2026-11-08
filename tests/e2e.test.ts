import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { AppDatabase, initializeSchemaAndDefaults, setDbForTesting } from '../server/db/connection.js';
import { createApiApp } from '../server/app.js';

const testDbPath = path.resolve(process.cwd(), 'tests/e2e-canteen.sqlite');

function cleanupTestDb() {
  for (const suffix of ['', '-wal', '-shm']) {
    const f = `${testDbPath}${suffix}`;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

class TestClient {
  private cookie = '';
  constructor(private baseUrl: string) {}

  async request(
    method: string,
    urlPath: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {}
  ): Promise<{ status: number; data: any; headers: Headers }> {
    const headers: Record<string, string> = { ...extraHeaders };
    if (this.cookie) headers.Cookie = this.cookie;

    let payload: BodyInit | undefined;
    if (body instanceof FormData) {
      payload = body;
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }

    const res = await fetch(`${this.baseUrl}${urlPath}`, {
      method,
      headers,
      body: payload,
    });

    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      this.cookie = setCookie.split(';')[0];
    }

    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('application/json') ? await res.json() : await res.text();
    return { status: res.status, data, headers: res.headers };
  }
}

// Minimal valid 1x1 PNG buffer for testing binary magic-byte upload validation
const VALID_1X1_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

async function runTests() {
  console.log('=== Bright Riders SmartCanteen — End-to-End Integration Test Suite ===\n');
  cleanupTestDb();

  const ADMIN_PW = 'TestAdmin#2026!';
  const DEMO_PW = 'TestCampus#2026!';

  const db = new AppDatabase(testDbPath);
  initializeSchemaAndDefaults(db, {
    adminPassword: ADMIN_PW,
    demoPassword: DEMO_PW,
    seedDemoAccounts: true,
  });
  setDbForTesting(db);

  const app = createApiApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  let passed = 0;
  const step = async (name: string, fn: () => Promise<void>) => {
    process.stdout.write(`  • ${name} ... `);
    await fn();
    passed++;
    console.log('PASS');
  };

  try {
    const adminClient = new TestClient(baseUrl);
    const parentClient = new TestClient(baseUrl);
    const studentClient = new TestClient(baseUrl);
    const teacherClient = new TestClient(baseUrl);
    const chefClient = new TestClient(baseUrl);
    const anonClient = new TestClient(baseUrl);

    // 1. AUTHENTICATION & RBAC
    await step('Rejects unauthenticated access & invalid login credentials', async () => {
      const me = await anonClient.request('GET', '/api/auth/me');
      assert.equal(me.status, 401);

      const bad = await anonClient.request('POST', '/api/auth/login', {
        username: 'admin',
        password: 'WrongPassword123!',
      });
      assert.equal(bad.status, 401);
    });

    await step('Authenticates all 5 user roles (Admin, Parent, Student, Teacher, Chef)', async () => {
      const a = await adminClient.request('POST', '/api/auth/login', {
        username: 'admin',
        password: ADMIN_PW,
      });
      assert.equal(a.status, 200);
      assert.equal(a.data.user.role, 'admin');

      const p = await parentClient.request('POST', '/api/auth/login', {
        username: 'parent.fatima',
        password: DEMO_PW,
      });
      assert.equal(p.status, 200);
      assert.equal(p.data.user.role, 'parent');
      assert.equal(p.data.user.children.length, 2);

      const s = await studentClient.request('POST', '/api/auth/login', {
        username: 'student.zayed',
        password: DEMO_PW,
      });
      assert.equal(s.status, 200);
      assert.equal(s.data.user.role, 'student');

      const t = await teacherClient.request('POST', '/api/auth/login', {
        username: 'teacher.anita',
        password: DEMO_PW,
      });
      assert.equal(t.status, 200);
      assert.equal(t.data.user.role, 'teacher');

      const c = await chefClient.request('POST', '/api/auth/login', {
        username: 'chef.rashid',
        password: DEMO_PW,
      });
      assert.equal(c.status, 200);
      assert.equal(c.data.user.role, 'chef');
    });

    await step('Enforces strict backend role restrictions across protected routes', async () => {
      // Student cannot access Admin, Payments, Cart, or Chef endpoints
      assert.equal((await studentClient.request('GET', '/api/admin/overview')).status, 403);
      assert.equal((await studentClient.request('GET', '/api/payments')).status, 403);
      assert.equal((await studentClient.request('GET', '/api/cart')).status, 403);
      assert.equal((await studentClient.request('GET', '/api/chef/orders')).status, 403);

      // Teacher cannot access Admin or Chef endpoints
      assert.equal((await teacherClient.request('GET', '/api/admin/users')).status, 403);
      assert.equal((await teacherClient.request('GET', '/api/chef/orders')).status, 403);

      // Chef cannot manage users, edit menu prices, or view payment settings
      assert.equal((await chefClient.request('GET', '/api/admin/users')).status, 403);
      assert.equal(
        (
          await chefClient.request('POST', '/api/menu/categories', {
            name: 'Unauthorized Chef Cat',
          })
        ).status,
        403
      );
      assert.equal((await chefClient.request('GET', '/api/payments')).status, 403);
    });

    // 2. USER MANAGEMENT
    let tempStudentId = 0;
    let tempParentId = 0;

    await step('Admin creates, links, edits, resets password, deactivates & deletes accounts', async () => {
      // Create Parent
      const createParent = await adminClient.request('POST', '/api/admin/users', {
        role: 'parent',
        fullName: 'Omar Al Nuaimi',
        username: 'parent.omar',
        password: 'InitialPassword#1',
        email: 'omar@example.ae',
        phone: '+971501112233',
      });
      assert.equal(createParent.status, 201);
      tempParentId = createParent.data.user.id;

      // Create Student
      const createStudent = await adminClient.request('POST', '/api/admin/users', {
        role: 'student',
        fullName: 'Hamdan Al Nuaimi',
        username: 'student.hamdan',
        password: 'InitialPassword#1',
        className: 'Grade 4-C',
        studentCode: 'BRS-STU-2026-999',
      });
      assert.equal(createStudent.status, 201);
      tempStudentId = createStudent.data.user.id;

      // Link Parent & Student
      const linkRes = await adminClient.request('POST', '/api/admin/parent-links', {
        parentUserId: tempParentId,
        studentUserId: tempStudentId,
        relationship: 'Father',
      });
      assert.equal(linkRes.status, 201);
      assert.equal(linkRes.data.parent.linkedChildren.length, 1);

      // Edit Student Class
      const editRes = await adminClient.request('PUT', `/api/admin/users/${tempStudentId}`, {
        className: 'Grade 4-D',
      });
      assert.equal(editRes.status, 200);
      assert.equal(editRes.data.user.className, 'Grade 4-D');

      // Login as tempParent, then reset password and verify old session is revoked
      const tempParentClient = new TestClient(baseUrl);
      assert.equal(
        (
          await tempParentClient.request('POST', '/api/auth/login', {
            username: 'parent.omar',
            password: 'InitialPassword#1',
          })
        ).status,
        200
      );

      const resetRes = await adminClient.request(
        'POST',
        `/api/admin/users/${tempParentId}/reset-password`,
        { newPassword: 'UpdatedPassword#2' }
      );
      assert.equal(resetRes.status, 200);

      // Old session must now be 401
      assert.equal((await tempParentClient.request('GET', '/api/auth/me')).status, 401);

      // Deactivate account and verify login is blocked (403)
      await adminClient.request('PATCH', `/api/admin/users/${tempParentId}/status`, {
        isActive: false,
      });
      assert.equal(
        (
          await tempParentClient.request('POST', '/api/auth/login', {
            username: 'parent.omar',
            password: 'UpdatedPassword#2',
          })
        ).status,
        403
      );

      // Delete temporary unused accounts
      assert.equal(
        (await adminClient.request('DELETE', `/api/admin/users/${tempStudentId}`)).status,
        200
      );
      assert.equal(
        (await adminClient.request('DELETE', `/api/admin/users/${tempParentId}`)).status,
        200
      );
    });

    // 3. MENU MANAGEMENT & IMAGE UPLOAD VALIDATION
    let catId = 0;
    let item1Id = 0;
    let item2Id = 0;

    await step('Validates food image magic bytes & manages menu items, prices, and schedules', async () => {
      // Reject fake image containing script bytes disguised with image/png MIME
      const badForm = new FormData();
      badForm.append(
        'image',
        new Blob([Buffer.from('<script>alert(1)</script>')], { type: 'image/png' }),
        'fake.png'
      );
      const badUpload = await adminClient.request('POST', '/api/menu/upload-image', badForm);
      assert.equal(badUpload.status, 400);

      // Accept real PNG image
      const goodForm = new FormData();
      goodForm.append(
        'image',
        new Blob([VALID_1X1_PNG], { type: 'image/png' }),
        'valid-meal.png'
      );
      const goodUpload = await adminClient.request('POST', '/api/menu/upload-image', goodForm);
      assert.equal(goodUpload.status, 201);
      assert.ok(goodUpload.data.imageUrl.startsWith('/uploads/menu/'));

      // Clean up test uploaded image afterwards so we keep uploads clean
      const uploadedDiskFile = path.resolve(
        process.cwd(),
        'server',
        goodUpload.data.imageUrl.replace(/^\//, '')
      );
      if (fs.existsSync(uploadedDiskFile)) fs.unlinkSync(uploadedDiskFile);

      // Create category & items
      const catRes = await adminClient.request('POST', '/api/menu/categories', {
        name: 'Fresh Wraps & Sandwiches',
        description: 'Prepared daily in Bright Riders kitchen',
      });
      assert.equal(catRes.status, 201);
      catId = catRes.data.id;

      const it1 = await adminClient.request('POST', '/api/menu/items', {
        categoryId: catId,
        name: 'Grilled Halloumi Wrap',
        description: 'Warm tortilla wrap with grilled halloumi and cucumber',
        priceAed: 12.5,
        isVegetarian: true,
      });
      assert.equal(it1.status, 201);
      item1Id = it1.data.id;
      assert.equal(it1.data.priceFils, 1250);

      const it2 = await adminClient.request('POST', '/api/menu/items', {
        categoryId: catId,
        name: 'Fresh Orange Juice',
        priceAed: 6.0,
        isVegetarian: true,
      });
      assert.equal(it2.status, 201);
      item2Id = it2.data.id;

      // Edit item price
      const editPrice = await adminClient.request('PUT', `/api/menu/items/${item1Id}`, {
        priceAed: 13.0,
      });
      assert.equal(editPrice.status, 200);
      assert.equal(editPrice.data.priceAed, 13);

      // Schedule item2 as unavailable on a future test date (2026-12-15)
      const schedRes = await adminClient.request(
        'POST',
        `/api/menu/items/${item2Id}/schedules`,
        {
          specificDate: '2026-12-15',
          isAvailable: false,
          specialNote: 'Not served during exam half-day',
        }
      );
      assert.equal(schedRes.status, 201);

      const menuOnBlockedDate = await parentClient.request('GET', '/api/menu?date=2026-12-15');
      const juiceOnBlockedDate = menuOnBlockedDate.data.items.find((i: any) => i.id === item2Id);
      assert.equal(juiceOnBlockedDate.availableOnDate, false);
    });

    // 4. ORDERING & DIGITAL PAYMENTS (FAILED, PENDING, SUCCESS, DUPLICATE PREVENTION)
    const todayIso = new Date().toISOString().slice(0, 10);
    let paidOrderId = 0;
    let paidOrderNumber = '';

    await step('Handles failed & pending payments without issuing QR or allowing collection', async () => {
      const parentMe = await parentClient.request('GET', '/api/auth/me');
      const zayed = parentMe.data.user.children.find(
        (c: any) => c.username === 'student.zayed'
      );
      assert.ok(zayed);

      // Create an order and test FAILED payment
      const ordFailRes = await parentClient.request('POST', '/api/orders', {
        beneficiaryUserId: zayed.id,
        orderDate: todayIso,
        collectionSlot: 'Morning Recess (09:45 AM – 10:15 AM)',
        items: [{ menuItemId: item1Id, quantity: 1 }],
      });
      assert.equal(ordFailRes.status, 201);
      const unpaidOrderId = ordFailRes.data.order.id;
      const unpaidOrderNum = ordFailRes.data.order.orderNumber;

      const failPay = await parentClient.request('POST', '/api/payments/checkout', {
        orderId: unpaidOrderId,
        sandboxOutcome: 'failed',
      });
      assert.equal(failPay.status, 402);

      // QR endpoint must reject unpaid order
      const qrAttempt = await parentClient.request('GET', `/api/orders/${unpaidOrderId}/qr`);
      assert.equal(qrAttempt.status, 400);

      // Chef manual verify must reject unpaid order with exact message
      const chefVerifyUnpaid = await chefClient.request('POST', '/api/chef/verify-order', {
        orderNumber: unpaidOrderNum,
      });
      assert.equal(chefVerifyUnpaid.status, 400);
      assert.equal(
        chefVerifyUnpaid.data.message,
        'Payment not completed. This order cannot be collected.'
      );

      // Test PENDING payment then authorize it
      const pendingPay = await parentClient.request('POST', '/api/payments/checkout', {
        orderId: unpaidOrderId,
        sandboxOutcome: 'pending',
      });
      assert.equal(pendingPay.status, 200);
      assert.equal(pendingPay.data.status, 'pending');

      const payList = await parentClient.request('GET', '/api/payments?status=pending');
      const pendingTxn = payList.data.transactions.find(
        (t: any) => t.transactionRef === pendingPay.data.transactionRef
      );
      assert.ok(pendingTxn);

      // Cancel the test unpaid/pending order cleanly
      const cancelPending = await parentClient.request(
        'POST',
        `/api/orders/${unpaidOrderId}/cancel`
      );
      assert.equal(cancelPending.status, 200);
    });

    await step('Completes full Parent Cart -> Checkout -> Paid Confirmation & prevents duplicate payments', async () => {
      const parentMe = await parentClient.request('GET', '/api/auth/me');
      const zayed = parentMe.data.user.children.find(
        (c: any) => c.username === 'student.zayed'
      );
      assert.ok(zayed);

      await parentClient.request('PUT', '/api/cart/meta', {
        beneficiaryUserId: zayed.id,
        orderDate: todayIso,
        collectionSlot: 'Primary Lunch Break (12:00 PM – 12:40 PM)',
        specialInstructions: 'Please warm the wrap slightly',
      });

      await parentClient.request('POST', '/api/cart/items', { menuItemId: item1Id, quantity: 2 });
      const cartSnap = await parentClient.request('POST', '/api/cart/items', {
        menuItemId: item2Id,
        quantity: 1,
      });
      // 2 * 13.00 + 1 * 6.00 = 32.00 AED (3200 fils)
      assert.equal(cartSnap.data.cart.totalFils, 3200);

      const createOrd = await parentClient.request('POST', '/api/orders', {
        idempotencyKey: 'e2e-parent-order-1',
      });
      assert.equal(createOrd.status, 201);
      paidOrderId = createOrd.data.order.id;
      paidOrderNumber = createOrd.data.order.orderNumber;

      // Pay successfully
      const payOk = await parentClient.request('POST', '/api/payments/checkout', {
        orderId: paidOrderId,
        sandboxOutcome: 'succeeded',
        paymentMethodType: 'visa_sandbox',
      });
      assert.equal(payOk.status, 200);
      assert.equal(payOk.data.order.paymentStatus, 'paid');
      assert.equal(payOk.data.order.orderStatus, 'confirmed');
      assert.ok(payOk.data.qrDataUrl.startsWith('data:image/png;base64,'));

      // Duplicate payment attempt must fail with 409 Conflict
      const dupPay = await parentClient.request('POST', '/api/payments/checkout', {
        orderId: paidOrderId,
        sandboxOutcome: 'succeeded',
      });
      assert.equal(dupPay.status, 409);
    });

    // 5. STUDENT QR PASS, CHEF KDS WORKFLOW & QR SCANNER VALIDATION
    let studentSignedQrToken = '';

    await step('Student views upcoming pre-paid order & retrieves unique zero-PII QR code', async () => {
      const stuOrders = await studentClient.request('GET', '/api/orders');
      assert.equal(stuOrders.status, 200);
      const found = stuOrders.data.orders.find((o: any) => o.id === paidOrderId);
      assert.ok(found);
      assert.equal(found.items.length, 2);

      const qrPass = await studentClient.request('GET', `/api/orders/${paidOrderId}/qr`);
      assert.equal(qrPass.status, 200);
      studentSignedQrToken = qrPass.data.signedToken;
      assert.ok(studentSignedQrToken.startsWith('BRSQR.v1.'));
      // Verify QR token contains zero student PII
      assert.ok(!studentSignedQrToken.toLowerCase().includes('zayed'));
      assert.ok(!studentSignedQrToken.includes('101'));
    });

    await step('Chef updates prep status -> verifies QR -> confirms collection -> blocks double collection', async () => {
      const chefQueue = await chefClient.request('GET', '/api/chef/orders');
      assert.equal(chefQueue.status, 200);
      assert.ok(chefQueue.data.orders.some((o: any) => o.id === paidOrderId));

      // Mark Preparing
      const prep1 = await chefClient.request(
        'PATCH',
        `/api/chef/orders/${paidOrderId}/prep-status`,
        { status: 'preparing' }
      );
      assert.equal(prep1.status, 200);
      assert.equal(prep1.data.order.orderStatus, 'preparing');

      // Mark Ready for Collection
      const prep2 = await chefClient.request(
        'PATCH',
        `/api/chef/orders/${paidOrderId}/prep-status`,
        { status: 'ready_for_collection' }
      );
      assert.equal(prep2.status, 200);
      assert.equal(prep2.data.order.orderStatus, 'ready_for_collection');

      // Reject forged / invalid QR code
      const forgedScan = await chefClient.request('POST', '/api/chef/verify-qr', {
        qrPayload: 'BRSQR.v1.forgedToken1234567890.fakeSignatureabc',
      });
      assert.equal(forgedScan.status, 400);
      assert.equal(
        forgedScan.data.message,
        'Invalid QR code. Please scan a valid Bright Riders School order QR code.'
      );

      // Scan valid Student QR code
      const validScan = await chefClient.request('POST', '/api/chef/verify-qr', {
        qrPayload: studentSignedQrToken,
      });
      assert.equal(validScan.status, 200);
      assert.equal(validScan.data.valid, true);
      assert.equal(
        validScan.data.message,
        'Order verified successfully. Ready for collection confirmation.'
      );
      assert.equal(validScan.data.order.orderNumber, paidOrderNumber);
      assert.equal(validScan.data.order.studentFullName, 'Zayed Al Mansoori');

      // Confirm Collection
      const confirmRes = await chefClient.request('POST', '/api/chef/confirm-collection', {
        orderId: paidOrderId,
        verificationMethod: 'qr_scan',
        qrPayload: studentSignedQrToken,
      });
      assert.equal(confirmRes.status, 200);
      assert.equal(confirmRes.data.order.orderStatus, 'collected');

      // Prevent second collection via QR scan OR confirm-collection
      const rescan = await chefClient.request('POST', '/api/chef/verify-qr', {
        qrPayload: studentSignedQrToken,
      });
      assert.equal(rescan.status, 409);
      assert.equal(rescan.data.message, 'This order has already been collected.');

      const doubleConfirm = await chefClient.request('POST', '/api/chef/confirm-collection', {
        orderId: paidOrderId,
        verificationMethod: 'qr_scan',
        qrPayload: studentSignedQrToken,
      });
      assert.equal(doubleConfirm.status, 409);
    });

    // 6. TEACHER ORDERING TOGGLE & ADMIN REPORTS / PERSISTENCE
    await step('Enforces Admin Teacher-Ordering toggle & verifies Reports + CSV Exports', async () => {
      // Disable teacher ordering
      await adminClient.request('PUT', '/api/admin/settings', {
        teacherOrderingEnabled: false,
      });
      const blockedTeacherOrd = await teacherClient.request('POST', '/api/orders', {
        orderDate: todayIso,
        collectionSlot: 'Secondary Lunch Break (12:45 PM – 01:25 PM)',
        items: [{ menuItemId: item2Id, quantity: 1 }],
      });
      assert.equal(blockedTeacherOrd.status, 403);

      // Re-enable teacher ordering and place + pay teacher order
      await adminClient.request('PUT', '/api/admin/settings', {
        teacherOrderingEnabled: true,
      });
      const okTeacherOrd = await teacherClient.request('POST', '/api/orders', {
        orderDate: todayIso,
        collectionSlot: 'Secondary Lunch Break (12:45 PM – 01:25 PM)',
        items: [{ menuItemId: item2Id, quantity: 1 }],
      });
      assert.equal(okTeacherOrd.status, 201);
      const tPay = await teacherClient.request('POST', '/api/payments/checkout', {
        orderId: okTeacherOrd.data.order.id,
        sandboxOutcome: 'succeeded',
      });
      assert.equal(tPay.status, 200);

      // Verify Admin Overview & CSV Export
      const overview = await adminClient.request('GET', '/api/admin/overview');
      assert.equal(overview.status, 200);
      assert.equal(overview.data.revenue.totalSalesAed, 38); // 32 AED + 6 AED

      const csvRes = await adminClient.request(
        'GET',
        '/api/admin/reports/export?type=popular_items'
      );
      assert.equal(csvRes.status, 200);
      assert.ok(String(csvRes.data).includes('Grilled Halloumi Wrap'));
    });

    await step('Verifies SQLite ACID disk persistence across database reopen', async () => {
      db.close();
      const reopenedDb = new AppDatabase(testDbPath);
      const persistedOrder = reopenedDb.get<{ order_status: string; payment_status: string }>(
        'SELECT order_status, payment_status FROM orders WHERE id = ?',
        paidOrderId
      );
      assert.equal(persistedOrder?.order_status, 'collected');
      assert.equal(persistedOrder?.payment_status, 'paid');
      reopenedDb.close();
    });

    await step('Verifies Official Bright Riders School SEHHI Menu automatic seeding (28 items, 4 categories)', async () => {
      const menuDbPath = path.join('/tmp', `brs-official-menu-seed-${Date.now()}.sqlite`);
      const menuDb = new AppDatabase(menuDbPath);
      try {
        initializeSchemaAndDefaults(menuDb);
        const catCount = menuDb.get<{ count: number }>('SELECT COUNT(*) AS count FROM food_categories')?.count ?? 0;
        const itemCount = menuDb.get<{ count: number }>('SELECT COUNT(*) AS count FROM menu_items')?.count ?? 0;
        const activeCount = menuDb.get<{ count: number }>(
          'SELECT COUNT(*) AS count FROM menu_items WHERE is_available = 1'
        )?.count ?? 0;
        assert.equal(catCount, 4);
        assert.equal(itemCount, 28);
        assert.equal(activeCount, 27);

        const water = menuDb.get<{ price_fils: number }>('SELECT price_fils FROM menu_items WHERE name = ?', 'Water');
        assert.equal(water?.price_fils, 150); // 1.5 AED = 150 fils

        const biriyani = menuDb.get<{ price_fils: number }>(
          'SELECT price_fils FROM menu_items WHERE name = ?',
          'Chicken biriyani (less oil)'
        );
        assert.equal(biriyani?.price_fils, 1300); // 13 AED = 1300 fils

        const glareItem = menuDb.get<{ price_fils: number; is_available: number }>(
          'SELECT price_fils, is_available FROM menu_items WHERE name = ?',
          'Chicken /Paneer Curry and Steam Rice'
        );
        assert.equal(glareItem?.price_fils, 0);
        assert.equal(glareItem?.is_available, 0);
      } finally {
        menuDb.close();
        for (const s of ['', '-wal', '-shm']) {
          const p = `${menuDbPath}${s}`;
          if (fs.existsSync(p)) fs.unlinkSync(p);
        }
      }
    });

    console.log(`\n✓ All ${passed} integration test suites passed cleanly!\n`);
  } finally {
    server.close();
    cleanupTestDb();
  }
}

runTests().catch((err) => {
  console.error('\n✗ E2E test suite failed:', err);
  cleanupTestDb();
  process.exit(1);
});
