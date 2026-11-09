import { DatabaseSync, SQLInputValue } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { seedOfficialBrightRidersMenu } from './official-menu.js';
import { SCHEMA_SQL } from './schema-sql.js';

// Pre-computed 12-round bcrypt hashes for the two permanent Bright Riders School Administrators.
// Plaintext passwords are never stored in source code or committed to Git.
const PERMANENT_ADMINS: ReadonlyArray<{
  username: string;
  passwordHash: string;
  fullName: string;
  email: string;
}> = [
  {
    username: 'ARHATSHAH8149',
    passwordHash: '$2a$12$Cy8T2NWPe5gwW0ZI0fzuaeUEB/irYbTpJRuTkOIurEL.r5FDRYir.',
    fullName: 'Arhat Shah',
    email: 'arhat.admin@brightriders.ae',
  },
  {
    username: 'ruthvikabrs123',
    passwordHash: '$2a$12$d1aYwapeGeFhkl7MFJ9lvOmjxclbCh1DJI.uvvMyvSx8DFdp9TYBO',
    fullName: 'Ruthvika',
    email: 'ruthvika.admin@brightriders.ae',
  },
];

function normalizeParam(val: unknown): SQLInputValue {
  if (val === undefined || val === null) return null;
  if (typeof val === 'boolean') return val ? 1 : 0;
  if (
    typeof val === 'number' ||
    typeof val === 'string' ||
    typeof val === 'bigint' ||
    val instanceof Uint8Array
  ) {
    return val;
  }
  return JSON.stringify(val);
}

export class AppDatabase {
  public raw: DatabaseSync;
  private inTx = false;

  constructor(dbFilePath: string) {
    if (dbFilePath !== ':memory:') {
      const dir = path.dirname(path.resolve(dbFilePath));
      fs.mkdirSync(dir, { recursive: true });
    }
    this.raw = new DatabaseSync(dbFilePath);
    this.raw.exec('PRAGMA journal_mode = WAL;');
    this.raw.exec('PRAGMA foreign_keys = ON;');
    this.raw.exec('PRAGMA busy_timeout = 5000;');
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  run(sql: string, ...params: unknown[]): { lastInsertRowid: number; changes: number } {
    const stmt = this.raw.prepare(sql);
    const result = stmt.run(...params.map(normalizeParam));
    return {
      lastInsertRowid: Number(result.lastInsertRowid),
      changes: Number(result.changes),
    };
  }

  get<T = Record<string, any>>(sql: string, ...params: unknown[]): T | undefined {
    const stmt = this.raw.prepare(sql);
    const row = stmt.get(...params.map(normalizeParam));
    return row ? ({ ...(row as object) } as T) : undefined;
  }

  all<T = Record<string, any>>(sql: string, ...params: unknown[]): T[] {
    const stmt = this.raw.prepare(sql);
    const rows = stmt.all(...params.map(normalizeParam));
    return rows.map((r) => ({ ...(r as object) }) as T);
  }

  transaction<T>(fn: () => T): T {
    if (this.inTx) {
      return fn();
    }
    this.inTx = true;
    this.raw.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      const result = fn();
      this.raw.exec('COMMIT');
      this.inTx = false;
      return result;
    } catch (err) {
      try {
        this.raw.exec('ROLLBACK');
      } catch {
        // ignore rollback error if already rolled back
      }
      this.inTx = false;
      throw err;
    }
  }

  checkpointWal(): void {
    try {
      this.raw.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    } catch {
      // Ignore if in-memory DB
    }
  }

  close(): void {
    this.raw.close();
  }
}

let singletonDb: AppDatabase | null = null;

export function getEffectiveJwtSecret(database?: AppDatabase): string {
  if (config.hasExplicitJwtSecret) {
    return config.jwtSecret;
  }
  const db = database || getDb();
  const row = db.get<{ value: string }>(
    `SELECT value FROM platform_settings WHERE key = '_internal_jwt_secret'`
  );
  if (row?.value) return row.value;
  const generated = crypto.randomBytes(32).toString('hex');
  db.run(
    `INSERT OR IGNORE INTO platform_settings (key, value) VALUES ('_internal_jwt_secret', ?)`,
    generated
  );
  return (
    db.get<{ value: string }>(
      `SELECT value FROM platform_settings WHERE key = '_internal_jwt_secret'`
    )?.value || generated
  );
}

export function getEffectiveQrHmacSecret(database?: AppDatabase): string {
  if (config.hasExplicitQrHmacSecret) {
    return config.qrHmacSecret;
  }
  const db = database || getDb();
  const row = db.get<{ value: string }>(
    `SELECT value FROM platform_settings WHERE key = '_internal_qr_hmac_secret'`
  );
  if (row?.value) return row.value;
  const generated = crypto.randomBytes(32).toString('hex');
  db.run(
    `INSERT OR IGNORE INTO platform_settings (key, value) VALUES ('_internal_qr_hmac_secret', ?)`,
    generated
  );
  return (
    db.get<{ value: string }>(
      `SELECT value FROM platform_settings WHERE key = '_internal_qr_hmac_secret'`
    )?.value || generated
  );
}

export function initializeSchemaAndDefaults(
  database: AppDatabase,
  options?: {
    skipOfficialMenuSeed?: boolean;
  }
): void {
  database.exec(SCHEMA_SQL);

  // Seed default role permission matrix across the 4 official roles
  const defaultPermissions: Array<[string, string, number, string]> = [
    ['admin', 'manage_users', 1, 'Create, edit, activate/deactivate, and delete user accounts'],
    ['admin', 'manage_menu', 1, 'Create, edit, schedule, and remove canteen menu items'],
    ['admin', 'manage_orders', 1, 'View, update, and cancel any canteen order'],
    ['admin', 'manage_payments', 1, 'Inspect transactions, issue refunds, and view payment reports'],
    ['admin', 'view_analytics', 1, 'View revenue, popularity, and class-wise analytics & exports'],
    ['admin', 'manage_settings', 1, 'Configure canteen settings and break slots'],
    ['parent', 'browse_menu', 1, 'Browse canteen categories, items, and scheduled availability'],
    ['parent', 'place_child_orders', 1, 'Order meals and pay digitally for linked children'],
    ['parent', 'view_child_qr', 1, 'Access order QR verification codes for linked children'],
    ['student', 'view_own_orders', 1, 'View upcoming and past meals ordered for the student'],
    ['student', 'display_own_qr', 1, 'Display cashless QR meal collection pass'],
    ['chef', 'view_paid_orders', 1, 'View incoming paid canteen orders and preparation queue'],
    ['chef', 'update_prep_status', 1, 'Mark paid orders as Preparing or Ready for Collection'],
    ['chef', 'scan_and_collect', 1, 'Verify student QR codes and confirm meal collection'],
  ];

  for (const [role, key, allowed, desc] of defaultPermissions) {
    database.run(
      `INSERT OR IGNORE INTO role_permissions (role, permission_key, allowed, description)
       VALUES (?, ?, ?, ?)`,
      role,
      key,
      allowed,
      desc
    );
  }

  // Seed default platform settings
  const defaultCollectionSlots = JSON.stringify([
    {
      id: 'morning-recess',
      label: 'Morning Recess (09:45 AM – 10:15 AM)',
      shortLabel: '09:45 AM – 10:15 AM',
    },
    {
      id: 'junior-lunch',
      label: 'Primary Lunch Break (12:00 PM – 12:40 PM)',
      shortLabel: '12:00 PM – 12:40 PM',
    },
    {
      id: 'senior-lunch',
      label: 'Secondary Lunch Break (12:45 PM – 01:25 PM)',
      shortLabel: '12:45 PM – 01:25 PM',
    },
    {
      id: 'after-school',
      label: 'After-School Dismissal Snack (02:15 PM – 02:40 PM)',
      shortLabel: '02:15 PM – 02:40 PM',
    },
  ]);

  const defaultSettings: Array<[string, string]> = [
    ['school_name', config.schoolName],
    ['school_campus', config.schoolCampus],
    ['currency_code', config.currencyCode],
    ['cancellation_cutoff_minutes', '60'],
    ['collection_slots_json', defaultCollectionSlots],
  ];

  for (const [k, v] of defaultSettings) {
    database.run(`INSERT OR IGNORE INTO platform_settings (key, value) VALUES (?, ?)`, k, v);
  }

  // Ensure persistent signing secrets exist inside SQLite when env vars are not explicitly provided
  getEffectiveJwtSecret(database);
  getEffectiveQrHmacSecret(database);

  if (!options?.skipOfficialMenuSeed) {
    seedOfficialBrightRidersMenu(database, false);
  }

  // Idempotently ensure BOTH permanent Administrator accounts exist with identical full permissions.
  // Zero demo accounts, fake users, or fake orders are ever created.
  database.transaction(() => {
    for (const adm of PERMANENT_ADMINS) {
      const existing = database.get<{ id: number }>(
        'SELECT id FROM users WHERE LOWER(username) = LOWER(?)',
        adm.username
      );
      if (!existing) {
        const res = database.run(
          `INSERT INTO users (username, password_hash, full_name, email, phone, role, is_active, permissions_json)
           VALUES (?, ?, ?, ?, ?, 'admin', 1, ?)`,
          adm.username,
          adm.passwordHash,
          adm.fullName,
          adm.email,
          '+971-2-555-0100',
          JSON.stringify({ superAdmin: true })
        );
        database.run(
          `INSERT INTO admin_activity_logs (actor_user_id, action, target_type, target_id, details_json)
           VALUES (?, 'SYSTEM_BOOTSTRAP_ADMIN', 'user', ?, ?)`,
          res.lastInsertRowid,
          String(res.lastInsertRowid),
          JSON.stringify({ username: adm.username, role: 'admin' })
        );
      }
    }
  });
}

export function getDb(): AppDatabase {
  if (!singletonDb) {
    singletonDb = new AppDatabase(config.databasePath);
    initializeSchemaAndDefaults(singletonDb);
  }
  return singletonDb;
}

export function setDbForTesting(customDb: AppDatabase): void {
  singletonDb = customDb;
}

export function closeSingletonDb(): void {
  if (singletonDb) {
    try {
      singletonDb.close();
    } catch {
      // ignore close errors
    }
    singletonDb = null;
  }
}
