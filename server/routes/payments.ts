import { Router } from 'express';
import crypto from 'node:crypto';
import { getDb } from '../db/connection.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { filsToAed, formatAed } from '../services/money.js';
import { generateQrDataUrl, issueOrderQrToken } from '../services/qr.js';
import { logAdminActivity, recordOrderStatusChange } from '../services/audit.js';
import { eventHub } from '../services/events.js';
import { formatOrderRecord } from './orders.js';
import { getPaymentMode, stripeTestReady, LIVE_PAYMENTS_BLOCKED_REASON } from '../services/payment-mode.js';
import { getStripeTestClient, settleStripeTestSession } from '../services/stripe-test.js';
import { config } from '../config.js';
import type Stripe from 'stripe';

export const paymentsRouter = Router();

function generateTransactionRef(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rnd = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `TXN-BRS-${ts}-${rnd}`;
}

const SANDBOX_METHOD_LABELS: Record<string, string> = {
  visa_sandbox: 'UAE Sandbox Card •••• 4242 (Test Environment)',
  uae_debit_sandbox: 'UAE Direct Debit Sandbox (Test Environment)',
  apple_pay_sandbox: 'Digital Wallet Sandbox (Test Environment)',
};

paymentsRouter.post('/checkout', authenticate, requireRole(['parent']), async (req, res) => {
  try {
    const db = getDb();
    const user = req.user!;
    const {
      orderId,
      sandboxOutcome = 'succeeded',
      paymentMethodType = 'visa_sandbox',
      idempotencyKey,
      expectedMode,
    } = req.body || {};

    // Reject if caller accidentally sends raw card numbers or CVV fields
    if (req.body?.cardNumber || req.body?.cvv || req.body?.cvc) {
      res.status(400).json({
        error:
          'Security policy: Never transmit raw card numbers or CVVs directly to the application server.',
      });
      return;
    }

    const numericOrderId = Number(orderId);
    if (!numericOrderId) {
      res.status(400).json({ error: 'Valid orderId is required for payment checkout.' });
      return;
    }

    const order = db.get<{
      id: number;
      order_number: string;
      placed_by_user_id: number;
      beneficiary_user_id: number;
      total_fils: number;
      currency: string;
      payment_status: string;
      order_status: string;
    }>('SELECT * FROM orders WHERE id = ?', numericOrderId);

    if (!order) {
      res.status(404).json({ error: 'Order not found.' });
      return;
    }

    if (order.placed_by_user_id !== user.id) {
      res.status(403).json({ error: 'You can only pay for orders placed from your own account.' });
      return;
    }

    if (order.order_status === 'cancelled') {
      res.status(400).json({ error: 'Cannot process payment for a cancelled order.' });
      return;
    }

    // Duplicate Payment Prevention
    if (order.payment_status === 'paid') {
      res.status(409).json({
        error: 'Duplicate payment prevented: Payment has already been completed for this order.',
      });
      return;
    }

    const mode = getPaymentMode(db);
    const selectedMode = expectedMode === 'brs_sandbox_aed' ? 'test' : expectedMode;
    if ((expectedMode && selectedMode !== mode) || (mode === 'stripe_test' && !expectedMode)) {
      res.status(409).json({ error: 'Payment mode changed. Refresh the page and review payment details before trying again.' });
      return;
    }
    if (mode === 'stripe_test') {
      // The order was committed by the separate /orders request. Stripe idempotency
      // uses that immutable order reference, never a client-provided key.
      if (order.total_fils < 200 || order.currency.toUpperCase() !== 'AED') {
        res.status(400).json({ error: 'Stripe UAE checkout requires at least AED 2.00.' });
        return;
      }
      if (db.get("SELECT id FROM payment_transactions WHERE order_id = ? AND provider = 'brs_sandbox_aed' AND status = 'pending'", order.id)) {
        res.status(409).json({ error: 'Resolve the existing simulated payment before starting Stripe test checkout.' });
        return;
      }
      const reference = `STRIPE-TEST-${order.order_number}`;
      const existing = db.get<{ provider_session_id: string | null; status: string }>(
        "SELECT provider_session_id, status FROM payment_transactions WHERE transaction_ref = ? AND provider = 'stripe'", reference
      );
      const stripe = getStripeTestClient();
      let session: Stripe.Checkout.Session;
      if (existing) {
        if (existing.status !== 'pending' || !existing.provider_session_id) {
          res.status(409).json({ error: 'The previous Stripe test checkout requires reconciliation.' });
          return;
        }
        session = await stripe.checkout.sessions.retrieve(existing.provider_session_id);
      } else {
        const items = db.all<{ item_name_snapshot: string; unit_price_fils: number; quantity: number }>(
          'SELECT item_name_snapshot, unit_price_fils, quantity FROM order_items WHERE order_id = ?', order.id
        );
        if (!items.length || items.reduce((sum, it) => sum + it.unit_price_fils * it.quantity, 0) !== order.total_fils) {
          res.status(409).json({ error: 'Order total does not match its items.' });
          return;
        }
        const base = new URL(config.publicAppUrl);
        const success = new URL('/', base); success.search = `stripe_session_id={CHECKOUT_SESSION_ID}&order_id=${order.id}`;
        const cancel = new URL('/', base); cancel.search = `payment_cancelled=1&order_id=${order.id}`;
        session = await stripe.checkout.sessions.create({
          mode: 'payment', payment_method_types: ['card'], client_reference_id: String(order.id),
          metadata: { orderId: String(order.id), orderNumber: order.order_number, payerId: String(user.id), transactionRef: reference },
          line_items: items.map((item) => ({ quantity: item.quantity, price_data: { currency: 'aed', unit_amount: item.unit_price_fils, product_data: { name: item.item_name_snapshot } } })),
          success_url: success.toString().replace('%7BCHECKOUT_SESSION_ID%7D', '{CHECKOUT_SESSION_ID}'), cancel_url: cancel.toString(),
        }, { idempotencyKey: `brs-stripe-test-${order.order_number}` });
      }
      if (session.livemode !== false || !session.id.startsWith('cs_test_') || session.status !== 'open' || !session.url ||
          new URL(session.url).protocol !== 'https:' || new URL(session.url).hostname !== 'checkout.stripe.com') {
        res.status(409).json({ error: 'Stripe test checkout is not open. Contact an administrator to reconcile this order.' });
        return;
      }
      db.run(`INSERT OR IGNORE INTO payment_transactions (transaction_ref, order_id, user_id, provider, provider_session_id, amount_fils, currency, status, payment_method_label)
        VALUES (?, ?, ?, 'stripe', ?, ?, 'AED', 'pending', 'Stripe TEST checkout — no real charge')`, reference, order.id, user.id, session.id, order.total_fils);
      res.json({ mode: 'stripe_test', checkoutUrl: session.url, transactionRef: reference });
      return;
    }
    if (mode !== 'test') {
      res.status(503).json({ error: LIVE_PAYMENTS_BLOCKED_REASON });
      return;
    }
    // Never simulate a payment for an order that may already have a real charge.
    if (db.get("SELECT id FROM payment_transactions WHERE order_id = ? AND provider = 'stripe'", order.id)) {
      res.status(409).json({ error: 'This order has a Stripe payment. Contact an administrator to reconcile it; it cannot be paid in test mode.' });
      return;
    }

    if (idempotencyKey && typeof idempotencyKey === 'string') {
      const existingTxn = db.get<{
        id: number;
        transaction_ref: string;
        status: string;
      }>("SELECT id, transaction_ref, status FROM payment_transactions WHERE idempotency_key = ? AND order_id = ? AND user_id = ? AND provider = 'brs_sandbox_aed'", idempotencyKey.trim(), order.id, user.id);
      if (existingTxn) {
        res.status(200).json({
          deduplicated: true,
          transactionRef: existingTxn.transaction_ref,
          status: existingTxn.status,
          order: formatOrderRecord(order.id, user.role),
        });
        return;
      }
    }

    // Branch 2: Clearly Labelled UAE AED Sandbox Payment Gateway
    const validOutcomes = ['succeeded', 'failed', 'pending'];
    const outcome = validOutcomes.includes(sandboxOutcome) ? sandboxOutcome : 'succeeded';
    const methodLabel =
      SANDBOX_METHOD_LABELS[paymentMethodType] || SANDBOX_METHOD_LABELS.visa_sandbox;
    const txnRef = generateTransactionRef();

    let qrTokenInfo: { signedToken: string; qrDataUrl?: string } | null = null;

    db.transaction(() => {
      // Re-verify order payment status inside immediate transaction lock
      const freshOrder = db.get<{ payment_status: string; order_status: string }>(
        'SELECT payment_status, order_status FROM orders WHERE id = ?',
        order.id
      )!;
      if (freshOrder.payment_status === 'paid') {
        throw new Error('Duplicate payment prevented: Order is already paid.');
      }

      const failureReason =
        outcome === 'failed'
          ? 'Sandbox test decline: Simulated bank authorization rejection.'
          : null;

      db.run(
        `INSERT INTO payment_transactions (
          transaction_ref, order_id, user_id, provider, amount_fils, currency,
          status, payment_method_label, failure_reason, idempotency_key
        ) VALUES (?, ?, ?, 'brs_sandbox_aed', ?, 'AED', ?, ?, ?, ?)`,
        txnRef,
        order.id,
        user.id,
        order.total_fils,
        outcome,
        methodLabel,
        failureReason,
        idempotencyKey ? String(idempotencyKey).trim() : null
      );

      if (outcome === 'succeeded') {
        db.run(
          `UPDATE orders
           SET payment_status = 'paid',
               order_status = 'confirmed',
               updated_at = datetime('now')
           WHERE id = ?`,
          order.id
        );

        const issued = issueOrderQrToken(db, order.id);
        qrTokenInfo = { signedToken: issued.signedToken };

        recordOrderStatusChange(db, {
          orderId: order.id,
          previousStatus: freshOrder.order_status,
          newStatus: 'confirmed',
          changedByUserId: user.id,
          note: `Sandbox AED payment authorized (${txnRef})`,
        });
      } else if (outcome === 'failed') {
        db.run(
          `UPDATE orders SET payment_status = 'failed', updated_at = datetime('now') WHERE id = ?`,
          order.id
        );
      } else {
        db.run(
          `UPDATE orders SET payment_status = 'pending', updated_at = datetime('now') WHERE id = ?`,
          order.id
        );
      }
    });

    let qrDataUrl: string | null = null;
    if (qrTokenInfo && (qrTokenInfo as { signedToken: string }).signedToken) {
      qrDataUrl = await generateQrDataUrl((qrTokenInfo as { signedToken: string }).signedToken);
    }

    if (outcome === 'succeeded') {
      eventHub.broadcast(
        'order.created',
        {
          orderId: order.id,
          orderNumber: order.order_number,
          orderStatus: 'confirmed',
          paymentStatus: 'paid',
        },
        {
          roles: ['chef', 'admin'],
          userIds: [order.placed_by_user_id, order.beneficiary_user_id],
        }
      );
    } else {
      eventHub.broadcast(
        'payment.updated',
        { orderId: order.id, status: outcome, transactionRef: txnRef },
        { roles: ['admin'], userIds: [order.placed_by_user_id] }
      );
    }

    res.status(outcome === 'failed' ? 402 : 200).json({
      mode: 'brs_sandbox_aed',
      sandboxNotice:
        'Processed via Bright Riders UAE AED Sandbox Payment Environment (No real bank card charged).',
      status: outcome,
      transactionRef: txnRef,
      qrDataUrl,
      order: formatOrderRecord(order.id, user.role),
      error:
        outcome === 'failed'
          ? 'Payment authorization was declined in Sandbox test mode. No charge was made; you may retry checkout.'
          : undefined,
    });
  } catch (err: any) {
    const status = String(err.message || '').includes('Duplicate payment') ? 409 : 400;
    res.status(status).json({ error: err.message || 'Payment checkout failed.' });
  }
});

// Only signed test-mode Stripe events may settle test orders. Live events are rejected.
paymentsRouter.post('/stripe/webhook', (req, res) => {
  if (!stripeTestReady()) { res.status(503).json({ error: 'Stripe test webhook is not configured.' }); return; }
  const signature = req.headers['stripe-signature'];
  if (typeof signature !== 'string' || !Buffer.isBuffer(req.body)) {
    res.status(400).json({ error: 'A Stripe signature and raw request body are required.' }); return;
  }
  let event: Stripe.Event;
  try { event = getStripeTestClient().webhooks.constructEvent(req.body, signature, config.stripeWebhookSecret); }
  catch { res.status(400).json({ error: 'Invalid Stripe signature.' }); return; }
  if (event.livemode !== false) { res.status(400).json({ error: 'Live payment events are not enabled.' }); return; }
  try {
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      settleStripeTestSession(event.data.object as Stripe.Checkout.Session);
    }
    res.json({ received: true });
  } catch (error) {
    console.error('Stripe test event could not be settled:', error);
    res.status(500).json({ error: 'Unable to reconcile this Stripe test event.' });
  }
});

// Existing Stripe transactions require provider-side reconciliation. The old GET
// endpoint mutated an ephemeral snapshot and did not provide reliable confirmation.
paymentsRouter.get('/stripe/verify-session', authenticate, (_req, res) => {
  res.status(503).json({ error: 'Real payment verification is unavailable. Please contact an administrator for reconciliation.' });
});

// Resolve Pending Sandbox Transaction (Authorize or Fail)
paymentsRouter.post(
  '/:transactionId/resolve-pending',
  authenticate,
  requireRole(['parent', 'admin']),
  (req, res) => {
    try {
      const txnId = Number(req.params.transactionId);
      const { resolution = 'succeeded' } = req.body || {};
      if (!['succeeded', 'failed'].includes(resolution)) {
        res.status(400).json({ error: 'Resolution must be succeeded or failed.' });
        return;
      }

      const db = getDb();
      const txn = db.get<{
        id: number;
        transaction_ref: string;
        order_id: number;
        user_id: number;
        status: string;
        provider: string;
      }>('SELECT * FROM payment_transactions WHERE id = ?', txnId);

      if (!txn) {
        res.status(404).json({ error: 'Payment transaction not found.' });
        return;
      }

      if (req.user!.role !== 'admin' && txn.user_id !== req.user!.id) {
        res.status(403).json({ error: 'Access denied for this transaction.' });
        return;
      }

      if (txn.provider !== 'brs_sandbox_aed' || getPaymentMode(db) !== 'test') {
        res.status(409).json({ error: 'Only test-mode sandbox transactions can be simulated.' });
        return;
      }
      if (txn.status !== 'pending') {
        res.status(400).json({ error: `Transaction is already ${txn.status}.` });
        return;
      }

      db.transaction(() => {
        const ord = db.get<{
          id: number;
          payment_status: string;
          order_status: string;
          placed_by_user_id: number;
          beneficiary_user_id: number;
        }>('SELECT * FROM orders WHERE id = ?', txn.order_id)!;

        if (ord.payment_status === 'paid' && resolution === 'succeeded') {
          throw new Error('Duplicate payment prevented: Order is already paid.');
        }

        db.run(
          `UPDATE payment_transactions
           SET status = ?,
               failure_reason = ?,
               updated_at = datetime('now')
           WHERE id = ?`,
          resolution,
          resolution === 'failed' ? 'Pending authorization expired or declined.' : null,
          txn.id
        );

        if (resolution === 'succeeded') {
          db.run(
            `UPDATE orders SET payment_status = 'paid', order_status = 'confirmed', updated_at = datetime('now') WHERE id = ?`,
            txn.order_id
          );
          issueOrderQrToken(db, txn.order_id);
          recordOrderStatusChange(db, {
            orderId: txn.order_id,
            previousStatus: ord.order_status,
            newStatus: 'confirmed',
            changedByUserId: req.user!.id,
            note: `Pending payment authorized (${txn.transaction_ref})`,
          });

          eventHub.broadcast(
            'order.created',
            { orderId: txn.order_id, orderStatus: 'confirmed', paymentStatus: 'paid' },
            { roles: ['chef', 'admin'], userIds: [ord.placed_by_user_id, ord.beneficiary_user_id] }
          );
        } else {
          db.run(
            `UPDATE orders SET payment_status = 'failed', updated_at = datetime('now') WHERE id = ?`,
            txn.order_id
          );
        }
      });

      res.json({
        message: `Pending transaction ${resolution}.`,
        order: formatOrderRecord(txn.order_id, req.user!.role),
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to resolve pending payment.' });
    }
  }
);

// List Payment Transactions (Parent own history, Admin full payment management)
paymentsRouter.get('/', authenticate, requireRole(['parent', 'admin']), (req, res) => {
  const db = getDb();
  const user = req.user!;
  const { status, search } = req.query;

  const where: string[] = [];
  const params: unknown[] = [];

  if (user.role !== 'admin') {
    where.push('pt.user_id = ?');
    params.push(user.id);
  }
  if (status && typeof status === 'string' && status !== 'all') {
    where.push('pt.status = ?');
    params.push(status);
  }
  if (search && typeof search === 'string' && search.trim()) {
    const q = `%${search.trim().toLowerCase()}%`;
    where.push(
      `(LOWER(pt.transaction_ref) LIKE ? OR LOWER(o.order_number) LIKE ? OR LOWER(u.full_name) LIKE ? OR LOWER(ben.full_name) LIKE ?)`
    );
    params.push(q, q, q, q);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = db.all<Record<string, any>>(
    `SELECT pt.*,
            o.order_number,
            o.order_date,
            o.collection_slot,
            o.order_status,
            u.full_name as payer_name,
            u.role as payer_role,
            ben.full_name as beneficiary_name,
            sp.class_name
     FROM payment_transactions pt
     JOIN orders o ON o.id = pt.order_id
     JOIN users u ON u.id = pt.user_id
     JOIN users ben ON ben.id = o.beneficiary_user_id
     LEFT JOIN student_profiles sp ON sp.user_id = o.beneficiary_user_id
     ${whereSql}
     ORDER BY pt.id DESC
     LIMIT 300`,
    ...params
  );

  res.json({
    transactions: rows.map((r) => ({
      id: r.id,
      transactionRef: r.transaction_ref,
      orderId: r.order_id,
      orderNumber: r.order_number,
      orderDate: r.order_date,
      collectionSlot: r.collection_slot,
      orderStatus: r.order_status,
      payerName: r.payer_name,
      payerRole: r.payer_role,
      beneficiaryName: r.beneficiary_name,
      className: r.class_name || 'Staff',
      provider: r.provider,
      amountFils: r.amount_fils,
      amountAed: filsToAed(r.amount_fils),
      formattedAmount: formatAed(r.amount_fils, r.currency),
      currency: r.currency,
      status: r.status,
      paymentMethodLabel: r.payment_method_label,
      failureReason: r.failure_reason,
      refundReason: r.refund_reason,
      refundedAt: r.refunded_at,
      createdAt: r.created_at,
    })),
  });
});

// Admin: Issue Refund
paymentsRouter.post('/:transactionId/refund', authenticate, requireRole(['admin']), (req, res) => {
  try {
    const txnId = Number(req.params.transactionId);
    const { reason } = req.body || {};
    const db = getDb();

    const txn = db.get<{
      id: number;
      transaction_ref: string;
      order_id: number;
      status: string;
      amount_fils: number;
      provider: string;
    }>('SELECT * FROM payment_transactions WHERE id = ?', txnId);

    if (!txn) {
      res.status(404).json({ error: 'Transaction not found.' });
      return;
    }
    if (txn.provider !== 'brs_sandbox_aed') {
      res.status(409).json({ error: 'A real payment cannot be refunded here yet. Reconcile and refund it through the payment provider.' });
      return;
    }
    if (txn.status !== 'succeeded') {
      res.status(400).json({ error: `Only succeeded payments can be refunded (current: ${txn.status}).` });
      return;
    }

    const ord = db.get<{
      id: number;
      order_number: string;
      order_status: string;
      placed_by_user_id: number;
      beneficiary_user_id: number;
    }>('SELECT * FROM orders WHERE id = ?', txn.order_id)!;

    const refundNote = reason ? String(reason).trim() : `Refund issued by Administrator (${req.user!.fullName})`;

    db.transaction(() => {
      db.run(
        `UPDATE payment_transactions
         SET status = 'refunded',
             refund_reason = ?,
             refunded_at = datetime('now'),
             refunded_by_user_id = ?,
             updated_at = datetime('now')
         WHERE id = ?`,
        refundNote,
        req.user!.id,
        txn.id
      );

      db.run(
        `UPDATE orders
         SET payment_status = 'refunded',
             order_status = CASE WHEN order_status = 'collected' THEN order_status ELSE 'cancelled' END,
             cancelled_at = COALESCE(cancelled_at, datetime('now')),
             cancelled_by_user_id = COALESCE(cancelled_by_user_id, ?),
             cancellation_reason = COALESCE(cancellation_reason, ?),
             updated_at = datetime('now')
         WHERE id = ?`,
        req.user!.id,
        refundNote,
        txn.order_id
      );

      db.run(
        `UPDATE qr_verification_tokens SET revoked_at = datetime('now') WHERE order_id = ?`,
        txn.order_id
      );

      recordOrderStatusChange(db, {
        orderId: txn.order_id,
        previousStatus: ord.order_status,
        newStatus: ord.order_status === 'collected' ? 'collected' : 'cancelled',
        changedByUserId: req.user!.id,
        note: `Payment refunded (${txn.transaction_ref}): ${refundNote}`,
      });

      logAdminActivity(db, {
        actorUserId: req.user!.id,
        action: 'REFUND_PAYMENT',
        targetType: 'payment_transaction',
        targetId: txn.id,
        details: {
          transactionRef: txn.transaction_ref,
          orderNumber: ord.order_number,
          amountFils: txn.amount_fils,
          reason: refundNote,
        },
        ipAddress: req.ip,
      });
    });

    eventHub.broadcast(
      'payment.updated',
      { orderId: txn.order_id, status: 'refunded', transactionRef: txn.transaction_ref },
      { roles: ['admin', 'chef'], userIds: [ord.placed_by_user_id, ord.beneficiary_user_id] }
    );

    res.json({ message: 'Payment refunded successfully.' });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to refund payment.' });
  }
});
