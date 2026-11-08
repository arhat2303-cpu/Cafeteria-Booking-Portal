import { Router } from 'express';
import { getDb } from '../db/connection.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { hashToken, verifyQrSignature } from '../services/qr.js';
import { recordOrderStatusChange } from '../services/audit.js';
import { eventHub } from '../services/events.js';
import { formatOrderRecord } from './orders.js';

export const chefRouter = Router();

chefRouter.use(authenticate, requireRole(['chef', 'admin']));

function buildVerificationDetails(orderId: number) {
  const formatted = formatOrderRecord(orderId, 'chef');
  if (!formatted) return null;
  return {
    orderId: formatted.id,
    orderNumber: formatted.orderNumber,
    studentFullName: formatted.beneficiaryName,
    studentClass: formatted.className,
    beneficiaryRole: formatted.beneficiaryRole,
    studentCode: formatted.studentCode,
    allergiesNotes: formatted.allergiesNotes,
    items: formatted.items.map((it) => ({
      id: it.id,
      name: it.name,
      quantity: it.quantity,
      notes: it.notes,
    })),
    collectionDate: formatted.orderDate,
    collectionTime: formatted.collectionSlot,
    paymentStatus: formatted.paymentStatus,
    orderStatus: formatted.orderStatus,
    specialInstructions: formatted.specialInstructions,
    formattedTotal: formatted.formattedTotal,
    collection: formatted.collection,
  };
}

// List Incoming & Completed Paid Orders for Kitchen Display
chefRouter.get('/orders', (req, res) => {
  const db = getDb();
  const { date, slot, status, search } = req.query;

  const where: string[] = [`o.payment_status = 'paid'`];
  const params: unknown[] = [];

  if (date && typeof date === 'string' && date !== 'all') {
    where.push('o.order_date = ?');
    params.push(date);
  }
  if (slot && typeof slot === 'string' && slot !== 'all') {
    where.push('o.collection_slot = ?');
    params.push(slot);
  }
  if (status && typeof status === 'string' && status !== 'all') {
    where.push('o.order_status = ?');
    params.push(status);
  } else {
    where.push(`o.order_status != 'cancelled'`);
  }
  if (search && typeof search === 'string' && search.trim()) {
    const q = `%${search.trim().toLowerCase()}%`;
    where.push(
      `(LOWER(o.order_number) LIKE ? OR LOWER(ben.full_name) LIKE ? OR LOWER(COALESCE(sp.class_name, '')) LIKE ?)`
    );
    params.push(q, q, q);
  }

  const rows = db.all<{ id: number }>(
    `SELECT o.id
     FROM orders o
     JOIN users ben ON ben.id = o.beneficiary_user_id
     LEFT JOIN student_profiles sp ON sp.user_id = o.beneficiary_user_id
     WHERE ${where.join(' AND ')}
     ORDER BY
       CASE o.order_status
         WHEN 'confirmed' THEN 1
         WHEN 'preparing' THEN 2
         WHEN 'ready_for_collection' THEN 3
         WHEN 'collected' THEN 4
         ELSE 5
       END ASC,
       o.order_date ASC,
       o.collection_slot ASC,
       o.id ASC
     LIMIT 300`,
    ...params
  );

  const orders = rows
    .map((r) => formatOrderRecord(r.id, 'chef'))
    .filter((o): o is NonNullable<typeof o> => Boolean(o));

  // Summary counts for selected date (or all active)
  const countDateWhere =
    date && typeof date === 'string' && date !== 'all' ? 'AND order_date = ?' : '';
  const countParams = date && typeof date === 'string' && date !== 'all' ? [date] : [];

  const countsRows = db.all<{ order_status: string; cnt: number }>(
    `SELECT order_status, COUNT(*) as cnt
     FROM orders
     WHERE payment_status = 'paid' ${countDateWhere}
     GROUP BY order_status`,
    ...countParams
  );

  const counts: Record<string, number> = {
    confirmed: 0,
    preparing: 0,
    ready_for_collection: 0,
    collected: 0,
  };
  for (const cr of countsRows) {
    counts[cr.order_status] = cr.cnt;
  }

  res.json({ orders, counts });
});

// Chef: Update Preparation Status (Preparing -> Ready for Collection)
chefRouter.patch('/orders/:id/prep-status', (req, res) => {
  try {
    const orderId = Number(req.params.id);
    const { status } = req.body || {};

    if (!['preparing', 'ready_for_collection'].includes(status)) {
      res.status(400).json({
        error: 'Chef preparation status must be either "preparing" or "ready_for_collection".',
      });
      return;
    }

    const db = getDb();
    const order = db.get<{
      id: number;
      order_number: string;
      payment_status: string;
      order_status: string;
      placed_by_user_id: number;
      beneficiary_user_id: number;
    }>('SELECT * FROM orders WHERE id = ?', orderId);

    if (!order) {
      res.status(404).json({ error: 'Order not found.' });
      return;
    }

    if (order.payment_status !== 'paid') {
      res.status(400).json({ error: 'Payment not completed. Unpaid orders cannot be prepared.' });
      return;
    }

    if (order.order_status === 'collected') {
      res.status(409).json({ error: 'This order has already been collected.' });
      return;
    }

    if (order.order_status === 'cancelled') {
      res.status(400).json({ error: 'Cancelled orders cannot be prepared.' });
      return;
    }

    db.transaction(() => {
      db.run(
        `UPDATE orders SET order_status = ?, updated_at = datetime('now') WHERE id = ?`,
        status,
        orderId
      );

      recordOrderStatusChange(db, {
        orderId,
        previousStatus: order.order_status,
        newStatus: status,
        changedByUserId: req.user!.id,
        note:
          status === 'preparing'
            ? `Kitchen started preparing meal (${req.user!.fullName})`
            : `Meal marked Ready for Collection (${req.user!.fullName})`,
      });
    });

    eventHub.broadcast(
      'order.updated',
      { orderId, orderNumber: order.order_number, orderStatus: status },
      {
        roles: ['chef', 'admin'],
        userIds: [order.placed_by_user_id, order.beneficiary_user_id],
      }
    );

    res.json({
      message:
        status === 'preparing'
          ? 'Order marked as Preparing.'
          : 'Order marked as Ready for Collection.',
      order: formatOrderRecord(orderId, 'chef'),
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to update preparation status.' });
  }
});

// Chef: Verify QR Code Scan
chefRouter.post('/verify-qr', (req, res) => {
  const { qrPayload } = req.body || {};
  const sigCheck = verifyQrSignature(String(qrPayload || ''));

  if (!sigCheck.valid || !sigCheck.tokenUid) {
    res.status(400).json({
      valid: false,
      code: 'INVALID_QR',
      message: 'Invalid QR code. Please scan a valid Bright Riders School order QR code.',
    });
    return;
  }

  const db = getDb();
  const tokenRow = db.get<{
    id: number;
    order_id: number;
    token_hash: string;
    is_used: number;
    revoked_at: string | null;
  }>(
    'SELECT id, order_id, token_hash, is_used, revoked_at FROM qr_verification_tokens WHERE token_uid = ?',
    sigCheck.tokenUid
  );

  if (!tokenRow || tokenRow.token_hash !== hashToken(String(qrPayload).trim())) {
    res.status(404).json({
      valid: false,
      code: 'UNKNOWN_ORDER',
      message: 'Invalid QR code. Please scan a valid Bright Riders School order QR code.',
    });
    return;
  }

  const details = buildVerificationDetails(tokenRow.order_id);
  if (!details) {
    res.status(404).json({
      valid: false,
      code: 'UNKNOWN_ORDER',
      message: 'Unknown order reference. Order was not found in the canteen database.',
    });
    return;
  }

  if (details.paymentStatus !== 'paid') {
    res.status(400).json({
      valid: false,
      code: 'UNPAID_ORDER',
      message: 'Payment not completed. This order cannot be collected.',
      order: details,
    });
    return;
  }

  if (details.orderStatus === 'cancelled' || tokenRow.revoked_at) {
    res.status(400).json({
      valid: false,
      code: 'CANCELLED_ORDER',
      message: 'This order has been cancelled or refunded and cannot be collected.',
      order: details,
    });
    return;
  }

  if (details.orderStatus === 'collected' || details.collection || tokenRow.is_used) {
    res.status(409).json({
      valid: false,
      code: 'ALREADY_COLLECTED',
      message: 'This order has already been collected.',
      order: details,
    });
    return;
  }

  res.json({
    valid: true,
    code: 'VERIFIED_READY',
    message: 'Order verified successfully. Ready for collection confirmation.',
    verificationMethod: 'qr_scan',
    qrTokenId: tokenRow.id,
    order: details,
  });
});

// Chef: Manual Order ID Search Backup
chefRouter.post('/verify-order', (req, res) => {
  const { orderNumber } = req.body || {};
  const cleanNum = String(orderNumber || '').trim();
  if (!cleanNum) {
    res.status(400).json({
      valid: false,
      code: 'MISSING_ORDER_ID',
      message: 'Please enter a valid Bright Riders Order ID (e.g., BRS-20261108-12345).',
    });
    return;
  }

  const db = getDb();
  const row = db.get<{ id: number }>(
    'SELECT id FROM orders WHERE UPPER(order_number) = UPPER(?)',
    cleanNum
  );

  if (!row) {
    res.status(404).json({
      valid: false,
      code: 'UNKNOWN_ORDER',
      message: `Order "${cleanNum}" was not found. Please check the Order ID and try again.`,
    });
    return;
  }

  const details = buildVerificationDetails(row.id);
  if (!details) {
    res.status(404).json({
      valid: false,
      code: 'UNKNOWN_ORDER',
      message: 'Order not found.',
    });
    return;
  }

  if (details.paymentStatus !== 'paid') {
    res.status(400).json({
      valid: false,
      code: 'UNPAID_ORDER',
      message: 'Payment not completed. This order cannot be collected.',
      order: details,
    });
    return;
  }

  if (details.orderStatus === 'cancelled') {
    res.status(400).json({
      valid: false,
      code: 'CANCELLED_ORDER',
      message: 'This order was cancelled and cannot be collected.',
      order: details,
    });
    return;
  }

  if (details.orderStatus === 'collected' || details.collection) {
    res.status(409).json({
      valid: false,
      code: 'ALREADY_COLLECTED',
      message: 'This order has already been collected.',
      order: details,
    });
    return;
  }

  res.json({
    valid: true,
    code: 'VERIFIED_READY',
    message: 'Order verified successfully. Ready for collection confirmation.',
    verificationMethod: 'manual_order_lookup',
    order: details,
  });
});

// Chef: Confirm Student/Staff Collection (Single-use atomic DB lock)
chefRouter.post('/confirm-collection', (req, res) => {
  try {
    const { orderId, verificationMethod = 'qr_scan', qrPayload, notes } = req.body || {};
    const numericOrderId = Number(orderId);
    if (!numericOrderId) {
      res.status(400).json({ error: 'Valid orderId is required to confirm collection.' });
      return;
    }

    const method =
      verificationMethod === 'manual_order_lookup' ? 'manual_order_lookup' : 'qr_scan';

    const db = getDb();
    let qrTokenId: number | null = null;

    if (method === 'qr_scan' && qrPayload) {
      const sigCheck = verifyQrSignature(String(qrPayload));
      if (!sigCheck.valid || !sigCheck.tokenUid) {
        res.status(400).json({
          code: 'INVALID_QR',
          error: 'Invalid QR code. Please scan a valid Bright Riders School order QR code.',
        });
        return;
      }
      const tr = db.get<{ id: number; order_id: number }>(
        'SELECT id, order_id FROM qr_verification_tokens WHERE token_uid = ?',
        sigCheck.tokenUid
      );
      if (!tr || tr.order_id !== numericOrderId) {
        res.status(400).json({
          code: 'TOKEN_MISMATCH',
          error: 'QR verification token does not match the specified order.',
        });
        return;
      }
      qrTokenId = tr.id;
    }

    let placedByUserId = 0;
    let beneficiaryUserId = 0;
    let orderNumber = '';

    db.transaction(() => {
      const order = db.get<{
        id: number;
        order_number: string;
        payment_status: string;
        order_status: string;
        placed_by_user_id: number;
        beneficiary_user_id: number;
      }>('SELECT * FROM orders WHERE id = ?', numericOrderId);

      if (!order) {
        throw new Error('UNKNOWN_ORDER:Order not found.');
      }
      placedByUserId = order.placed_by_user_id;
      beneficiaryUserId = order.beneficiary_user_id;
      orderNumber = order.order_number;

      if (order.payment_status !== 'paid') {
        throw new Error('UNPAID_ORDER:Payment not completed. This order cannot be collected.');
      }

      if (order.order_status === 'cancelled') {
        throw new Error('CANCELLED_ORDER:Cancelled orders cannot be collected.');
      }

      const existingCollection = db.get<{ id: number }>(
        'SELECT id FROM collection_records WHERE order_id = ?',
        numericOrderId
      );
      if (existingCollection || order.order_status === 'collected') {
        throw new Error('ALREADY_COLLECTED:This order has already been collected.');
      }

      if (!qrTokenId) {
        const tok = db.get<{ id: number }>(
          'SELECT id FROM qr_verification_tokens WHERE order_id = ?',
          numericOrderId
        );
        qrTokenId = tok?.id ?? null;
      }

      db.run(
        `INSERT INTO collection_records (order_id, qr_token_id, verified_by_chef_id, verification_method, notes)
         VALUES (?, ?, ?, ?, ?)`,
        numericOrderId,
        qrTokenId,
        req.user!.id,
        method,
        notes ? String(notes).slice(0, 300) : null
      );

      db.run(
        `UPDATE qr_verification_tokens
         SET is_used = 1, used_at = datetime('now')
         WHERE order_id = ?`,
        numericOrderId
      );

      db.run(
        `UPDATE orders
         SET order_status = 'collected', updated_at = datetime('now')
         WHERE id = ?`,
        numericOrderId
      );

      recordOrderStatusChange(db, {
        orderId: numericOrderId,
        previousStatus: order.order_status,
        newStatus: 'collected',
        changedByUserId: req.user!.id,
        note: `Collected & verified by ${req.user!.fullName} via ${
          method === 'qr_scan' ? 'QR Code Scan' : 'Manual Order ID Verification'
        }`,
      });
    });

    eventHub.broadcast(
      'order.collected',
      {
        orderId: numericOrderId,
        orderNumber,
        orderStatus: 'collected',
        collectedByChef: req.user!.fullName,
      },
      {
        roles: ['chef', 'admin'],
        userIds: [placedByUserId, beneficiaryUserId],
      }
    );

    res.json({
      message: 'Collection confirmed! Order marked as Collected.',
      order: buildVerificationDetails(numericOrderId),
    });
  } catch (err: any) {
    const rawMsg = String(err.message || 'Collection confirmation failed.');
    if (rawMsg.startsWith('ALREADY_COLLECTED:')) {
      res.status(409).json({
        code: 'ALREADY_COLLECTED',
        error: rawMsg.slice('ALREADY_COLLECTED:'.length),
      });
      return;
    }
    if (rawMsg.startsWith('UNPAID_ORDER:')) {
      res.status(400).json({
        code: 'UNPAID_ORDER',
        error: rawMsg.slice('UNPAID_ORDER:'.length),
      });
      return;
    }
    res.status(400).json({ error: rawMsg.replace(/^[A-Z_]+:/, '') });
  }
});
