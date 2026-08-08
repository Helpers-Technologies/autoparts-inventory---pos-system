"use strict";

/**
 * Generates a realistic three-year shop history for load and correctness
 * testing: ~15k customers, ~30k sales + purchase invoices, returns, warranty
 * claims, credit sales, cashier shifts, stock movements and expenses.
 *
 * Two rules shape everything here:
 *
 * 1. The numbers have to be *arithmetically consistent*, not merely present.
 *    A dataset where profit does not equal revenue minus cost proves nothing
 *    when the reports are later checked against it — the checker would be
 *    validating the generator's mistakes. So stock is tracked as invoices are
 *    emitted, costs come from the purchases that actually supplied the sale,
 *    and every total is computed rather than invented.
 *
 * 2. It has to be deterministic. A load test that generates different data on
 *    each run cannot be used to compare a slow build against a fast one, and a
 *    failure that cannot be reproduced cannot be fixed. Hence the seeded PRNG
 *    below and no use of Date.now()/Math.random() anywhere.
 *
 * Usage:
 *   node scripts/generate-load-test-dataset.cjs [--out FILE] [--customers N]
 *        [--invoices N] [--products N] [--years N]
 */

const fs = require("node:fs");
const path = require("node:path");

// ── Deterministic PRNG (mulberry32) ──────────────────────────────────────
let _seed = 0x9e3779b9;
function rnd() {
  _seed |= 0;
  _seed = (_seed + 0x6d2b79f5) | 0;
  let t = Math.imul(_seed ^ (_seed >>> 15), 1 | _seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const int = (min, max) => min + Math.floor(rnd() * (max - min + 1));
const pick = (arr) => arr[int(0, arr.length - 1)];
const chance = (p) => rnd() < p;
/** Money is rounded to piastres everywhere; floating point drift across 30k
 *  invoices would otherwise show up as pennies of unexplained profit. */
const money = (n) => Math.round(n * 100) / 100;

// ── Domain vocabulary (cars only — this shop does not sell anything else) ──
const BRANDS = ["Bosch", "Denso", "Mahle", "Mann", "NGK", "Valeo", "SKF", "Gates",
  "Febi", "Sachs", "Brembo", "Hella", "Continental", "Delphi", "TRW"];
const CATEGORIES = ["فلاتر", "فرامل", "تعليق", "كهرباء", "محرك", "ناقل حركة",
  "تبريد", "عادم", "هيكل", "زيوت وسوائل", "إطارات", "بطاريات"];
const PART_NAMES = {
  "فلاتر": ["فلتر زيت", "فلتر هواء", "فلتر بنزين", "فلتر تكييف"],
  "فرامل": ["تيل فرامل أمامي", "تيل فرامل خلفي", "هوب فرامل", "اسطوانة فرامل"],
  "تعليق": ["مساعد أمامي", "مساعد خلفي", "جلبة مقص", "كوبلن", "عمود إكس"],
  "كهرباء": ["بوجيه", "كويل", "دينامو", "مارش", "حساس أكسجين"],
  "محرك": ["طقم جوانات", "شنابر", "بستم", "سلسلة كاتينة", "طرمبة زيت"],
  "ناقل حركة": ["دبرياج", "طقم دبرياج", "زيت فتيس", "فلتر فتيس"],
  "تبريد": ["ردياتير", "طرمبة مياه", "ثرموستات", "مروحة تبريد"],
  "عادم": ["شكمان", "كتاليست", "حساس عادم"],
  "هيكل": ["مرآة جانبية", "مصد أمامي", "شبكة أمامية", "غطاء موتور"],
  "زيوت وسوائل": ["زيت محرك 5W-30", "زيت فرامل", "مياه رادياتير", "زيت باور"],
  "إطارات": ["إطار 185/65 R15", "إطار 195/60 R15", "إطار 205/55 R16"],
  "بطاريات": ["بطارية 70 أمبير", "بطارية 90 أمبير", "بطارية 45 أمبير"],
};
const CAR_MAKES = ["تويوتا", "هيونداي", "كيا", "نيسان", "شيفروليه", "فولكس فاجن",
  "سكودا", "رينو", "بيجو", "ميتسوبيشي", "هوندا", "فورد", "بي إم دبليو", "مرسيدس"];
const FIRST_NAMES = ["أحمد", "محمد", "محمود", "مصطفى", "خالد", "عمرو", "طارق", "هاني",
  "سامح", "وليد", "ياسر", "إبراهيم", "علي", "حسن", "كريم", "شريف", "أيمن", "رامي"];
const LAST_NAMES = ["عبد الله", "السيد", "حسن", "علي", "إبراهيم", "منصور", "الشريف",
  "عبد العزيز", "فتحي", "زكي", "رمضان", "صلاح", "نبيل", "فؤاد"];
const GOVERNORATES = ["القاهرة", "الجيزة", "الإسكندرية", "القليوبية", "الشرقية",
  "الدقهلية", "البحيرة", "المنوفية", "الغربية", "أسيوط", "المنيا", "سوهاج"];
const SUPPLIER_NAMES = ["الشركة المصرية لقطع الغيار", "مؤسسة النصر للتجارة",
  "الدولية لاستيراد قطع السيارات", "مجموعة الأهرام للقطع", "شركة الوفاء",
  "التوكيلات المتحدة", "بيت القطع الأصلية", "الصفوة لقطع الغيار"];

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const CONFIG = {
  years: Number(arg("--years", 3)),
  customers: Number(arg("--customers", 15000)),
  invoices: Number(arg("--invoices", 30000)),
  products: Number(arg("--products", 4000)),
  suppliers: 60,
  out: arg("--out", path.join(__dirname, "..", "load-test-dataset.json")),
};

// Fixed end date so runs are comparable; the history ends "today" relative to
// a stamped constant rather than the wall clock.
const END = new Date("2026-08-01T00:00:00.000Z").getTime();
const START = END - CONFIG.years * 365 * 24 * 3600 * 1000;
const DAY = 24 * 3600 * 1000;

function isoAt(ms) {
  return new Date(ms).toISOString();
}
function dateAt(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Sales are not uniform: weekends are busier, and the shop has grown over the
 *  three years. Reports that summarise "this month vs last" are meaningless
 *  against a flat distribution. */
function invoiceTimestamp(index, total) {
  const progress = index / total;
  // Quadratic growth: the third year carries roughly half the invoices.
  const skewed = Math.pow(progress, 0.75);
  const base = START + skewed * (END - START);
  const jitter = (rnd() - 0.5) * 20 * DAY;
  let t = Math.min(END - DAY, Math.max(START, base + jitter));
  const day = new Date(t).getUTCDay();
  // Friday is the weekly day off in this market — push those to Saturday.
  if (day === 5 && chance(0.8)) t += DAY;
  return t;
}

console.error(`generating: ${CONFIG.years}y, ${CONFIG.customers} customers, ` +
  `${CONFIG.invoices} invoices, ${CONFIG.products} products`);

// ── Branches ─────────────────────────────────────────────────────────────
const branches = [
  { id: "branch-main", code: "BR-001", name: "الفرع الرئيسي", isMain: true, active: true,
    address: "القاهرة - مدينة نصر", phone: "0221234567", createdAt: isoAt(START) },
  { id: "branch-giza", code: "BR-002", name: "فرع الجيزة", isMain: false, active: true,
    address: "الجيزة - فيصل", phone: "0233214567", createdAt: isoAt(START + 200 * DAY) },
  { id: "branch-alex", code: "BR-003", name: "فرع الإسكندرية", isMain: false, active: true,
    address: "الإسكندرية - سموحة", phone: "0341234567", createdAt: isoAt(START + 500 * DAY) },
];

// ── Suppliers ────────────────────────────────────────────────────────────
const suppliers = [];
for (let i = 0; i < CONFIG.suppliers; i++) {
  suppliers.push({
    id: `sup-${i + 1}`,
    code: `SUP-${String(i + 1).padStart(4, "0")}`,
    name: i < SUPPLIER_NAMES.length ? SUPPLIER_NAMES[i] : `${pick(SUPPLIER_NAMES)} ${i + 1}`,
    phone: `010${int(10000000, 99999999)}`,
    address: `${pick(GOVERNORATES)} - ${int(1, 99)} ش التجارة`,
    balance: 0,
    createdAt: isoAt(START + int(0, 60) * DAY),
  });
}

// ── Products ─────────────────────────────────────────────────────────────
const products = [];
for (let i = 0; i < CONFIG.products; i++) {
  const category = pick(CATEGORIES);
  const base = pick(PART_NAMES[category]);
  const brand = pick(BRANDS);
  // Price bands taken from what these categories actually cost in this market.
  // The first attempt drew uniformly from 40-6000 EGP, which produced an
  // average invoice of ~109,000 EGP — a figure that makes every report in the
  // load test unreadable and hides nothing useful, since a shop selling that
  // much would not be running a single-branch POS.
  const priceBand =
    category === "إطارات" ? [900, 4200]
    : category === "بطاريات" ? [1400, 4800]
    : category === "زيوت وسوائل" ? [90, 900]
    : category === "فلاتر" ? [60, 450]
    : category === "هيكل" ? [700, 5000]
    : category === "محرك" || category === "ناقل حركة" ? [400, 5500]
    : [120, 1800];
  const purchasePrice = money(priceBand[0] + rnd() * (priceBand[1] - priceBand[0]));
  // Margins vary by category the way they do in a real parts shop: fast-moving
  // consumables are thin, body panels are fat.
  const marginPct = category === "زيوت وسوائل" || category === "فلاتر"
    ? 0.12 + rnd() * 0.15
    : 0.2 + rnd() * 0.45;
  const wholesalePrice = money(purchasePrice * (1 + marginPct * 0.6));
  const retailPrice = money(purchasePrice * (1 + marginPct));
  const hasPieces = chance(0.25);
  products.push({
    id: `prod-${i + 1}`,
    code: `P-${String(i + 1).padStart(6, "0")}`,
    name: `${base} ${brand} ${pick(CAR_MAKES)}`,
    partNumber: `${brand.slice(0, 3).toUpperCase()}-${int(10000, 999999)}`,
    partBrand: brand,
    rackLocation: `${String.fromCharCode(65 + int(0, 11))}-${int(1, 40)}-${int(1, 8)}`,
    barcode: chance(0.7) ? String(6221000000000 + i) : undefined,
    category,
    unit: "قطعة",
    retailUnit: hasPieces ? "علبة" : undefined,
    piecesPerUnit: hasPieces ? pick([4, 6, 10, 12, 24]) : undefined,
    purchasePrice,
    avgCost: purchasePrice,
    wholesalePrice,
    retailPrice,
    quantity: 0,
    looseQuantity: hasPieces ? 0 : undefined,
    minStock: int(2, 25),
    hasExpiry: category === "زيوت وسوائل" && chance(0.5),
    supplierId: pick(suppliers).id,
    warrantyMonths: chance(0.35) ? pick([3, 6, 12, 24]) : undefined,
    condition: chance(0.9) ? "new" : pick(["used", "refurbished", "remanufactured"]),
    originCountry: pick(["ألمانيا", "اليابان", "الصين", "تركيا", "كوريا", "مصر"]),
    returnable: !(category === "كهرباء" && chance(0.4)),
    archived: chance(0.03),
    createdAt: isoAt(START + int(0, 400) * DAY),
  });
}
const productById = new Map(products.map((p) => [p.id, p]));
const sellable = products.filter((p) => !p.archived);

// ── Customers ────────────────────────────────────────────────────────────
const customers = [];
for (let i = 0; i < CONFIG.customers; i++) {
  const createdAt = START + Math.floor(Math.pow(rnd(), 0.7) * (END - START));
  customers.push({
    id: `cust-${i + 1}`,
    code: `C-${String(i + 1).padStart(6, "0")}`,
    name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
    phone: `01${pick([0, 1, 2, 5])}${int(10000000, 99999999)}`,
    address: `${pick(GOVERNORATES)} - ${int(1, 200)} ش ${pick(["الجمهورية", "النصر", "الهرم", "فيصل", "التحرير"])}`,
    creditLimit: chance(0.25) ? pick([5000, 10000, 20000, 50000]) : undefined,
    marketingConsent: pick(["unknown", "opted_in", "opted_out"]),
    archived: chance(0.02),
    createdAt: isoAt(createdAt),
  });
}
// Sorted by signup date so a sale can pick only from customers who already
// existed at that moment. Picking uniformly and then patching the exception
// (the first attempt here) still produced 15k invoices dated before their
// customer's own record, which is a state the real app can never reach and
// would make any "new vs returning customer" report nonsense.
const activeCustomers = customers
  .filter((c) => !c.archived)
  .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
const customerSignupMs = activeCustomers.map((c) => Date.parse(c.createdAt));

/** Index of the last customer who had signed up by `when`. */
function customersExistingAt(when) {
  let lo = 0, hi = customerSignupMs.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (customerSignupMs[mid] <= when) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

// ── Users (cashiers) ─────────────────────────────────────────────────────
const users = [
  { id: "user-owner", username: "admin", name: "المالك", role: "owner", active: true, createdAt: isoAt(START) },
];
for (let i = 1; i <= 6; i++) {
  users.push({
    id: `user-emp-${i}`, username: `cashier${i}`, name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
    role: "employee", active: i <= 5, createdAt: isoAt(START + i * 40 * DAY),
  });
}
const cashiers = users.filter((u) => u.role === "employee" && u.active);

// ── Purchases first: stock has to exist before anything can be sold ───────
// Each product gets an opening purchase, then restocks over time. avgCost is
// maintained as a true moving weighted average, because that is what the sale
// lines will quote as cost — and therefore what profit depends on.
const purchaseInvoices = [];
const stockMovements = [];
const purchaseCount = Math.max(1200, Math.floor(CONFIG.invoices * 0.12));
let purchaseSeq = 0;

function restock(product, qty, unitCost, when, invoiceId) {
  const prevQty = product.quantity;
  const prevCost = product.avgCost ?? product.purchasePrice;
  product.quantity = prevQty + qty;
  product.avgCost = prevQty + qty > 0
    ? money((prevQty * prevCost + qty * unitCost) / (prevQty + qty))
    : unitCost;
  stockMovements.push({
    id: `mv-p-${stockMovements.length + 1}`,
    productId: product.id, productName: product.name, type: "purchase",
    quantity: qty, referenceId: invoiceId, referenceType: "purchase", date: isoAt(when),
  });
}

// Opening stock, spread over the first two weeks.
for (let i = 0; i < sellable.length; i += 40) {
  const chunk = sellable.slice(i, i + 40);
  const when = START + int(0, 14) * DAY;
  const supplier = pick(suppliers);
  purchaseSeq++;
  const id = `pinv-${purchaseSeq}`;
  const lines = chunk.map((product, n) => {
    // Opening stock is deliberately modest. Restocking 10-120 units of every
    // one of 4000 parts left the shop holding 1.9bn EGP of inventory against
    // 345m of sales — a ratio no real business survives, and one that makes
    // the dead-stock and stock-value reports meaningless to eyeball.
    const qty = int(4, 26);
    const unitCost = product.purchasePrice;
    restock(product, qty, unitCost, when, id);
    return {
      id: `${id}-l${n + 1}`, productId: product.id, productName: product.name,
      partNumber: product.partNumber, partBrand: product.partBrand, unit: product.unit,
      quantity: qty, price: unitCost, costPrice: unitCost, subtotal: money(qty * unitCost),
    };
  });
  const total = money(lines.reduce((s, l) => s + l.subtotal, 0));
  purchaseInvoices.push({
    id, invoiceNumber: `PUR-${String(purchaseSeq).padStart(6, "0")}`, date: dateAt(when),
    supplierId: supplier.id, supplierName: supplier.name, lines, total,
    amountPaid: total, remaining: 0, status: "paid",
    branchId: "branch-main", createdAt: isoAt(when),
  });
}

// Ongoing restocks with a mix of payment states.
for (let i = 0; i < purchaseCount; i++) {
  const when = invoiceTimestamp(i, purchaseCount);
  const supplier = pick(suppliers);
  purchaseSeq++;
  const id = `pinv-${purchaseSeq}`;
  const lineCount = int(1, 12);
  const lines = [];
  for (let n = 0; n < lineCount; n++) {
    const product = pick(sellable);
    // Reorder quantities, not container loads: sized so that three years of
    // restocking roughly matches three years of selling, leaving a few months
    // of stock on the shelf rather than a warehouse nobody paid for.
    const qty = int(2, 14);
    // Supplier prices drift upward over the three years.
    const drift = 1 + ((when - START) / (END - START)) * 0.18;
    const unitCost = money(product.purchasePrice * drift * (0.94 + rnd() * 0.12));
    restock(product, qty, unitCost, when, id);
    lines.push({
      id: `${id}-l${n + 1}`, productId: product.id, productName: product.name,
      partNumber: product.partNumber, partBrand: product.partBrand, unit: product.unit,
      quantity: qty, price: unitCost, costPrice: unitCost, subtotal: money(qty * unitCost),
    });
  }
  const total = money(lines.reduce((s, l) => s + l.subtotal, 0));
  const roll = rnd();
  const amountPaid = roll < 0.7 ? total : roll < 0.92 ? money(total * (0.2 + rnd() * 0.6)) : 0;
  purchaseInvoices.push({
    id, invoiceNumber: `PUR-${String(purchaseSeq).padStart(6, "0")}`, date: dateAt(when),
    supplierId: supplier.id, supplierName: supplier.name, lines, total,
    amountPaid, remaining: money(total - amountPaid),
    status: amountPaid >= total ? "paid" : amountPaid > 0 ? "partial" : "unpaid",
    branchId: pick(branches).id, createdAt: isoAt(when),
  });
}

// ── Cashier shifts ───────────────────────────────────────────────────────
// One shift per cashier per working day, so invoices can be attributed and the
// shift reconciliation report has something real to reconcile.
const shifts = [];
let shiftSeq = 0;
const shiftByDay = new Map();
for (let t = START; t < END; t += DAY) {
  if (new Date(t).getUTCDay() === 5) continue;
  const cashier = cashiers[Math.floor((t / DAY) % cashiers.length)];
  shiftSeq++;
  const shift = {
    id: `shift-${shiftSeq}`, shiftNumber: shiftSeq,
    cashierId: cashier.id, cashierName: cashier.name, cashierUsername: cashier.username,
    openedAt: isoAt(t + 9 * 3600 * 1000), closedAt: isoAt(t + 21 * 3600 * 1000),
    status: "closed", openingCash: 2000, expectedCash: 2000,
    totalSalesCount: 0, totalSalesAmount: 0, totalCashSales: 0, totalVisaSales: 0,
    totalCreditSales: 0, paymentMethodTotals: {}, totalRefunds: 0, totalExpenses: 0,
    salesInvoiceIds: [], branchId: "branch-main", branchName: "الفرع الرئيسي",
  };
  shifts.push(shift);
  shiftByDay.set(dateAt(t), shift);
}

// ── Sales ────────────────────────────────────────────────────────────────
const salesInvoices = [];
const salesReturns = [];
const warrantyClaims = [];
const customerVehicles = [];
let salesSeq = 0;
let returnSeq = 0;
const PAYMENT_METHODS = ["cash", "visa", "bank", "vodafone_cash", "instapay"];

for (let i = 0; i < CONFIG.invoices; i++) {
  const when = invoiceTimestamp(i, CONFIG.invoices);
  // Only customers who already existed can buy. Weighted towards recent
  // signups, which is how a real shop behaves — new customers buy soon after
  // registering, and a long tail keeps coming back.
  const existing = customersExistingAt(when);
  if (existing < 0) continue;
  const bias = chance(0.6) ? Math.pow(rnd(), 0.4) : rnd();
  const customer = activeCustomers[Math.min(existing, Math.floor(bias * (existing + 1)))];
  salesSeq++;
  const id = `sinv-${salesSeq}`;
  const priceType = chance(0.3) ? "wholesale" : "retail";
  // Most counter sales are one or two items; a workshop order is bigger. A
  // flat 1-8 made every invoice a large order.
  const lineCount = chance(0.65) ? int(1, 2) : chance(0.8) ? int(3, 5) : int(6, 12);
  const lines = [];
  for (let n = 0; n < lineCount; n++) {
    const product = pick(sellable);
    if (product.quantity <= 0) continue;
    // Quantity follows the part: you buy one battery, four brake pads, and a
    // workshop might take a dozen filters.
    const typical = product.category === "إطارات" ? int(1, 4)
      : product.category === "بطاريات" ? 1
      : product.category === "فلاتر" || product.category === "زيوت وسوائل" ? int(1, 6)
      : int(1, 3);
    const qty = Math.max(1, Math.min(typical, product.quantity));
    const unitPrice = priceType === "wholesale" ? product.wholesalePrice : product.retailPrice;
    // Cost quoted on the line is the product's weighted-average cost *at this
    // moment*, which is exactly what the profit report will later recompute.
    const costPrice = product.avgCost ?? product.purchasePrice;
    product.quantity -= qty;
    stockMovements.push({
      id: `mv-s-${stockMovements.length + 1}`,
      productId: product.id, productName: product.name, type: "sale",
      quantity: qty, referenceId: id, referenceType: "sale", date: isoAt(when),
    });
    lines.push({
      id: `${id}-l${n + 1}`, productId: product.id, productName: product.name,
      partNumber: product.partNumber, partBrand: product.partBrand, unit: product.unit,
      quantity: qty, price: unitPrice, priceType, costPrice,
      warrantyMonths: product.warrantyMonths,
      subtotal: money(qty * unitPrice),
    });
  }
  if (lines.length === 0) continue;

  const gross = money(lines.reduce((s, l) => s + l.subtotal, 0));
  const discount = chance(0.18) ? money(gross * (0.02 + rnd() * 0.08)) : 0;
  const total = money(gross - discount);
  const onAccount = chance(0.22);
  const paymentType = onAccount ? "account" : "cash";
  const paymentMethod = onAccount ? undefined : pick(PAYMENT_METHODS);
  const roll = rnd();
  const amountReceived = onAccount
    ? (roll < 0.35 ? 0 : roll < 0.75 ? money(total * (0.2 + rnd() * 0.6)) : total)
    : total;
  const cancelled = chance(0.015);
  const shift = shiftByDay.get(dateAt(when));

  const invoice = {
    id, invoiceNumber: `INV-${String(salesSeq).padStart(6, "0")}`, date: dateAt(when),
    customerId: customer.id, customerName: customer.name,
    lines, total, discount: discount || undefined,
    amountReceived, remaining: money(total - amountReceived),
    paymentType, paymentMethod, priceType,
    paymentDueDate: onAccount ? dateAt(when + int(7, 60) * DAY) : undefined,
    status: amountReceived >= total ? "paid" : amountReceived > 0 ? "partial" : "unpaid",
    cancelled: cancelled || undefined,
    deliveryMethod: chance(0.12) ? pick(["branch_driver", "shipping_company"]) : "pickup",
    branchId: pick(branches).id,
    createdByUserId: shift ? shift.cashierId : "user-owner",
    shiftId: shift ? shift.id : undefined,
    createdAt: isoAt(when),
  };
  salesInvoices.push(invoice);

  if (shift && !cancelled) {
    shift.totalSalesCount++;
    shift.totalSalesAmount = money(shift.totalSalesAmount + total);
    shift.salesInvoiceIds.push(id);
    if (onAccount) shift.totalCreditSales = money(shift.totalCreditSales + total);
    else if (paymentMethod === "cash") shift.totalCashSales = money(shift.totalCashSales + amountReceived);
    else {
      shift.paymentMethodTotals[paymentMethod] =
        money((shift.paymentMethodTotals[paymentMethod] || 0) + amountReceived);
    }
  }

  // A vehicle on some invoices, so the parts-fitment and vehicle screens have data.
  if (chance(0.2)) {
    customerVehicles.push({
      id: `veh-${customerVehicles.length + 1}`, customerId: customer.id,
      make: pick(CAR_MAKES), model: `موديل ${int(1, 9)}`, year: int(2005, 2025),
      plateNumber: `${int(100, 999)} ${pick(["أ ب ج", "س ص ط", "ر ز و"])}`,
      createdAt: isoAt(when),
    });
  }

  // Returns: only against non-cancelled invoices, only returnable products,
  // and never more than was sold.
  if (!cancelled && chance(0.05)) {
    const returnable = lines.filter((l) => productById.get(l.productId)?.returnable !== false);
    if (returnable.length > 0) {
      const when2 = Math.min(END - DAY, when + int(1, 25) * DAY);
      returnSeq++;
      const rlines = returnable.slice(0, int(1, returnable.length)).map((l, n) => {
        const qty = int(1, l.quantity);
        const product = productById.get(l.productId);
        if (product) {
          product.quantity += qty;
          stockMovements.push({
            id: `mv-r-${stockMovements.length + 1}`,
            productId: product.id, productName: product.name, type: "return",
            quantity: qty, referenceId: `sret-${returnSeq}`, referenceType: "sale",
            date: isoAt(when2),
          });
        }
        return {
          id: `sret-${returnSeq}-l${n + 1}`, sourceLineId: l.id, productId: l.productId,
          productName: l.productName, unit: l.unit, quantity: qty, price: l.price,
          priceType: l.priceType, subtotal: money(qty * l.price),
        };
      });
      salesReturns.push({
        id: `sret-${returnSeq}`, returnNumber: `SR-${String(returnSeq).padStart(6, "0")}`,
        date: dateAt(when2), originalInvoiceId: id, originalInvoiceNumber: invoice.invoiceNumber,
        customerId: customer.id, customerName: customer.name, lines: rlines,
        total: money(rlines.reduce((s, l) => s + l.subtotal, 0)),
        refundCash: chance(0.6), createdAt: isoAt(when2),
      });
    }
  }

  // Warranty claims against lines that actually carry a warranty.
  if (!cancelled && chance(0.02)) {
    const warranted = lines.filter((l) => l.warrantyMonths);
    if (warranted.length > 0) {
      const line = pick(warranted);
      const opened = Math.min(END - DAY, when + int(5, line.warrantyMonths * 30) * DAY);
      const status = pick(["open", "under_review", "approved", "replaced", "rejected", "compensated"]);
      warrantyClaims.push({
        id: `wc-${warrantyClaims.length + 1}`, invoiceId: id, invoiceNumber: invoice.invoiceNumber,
        invoiceLineId: line.id, customerId: customer.id, customerName: customer.name,
        productId: line.productId, productName: line.productName,
        supplierId: productById.get(line.productId)?.supplierId,
        complaint: pick(["عطل بعد فترة قصيرة", "صوت غير طبيعي", "تسريب", "لا يعمل نهائيًا", "اهتزاز"]),
        status,
        stockDeducted: status === "replaced" ? true : undefined,
        replacementCost: status === "replaced" ? line.costPrice : undefined,
        compensationAmount: status === "compensated" ? money(line.price * 0.7) : undefined,
        openedAt: isoAt(opened), updatedAt: isoAt(Math.min(END - DAY, opened + int(1, 20) * DAY)),
      });
    }
  }
}

// ── Purchase returns ─────────────────────────────────────────────────────
const purchaseReturns = [];
for (let i = 0; i < Math.floor(purchaseInvoices.length * 0.03); i++) {
  const source = pick(purchaseInvoices);
  const when = Math.min(END - DAY, Date.parse(source.createdAt) + int(2, 30) * DAY);
  const lines = source.lines.slice(0, int(1, Math.min(3, source.lines.length))).map((l, n) => {
    const qty = Math.max(1, Math.floor(l.quantity * 0.2));
    const product = productById.get(l.productId);
    if (product) product.quantity = Math.max(0, product.quantity - qty);
    return {
      id: `pret-${i + 1}-l${n + 1}`, sourceLineId: l.id, productId: l.productId,
      productName: l.productName, unit: l.unit, quantity: qty, price: l.price,
      subtotal: money(qty * l.price),
    };
  });
  purchaseReturns.push({
    id: `pret-${i + 1}`, returnNumber: `PR-${String(i + 1).padStart(6, "0")}`,
    date: dateAt(when), originalInvoiceId: source.id, originalInvoiceNumber: source.invoiceNumber,
    supplierId: source.supplierId, supplierName: source.supplierName, lines,
    total: money(lines.reduce((s, l) => s + l.subtotal, 0)), createdAt: isoAt(when),
  });
}

// ── Expenses / cash entries ──────────────────────────────────────────────
const cashEntries = [];
const EXPENSE_KINDS = ["إيجار", "كهرباء ومياه", "رواتب", "صيانة", "مواصلات", "دعاية", "أدوات"];
for (let t = START; t < END; t += DAY) {
  if (chance(0.35)) {
    cashEntries.push({
      id: `cash-${cashEntries.length + 1}`, type: "expense",
      amount: money(int(50, 4000) + rnd()), category: pick(EXPENSE_KINDS),
      note: `مصروف ${pick(EXPENSE_KINDS)}`, date: dateAt(t), createdAt: isoAt(t),
    });
  }
}

// ── Assemble ─────────────────────────────────────────────────────────────
const settings = {
  shopName: "معرض هيلبرز لقطع غيار السيارات",
  currency: "ج.م",
  phone: "01118445625",
  address: "القاهرة - مدينة نصر",
  lowStockThreshold: 10,
  duesReminderDays: 7,
};

const dataset = {
  products, customers, suppliers, users, branches,
  salesInvoices, purchaseInvoices, salesReturns, purchaseReturns,
  stockMovements, shifts, warrantyClaims, customerVehicles, cashEntries,
  settings,
  nextProductCode: products.length + 1,
  nextCustomerCode: customers.length + 1,
  nextSupplierCode: suppliers.length + 1,
};

const json = JSON.stringify(dataset);
fs.writeFileSync(CONFIG.out, json);

const mb = (json.length / 1024 / 1024).toFixed(1);
console.error(`
wrote ${CONFIG.out} (${mb} MB)
  products          ${products.length}
  customers         ${customers.length}
  suppliers         ${suppliers.length}
  sales invoices    ${salesInvoices.length}
  purchase invoices ${purchaseInvoices.length}
  sales returns     ${salesReturns.length}
  purchase returns  ${purchaseReturns.length}
  stock movements   ${stockMovements.length}
  cashier shifts    ${shifts.length}
  warranty claims   ${warrantyClaims.length}
  customer vehicles ${customerVehicles.length}
  cash entries      ${cashEntries.length}
`);
