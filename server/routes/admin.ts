import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { getDb } from '../db/connection.js';
import { authenticate, requireRole, type UserRole } from '../middleware/auth.js';
import { aedToFils, filsToAed, formatAed } from '../services/money.js';
import { logAdminActivity } from '../services/audit.js';
import { eventHub } from '../services/events.js';

export const adminRouter = Router();

adminRouter.use(authenticate, requireRole(['admin']));

// 1. Admin Overview Statistics & Chart Series
adminRouter.get('/overview', (_req, res) => {
  const db = getDb();

  const roleCountsRows = db.all<{ role: string; cnt: number }>(
    'SELECT role, COUNT(*) as cnt FROM users GROUP BY role'
  );
  const roleMap: Record<string, number> = {
    admin: 0,
    parent: 0,
    student: 0,
    chef: 0,
  };
  let totalUsers = 0;
  for (const r of roleCountsRows) {
    roleMap[r.role] = r.cnt;
    totalUsers += r.cnt;
  }

  const orderSummary = db.get<{
    total_orders: number;
    pending_orders: number;
    completed_orders: number;
    cancelled_orders: number;
    total_sales_fils: number;
  }>(
    `SELECT
       COUNT(*) as total_orders,
       SUM(CASE WHEN order_status IN ('awaiting_payment', 'confirmed', 'preparing', 'ready_for_collection') THEN 1 ELSE 0 END) as pending_orders,
       SUM(CASE WHEN order_status = 'collected' THEN 1 ELSE 0 END) as completed_orders,
       SUM(CASE WHEN order_status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_orders,
       COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN total_fils ELSE 0 END), 0) as total_sales_fils
     FROM orders`
  )!;

  const todayUtc = new Date().toISOString().slice(0, 10);
  const sevenDaysAgo = new Date(Date.now() - 6 * 86400 * 1000).toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(Date.now() - 29 * 86400 * 1000).toISOString().slice(0, 10);

  const dailyRev = db.get<{ fils: number }>(
    `SELECT COALESCE(SUM(total_fils), 0) as fils
     FROM orders
     WHERE payment_status = 'paid' AND order_date = ?`,
    todayUtc
  )!;

  const weeklyRev = db.get<{ fils: number }>(
    `SELECT COALESCE(SUM(total_fils), 0) as fils
     FROM orders
     WHERE payment_status = 'paid' AND order_date >= ?`,
    sevenDaysAgo
  )!;

  const monthlyRev = db.get<{ fils: number }>(
    `SELECT COALESCE(SUM(total_fils), 0) as fils
     FROM orders
     WHERE payment_status = 'paid' AND order_date >= ?`,
    thirtyDaysAgo
  )!;

  // Daily revenue chart (last 14 days)
  const revenueByDateRows = db.all<{ order_date: string; revenue_fils: number; orders_count: number }>(
    `SELECT order_date,
            COALESCE(SUM(total_fils), 0) as revenue_fils,
            COUNT(*) as orders_count
     FROM orders
     WHERE payment_status = 'paid' AND order_date >= date('now', '-13 days')
     GROUP BY order_date
     ORDER BY order_date ASC`
  );
  const revByDateMap = new Map(revenueByDateRows.map((r) => [r.order_date, r]));
  const dailySeries = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400 * 1000).toISOString().slice(0, 10);
    const match = revByDateMap.get(d);
    dailySeries.push({
      date: d,
      revenueAed: filsToAed(match?.revenue_fils || 0),
      ordersCount: match?.orders_count || 0,
    });
  }

  // Popular food items
  const popularItems = db.all<{
    item_name: string;
    category_name: string | null;
    total_qty: number;
    revenue_fils: number;
  }>(
    `SELECT oi.item_name_snapshot as item_name,
            oi.category_name_snapshot as category_name,
            SUM(oi.quantity) as total_qty,
            SUM(oi.line_total_fils) as revenue_fils
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE o.payment_status = 'paid'
     GROUP BY oi.item_name_snapshot
     ORDER BY total_qty DESC, revenue_fils DESC
     LIMIT 8`
  );

  // Order status breakdown
  const statusRows = db.all<{ order_status: string; cnt: number }>(
    'SELECT order_status, COUNT(*) as cnt FROM orders GROUP BY order_status'
  );

  // Class-wise distribution
  const classOrders = db.all<{ class_name: string; orders_count: number; revenue_fils: number }>(
    `SELECT COALESCE(sp.class_name, 'Staff / Faculty') as class_name,
            COUNT(*) as orders_count,
            COALESCE(SUM(CASE WHEN o.payment_status = 'paid' THEN o.total_fils ELSE 0 END), 0) as revenue_fils
     FROM orders o
     LEFT JOIN student_profiles sp ON sp.user_id = o.beneficiary_user_id
     GROUP BY COALESCE(sp.class_name, 'Unassigned Class')
     ORDER BY orders_count DESC
     LIMIT 10`
  );

  res.json({
    users: {
      total: totalUsers,
      students: roleMap.student,
      parents: roleMap.parent,
      chefs: roleMap.chef,
      admins: roleMap.admin,
    },
    orders: {
      total: orderSummary.total_orders || 0,
      pending: orderSummary.pending_orders || 0,
      completed: orderSummary.completed_orders || 0,
      cancelled: orderSummary.cancelled_orders || 0,
    },
    revenue: {
      totalSalesFils: orderSummary.total_sales_fils || 0,
      totalSalesAed: filsToAed(orderSummary.total_sales_fils || 0),
      formattedTotalSales: formatAed(orderSummary.total_sales_fils || 0),
      dailyRevenueAed: filsToAed(dailyRev.fils || 0),
      formattedDailyRevenue: formatAed(dailyRev.fils || 0),
      weeklyRevenueAed: filsToAed(weeklyRev.fils || 0),
      formattedWeeklyRevenue: formatAed(weeklyRev.fils || 0),
      monthlyRevenueAed: filsToAed(monthlyRev.fils || 0),
      formattedMonthlyRevenue: formatAed(monthlyRev.fils || 0),
    },
    charts: {
      dailySeries,
      popularItems: popularItems.map((p) => ({
        name: p.item_name,
        categoryName: p.category_name || 'General',
        quantitySold: p.total_qty,
        revenueAed: filsToAed(p.revenue_fils),
        formattedRevenue: formatAed(p.revenue_fils),
      })),
      statusBreakdown: statusRows.map((s) => ({
        status: s.order_status,
        count: s.cnt,
      })),
      classBreakdown: classOrders.map((c) => ({
        className: c.class_name,
        ordersCount: c.orders_count,
        revenueAed: filsToAed(c.revenue_fils),
      })),
    },
  });
});

// 2. Admin User Management
function buildAdminUserRecord(userId: number) {
  const db = getDb();
  const u = db.get<Record<string, any>>(
    `SELECT u.id, u.username, u.full_name, u.email, u.phone, u.role, u.is_active,
            u.permissions_json, u.last_login_at, u.created_at,
            sp.student_code, sp.class_name, sp.section, sp.house, sp.allergies_notes, sp.daily_spend_limit_fils,
            pp.address, pp.emergency_contact,
            cp.staff_code as chef_staff_code, cp.station, cp.shift
     FROM users u
     LEFT JOIN student_profiles sp ON sp.user_id = u.id
     LEFT JOIN parent_profiles pp ON pp.user_id = u.id
     LEFT JOIN chef_profiles cp ON cp.user_id = u.id
     WHERE u.id = ?`,
    userId
  );

  if (!u) return null;

  let customPermissions = {};
  try {
    customPermissions = JSON.parse(u.permissions_json || '{}');
  } catch {
    customPermissions = {};
  }

  const linkedChildren =
    u.role === 'parent'
      ? db.all<{
          link_id: number;
          student_user_id: number;
          full_name: string;
          student_code: string;
          class_name: string;
          relationship: string;
        }>(
          `SELECT psl.id as link_id, psl.student_user_id, u2.full_name, sp2.student_code, sp2.class_name, psl.relationship
           FROM parent_student_links psl
           JOIN users u2 ON u2.id = psl.student_user_id
           JOIN student_profiles sp2 ON sp2.user_id = u2.id
           WHERE psl.parent_user_id = ?`,
          u.id
        )
      : [];

  const linkedParents =
    u.role === 'student'
      ? db.all<{
          link_id: number;
          parent_user_id: number;
          full_name: string;
          username: string;
          relationship: string;
        }>(
          `SELECT psl.id as link_id, psl.parent_user_id, u2.full_name, u2.username, psl.relationship
           FROM parent_student_links psl
           JOIN users u2 ON u2.id = psl.parent_user_id
           WHERE psl.student_user_id = ?`,
          u.id
        )
      : [];

  return {
    id: u.id,
    username: u.username,
    fullName: u.full_name,
    email: u.email,
    phone: u.phone,
    role: u.role as UserRole,
    isActive: Boolean(u.is_active),
    customPermissions,
    lastLoginAt: u.last_login_at,
    createdAt: u.created_at,
    studentCode: u.student_code || null,
    className: u.class_name || null,
    section: u.section || null,
    house: u.house || null,
    allergiesNotes: u.allergies_notes || null,
    dailySpendLimitAed: u.daily_spend_limit_fils ? filsToAed(u.daily_spend_limit_fils) : 0,
    address: u.address || null,
    emergencyContact: u.emergency_contact || null,
    staffCode: u.chef_staff_code || null,
    station: u.station || null,
    shift: u.shift || null,
    linkedChildren: linkedChildren.map((lc) => ({
      linkId: lc.link_id,
      studentId: lc.student_user_id,
      fullName: lc.full_name,
      studentCode: lc.student_code,
      className: lc.class_name,
      relationship: lc.relationship,
    })),
    linkedParents: linkedParents.map((lp) => ({
      linkId: lp.link_id,
      parentId: lp.parent_user_id,
      fullName: lp.full_name,
      username: lp.username,
      relationship: lp.relationship,
    })),
  };
}

adminRouter.get('/users', (req, res) => {
  const db = getDb();
  const { role, status, search } = req.query;

  const where: string[] = [];
  const params: unknown[] = [];

  if (role && typeof role === 'string' && role !== 'all') {
    where.push('u.role = ?');
    params.push(role);
  }
  if (status === 'active') {
    where.push('u.is_active = 1');
  } else if (status === 'inactive') {
    where.push('u.is_active = 0');
  }
  if (search && typeof search === 'string' && search.trim()) {
    const q = `%${search.trim().toLowerCase()}%`;
    where.push(
      `(LOWER(u.full_name) LIKE ? OR LOWER(u.username) LIKE ? OR LOWER(COALESCE(u.email, '')) LIKE ? OR LOWER(COALESCE(sp.student_code, '')) LIKE ? OR LOWER(COALESCE(sp.class_name, '')) LIKE ? OR LOWER(COALESCE(cp.staff_code, '')) LIKE ?)`
    );
    params.push(q, q, q, q, q, q);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const ids = db.all<{ id: number }>(
    `SELECT u.id
     FROM users u
     LEFT JOIN student_profiles sp ON sp.user_id = u.id
     LEFT JOIN chef_profiles cp ON cp.user_id = u.id
     ${whereSql}
     ORDER BY u.role ASC, u.full_name ASC`,
    ...params
  );

  const users = ids
    .map((r) => buildAdminUserRecord(r.id))
    .filter((u): u is NonNullable<typeof u> => Boolean(u));

  res.json({ users });
});

// Create User Account (All 5 Roles)
adminRouter.post('/users', async (req, res) => {
  try {
    const {
      fullName,
      username,
      password,
      role,
      email,
      phone,
      isActive = true,
      customPermissions = {},
      // Student fields
      studentCode,
      className,
      section,
      house,
      allergiesNotes,
      dailySpendLimitAed,
      linkedParentIds,
      relationship = 'Parent',
      // Parent fields
      address,
      emergencyContact,
      linkedStudentIds,
      // Chef fields
      staffCode,
      station,
      shift,
    } = req.body || {};

    const validRoles: UserRole[] = ['admin', 'parent', 'student', 'chef'];
    if (!fullName || !username || !password || !validRoles.includes(role)) {
      res.status(400).json({
        error: 'Full Name, Username, Password, and a valid Role (admin, parent, student, chef) are required.',
      });
      return;
    }

    if (role === 'admin') {
      res.status(403).json({ error: 'Only the two permanent administrator accounts are allowed.' });
      return;
    }
    if (/^12345(?:\.(?:student|parent|chef))?$/i.test(String(username).trim())) {
      res.status(409).json({ error: 'This username is reserved for demo accounts.' });
      return;
    }
    if (String(password).length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters long.' });
      return;
    }

    const cleanUsername = String(username).trim();
    const db = getDb();
    if (db.get('SELECT id FROM users WHERE username = ?', cleanUsername)) {
      res.status(409).json({ error: `Username "${cleanUsername}" is already in use.` });
      return;
    }

    if (role === 'student' && (!className || !String(className).trim())) {
      res.status(400).json({ error: 'Student Class (e.g., Grade 5-A) is required for student accounts.' });
      return;
    }

    const passwordHash = await bcrypt.hash(String(password), 12);
    let createdUserId = 0;

    db.transaction(() => {
      const ins = db.run(
        `INSERT INTO users (username, password_hash, full_name, email, phone, role, is_active, permissions_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        cleanUsername,
        passwordHash,
        String(fullName).trim(),
        email ? String(email).trim() : null,
        phone ? String(phone).trim() : null,
        role,
        Boolean(isActive),
        JSON.stringify(customPermissions || {})
      );
      createdUserId = ins.lastInsertRowid;

      if (role === 'student') {
        const generatedCode =
          studentCode && String(studentCode).trim()
            ? String(studentCode).trim().toUpperCase()
            : `BRS-STU-2026-${String(createdUserId).padStart(4, '0')}`;

        db.run(
          `INSERT INTO student_profiles (user_id, student_code, class_name, section, house, allergies_notes, daily_spend_limit_fils)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          createdUserId,
          generatedCode,
          String(className).trim(),
          section ? String(section).trim() : null,
          house ? String(house).trim() : null,
          allergiesNotes ? String(allergiesNotes).trim() : null,
          dailySpendLimitAed ? aedToFils(dailySpendLimitAed) : 0
        );

        if (Array.isArray(linkedParentIds)) {
          for (const pid of linkedParentIds) {
            db.run(
              `INSERT OR IGNORE INTO parent_student_links (parent_user_id, student_user_id, relationship)
               VALUES (?, ?, ?)`,
              Number(pid),
              createdUserId,
              String(relationship || 'Parent')
            );
          }
        }
      } else if (role === 'parent') {
        db.run(
          `INSERT INTO parent_profiles (user_id, address, emergency_contact)
           VALUES (?, ?, ?)`,
          createdUserId,
          address ? String(address).trim() : null,
          emergencyContact ? String(emergencyContact).trim() : null
        );

        if (Array.isArray(linkedStudentIds)) {
          for (const sid of linkedStudentIds) {
            db.run(
              `INSERT OR IGNORE INTO parent_student_links (parent_user_id, student_user_id, relationship)
               VALUES (?, ?, ?)`,
              createdUserId,
              Number(sid),
              String(relationship || 'Parent')
            );
          }
        }
      } else if (role === 'chef') {
        const code =
          staffCode && String(staffCode).trim()
            ? String(staffCode).trim().toUpperCase()
            : `BRS-CHF-${String(createdUserId).padStart(3, '0')}`;
        db.run(
          `INSERT INTO chef_profiles (user_id, staff_code, station, shift)
           VALUES (?, ?, ?, ?)`,
          createdUserId,
          code,
          station ? String(station).trim() : 'Main Canteen Kitchen',
          shift ? String(shift).trim() : 'Full School Day'
        );
      }

      logAdminActivity(db, {
        actorUserId: req.user!.id,
        action: 'CREATE_USER',
        targetType: 'user',
        targetId: createdUserId,
        details: { username: cleanUsername, role, fullName: String(fullName).trim() },
        ipAddress: req.ip,
      });
    });

    res.status(201).json({ user: buildAdminUserRecord(createdUserId) });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to create user account.' });
  }
});

// Edit User Account & Permissions
adminRouter.put('/users/:id', (req, res) => {
  try {
    const targetId = Number(req.params.id);
    const db = getDb();
    const existing = db.get<{ id: number; role: UserRole; username: string }>(
      'SELECT id, role, username FROM users WHERE id = ?',
      targetId
    );
    if (!existing) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    const {
      fullName,
      username,
      email,
      phone,
      isActive,
      customPermissions,
      studentCode,
      className,
      section,
      house,
      allergiesNotes,
      dailySpendLimitAed,
      address,
      emergencyContact,
      staffCode,
      department,
      homeroomClass,
      canPlaceOrdersOverride,
      station,
      shift,
    } = req.body || {};

    if (existing.role === 'admin' && (isActive === false || (username && String(username).trim().toLowerCase() !== existing.username.toLowerCase()))) {
      res.status(403).json({ error: 'Permanent administrators cannot be deactivated or renamed.' });
      return;
    }
    if (username && /^12345(?:\.(?:student|parent|chef))?$/i.test(String(username).trim()) && String(username).trim().toLowerCase() !== existing.username.toLowerCase()) {
      res.status(409).json({ error: 'This username is reserved for demo accounts.' });
      return;
    }
    if (targetId === req.user!.id && isActive === false) {
      res.status(400).json({ error: 'You cannot deactivate your own active administrator account.' });
      return;
    }

    db.transaction(() => {
      db.run(
        `UPDATE users
         SET full_name = COALESCE(?, full_name),
             username = COALESCE(?, username),
             email = ?,
             phone = ?,
             is_active = COALESCE(?, is_active),
             permissions_json = COALESCE(?, permissions_json),
             updated_at = datetime('now')
         WHERE id = ?`,
        fullName ? String(fullName).trim() : null,
        username ? String(username).trim() : null,
        email !== undefined ? (email ? String(email).trim() : null) : null,
        phone !== undefined ? (phone ? String(phone).trim() : null) : null,
        isActive !== undefined ? Boolean(isActive) : null,
        customPermissions !== undefined ? JSON.stringify(customPermissions) : null,
        targetId
      );

      if (isActive === false) {
        db.run(
          `UPDATE user_sessions SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL`,
          targetId
        );
      }

      if (existing.role === 'student') {
        db.run(
          `UPDATE student_profiles
           SET student_code = COALESCE(?, student_code),
               class_name = COALESCE(?, class_name),
               section = ?,
               house = ?,
               allergies_notes = ?,
               daily_spend_limit_fils = COALESCE(?, daily_spend_limit_fils),
               updated_at = datetime('now')
           WHERE user_id = ?`,
          studentCode ? String(studentCode).trim().toUpperCase() : null,
          className ? String(className).trim() : null,
          section !== undefined ? (section ? String(section).trim() : null) : null,
          house !== undefined ? (house ? String(house).trim() : null) : null,
          allergiesNotes !== undefined ? (allergiesNotes ? String(allergiesNotes).trim() : null) : null,
          dailySpendLimitAed !== undefined ? aedToFils(dailySpendLimitAed) : null,
          targetId
        );
      } else if (existing.role === 'parent') {
        db.run(
          `INSERT INTO parent_profiles (user_id, address, emergency_contact)
           VALUES (?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET
             address = excluded.address,
             emergency_contact = excluded.emergency_contact,
             updated_at = datetime('now')`,
          targetId,
          address ? String(address).trim() : null,
          emergencyContact ? String(emergencyContact).trim() : null
        );
      } else if (existing.role === 'chef') {
        db.run(
          `UPDATE chef_profiles
           SET staff_code = COALESCE(?, staff_code),
               station = COALESCE(?, station),
               shift = COALESCE(?, shift),
               updated_at = datetime('now')
           WHERE user_id = ?`,
          staffCode ? String(staffCode).trim().toUpperCase() : null,
          station ? String(station).trim() : null,
          shift ? String(shift).trim() : null,
          targetId
        );
      }

      logAdminActivity(db, {
        actorUserId: req.user!.id,
        action: 'UPDATE_USER',
        targetType: 'user',
        targetId,
        details: { username: username || existing.username, role: existing.role },
        ipAddress: req.ip,
      });
    });

    res.json({ user: buildAdminUserRecord(targetId) });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to update user.' });
  }
});

adminRouter.patch('/users/:id/status', (req, res) => {
  const targetId = Number(req.params.id);
  const { isActive } = req.body || {};
  if (targetId === req.user!.id && !isActive) {
    res.status(400).json({ error: 'You cannot deactivate your own administrator account.' });
    return;
  }

  const db = getDb();
  const upd = db.run(
    `UPDATE users SET is_active = ?, updated_at = datetime('now') WHERE id = ?`,
    Boolean(isActive),
    targetId
  );
  if (upd.changes === 0) {
    res.status(404).json({ error: 'User not found.' });
    return;
  }

  if (!isActive) {
    db.run(
      `UPDATE user_sessions SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL`,
      targetId
    );
  }

  logAdminActivity(db, {
    actorUserId: req.user!.id,
    action: isActive ? 'ACTIVATE_USER' : 'DEACTIVATE_USER',
    targetType: 'user',
    targetId,
    ipAddress: req.ip,
  });

  res.json({ user: buildAdminUserRecord(targetId) });
});

adminRouter.post('/users/:id/reset-password', async (req, res) => {
  try {
    const targetId = Number(req.params.id);
    const { newPassword } = req.body || {};
    if (!newPassword || String(newPassword).length < 8) {
      res.status(400).json({ error: 'New password must be at least 8 characters long.' });
      return;
    }

    const db = getDb();
    const target = db.get<{ username: string }>('SELECT username FROM users WHERE id = ?', targetId);
    if (!target) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    const hash = await bcrypt.hash(String(newPassword), 12);
    db.run(
      `UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`,
      hash,
      targetId
    );
    db.run(
      `UPDATE user_sessions SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL`,
      targetId
    );

    logAdminActivity(db, {
      actorUserId: req.user!.id,
      action: 'RESET_USER_PASSWORD',
      targetType: 'user',
      targetId,
      details: { username: target.username },
      ipAddress: req.ip,
    });

    res.json({ message: `Password reset successfully for ${target.username}.` });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Password reset failed.' });
  }
});

adminRouter.delete('/users/:id', (req, res) => {
  try {
    const targetId = Number(req.params.id);
    if (targetId === req.user!.id) {
      res.status(400).json({ error: 'You cannot delete your own active administrator account.' });
      return;
    }

    const db = getDb();
    const target = db.get<{ username: string; role: string }>(
      'SELECT username, role FROM users WHERE id = ?',
      targetId
    );
    if (!target) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    if (target.role === 'admin') {
      res.status(403).json({ error: 'Permanent administrator accounts cannot be deleted.' });
      return;
    }

    const orderRefs = db.get<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM orders WHERE placed_by_user_id = ? OR beneficiary_user_id = ?',
      targetId,
      targetId
    );
    if (orderRefs && orderRefs.cnt > 0) {
      res.status(400).json({
        error:
          'This account has historical canteen orders/financial records. Deactivate the account instead of permanently deleting financial history.',
      });
      return;
    }

    db.run('DELETE FROM users WHERE id = ?', targetId);
    logAdminActivity(db, {
      actorUserId: req.user!.id,
      action: 'DELETE_USER',
      targetType: 'user',
      targetId,
      details: { username: target.username, role: target.role },
      ipAddress: req.ip,
    });

    res.json({ message: `Account "${target.username}" deleted.` });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to delete user.' });
  }
});

// Parent-Child Linkage Management
adminRouter.post('/parent-links', (req, res) => {
  try {
    const { parentUserId, studentUserId, relationship = 'Parent' } = req.body || {};
    const db = getDb();

    const parent = db.get<{ id: number; role: string }>(
      'SELECT id, role FROM users WHERE id = ?',
      Number(parentUserId)
    );
    const student = db.get<{ id: number; role: string }>(
      'SELECT id, role FROM users WHERE id = ?',
      Number(studentUserId)
    );

    if (!parent || parent.role !== 'parent') {
      res.status(400).json({ error: 'Invalid parent account selected.' });
      return;
    }
    if (!student || student.role !== 'student') {
      res.status(400).json({ error: 'Invalid student account selected.' });
      return;
    }

    const ins = db.run(
      `INSERT OR IGNORE INTO parent_student_links (parent_user_id, student_user_id, relationship)
       VALUES (?, ?, ?)`,
      parent.id,
      student.id,
      String(relationship).trim()
    );

    logAdminActivity(db, {
      actorUserId: req.user!.id,
      action: 'LINK_PARENT_STUDENT',
      targetType: 'parent_student_link',
      targetId: ins.lastInsertRowid,
      details: { parentUserId: parent.id, studentUserId: student.id, relationship },
      ipAddress: req.ip,
    });

    res.status(201).json({
      parent: buildAdminUserRecord(parent.id),
      student: buildAdminUserRecord(student.id),
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to link parent and student.' });
  }
});

adminRouter.delete('/parent-links/:linkId', (req, res) => {
  const linkId = Number(req.params.linkId);
  const db = getDb();
  db.run('DELETE FROM parent_student_links WHERE id = ?', linkId);
  logAdminActivity(db, {
    actorUserId: req.user!.id,
    action: 'UNLINK_PARENT_STUDENT',
    targetType: 'parent_student_link',
    targetId: linkId,
    ipAddress: req.ip,
  });
  res.json({ message: 'Parent-student link removed.' });
});

// 3. Reports & Analytics + CSV Export
function buildReportsData() {
  const db = getDb();

  const dailySales = db.all<{
    period: string;
    orders_count: number;
    paid_orders: number;
    collected_orders: number;
    revenue_fils: number;
  }>(
    `SELECT order_date as period,
            COUNT(*) as orders_count,
            SUM(CASE WHEN payment_status = 'paid' THEN 1 ELSE 0 END) as paid_orders,
            SUM(CASE WHEN order_status = 'collected' THEN 1 ELSE 0 END) as collected_orders,
            COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN total_fils ELSE 0 END), 0) as revenue_fils
     FROM orders
     GROUP BY order_date
     ORDER BY order_date DESC
     LIMIT 60`
  );

  const weeklySales = db.all<{
    period: string;
    orders_count: number;
    paid_orders: number;
    revenue_fils: number;
  }>(
    `SELECT strftime('%Y-W%W', order_date) as period,
            COUNT(*) as orders_count,
            SUM(CASE WHEN payment_status = 'paid' THEN 1 ELSE 0 END) as paid_orders,
            COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN total_fils ELSE 0 END), 0) as revenue_fils
     FROM orders
     GROUP BY strftime('%Y-W%W', order_date)
     ORDER BY period DESC
     LIMIT 26`
  );

  const monthlySales = db.all<{
    period: string;
    orders_count: number;
    paid_orders: number;
    revenue_fils: number;
  }>(
    `SELECT substr(order_date, 1, 7) as period,
            COUNT(*) as orders_count,
            SUM(CASE WHEN payment_status = 'paid' THEN 1 ELSE 0 END) as paid_orders,
            COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN total_fils ELSE 0 END), 0) as revenue_fils
     FROM orders
     GROUP BY substr(order_date, 1, 7)
     ORDER BY period DESC
     LIMIT 24`
  );

  const popularItems = db.all<{
    item_name: string;
    category_name: string | null;
    orders_count: number;
    quantity_sold: number;
    revenue_fils: number;
  }>(
    `SELECT oi.item_name_snapshot as item_name,
            COALESCE(oi.category_name_snapshot, 'Uncategorised') as category_name,
            COUNT(DISTINCT oi.order_id) as orders_count,
            SUM(oi.quantity) as quantity_sold,
            SUM(oi.line_total_fils) as revenue_fils
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE o.payment_status = 'paid'
     GROUP BY oi.item_name_snapshot
     ORDER BY quantity_sold DESC, revenue_fils DESC`
  );

  const studentOrders = db.all<{
    student_name: string;
    student_code: string | null;
    class_name: string | null;
    orders_count: number;
    collected_count: number;
    total_spent_fils: number;
  }>(
    `SELECT ben.full_name as student_name,
            sp.student_code,
            COALESCE(sp.class_name, 'Staff') as class_name,
            COUNT(*) as orders_count,
            SUM(CASE WHEN o.order_status = 'collected' THEN 1 ELSE 0 END) as collected_count,
            COALESCE(SUM(CASE WHEN o.payment_status = 'paid' THEN o.total_fils ELSE 0 END), 0) as total_spent_fils
     FROM orders o
     JOIN users ben ON ben.id = o.beneficiary_user_id
     LEFT JOIN student_profiles sp ON sp.user_id = ben.id
     GROUP BY o.beneficiary_user_id
     ORDER BY total_spent_fils DESC`
  );

  const classWiseOrders = db.all<{
    class_name: string;
    unique_students: number;
    orders_count: number;
    collected_count: number;
    revenue_fils: number;
  }>(
    `SELECT COALESCE(sp.class_name, 'Staff / Faculty') as class_name,
            COUNT(DISTINCT o.beneficiary_user_id) as unique_students,
            COUNT(*) as orders_count,
            SUM(CASE WHEN o.order_status = 'collected' THEN 1 ELSE 0 END) as collected_count,
            COALESCE(SUM(CASE WHEN o.payment_status = 'paid' THEN o.total_fils ELSE 0 END), 0) as revenue_fils
     FROM orders o
     LEFT JOIN student_profiles sp ON sp.user_id = o.beneficiary_user_id
     GROUP BY COALESCE(sp.class_name, 'Staff / Faculty')
     ORDER BY revenue_fils DESC`
  );

  const completionTotals = db.get<{
    paid_orders: number;
    collected_orders: number;
    ready_orders: number;
    preparing_orders: number;
    cancelled_orders: number;
  }>(
    `SELECT
       COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN 1 ELSE 0 END), 0) as paid_orders,
       COALESCE(SUM(CASE WHEN order_status = 'collected' THEN 1 ELSE 0 END), 0) as collected_orders,
       COALESCE(SUM(CASE WHEN order_status = 'ready_for_collection' THEN 1 ELSE 0 END), 0) as ready_orders,
       COALESCE(SUM(CASE WHEN order_status = 'preparing' THEN 1 ELSE 0 END), 0) as preparing_orders,
       COALESCE(SUM(CASE WHEN order_status = 'cancelled' THEN 1 ELSE 0 END), 0) as cancelled_orders
     FROM orders`
  )!;

  const completionRatePct =
    completionTotals.paid_orders > 0
      ? Number(((completionTotals.collected_orders / completionTotals.paid_orders) * 100).toFixed(1))
      : 0;

  return {
    dailySales: dailySales.map((d) => ({
      date: d.period,
      ordersCount: d.orders_count,
      paidOrders: d.paid_orders,
      collectedOrders: d.collected_orders,
      revenueAed: filsToAed(d.revenue_fils),
      formattedRevenue: formatAed(d.revenue_fils),
    })),
    weeklySales: weeklySales.map((w) => ({
      week: w.period,
      ordersCount: w.orders_count,
      paidOrders: w.paid_orders,
      revenueAed: filsToAed(w.revenue_fils),
      formattedRevenue: formatAed(w.revenue_fils),
    })),
    monthlySales: monthlySales.map((m) => ({
      month: m.period,
      ordersCount: m.orders_count,
      paidOrders: m.paid_orders,
      revenueAed: filsToAed(m.revenue_fils),
      formattedRevenue: formatAed(m.revenue_fils),
    })),
    popularItems: popularItems.map((p) => ({
      itemName: p.item_name,
      categoryName: p.category_name,
      ordersCount: p.orders_count,
      quantitySold: p.quantity_sold,
      revenueAed: filsToAed(p.revenue_fils),
      formattedRevenue: formatAed(p.revenue_fils),
    })),
    studentOrders: studentOrders.map((s) => ({
      studentName: s.student_name,
      studentCode: s.student_code || 'N/A',
      className: s.class_name,
      ordersCount: s.orders_count,
      collectedCount: s.collected_count,
      totalSpentAed: filsToAed(s.total_spent_fils),
      formattedTotalSpent: formatAed(s.total_spent_fils),
    })),
    classWiseOrders: classWiseOrders.map((c) => ({
      className: c.class_name,
      uniqueStudents: c.unique_students,
      ordersCount: c.orders_count,
      collectedCount: c.collected_count,
      revenueAed: filsToAed(c.revenue_fils),
      formattedRevenue: formatAed(c.revenue_fils),
    })),
    completionMetrics: {
      paidOrders: completionTotals.paid_orders,
      collectedOrders: completionTotals.collected_orders,
      readyOrders: completionTotals.ready_orders,
      preparingOrders: completionTotals.preparing_orders,
      cancelledOrders: completionTotals.cancelled_orders,
      completionRatePct,
    },
  };
}

adminRouter.get('/reports', (_req, res) => {
  res.json(buildReportsData());
});

function toCsv(headers: string[], rows: Array<Array<string | number | null | undefined>>): string {
  const escapeCell = (val: unknown): string => {
    const str = val === null || val === undefined ? '' : String(val);
    if (/[",\n\r]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  const lines = [headers.map(escapeCell).join(',')];
  for (const row of rows) {
    lines.push(row.map(escapeCell).join(','));
  }
  return lines.join('\n');
}

adminRouter.get('/reports/export', (req, res) => {
  const type = String(req.query.type || 'daily_sales');
  const data = buildReportsData();
  const db = getDb();

  let csv = '';
  let filename = `brs-canteen-${type}.csv`;

  if (type === 'daily_sales') {
    csv = toCsv(
      ['Date', 'Total Orders', 'Paid Orders', 'Collected Orders', 'Revenue (AED)'],
      data.dailySales.map((r) => [
        r.date,
        r.ordersCount,
        r.paidOrders,
        r.collectedOrders,
        r.revenueAed.toFixed(2),
      ])
    );
  } else if (type === 'weekly_sales') {
    csv = toCsv(
      ['Week', 'Total Orders', 'Paid Orders', 'Revenue (AED)'],
      data.weeklySales.map((r) => [r.week, r.ordersCount, r.paidOrders, r.revenueAed.toFixed(2)])
    );
  } else if (type === 'monthly_sales') {
    csv = toCsv(
      ['Month', 'Total Orders', 'Paid Orders', 'Revenue (AED)'],
      data.monthlySales.map((r) => [r.month, r.ordersCount, r.paidOrders, r.revenueAed.toFixed(2)])
    );
  } else if (type === 'popular_items') {
    csv = toCsv(
      ['Food Item', 'Category', 'Orders Containing Item', 'Quantity Sold', 'Revenue (AED)'],
      data.popularItems.map((r) => [
        r.itemName,
        r.categoryName,
        r.ordersCount,
        r.quantitySold,
        r.revenueAed.toFixed(2),
      ])
    );
  } else if (type === 'student_orders') {
    csv = toCsv(
      ['Student / Staff Name', 'Student ID', 'Class', 'Total Orders', 'Collected Orders', 'Total Spent (AED)'],
      data.studentOrders.map((r) => [
        r.studentName,
        r.studentCode,
        r.className,
        r.ordersCount,
        r.collectedCount,
        r.totalSpentAed.toFixed(2),
      ])
    );
  } else if (type === 'class_orders') {
    csv = toCsv(
      ['Class', 'Active Diners', 'Total Orders', 'Collected Orders', 'Revenue (AED)'],
      data.classWiseOrders.map((r) => [
        r.className,
        r.uniqueStudents,
        r.ordersCount,
        r.collectedCount,
        r.revenueAed.toFixed(2),
      ])
    );
  } else if (type === 'payments') {
    const txns = db.all<Record<string, any>>(
      `SELECT pt.transaction_ref, o.order_number, u.full_name as payer_name,
              ben.full_name as beneficiary_name, pt.provider, pt.amount_fils,
              pt.currency, pt.status, pt.created_at
       FROM payment_transactions pt
       JOIN orders o ON o.id = pt.order_id
       JOIN users u ON u.id = pt.user_id
       JOIN users ben ON ben.id = o.beneficiary_user_id
       ORDER BY pt.id DESC`
    );
    csv = toCsv(
      [
        'Transaction Reference',
        'Order Number',
        'Payer Name',
        'Student / Recipient',
        'Provider',
        'Amount (AED)',
        'Status',
        'Timestamp (UTC)',
      ],
      txns.map((t) => [
        t.transaction_ref,
        t.order_number,
        t.payer_name,
        t.beneficiary_name,
        t.provider,
        filsToAed(t.amount_fils).toFixed(2),
        t.status,
        t.created_at,
      ])
    );
  } else {
    res.status(400).json({ error: 'Unknown export report type.' });
    return;
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
});

// 4. Platform Settings & Activity Logs
adminRouter.get('/settings', (_req, res) => {
  const db = getDb();
  const rows = db.all<{ key: string; value: string; updated_at: string }>(
    'SELECT key, value, updated_at FROM platform_settings'
  );
  const map: Record<string, string> = {};
  for (const r of rows) {
    map[r.key] = r.value;
  }
  let collectionSlots = [];
  try {
    collectionSlots = JSON.parse(map.collection_slots_json || '[]');
  } catch {
    collectionSlots = [];
  }

  res.json({
    settings: {
      schoolName: map.school_name || 'Bright Riders School',
      schoolCampus: map.school_campus || 'Abu Dhabi Campus, UAE',
      currencyCode: map.currency_code || 'AED',
      cancellationCutoffMinutes: Number(map.cancellation_cutoff_minutes || 60),
      collectionSlots,
    },
  });
});

adminRouter.put('/settings', (req, res) => {
  try {
    const db = getDb();
    const { cancellationCutoffMinutes, collectionSlots } = req.body || {};

    db.transaction(() => {
      if (cancellationCutoffMinutes !== undefined) {
        db.run(
          `INSERT INTO platform_settings (key, value, updated_by, updated_at)
           VALUES ('cancellation_cutoff_minutes', ?, ?, datetime('now'))
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = datetime('now')`,
          String(Math.max(0, Number(cancellationCutoffMinutes))),
          req.user!.id
        );
      }
      if (Array.isArray(collectionSlots) && collectionSlots.length > 0) {
        db.run(
          `INSERT INTO platform_settings (key, value, updated_by, updated_at)
           VALUES ('collection_slots_json', ?, ?, datetime('now'))
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = datetime('now')`,
          JSON.stringify(collectionSlots),
          req.user!.id
        );
      }

      logAdminActivity(db, {
        actorUserId: req.user!.id,
        action: 'UPDATE_PLATFORM_SETTINGS',
        targetType: 'settings',
        targetId: 'global',
        details: { cancellationCutoffMinutes },
        ipAddress: req.ip,
      });
    });

    eventHub.broadcast('settings.updated', {
      cancellationCutoffMinutes,
    });

    res.json({ message: 'Platform settings updated.' });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to update settings.' });
  }
});

adminRouter.get('/audit-logs', (_req, res) => {
  const db = getDb();
  const logs = db.all<{
    id: number;
    action: string;
    target_type: string;
    target_id: string | null;
    details_json: string | null;
    ip_address: string | null;
    created_at: string;
    actor_name: string | null;
    actor_username: string | null;
  }>(
    `SELECT al.*, u.full_name as actor_name, u.username as actor_username
     FROM admin_activity_logs al
     LEFT JOIN users u ON u.id = al.actor_user_id
     ORDER BY al.id DESC
     LIMIT 150`
  );

  res.json({
    logs: logs.map((l) => {
      let details = null;
      try {
        details = l.details_json ? JSON.parse(l.details_json) : null;
      } catch {
        details = null;
      }
      return {
        id: l.id,
        action: l.action,
        targetType: l.target_type,
        targetId: l.target_id,
        details,
        ipAddress: l.ip_address,
        createdAt: l.created_at,
        actorName: l.actor_name || 'System',
        actorUsername: l.actor_username || 'system',
      };
    }),
  });
});
