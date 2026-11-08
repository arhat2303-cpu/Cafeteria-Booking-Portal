import { Router } from 'express';
import crypto from 'node:crypto';
import { getDb } from '../db/connection.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { evaluateItemAvailabilityForDate } from './menu.js';
import { filsToAed, formatAed } from '../services/money.js';
import { generateQrDataUrl, issueOrderQrToken } from '../services/qr.js';
import { logAdminActivity, recordOrderStatusChange } from '../services/audit.js';
import { eventHub } from '../services/events.js';

export const ordersRouter = Router();

function generateOrderNumber(orderDate: string): string {
  const compactDate = orderDate.replace(/-/g, '');
  const rand = crypto.randomInt(10000, 99999);
  return `BRS-${compactDate}-${rand}`;
}

export function formatOrderRecord(orderId: number, viewerRole: string) {
  const db = getDb();
  const order = db.get<Record<string, any>>(
    `SELECT o.*,
            placer.full_name as placed_by_name,
            placer.role as placed_by_role,
            ben.full_name as beneficiary_name,
            ben.username as beneficiary_username,
            sp.student_code,
            sp.class_name,
            sp.allergies_notes,
            tp.staff_code as teacher_staff_code,
            tp.department as teacher_department,
            cr.collected_at,
            cr.verification_method,
            chef_u.full_name as collected_by_chef_name,
            qvt.signed_token,
            qvt.is_used as qr_is_used,
            qvt.revoked_at as qr_revoked_at
     FROM orders o
     JOIN users placer ON placer.id = o.placed_by_user_id
     JOIN users ben ON ben.id = o.beneficiary_user_id
     LEFT JOIN student_profiles sp ON sp.user_id = o.beneficiary_user_id
     LEFT JOIN teacher_profiles tp ON tp.user_id = o.beneficiary_user_id
     LEFT JOIN collection_records cr ON cr.order_id = o.id
     LEFT JOIN users chef_u ON chef_u.id = cr.verified_by_chef_id
     LEFT JOIN qr_verification_tokens qvt ON qvt.order_id = o.id
     WHERE o.id = ?`,
    orderId
  );

  if (!order) return null;

  const items = db.all<{
    id: number;
    menu_item_id: number | null;
    item_name_snapshot: string;
    category_name_snapshot: string | null;
    unit_price_fils: number;
    quantity: number;
    line_total_fils: number;
    notes: string | null;
  }>('SELECT * FROM order_items WHERE order_id = ? ORDER BY id ASC', orderId);

  const history = db.all<{
    id: number;
    previous_status: string | null;
    new_status: string;
    note: string | null;
    created_at: string;
    actor_name: string | null;
  }>(
    `SELECT osh.*, u.full_name as actor_name
     FROM order_status_history osh
     LEFT JOIN users u ON u.id = osh.changed_by_user_id
     WHERE osh.order_id = ?
     ORDER BY osh.id ASC`,
    orderId
  );

  const payments =
    viewerRole === 'student' || viewerRole === 'chef'
      ? []
      : db.all<{
          id: number;
          transaction_ref: string;
          provider: string;
          amount_fils: number;
          currency: string;
          status: string;
          payment_method_label: string | null;
          failure_reason: string | null;
          refund_reason: string | null;
          refunded_at: string | null;
          created_at: string;
        }>(
          'SELECT * FROM payment_transactions WHERE order_id = ? ORDER BY id DESC',
          orderId
        );

  // Never expose raw signed_token to Chef in list responses (Chefs must scan QR or lookup manually)
  const canViewQrToken =
    order.payment_status === 'paid' &&
    order.order_status !== 'cancelled' &&
    !order.qr_revoked_at &&
    ['parent', 'student', 'teacher', 'admin'].includes(viewerRole);

  return {
    id: order.id,
    orderNumber: order.order_number,
    placedByUserId: order.placed_by_user_id,
    placedByName: order.placed_by_name,
    placedByRole: order.placed_by_role,
    beneficiaryUserId: order.beneficiary_user_id,
    beneficiaryName: order.beneficiary_name,
    beneficiaryRole: order.beneficiary_role,
    studentCode: order.student_code || null,
    className: order.class_name || (order.teacher_department ? `Staff • ${order.teacher_department}` : 'Staff'),
    allergiesNotes: order.allergies_notes || null,
    orderDate: order.order_date,
    collectionSlot: order.collection_slot,
    subtotalFils: order.subtotal_fils,
    subtotalAed: filsToAed(order.subtotal_fils),
    totalFils: order.total_fils,
    totalAed: filsToAed(order.total_fils),
    formattedTotal: formatAed(order.total_fils, order.currency),
    currency: order.currency,
    paymentStatus: order.payment_status,
    orderStatus: order.order_status,
    specialInstructions: order.special_instructions,
    cancelledAt: order.cancelled_at,
    cancellationReason: order.cancellation_reason,
    hasQrCode: Boolean(order.signed_token && !order.qr_revoked_at && order.payment_status === 'paid'),
    qrToken: canViewQrToken ? order.signed_token : null,
    qrUsed: Boolean(order.qr_is_used),
    collection: order.collected_at
      ? {
          collectedAt: order.collected_at,
          verificationMethod: order.verification_method,
          collectedByChefName: order.collected_by_chef_name,
        }
      : null,
    items: items.map((it) => ({
      id: it.id,
      menuItemId: it.menu_item_id,
      name: it.item_name_snapshot,
      categoryName: it.category_name_snapshot,
      unitPriceFils: it.unit_price_fils,
      unitPriceAed: filsToAed(it.unit_price_fils),
      quantity: it.quantity,
      lineTotalFils: it.line_total_fils,
      lineTotalAed: filsToAed(it.line_total_fils),
      formattedLineTotal: formatAed(it.line_total_fils),
      notes: it.notes,
    })),
    statusHistory: history.map((h) => ({
      id: h.id,
      previousStatus: h.previous_status,
      newStatus: h.new_status,
      actorName: h.actor_name,
      note: h.note,
      createdAt: h.created_at,
    })),
    payments: payments.map((p) => ({
      id: p.id,
      transactionRef: p.transaction_ref,
      provider: p.provider,
      amountFils: p.amount_fils,
      amountAed: filsToAed(p.amount_fils),
      formattedAmount: formatAed(p.amount_fils, p.currency),
      currency: p.currency,
      status: p.status,
      paymentMethodLabel: p.payment_method_label,
      failureReason: p.failure_reason,
      refundReason: p.refund_reason,
      refundedAt: p.refunded_at,
      createdAt: p.created_at,
    })),
    createdAt: order.created_at,
    updatedAt: order.updated_at,
  };
}

function userCanAccessOrder(userId: number, role: string, orderId: number): boolean {
  const db = getDb();
  if (role === 'admin') return true;

  const order = db.get<{
    placed_by_user_id: number;
    beneficiary_user_id: number;
    payment_status: string;
  }>('SELECT placed_by_user_id, beneficiary_user_id, payment_status FROM orders WHERE id = ?', orderId);

  if (!order) return false;

  if (role === 'chef') {
    return order.payment_status === 'paid';
  }
  if (role === 'student') {
    return order.beneficiary_user_id === userId && order.payment_status === 'paid';
  }
  if (role === 'teacher') {
    return order.placed_by_user_id === userId || order.beneficiary_user_id === userId;
  }
  if (role === 'parent') {
    if (order.placed_by_user_id === userId) return true;
    const link = db.get<{ id: number }>(
      'SELECT id FROM parent_student_links WHERE parent_user_id = ? AND student_user_id = ?',
      userId,
      order.beneficiary_user_id
    );
    return Boolean(link);
  }
  return false;
}

// Create Order (Parent for linked child, or Teacher for self when enabled)
ordersRouter.post('/', authenticate, requireRole(['parent', 'teacher']), (req, res) => {
  try {
    const db = getDb();
    const userId = req.user!.id;
    const role = req.user!.role;

    const {
      beneficiaryUserId,
      orderDate,
      collectionSlot,
      specialInstructions,
      items: directItems,
      idempotencyKey,
    } = req.body || {};

    if (idempotencyKey && typeof idempotencyKey === 'string') {
      const existingOrder = db.get<{ id: number; placed_by_user_id: number }>(
        'SELECT id, placed_by_user_id FROM orders WHERE idempotency_key = ?',
        idempotencyKey.trim()
      );
      if (existingOrder && existingOrder.placed_by_user_id === userId) {
        res.status(200).json({
          order: formatOrderRecord(existingOrder.id, role),
          deduplicated: true,
        });
        return;
      }
    }

    // Check Teacher Ordering Permission if Teacher
    let resolvedBeneficiaryId: number;
    let beneficiaryRole: 'student' | 'teacher';

    if (role === 'teacher') {
      const setting = db.get<{ value: string }>(
        `SELECT value FROM platform_settings WHERE key = 'teacher_ordering_enabled'`
      );
      const tp = db.get<{ can_place_orders_override: number | null }>(
        'SELECT can_place_orders_override FROM teacher_profiles WHERE user_id = ?',
        userId
      );
      const globallyEnabled = !setting || setting.value !== 'false';
      const allowed =
        tp?.can_place_orders_override !== null && tp?.can_place_orders_override !== undefined
          ? Boolean(tp.can_place_orders_override)
          : globallyEnabled;

      if (!allowed) {
        res.status(403).json({
          error: 'Teacher canteen ordering is currently disabled by Bright Riders School administration.',
        });
        return;
      }
      resolvedBeneficiaryId = userId;
      beneficiaryRole = 'teacher';
    } else {
      // Parent must specify a linked active student (from body or cart)
      const cartMeta = db.get<{
        id: number;
        beneficiary_user_id: number | null;
        order_date: string | null;
        collection_slot: string | null;
        special_instructions: string | null;
      }>('SELECT * FROM shopping_carts WHERE user_id = ?', userId);

      const candidateStudentId = Number(beneficiaryUserId || cartMeta?.beneficiary_user_id || 0);
      if (!candidateStudentId) {
        res.status(400).json({ error: 'Please select which linked child this order is for.' });
        return;
      }

      const link = db.get<{ id: number }>(
        `SELECT psl.id
         FROM parent_student_links psl
         JOIN users u ON u.id = psl.student_user_id
         WHERE psl.parent_user_id = ? AND psl.student_user_id = ? AND u.is_active = 1`,
        userId,
        candidateStudentId
      );
      if (!link) {
        res.status(403).json({
          error: 'You can only place canteen orders for children linked to your parent account.',
        });
        return;
      }
      resolvedBeneficiaryId = candidateStudentId;
      beneficiaryRole = 'student';
    }

    const cartRow = db.get<{
      id: number;
      order_date: string | null;
      collection_slot: string | null;
      special_instructions: string | null;
    }>('SELECT * FROM shopping_carts WHERE user_id = ?', userId);

    const finalOrderDate = String(orderDate || cartRow?.order_date || '').trim();
    const finalSlot = String(collectionSlot || cartRow?.collection_slot || '').trim();
    const finalNotes =
      specialInstructions !== undefined
        ? String(specialInstructions).trim()
        : cartRow?.special_instructions || '';

    if (!/^\d{4}-\d{2}-\d{2}$/.test(finalOrderDate)) {
      res.status(400).json({ error: 'Please select a valid ordering date (YYYY-MM-DD).' });
      return;
    }

    const todayUtc = new Date().toISOString().slice(0, 10);
    if (finalOrderDate < todayUtc) {
      res.status(400).json({ error: 'Ordering date cannot be in the past.' });
      return;
    }

    if (!finalSlot) {
      res.status(400).json({ error: 'Please select an available collection time slot.' });
      return;
    }

    // Gather requested items from explicit body or persistent shopping cart
    let requestedLines: Array<{ menuItemId: number; quantity: number; notes: string | null }> = [];
    if (Array.isArray(directItems) && directItems.length > 0) {
      requestedLines = directItems.map((d: any) => ({
        menuItemId: Number(d.menuItemId),
        quantity: Number(d.quantity),
        notes: d.notes ? String(d.notes).slice(0, 200) : null,
      }));
    } else if (cartRow) {
      const cartItems = db.all<{
        menu_item_id: number;
        quantity: number;
        item_notes: string | null;
      }>('SELECT menu_item_id, quantity, item_notes FROM shopping_cart_items WHERE cart_id = ?', cartRow.id);
      requestedLines = cartItems.map((ci) => ({
        menuItemId: ci.menu_item_id,
        quantity: ci.quantity,
        notes: ci.item_notes,
      }));
    }

    if (requestedLines.length === 0) {
      res.status(400).json({ error: 'Your shopping cart is empty. Add food items before checkout.' });
      return;
    }

    let createdOrderId = 0;

    db.transaction(() => {
      let subtotalFils = 0;
      const verifiedLines: Array<{
        menuItemId: number;
        name: string;
        categoryName: string;
        unitPriceFils: number;
        quantity: number;
        lineTotalFils: number;
        notes: string | null;
      }> = [];

      for (const line of requestedLines) {
        if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 50) {
          throw new Error('Invalid item quantity in order.');
        }

        const menuItem = db.get<{
          id: number;
          name: string;
          price_fils: number;
          is_available: number;
          category_name: string;
          category_active: number;
        }>(
          `SELECT mi.id, mi.name, mi.price_fils, mi.is_available,
                  fc.name as category_name, fc.is_active as category_active
           FROM menu_items mi
           JOIN food_categories fc ON fc.id = mi.category_id
           WHERE mi.id = ?`,
          line.menuItemId
        );

        if (!menuItem) {
          throw new Error(`Selected food item (#${line.menuItemId}) no longer exists on the menu.`);
        }

        const itemSchedules = db.all<{
          day_of_week: number | null;
          specific_date: string | null;
          is_available: number;
          special_note: string | null;
        }>(
          'SELECT day_of_week, specific_date, is_available, special_note FROM menu_availability_schedules WHERE menu_item_id = ?',
          menuItem.id
        );

        const avail = evaluateItemAvailabilityForDate(
          Boolean(menuItem.is_available),
          Boolean(menuItem.category_active),
          itemSchedules,
          finalOrderDate
        );

        if (!avail.availableOnDate) {
          throw new Error(
            `"${menuItem.name}" is unavailable on ${finalOrderDate}${
              avail.scheduleNote ? ` (${avail.scheduleNote})` : ''
            }.`
          );
        }

        const lineTotalFils = menuItem.price_fils * line.quantity;
        subtotalFils += lineTotalFils;
        verifiedLines.push({
          menuItemId: menuItem.id,
          name: menuItem.name,
          categoryName: menuItem.category_name,
          unitPriceFils: menuItem.price_fils,
          quantity: line.quantity,
          lineTotalFils,
          notes: line.notes,
        });
      }

      let orderNumber = generateOrderNumber(finalOrderDate);
      while (db.get('SELECT id FROM orders WHERE order_number = ?', orderNumber)) {
        orderNumber = generateOrderNumber(finalOrderDate);
      }

      const orderRes = db.run(
        `INSERT INTO orders (
          order_number, placed_by_user_id, beneficiary_user_id, beneficiary_role,
          order_date, collection_slot, subtotal_fils, total_fils, currency,
          payment_status, order_status, special_instructions, idempotency_key
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'AED', 'pending', 'awaiting_payment', ?, ?)`,
        orderNumber,
        userId,
        resolvedBeneficiaryId,
        beneficiaryRole,
        finalOrderDate,
        finalSlot,
        subtotalFils,
        subtotalFils,
        finalNotes ? finalNotes.slice(0, 500) : null,
        idempotencyKey ? String(idempotencyKey).trim() : null
      );

      createdOrderId = orderRes.lastInsertRowid;

      for (const vl of verifiedLines) {
        db.run(
          `INSERT INTO order_items (
            order_id, menu_item_id, item_name_snapshot, category_name_snapshot,
            unit_price_fils, quantity, line_total_fils, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          createdOrderId,
          vl.menuItemId,
          vl.name,
          vl.categoryName,
          vl.unitPriceFils,
          vl.quantity,
          vl.lineTotalFils,
          vl.notes
        );
      }

      recordOrderStatusChange(db, {
        orderId: createdOrderId,
        previousStatus: null,
        newStatus: 'awaiting_payment',
        changedByUserId: userId,
        note: 'Order created and awaiting digital payment confirmation',
      });

      // Clear shopping cart items if created from cart
      if (!Array.isArray(directItems) && cartRow) {
        db.run('DELETE FROM shopping_cart_items WHERE cart_id = ?', cartRow.id);
      }
    });

    res.status(201).json({
      order: formatOrderRecord(createdOrderId, role),
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to create order.' });
  }
});

// List Orders (Scoped strictly by Role)
ordersRouter.get('/', authenticate, (req, res) => {
  const db = getDb();
  const user = req.user!;
  const { status, paymentStatus, date, studentId, className, search } = req.query;

  const where: string[] = [];
  const params: unknown[] = [];

  if (user.role === 'parent') {
    where.push(
      `(o.placed_by_user_id = ? OR o.beneficiary_user_id IN (
        SELECT student_user_id FROM parent_student_links WHERE parent_user_id = ?
      ))`
    );
    params.push(user.id, user.id);
  } else if (user.role === 'student') {
    where.push(`(o.beneficiary_user_id = ? AND o.payment_status = 'paid')`);
    params.push(user.id);
  } else if (user.role === 'teacher') {
    where.push(`(o.placed_by_user_id = ? OR o.beneficiary_user_id = ?)`);
    params.push(user.id, user.id);
  } else if (user.role === 'chef') {
    where.push(`o.payment_status = 'paid'`);
  }

  if (status && typeof status === 'string' && status !== 'all') {
    where.push('o.order_status = ?');
    params.push(status);
  }
  if (paymentStatus && typeof paymentStatus === 'string' && paymentStatus !== 'all') {
    where.push('o.payment_status = ?');
    params.push(paymentStatus);
  }
  if (date && typeof date === 'string') {
    where.push('o.order_date = ?');
    params.push(date);
  }
  if (studentId && typeof studentId === 'string') {
    where.push('o.beneficiary_user_id = ?');
    params.push(Number(studentId));
  }
  if (className && typeof className === 'string' && className !== 'all') {
    where.push('sp.class_name = ?');
    params.push(className);
  }
  if (search && typeof search === 'string' && search.trim()) {
    const q = `%${search.trim().toLowerCase()}%`;
    where.push(
      `(LOWER(o.order_number) LIKE ? OR LOWER(ben.full_name) LIKE ? OR LOWER(placer.full_name) LIKE ? OR LOWER(COALESCE(sp.student_code, '')) LIKE ?)`
    );
    params.push(q, q, q, q);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const orderIds = db.all<{ id: number }>(
    `SELECT o.id
     FROM orders o
     JOIN users placer ON placer.id = o.placed_by_user_id
     JOIN users ben ON ben.id = o.beneficiary_user_id
     LEFT JOIN student_profiles sp ON sp.user_id = o.beneficiary_user_id
     ${whereSql}
     ORDER BY o.order_date DESC, o.id DESC
     LIMIT 300`,
    ...params
  );

  const orders = orderIds
    .map((r) => formatOrderRecord(r.id, user.role))
    .filter((o): o is NonNullable<typeof o> => Boolean(o));

  res.json({ orders });
});

// Get Single Order
ordersRouter.get('/:id', authenticate, (req, res) => {
  const orderId = Number(req.params.id);
  if (!userCanAccessOrder(req.user!.id, req.user!.role, orderId)) {
    res.status(403).json({ error: 'You do not have permission to view this order.' });
    return;
  }
  const order = formatOrderRecord(orderId, req.user!.role);
  if (!order) {
    res.status(404).json({ error: 'Order not found.' });
    return;
  }
  res.json({ order });
});

// Get Unique Order QR Code Image & Signed Token
ordersRouter.get('/:id/qr', authenticate, async (req, res) => {
  try {
    const orderId = Number(req.params.id);
    const role = req.user!.role;

    if (role === 'chef') {
      res.status(403).json({ error: 'Chefs verify QR codes via scanner rather than generating student QR passes.' });
      return;
    }

    if (!userCanAccessOrder(req.user!.id, role, orderId)) {
      res.status(403).json({ error: 'You do not have permission to access this order QR code.' });
      return;
    }

    const db = getDb();
    const order = db.get<{
      id: number;
      order_number: string;
      payment_status: string;
      order_status: string;
      order_date: string;
      collection_slot: string;
      beneficiary_name: string;
      class_name: string | null;
    }>(
      `SELECT o.id, o.order_number, o.payment_status, o.order_status, o.order_date, o.collection_slot,
              u.full_name as beneficiary_name, sp.class_name
       FROM orders o
       JOIN users u ON u.id = o.beneficiary_user_id
       LEFT JOIN student_profiles sp ON sp.user_id = o.beneficiary_user_id
       WHERE o.id = ?`,
      orderId
    );

    if (!order) {
      res.status(404).json({ error: 'Order not found.' });
      return;
    }

    if (order.payment_status !== 'paid') {
      res.status(400).json({
        error: 'QR verification code is only available after payment is confirmed.',
      });
      return;
    }

    if (order.order_status === 'cancelled') {
      res.status(400).json({ error: 'Cancelled orders do not have an active QR pass.' });
      return;
    }

    const tokenInfo = issueOrderQrToken(db, order.id);
    const qrDataUrl = await generateQrDataUrl(tokenInfo.signedToken);

    const collection = db.get<{ collected_at: string }>(
      'SELECT collected_at FROM collection_records WHERE order_id = ?',
      order.id
    );

    res.json({
      orderId: order.id,
      orderNumber: order.order_number,
      beneficiaryName: order.beneficiary_name,
      className: order.class_name || 'Staff',
      orderDate: order.order_date,
      collectionSlot: order.collection_slot,
      orderStatus: order.order_status,
      signedToken: tokenInfo.signedToken,
      qrDataUrl,
      isCollected: Boolean(collection),
      collectedAt: collection?.collected_at || null,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to generate QR code.' });
  }
});

// Cancel Order (Parent/Teacher before preparation starts, or Admin anytime prior to collection)
ordersRouter.post('/:id/cancel', authenticate, requireRole(['parent', 'teacher', 'admin']), (req, res) => {
  try {
    const orderId = Number(req.params.id);
    const user = req.user!;
    const { reason } = req.body || {};

    if (!userCanAccessOrder(user.id, user.role, orderId)) {
      res.status(403).json({ error: 'You do not have permission to cancel this order.' });
      return;
    }

    const db = getDb();
    let updatedOrder: ReturnType<typeof formatOrderRecord> = null;

    db.transaction(() => {
      const order = db.get<{
        id: number;
        order_number: string;
        placed_by_user_id: number;
        beneficiary_user_id: number;
        order_status: string;
        payment_status: string;
      }>('SELECT * FROM orders WHERE id = ?', orderId);

      if (!order) {
        throw new Error('Order not found.');
      }

      if (order.order_status === 'collected') {
        throw new Error('Collected orders cannot be cancelled.');
      }
      if (order.order_status === 'cancelled') {
        throw new Error('This order has already been cancelled.');
      }

      if (user.role !== 'admin') {
        if (order.placed_by_user_id !== user.id) {
          throw new Error('Only the account that placed this order or an administrator can cancel it.');
        }
        if (!['awaiting_payment', 'confirmed'].includes(order.order_status)) {
          throw new Error(
            'This order is already being prepared by the kitchen and can no longer be self-cancelled. Please contact school administration.'
          );
        }
      }

      const cancelNote = reason
        ? String(reason).trim()
        : `Cancelled by ${user.role} (${user.fullName})`;

      const nextPaymentStatus = order.payment_status === 'paid' ? 'refunded' : order.payment_status;

      db.run(
        `UPDATE orders
         SET order_status = 'cancelled',
             payment_status = ?,
             cancelled_at = datetime('now'),
             cancelled_by_user_id = ?,
             cancellation_reason = ?,
             updated_at = datetime('now')
         WHERE id = ?`,
        nextPaymentStatus,
        user.id,
        cancelNote,
        orderId
      );

      // Revoke QR verification token if one existed
      db.run(
        `UPDATE qr_verification_tokens SET revoked_at = datetime('now') WHERE order_id = ?`,
        orderId
      );

      // Process automatic refund record if order was paid
      if (order.payment_status === 'paid') {
        db.run(
          `UPDATE payment_transactions
           SET status = 'refunded',
               refund_reason = ?,
               refunded_at = datetime('now'),
               refunded_by_user_id = ?,
               updated_at = datetime('now')
           WHERE order_id = ? AND status = 'succeeded'`,
          cancelNote,
          user.id,
          orderId
        );
      }

      recordOrderStatusChange(db, {
        orderId,
        previousStatus: order.order_status,
        newStatus: 'cancelled',
        changedByUserId: user.id,
        note: cancelNote,
      });

      if (user.role === 'admin') {
        logAdminActivity(db, {
          actorUserId: user.id,
          action: 'CANCEL_ORDER',
          targetType: 'order',
          targetId: orderId,
          details: { orderNumber: order.order_number, refunded: order.payment_status === 'paid', reason: cancelNote },
          ipAddress: req.ip,
        });
      }

      updatedOrder = formatOrderRecord(orderId, user.role);

      eventHub.broadcast(
        'order.updated',
        { orderId, orderStatus: 'cancelled', paymentStatus: nextPaymentStatus },
        {
          roles: ['admin', 'chef'],
          userIds: [order.placed_by_user_id, order.beneficiary_user_id],
        }
      );
    });

    res.json({ message: 'Order cancelled successfully.', order: updatedOrder });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to cancel order.' });
  }
});

// Admin: Update Order Status
ordersRouter.patch('/:id/status', authenticate, requireRole(['admin']), (req, res) => {
  try {
    const orderId = Number(req.params.id);
    const { orderStatus, note } = req.body || {};
    const validStatuses = [
      'awaiting_payment',
      'confirmed',
      'preparing',
      'ready_for_collection',
      'collected',
      'cancelled',
    ];
    if (!validStatuses.includes(orderStatus)) {
      res.status(400).json({ error: 'Invalid order status.' });
      return;
    }

    const db = getDb();
    const existing = db.get<{
      id: number;
      order_number: string;
      order_status: string;
      payment_status: string;
      placed_by_user_id: number;
      beneficiary_user_id: number;
    }>('SELECT * FROM orders WHERE id = ?', orderId);

    if (!existing) {
      res.status(404).json({ error: 'Order not found.' });
      return;
    }

    if (
      ['confirmed', 'preparing', 'ready_for_collection', 'collected'].includes(orderStatus) &&
      existing.payment_status !== 'paid'
    ) {
      res.status(400).json({
        error: 'Cannot advance preparation or collection status on an unpaid order.',
      });
      return;
    }

    db.transaction(() => {
      db.run(
        `UPDATE orders SET order_status = ?, updated_at = datetime('now') WHERE id = ?`,
        orderStatus,
        orderId
      );

      if (orderStatus === 'collected') {
        db.run(
          `INSERT OR IGNORE INTO collection_records (order_id, verified_by_chef_id, verification_method, notes)
           VALUES (?, ?, 'manual_order_lookup', ?)`,
          orderId,
          req.user!.id,
          note || 'Marked collected by Administrator'
        );
        db.run(
          `UPDATE qr_verification_tokens SET is_used = 1, used_at = datetime('now') WHERE order_id = ?`,
          orderId
        );
      }

      recordOrderStatusChange(db, {
        orderId,
        previousStatus: existing.order_status,
        newStatus: orderStatus,
        changedByUserId: req.user!.id,
        note: note || `Updated by Administrator (${req.user!.fullName})`,
      });

      logAdminActivity(db, {
        actorUserId: req.user!.id,
        action: 'UPDATE_ORDER_STATUS',
        targetType: 'order',
        targetId: orderId,
        details: {
          orderNumber: existing.order_number,
          from: existing.order_status,
          to: orderStatus,
        },
        ipAddress: req.ip,
      });
    });

    eventHub.broadcast(
      'order.updated',
      { orderId, orderStatus },
      {
        roles: ['admin', 'chef'],
        userIds: [existing.placed_by_user_id, existing.beneficiary_user_id],
      }
    );

    res.json({ order: formatOrderRecord(orderId, 'admin') });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to update order status.' });
  }
});
