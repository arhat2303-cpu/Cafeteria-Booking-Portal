import { type AppDatabase } from '../db/connection.js';
import { config } from '../config.js';

export const LIVE_PAYMENTS_BLOCKED_REASON =
  'Live payments are not available yet: reliable transaction storage, verified live webhooks and real refunds must be configured and tested first.';

export function stripeTestReady(): boolean {
  if (!config.stripeSecretKey.startsWith('sk_test_') || !config.stripeWebhookSecret.startsWith('whsec_')) return false;
  try {
    const url = new URL(config.publicAppUrl);
    return url.protocol === 'https:' || (config.nodeEnv !== 'production' && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname));
  } catch {
    return false;
  }
}

export function getPaymentMode(db: AppDatabase): 'test' | 'stripe_test' | 'unavailable' {
  const mode = db.get<{ value: string }>("SELECT value FROM platform_settings WHERE key = 'payment_mode'")?.value;
  if (!mode || mode === 'test') return 'test';
  if (mode === 'stripe_test' && stripeTestReady()) return 'stripe_test';
  return 'unavailable';
}

export function getPublicPaymentMode(db: AppDatabase): 'brs_sandbox_aed' | 'stripe_test' | 'unavailable' {
  const mode = getPaymentMode(db);
  return mode === 'test' ? 'brs_sandbox_aed' : mode;
}
