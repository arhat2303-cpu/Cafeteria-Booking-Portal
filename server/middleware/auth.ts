import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { getDb, getEffectiveJwtSecret } from '../db/connection.js';

export type UserRole = 'admin' | 'parent' | 'student' | 'teacher' | 'chef';

export interface AuthUser {
  id: number;
  username: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  role: UserRole;
  permissions: Record<string, boolean>;
  sessionJti: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export const SESSION_COOKIE_NAME = 'brs_canteen_session';

export function createSessionToken(params: {
  userId: number;
  role: UserRole;
  ipAddress?: string;
  userAgent?: string;
}): { token: string; jti: string; expiresAt: Date } {
  const db = getDb();
  const jti = crypto.randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  db.run(
    `INSERT INTO user_sessions (user_id, token_jti, ip_address, user_agent, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    params.userId,
    jti,
    params.ipAddress || null,
    params.userAgent || null,
    expiresAt.toISOString()
  );

  const token = jwt.sign(
    {
      sub: String(params.userId),
      role: params.role,
      jti,
    },
    getEffectiveJwtSecret(db),
    { expiresIn: '7d' }
  );

  return { token, jti, expiresAt };
}

export function extractTokenFromRequest(req: Request): string | null {
  const cookieToken = req.cookies?.[SESSION_COOKIE_NAME];
  if (cookieToken && typeof cookieToken === 'string') {
    return cookieToken;
  }
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  return null;
}

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const token = extractTokenFromRequest(req);
  if (!token) {
    res.status(401).json({ error: 'Authentication required. Please sign in.' });
    return;
  }

  try {
    const db = getDb();
    const decoded = jwt.verify(token, getEffectiveJwtSecret(db)) as {
      sub: string;
      role: UserRole;
      jti: string;
    };
    const session = db.get<{
      id: number;
      user_id: number;
      expires_at: string;
      revoked_at: string | null;
    }>(
      'SELECT id, user_id, expires_at, revoked_at FROM user_sessions WHERE token_jti = ?',
      decoded.jti
    );

    if (!session || session.revoked_at || new Date(session.expires_at).getTime() < Date.now()) {
      res.clearCookie(SESSION_COOKIE_NAME);
      res.status(401).json({ error: 'Session expired or revoked. Please sign in again.' });
      return;
    }

    const user = db.get<{
      id: number;
      username: string;
      full_name: string;
      email: string | null;
      phone: string | null;
      role: UserRole;
      is_active: number;
      permissions_json: string;
    }>(
      'SELECT id, username, full_name, email, phone, role, is_active, permissions_json FROM users WHERE id = ?',
      session.user_id
    );

    if (!user || !user.is_active) {
      res.clearCookie(SESSION_COOKIE_NAME);
      res.status(403).json({ error: 'Account is deactivated or unavailable. Contact school administration.' });
      return;
    }

    let customPerms: Record<string, boolean> = {};
    try {
      customPerms = JSON.parse(user.permissions_json || '{}');
    } catch {
      customPerms = {};
    }

    const rolePermsRows = db.all<{ permission_key: string; allowed: number }>(
      'SELECT permission_key, allowed FROM role_permissions WHERE role = ?',
      user.role
    );
    const mergedPerms: Record<string, boolean> = {};
    for (const rp of rolePermsRows) {
      mergedPerms[rp.permission_key] = Boolean(rp.allowed);
    }
    for (const [k, v] of Object.entries(customPerms)) {
      if (typeof v === 'boolean') {
        mergedPerms[k] = v;
      }
    }

    req.user = {
      id: user.id,
      username: user.username,
      fullName: user.full_name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      permissions: mergedPerms,
      sessionJti: decoded.jti,
    };

    next();
  } catch {
    res.clearCookie(SESSION_COOKIE_NAME);
    res.status(401).json({ error: 'Invalid or expired authentication session.' });
  }
}

export function requireRole(allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        error: `Access denied. Required role: ${allowedRoles.join(' or ')}. Your role: ${req.user.role}.`,
      });
      return;
    }
    next();
  };
}
