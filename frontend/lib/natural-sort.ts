export function naturalProductCode(value: unknown): Array<[number, string | number]> {
  return String(value || '').trim().toLocaleLowerCase().split(/(\d+)/).filter(Boolean).map((part) => /^\d+$/.test(part) ? [1, Number(part)] : [0, part]);
}

export function compareProductCodes(left: { styleCode?: string; productCode?: string; parentSku?: string; sku?: string; id?: string }, right: { styleCode?: string; productCode?: string; parentSku?: string; sku?: string; id?: string }) {
  const leftCode = left.styleCode || left.productCode || left.parentSku || left.sku || '';
  const rightCode = right.styleCode || right.productCode || right.parentSku || right.sku || '';
  const a = naturalProductCode(leftCode);
  const b = naturalProductCode(rightCode);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if (!a[index]) return -1;
    if (!b[index]) return 1;
    if (a[index][0] !== b[index][0]) return a[index][0] - b[index][0];
    if (a[index][1] !== b[index][1]) return a[index][1] < b[index][1] ? -1 : 1;
  }
  return String(left.id || '').localeCompare(String(right.id || ''), undefined, { sensitivity: 'base' });
}
