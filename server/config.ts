import dotenv from 'dotenv';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const envPath = path.resolve(process.cwd(), '.env');

// Automatically create a local gitignored .env with strong random cryptographic secrets on first run
if (!fs.existsSync(envPath) && process.env.NODE_ENV !== 'test') {
  const jwtSecret = crypto.randomBytes(32).toString('hex');
  const qrSecret = crypto.randomBytes(32).toString('hex');
  const initialAdminPw = `BRS-Admin-${crypto.randomBytes(4).toString('hex')}!`;
  const initialDemoPw = `BRS-Campus-${crypto.randomBytes(4).toString('hex')}!`;

  const generatedEnv = [
    '# Auto-generated local development secrets (gitignored - never committed)',
    'PORT=3000',
    'HOST=0.0.0.0',
    'DATABASE_PATH=./server/data/canteen.sqlite',
    `JWT_SECRET=${jwtSecret}`,
    `QR_HMAC_SECRET=${qrSecret}`,
    'SCHOOL_NAME="Bright Riders School"',
    'SCHOOL_CAMPUS="Abu Dhabi Campus, UAE"',
    'CURRENCY_CODE=AED',
    'STRIPE_SECRET_KEY=',
    'STRIPE_PUBLISHABLE_KEY=',
    'STRIPE_WEBHOOK_SECRET=',
    `BOOTSTRAP_ADMIN_PASSWORD=${initialAdminPw}`,
    `BOOTSTRAP_DEMO_PASSWORD=${initialDemoPw}`,
    'BOOTSTRAP_DEMO_ACCOUNTS=true',
    '',
  ].join('\n');

  fs.writeFileSync(envPath, generatedEnv, { mode: 0o600 });
}

dotenv.config({ path: envPath });

export const config = {
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',
  databasePath:
    process.env.DATABASE_PATH || path.resolve(process.cwd(), 'server/data/canteen.sqlite'),
  jwtSecret: process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex'),
  qrHmacSecret: process.env.QR_HMAC_SECRET || crypto.randomBytes(32).toString('hex'),
  schoolName: process.env.SCHOOL_NAME || 'Bright Riders School',
  schoolCampus: process.env.SCHOOL_CAMPUS || 'Abu Dhabi Campus, UAE',
  currencyCode: process.env.CURRENCY_CODE || 'AED',
  stripeSecretKey: (process.env.STRIPE_SECRET_KEY || '').trim(),
  stripePublishableKey: (process.env.STRIPE_PUBLISHABLE_KEY || '').trim(),
  stripeWebhookSecret: (process.env.STRIPE_WEBHOOK_SECRET || '').trim(),
  publicAppUrl: process.env.PUBLIC_APP_URL || 'http://localhost:3000',
  bootstrapAdminPassword: process.env.BOOTSTRAP_ADMIN_PASSWORD || '',
  bootstrapDemoPassword: process.env.BOOTSTRAP_DEMO_PASSWORD || '',
  bootstrapDemoAccounts: process.env.BOOTSTRAP_DEMO_ACCOUNTS !== 'false',
  get isStripeConfigured(): boolean {
    return this.stripeSecretKey.startsWith('sk_');
  },
};
