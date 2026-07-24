import type {
  Product,
  InvoiceLine,
  SalesInvoice,
  PurchaseInvoice,
  SalesReturn,
  PurchaseReturn,
  ReturnLine,
  CashEntry,
  OfflineEmployee,
  OfflineEmployeeTransaction,
} from "../types";

export type PaymentStatusResult = "paid" | "partial" | "unpaid";

export interface CreditPaymentView {
  /** Credit drawn from the customer's balance toward THIS invoice. */
  creditApplied: number;
  /** Cash received + credit applied. */
  totalEffective: number;
  /** Amount still owed after cash + credit. */
  remainingDue: number;
  /** Surplus that becomes the customer's change / new credit. */
  customerChange: number;
}

/**
 * Resolve how a sales invoice is settled when the customer pays partly (or
 * wholly) from their own credit balance ("الدفع بالرصيد الدائن"). Mirrors the
 * derived figures in SalesInvoiceNewPage so the credit-payment math is
 * unit-testable. creditApplied is capped at both the available credit AND the
 * invoice net (you can never apply more credit than the invoice is worth).
 */
export function computeCreditPaymentView(args: {
  invoiceNet: number;
  amountReceived: number;
  creditAvailable: number;
  useCredit: boolean;
}): CreditPaymentView {
  const net = Math.max(0, args.invoiceNet);
  const avail = Math.max(0, args.creditAvailable);
  const cash = Math.max(0, args.amountReceived);
  const creditApplied = args.useCredit ? Math.min(avail, net) : 0;
  const totalEffective = cash + creditApplied;
  const remainingDue = Math.max(0, net - totalEffective);
  const customerChange = Math.max(0, totalEffective - net);
  return { creditApplied, totalEffective, remainingDue, customerChange };
}

export interface EmployeeStatementRow {
  key: string;
  date: string;
  type: OfflineEmployeeTransaction["type"];
  /** Money paid to / credited for the employee (salary, incentive, advance taken). */
  credit: number;
  /** Money deducted or recovered (deduction, advance repayment). */
  debit: number;
  notes?: string;
  /** Outstanding (unrepaid) advance balance after this row. */
  outstandingAdvance: number;
}

/**
 * Build a chronological payroll ledger for one offline employee. Each row keeps
 * a running outstanding-advance balance (advances add, advance-deductions repay,
 * floored at 0). Salaries/incentives/advances are credits (paid to the
 * employee); deductions/advance-deductions are debits. UI-free so it's testable.
 */
export function buildEmployeeStatementRows(
  employeeId: OfflineEmployee["id"],
  transactions: OfflineEmployeeTransaction[],
): EmployeeStatementRow[] {
  const mine = transactions
    .filter((t) => t.employeeId === employeeId)
    .slice()
    .sort((a, b) => (a.date + (a.createdAt ?? "")).localeCompare(b.date + (b.createdAt ?? "")));
  let outstandingAdvance = 0;
  return mine.map((t) => {
    if (t.type === "advance") outstandingAdvance += t.amount || 0;
    else if (t.type === "advance-deduction") outstandingAdvance = Math.max(0, outstandingAdvance - (t.amount || 0));
    const credit = t.type === "salary" || t.type === "incentive" || t.type === "advance" ? (t.amount || 0) : 0;
    const debit = t.type === "deduction" || t.type === "advance-deduction" ? (t.amount || 0) : 0;
    return { key: t.id, date: t.date, type: t.type, credit, debit, notes: t.notes, outstandingAdvance };
  });
}

export interface OfflineEmployeeSummary {
  totalSalary: number;
  totalAdvances: number;
  totalAdvanceDeductions: number;
  totalIncentives: number;
  totalDeductions: number;
  /** Advances taken minus advance-deductions repaid; never below 0. */
  outstandingAdvance: number;
}

/**
 * Aggregate an offline employee's transactions into the running totals shown
 * on OfflineEmployeesPage. Pure so the figures are unit-testable independently
 * of the React layer. Only transactions belonging to `employeeId` are counted.
 */
export function computeOfflineEmployeeSummary(
  employeeId: OfflineEmployee["id"],
  transactions: Pick<OfflineEmployeeTransaction, "employeeId" | "type" | "amount">[],
): OfflineEmployeeSummary {
  const mine = transactions.filter((t) => t.employeeId === employeeId);
  const sum = (type: OfflineEmployeeTransaction["type"]) =>
    mine.filter((t) => t.type === type).reduce((s, t) => s + (t.amount || 0), 0);
  const totalAdvances = sum("advance");
  const totalAdvanceDeductions = sum("advance-deduction");
  return {
    totalSalary: sum("salary"),
    totalAdvances,
    totalAdvanceDeductions,
    totalIncentives: sum("incentive"),
    totalDeductions: sum("deduction"),
    outstandingAdvance: Math.max(0, totalAdvances - totalAdvanceDeductions),
  };
}

export function computeStatus(total: number, paid: number): PaymentStatusResult {
  if (total <= 0) return "paid";
  if (paid <= 0) return "unpaid";
  if (paid >= total) return "paid";
  return "partial";
}

export interface SalesInvoiceEditFinancials {
  /** Gross invoice total (after discount, before returns) — stored as inv.total. */
  total: number;
  /** Net still owed after subtracting returns already applied to the invoice. */
  effectiveTotal: number;
  amountReceived: number;
  overpayment: number;
  remaining: number;
  status: PaymentStatusResult;
  /** Change in cash position vs. before the edit. 0 when the edit moves no money. */
  cashDelta: number;
}

/**
 * Recompute a sales invoice's financial fields after its lines/discount change.
 * Two invariants:
 *  - Edits never move cash: the previously-paid amount is carried as-is
 *    (`carriedPaid`); any difference the customer pays is collected separately
 *    via recordSalesReceipt. cashDelta is 0 whenever carriedPaid === prevCash.
 *  - Returns already applied to the invoice reduce what is owed, so
 *    remaining/status are computed from `effectiveTotal = total − returnsTotal`
 *    (mirrors settleSalesInvoiceReturn), NOT from the gross total — otherwise an
 *    edit would silently re-add the returned amount to the balance.
 */
export function recomputeSalesInvoiceAfterEdit(args: {
  linesTotal: number;
  discount: number;
  carriedPaid: number;
  prevCash: number;
  returnsTotal: number;
}): SalesInvoiceEditFinancials {
  const total = Math.max(0, args.linesTotal - args.discount);
  const effectiveTotal = Math.max(0, total - Math.min(total, args.returnsTotal));
  const amountReceived = Math.min(args.carriedPaid, effectiveTotal);
  const overpayment = Math.max(0, args.carriedPaid - effectiveTotal);
  const remaining = Math.max(0, effectiveTotal - amountReceived);
  const status = computeStatus(effectiveTotal, amountReceived);
  const cashDelta = amountReceived + overpayment - args.prevCash;
  return { total, effectiveTotal, amountReceived, overpayment, remaining, status, cashDelta };
}

export interface PurchaseInvoiceEditFinancials {
  total: number;
  amountPaid: number;
  overpayment: number;
  remaining: number;
  status: PaymentStatusResult;
}

/**
 * Recompute a purchase invoice's financial fields after its lines change.
 * NOTE: unlike sales returns, PURCHASE returns reduce the stored lines/total
 * directly (settlePurchaseInvoiceReturn), so the edited lines ALREADY reflect
 * any returns — there is no separate returnsTotal to fold in here. The invariant
 * to preserve is that the full amount paid so far (`paidSoFar = amountPaid +
 * prior overpayment`) is carried over and re-split into paid/overpayment against
 * the new total, so a prior supplier credit isn't silently dropped on edit.
 */
export function recomputePurchaseInvoiceAfterEdit(args: {
  linesTotal: number;
  paidSoFar: number;
}): PurchaseInvoiceEditFinancials {
  const total = Math.max(0, args.linesTotal);
  const amountPaid = Math.min(args.paidSoFar, total);
  const overpayment = Math.max(0, args.paidSoFar - total);
  const remaining = Math.max(0, total - amountPaid);
  const status = computeStatus(total, amountPaid);
  return { total, amountPaid, overpayment, remaining, status };
}

/**
 * Integer carton delta for a manual stock adjustment that may include loose-piece changes.
 * Mirrors the setProducts math in adjustStock so StockMovement.quantity is never fractional.
 * looseQuantity is always normalised (< piecesPerUnit), so prior full-carton count = 0.
 */
export function adjustStockCartonDelta(
  delta: number,
  looseDelta: number | undefined,
  currentLoose: number,
  piecesPerUnit: number | undefined,
): number {
  if (!looseDelta || !piecesPerUnit) return delta;
  const newLoose = Math.max(0, currentLoose + looseDelta);
  return delta + Math.floor(newLoose / piecesPerUnit);
}

/**
 * Recompute a product's moving weighted-average cost after removing a value
 * contribution (an edited/deleted purchase-invoice line, or a purchase
 * return) and/or adding a new one (a new/edited purchase-invoice line).
 * Quantities are always in the product's base unit — purchase lines never
 * carry loose/piece units (see PurchaseInvoiceNewPage), so no carton/piece
 * conversion is needed here. Clamped so rounding drift can never push the
 * running value negative, and the last known cost is kept once stock hits
 * zero rather than collapsing to 0.
 */
export function applyWeightedAverageCostDelta(args: {
  currentQty: number;
  currentAvgCost: number;
  removeQty?: number;
  removeValue?: number;
  addQty?: number;
  addValue?: number;
}): number {
  const { currentQty, currentAvgCost, removeQty = 0, removeValue = 0, addQty = 0, addValue = 0 } = args;
  const afterRemoveQty = Math.max(0, currentQty - removeQty);
  const afterRemoveValue = Math.max(0, currentQty * currentAvgCost - removeValue);
  const finalQty = afterRemoveQty + addQty;
  const finalValue = afterRemoveValue + addValue;
  return finalQty > 0 ? finalValue / finalQty : currentAvgCost;
}

export function applyPieceDeduction(p: Product, pieces: number): Partial<Product> {
  const ppu = p.piecesPerUnit!;
  const loose = p.looseQuantity ?? 0;
  if (loose >= pieces) {
    return { quantity: p.quantity, looseQuantity: loose - pieces };
  }
  const needed = pieces - loose;
  const cartonsToOpen = Math.ceil(needed / ppu);
  return {
    quantity: Math.max(0, p.quantity - cartonsToOpen),
    looseQuantity: cartonsToOpen * ppu - needed,
  };
}

export function applyPieceAddition(p: Product, pieces: number): Partial<Product> {
  const ppu = p.piecesPerUnit!;
  const newLoose = (p.looseQuantity ?? 0) + pieces;
  const fullCartons = Math.floor(newLoose / ppu);
  return {
    quantity: p.quantity + fullCartons,
    looseQuantity: newLoose - fullCartons * ppu,
  };
}

export function applyReturnToInvoiceLines(lines: InvoiceLine[], returns: ReturnLine[]) {
  const remainingByLine = new Map<string, number>();
  const remainingByProduct = new Map<string, number>();

  returns.forEach((line) => {
    if (line.sourceLineId) {
      remainingByLine.set(
        line.sourceLineId,
        (remainingByLine.get(line.sourceLineId) ?? 0) + line.quantity,
      );
      return;
    }
    remainingByProduct.set(
      line.productId,
      (remainingByProduct.get(line.productId) ?? 0) + line.quantity,
    );
  });

  let appliedTotal = 0;
  const nextLines = lines
    .map((line) => {
      const lineReturnQty = remainingByLine.get(line.id);
      const productReturnQty =
        lineReturnQty === undefined ? remainingByProduct.get(line.productId) : undefined;
      const requestedReturnQty = lineReturnQty ?? productReturnQty ?? 0;
      const appliedQty = Math.min(line.quantity, Math.max(0, requestedReturnQty));

      if (lineReturnQty !== undefined) {
        remainingByLine.set(line.id, Math.max(0, lineReturnQty - appliedQty));
      } else if (productReturnQty !== undefined) {
        remainingByProduct.set(line.productId, Math.max(0, productReturnQty - appliedQty));
      }

      appliedTotal += appliedQty * line.price;
      const quantity = Math.max(0, line.quantity - appliedQty);
      return { ...line, quantity, subtotal: quantity * line.price };
    })
    .filter((line) => line.quantity > 0);

  const total = nextLines.reduce((sum, line) => sum + line.subtotal, 0);
  return { lines: nextLines, total, appliedTotal };
}

export function quotationConversionFields(
  quot: { total: number },
  amountReceived: number,
) {
  // quot.total is already net of the quotation discount (QuotationNewPage stores
  // subtotal − discount), so the invoice total must NOT subtract it again.
  const requested = Math.max(0, amountReceived);
  const received = Math.min(requested, quot.total);
  return {
    total: quot.total,
    amountReceived: received,
    overpayment: Math.max(0, requested - quot.total),
  };
}

/**
 * Net cash an employee actually collected in [from, to] (inclusive):
 * receipts + edit/cancellation adjustments on the employee's invoices, plus
 * refund adjustments on returns of those invoices. This is THE single
 * definition of the employee commission base — EmployeeReportPage (quarters)
 * and ReportsPage (free date range) must both use it (OBS-02, report 09).
 */
export function employeeCollectedCash(
  salesInvoices: Pick<SalesInvoice, "id" | "createdByUserId" | "cancelled">[],
  salesReturns: Pick<SalesReturn, "id" | "originalInvoiceId">[],
  cashEntries: Pick<CashEntry, "referenceId" | "date" | "type" | "amount">[],
  userId: string,
  from: string,
  to: string,
): number {
  const empInvoiceIds = new Set(
    salesInvoices
      .filter((inv) => inv.createdByUserId === userId && !inv.cancelled)
      .map((inv) => inv.id),
  );
  const empReturnIds = new Set(
    salesReturns
      .filter((r) => r.originalInvoiceId != null && empInvoiceIds.has(r.originalInvoiceId))
      .map((r) => r.id),
  );
  return cashEntries
    .filter(
      (ce) =>
        ce.referenceId != null &&
        ce.date >= from &&
        ce.date <= to &&
        ((empInvoiceIds.has(ce.referenceId) &&
          (ce.type === "sales-receipt" || ce.type === "adjustment")) ||
          (empReturnIds.has(ce.referenceId) && ce.type === "adjustment")),
    )
    .reduce((sum, ce) => sum + ce.amount, 0);
}

export function settleSalesInvoiceReturn(
  invoice: SalesInvoice,
  ret: Pick<SalesReturn, "lines" | "total" | "refundCash">,
  /** Cumulative total of ALL previous returns on this invoice (FIX-02). */
  previousReturnsTotal = 0,
) {
  // Keep original lines and total unchanged — returns are shown as separate records.
  // FIX-02: effectiveTotal must account for ALL returns (previous + current),
  // not just the current one. Without this, a 2nd return on the same invoice
  // would compute effectiveTotal = originalTotal − currentReturn, ignoring
  // the amount already reduced by earlier returns.
  const totalReturned = previousReturnsTotal + ret.total;
  const returnTotal = Math.min(invoice.total, totalReturned);
  const paidAndCredit = invoice.amountReceived + (invoice.overpayment ?? 0);
  const cashRefund = ret.refundCash ? Math.min(ret.total, paidAndCredit) : 0;
  const paidAndCreditAfterReturn = Math.max(0, paidAndCredit - cashRefund);
  const effectiveTotal = Math.max(0, invoice.total - returnTotal);
  const amountReceived = Math.min(effectiveTotal, paidAndCreditAfterReturn);
  const overpayment = Math.max(0, paidAndCreditAfterReturn - amountReceived);
  const remaining = Math.max(0, effectiveTotal - amountReceived);

  return {
    invoice: {
      ...invoice,
      amountReceived,
      remaining,
      status: computeStatus(effectiveTotal, amountReceived),
      overpayment: overpayment > 0 ? overpayment : undefined,
      paymentDueDate: remaining > 0 ? invoice.paymentDueDate : undefined,
    },
    cashRefund,
  };
}

export function settlePurchaseInvoiceReturn(
  invoice: PurchaseInvoice,
  ret: Pick<PurchaseReturn, "lines" | "total">,
) {
  const adjusted = applyReturnToInvoiceLines(invoice.lines, ret.lines);
  const paidAndCredit = invoice.amountPaid + (invoice.overpayment ?? 0);
  const amountPaid = Math.min(adjusted.total, paidAndCredit);
  const overpayment = Math.max(0, paidAndCredit - amountPaid);
  const remaining = Math.max(0, adjusted.total - amountPaid);

  return {
    ...invoice,
    lines: adjusted.lines,
    total: adjusted.total,
    amountPaid,
    remaining,
    status: computeStatus(adjusted.total, amountPaid),
    overpayment: overpayment > 0 ? overpayment : undefined,
  };
}



export function computeShiftSummary(args: {
  shift: import("../types").CashierShift;
  salesInvoices: SalesInvoice[];
  cashEntries: CashEntry[];
  salesReturns: SalesReturn[];
}): import("../types").CashierShift {
  const { shift, salesInvoices, cashEntries, salesReturns } = args;

  const start = shift.openedAt;
  const end = shift.closedAt || new Date().toISOString();

  // Find sales invoices for this shift
  const shiftInvoices = salesInvoices.filter((inv) => {
    if (inv.cancelled) return false;
    if (inv.shiftId) return inv.shiftId === shift.id;
    // Fallback matching by cashier ID and date range
    if (inv.createdByUserId !== shift.cashierId) return false;
    return inv.createdAt >= start && inv.createdAt <= end;
  });

  const salesInvoiceIds = shiftInvoices.map((inv) => inv.id);
  const invoiceIdSet = new Set(salesInvoiceIds);
  const shiftReturnIds = new Set(
    salesReturns
      .filter((ret) => invoiceIdSet.has(ret.originalInvoiceId) && ret.createdAt >= start && ret.createdAt <= end)
      .map((ret) => ret.id),
  );
  const totalSalesAmount = shiftInvoices.reduce((sum, inv) => sum + inv.total, 0);
  const totalCreditSales = shiftInvoices.reduce(
    (sum, inv) => sum + (inv.paymentType === "account" ? inv.remaining : 0),
    0,
  );

  const shiftEntries = cashEntries.filter((entry) => {
    if (entry.shiftId) return entry.shiftId === shift.id;
    // دعم السجلات القديمة قبل إضافة shiftId دون خلط ورديات الكاشير الأخرى.
    return Boolean(
      entry.referenceId &&
      (invoiceIdSet.has(entry.referenceId) || shiftReturnIds.has(entry.referenceId)),
    );
  });
  const isPhysicalCash = (entry: CashEntry) => !entry.paymentMethod || entry.paymentMethod === "cash";
  const isSalesRefund = (entry: CashEntry) =>
    entry.amount < 0 &&
    entry.type === "adjustment" &&
    Boolean(
      (entry.referenceId && (invoiceIdSet.has(entry.referenceId) || shiftReturnIds.has(entry.referenceId))) ||
      /مبيعات|فاتورة مبيعات/.test(entry.description),
    );

  // تحصيلات المبيعات النقدية منفصلة عن أي عهدة/إضافة أخرى لتبقى قراءة التقرير واضحة.
  const totalCashSales = shiftEntries
    .filter((entry) => isPhysicalCash(entry) && entry.type === "sales-receipt" && entry.amount > 0)
    .reduce((sum, entry) => sum + entry.amount, 0);
  const totalCashAdditions = shiftEntries
    .filter((entry) => isPhysicalCash(entry) && entry.type !== "sales-receipt" && entry.amount > 0)
    .reduce((sum, entry) => sum + entry.amount, 0);
  const totalVisaSales = shiftEntries
    .filter((entry) => !isPhysicalCash(entry) && entry.paymentMethod !== "credit" && entry.amount > 0)
    .reduce((sum, entry) => sum + entry.amount, 0);
  const totalRefunds = shiftEntries
    .filter((entry) => isPhysicalCash(entry) && isSalesRefund(entry))
    .reduce((sum, entry) => sum + Math.abs(entry.amount), 0);
  const totalExpenses = shiftEntries
    .filter((entry) => isPhysicalCash(entry) && entry.amount < 0 && !isSalesRefund(entry))
    .reduce((sum, entry) => sum + Math.abs(entry.amount), 0);

  const expectedCash = Math.round(
    (shift.openingCash + totalCashSales + totalCashAdditions - totalRefunds - totalExpenses) * 100,
  ) / 100;
  const difference =
    typeof shift.closingCashActual === "number"
      ? Math.round((shift.closingCashActual - expectedCash) * 100) / 100
      : undefined;

  return {
    ...shift,
    totalSalesCount: shiftInvoices.length,
    totalSalesAmount: Math.round(totalSalesAmount * 100) / 100,
    totalCashAdditions: Math.round(totalCashAdditions * 100) / 100,
    totalCashSales: Math.round(totalCashSales * 100) / 100,
    totalVisaSales: Math.round(totalVisaSales * 100) / 100,
    totalCreditSales: Math.round(totalCreditSales * 100) / 100,
    totalRefunds: Math.round(totalRefunds * 100) / 100,
    totalExpenses: Math.round(totalExpenses * 100) / 100,
    expectedCash,
    difference,
    salesInvoiceIds,
  };
}
