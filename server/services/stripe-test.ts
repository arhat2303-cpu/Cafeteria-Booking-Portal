import Stripe from 'stripe';
import { config } from '../config.js';
import { getDb } from '../db/connection.js';
import { issueOrderQrToken } from './qr.js';
import { recordOrderStatusChange } from './audit.js';
import { eventHub } from './events.js';

let testClient: Stripe | null = null;
/** Inject a mock only in a test process, never through a network request. */
export function setStripeTestClientForTesting(client: Stripe | null) {
  if (config.nodeEnv !== 'test') throw new Error('Test injection is unavailable.');
  testClient = client;
}
export function getStripeTestClient(): Stripe {
  if (!config.stripeSecretKey.startsWith('sk_test_')) throw new Error('Stripe test key is not configured.');
  return testClient || new Stripe(config.stripeSecretKey);
}

/** Handles only authenticated Stripe TEST events. Never issues a QR for an unpaid session. */
export function settleStripeTestSession(session: Stripe.Checkout.Session): void {
  if (session.livemode !== false || !session.id.startsWith('cs_test_')) throw new Error('Only Stripe test sessions are accepted.');
  const metadata = session.metadata || {};
  const orderId = Number(metadata.orderId);
  const payerId = Number(metadata.payerId);
  const reference = metadata.transactionRef;
  if (!Number.isSafeInteger(orderId) || !Number.isSafeInteger(payerId) || !reference || !metadata.orderNumber) {
    throw new Error('Session metadata is incomplete.');
  }
  const db = getDb();
  let changed = false;
  let beneficiaryId = 0;
  db.transaction(() => {
    const order = db.get<{ id: number; order_number: string; placed_by_user_id: number; beneficiary_user_id: number; total_fils: number; currency: string; payment_status: string; order_status: string }>(
      'SELECT * FROM orders WHERE id = ?', orderId
    );
    if (!order || order.order_number !== metadata.orderNumber || order.placed_by_user_id !== payerId ||
        session.client_reference_id !== String(orderId) || session.currency?.toLowerCase() !== 'aed' ||
        order.currency.toUpperCase() !== 'AED' || session.amount_total !== order.total_fils ||
        reference !== `STRIPE-TEST-${order.order_number}`) {
      throw new Error('Session does not match the order, payer, amount or currency.');
    }
    beneficiaryId = order.beneficiary_user_id;
    const txn = db.get<{ id: number; status: string; provider_session_id: string | null }>(
      "SELECT id, status, provider_session_id FROM payment_transactions WHERE transaction_ref = ? AND provider = 'stripe' AND order_id = ? AND user_id = ?",
      reference, orderId, payerId
    );
    if (txn?.provider_session_id && txn.provider_session_id !== session.id) throw new Error('Session ID mismatch.');
    if (session.payment_status !== 'paid') return;
    if (txn?.status === 'succeeded' && order.payment_status === 'paid') return;
    if (order.order_status === 'cancelled' || order.payment_status === 'paid' || order.payment_status === 'refunded') {
      throw new Error('Order cannot be confirmed; manual reconciliation is required.');
    }
    if (!txn) {
      db.run(`INSERT INTO payment_transactions (transaction_ref, order_id, user_id, provider, provider_session_id, amount_fils, currency, status, payment_method_label)
        VALUES (?, ?, ?, 'stripe', ?, ?, 'AED', 'pending', 'Stripe TEST checkout — no real charge')`,
        reference, orderId, payerId, session.id, order.total_fils);
    } else if (txn.status !== 'pending') {
      throw new Error('Transaction is not pending.');
    }
    db.run("UPDATE payment_transactions SET status = 'succeeded', provider_session_id = ?, updated_at = datetime('now') WHERE transaction_ref = ?", session.id, reference);
    db.run("UPDATE orders SET payment_status = 'paid', order_status = 'confirmed', updated_at = datetime('now') WHERE id = ?", orderId);
    issueOrderQrToken(db, orderId);
    recordOrderStatusChange(db, { orderId, previousStatus: order.order_status, newStatus: 'confirmed', changedByUserId: null, note: `Stripe TEST payment verified (${reference}); no real charge.` });
    changed = true;
  });
  if (changed) eventHub.broadcast('order.created', { orderId, orderNumber: metadata.orderNumber, orderStatus: 'confirmed', paymentStatus: 'paid', testPayment: true }, { roles: ['chef', 'admin'], userIds: [payerId, beneficiaryId] });
}
