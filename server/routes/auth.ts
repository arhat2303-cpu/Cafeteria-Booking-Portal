import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { getDb } from '../db/connection.js';
import {
  authenticate,
  createSessionToken,
  requireRole,
  SESSION_COOKIE_NAME,
  type UserRole,
} from '../middleware/auth.js';
import { config } from '../config.js';
import { filsToAed } from '../services/money.js';

export const authRouter = Router();

function getPlatformPublicSettings() {
  const db = getDb();
  const rows = db.all<{ key: string; value: string }>('SELECT key, value FROM platform_settings');
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
  return {
    schoolName: map.school_name || config.schoolName,
    schoolCampus: map.school_campus || config.schoolCampus,
    currencyCode: map.currency_code || config.currencyCode,
    cancellationCutoffMinutes: Number(map.cancellation_cutoff_minutes || 60),
    collectionSlots,
    paymentMode: config.isStripeConfigured ? 'stripe' : 'brs_sandbox_aed',
    stripePublishableKey: config.isStripeConfigured ? config.stripePublishableKey : null,
  };
}

function buildUserAccountPayload(userId: number) {
  const db = getDb();
  const user = db.get<{
    id: number;
    username: string;
    full_name: string;
    email: string | null;
    phone: string | null;
    role: UserRole;
    is_active: number;
    created_at: string;
    last_login_at: string | null;
  }>(
    `SELECT id, username, full_name, email, phone, role, is_active, created_at, last_login_at
     FROM users WHERE id = ?`,
    userId
  );

  if (!user) return null;

  const base: Record<string, unknown> = {
    id: user.id,
    username: user.username,
    fullName: user.full_name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    isActive: Boolean(user.is_active),
    createdAt: user.created_at,
    lastLoginAt: user.last_login_at,
  };

  if (user.role === 'parent') {
    const profile = db.get<{
      address: string | null;
      emergency_contact: string | null;
      preferred_payment_method: string | null;
      notifications_enabled: number;
    }>('SELECT * FROM parent_profiles WHERE user_id = ?', user.id);

    const children = db.all<{
      link_id: number;
      relationship: string;
      student_user_id: number;
      full_name: string;
      username: string;
      student_code: string;
      class_name: string;
      section: string | null;
      house: string | null;
      allergies_notes: string | null;
      daily_spend_limit_fils: number;
    }>(
      `SELECT psl.id as link_id, psl.relationship,
              u.id as student_user_id, u.full_name, u.username,
              sp.student_code, sp.class_name, sp.section, sp.house,
              sp.allergies_notes, sp.daily_spend_limit_fils
       FROM parent_student_links psl
       JOIN users u ON u.id = psl.student_user_id
       JOIN student_profiles sp ON sp.user_id = u.id
       WHERE psl.parent_user_id = ? AND u.is_active = 1
       ORDER BY u.full_name ASC`,
      user.id
    );

    base.parentProfile = profile
      ? {
          address: profile.address,
          emergencyContact: profile.emergency_contact,
          preferredPaymentMethod: profile.preferred_payment_method,
          notificationsEnabled: Boolean(profile.notifications_enabled),
        }
      : null;

    base.children = children.map((c) => ({
      linkId: c.link_id,
      relationship: c.relationship,
      id: c.student_user_id,
      fullName: c.full_name,
      username: c.username,
      studentCode: c.student_code,
      className: c.class_name,
      section: c.section,
      house: c.house,
      allergiesNotes: c.allergies_notes,
      dailySpendLimitAed: filsToAed(c.daily_spend_limit_fils || 0),
    }));
  } else if (user.role === 'student') {
    const sp = db.get<{
      student_code: string;
      class_name: string;
      section: string | null;
      house: string | null;
      allergies_notes: string | null;
    }>('SELECT * FROM student_profiles WHERE user_id = ?', user.id);

    const parents = db.all<{ full_name: string; phone: string | null; relationship: string }>(
      `SELECT u.full_name, u.phone, psl.relationship
       FROM parent_student_links psl
       JOIN users u ON u.id = psl.parent_user_id
       WHERE psl.student_user_id = ?`,
      user.id
    );

    base.studentProfile = sp
      ? {
          studentCode: sp.student_code,
          className: sp.class_name,
          section: sp.section,
          house: sp.house,
          allergiesNotes: sp.allergies_notes,
          parents: parents.map((p) => ({
            fullName: p.full_name,
            phone: p.phone,
            relationship: p.relationship,
          })),
        }
      : null;
  } else if (user.role === 'chef') {
    const cp = db.get<{
      staff_code: string;
      station: string;
      shift: string;
    }>('SELECT * FROM chef_profiles WHERE user_id = ?', user.id);

    base.chefProfile = cp
      ? {
          staffCode: cp.staff_code,
          station: cp.station,
          shift: cp.shift,
        }
      : null;
  }

  return base;
}

authRouter.get('/public-config', (_req, res) => {
  res.json({ settings: getPlatformPublicSettings() });
});

authRouter.post('/login', async (req, res) => {
  try {
    const { username, password, expectedRole } = req.body || {};
    if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
      res.status(400).json({ error: 'Username and password are required.' });
      return;
    }

    const db = getDb();
    const user = db.get<{
      id: number;
      username: string;
      password_hash: string;
      role: UserRole;
      is_active: number;
    }>(
      'SELECT id, username, password_hash, role, is_active FROM users WHERE username = ?',
      username.trim()
    );

    if (!user) {
      res.status(401).json({ error: 'Invalid username or password.' });
      return;
    }

    const passwordValid = await bcrypt.compare(password, user.password_hash);
    if (!passwordValid) {
      res.status(401).json({ error: 'Invalid username or password.' });
      return;
    }

    if (
      expectedRole &&
      typeof expectedRole === 'string' &&
      ['student', 'parent', 'chef', 'admin'].includes(expectedRole) &&
      user.role !== expectedRole
    ) {
      const roleLabels: Record<string, string> = {
        student: 'Student',
        parent: 'Parent',
        chef: 'Chef',
        admin: 'Admin',
      };
      res.status(403).json({
        error: `This account belongs to the ${roleLabels[user.role] || user.role} portal. Please select the ${roleLabels[user.role] || user.role} card to sign in.`,
      });
      return;
    }

    if (!user.is_active) {
      res.status(403).json({
        error: 'This account has been deactivated. Please contact Bright Riders School administration.',
      });
      return;
    }

    db.run(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`, user.id);

    const { token, expiresAt } = createSessionToken({
      userId: user.id,
      role: user.role,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.cookie(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      expires: expiresAt,
      path: '/',
    });

    res.json({
      user: buildUserAccountPayload(user.id),
      settings: getPlatformPublicSettings(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Login failed.' });
  }
});

authRouter.post('/register', async (req, res) => {
  try {
    const { fullName, username, password, email, phone, address, emergencyContact, studentCode, relationship } =
      req.body || {};

    if (!fullName || !username || !password) {
      res.status(400).json({ error: 'Full Name, Username, and Password are required.' });
      return;
    }

    const cleanUsername = String(username).trim();
    if (!/^[a-zA-Z0-9._-]{3,40}$/.test(cleanUsername)) {
      res.status(400).json({
        error: 'Username must be 3–40 characters using letters, numbers, dots, underscores, or hyphens.',
      });
      return;
    }

    if (String(password).length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters long.' });
      return;
    }

    const db = getDb();
    const existing = db.get<{ id: number }>('SELECT id FROM users WHERE username = ?', cleanUsername);
    if (existing) {
      res.status(409).json({ error: 'That username is already registered.' });
      return;
    }

    const passwordHash = await bcrypt.hash(String(password), 12);

    let newUserId = 0;
    db.transaction(() => {
      const insertRes = db.run(
        `INSERT INTO users (username, password_hash, full_name, email, phone, role, is_active)
         VALUES (?, ?, ?, ?, ?, 'parent', 1)`,
        cleanUsername,
        passwordHash,
        String(fullName).trim(),
        email ? String(email).trim() : null,
        phone ? String(phone).trim() : null
      );
      newUserId = insertRes.lastInsertRowid;

      db.run(
        `INSERT INTO parent_profiles (user_id, address, emergency_contact)
         VALUES (?, ?, ?)`,
        newUserId,
        address ? String(address).trim() : null,
        emergencyContact ? String(emergencyContact).trim() : null
      );

      if (studentCode && String(studentCode).trim()) {
        const stu = db.get<{ user_id: number }>(
          'SELECT user_id FROM student_profiles WHERE student_code = ?',
          String(studentCode).trim().toUpperCase()
        );
        if (!stu) {
          throw new Error(
            `Student ID "${String(studentCode).trim()}" was not found. Leave blank or enter a valid Bright Riders Student ID.`
          );
        }
        db.run(
          `INSERT OR IGNORE INTO parent_student_links (parent_user_id, student_user_id, relationship)
           VALUES (?, ?, ?)`,
          newUserId,
          stu.user_id,
          relationship ? String(relationship).trim() : 'Parent'
        );
      }
    });

    const { token, expiresAt } = createSessionToken({
      userId: newUserId,
      role: 'parent',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.cookie(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      expires: expiresAt,
      path: '/',
    });

    res.status(201).json({
      user: buildUserAccountPayload(newUserId),
      settings: getPlatformPublicSettings(),
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Registration failed.' });
  }
});

authRouter.post('/logout', authenticate, (req, res) => {
  const db = getDb();
  if (req.user?.sessionJti) {
    db.run(
      `UPDATE user_sessions SET revoked_at = datetime('now') WHERE token_jti = ?`,
      req.user.sessionJti
    );
  }
  res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
  res.json({ message: 'Signed out successfully.' });
});

authRouter.get('/me', authenticate, (req, res) => {
  const payload = buildUserAccountPayload(req.user!.id);
  if (!payload) {
    res.status(404).json({ error: 'User account not found.' });
    return;
  }
  res.json({
    user: payload,
    settings: getPlatformPublicSettings(),
  });
});

authRouter.put('/profile', authenticate, (req, res) => {
  try {
    const db = getDb();
    const userId = req.user!.id;
    const { fullName, email, phone, address, emergencyContact, childAllergies } = req.body || {};

    db.transaction(() => {
      if (fullName || email !== undefined || phone !== undefined) {
        const current = db.get<{ full_name: string; email: string | null; phone: string | null }>(
          'SELECT full_name, email, phone FROM users WHERE id = ?',
          userId
        )!;

        db.run(
          `UPDATE users SET full_name = ?, email = ?, phone = ?, updated_at = datetime('now') WHERE id = ?`,
          fullName ? String(fullName).trim() : current.full_name,
          email !== undefined ? (email ? String(email).trim() : null) : current.email,
          phone !== undefined ? (phone ? String(phone).trim() : null) : current.phone,
          userId
        );
      }

      if (req.user!.role === 'parent') {
        db.run(
          `INSERT INTO parent_profiles (user_id, address, emergency_contact)
           VALUES (?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET
             address = COALESCE(excluded.address, parent_profiles.address),
             emergency_contact = COALESCE(excluded.emergency_contact, parent_profiles.emergency_contact),
             updated_at = datetime('now')`,
          userId,
          address !== undefined ? (address ? String(address).trim() : null) : null,
          emergencyContact !== undefined
            ? emergencyContact
              ? String(emergencyContact).trim()
              : null
            : null
        );

        // Allow parent to update allergy/dietary notes on their linked child
        if (childAllergies && typeof childAllergies === 'object') {
          const { studentId, allergiesNotes } = childAllergies as {
            studentId?: number;
            allergiesNotes?: string;
          };
          if (studentId) {
            const link = db.get<{ id: number }>(
              'SELECT id FROM parent_student_links WHERE parent_user_id = ? AND student_user_id = ?',
              userId,
              studentId
            );
            if (link) {
              db.run(
                `UPDATE student_profiles SET allergies_notes = ?, updated_at = datetime('now') WHERE user_id = ?`,
                allergiesNotes ? String(allergiesNotes).trim() : null,
                studentId
              );
            }
          }
        }
      }
    });

    res.json({ user: buildUserAccountPayload(userId) });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to update profile.' });
  }
});

authRouter.post('/change-password', authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword || String(newPassword).length < 8) {
      res
        .status(400)
        .json({ error: 'Current password and a new password of at least 8 characters are required.' });
      return;
    }

    const db = getDb();
    const row = db.get<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE id = ?',
      req.user!.id
    );
    if (!row || !(await bcrypt.compare(String(currentPassword), row.password_hash))) {
      res.status(401).json({ error: 'Current password is incorrect.' });
      return;
    }

    const newHash = await bcrypt.hash(String(newPassword), 12);
    db.run(
      `UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`,
      newHash,
      req.user!.id
    );
    db.run(
      `UPDATE user_sessions SET revoked_at = datetime('now')
       WHERE user_id = ? AND token_jti != ? AND revoked_at IS NULL`,
      req.user!.id,
      req.user!.sessionJti
    );

    res.json({ message: 'Password updated successfully.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to update password.' });
  }
});

authRouter.post('/link-child', authenticate, requireRole(['parent']), (req, res) => {
  try {
    const { studentCode, studentUsername, relationship } = req.body || {};
    if (!studentCode || !studentUsername) {
      res
        .status(400)
        .json({ error: 'Both Student ID (e.g. BRS-STU-...) and Student Username are required to verify linkage.' });
      return;
    }

    const db = getDb();
    const stu = db.get<{ user_id: number; full_name: string }>(
      `SELECT sp.user_id, u.full_name
       FROM student_profiles sp
       JOIN users u ON u.id = sp.user_id
       WHERE UPPER(sp.student_code) = UPPER(?) AND LOWER(u.username) = LOWER(?) AND u.is_active = 1`,
      String(studentCode).trim(),
      String(studentUsername).trim()
    );

    if (!stu) {
      res.status(404).json({
        error: 'No active student matched that Student ID and Username combination. Please verify with school administration.',
      });
      return;
    }

    db.run(
      `INSERT OR IGNORE INTO parent_student_links (parent_user_id, student_user_id, relationship)
       VALUES (?, ?, ?)`,
      req.user!.id,
      stu.user_id,
      relationship ? String(relationship).trim() : 'Parent'
    );

    res.json({
      message: `${stu.full_name} has been linked to your parent account.`,
      user: buildUserAccountPayload(req.user!.id),
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to link student profile.' });
  }
});
