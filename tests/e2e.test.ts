import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import bcrypt from 'bcryptjs';
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

const VALID_1X1_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

async function runTests() {
  console.log('=== Bright Riders Digital Canteen — End-to-End Integration Test Suite ===\n');
  cleanupTestDb();

  const db = new AppDatabase(testDbPath);
  initializeSchemaAndDefaults(db);
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
    const chefClient = new TestClient(baseUrl);
    const anonClient = new TestClient(baseUrl);

    // 1. PERMANENT ADMINS & ZERO DEMO CONTENT VERIFICATION
    await step('Seeds ONLY the 2 permanent Admin accounts (ARHATSHAH8149 & ruthvikabrs123) and zero demo data', async () => {
      // Idempotent repeated initialization must not duplicate accounts
      initializeSchemaAndDefaults(db);

      const allUsers = db.all<{
        username: string;
        role: string;
        password_hash: string;
        is_active: number;
      }>('SELECT username, role, password_hash, is_active FROM users ORDER BY id ASC');

      assert.equal(allUsers.length, 2, 'Initial DB must contain ONLY the 2 permanent admins');
      assert.equal(allUsers[0].username, 'ARHATSHAH8149');
      assert.equal(allUsers[0].role, 'admin');
      assert.ok(allUsers[0].password_hash.startsWith('$2a$12$'));
      assert.equal(allUsers[1].username, 'ruthvikabrs123');
      assert.equal(allUsers[1].role, 'admin');
      assert.ok(allUsers[1].password_hash.startsWith('$2a$12$'));

      const orderCnt = db.get<{ cnt: number }>('SELECT COUNT(*) as cnt FROM orders')?.cnt ?? -1;
      const txnCnt = db.get<{ cnt: number }>('SELECT COUNT(*) as cnt FROM payment_transactions')?.cnt ?? -1;
      assert.equal(orderCnt, 0, 'Initial DB must contain zero fake orders');
      assert.equal(txnCnt, 0, 'Initial DB must contain zero fake transactions');
    });

    // Create an ephemeral test-only admin inside the isolated test DB so no permanent admin password is stored in test source
    const TEST_ADMIN_USER = 'e2e.temp.admin';
    const TEST_ADMIN_PW = 'E2E-Temp-Admin#2026!';
    const TEST_ROLE_PW = 'E2E-Role-User#2026!';
    db.run(
      `INSERT INTO users (username, password_hash, full_name, role, is_active, permissions_json)
       VALUES (?, ?, 'E2E Test Admin', 'admin', 1, '{"superAdmin":true}')`,
      TEST_ADMIN_USER,
      bcrypt.hashSync(TEST_ADMIN_PW, 10)
    );

    await step('Rejects unauthenticated access, invalid credentials & wrong role-card portal sign-ins', async () => {
      const me = await anonClient.request('GET', '/api/auth/me');
      assert.equal(me.status, 401);

      const bad = await anonClient.request('POST', '/api/auth/login', {
        username: 'ARHATSHAH8149',
        password: 'WrongPassword123!',
      });
      assert.equal(bad.status, 401);

      // Signing in with an Admin account through the Student card must be rejected with 403
      const wrongCard = await anonClient.request('POST', '/api/auth/login', {
        username: TEST_ADMIN_USER,
        password: TEST_ADMIN_PW,
        expectedRole: 'student',
      });
      assert.equal(wrongCard.status, 403);
    });

    let activeStudentId = 0;

    await step('Authenticates Admin & creates Student, Parent (linked), and Chef across the 4 official roles', async () => {
      const a = await adminClient.request('POST', '/api/auth/login', {
        username: TEST_ADMIN_USER,
        password: TEST_ADMIN_PW,
        expectedRole: 'admin',
      });
      assert.equal(a.status, 200);
      assert.equal(a.data.user.role, 'admin');

      // Reject removed 'teacher' role
      const badTeacher = await adminClient.request('POST', '/api/admin/users', {
        role: 'teacher',
        fullName: 'Disallowed Role',
        username: 'disallowed.teacher',
        password: TEST_ROLE_PW,
      });
      assert.equal(badTeacher.status, 400);

      // Admin creates Student
      const sCreate = await adminClient.request('POST', '/api/admin/users', {
        role: 'student',
        fullName: 'Zayed Al Mansoori',
        username: 'e2e.student',
        password: TEST_ROLE_PW,
        className: 'Grade 5-A',
        studentCode: 'BRS-STU-E2E-101',
        allergiesNotes: 'None',
      });
      assert.equal(sCreate.status, 201);
      activeStudentId = sCreate.data.user.id;

      // Admin creates Parent linked to Student
      const pCreate = await adminClient.request('POST', '/api/admin/users', {
        role: 'parent',
        fullName: 'Fatima Al Mansoori',
        username: 'e2e.parent',
        password: TEST_ROLE_PW,
        email: 'parent.e2e@example.ae',
        phone: '+971500000101',
        linkedStudentIds: [activeStudentId],
        relationship: 'Mother',
      });
      assert.equal(pCreate.status, 201);
      assert.equal(pCreate.data.user.linkedChildren.length, 1);

      // Admin creates Chef
      const cCreate = await adminClient.request('POST', '/api/admin/users', {
        role: 'chef',
        fullName: 'Chef Rashid',
        username: 'e2e.chef',
        password: TEST_ROLE_PW,
        staffCode: 'BRS-CHF-E2E-01',
        station: 'Main Canteen Counter',
      });
      assert.equal(cCreate.status, 201);

      // Authenticate all 3 newly created accounts via their matching role portals
      const pLogin = await parentClient.request('POST', '/api/auth/login', {
        username: 'e2e.parent',
        password: TEST_ROLE_PW,
        expectedRole: 'parent',
      });
      assert.equal(pLogin.status, 200);
      assert.equal(pLogin.data.user.children.length, 1);

      const sLogin = await studentClient.request('POST', '/api/auth/login', {
        username: 'e2e.student',
        password: TEST_ROLE_PW,
        expectedRole: 'student',
      });
      assert.equal(sLogin.status, 200);

      const cLogin = await chefClient.request('POST', '/api/auth/login', {
        username: 'e2e.chef',
        password: TEST_ROLE_PW,
        expectedRole: 'chef',
      });
      assert.equal(cLogin.status, 200);
    });

    await step('Enforces strict backend role restrictions across protected routes', async () => {
      assert.equal((await studentClient.request('GET', '/api/admin/overview')).status, 403);
      assert.equal((await studentClient.request('GET', '/api/payments')).status, 403);
      assert.equal((await studentClient.request('GET', '/api/cart')).status, 403);
      assert.equal((await studentClient.request('GET', '/api/chef/orders')).status, 403);

      assert.equal((await parentClient.request('GET', '/api/admin/users')).status, 403);
      assert.equal((await parentClient.request('GET', '/api/chef/orders')).status, 403);

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

    await step('Admin edits accounts, resets passwords (revoking sessions), deactivates & deletes unused users', async () => {
      const createParent = await adminClient.request('POST', '/api/admin/users', {
        role: 'parent',
        fullName: 'Omar Al Nuaimi',
        username: 'parent.omar',
        password: 'InitialPassword#1',
      });
      assert.equal(createParent.status, 201);
      const tempParentId = createParent.data.user.id;

      const createStudent = await adminClient.request('POST', '/api/admin/users', {
        role: 'student',
        fullName: 'Hamdan Al Nuaimi',
        username: 'student.hamdan',
        password: 'InitialPassword#1',
        className: 'Grade 4-C',
        studentCode: 'BRS-STU-2026-999',
      });
      assert.equal(createStudent.status, 201);
      const tempStudentId = createStudent.data.user.id;

      const linkRes = await adminClient.request('POST', '/api/admin/parent-links', {
        parentUserId: tempParentId,
        studentUserId: tempStudentId,
        relationship: 'Father',
      });
      assert.equal(linkRes.status, 201);

      const editRes = await adminClient.request('PUT', `/api/admin/users/${tempStudentId}`, {
        className: 'Grade 4-D',
      });
      assert.equal(editRes.status, 200);
      assert.equal(editRes.data.user.className, 'Grade 4-D');

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
      assert.equal((await tempParentClient.request('GET', '/api/auth/me')).status, 401);

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

      assert.equal((await adminClient.request('DELETE', `/api/admin/users/${tempStudentId}`)).status, 200);
      assert.equal((await adminClient.request('DELETE', `/api/admin/users/${tempParentId}`)).status, 200);
    });

    // 3. MENU MANAGEMENT & IMAGE UPLOAD VALIDATION
    let catId = 0;
    let item1Id = 0;
    let item2Id = 0;

    await step('Verifies Official Bright Riders SEHHI 28-item menu & Admin menu CRUD + image validation', async () => {
      const initialMenu = await parentClient.request('GET', '/api/menu');
      assert.equal(initialMenu.status, 200);
      assert.equal(initialMenu.data.categories.length, 4);
      assert.equal(initialMenu.data.items.length, 28);

      const badForm = new FormData();
      badForm.append(
        'image',
        new Blob([Buffer.from('<script>alert(1)</script>')], { type: 'image/png' }),
        'fake.png'
      );
      const badUpload = await adminClient.request('POST', '/api/menu/upload-image', badForm);
      assert.equal(badUpload.status, 400);

      const goodForm = new FormData();
      goodForm.append('image', new Blob([VALID_1X1_PNG], { type: 'image/png' }), 'valid-meal.png');
      const goodUpload = await adminClient.request('POST', '/api/menu/upload-image', goodForm);
      assert.equal(goodUpload.status, 201);
      assert.ok(goodUpload.data.imageUrl.startsWith('/uploads/menu/'));

      const uploadedDiskFile = path.resolve(
        process.cwd(),
        'server',
        goodUpload.data.imageUrl.replace(/^\//, '')
      );
      if (fs.existsSync(uploadedDiskFile)) fs.unlinkSync(uploadedDiskFile);

      const catRes = await adminClient.request('POST', '/api/menu/categories', {
        name: 'Special Exhibition Specials',
        description: 'Prepared daily in Bright Riders kitchen',
      });
      assert.equal(catRes.status, 201);
      catId = catRes.data.id;

      const it1 = await adminClient.request('POST', '/api/menu/items', {
        categoryId: catId,
        name: 'Grilled Halloumi Wrap',
        priceAed: 12.5,
        isVegetarian: true,
      });
      assert.equal(it1.status, 201);
      item1Id = it1.data.id;

      const it2 = await adminClient.request('POST', '/api/menu/items', {
        categoryId: catId,
        name: 'Fresh Orange Juice',
        priceAed: 6.0,
        isVegetarian: true,
      });
      assert.equal(it2.status, 201);
      item2Id = it2.data.id;

      const editPrice = await adminClient.request('PUT', `/api/menu/items/${item1Id}`, {
        priceAed: 13.0,
      });
      assert.equal(editPrice.status, 200);
      assert.equal(editPrice.data.priceAed, 13);

      const schedRes = await adminClient.request('POST', `/api/menu/items/${item2Id}/schedules`, {
        specificDate: '2026-12-15',
        isAvailable: false,
        specialNote: 'Not served during exam half-day',
      });
      assert.equal(schedRes.status, 201);

      const menuOnBlockedDate = await parentClient.request('GET', '/api/menu?date=2026-12-15');
      const juiceOnBlockedDate = menuOnBlockedDate.data.items.find((i: any) => i.id === item2Id);
      assert.equal(juiceOnBlockedDate.availableOnDate, false);
    });

    // 4. ORDERING & DIGITAL PAYMENTS
    const todayIso = new Date().toISOString().slice(0, 10);
    let paidOrderId = 0;
    let paidOrderNumber = '';

    await step('Handles failed & pending payments without issuing QR or allowing collection', async () => {
      const ordFailRes = await parentClient.request('POST', '/api/orders', {
        beneficiaryUserId: activeStudentId,
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

      const qrAttempt = await parentClient.request('GET', `/api/orders/${unpaidOrderId}/qr`);
      assert.equal(qrAttempt.status, 400);

      const chefVerifyUnpaid = await chefClient.request('POST', '/api/chef/verify-order', {
        orderNumber: unpaidOrderNum,
      });
      assert.equal(chefVerifyUnpaid.status, 400);
      assert.equal(
        chefVerifyUnpaid.data.message,
        'Payment not completed. This order cannot be collected.'
      );

      const pendingPay = await parentClient.request('POST', '/api/payments/checkout', {
        orderId: unpaidOrderId,
        sandboxOutcome: 'pending',
      });
      assert.equal(pendingPay.status, 200);
      assert.equal(pendingPay.data.status, 'pending');

      const cancelPending = await parentClient.request('POST', `/api/orders/${unpaidOrderId}/cancel`);
      assert.equal(cancelPending.status, 200);
    });

    await step('Completes full Parent Cart -> Checkout -> Paid Confirmation & prevents duplicate payments', async () => {
      await parentClient.request('PUT', '/api/cart/meta', {
        beneficiaryUserId: activeStudentId,
        orderDate: todayIso,
        collectionSlot: 'Primary Lunch Break (12:00 PM – 12:40 PM)',
        specialInstructions: 'Please warm the wrap slightly',
      });

      await parentClient.request('POST', '/api/cart/items', { menuItemId: item1Id, quantity: 2 });
      const cartSnap = await parentClient.request('POST', '/api/cart/items', {
        menuItemId: item2Id,
        quantity: 1,
      });
      assert.equal(cartSnap.data.cart.totalFils, 3200);

      const createOrd = await parentClient.request('POST', '/api/orders', {
        idempotencyKey: 'e2e-parent-order-1',
      });
      assert.equal(createOrd.status, 201);
      paidOrderId = createOrd.data.order.id;
      paidOrderNumber = createOrd.data.order.orderNumber;

      const payOk = await parentClient.request('POST', '/api/payments/checkout', {
        orderId: paidOrderId,
        sandboxOutcome: 'succeeded',
        paymentMethodType: 'visa_sandbox',
      });
      assert.equal(payOk.status, 200);
      assert.equal(payOk.data.order.paymentStatus, 'paid');
      assert.equal(payOk.data.order.orderStatus, 'confirmed');
      assert.ok(payOk.data.qrDataUrl.startsWith('data:image/png;base64,'));

      const dupPay = await parentClient.request('POST', '/api/payments/checkout', {
        orderId: paidOrderId,
        sandboxOutcome: 'succeeded',
      });
      assert.equal(dupPay.status, 409);
    });

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
      assert.ok(!studentSignedQrToken.toLowerCase().includes('zayed'));
      assert.ok(!studentSignedQrToken.includes('101'));
    });

    await step('Chef updates prep status -> verifies QR -> confirms collection -> blocks double collection', async () => {
      const chefQueue = await chefClient.request('GET', '/api/chef/orders');
      assert.equal(chefQueue.status, 200);
      assert.ok(chefQueue.data.orders.some((o: any) => o.id === paidOrderId));

      const prep1 = await chefClient.request(
        'PATCH',
        `/api/chef/orders/${paidOrderId}/prep-status`,
        { status: 'preparing' }
      );
      assert.equal(prep1.status, 200);
      assert.equal(prep1.data.order.orderStatus, 'preparing');

      const prep2 = await chefClient.request(
        'PATCH',
        `/api/chef/orders/${paidOrderId}/prep-status`,
        { status: 'ready_for_collection' }
      );
      assert.equal(prep2.status, 200);
      assert.equal(prep2.data.order.orderStatus, 'ready_for_collection');

      const forgedScan = await chefClient.request('POST', '/api/chef/verify-qr', {
        qrPayload: 'BRSQR.v1.forgedToken1234567890.fakeSignatureabc',
      });
      assert.equal(forgedScan.status, 400);
      assert.equal(
        forgedScan.data.message,
        'Invalid QR code. Please scan a valid Bright Riders School order QR code.'
      );

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

      const confirmRes = await chefClient.request('POST', '/api/chef/confirm-collection', {
        orderId: paidOrderId,
        verificationMethod: 'qr_scan',
        qrPayload: studentSignedQrToken,
      });
      assert.equal(confirmRes.status, 200);
      assert.equal(confirmRes.data.order.orderStatus, 'collected');

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

    await step('Verifies Admin Overview analytics, Reports + CSV Exports, and SQLite disk persistence', async () => {
      const overview = await adminClient.request('GET', '/api/admin/overview');
      assert.equal(overview.status, 200);
      assert.equal(overview.data.revenue.totalSalesAed, 32);

      const csvRes = await adminClient.request('GET', '/api/admin/reports/export?type=popular_items');
      assert.equal(csvRes.status, 200);
      assert.ok(String(csvRes.data).includes('Grilled Halloumi Wrap'));

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

    await step('Verifies compiled Netlify Serverless Function (dist/functions/api.cjs) across cold starts', async () => {
      const fnBundlePath = path.resolve(process.cwd(), 'dist/functions/api.cjs');
      if (!fs.existsSync(fnBundlePath)) {
        execFileSync('node', [path.resolve(process.cwd(), 'scripts/postbuild-copy.mjs')], {
          stdio: 'pipe',
        });
      }
      assert.ok(fs.existsSync(fnBundlePath), 'dist/functions/api.cjs must exist');

      const simDbPath = path.join('/tmp', `netlify-coldstart-${Date.now()}.sqlite`);
      const baseEnv = {
        ...process.env,
        NODE_OPTIONS: '--no-warnings',
        NETLIFY: 'true',
        DATABASE_PATH: simDbPath,
        JWT_SECRET: '',
        QR_HMAC_SECRET: '',
      };

      try {
        const out = execFileSync(
          process.execPath,
          [
            '-e',
            `
            (async () => {
              const { handler } = require(${JSON.stringify(fnBundlePath)});
              const rHealth = await handler({ httpMethod: 'GET', path: '/api/health', headers: {} }, {});
              if (rHealth.statusCode !== 200) throw new Error('Health check failed');

              const rPub = await handler({ httpMethod: 'GET', path: '/.netlify/functions/api/auth/public-config', headers: {} }, {});
              if (rPub.statusCode !== 200) throw new Error('Public config failed');

              const { DatabaseSync } = require('node:sqlite');
              const checkDb = new DatabaseSync(${JSON.stringify(simDbPath)});
              const admins = checkDb.prepare('SELECT username, role FROM users ORDER BY id ASC').all();
              const menuCnt = checkDb.prepare('SELECT COUNT(*) as cnt FROM menu_items').get().cnt;
              checkDb.close();
              console.log(JSON.stringify({ admins, menuCnt }));
            })();
            `,
          ],
          { cwd: '/tmp', env: baseEnv, encoding: 'utf8' }
        );

        const parsed = JSON.parse(out.trim());
        assert.equal(parsed.admins.length, 2);
        assert.equal(parsed.admins[0].username, 'ARHATSHAH8149');
        assert.equal(parsed.admins[1].username, 'ruthvikabrs123');
        assert.equal(parsed.menuCnt, 28);
      } finally {
        for (const s of ['', '-wal', '-shm']) {
          const p = `${simDbPath}${s}`;
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
