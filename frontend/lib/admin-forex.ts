export function formatAdminReferenceRate(value: unknown): string {
  const rate = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(rate) || rate <= 0) return '—';
  return (Math.ceil(rate * 1000) / 1000).toFixed(3);
}
