import initSqlJs, { type SqlJsDatabase, type SqlJsStatic } from 'sql.js/dist/sql-wasm-inline.js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { seedOfficialBrightRidersMenu } from './official-menu.js';
import { SCHEMA_SQL } from './schema-sql.js';

type SqlBindValue = number | string | Uint8Array | null;

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

// Only the original two administrators are permanent; administrators created later
// (including the one-time Shashi seed) can be managed normally.
export function isPermanentAdmin(username: string): boolean {
  return PERMANENT_ADMINS.some((admin) => admin.username.toLowerCase() === username.toLowerCase());
}

let sqlEngine: SqlJsStatic | null = null;
let sqlEnginePromise: Promise<SqlJsStatic> | null = null;

/**
 * Initializes the self-contained embedded-WebAssembly SQLite 3 engine (`sql.js`).
 * Works identically on Node 18, Node 20, Node 22, AWS Lambda, Netlify Functions, and local dev
 * with zero native C++ addons and zero dependency on experimental `node:sqlite`.
 */
export async function ensureSqlEngine(): Promise<SqlJsStatic> {
  if (sqlEngine) return sqlEngine;
  if (!sqlEnginePromise) {
    sqlEnginePromise = initSqlJs().then((engine) => {
      sqlEngine = engine;
      return engine;
    });
  }
  return sqlEnginePromise;
}

function getSqlEngineOrThrow(): SqlJsStatic {
  if (!sqlEngine) {
    throw new Error('SQLite WebAssembly engine not initialized. Call await ensureSqlEngine() first.');
  }
  return sqlEngine;
}

function normalizeParam(val: unknown): SqlBindValue {
  if (val === undefined || val === null) return null;
  if (typeof val === 'boolean') return val ? 1 : 0;
  if (typeof val === 'bigint') return Number(val);
  if (typeof val === 'number' || typeof val === 'string') return val;
  if (Buffer.isBuffer(val)) {
    return new Uint8Array(val.buffer, val.byteOffset, val.byteLength);
  }
  if (val instanceof Uint8Array) return val;
  return JSON.stringify(val);
}

export class AppDatabase {
  public raw: SqlJsDatabase;
  private filePath: string;
  private txDepth = 0;
  private closed = false;

  constructor(dbFilePathOrBytes: string | Uint8Array) {
    const SQL = getSqlEngineOrThrow();

    if (dbFilePathOrBytes instanceof Uint8Array) {
      this.filePath = ':memory:';
      this.raw =
        dbFilePathOrBytes.byteLength > 0
          ? new SQL.Database(dbFilePathOrBytes)
          : new SQL.Database();
    } else {
      this.filePath = dbFilePathOrBytes;
      if (this.filePath !== ':memory:') {
        const resolved = path.resolve(this.filePath);
        fs.mkdirSync(path.dirname(resolved), { recursive: true });
        if (fs.existsSync(resolved) && fs.statSync(resolved).size > 0) {
          const existingBytes = new Uint8Array(fs.readFileSync(resolved));
          this.raw = new SQL.Database(existingBytes);
        } else {
          this.raw = new SQL.Database();
        }
      } else {
        this.raw = new SQL.Database();
      }
    }

    this.raw.exec('PRAGMA foreign_keys = ON;');
  }

  private persistToDisk(): void {
    if (this.closed || this.filePath === ':memory:' || this.txDepth > 0) return;
    const resolved = path.resolve(this.filePath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    const exported = this.raw.export();
    const tmpFile = `${resolved}.tmp.${process.pid}.${Date.now()}`;
    fs.writeFileSync(tmpFile, Buffer.from(exported.buffer, exported.byteOffset, exported.byteLength));
    fs.renameSync(tmpFile, resolved);
  }

  private readLastInsertRowid(): number {
    const stmt = this.raw.prepare('SELECT last_insert_rowid() AS id');
    try {
      if (stmt.step()) {
        const obj = stmt.getAsObject();
        return Number(obj.id || 0);
      }
      return 0;
    } finally {
      stmt.free();
    }
  }

  exec(sql: string): void {
    this.raw.exec(sql);
    if (this.txDepth === 0) {
      this.persistToDisk();
    }
  }

  run(sql: string, ...params: unknown[]): { lastInsertRowid: number; changes: number } {
    const bound = params.map(normalizeParam);
    this.raw.run(sql, bound);
    const changes = this.raw.getRowsModified();
    const lastInsertRowid = this.readLastInsertRowid();
    if (this.txDepth === 0) {
      this.persistToDisk();
    }
    return {
      lastInsertRowid,
      changes,
    };
  }

  get<T = Record<string, any>>(sql: string, ...params: unknown[]): T | undefined {
    const stmt = this.raw.prepare(sql);
    try {
      const bound = params.map(normalizeParam);
      if (bound.length > 0) {
        stmt.bind(bound);
      }
      if (!stmt.step()) return undefined;
      return stmt.getAsObject() as T;
    } finally {
      stmt.free();
    }
  }

  all<T = Record<string, any>>(sql: string, ...params: unknown[]): T[] {
    const stmt = this.raw.prepare(sql);
    const rows: T[] = [];
    try {
      const bound = params.map(normalizeParam);
      if (bound.length > 0) {
        stmt.bind(bound);
      }
      while (stmt.step()) {
        rows.push(stmt.getAsObject() as T);
      }
      return rows;
    } finally {
      stmt.free();
    }
  }

  transaction<T>(fn: () => T): T {
    if (this.txDepth > 0) {
      const sp = `sp_${this.txDepth}`;
      this.txDepth++;
      this.raw.exec(`SAVEPOINT ${sp}`);
      try {
        const result = fn();
        this.raw.exec(`RELEASE SAVEPOINT ${sp}`);
        this.txDepth--;
        return result;
      } catch (err) {
        try {
          this.raw.exec(`ROLLBACK TO SAVEPOINT ${sp}`);
          this.raw.exec(`RELEASE SAVEPOINT ${sp}`);
        } catch {
          // ignore savepoint cleanup failure
        }
        this.txDepth--;
        throw err;
      }
    }

    this.txDepth = 1;
    this.raw.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      const result = fn();
      this.raw.exec('COMMIT');
      this.txDepth = 0;
      this.persistToDisk();
      return result;
    } catch (err) {
      try {
        this.raw.exec('ROLLBACK');
      } catch {
        // ignore rollback error if already rolled back
      }
      this.txDepth = 0;
      throw err;
    }
  }

  exportBytes(): Uint8Array {
    return this.raw.export();
  }

  checkpointWal(): void {
    if (this.txDepth === 0) {
      this.persistToDisk();
    }
  }

  close(): void {
    if (this.closed) return;
    this.persistToDisk();
    this.closed = true;
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
  database.transaction(() => {
    database.exec(SCHEMA_SQL);

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

    getEffectiveJwtSecret(database);
    getEffectiveQrHmacSecret(database);

    if (!options?.skipOfficialMenuSeed) {
      seedOfficialBrightRidersMenu(database, false);
    }

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

    // One-time account reset. Refuse to destroy historical financial records implicitly.
    // A marker makes this a migration, not a recurring deletion of new users.
    if (!database.get("SELECT value FROM platform_settings WHERE key = '_accounts_reset_2026_11'")) {
      const historical = database.get<{ cnt: number }>(
        `SELECT COUNT(*) AS cnt FROM orders WHERE placed_by_user_id IN
         (SELECT id FROM users WHERE LOWER(username) NOT IN ('arhatshah8149', 'ruthvikabrs123', 'shashi1234'))
         OR beneficiary_user_id IN
         (SELECT id FROM users WHERE LOWER(username) NOT IN ('arhatshah8149', 'ruthvikabrs123', 'shashi1234'))`
      );
      const otherFinancial = database.get<{ cnt: number }>(
        `SELECT (SELECT COUNT(*) FROM payment_transactions WHERE user_id IN
          (SELECT id FROM users WHERE LOWER(username) NOT IN ('arhatshah8149', 'ruthvikabrs123', 'shashi1234'))) +
          (SELECT COUNT(*) FROM collection_records WHERE verified_by_chef_id IN
          (SELECT id FROM users WHERE LOWER(username) NOT IN ('arhatshah8149', 'ruthvikabrs123', 'shashi1234'))) AS cnt`
      );
      const blocked = Boolean((historical?.cnt || 0) || (otherFinancial?.cnt || 0));
      if (blocked) {
        console.error('Account reset skipped: existing financial history must be handled manually.');
      } else {
        database.run(`DELETE FROM users WHERE LOWER(username) NOT IN ('arhatshah8149', 'ruthvikabrs123', 'shashi1234')`);
      }
      if (!blocked) {
        const demoHash = '$2a$12$xlI8.BfP/dPpZMAcrTbzsem1jp3VA4iavz.I0OnVw34FbeItmUDIe';
        const ids: Record<string, number> = {};
        for (const role of ['student', 'parent', 'chef']) {
          // Internal unique usernames; the public login alias 12345 is resolved by selected portal.
          ids[role] = database.run(
            `INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)`,
            `12345.${role}`, demoHash, `Demo ${role[0].toUpperCase()}${role.slice(1)}`, role
          ).lastInsertRowid;
        }
        database.run(`INSERT INTO student_profiles (user_id, student_code, class_name) VALUES (?, 'BRS-DEMO-STUDENT', 'Demo Class')`, ids.student);
        database.run(`INSERT INTO parent_profiles (user_id) VALUES (?)`, ids.parent);
        database.run(`INSERT INTO chef_profiles (user_id, staff_code) VALUES (?, 'BRS-DEMO-CHEF')`, ids.chef);
        database.run(`INSERT INTO parent_student_links (parent_user_id, student_user_id) VALUES (?, ?)`, ids.parent, ids.student);
      }
      database.run(`INSERT INTO platform_settings (key, value) VALUES ('_accounts_reset_2026_11', ?)`, blocked ? 'blocked_history' : 'done');
    }

    // One-time provisioning, not a recurring password reset or re-creation after deletion.
    if (!database.get("SELECT value FROM platform_settings WHERE key = '_shashi_admin_provisioned_v1'")) {
      const existing = database.get<{ id: number; role: string }>(
        'SELECT id, role FROM users WHERE username = ?', 'SHASHI1234'
      );
      const hash = '$2a$12$DtovpI/Tuu/Cucsuvxiasu9lBLhIuzOfwFVn6oe4/JF5H96OxzGZC';
      if (existing && existing.role !== 'admin') {
        // Never silently promote or overwrite someone else's non-admin account.
        console.error('Could not provision SHASHI1234: username belongs to a non-admin account.');
      } else {
        let userId: number;
        if (existing) {
          userId = existing.id;
          database.run("UPDATE users SET password_hash = ?, is_active = 1, updated_at = datetime('now') WHERE id = ?", hash, userId);
          database.run("UPDATE user_sessions SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL", userId);
        } else {
          userId = database.run("INSERT INTO users (username, password_hash, full_name, role, is_active) VALUES (?, ?, ?, 'admin', 1)", 'SHASHI1234', hash, 'Shashi').lastInsertRowid;
        }
        database.run("INSERT INTO admin_activity_logs (actor_user_id, action, target_type, target_id, details_json) VALUES (NULL, 'SYSTEM_PROVISION_ADMIN', 'user', ?, ?)", String(userId), JSON.stringify({ username: 'SHASHI1234', role: 'admin' }));
        database.run("INSERT INTO platform_settings (key, value) VALUES ('_shashi_admin_provisioned_v1', 'done')");
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

export function hydrateSingletonFromBytes(bytes?: Uint8Array | null): AppDatabase {
  closeSingletonDb();
  singletonDb = new AppDatabase(bytes && bytes.byteLength > 0 ? bytes : ':memory:');
  initializeSchemaAndDefaults(singletonDb);
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
