import { DatabaseSync, SQLInputValue } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';

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

  close(): void {
    this.raw.close();
  }
}

let singletonDb: AppDatabase | null = null;

export function initializeSchemaAndDefaults(
  database: AppDatabase,
  options?: {
    adminPassword?: string;
    demoPassword?: string;
    seedDemoAccounts?: boolean;
  }
): { bootstrappedAccounts?: Record<string, { username: string; password: string; role: string }> } {
  const schemaPath = path.resolve(process.cwd(), 'server/db/schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf-8');
  database.exec(schemaSql);

  // Seed default role permission matrix
  const defaultPermissions: Array<[string, string, number, string]> = [
    ['admin', 'manage_users', 1, 'Create, edit, activate/deactivate, and delete user accounts'],
    ['admin', 'manage_menu', 1, 'Create, edit, schedule, and remove canteen menu items'],
    ['admin', 'manage_orders', 1, 'View, update, and cancel any canteen order'],
    ['admin', 'manage_payments', 1, 'Inspect transactions, issue refunds, and view payment reports'],
    ['admin', 'view_analytics', 1, 'View revenue, popularity, and class-wise analytics & exports'],
    ['admin', 'manage_settings', 1, 'Configure canteen settings and teacher ordering access'],
    ['parent', 'browse_menu', 1, 'Browse canteen categories, items, and scheduled availability'],
    ['parent', 'place_child_orders', 1, 'Order meals and pay digitally for linked children'],
    ['parent', 'view_child_qr', 1, 'Access order QR verification codes for linked children'],
    ['student', 'view_own_orders', 1, 'View upcoming and past meals ordered for the student'],
    ['student', 'display_own_qr', 1, 'Display cashless QR meal collection pass'],
    ['teacher', 'browse_menu', 1, 'View school canteen menu and item details'],
    ['teacher', 'place_self_orders', 1, 'Place personal canteen orders when enabled by Admin'],
    ['chef', 'view_paid_orders', 1, 'View incoming paid canteen orders and preparation queue'],
    ['chef', 'update_prep_status', 1, 'Mark paid orders as Preparing or Ready for Collection'],
    ['chef', 'scan_and_collect', 1, 'Verify student/staff QR codes and confirm meal collection'],
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
    ['teacher_ordering_enabled', 'true'],
    ['cancellation_cutoff_minutes', '60'],
    ['collection_slots_json', defaultCollectionSlots],
  ];

  for (const [k, v] of defaultSettings) {
    database.run(`INSERT OR IGNORE INTO platform_settings (key, value) VALUES (?, ?)`, k, v);
  }

  // Bootstrap initial accounts only if the database has zero users
  const existingUsers = database.get<{ cnt: number }>('SELECT COUNT(*) as cnt FROM users');
  if (existingUsers && existingUsers.cnt > 0) {
    return {};
  }

  const shouldSeedDemo = options?.seedDemoAccounts ?? config.bootstrapDemoAccounts;
  const adminPw =
    options?.adminPassword ||
    config.bootstrapAdminPassword ||
    `BRS-Admin-${crypto.randomBytes(4).toString('hex')}!`;
  const demoPw =
    options?.demoPassword ||
    config.bootstrapDemoPassword ||
    `BRS-Campus-${crypto.randomBytes(4).toString('hex')}!`;

  const created: Record<string, { username: string; password: string; role: string }> = {};

  database.transaction(() => {
    const adminHash = bcrypt.hashSync(adminPw, 12);
    const adminRes = database.run(
      `INSERT INTO users (username, password_hash, full_name, email, phone, role, is_active, permissions_json)
       VALUES (?, ?, ?, ?, ?, 'admin', 1, ?)`,
      'admin',
      adminHash,
      'Bright Riders Canteen Administrator',
      'canteen.admin@brightriders.ae',
      '+971-2-555-0100',
      JSON.stringify({ superAdmin: true })
    );
    created.admin = { username: 'admin', password: adminPw, role: 'admin' };

    database.run(
      `INSERT INTO admin_activity_logs (actor_user_id, action, target_type, target_id, details_json)
       VALUES (?, 'SYSTEM_BOOTSTRAP', 'system', '1', ?)`,
      adminRes.lastInsertRowid,
      JSON.stringify({ note: 'Initial Bright Riders School database initialized' })
    );

    if (shouldSeedDemo) {
      const demoHash = bcrypt.hashSync(demoPw, 12);

      // 1. Parent Account
      const parentRes = database.run(
        `INSERT INTO users (username, password_hash, full_name, email, phone, role, is_active)
         VALUES (?, ?, ?, ?, ?, 'parent', 1)`,
        'parent.fatima',
        demoHash,
        'Fatima Al Mansoori',
        'fatima.almansoori@example.ae',
        '+971-50-555-0142'
      );
      database.run(
        `INSERT INTO parent_profiles (user_id, address, emergency_contact, preferred_payment_method)
         VALUES (?, ?, ?, 'digital_card')`,
        parentRes.lastInsertRowid,
        'Mohammed Bin Zayed City, Abu Dhabi, UAE',
        '+971-50-555-0199'
      );
      created.parent = { username: 'parent.fatima', password: demoPw, role: 'parent' };

      // 2. Linked Student 1
      const stu1Res = database.run(
        `INSERT INTO users (username, password_hash, full_name, email, role, is_active)
         VALUES (?, ?, ?, ?, 'student', 1)`,
        'student.zayed',
        demoHash,
        'Zayed Al Mansoori',
        'zayed.stu@brightriders.ae'
      );
      database.run(
        `INSERT INTO student_profiles (user_id, student_code, class_name, section, house, allergies_notes)
         VALUES (?, 'BRS-STU-2026-101', 'Grade 5-A', 'A', 'Falcon House', 'None')`,
        stu1Res.lastInsertRowid
      );
      database.run(
        `INSERT INTO parent_student_links (parent_user_id, student_user_id, relationship, is_primary)
         VALUES (?, ?, 'Mother', 1)`,
        parentRes.lastInsertRowid,
        stu1Res.lastInsertRowid
      );
      created.student1 = { username: 'student.zayed', password: demoPw, role: 'student' };

      // 3. Linked Student 2
      const stu2Res = database.run(
        `INSERT INTO users (username, password_hash, full_name, email, role, is_active)
         VALUES (?, ?, ?, ?, 'student', 1)`,
        'student.mariam',
        demoHash,
        'Mariam Al Mansoori',
        'mariam.stu@brightriders.ae'
      );
      database.run(
        `INSERT INTO student_profiles (user_id, student_code, class_name, section, house, allergies_notes)
         VALUES (?, 'BRS-STU-2026-204', 'Grade 8-B', 'B', 'Oryx House', 'No tree nuts')`,
        stu2Res.lastInsertRowid
      );
      database.run(
        `INSERT INTO parent_student_links (parent_user_id, student_user_id, relationship, is_primary)
         VALUES (?, ?, 'Mother', 1)`,
        parentRes.lastInsertRowid,
        stu2Res.lastInsertRowid
      );
      created.student2 = { username: 'student.mariam', password: demoPw, role: 'student' };

      // 4. Teacher Account
      const teacherRes = database.run(
        `INSERT INTO users (username, password_hash, full_name, email, phone, role, is_active)
         VALUES (?, ?, ?, ?, ?, 'teacher', 1)`,
        'teacher.anita',
        demoHash,
        'Anita Sharma',
        'anita.sharma@brightriders.ae',
        '+971-52-555-0188'
      );
      database.run(
        `INSERT INTO teacher_profiles (user_id, staff_code, department, homeroom_class)
         VALUES (?, 'BRS-TCH-042', 'Mathematics & STEAM', 'Grade 8-B')`,
        teacherRes.lastInsertRowid
      );
      created.teacher = { username: 'teacher.anita', password: demoPw, role: 'teacher' };

      // 5. Chef Account
      const chefRes = database.run(
        `INSERT INTO users (username, password_hash, full_name, email, phone, role, is_active)
         VALUES (?, ?, ?, ?, ?, 'chef', 1)`,
        'chef.rashid',
        demoHash,
        'Chef Rashid Khan',
        'rashid.kitchen@brightriders.ae',
        '+971-55-555-0177'
      );
      database.run(
        `INSERT INTO chef_profiles (user_id, staff_code, station, shift)
         VALUES (?, 'BRS-CHF-007', 'Main Canteen Counter & Hot Kitchen', 'Full School Day')`,
        chefRes.lastInsertRowid
      );
      created.chef = { username: 'chef.rashid', password: demoPw, role: 'chef' };
    }
  });

  return { bootstrappedAccounts: created };
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
