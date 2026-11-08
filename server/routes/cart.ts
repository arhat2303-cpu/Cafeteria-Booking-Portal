import { Router } from 'express';
import { getDb } from '../db/connection.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { filsToAed, formatAed } from '../services/money.js';

export const cartRouter = Router();

function ensureUserCart(userId: number, role: string): number {
  const db = getDb();
  const existing = db.get<{ id: number; beneficiary_user_id: number | null }>(
    'SELECT id, beneficiary_user_id FROM shopping_carts WHERE user_id = ?',
    userId
  );
  if (existing) {
    if (role === 'teacher' && existing.beneficiary_user_id !== userId) {
      db.run('UPDATE shopping_carts SET beneficiary_user_id = ? WHERE id = ?', userId, existing.id);
    }
    return existing.id;
  }

  let defaultBeneficiary: number | null = null;
  if (role === 'teacher') {
    defaultBeneficiary = userId;
  } else if (role === 'parent') {
    const firstChild = db.get<{ student_user_id: number }>(
      `SELECT psl.student_user_id
       FROM parent_student_links psl
       JOIN users u ON u.id = psl.student_user_id
       WHERE psl.parent_user_id = ? AND u.is_active = 1
       ORDER BY psl.id ASC LIMIT 1`,
      userId
    );
    defaultBeneficiary = firstChild?.student_user_id ?? null;
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  const ins = db.run(
    `INSERT INTO shopping_carts (user_id, beneficiary_user_id, order_date, collection_slot)
     VALUES (?, ?, ?, ?)`,
    userId,
    defaultBeneficiary,
    todayStr,
    'Morning Recess (09:45 AM – 10:15 AM)'
  );
  return ins.lastInsertRowid;
}

export function buildCartPayload(userId: number, role: string) {
  const db = getDb();
  const cartId = ensureUserCart(userId, role);

  const cart = db.get<{
    id: number;
    beneficiary_user_id: number | null;
    order_date: string | null;
    collection_slot: string | null;
    special_instructions: string | null;
    updated_at: string;
  }>('SELECT * FROM shopping_carts WHERE id = ?', cartId)!;

  const items = db.all<{
    cart_item_id: number;
    menu_item_id: number;
    quantity: number;
    item_notes: string | null;
    name: string;
    price_fils: number;
    image_url: string | null;
    is_available: number;
    category_name: string;
  }>(
    `SELECT sci.id as cart_item_id, sci.menu_item_id, sci.quantity, sci.item_notes,
            mi.name, mi.price_fils, mi.image_url, mi.is_available,
            fc.name as category_name
     FROM shopping_cart_items sci
     JOIN menu_items mi ON mi.id = sci.menu_item_id
     JOIN food_categories fc ON fc.id = mi.category_id
     WHERE sci.cart_id = ?
     ORDER BY sci.id ASC`,
    cartId
  );

  let subtotalFils = 0;
  const formattedItems = items.map((it) => {
    const lineTotalFils = it.price_fils * it.quantity;
    subtotalFils += lineTotalFils;
    return {
      cartItemId: it.cart_item_id,
      menuItemId: it.menu_item_id,
      name: it.name,
      categoryName: it.category_name,
      quantity: it.quantity,
      unitPriceFils: it.price_fils,
      unitPriceAed: filsToAed(it.price_fils),
      lineTotalFils,
      lineTotalAed: filsToAed(lineTotalFils),
      formattedLineTotal: formatAed(lineTotalFils),
      imageUrl: it.image_url,
      isAvailable: Boolean(it.is_available),
      itemNotes: it.item_notes,
    };
  });

  return {
    cartId: cart.id,
    beneficiaryUserId: cart.beneficiary_user_id,
    orderDate: cart.order_date,
    collectionSlot: cart.collection_slot,
    specialInstructions: cart.special_instructions || '',
    items: formattedItems,
    itemCount: formattedItems.reduce((sum, i) => sum + i.quantity, 0),
    subtotalFils,
    subtotalAed: filsToAed(subtotalFils),
    totalFils: subtotalFils,
    totalAed: filsToAed(subtotalFils),
    formattedTotal: formatAed(subtotalFils),
    updatedAt: cart.updated_at,
  };
}

cartRouter.use(authenticate, requireRole(['parent', 'teacher']));

cartRouter.get('/', (req, res) => {
  res.json({ cart: buildCartPayload(req.user!.id, req.user!.role) });
});

cartRouter.put('/meta', (req, res) => {
  try {
    const db = getDb();
    const userId = req.user!.id;
    const role = req.user!.role;
    const cartId = ensureUserCart(userId, role);

    const { beneficiaryUserId, orderDate, collectionSlot, specialInstructions } = req.body || {};

    let targetBeneficiary: number | null | undefined = undefined;
    if (role === 'teacher') {
      targetBeneficiary = userId;
    } else if (beneficiaryUserId !== undefined && beneficiaryUserId !== null) {
      const link = db.get<{ id: number }>(
        `SELECT psl.id
         FROM parent_student_links psl
         JOIN users u ON u.id = psl.student_user_id
         WHERE psl.parent_user_id = ? AND psl.student_user_id = ? AND u.is_active = 1`,
        userId,
        Number(beneficiaryUserId)
      );
      if (!link) {
        res.status(403).json({ error: 'Selected student is not linked to your parent account.' });
        return;
      }
      targetBeneficiary = Number(beneficiaryUserId);
    }

    const current = db.get<{
      beneficiary_user_id: number | null;
      order_date: string | null;
      collection_slot: string | null;
      special_instructions: string | null;
    }>('SELECT * FROM shopping_carts WHERE id = ?', cartId)!;

    db.run(
      `UPDATE shopping_carts
       SET beneficiary_user_id = ?,
           order_date = ?,
           collection_slot = ?,
           special_instructions = ?,
           updated_at = datetime('now')
       WHERE id = ?`,
      targetBeneficiary !== undefined ? targetBeneficiary : current.beneficiary_user_id,
      orderDate !== undefined ? String(orderDate).trim() : current.order_date,
      collectionSlot !== undefined ? String(collectionSlot).trim() : current.collection_slot,
      specialInstructions !== undefined
        ? String(specialInstructions).slice(0, 500)
        : current.special_instructions,
      cartId
    );

    res.json({ cart: buildCartPayload(userId, role) });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to update cart preferences.' });
  }
});

cartRouter.post('/items', (req, res) => {
  try {
    const db = getDb();
    const userId = req.user!.id;
    const role = req.user!.role;
    const cartId = ensureUserCart(userId, role);

    const { menuItemId, quantity = 1, itemNotes } = req.body || {};
    const qty = Number(quantity);
    if (!menuItemId || !Number.isInteger(qty) || qty < 1 || qty > 50) {
      res.status(400).json({ error: 'Valid menuItemId and quantity (1–50) are required.' });
      return;
    }

    const item = db.get<{ id: number; is_available: number; category_active: number }>(
      `SELECT mi.id, mi.is_available, fc.is_active as category_active
       FROM menu_items mi
       JOIN food_categories fc ON fc.id = mi.category_id
       WHERE mi.id = ?`,
      Number(menuItemId)
    );

    if (!item || !item.category_active) {
      res.status(404).json({ error: 'Menu item not found or unavailable.' });
      return;
    }

    const existing = db.get<{ id: number; quantity: number }>(
      'SELECT id, quantity FROM shopping_cart_items WHERE cart_id = ? AND menu_item_id = ?',
      cartId,
      Number(menuItemId)
    );

    if (existing) {
      const nextQty = Math.min(50, existing.quantity + qty);
      db.run(
        `UPDATE shopping_cart_items SET quantity = ?, item_notes = COALESCE(?, item_notes) WHERE id = ?`,
        nextQty,
        itemNotes !== undefined ? String(itemNotes).slice(0, 200) : null,
        existing.id
      );
    } else {
      db.run(
        `INSERT INTO shopping_cart_items (cart_id, menu_item_id, quantity, item_notes)
         VALUES (?, ?, ?, ?)`,
        cartId,
        Number(menuItemId),
        qty,
        itemNotes ? String(itemNotes).slice(0, 200) : null
      );
    }

    db.run(`UPDATE shopping_carts SET updated_at = datetime('now') WHERE id = ?`, cartId);
    res.json({ cart: buildCartPayload(userId, role) });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to add item to cart.' });
  }
});

cartRouter.patch('/items/:menuItemId', (req, res) => {
  try {
    const db = getDb();
    const userId = req.user!.id;
    const role = req.user!.role;
    const cartId = ensureUserCart(userId, role);
    const menuItemId = Number(req.params.menuItemId);
    const { quantity, itemNotes } = req.body || {};

    if (quantity !== undefined) {
      const qty = Number(quantity);
      if (qty <= 0) {
        db.run(
          'DELETE FROM shopping_cart_items WHERE cart_id = ? AND menu_item_id = ?',
          cartId,
          menuItemId
        );
      } else {
        db.run(
          `UPDATE shopping_cart_items
           SET quantity = ?, item_notes = COALESCE(?, item_notes)
           WHERE cart_id = ? AND menu_item_id = ?`,
          Math.min(50, qty),
          itemNotes !== undefined ? String(itemNotes).slice(0, 200) : null,
          cartId,
          menuItemId
        );
      }
    } else if (itemNotes !== undefined) {
      db.run(
        'UPDATE shopping_cart_items SET item_notes = ? WHERE cart_id = ? AND menu_item_id = ?',
        String(itemNotes).slice(0, 200),
        cartId,
        menuItemId
      );
    }

    db.run(`UPDATE shopping_carts SET updated_at = datetime('now') WHERE id = ?`, cartId);
    res.json({ cart: buildCartPayload(userId, role) });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to update cart item.' });
  }
});

cartRouter.delete('/', (req, res) => {
  const db = getDb();
  const cartId = ensureUserCart(req.user!.id, req.user!.role);
  db.run('DELETE FROM shopping_cart_items WHERE cart_id = ?', cartId);
  res.json({ cart: buildCartPayload(req.user!.id, req.user!.role) });
});
