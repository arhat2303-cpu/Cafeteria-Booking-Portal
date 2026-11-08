import { Router } from 'express';
import busboy from 'busboy';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../db/connection.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { aedToFils, filsToAed, formatAed } from '../services/money.js';
import { logAdminActivity } from '../services/audit.js';
import { eventHub } from '../services/events.js';
import { config } from '../config.js';

export const menuRouter = Router();

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || `cat-${Date.now()}`;
}

export function evaluateItemAvailabilityForDate(
  baseAvailable: boolean,
  categoryActive: boolean,
  schedules: Array<{
    day_of_week: number | null;
    specific_date: string | null;
    is_available: number;
    special_note: string | null;
  }>,
  dateStr?: string
): { availableOnDate: boolean; scheduleNote: string | null } {
  if (!categoryActive) {
    return { availableOnDate: false, scheduleNote: 'Category currently inactive' };
  }

  if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    // 1. Specific date override takes highest priority (allows enabling specials OR disabling on holidays/specific dates)
    const dateOverride = schedules.find((s) => s.specific_date === dateStr);
    if (dateOverride) {
      return {
        availableOnDate: Boolean(dateOverride.is_available),
        scheduleNote: dateOverride.special_note || null,
      };
    }

    // 2. If base item is marked unavailable globally, keep unavailable unless overridden for a specific date above
    if (!baseAvailable) {
      return { availableOnDate: false, scheduleNote: 'Currently unavailable' };
    }

    // 3. Day-of-week schedule rules (if any weekday rules exist for this item)
    const weekdayRules = schedules.filter((s) => s.day_of_week !== null && !s.specific_date);
    if (weekdayRules.length > 0) {
      const [y, m, d] = dateStr.split('-').map(Number);
      const dayOfWeek = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun .. 6=Sat
      const ruleForDay = weekdayRules.find((r) => r.day_of_week === dayOfWeek);
      if (ruleForDay) {
        return {
          availableOnDate: Boolean(ruleForDay.is_available),
          scheduleNote: ruleForDay.special_note || null,
        };
      }
      // If positive weekday allowlist exists, item is only served on those scheduled weekdays
      const hasPositiveDays = weekdayRules.some((r) => r.is_available === 1);
      if (hasPositiveDays) {
        return {
          availableOnDate: false,
          scheduleNote: 'Scheduled for specific school days only',
        };
      }
    }
  }

  return {
    availableOnDate: baseAvailable,
    scheduleNote: baseAvailable ? null : 'Currently unavailable',
  };
}

menuRouter.get('/', authenticate, (req, res) => {
  const db = getDb();
  const dateStr = typeof req.query.date === 'string' ? req.query.date.trim() : undefined;
  const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';
  const isAdmin = req.user?.role === 'admin';

  const categories = db.all<{
    id: number;
    name: string;
    slug: string;
    description: string | null;
    icon: string | null;
    display_order: number;
    is_active: number;
  }>(
    isAdmin
      ? 'SELECT * FROM food_categories ORDER BY display_order ASC, name ASC'
      : 'SELECT * FROM food_categories WHERE is_active = 1 ORDER BY display_order ASC, name ASC'
  );

  const rawItems = db.all<{
    id: number;
    category_id: number;
    category_name: string;
    category_active: number;
    name: string;
    description: string | null;
    price_fils: number;
    image_url: string | null;
    is_available: number;
    is_vegetarian: number;
    calories: number | null;
    allergens: string | null;
    preparation_time_mins: number | null;
    daily_stock_limit: number | null;
    display_order: number;
    updated_at: string;
  }>(
    `SELECT mi.*, fc.name as category_name, fc.is_active as category_active
     FROM menu_items mi
     JOIN food_categories fc ON fc.id = mi.category_id
     ORDER BY fc.display_order ASC, mi.display_order ASC, mi.name ASC`
  );

  const allSchedules = db.all<{
    id: number;
    menu_item_id: number;
    day_of_week: number | null;
    specific_date: string | null;
    is_available: number;
    special_note: string | null;
  }>('SELECT * FROM menu_availability_schedules ORDER BY specific_date ASC, day_of_week ASC');

  const schedByItem = new Map<number, typeof allSchedules>();
  for (const s of allSchedules) {
    const arr = schedByItem.get(s.menu_item_id) || [];
    arr.push(s);
    schedByItem.set(s.menu_item_id, arr);
  }

  const items = rawItems
    .filter((item) => (isAdmin ? true : Boolean(item.category_active)))
    .filter((item) => {
      if (!search) return true;
      return (
        item.name.toLowerCase().includes(search) ||
        (item.description || '').toLowerCase().includes(search) ||
        item.category_name.toLowerCase().includes(search)
      );
    })
    .map((item) => {
      const itemSchedules = schedByItem.get(item.id) || [];
      const evalRes = evaluateItemAvailabilityForDate(
        Boolean(item.is_available),
        Boolean(item.category_active),
        itemSchedules,
        dateStr
      );

      return {
        id: item.id,
        categoryId: item.category_id,
        categoryName: item.category_name,
        name: item.name,
        description: item.description,
        priceFils: item.price_fils,
        priceAed: filsToAed(item.price_fils),
        formattedPrice: formatAed(item.price_fils),
        imageUrl: item.image_url,
        isAvailable: Boolean(item.is_available),
        availableOnDate: evalRes.availableOnDate,
        scheduleNote: evalRes.scheduleNote,
        isVegetarian: Boolean(item.is_vegetarian),
        calories: item.calories,
        allergens: item.allergens,
        preparationTimeMins: item.preparation_time_mins,
        dailyStockLimit: item.daily_stock_limit,
        displayOrder: item.display_order,
        schedules: itemSchedules.map((s) => ({
          id: s.id,
          dayOfWeek: s.day_of_week,
          specificDate: s.specific_date,
          isAvailable: Boolean(s.is_available),
          specialNote: s.special_note,
        })),
        updatedAt: item.updated_at,
      };
    });

  res.json({
    categories: categories.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      description: c.description,
      icon: c.icon,
      displayOrder: c.display_order,
      isActive: Boolean(c.is_active),
    })),
    items,
    selectedDate: dateStr || null,
  });
});

// Admin: Create Food Category
menuRouter.post('/categories', authenticate, requireRole(['admin']), (req, res) => {
  try {
    const { name, description, icon, displayOrder, isActive } = req.body || {};
    if (!name || !String(name).trim()) {
      res.status(400).json({ error: 'Category name is required.' });
      return;
    }

    const db = getDb();
    const cleanName = String(name).trim();
    const baseSlug = slugify(cleanName);
    const existingSlug = db.get<{ id: number }>(
      'SELECT id FROM food_categories WHERE slug = ?',
      baseSlug
    );
    const finalSlug = existingSlug ? `${baseSlug}-${Date.now().toString(36)}` : baseSlug;

    const result = db.run(
      `INSERT INTO food_categories (name, slug, description, icon, display_order, is_active)
       VALUES (?, ?, ?, ?, ?, ?)`,
      cleanName,
      finalSlug,
      description ? String(description).trim() : null,
      icon ? String(icon).trim() : 'utensils',
      Number(displayOrder || 0),
      isActive === undefined ? 1 : Boolean(isActive)
    );

    logAdminActivity(db, {
      actorUserId: req.user!.id,
      action: 'CREATE_CATEGORY',
      targetType: 'food_category',
      targetId: result.lastInsertRowid,
      details: { name: cleanName },
      ipAddress: req.ip,
    });

    eventHub.broadcast('menu.updated', { action: 'category_created' });
    res.status(201).json({ id: result.lastInsertRowid, name: cleanName, slug: finalSlug });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to create category.' });
  }
});

menuRouter.put('/categories/:id', authenticate, requireRole(['admin']), (req, res) => {
  try {
    const id = Number(req.params.id);
    const { name, description, icon, displayOrder, isActive } = req.body || {};
    const db = getDb();

    const existing = db.get<{ id: number; name: string }>(
      'SELECT id, name FROM food_categories WHERE id = ?',
      id
    );
    if (!existing) {
      res.status(404).json({ error: 'Category not found.' });
      return;
    }

    db.run(
      `UPDATE food_categories
       SET name = COALESCE(?, name),
           description = ?,
           icon = COALESCE(?, icon),
           display_order = COALESCE(?, display_order),
           is_active = COALESCE(?, is_active),
           updated_at = datetime('now')
       WHERE id = ?`,
      name ? String(name).trim() : null,
      description !== undefined ? (description ? String(description).trim() : null) : null,
      icon ? String(icon).trim() : null,
      displayOrder !== undefined ? Number(displayOrder) : null,
      isActive !== undefined ? Boolean(isActive) : null,
      id
    );

    logAdminActivity(db, {
      actorUserId: req.user!.id,
      action: 'UPDATE_CATEGORY',
      targetType: 'food_category',
      targetId: id,
      details: { name: name || existing.name },
      ipAddress: req.ip,
    });

    eventHub.broadcast('menu.updated', { action: 'category_updated', categoryId: id });
    res.json({ message: 'Category updated.' });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to update category.' });
  }
});

menuRouter.delete('/categories/:id', authenticate, requireRole(['admin']), (req, res) => {
  try {
    const id = Number(req.params.id);
    const db = getDb();
    const count = db.get<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM menu_items WHERE category_id = ?',
      id
    );
    if (count && count.cnt > 0) {
      res.status(400).json({
        error: 'Cannot delete a category that still contains food items. Move or remove its items first.',
      });
      return;
    }

    const del = db.run('DELETE FROM food_categories WHERE id = ?', id);
    if (del.changes === 0) {
      res.status(404).json({ error: 'Category not found.' });
      return;
    }

    logAdminActivity(db, {
      actorUserId: req.user!.id,
      action: 'DELETE_CATEGORY',
      targetType: 'food_category',
      targetId: id,
      ipAddress: req.ip,
    });

    eventHub.broadcast('menu.updated', { action: 'category_deleted', categoryId: id });
    res.json({ message: 'Category deleted.' });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to delete category.' });
  }
});

// Secure Food Image Upload with MIME + Magic Byte Inspection
function validateImageMagicBytes(buf: Buffer): 'jpg' | 'png' | 'webp' | null {
  if (buf.length < 12) return null;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'jpg';
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return 'png';
  }
  // WEBP: RIFF....WEBP
  if (
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

menuRouter.post('/upload-image', authenticate, requireRole(['admin']), (req, res) => {
  const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
  const allowedMimes = new Set(['image/jpeg', 'image/png', 'image/webp']);

  let fileHandled = false;
  let responded = false;

  const bb = busboy({
    headers: req.headers,
    limits: { files: 1, fileSize: MAX_BYTES },
  });

  bb.on('file', (_fieldname, fileStream, info) => {
    fileHandled = true;
    if (!allowedMimes.has(info.mimeType)) {
      fileStream.resume();
      if (!responded) {
        responded = true;
        res.status(400).json({ error: 'Only JPEG, PNG, and WEBP food images are permitted.' });
      }
      return;
    }

    const chunks: Buffer[] = [];
    let limitExceeded = false;

    fileStream.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    fileStream.on('limit', () => {
      limitExceeded = true;
    });

    fileStream.on('end', () => {
      if (responded) return;
      if (limitExceeded) {
        responded = true;
        res.status(413).json({ error: 'Food image exceeds the 5 MB maximum upload size.' });
        return;
      }

      const buffer = Buffer.concat(chunks);
      const ext = validateImageMagicBytes(buffer);
      if (!ext) {
        responded = true;
        res.status(400).json({ error: 'Uploaded file failed binary image signature validation.' });
        return;
      }

      const filename = `food-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
      const mimeMap: Record<'jpg' | 'png' | 'webp', string> = {
        jpg: 'image/jpeg',
        png: 'image/png',
        webp: 'image/webp',
      };

      // Persist inside SQLite so uploaded images survive Netlify serverless deployments & cold starts
      const db = getDb();
      db.run(
        `INSERT OR REPLACE INTO uploaded_files (filename, mime_type, data) VALUES (?, ?, ?)`,
        filename,
        mimeMap[ext],
        new Uint8Array(buffer)
      );

      // Also save on local disk when running in a standard stateful server environment
      if (!config.isServerless) {
        try {
          const uploadDir = path.resolve(process.cwd(), 'server/uploads/menu');
          fs.mkdirSync(uploadDir, { recursive: true });
          fs.writeFileSync(path.join(uploadDir, filename), buffer);
        } catch {
          // Database copy remains primary source of truth
        }
      }

      responded = true;
      res.status(201).json({ imageUrl: `/uploads/menu/${filename}` });
    });
  });

  bb.on('finish', () => {
    if (!fileHandled && !responded) {
      responded = true;
      res.status(400).json({ error: 'No image file provided in upload.' });
    }
  });

  bb.on('error', (err: any) => {
    if (!responded) {
      responded = true;
      res.status(400).json({ error: err.message || 'Image upload failed.' });
    }
  });

  const rawBody = (req as any).rawBody ?? (Buffer.isBuffer(req.body) ? req.body : null);
  if (rawBody && Buffer.isBuffer(rawBody)) {
    bb.end(rawBody);
  } else {
    req.pipe(bb);
  }
});

// Admin: Add Food Item
menuRouter.post('/items', authenticate, requireRole(['admin']), (req, res) => {
  try {
    const {
      categoryId,
      name,
      description,
      priceAed,
      imageUrl,
      isAvailable,
      isVegetarian,
      calories,
      allergens,
      preparationTimeMins,
      dailyStockLimit,
      displayOrder,
    } = req.body || {};

    if (!categoryId || !name || priceAed === undefined || priceAed === null || priceAed === '') {
      res.status(400).json({ error: 'Category, exact food name, and AED price are required.' });
      return;
    }

    const priceFils = aedToFils(priceAed);
    const db = getDb();

    const cat = db.get<{ id: number }>('SELECT id FROM food_categories WHERE id = ?', Number(categoryId));
    if (!cat) {
      res.status(404).json({ error: 'Selected food category does not exist.' });
      return;
    }

    const result = db.run(
      `INSERT INTO menu_items (
        category_id, name, description, price_fils, image_url,
        is_available, is_vegetarian, calories, allergens,
        preparation_time_mins, daily_stock_limit, display_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      Number(categoryId),
      String(name).trim(),
      description ? String(description).trim() : null,
      priceFils,
      imageUrl ? String(imageUrl).trim() : null,
      isAvailable === undefined ? 1 : Boolean(isAvailable),
      Boolean(isVegetarian),
      calories !== undefined && calories !== '' && calories !== null ? Number(calories) : null,
      allergens ? String(allergens).trim() : null,
      preparationTimeMins ? Number(preparationTimeMins) : 10,
      dailyStockLimit ? Number(dailyStockLimit) : null,
      Number(displayOrder || 0)
    );

    logAdminActivity(db, {
      actorUserId: req.user!.id,
      action: 'CREATE_MENU_ITEM',
      targetType: 'menu_item',
      targetId: result.lastInsertRowid,
      details: { name: String(name).trim(), priceFils },
      ipAddress: req.ip,
    });

    eventHub.broadcast('menu.updated', { action: 'item_created', itemId: result.lastInsertRowid });
    res.status(201).json({
      id: result.lastInsertRowid,
      name: String(name).trim(),
      priceFils,
      priceAed: filsToAed(priceFils),
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to add menu item.' });
  }
});

// Admin: Edit Food Item
menuRouter.put('/items/:id', authenticate, requireRole(['admin']), (req, res) => {
  try {
    const id = Number(req.params.id);
    const db = getDb();
    const existing = db.get<{ id: number; name: string; price_fils: number }>(
      'SELECT id, name, price_fils FROM menu_items WHERE id = ?',
      id
    );
    if (!existing) {
      res.status(404).json({ error: 'Menu item not found.' });
      return;
    }

    const {
      categoryId,
      name,
      description,
      priceAed,
      imageUrl,
      isAvailable,
      isVegetarian,
      calories,
      allergens,
      preparationTimeMins,
      dailyStockLimit,
      displayOrder,
    } = req.body || {};

    const newPriceFils =
      priceAed !== undefined && priceAed !== null && priceAed !== ''
        ? aedToFils(priceAed)
        : existing.price_fils;

    db.run(
      `UPDATE menu_items
       SET category_id = COALESCE(?, category_id),
           name = COALESCE(?, name),
           description = ?,
           price_fils = ?,
           image_url = ?,
           is_available = COALESCE(?, is_available),
           is_vegetarian = COALESCE(?, is_vegetarian),
           calories = ?,
           allergens = ?,
           preparation_time_mins = COALESCE(?, preparation_time_mins),
           daily_stock_limit = ?,
           display_order = COALESCE(?, display_order),
           updated_at = datetime('now')
       WHERE id = ?`,
      categoryId ? Number(categoryId) : null,
      name ? String(name).trim() : null,
      description !== undefined ? (description ? String(description).trim() : null) : null,
      newPriceFils,
      imageUrl !== undefined ? (imageUrl ? String(imageUrl).trim() : null) : null,
      isAvailable !== undefined ? Boolean(isAvailable) : null,
      isVegetarian !== undefined ? Boolean(isVegetarian) : null,
      calories !== undefined && calories !== '' && calories !== null ? Number(calories) : null,
      allergens !== undefined ? (allergens ? String(allergens).trim() : null) : null,
      preparationTimeMins !== undefined && preparationTimeMins !== null
        ? Number(preparationTimeMins)
        : null,
      dailyStockLimit !== undefined && dailyStockLimit !== '' && dailyStockLimit !== null
        ? Number(dailyStockLimit)
        : null,
      displayOrder !== undefined ? Number(displayOrder) : null,
      id
    );

    logAdminActivity(db, {
      actorUserId: req.user!.id,
      action: 'UPDATE_MENU_ITEM',
      targetType: 'menu_item',
      targetId: id,
      details: { name: name || existing.name, priceFils: newPriceFils },
      ipAddress: req.ip,
    });

    eventHub.broadcast('menu.updated', { action: 'item_updated', itemId: id });
    res.json({ message: 'Menu item updated.', id, priceAed: filsToAed(newPriceFils) });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to update menu item.' });
  }
});

menuRouter.patch('/items/:id/availability', authenticate, requireRole(['admin']), (req, res) => {
  try {
    const id = Number(req.params.id);
    const { isAvailable } = req.body || {};
    const db = getDb();
    const upd = db.run(
      `UPDATE menu_items SET is_available = ?, updated_at = datetime('now') WHERE id = ?`,
      Boolean(isAvailable),
      id
    );
    if (upd.changes === 0) {
      res.status(404).json({ error: 'Menu item not found.' });
      return;
    }

    logAdminActivity(db, {
      actorUserId: req.user!.id,
      action: 'TOGGLE_MENU_AVAILABILITY',
      targetType: 'menu_item',
      targetId: id,
      details: { isAvailable: Boolean(isAvailable) },
      ipAddress: req.ip,
    });

    eventHub.broadcast('menu.updated', { action: 'availability_toggled', itemId: id });
    res.json({ id, isAvailable: Boolean(isAvailable) });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to update availability.' });
  }
});

menuRouter.delete('/items/:id', authenticate, requireRole(['admin']), (req, res) => {
  try {
    const id = Number(req.params.id);
    const db = getDb();
    const existing = db.get<{ name: string }>('SELECT name FROM menu_items WHERE id = ?', id);
    if (!existing) {
      res.status(404).json({ error: 'Menu item not found.' });
      return;
    }

    db.run('DELETE FROM menu_items WHERE id = ?', id);
    logAdminActivity(db, {
      actorUserId: req.user!.id,
      action: 'DELETE_MENU_ITEM',
      targetType: 'menu_item',
      targetId: id,
      details: { name: existing.name },
      ipAddress: req.ip,
    });

    eventHub.broadcast('menu.updated', { action: 'item_deleted', itemId: id });
    res.json({ message: 'Menu item deleted.' });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to delete menu item.' });
  }
});

// Admin: Schedule Menu Availability (Weekday or Specific Date Override)
menuRouter.post('/items/:id/schedules', authenticate, requireRole(['admin']), (req, res) => {
  try {
    const itemId = Number(req.params.id);
    const { dayOfWeek, specificDate, isAvailable, specialNote } = req.body || {};

    if (
      (dayOfWeek === undefined || dayOfWeek === null || dayOfWeek === '') &&
      (!specificDate || !/^\d{4}-\d{2}-\d{2}$/.test(String(specificDate)))
    ) {
      res.status(400).json({
        error: 'Provide either a dayOfWeek (0-6) or a specificDate (YYYY-MM-DD) for menu scheduling.',
      });
      return;
    }

    const db = getDb();
    const item = db.get<{ id: number; name: string }>('SELECT id, name FROM menu_items WHERE id = ?', itemId);
    if (!item) {
      res.status(404).json({ error: 'Menu item not found.' });
      return;
    }

    const cleanDate = specificDate ? String(specificDate).trim() : null;
    const cleanDow =
      !cleanDate && dayOfWeek !== undefined && dayOfWeek !== null && dayOfWeek !== ''
        ? Number(dayOfWeek)
        : null;

    if (cleanDate) {
      db.run(
        'DELETE FROM menu_availability_schedules WHERE menu_item_id = ? AND specific_date = ?',
        itemId,
        cleanDate
      );
    } else if (cleanDow !== null) {
      db.run(
        'DELETE FROM menu_availability_schedules WHERE menu_item_id = ? AND day_of_week = ? AND specific_date IS NULL',
        itemId,
        cleanDow
      );
    }

    const ins = db.run(
      `INSERT INTO menu_availability_schedules (menu_item_id, day_of_week, specific_date, is_available, special_note)
       VALUES (?, ?, ?, ?, ?)`,
      itemId,
      cleanDow,
      cleanDate,
      isAvailable === undefined ? 1 : Boolean(isAvailable),
      specialNote ? String(specialNote).trim() : null
    );

    logAdminActivity(db, {
      actorUserId: req.user!.id,
      action: 'SCHEDULE_MENU_ITEM',
      targetType: 'menu_item',
      targetId: itemId,
      details: { dayOfWeek: cleanDow, specificDate: cleanDate, isAvailable: Boolean(isAvailable) },
      ipAddress: req.ip,
    });

    eventHub.broadcast('menu.updated', { action: 'schedule_updated', itemId });
    res.status(201).json({ id: ins.lastInsertRowid });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to schedule menu item.' });
  }
});

menuRouter.delete('/schedules/:scheduleId', authenticate, requireRole(['admin']), (req, res) => {
  const scheduleId = Number(req.params.scheduleId);
  const db = getDb();
  db.run('DELETE FROM menu_availability_schedules WHERE id = ?', scheduleId);
  eventHub.broadcast('menu.updated', { action: 'schedule_deleted', scheduleId });
  res.json({ message: 'Schedule rule removed.' });
});

// Admin: Structured Bulk Import of Official Canteen Menu
menuRouter.post('/bulk-import', authenticate, requireRole(['admin']), (req, res) => {
  try {
    const { categories, replaceExisting } = req.body || {};
    if (!Array.isArray(categories) || categories.length === 0) {
      res.status(400).json({
        error: 'Provide a non-empty `categories` array containing official menu categories and items.',
      });
      return;
    }

    const db = getDb();
    let importedCategories = 0;
    let importedItems = 0;

    db.transaction(() => {
      if (replaceExisting) {
        db.run('DELETE FROM shopping_cart_items');
        db.run('DELETE FROM menu_availability_schedules');
        db.run('DELETE FROM menu_items');
        db.run('DELETE FROM food_categories');
      }

      categories.forEach((cat: any, catIdx: number) => {
        if (!cat?.name) return;
        const catName = String(cat.name).trim();
        let catRow = db.get<{ id: number }>(
          'SELECT id FROM food_categories WHERE LOWER(name) = LOWER(?)',
          catName
        );
        let categoryId: number;
        if (catRow) {
          categoryId = catRow.id;
        } else {
          const slug = `${slugify(catName)}-${catIdx}`;
          const insCat = db.run(
            `INSERT INTO food_categories (name, slug, description, icon, display_order, is_active)
             VALUES (?, ?, ?, ?, ?, 1)`,
            catName,
            slug,
            cat.description ? String(cat.description).trim() : null,
            cat.icon ? String(cat.icon).trim() : 'utensils',
            catIdx
          );
          categoryId = insCat.lastInsertRowid;
          importedCategories++;
        }

        if (Array.isArray(cat.items)) {
          cat.items.forEach((item: any, itemIdx: number) => {
            if (!item?.name || item.priceAed === undefined) return;
            const priceFils = aedToFils(item.priceAed);
            db.run(
              `INSERT INTO menu_items (
                category_id, name, description, price_fils, image_url,
                is_available, is_vegetarian, calories, allergens, display_order
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              categoryId,
              String(item.name).trim(),
              item.description ? String(item.description).trim() : null,
              priceFils,
              item.imageUrl ? String(item.imageUrl).trim() : null,
              item.isAvailable === undefined ? 1 : Boolean(item.isAvailable),
              Boolean(item.isVegetarian),
              item.calories ? Number(item.calories) : null,
              item.allergens ? String(item.allergens).trim() : null,
              itemIdx
            );
            importedItems++;
          });
        }
      });

      logAdminActivity(db, {
        actorUserId: req.user!.id,
        action: 'BULK_IMPORT_MENU',
        targetType: 'menu',
        targetId: 'official',
        details: { importedCategories, importedItems, replaceExisting: Boolean(replaceExisting) },
        ipAddress: req.ip,
      });
    });

    eventHub.broadcast('menu.updated', { action: 'bulk_imported', importedItems });
    res.status(201).json({
      message: `Imported ${importedItems} menu items across ${importedCategories} new categories.`,
      importedCategories,
      importedItems,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Bulk menu import failed.' });
  }
});
