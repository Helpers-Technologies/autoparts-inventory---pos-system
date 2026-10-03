
// Monetary fields from the existing model. No precision/business cap is imposed.
const fields = new Set<string>("amount total subtotal price costPrice purchasePrice avgCost wholesalePrice retailPrice sellingPrice amountPaid amountReceived remaining overpayment discount shippingFee balance openingBalance openingCash expectedCash closingCashActual difference totalSalesAmount totalCashAdditions totalCashSales totalVisaSales totalCreditSales totalRefunds totalExpenses fee commission salary minOrderTotal maxDiscount retailUnitPrice codAmount codSettledAmount cashOnDeliveryFee returnFee replacementCost monthlySalary monthlySalesTarget threshold commissionValue target bonus penalty advance commissionPct salesCommissionPct creditLimit basicSalary compensationAmount adjustmentPct minMarginPct".split(" "));
export function assertMoney(value: unknown, path = "input"): void {
  if (!value || typeof value !== "object") return;
  if ("price" in value && "quantity" in value) {
    const line = value as { price: unknown; quantity: unknown };
    if (typeof line.price !== "number" || typeof line.quantity !== "number" || !Number.isFinite(line.price * line.quantity)) throw new Error(`invalid_line_value:${path}`);
  }
  if ("costPrice" in value && "quantity" in value && value.costPrice !== undefined) {
    const line = value as { costPrice: unknown; quantity: unknown };
    if (typeof line.costPrice !== "number" || typeof line.quantity !== "number" || !Number.isFinite(line.costPrice * line.quantity)) throw new Error(`invalid_cost_value:${path}`);
  }
  for (const [key, item] of Object.entries(value)) {
    if ((fields.has(key) || (key === "value" && "code" in value)) && item !== undefined && (typeof item !== "number" || !Number.isFinite(item))) throw new Error(`invalid_money:${path}.${key}`);
    if (typeof item === "number" && !Number.isFinite(item)) throw new Error(`invalid_number:${path}.${key}`);
    if (item && typeof item === "object") assertMoney(item, `${path}.${key}`);
  }
}

