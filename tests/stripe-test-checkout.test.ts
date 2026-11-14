import assert from 'node:assert/strict';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import Stripe from 'stripe';
import { AppDatabase, ensureSqlEngine, initializeSchemaAndDefaults, setDbForTesting } from '../server/db/connection.js';
import { setStripeTestClientForTesting } from '../server/services/stripe-test.js';
import { createApiApp } from '../server/app.js';

if (process.env.NODE_ENV !== 'test' || process.env.STRIPE_SECRET_KEY !== 'sk_test_fixture' || process.env.STRIPE_WEBHOOK_SECRET !== 'whsec_fixture') {
  throw new Error('Run with isolated fixture environment: npm run test:stripe');
}
await ensureSqlEngine();
const db = new AppDatabase(':memory:');
initializeSchemaAndDefaults(db);
setDbForTesting(db);
const stripe = new Stripe('sk_test_fixture');
let created: any = null;
let createCount = 0;
let createOptions: any = null;
const client = {
  webhooks: stripe.webhooks,
  checkout: { sessions: {
    create: async (params: any, options: any) => {
      createCount++;
      createOptions = options;
      created = { id: 'cs_test_fixture_1', url: 'https://checkout.stripe.com/c/pay/cs_test_fixture_1', status: 'open', livemode: false,
        payment_status: 'unpaid', client_reference_id: params.client_reference_id, metadata: params.metadata,
        currency: 'aed', amount_total: 300 };
      return created;
    },
    retrieve: async () => created,
  } },
} as unknown as Stripe;
setStripeTestClientForTesting(client);
const server = http.createServer(createApiApp());
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
const call = async (url: string, method = 'GET', body?: any, token?: string) => {
  const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: r.status, body: await r.json() as any };
};
const webhook = async (event: any, valid = true) => {
  const body = JSON.stringify(event);
  const signature = Stripe.webhooks.generateTestHeaderString({ payload: body, secret: valid ? 'whsec_fixture' : 'whsec_wrong' });
  const response = await fetch(base + '/api/payments/stripe/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': signature }, body });
  return response.status;
};
try {
  // Only a test-created admin can enable the provider; a demo parent cannot.
  db.run("INSERT INTO users (username, password_hash, full_name, role) VALUES ('test.admin', ?, 'Test Admin', 'admin')", (await import('bcryptjs')).default.hashSync('test-admin-password', 10));
  const admin = await call('/api/auth/login', 'POST', { username: 'test.admin', password: 'test-admin-password', expectedRole: 'admin' });
  const parent = await call('/api/auth/login', 'POST', { username: '12345', password: 'abcd', expectedRole: 'parent' });
  assert.equal(admin.status, 200); assert.equal(parent.status, 200);
  const at = admin.body.sessionToken as string, pt = parent.body.sessionToken as string;
  assert.equal((await call('/api/admin/payment-mode', 'PUT', { mode: 'stripe_test' }, pt)).status, 403);
  assert.equal((await call('/api/admin/payment-mode', 'PUT', { mode: 'live' }, at)).status, 409);
  assert.equal((await call('/api/admin/payment-mode', 'PUT', { mode: 'stripe_test' }, at)).status, 200);
  assert.equal((await call('/api/auth/me', 'GET', undefined, pt)).body.settings.paymentMode, 'stripe_test');
  const parentId = parent.body.user.id;
  const student = db.get<{id: number}>("SELECT id FROM users WHERE username = '12345.student'")!;
  const menu = db.get<{id:number}>('SELECT id FROM menu_items LIMIT 1')!;
  const orderId = db.run(`INSERT INTO orders (order_number, placed_by_user_id, beneficiary_user_id, order_date, collection_slot, subtotal_fils, total_fils)
    VALUES ('BRS-TEST-STRIPE', ?, ?, '2026-11-08', 'test', 300, 300)`, parentId, student.id).lastInsertRowid;
  db.run(`INSERT INTO order_items (order_id, menu_item_id, item_name_snapshot, unit_price_fils, quantity, line_total_fils) VALUES (?, ?, 'Test food', 300, 1, 300)`, orderId, menu.id);
  assert.equal((await call('/api/payments/checkout', 'POST', { orderId }, pt)).status, 409);
  assert.equal((await call('/api/payments/checkout', 'POST', { orderId, expectedMode: 'brs_sandbox_aed' }, pt)).status, 409);
  const checkout = await call('/api/payments/checkout', 'POST', { orderId, expectedMode: 'stripe_test' }, pt);
  assert.equal(checkout.status, 200); assert.equal(checkout.body.mode, 'stripe_test');
  assert.equal(checkout.body.checkoutUrl, created.url);
  assert.equal(createOptions.idempotencyKey, 'brs-stripe-test-BRS-TEST-STRIPE');
  assert.equal((await call('/api/payments/checkout', 'POST', { orderId, expectedMode: 'stripe_test' }, pt)).status, 200);
  assert.equal(createCount, 1, 'retries must reuse the existing provider session');
  assert.equal((await call('/api/admin/payment-mode', 'PUT', { mode: 'test' }, at)).status, 200);
  assert.equal((await call('/api/payments/checkout', 'POST', { orderId, expectedMode: 'brs_sandbox_aed' }, pt)).status, 409, 'Stripe orders cannot be simulated');
  assert.equal((await call('/api/admin/payment-mode', 'PUT', { mode: 'stripe_test' }, at)).status, 200);
  assert.equal(db.get<{payment_status:string}>('SELECT payment_status FROM orders WHERE id = ?', orderId)?.payment_status, 'pending');
  const event = (session: any, live = false) => ({ id: 'evt_fixture', object: 'event', api_version: '2024-10-28.acacia', created: Math.floor(Date.now() / 1000), livemode: live, type: 'checkout.session.completed', data: { object: session } });
  const paid = { ...created, status: 'complete', payment_status: 'paid' };
  assert.equal(await webhook(event(paid), false), 400);
  assert.equal(await webhook(event(paid, true)), 400);
  assert.equal(await webhook(event({ ...paid, amount_total: 999 })), 500);
  assert.equal(await webhook(event(created)), 200);
  assert.equal(db.get<{payment_status:string}>('SELECT payment_status FROM orders WHERE id = ?', orderId)?.payment_status, 'pending');
  // Simulate a lost checkout snapshot: signed webhook can recover its pending ledger entry.
  db.run("DELETE FROM payment_transactions WHERE order_id = ? AND provider = 'stripe'", orderId);
  assert.equal(await webhook(event(paid)), 200);
  assert.equal(await webhook(event(paid)), 200);
  assert.equal(db.get<{payment_status:string}>('SELECT payment_status FROM orders WHERE id = ?', orderId)?.payment_status, 'paid');
  assert.equal(db.get<{cnt:number}>('SELECT COUNT(*) AS cnt FROM qr_verification_tokens WHERE order_id = ?', orderId)?.cnt, 1);
  assert.equal(db.get<{cnt:number}>("SELECT COUNT(*) AS cnt FROM payment_transactions WHERE order_id = ? AND status = 'succeeded'", orderId)?.cnt, 1);
  // Exercise the built Lambda artifact and its pre-buffered raw-body path too.
  const rawEvent = JSON.stringify({ id: 'evt_lambda_fixture', object: 'event', created: Math.floor(Date.now() / 1000), livemode: false, type: 'customer.created', data: { object: { id: 'cus_fixture' } } });
  const sig = Stripe.webhooks.generateTestHeaderString({ payload: rawEvent, secret: 'whsec_fixture' });
  const bundle = path.resolve('dist/functions/api.cjs');
  const childScript = `
    (async () => {
      const { handler } = require(process.env.BUNDLE);
      const event = { httpMethod: 'POST', path: '/.netlify/functions/api/payments/stripe/webhook', rawUrl: 'https://example.netlify.app/api/payments/stripe/webhook', headers: { 'content-type': 'application/json', 'stripe-signature': process.env.SIG }, body: process.env.RAW, isBase64Encoded: false };
      const valid = await handler(event, {});
      event.headers['stripe-signature'] = 'invalid';
      const invalid = await handler(event, {});
      console.log(JSON.stringify({ valid: valid.statusCode, invalid: invalid.statusCode }));
    })().catch(e => { console.error(e); process.exit(1); });
  `;
  const lambda = JSON.parse(execFileSync(process.execPath, ['-e', childScript], { cwd: '/tmp', env: {
    ...process.env, BUNDLE: bundle, RAW: rawEvent, SIG: sig, NETLIFY: 'true', BRS_ALLOW_EPHEMERAL_TEST_DB: '1',
    DATABASE_PATH: `/tmp/brs-stripe-lambda-${process.pid}.sqlite`,
  }, encoding: 'utf8' }).trim());
  assert.equal(lambda.valid, 200); assert.equal(lambda.invalid, 400);
  console.log('Stripe TEST checkout: mode authorization, retry, signed/invalid/unpaid/mismatched/duplicate webhook and single QR passed.');
  console.log('Netlify artifact: raw signed webhook accepted; invalid signature rejected.');
} finally {
  await new Promise<void>(resolve => server.close(() => resolve()));
  setStripeTestClientForTesting(null); db.close();
}
