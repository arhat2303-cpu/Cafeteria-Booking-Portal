import dotenv from 'dotenv';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const isServerlessRuntime = Boolean(
  process.env.NETLIFY ||
    process.env.NETLIFY_LOCAL ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.LAMBDA_TASK_ROOT
);

const envPath = path.resolve(process.cwd(), '.env');

// Automatically create a local gitignored .env with cryptographic signing keys on first local run
// Never attempt to write .env on read-only serverless filesystems (e.g., Netlify Functions / AWS Lambda)
if (!isServerlessRuntime && !fs.existsSync(envPath) && process.env.NODE_ENV !== 'test') {
  try {
    const jwtSecret = crypto.randomBytes(32).toString('hex');
    const qrSecret = crypto.randomBytes(32).toString('hex');

    const generatedEnv = [
      '# Auto-generated local development signing keys (gitignored - never committed)',
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
      '',
    ].join('\n');

    fs.writeFileSync(envPath, generatedEnv, { mode: 0o600 });
  } catch {
    // Ignore read-only filesystem errors in restricted containers
  }
}

if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

export const config = {
  isServerless: isServerlessRuntime,
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || (isServerlessRuntime ? 'production' : 'development'),
  databasePath:
    process.env.DATABASE_PATH ||
    (isServerlessRuntime
      ? '/tmp/canteen.sqlite'
      : path.resolve(process.cwd(), 'server/data/canteen.sqlite')),
  hasExplicitJwtSecret: Boolean(process.env.JWT_SECRET),
  hasExplicitQrHmacSecret: Boolean(process.env.QR_HMAC_SECRET),
  jwtSecret: process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex'),
  qrHmacSecret: process.env.QR_HMAC_SECRET || crypto.randomBytes(32).toString('hex'),
  schoolName: process.env.SCHOOL_NAME || 'Bright Riders School',
  schoolCampus: process.env.SCHOOL_CAMPUS || 'Abu Dhabi Campus, UAE',
  currencyCode: process.env.CURRENCY_CODE || 'AED',
  stripeSecretKey: (process.env.STRIPE_SECRET_KEY || '').trim(),
  stripePublishableKey: (process.env.STRIPE_PUBLISHABLE_KEY || '').trim(),
  stripeWebhookSecret: (process.env.STRIPE_WEBHOOK_SECRET || '').trim(),
  publicAppUrl:
    process.env.PUBLIC_APP_URL ||
    process.env.DEPLOY_PRIME_URL ||
    process.env.URL ||
    'http://localhost:3000',
  get isStripeConfigured(): boolean {
    return this.stripeSecretKey.startsWith('sk_');
  },
};
