/** Display helpers shared by server and client components. */

const moneyFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatMoney(amount: number | string | null | undefined, currency = 'SOS'): string {
  return `${currency} ${moneyFormatter.format(Number(amount ?? 0))}`;
}

/** Compact amounts for charts and cards: SOS 1.2M */
export function formatCompact(amount: number, currency = 'SOS'): string {
  return `${currency} ${new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(amount)}`;
}

export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toISOString().slice(0, 10);
}

export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

/** YYYY-MM-DD for a Date, in UTC (the platform's business day - see assumptions D2). */
export function isoDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}
