export function aedToFils(amountAed: number | string): number {
  const num = typeof amountAed === 'string' ? parseFloat(amountAed) : amountAed;
  if (!Number.isFinite(num) || num < 0) {
    throw new Error('Invalid AED price amount');
  }
  return Math.round(num * 100);
}

export function filsToAed(fils: number): number {
  return Math.round(fils) / 100;
}

export function formatAed(fils: number, currency = 'AED'): string {
  const val = (Math.round(fils) / 100).toFixed(2);
  return `${currency} ${val}`;
}
