export function formatSupplierCode(nextCode: number): string {
  const n = Number.isFinite(nextCode) ? Math.max(1, Math.trunc(nextCode)) : 1;
  return `SUP-${String(n).padStart(4, "0")}`;
}

export function nextSupplierCodeFromExisting(suppliers: { code?: string }[]): number {
  const maxCode = suppliers.reduce((max, supplier) => {
    const match = /^SUP-(\d+)$/i.exec((supplier.code ?? "").trim());
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return maxCode + 1;
}
