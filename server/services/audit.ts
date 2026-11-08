import type { AppDatabase } from '../db/connection.js';

export function logAdminActivity(
  db: AppDatabase,
  params: {
    actorUserId: number | null;
    action: string;
    targetType: string;
    targetId?: string | number | null;
    details?: Record<string, unknown>;
    ipAddress?: string | null;
  }
): void {
  db.run(
    `INSERT INTO admin_activity_logs (actor_user_id, action, target_type, target_id, details_json, ip_address)
     VALUES (?, ?, ?, ?, ?, ?)`,
    params.actorUserId,
    params.action,
    params.targetType,
    params.targetId != null ? String(params.targetId) : null,
    params.details ? JSON.stringify(params.details) : null,
    params.ipAddress || null
  );
}

export function recordOrderStatusChange(
  db: AppDatabase,
  params: {
    orderId: number;
    previousStatus: string | null;
    newStatus: string;
    changedByUserId: number | null;
    note?: string;
  }
): void {
  db.run(
    `INSERT INTO order_status_history (order_id, previous_status, new_status, changed_by_user_id, note)
     VALUES (?, ?, ?, ?, ?)`,
    params.orderId,
    params.previousStatus,
    params.newStatus,
    params.changedByUserId,
    params.note || null
  );
}
