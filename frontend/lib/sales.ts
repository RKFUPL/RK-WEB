/** Display preview only. The backend independently prices the canonical MRP. */
export function salePricePreview(mrp: number | undefined, discount: number) {
  if (!Number.isFinite(mrp) || !mrp || mrp <= 0 || !Number.isFinite(discount) || discount <= 0 || discount >= 100) return null;
  const amount = Math.round((mrp * (1 - discount / 100) + Number.EPSILON) * 100) / 100;
  return amount > 0 ? amount : null;
}

export function campaignWallTime(value: string, zone: string) {
  if (!value || !value.endsWith('Z')) return value.slice(0,16);
  try {
    return new Intl.DateTimeFormat('sv-SE', {timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value)).replace(' ', 'T');
  } catch { return ''; }
}
