"use strict";

/**
 * Generates a realistic multi-year shop history for load and correctness
 * testing: customers, sales and purchase invoices, returns, warranty claims,
 * credit sales, cashier shifts, stock movements, expenses — and the whole
 * second half of the product: branches, price tiers, drivers, shipping,
 * quotations, stocktakes, payroll, the vehicle catalogue and fitments.
 *
 * Three rules shape everything here:
 *
 * 1. The numbers have to be *arithmetically consistent*, not merely present.
 *    A dataset where profit does not equal revenue minus cost proves nothing
 *    when the reports are later checked against it — the checker would be
 *    validating the generator's mistakes. So stock is tracked as invoices are
 *    emitted, costs come from the purchases that actually supplied the sale,
 *    and every total is computed rather than invented.
 *
 * 2. It has to be *chronologically* consistent. This is stronger than "every
 *    record has a date", and it is where the previous version failed: it built
 *    all purchases first, then all sales, so a sale on day 10 could consume
 *    stock delivered on day 500. Replayed in date order the ledger went
 *    negative for 1,533 products. Invoices also predated their own customer,
 *    their branch and their cashier, and fell outside the shift they were
 *    attributed to.
 *
 *    The fix is structural, not a patch: there is now ONE loop over the
 *    calendar, and a record can only be created on a day when everything it
 *    refers to already exists. Anything caused by an event but happening later
 *    — a return, a warranty claim, a supplier payment — is put on a deferred
 *    queue keyed by the day it lands on. Stock is therefore always the true
 *    on-hand quantity at that instant, and a sale can never take more than is
 *    on the shelf.
 *
 * 3. It has to be deterministic. A load test that generates different data on
 *    each run cannot be used to compare a slow build against a fast one, and a
 *    failure that cannot be reproduced cannot be fixed. Hence the seeded PRNG
 *    below and no use of Date.now()/Math.random() anywhere.
 *
 * Every quantity change goes through applyStock(), which is the only way a
 * product's quantity moves — so the ledger reconstructs the final stock by
 * construction rather than by luck.
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

/** The makes this market actually runs, with the models a counter is asked for. */
const VEHICLE_CATALOG_SEED = [
  ["Toyota", "تويوتا", "toyota", ["Corolla", "Yaris", "Hilux", "Land Cruiser", "Camry"]],
  ["Hyundai", "هيونداي", "hyundai", ["Accent", "Elantra", "Tucson", "Verna", "i10"]],
  ["Kia", "كيا", "kia", ["Cerato", "Sportage", "Picanto", "Rio", "Sorento"]],
  ["Nissan", "نيسان", "nissan", ["Sunny", "Sentra", "Qashqai", "Juke"]],
  ["Chevrolet", "شيفروليه", "chevrolet", ["Optra", "Aveo", "Lanos", "Captiva"]],
  ["Volkswagen", "فولكس فاجن", "volkswagen", ["Golf", "Passat", "Polo", "Tiguan"]],
  ["Skoda", "سكودا", "skoda", ["Octavia", "Fabia", "Rapid", "Superb"]],
  ["Renault", "رينو", "renault", ["Logan", "Duster", "Megane", "Sandero"]],
  ["Peugeot", "بيجو", "peugeot", ["301", "208", "3008", "508"]],
  ["Mitsubishi", "ميتسوبيشي", "mitsubishi", ["Lancer", "Pajero", "Attrage", "Eclipse Cross"]],
  ["Honda", "هوندا", "honda", ["Civic", "Accord", "CR-V"]],
  ["Chery", "شيري", "chery", ["Tiggo", "Arrizo", "Envy"]],
  ["Geely", "جيلي", "geely", ["Emgrand", "Coolray", "Azkarra"]],
  ["MG", "ام جي", "mg", ["MG5", "MG6", "ZS", "RX5"]],
];
const CAR_MAKES = VEHICLE_CATALOG_SEED.map(([, nameAr]) => nameAr);

const FIRST_NAMES = ["أحمد", "محمد", "محمود", "مصطفى", "خالد", "عمرو", "طارق", "هاني",
  "سامح", "وليد", "ياسر", "إبراهيم", "علي", "حسن", "كريم", "شريف", "أيمن", "رامي"];
const LAST_NAMES = ["عبد الله", "السيد", "حسن", "علي", "إبراهيم", "منصور", "الشريف",
  "عبد العزيز", "فتحي", "زكي", "رمضان", "صلاح", "نبيل", "فؤاد"];
const GOVERNORATES = ["القاهرة", "الجيزة", "الإسكندرية", "القليوبية", "الشرقية",
  "الدقهلية", "البحيرة", "المنوفية", "الغربية", "أسيوط", "المنيا", "سوهاج"];
const SUPPLIER_NAMES = ["الشركة المصرية لقطع الغيار", "مؤسسة النصر للتجارة",
  "الدولية لاستيراد قطع السيارات", "مجموعة الأهرام للقطع", "شركة الوفاء",
  "التوكيلات المتحدة", "بيت القطع الأصلية", "الصفوة لقطع الغيار"];

// Enum values, copied from src/types so a drift shows up as a failing
// invariant rather than as a fixture the app silently mis-renders.
const SALES_PAYMENT_METHODS = ["cash", "card", "instapay", "vodafone", "bank"];
const WARRANTY_STATUSES = ["open", "inspecting", "supplier", "approved", "rejected", "replaced", "compensated"];
const PART_ALTERNATIVE_RELATIONS = ["equivalent", "economy", "premium", "superseded"];
const DELIVERY_ORDER_STATUSES = ["delivered", "in_transit", "assigned", "ready", "returned"];

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
const DAY = 24 * 3600 * 1000;
const TOTAL_DAYS = Math.round(CONFIG.years * 365);
const START = END - TOTAL_DAYS * DAY;
const HOUR = 3600 * 1000;
/** Trading hours; every shift and every sale lives inside this window. */
const OPEN_HOUR = 9;
const CLOSE_HOUR = 21;

function isoAt(ms) {
  return new Date(ms).toISOString();
}
function dateAt(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}
function monthAt(ms) {
  return new Date(ms).toISOString().slice(0, 7);
}
const dayStart = (dayIndex) => START + dayIndex * DAY;
/** Friday is the weekly day off in this market. */
const isClosedDay = (ms) => new Date(ms).getUTCDay() === 5;
/** A moment inside the trading day, so shift attribution is always valid. */
function timeInTradingDay(ms, fraction = rnd()) {
  return ms + Math.floor((OPEN_HOUR + fraction * (CLOSE_HOUR - OPEN_HOUR)) * HOUR);
}

// ── The intra-day clock ──────────────────────────────────────────────────
//
// Events inside a day used to be stamped at a RANDOM hour, which quietly broke
// the thing the whole chronological rewrite exists to guarantee. A restock
// generated before a sale — and therefore supplying it — could land at 18:00
// while the sale it supplied landed at 10:00. Replayed in date order the sale
// came first and the ledger went negative.
//
// So the day has a clock that only moves forward: every event asks for the
// next slot, and the slots are spread across trading hours. Generation order
// and timestamp order are then the same thing by construction.
let dayClockMs = 0;
let dayClockStepMs = 0;
let dayClockLimitMs = 0;

function beginTradingDay(midnight, expectedEvents) {
  dayClockMs = midnight + OPEN_HOUR * HOUR;
  dayClockLimitMs = midnight + CLOSE_HOUR * HOUR - 1000;
  const window = (CLOSE_HOUR - OPEN_HOUR) * HOUR;
  dayClockStepMs = Math.max(1, Math.floor(window / Math.max(1, expectedEvents + 1)));
}

/** The next slot in the trading day. Never returns the same instant twice. */
function nextEventTime() {
  const at = Math.min(dayClockMs, dayClockLimitMs);
  dayClockMs = Math.min(dayClockMs + dayClockStepMs, dayClockLimitMs);
  return at;
}

console.error(`generating: ${CONFIG.years}y, ${CONFIG.customers} customers, ` +
  `${CONFIG.invoices} invoices, ${CONFIG.products} products`);

// ── Reference data ───────────────────────────────────────────────────────

const branches = [
  { id: "branch-main", code: "BR-001", name: "الفرع الرئيسي", isMain: true, active: true,
    address: "القاهرة - مدينة نصر", phone: "0221234567", createdAt: isoAt(START) },
  { id: "branch-giza", code: "BR-002", name: "فرع الجيزة", isMain: false, active: true,
    address: "الجيزة - فيصل", phone: "0233214567",
    createdAt: isoAt(START + Math.floor(TOTAL_DAYS * 0.18) * DAY) },
  { id: "branch-alex", code: "BR-003", name: "فرع الإسكندرية", isMain: false, active: true,
    address: "الإسكندرية - سموحة", phone: "0341234567",
    createdAt: isoAt(START + Math.floor(TOTAL_DAYS * 0.45) * DAY) },
];
const branchOpenedMs = branches.map((branch) => Date.parse(branch.createdAt));
/** Only branches that had opened by `when` can appear on a record dated `when`. */
function branchesOpenAt(when) {
  return branches.filter((_, index) => branchOpenedMs[index] <= when);
}

// Suppliers: the shop opened with most of them and added a few along the way.
const suppliers = [];
for (let i = 0; i < CONFIG.suppliers; i++) {
  // Two thirds predate the first purchase, because a shop does not open with
  // no supplier at all; the rest are onboarded during the first year.
  const createdAt = i < CONFIG.suppliers * 0.66
    ? START
    : START + int(1, Math.min(330, TOTAL_DAYS - 1)) * DAY;
  suppliers.push({
    id: `sup-${i + 1}`,
    code: `SUP-${String(i + 1).padStart(4, "0")}`,
    name: i < SUPPLIER_NAMES.length ? SUPPLIER_NAMES[i] : `${pick(SUPPLIER_NAMES)} ${i + 1}`,
    phone: `010${int(10000000, 99999999)}`,
    address: `${pick(GOVERNORATES)} - ${int(1, 99)} ش التجارة`,
    balance: 0,
    createdAt: isoAt(createdAt),
  });
}
const supplierCreatedMs = suppliers.map((supplier) => Date.parse(supplier.createdAt));
function suppliersExistingAt(when) {
  return suppliers.filter((_, index) => supplierCreatedMs[index] <= when);
}

// ── Users ────────────────────────────────────────────────────────────────
// The verifier requires a real authenticated-user shape: a password hash and a
// permission object. A fixture whose users cannot sign in is not a fixture of
// this application.
const PERMISSION_GROUPS = {
  pos: ["view", "createSale", "openShift", "closeShift", "viewShifts", "holdCart", "applyDiscount"],
  products: ["view", "add", "edit", "printBarcode"],
  inventory: ["view", "adjust", "stocktakes", "transfers"],
  purchaseInvoices: ["view", "add", "pay", "purchasingAssistant"],
  salesInvoices: ["view", "add", "edit", "receive"],
  customers: ["view", "add", "edit"],
  suppliers: ["view", "add", "edit"],
  drivers: ["view", "add", "edit"],
  returns: ["view", "add"],
  alerts: ["view"],
  cashbox: ["view", "add"],
  reports: ["view"],
};
function employeePermissions() {
  const permissions = {};
  for (const [group, actions] of Object.entries(PERMISSION_GROUPS)) {
    permissions[group] = {};
    for (const action of actions) permissions[group][action] = true;
  }
  return permissions;
}
/** Not a real Argon2 hash — a stable placeholder of the right shape and length. */
const PLACEHOLDER_HASH = "$argon2id$v=19$m=19456,t=2,p=1$bG9hZHRlc3RzYWx0MDAwMA$" +
  "bG9hZHRlc3RmaXh0dXJlaGFzaHBsYWNlaG9sZGVyMDAwMDAwMDA";

const users = [
  {
    id: "user-owner", username: "admin", name: "المالك", role: "owner", active: true,
    passwordHash: PLACEHOLDER_HASH, permissions: employeePermissions(),
    createdAt: isoAt(START),
  },
];
for (let i = 1; i <= 6; i++) {
  users.push({
    id: `user-emp-${i}`,
    username: `cashier${i}`,
    name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
    role: "employee",
    active: i <= 5,
    passwordHash: PLACEHOLDER_HASH,
    permissions: employeePermissions(),
    monthlySalary: pick([6000, 7500, 9000]),
    salesCommissionPct: pick([0, 0.5, 1]),
    // The first two are there from day one; the rest are hired as the shop grows.
    createdAt: isoAt(i <= 2 ? START : START + Math.floor(TOTAL_DAYS * (i - 2) * 0.12) * DAY),
  });
}
const cashiers = users.filter((user) => user.role === "employee" && user.active);
const cashierHiredMs = cashiers.map((user) => Date.parse(user.createdAt));
function cashiersOnDuty(when) {
  return cashiers.filter((_, index) => cashierHiredMs[index] <= when);
}

// ── Price tiers, drivers, shipping, payroll ──────────────────────────────
const priceTiers = [
  { id: "tier-retail", name: "تجزئة", basis: "retail", adjustmentPct: 0, minMarginPct: 10,
    isDefault: true, active: true, createdAt: isoAt(START) },
  { id: "tier-wholesale", name: "جملة", basis: "wholesale", adjustmentPct: 0, minMarginPct: 6,
    active: true, createdAt: isoAt(START) },
  { id: "tier-workshop", name: "ورش ومراكز صيانة", basis: "wholesale", adjustmentPct: -3,
    minMarginPct: 4, active: true, createdAt: isoAt(START + 90 * DAY) },
];

const drivers = [];
for (let i = 1; i <= 8; i++) {
  drivers.push({
    id: `drv-${i}`,
    name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
    phone: `011${int(10000000, 99999999)}`,
    licenseNumber: `DL-${int(100000, 999999)}`,
    salary: pick([4500, 5200, 6000]),
    createdAt: isoAt(START + int(0, Math.min(200, TOTAL_DAYS - 1)) * DAY),
  });
}

const shippingProviders = [
  { id: "ship-inhouse", name: "توصيل داخلي (سائقو المحل)", kind: "manual", active: true,
    supportsCashOnDelivery: true, phone: "01118445625",
    createdAt: isoAt(START), updatedAt: isoAt(START) },
  { id: "ship-bosta", name: "Bosta", kind: "bosta", active: true, supportsCashOnDelivery: true,
    trackingUrlTemplate: "https://bosta.co/tracking-shipments?shipmentId={tracking}",
    createdAt: isoAt(START + 120 * DAY), updatedAt: isoAt(START + 120 * DAY) },
  { id: "ship-express", name: "الشحن السريع", kind: "manual", active: true,
    supportsCashOnDelivery: false,
    createdAt: isoAt(START + 260 * DAY), updatedAt: isoAt(START + 260 * DAY) },
];
const shippingRates = [];
for (const provider of shippingProviders) {
  for (const governorate of GOVERNORATES) {
    const near = governorate === "القاهرة" || governorate === "الجيزة" || governorate === "القليوبية";
    shippingRates.push({
      id: `rate-${provider.id}-${shippingRates.length + 1}`,
      providerId: provider.id,
      governorate,
      fee: near ? int(35, 60) : int(65, 120),
      cashOnDeliveryFee: provider.supportsCashOnDelivery ? int(5, 20) : undefined,
      returnFee: int(15, 40),
      estimatedDaysMin: near ? 1 : 2,
      estimatedDaysMax: near ? 2 : 4,
      active: true,
      createdAt: provider.createdAt,
      updatedAt: provider.createdAt,
    });
  }
}

const offlineEmployees = [];
for (let i = 1; i <= 6; i++) {
  offlineEmployees.push({
    id: `off-emp-${i}`,
    name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
    idNumber: String(28000000000000 + int(1000000, 9999999)),
    basicSalary: pick([4000, 4800, 5500, 6500]),
    jobTitle: pick(["فني", "عامل مخزن", "سائق", "أمن", "محاسب مساعد"]),
    phone: `012${int(10000000, 99999999)}`,
    createdAt: isoAt(START + int(0, Math.min(240, TOTAL_DAYS - 1)) * DAY),
  });
}

// ── Vehicle catalogue ────────────────────────────────────────────────────
const vehicleMakes = [];
const vehicleModels = [];
const vehicleGenerations = [];
const vehicleEngines = [];
for (const [name, nameAr, slug, models] of VEHICLE_CATALOG_SEED) {
  const makeId = `vmake-${slug}`;
  vehicleMakes.push({
    id: makeId, name, nameAr, slug, logoPath: `./vehicle-logos/${slug}.png`,
    active: true, source: "load-test", createdAt: isoAt(START),
  });
  for (const model of models) {
    const modelId = `vmodel-${slug}-${model.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    vehicleModels.push({
      id: modelId, makeId, name: model, active: true, source: "load-test",
      createdAt: isoAt(START),
    });
    // Two or three generations with real, non-overlapping production windows,
    // because the year picker and the fitment matcher both read them.
    const windows = [[1998, 2006], [2007, 2016], [2017, null]];
    for (let g = 0; g < windows.length; g++) {
      if (g > 0 && chance(0.15)) continue;
      const [yearFrom, yearTo] = windows[g];
      const generationId = `vgen-${modelId}-${g + 1}`;
      vehicleGenerations.push({
        id: generationId, modelId, name: `${model} ${["I", "II", "III"][g]}`,
        yearFrom, yearTo: yearTo ?? undefined,
        bodyTypes: [pick(["سيدان", "هاتشباك", "SUV", "بيك أب"])],
        active: true, createdAt: isoAt(START),
      });
      const engineCount = int(1, 3);
      for (let e = 0; e < engineCount; e++) {
        const capacity = pick([1000, 1300, 1500, 1600, 1800, 2000, 2400]);
        vehicleEngines.push({
          id: `veng-${generationId}-${e + 1}`, generationId,
          name: `${(capacity / 1000).toFixed(1)}L`,
          code: `${slug.slice(0, 2).toUpperCase()}${capacity}`,
          capacityCc: capacity,
          fuelType: chance(0.9) ? "petrol" : "diesel",
          powerHp: Math.round(capacity / 12) + int(-8, 12),
          active: true, createdAt: isoAt(START),
        });
      }
    }
  }
}
const generationsByModel = new Map();
for (const generation of vehicleGenerations) {
  const list = generationsByModel.get(generation.modelId) ?? [];
  list.push(generation);
  generationsByModel.set(generation.modelId, list);
}
const enginesByGeneration = new Map();
for (const engine of vehicleEngines) {
  const list = enginesByGeneration.get(engine.generationId) ?? [];
  list.push(engine);
  enginesByGeneration.set(engine.generationId, list);
}
const modelsByMake = new Map();
for (const model of vehicleModels) {
  const list = modelsByMake.get(model.makeId) ?? [];
  list.push(model);
  modelsByMake.set(model.makeId, list);
}

// ── Products ─────────────────────────────────────────────────────────────
const products = [];
for (let i = 0; i < CONFIG.products; i++) {
  const category = pick(CATEGORIES);
  const base = pick(PART_NAMES[category]);
  const brand = pick(BRANDS);
  // Price bands taken from what these categories actually cost in this market.
  // Drawing uniformly from 40-6000 EGP produced an average invoice of ~109,000
  // EGP, a figure that makes every report in the load test unreadable.
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
  // Three quarters of the catalogue exists on opening day; the rest is added
  // as the shop takes on new lines. Nothing may be bought or sold before this.
  const createdAtMs = i < CONFIG.products * 0.75
    ? START
    : START + int(1, Math.max(1, TOTAL_DAYS - 30)) * DAY;
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
    reorderQuantity: chance(0.4) ? int(5, 40) : undefined,
    hasExpiry: category === "زيوت وسوائل" && chance(0.5),
    supplierId: undefined, // assigned below from a supplier that already exists
    warrantyMonths: chance(0.35) ? pick([3, 6, 12, 24]) : undefined,
    qualityGrade: pick(["genuine", "oem", "aftermarket-premium", "aftermarket-economy"]),
    condition: chance(0.9) ? "new" : pick(["used", "remanufactured"]),
    originCountry: pick(["DE", "JP", "CN", "TR", "KR", "EG"]),
    returnable: !(category === "كهرباء" && chance(0.4)),
    archived: chance(0.03),
    createdAt: isoAt(createdAtMs),
  });
  const eligible = suppliersExistingAt(createdAtMs);
  products[i].supplierId = (eligible.length ? pick(eligible) : suppliers[0]).id;
}
const productById = new Map(products.map((product) => [product.id, product]));
// Sorted by creation so the day loop can reveal them with a moving pointer.
const productsByCreation = products
  .slice()
  .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

// ── Fitments and alternatives ────────────────────────────────────────────
const productFitments = [];
const productAlternatives = [];
for (const product of products) {
  if (chance(0.35)) continue; // not every line is catalogued against a car
  const fitmentCount = int(1, 3);
  for (let f = 0; f < fitmentCount; f++) {
    const make = pick(vehicleMakes);
    const models = modelsByMake.get(make.id) ?? [];
    const model = models.length && chance(0.85) ? pick(models) : undefined;
    const generations = model ? generationsByModel.get(model.id) ?? [] : [];
    const generation = generations.length && chance(0.7) ? pick(generations) : undefined;
    const engines = generation ? enginesByGeneration.get(generation.id) ?? [] : [];
    const engine = engines.length && chance(0.4) ? pick(engines) : undefined;
    productFitments.push({
      id: `fit-${productFitments.length + 1}`,
      productId: product.id,
      makeId: make.id,
      modelId: model?.id,
      generationId: generation?.id,
      engineId: engine?.id,
      yearFrom: generation?.yearFrom,
      yearTo: generation?.yearTo,
      createdAt: product.createdAt,
    });
  }
}
for (let i = 0; i < Math.floor(CONFIG.products * 0.4); i++) {
  const product = pick(products);
  const alternative = pick(products);
  if (product.id === alternative.id) continue;
  productAlternatives.push({
    id: `alt-${productAlternatives.length + 1}`,
    productId: product.id,
    alternativeProductId: alternative.id,
    relation: pick(PART_ALTERNATIVE_RELATIONS),
    // The later of the two creation dates: the link cannot predate either part.
    createdAt: Date.parse(product.createdAt) >= Date.parse(alternative.createdAt)
      ? product.createdAt : alternative.createdAt,
  });
}

// ── Customers ────────────────────────────────────────────────────────────
const customers = [];
for (let i = 0; i < CONFIG.customers; i++) {
  const createdAt = START + Math.floor(Math.pow(rnd(), 0.7) * (END - START - DAY));
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
// still produced 15k invoices dated before their customer's own record, which
// is a state the real app can never reach and would make any "new vs returning
// customer" report nonsense.
const activeCustomers = customers
  .filter((customer) => !customer.archived)
  .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
const customerSignupMs = activeCustomers.map((customer) => Date.parse(customer.createdAt));

// ── The ledger ───────────────────────────────────────────────────────────
//
// applyStock is the ONLY way a product's quantity changes. Every caller
// therefore leaves behind the movement that explains the change, which is what
// makes "the ledger reconstructs the final stock" true by construction instead
// of by accident.
const stockMovements = [];
/** Units sitting on the shelf right now, summed across the catalogue. */
let totalOnHand = 0;
/** Units sold so far, used to size restocking against real demand. */
let unitsSoldTotal = 0;
function applyStock(product, delta, { type, referenceId, referenceType, when, reason }) {
  if (delta === 0) return 0;
  // Never let a movement drive stock below zero: that state cannot be reached
  // in the app and would poison the chronological replay check.
  const applied = delta < 0 ? -Math.min(-delta, product.quantity) : delta;
  if (applied === 0) return 0;
  if (applied > 0) {
    const previousQty = product.quantity;
    const previousCost = product.avgCost ?? product.purchasePrice;
    const unitCost = reason?.unitCost ?? previousCost;
    product.avgCost = previousQty + applied > 0
      ? money((previousQty * previousCost + applied * unitCost) / (previousQty + applied))
      : unitCost;
  }
  product.quantity += applied;
  totalOnHand += applied;
  stockMovements.push({
    id: `mv-${stockMovements.length + 1}`,
    productId: product.id,
    productName: product.name,
    type,
    // Signed, matching what the app writes (see addSalesInvoice in AppContext).
    quantity: applied,
    referenceId,
    referenceType,
    date: isoAt(when),
  });
  return applied;
}

// ── Collections filled by the day loop ───────────────────────────────────
const purchaseInvoices = [];
const purchaseReturns = [];
const salesInvoices = [];
const salesReturns = [];
const warrantyClaims = [];
const customerVehicles = [];
const cashEntries = [];
const shifts = [];
const quotations = [];
const stocktakes = [];
const stockTransfers = [];
const deliveryOrders = [];
const auditLogs = [];
const offlineTransactions = [];
const marketingCampaigns = [];
const marketingContactLog = [];

let purchaseSeq = 0;
let salesSeq = 0;
let salesReturnSeq = 0;
let purchaseReturnSeq = 0;
let shiftSeq = 0;
let quotationSeq = 0;
let transferSeq = 0;
let deliverySeq = 0;
/** First day a quarterly stocktake is due; advanced as each one is taken. */
let nextStocktakeDay = 90;

const purchaseById = new Map();
const salesById = new Map();
/** Everything a cash entry is allowed to point at. */
function logAudit(action, entityLabel, when, details) {
  auditLogs.push({
    id: `audit-${auditLogs.length + 1}`,
    action,
    entityLabel,
    userId: "user-owner",
    userName: "المالك",
    timestamp: isoAt(when),
    details,
  });
}

/**
 * Work caused by an event but landing on a later day: a customer returning a
 * part, a supplier being paid, a warranty claim being opened. Keyed by day
 * index so the main loop can run it when that day arrives — which is what
 * keeps every one of those records dated after its cause.
 */
const deferred = new Map();
function defer(dayIndex, task) {
  if (dayIndex >= TOTAL_DAYS) return; // beyond the fixture's horizon
  const list = deferred.get(dayIndex);
  if (list) list.push(task);
  else deferred.set(dayIndex, [task]);
}

// Sales volume per day: the shop grows, and Saturday/Thursday are busier.
const dayWeights = [];
let weightSum = 0;
for (let day = 0; day < TOTAL_DAYS; day++) {
  const when = dayStart(day);
  if (isClosedDay(when)) { dayWeights.push(0); continue; }
  const dow = new Date(when).getUTCDay();
  const growth = 0.45 + 1.15 * (day / TOTAL_DAYS);
  const weekday = dow === 6 ? 1.25 : dow === 4 ? 1.15 : 1;
  const weight = growth * weekday;
  dayWeights.push(weight);
  weightSum += weight;
}
const salesPerDay = [];
const purchasesPerDay = [];
const targetPurchases = Math.max(1200, Math.floor(CONFIG.invoices * 0.12));
{
  let salesCarry = 0;
  let purchaseCarry = 0;
  for (let day = 0; day < TOTAL_DAYS; day++) {
    const share = weightSum > 0 ? dayWeights[day] / weightSum : 0;
    const salesExact = CONFIG.invoices * share + salesCarry;
    const salesToday = Math.floor(salesExact);
    salesCarry = salesExact - salesToday;
    salesPerDay.push(salesToday);

    const purchaseExact = targetPurchases * share + purchaseCarry;
    const purchasesToday = Math.floor(purchaseExact);
    purchaseCarry = purchaseExact - purchasesToday;
    purchasesPerDay.push(purchasesToday);
  }
}

// Pointers that advance with the calendar instead of re-scanning.
let productPointer = 0;
let customerPointer = 0;
/** Products that exist and may be traded today (archived lines are dead stock). */
const availableProducts = [];
const sellableProducts = [];
const lastInvoiceByCustomer = new Map();

/**
 * A part that is actually on the shelf.
 *
 * Picking blindly and skipping when the pick happened to be out of stock threw
 * away whole invoices — the fixture came out 8,000 sales short of what was
 * asked for, and the shortfall grew as stock got tighter. A counter does not
 * abandon a sale because the first part they thought of is out; they check the
 * next one. Bounded so a genuinely empty shop still terminates.
 */
function pickInStockProduct() {
  for (let attempt = 0; attempt < 6; attempt++) {
    const product = pick(sellableProducts);
    if (product.quantity > 0) return product;
  }
  return null;
}

/**
 * A part worth reordering.
 *
 * Restocking picked uniformly at random, which is not how anyone buys: over a
 * ten-year run it left 86% of the catalogue stocked out while the rest piled
 * up, because the parts that sell got reordered no more often than the parts
 * that do not. A shop reorders what has fallen to its minimum. Sampling a few
 * candidates and taking the one furthest below its minimum reproduces that
 * without scanning nine thousand products per line.
 */
/**
 * How much stock the shop should be holding today.
 *
 * Two things have to be true at once, and tuning either alone gets it wrong:
 * the shop keeps roughly two to three months of cover (or it is insolvent),
 * AND it keeps at least a couple of units of most part numbers (or the shelf
 * is empty and the alerts page lists thousands of stock-outs). Reordering to
 * each part's minimum alone produced 29 months of cover; capping total units
 * alone drained 86% of the catalogue. The target is the larger of the two.
 */
function targetOnHandUnits(day) {
  const breadth = sellableProducts.length * 2.5;
  const dailyUnits = unitsSoldTotal / Math.max(1, day);
  return Math.max(breadth, dailyUnits * 70);
}

function pickReorderCandidate() {
  let best = null;
  let bestRatio = Infinity;
  for (let attempt = 0; attempt < 8; attempt++) {
    const product = pick(sellableProducts);
    const ratio = product.quantity / Math.max(1, product.minStock);
    if (ratio < bestRatio) {
      bestRatio = ratio;
      best = product;
    }
  }
  return best;
}

function openingPurchaseFor(newProducts, when) {
  if (newProducts.length === 0) return;
  const eligibleSuppliers = suppliersExistingAt(when);
  const supplier = eligibleSuppliers.length ? pick(eligibleSuppliers) : suppliers[0];
  // Batched so a 3,000-product opening day is a handful of invoices, not 3,000.
  for (let offset = 0; offset < newProducts.length; offset += 40) {
    const chunk = newProducts.slice(offset, offset + 40);
    purchaseSeq++;
    const id = `pinv-${purchaseSeq}`;
    const lines = chunk.map((product, n) => {
      // Opening stock is deliberately modest. Restocking 10-120 units of every
      // one of 4,000 parts left the shop holding 1.9bn EGP of inventory against
      // 345m of sales — a ratio no real business survives. Even 4-26 left four
      // YEARS of cost of goods sitting on the shelf; a parts shop that stays
      // solvent turns its stock over every two to three months.
      const qty = int(1, 5);
      const unitCost = product.purchasePrice;
      applyStock(product, qty, {
        type: "purchase", referenceId: id, referenceType: "purchase", when,
        reason: { unitCost },
      });
      return {
        id: `${id}-l${n + 1}`, productId: product.id, productName: product.name,
        partNumber: product.partNumber, partBrand: product.partBrand, unit: product.unit,
        quantity: qty, price: unitCost, costPrice: unitCost, subtotal: money(qty * unitCost),
      };
    });
    const total = money(lines.reduce((sum, line) => sum + line.subtotal, 0));
    const invoice = {
      id, invoiceNumber: `PUR-${String(purchaseSeq).padStart(6, "0")}`, date: dateAt(when),
      supplierId: supplier.id, supplierName: supplier.name, lines, total,
      amountPaid: total, remaining: 0, status: "paid",
      branchId: "branch-main", createdAt: isoAt(when),
    };
    purchaseInvoices.push(invoice);
    purchaseById.set(id, invoice);
    cashEntries.push({
      id: `cash-${cashEntries.length + 1}`,
      type: "purchase-payment",
      amount: -total,
      description: `سداد فاتورة مشتريات ${invoice.invoiceNumber} — ${supplier.name}`,
      referenceId: id,
      // Opening stock is a wholesale order settled by transfer. Paying it out
      // of the drawer — which is what this used to record — drove the physical
      // cash line to minus 97 million against a positive total balance.
      paymentMethod: "bank",
      date: isoAt(when),
      createdByUserId: "user-owner",
      createdAt: isoAt(when),
    });
  }
}

// ── The calendar ─────────────────────────────────────────────────────────
for (let day = 0; day < TOTAL_DAYS; day++) {
  const midnight = dayStart(day);
  const closed = isClosedDay(midnight);
  // Enough slots for everything this day will emit, with slack for the
  // per-day extras (quotation, transfer, expense, payroll, stocktake).
  beginTradingDay(
    midnight,
    (deferred.get(day)?.length ?? 0) + purchasesPerDay[day] * 3 + salesPerDay[day] + 24,
  );

  // 1. Reveal everything created today, before anything can reference it.
  const newProducts = [];
  while (
    productPointer < productsByCreation.length &&
    Date.parse(productsByCreation[productPointer].createdAt) <= midnight
  ) {
    const product = productsByCreation[productPointer++];
    availableProducts.push(product);
    if (!product.archived) sellableProducts.push(product);
    newProducts.push(product);
  }
  while (
    customerPointer < customerSignupMs.length &&
    customerSignupMs[customerPointer] <= midnight
  ) {
    customerPointer++;
  }

  // 2. Deferred work lands before today's new events, so a return recorded for
  //    today is dated inside today's trading hours like everything else.
  const todaysDeferred = deferred.get(day);
  if (todaysDeferred) {
    for (const task of todaysDeferred) task(midnight);
    deferred.delete(day);
  }

  // 3. Opening stock for anything new. Even on a closed day the shop receives
  //    goods, so this is not gated on trading.
  openingPurchaseFor(newProducts, nextEventTime());

  // 4. Restocking.
  for (let p = 0; p < purchasesPerDay[day]; p++) {
    if (sellableProducts.length === 0) break;
    const when = nextEventTime();
    const eligibleSuppliers = suppliersExistingAt(when);
    if (eligibleSuppliers.length === 0) break;
    const supplier = pick(eligibleSuppliers);
    purchaseSeq++;
    const id = `pinv-${purchaseSeq}`;
    const lineCount = int(1, 12);
    const lines = [];
    for (let n = 0; n < lineCount; n++) {
      const product = pickReorderCandidate();
      if (!product) break;
      // Reorder quantities, not container loads: sized so that the restocking
      // roughly matches the selling, leaving a few months of stock on the shelf
      // rather than a warehouse nobody paid for.
      const topUp = Math.max(
        int(1, 5),
        Math.min(30, Math.ceil(product.minStock * (1.2 + rnd() * 0.8)) - product.quantity),
      );
      // Buy less as the shelf fills, nothing once it is well past target. A
      // line that buys nothing is simply not written — the shop did not order
      // that part today.
      const target = targetOnHandUnits(day);
      const fill = totalOnHand / Math.max(1, target);
      const brake = fill >= 1.15 ? 0 : fill >= 0.9 ? 0.35 : fill >= 0.7 ? 0.7 : 1;
      const qty = Math.max(0, Math.round(topUp * brake));
      if (qty === 0) continue;
      // Supplier prices drift upward across the fixture's span.
      const drift = 1 + ((when - START) / (END - START)) * 0.18;
      const unitCost = money(product.purchasePrice * drift * (0.94 + rnd() * 0.12));
      applyStock(product, qty, {
        type: "purchase", referenceId: id, referenceType: "purchase", when,
        reason: { unitCost },
      });
      lines.push({
        id: `${id}-l${n + 1}`, productId: product.id, productName: product.name,
        partNumber: product.partNumber, partBrand: product.partBrand, unit: product.unit,
        quantity: qty, price: unitCost, costPrice: unitCost, subtotal: money(qty * unitCost),
      });
    }
    if (lines.length === 0) { purchaseSeq--; continue; }
    const total = money(lines.reduce((sum, line) => sum + line.subtotal, 0));
    const roll = rnd();
    const amountPaid = roll < 0.7 ? total : roll < 0.92 ? money(total * (0.2 + rnd() * 0.6)) : 0;
    const openBranches = branchesOpenAt(when);
    const invoice = {
      id, invoiceNumber: `PUR-${String(purchaseSeq).padStart(6, "0")}`, date: dateAt(when),
      supplierId: supplier.id, supplierName: supplier.name, lines, total,
      amountPaid, remaining: money(total - amountPaid),
      status: amountPaid >= total ? "paid" : amountPaid > 0 ? "partial" : "unpaid",
      branchId: pick(openBranches).id, createdAt: isoAt(when),
    };
    purchaseInvoices.push(invoice);
    purchaseById.set(id, invoice);
    if (amountPaid > 0) {
      cashEntries.push({
        id: `cash-${cashEntries.length + 1}`,
        type: "purchase-payment",
        amount: -amountPaid,
        description: `سداد فاتورة مشتريات ${invoice.invoiceNumber} — ${supplier.name}`,
        referenceId: id,
        // Suppliers are paid by transfer far more often than from the till;
        // only the small counter orders come out of the drawer.
        paymentMethod: chance(0.75) ? "bank" : chance(0.5) ? "instapay" : "cash",
        date: isoAt(when),
        createdByUserId: "user-owner",
        createdAt: isoAt(when),
      });
    }
    if (chance(0.02)) logAudit("invoice_purchase_created", invoice.invoiceNumber, when);

    // A few purchases come back to the supplier a couple of weeks later.
    if (chance(0.03)) {
      const returnDay = day + int(2, 30);
      defer(returnDay, (returnMidnight) => {
        const returnWhen = nextEventTime();
        purchaseReturnSeq++;
        const returnId = `pret-${purchaseReturnSeq}`;
        const returnLines = [];
        for (const [n, line] of invoice.lines.slice(0, int(1, Math.min(3, invoice.lines.length))).entries()) {
          const product = productById.get(line.productId);
          if (!product) continue;
          const wanted = Math.max(1, Math.floor(line.quantity * 0.2));
          const moved = -applyStock(product, -wanted, {
            type: "return", referenceId: returnId, referenceType: "purchase", when: returnWhen,
          });
          if (moved <= 0) continue;
          returnLines.push({
            id: `${returnId}-l${n + 1}`, sourceLineId: line.id, productId: line.productId,
            productName: line.productName, unit: line.unit, quantity: moved, price: line.price,
            subtotal: money(moved * line.price),
          });
        }
        if (returnLines.length === 0) { purchaseReturnSeq--; return; }
        purchaseReturns.push({
          id: returnId, returnNumber: `PR-${String(purchaseReturnSeq).padStart(6, "0")}`,
          date: dateAt(returnWhen), originalInvoiceId: invoice.id,
          originalInvoiceNumber: invoice.invoiceNumber,
          supplierId: invoice.supplierId, supplierName: invoice.supplierName,
          lines: returnLines,
          total: money(returnLines.reduce((sum, line) => sum + line.subtotal, 0)),
          createdAt: isoAt(returnWhen),
        });
      });
    }
  }

  if (closed) continue;

  // 5. One shift per trading day, on the cashiers actually employed by then.
  const onDuty = cashiersOnDuty(midnight);
  const cashier = onDuty.length ? onDuty[day % onDuty.length] : users[0];
  shiftSeq++;
  const shift = {
    id: `shift-${shiftSeq}`, shiftNumber: shiftSeq,
    cashierId: cashier.id, cashierName: cashier.name, cashierUsername: cashier.username,
    openedAt: isoAt(midnight + OPEN_HOUR * HOUR),
    closedAt: isoAt(midnight + CLOSE_HOUR * HOUR),
    status: "closed", openingCash: 2000, expectedCash: 2000,
    totalSalesCount: 0, totalSalesAmount: 0, totalCashSales: 0, totalVisaSales: 0,
    totalCreditSales: 0, paymentMethodTotals: {}, totalRefunds: 0, totalExpenses: 0,
    salesInvoiceIds: [], branchId: "branch-main", branchName: "الفرع الرئيسي",
  };
  shifts.push(shift);

  // 6. Sales.
  for (let s = 0; s < salesPerDay[day]; s++) {
    if (sellableProducts.length === 0 || customerPointer === 0) break;
    const when = nextEventTime();
    // Weighted towards recent signups, which is how a real shop behaves — new
    // customers buy soon after registering, and a long tail keeps coming back.
    const bias = chance(0.6) ? Math.pow(rnd(), 0.4) : rnd();
    const customer = activeCustomers[Math.min(customerPointer - 1, Math.floor(bias * customerPointer))];
    const openBranches = branchesOpenAt(when);

    const priceType = chance(0.3) ? "wholesale" : "retail";
    // Most counter sales are one or two items; a workshop order is bigger.
    const lineCount = chance(0.65) ? int(1, 2) : chance(0.8) ? int(3, 5) : int(6, 12);
    salesSeq++;
    const id = `sinv-${salesSeq}`;
    const lines = [];
    for (let n = 0; n < lineCount; n++) {
      const product = pickInStockProduct();
      if (!product) continue;
      // Quantity follows the part: one battery, four brake pads, a dozen filters.
      const typical = product.category === "إطارات" ? int(1, 4)
        : product.category === "بطاريات" ? 1
        : product.category === "فلاتر" || product.category === "زيوت وسوائل" ? int(1, 6)
        : int(1, 3);
      const qty = Math.max(1, Math.min(typical, product.quantity));
      const unitPrice = priceType === "wholesale" ? product.wholesalePrice : product.retailPrice;
      // Cost quoted on the line is the product's weighted-average cost *at this
      // moment*, which is exactly what the profit report will later recompute.
      const costPrice = product.avgCost ?? product.purchasePrice;
      const moved = -applyStock(product, -qty, {
        type: "sale", referenceId: id, referenceType: "sale", when,
      });
      if (moved <= 0) continue;
      unitsSoldTotal += moved;
      lines.push({
        id: `${id}-l${n + 1}`, productId: product.id, productName: product.name,
        partNumber: product.partNumber, partBrand: product.partBrand, unit: product.unit,
        quantity: moved, price: unitPrice, priceType, costPrice,
        warrantyMonths: product.warrantyMonths,
        subtotal: money(moved * unitPrice),
      });
    }
    if (lines.length === 0) { salesSeq--; continue; }

    const gross = money(lines.reduce((sum, line) => sum + line.subtotal, 0));
    const discount = chance(0.18) ? money(gross * (0.02 + rnd() * 0.08)) : 0;
    const total = money(gross - discount);
    const onAccount = chance(0.22);
    const cancelled = chance(0.015);
    const roll = rnd();
    // A cancelled sale keeps no money: the app refunds it as part of cancelling,
    // so a cancelled invoice showing cash received is a state it cannot reach.
    const amountReceived = cancelled
      ? 0
      : onAccount
        ? (roll < 0.35 ? 0 : roll < 0.75 ? money(total * (0.2 + rnd() * 0.6)) : total)
        : total;
    const paymentType = onAccount ? "account" : "cash";
    const paymentMethod = onAccount || cancelled ? undefined : pick(SALES_PAYMENT_METHODS);
    const deliveryMethod = chance(0.12) ? pick(["branch_driver", "shipping_company"]) : "pickup";

    const invoice = {
      id, invoiceNumber: `INV-${String(salesSeq).padStart(6, "0")}`, date: dateAt(when),
      customerId: customer.id, customerName: customer.name,
      lines, total, discount: discount || undefined,
      amountReceived, remaining: money(total - amountReceived),
      paymentType, paymentMethod, priceType,
      paymentDueDate: onAccount && !cancelled ? dateAt(when + int(7, 60) * DAY) : undefined,
      status: amountReceived >= total ? "paid" : amountReceived > 0 ? "partial" : "unpaid",
      cancelled: cancelled || undefined,
      deliveryMethod,
      branchId: pick(openBranches).id,
      priceTierId: priceType === "wholesale" ? "tier-wholesale" : "tier-retail",
      priceTierName: priceType === "wholesale" ? "جملة" : "تجزئة",
      createdByUserId: shift.cashierId,
      shiftId: shift.id,
      createdAt: isoAt(when),
    };
    salesInvoices.push(invoice);
    salesById.set(id, invoice);
    lastInvoiceByCustomer.set(customer.id, invoice);

    if (cancelled) {
      // Cancelling puts the parts back. The reversal carries the SAME reference
      // as the sale, so the pair nets to zero against that invoice — which is
      // what the app's own cancellation does and what the ledger check reads.
      const reversedAt = nextEventTime();
      logAudit("invoice_sale_cancelled", invoice.invoiceNumber, reversedAt);
      for (const line of lines) {
        const product = productById.get(line.productId);
        if (!product) continue;
        applyStock(product, line.quantity, {
          type: "adjustment-in", referenceId: id, referenceType: "sale", when: reversedAt,
        });
      }
    } else {
      shift.totalSalesCount++;
      shift.totalSalesAmount = money(shift.totalSalesAmount + total);
      shift.salesInvoiceIds.push(id);
      if (onAccount) shift.totalCreditSales = money(shift.totalCreditSales + total);
      else if (paymentMethod === "cash") shift.totalCashSales = money(shift.totalCashSales + amountReceived);
      else {
        shift.paymentMethodTotals[paymentMethod] =
          money((shift.paymentMethodTotals[paymentMethod] || 0) + amountReceived);
        shift.totalVisaSales = money(shift.totalVisaSales + amountReceived);
      }
      if (amountReceived > 0) {
        cashEntries.push({
          id: `cash-${cashEntries.length + 1}`,
          type: "sales-receipt",
          amount: amountReceived,
          description: `تحصيل فاتورة مبيعات ${invoice.invoiceNumber} — ${customer.name}`,
          referenceId: id,
          paymentMethod: paymentMethod ?? "cash",
          shiftId: shift.id,
          createdByUserId: shift.cashierId,
          date: isoAt(when),
          createdAt: isoAt(when),
        });
      }
    }

    // A vehicle on some invoices, so the fitment and garage screens have data.
    if (!cancelled && chance(0.2)) {
      const make = pick(vehicleMakes);
      const models = modelsByMake.get(make.id) ?? [];
      const model = models.length ? pick(models) : undefined;
      const generations = model ? generationsByModel.get(model.id) ?? [] : [];
      const generation = generations.length && chance(0.7) ? pick(generations) : undefined;
      const engines = generation ? enginesByGeneration.get(generation.id) ?? [] : [];
      const engine = engines.length && chance(0.5) ? pick(engines) : undefined;
      // Within the generation's production window, so the year is one the car
      // could actually have been built in.
      const yearFrom = generation?.yearFrom ?? 2005;
      const yearTo = Math.min(generation?.yearTo ?? new Date(when).getUTCFullYear(),
        new Date(when).getUTCFullYear());
      customerVehicles.push({
        id: `veh-${customerVehicles.length + 1}`,
        customerId: customer.id,
        makeId: make.id,
        modelId: model?.id,
        generationId: generation?.id,
        engineId: engine?.id,
        year: yearTo >= yearFrom ? int(yearFrom, yearTo) : yearFrom,
        plateNumber: `${pick(["أ ب ج", "س ص ط", "ر ز و"])} ${int(1000, 9999)}`,
        color: pick(["أبيض", "أسود", "فضي", "رمادي", "أحمر", "أزرق"]),
        createdAt: isoAt(when),
        updatedAt: isoAt(when),
      });
    }

    // Delivery orders for anything that was not collected from the counter.
    if (!cancelled && deliveryMethod !== "pickup") {
      const providersOpen = shippingProviders.filter(
        (provider) => Date.parse(provider.createdAt) <= when,
      );
      const useDriver = deliveryMethod === "branch_driver" || providersOpen.length === 0;
      const driver = useDriver ? pick(drivers) : undefined;
      const provider = useDriver ? undefined : pick(providersOpen);
      const governorate = pick(GOVERNORATES);
      const rate = shippingRates.find(
        (item) => item.providerId === (provider?.id ?? "ship-inhouse") && item.governorate === governorate,
      );
      deliverySeq++;
      deliveryOrders.push({
        id: `dlv-${deliverySeq}`,
        orderNumber: `DO-${String(deliverySeq).padStart(6, "0")}`,
        invoiceId: id,
        invoiceNumber: invoice.invoiceNumber,
        customerId: customer.id,
        customerName: customer.name,
        branchId: invoice.branchId,
        method: useDriver ? "branch_driver" : "shipping_company",
        address: {
          recipientName: customer.name,
          phone: customer.phone,
          governorate,
          city: `${governorate} - مركز ${int(1, 6)}`,
          addressLine: customer.address,
        },
        shippingFee: rate?.fee ?? 50,
        codAmount: invoice.remaining > 0 ? invoice.remaining : 0,
        driverId: driver?.id,
        driverName: driver?.name,
        providerId: provider?.id,
        providerName: provider?.name,
        status: pick(DELIVERY_ORDER_STATUSES),
        createdAt: isoAt(when),
        updatedAt: isoAt(when),
      });
    }

    // Returns: only against live invoices, only returnable products, never more
    // than was sold, and always on a later day.
    if (!cancelled && chance(0.05)) {
      const returnDay = day + int(1, 25);
      defer(returnDay, (returnMidnight) => {
        const returnWhen = nextEventTime();
        const returnable = lines.filter(
          (line) => productById.get(line.productId)?.returnable !== false,
        );
        if (returnable.length === 0) return;
        salesReturnSeq++;
        const returnId = `sret-${salesReturnSeq}`;
        const returnLines = returnable
          .slice(0, int(1, returnable.length))
          .map((line, n) => {
            const qty = int(1, line.quantity);
            const product = productById.get(line.productId);
            if (product) {
              applyStock(product, qty, {
                type: "return", referenceId: returnId, referenceType: "sale", when: returnWhen,
              });
            }
            return {
              id: `${returnId}-l${n + 1}`, sourceLineId: line.id, productId: line.productId,
              productName: line.productName, unit: line.unit, quantity: qty, price: line.price,
              priceType: line.priceType, subtotal: money(qty * line.price),
            };
          });
        const returnTotal = money(returnLines.reduce((sum, line) => sum + line.subtotal, 0));
        const refundCash = chance(0.6);
        salesReturns.push({
          id: returnId, returnNumber: `SR-${String(salesReturnSeq).padStart(6, "0")}`,
          date: dateAt(returnWhen), originalInvoiceId: id,
          originalInvoiceNumber: invoice.invoiceNumber,
          customerId: customer.id, customerName: customer.name, lines: returnLines,
          total: returnTotal, refundCash, createdAt: isoAt(returnWhen),
        });
        if (refundCash && returnTotal > 0) {
          cashEntries.push({
            id: `cash-${cashEntries.length + 1}`,
            type: "adjustment",
            amount: -returnTotal,
            description: `مرتجع فاتورة مبيعات ${invoice.invoiceNumber}`,
            referenceId: returnId,
            paymentMethod: "cash",
            date: isoAt(returnWhen),
            createdByUserId: "user-owner",
            createdAt: isoAt(returnWhen),
          });
        }
      });
    }

    // Warranty claims against lines that actually carry a warranty.
    if (!cancelled && chance(0.02)) {
      const warranted = lines.filter((line) => line.warrantyMonths);
      if (warranted.length > 0) {
        const line = pick(warranted);
        const claimDay = day + int(5, Math.max(6, line.warrantyMonths * 30));
        defer(claimDay, (claimMidnight) => {
          const opened = nextEventTime();
          const status = pick(WARRANTY_STATUSES);
          const updatedDay = Math.min(TOTAL_DAYS - 1, claimDay + int(1, 20));
          const claimId = `wc-${warrantyClaims.length + 1}`;
          // A replaced part leaves the shelf, so it needs its own movement —
          // otherwise the ledger would no longer explain the final quantity.
          if (status === "replaced") {
            const product = productById.get(line.productId);
            if (product) {
              applyStock(product, -1, {
                type: "adjustment-out", referenceId: claimId, when: opened,
              });
            }
          }
          warrantyClaims.push({
            id: claimId, invoiceId: id, invoiceNumber: invoice.invoiceNumber,
            invoiceLineId: line.id, customerId: customer.id, customerName: customer.name,
            productId: line.productId, productName: line.productName,
            supplierId: productById.get(line.productId)?.supplierId,
            complaint: pick(["عطل بعد فترة قصيرة", "صوت غير طبيعي", "تسريب", "لا يعمل نهائيًا", "اهتزاز"]),
            status,
            stockDeducted: status === "replaced" ? true : undefined,
            replacementCost: status === "replaced" ? line.costPrice : undefined,
            compensationAmount: status === "compensated" ? money(line.price * 0.7) : undefined,
            openedAt: isoAt(opened),
            updatedAt: isoAt(timeInTradingDay(dayStart(updatedDay), 0.9)),
          });
        });
      }
    }

    // Credit sales get collected later, in instalments.
    if (!cancelled && onAccount && invoice.remaining > 0 && chance(0.55)) {
      const payDay = day + int(5, 70);
      const instalment = money(invoice.remaining * (0.4 + rnd() * 0.6));
      defer(payDay, (payMidnight) => {
        const payWhen = nextEventTime();
        const collected = Math.min(instalment, invoice.total - invoice.amountReceived);
        if (collected <= 0.01) return;
        invoice.amountReceived = money(invoice.amountReceived + collected);
        invoice.remaining = money(invoice.total - invoice.amountReceived);
        invoice.status = invoice.amountReceived >= invoice.total
          ? "paid" : invoice.amountReceived > 0 ? "partial" : "unpaid";
        invoice.paymentLog = invoice.paymentLog ?? [];
        invoice.paymentLog.push({
          id: `pay-${invoice.id}-${invoice.paymentLog.length + 1}`,
          date: isoAt(payWhen), amount: collected,
          paymentMethod: pick(["cash", "instapay", "vodafone"]),
        });
        cashEntries.push({
          id: `cash-${cashEntries.length + 1}`,
          type: "sales-receipt",
          amount: collected,
          description: `تحصيل من حساب العميل ${customer.name} — فاتورة ${invoice.invoiceNumber}`,
          referenceId: invoice.id,
          paymentMethod: pick(["cash", "instapay", "vodafone"]),
          date: isoAt(payWhen),
          createdByUserId: "user-owner",
          createdAt: isoAt(payWhen),
        });
      });
    }
  }

  // 7. Quotations — some convert, most expire as drafts.
  if (sellableProducts.length > 0 && customerPointer > 0 && chance(0.55)) {
    const when = nextEventTime();
    const customer = activeCustomers[int(0, customerPointer - 1)];
    quotationSeq++;
    const id = `quot-${quotationSeq}`;
    const lineCount = int(1, 5);
    const quotationLines = [];
    for (let n = 0; n < lineCount; n++) {
      const product = pick(sellableProducts);
      const qty = int(1, 4);
      quotationLines.push({
        id: `${id}-l${n + 1}`, productId: product.id, productName: product.name,
        partNumber: product.partNumber, unit: product.unit, quantity: qty,
        price: product.retailPrice, priceType: "retail",
        costPrice: product.avgCost ?? product.purchasePrice,
        subtotal: money(qty * product.retailPrice),
      });
    }
    const linked = lastInvoiceByCustomer.get(customer.id);
    const converted = Boolean(linked) && chance(0.3);
    const vehicle = customerVehicles.find((item) => item.customerId === customer.id);
    quotations.push({
      id, quotationNumber: `QT-${String(quotationSeq).padStart(6, "0")}`,
      date: dateAt(when), validUntil: dateAt(Math.min(END - DAY, when + 14 * DAY)),
      customerId: customer.id, customerName: customer.name,
      lines: quotationLines,
      total: money(quotationLines.reduce((sum, line) => sum + line.subtotal, 0)),
      status: converted ? "converted" : "draft",
      convertedInvoiceId: converted ? linked.id : undefined,
      customerVehicleId: vehicle?.id,
      branchId: "branch-main", branchName: "الفرع الرئيسي",
      priceTierId: "tier-retail", priceTierName: "تجزئة",
      createdAt: isoAt(when),
    });
  }

  // 8. Branch transfers, once there is more than one branch.
  const openBranchesToday = branchesOpenAt(midnight);
  if (openBranchesToday.length > 1 && sellableProducts.length > 0 && chance(0.25)) {
    const when = nextEventTime();
    const from = openBranchesToday[0];
    const to = pick(openBranchesToday.slice(1));
    const product = pick(sellableProducts);
    if (product.quantity > 2) {
      transferSeq++;
      stockTransfers.push({
        id: `trf-${transferSeq}`, transferNumber: `TR-${String(transferSeq).padStart(6, "0")}`,
        fromBranchId: from.id, toBranchId: to.id,
        productId: product.id, productName: product.name,
        quantity: int(1, Math.min(5, product.quantity)),
        date: dateAt(when), status: "completed", createdAt: isoAt(when),
      });
    }
  }

  // 9. Running costs and payroll.
  if (chance(0.35)) {
    const when = nextEventTime();
    const kind = pick(["إيجار", "كهرباء ومياه", "صيانة", "مواصلات", "دعاية", "أدوات"]);
    const amount = money(int(50, 4000) + rnd());
    cashEntries.push({
      id: `cash-${cashEntries.length + 1}`,
      type: "manual-remove",
      amount: -amount,
      description: `مصروف ${kind}`,
      paymentMethod: "cash",
      shiftId: shift.id,
      createdByUserId: shift.cashierId,
      date: isoAt(when),
      createdAt: isoAt(when),
    });
    shift.totalExpenses = money(shift.totalExpenses + amount);
  }
  // Payroll on the 28th, for staff already hired.
  if (new Date(midnight).getUTCDate() === 28) {
    const when = nextEventTime();
    const month = monthAt(midnight);
    for (const employee of offlineEmployees) {
      if (Date.parse(employee.createdAt) > when) continue;
      const amount = employee.basicSalary;
      offlineTransactions.push({
        id: `offtx-${offlineTransactions.length + 1}`,
        employeeId: employee.id, type: "salary", amount, month,
        date: dateAt(when), createdAt: isoAt(when),
      });
      cashEntries.push({
        id: `cash-${cashEntries.length + 1}`,
        type: "manual-remove",
        amount: -amount,
        description: `مرتب ${employee.name} عن ${month}`,
        referenceId: `payroll:offline:${employee.id}:${month}`,
        paymentMethod: "cash",
        date: isoAt(when),
        createdByUserId: "user-owner",
        createdAt: isoAt(when),
      });
      if (chance(0.15)) {
        offlineTransactions.push({
          id: `offtx-${offlineTransactions.length + 1}`,
          employeeId: employee.id, type: pick(["advance", "incentive", "deduction"]),
          amount: money(int(200, 1200)), month,
          date: dateAt(when), createdAt: isoAt(when),
        });
      }
    }
    for (const driver of drivers) {
      if (Date.parse(driver.createdAt) > when || !driver.salary) continue;
      cashEntries.push({
        id: `cash-${cashEntries.length + 1}`,
        type: "manual-remove",
        amount: -driver.salary,
        description: `مرتب السائق ${driver.name} عن ${month}`,
        referenceId: `payroll:driver:${driver.id}:${month}`,
        paymentMethod: "cash",
        date: isoAt(when),
        createdByUserId: "user-owner",
        createdAt: isoAt(when),
      });
    }
  }

  // 10. A quarterly stocktake, with the variances it finds written to the ledger.
  //
  // Scheduled by "the first trading day on or after the due date" rather than
  // by day % N: 91 days is exactly 13 weeks, so every stocktake landed on the
  // same weekday as day zero — and when that weekday was the Friday the shop
  // is closed, the fixture contained no stocktakes at all.
  if (day >= nextStocktakeDay && availableProducts.length > 0) {
    nextStocktakeDay = day + 90;
    const when = nextEventTime();
    const stocktakeId = `stk-${stocktakes.length + 1}`;
    const sample = [];
    for (let i = 0; i < Math.min(120, availableProducts.length); i++) {
      sample.push(pick(availableProducts));
    }
    const items = [];
    for (const product of sample) {
      const systemQty = product.quantity;
      // Most counts agree; a few find shrinkage or a miscount.
      const variance = chance(0.85) ? 0 : int(-2, 2);
      const countedQty = Math.max(0, systemQty + variance);
      items.push({
        productId: product.id, productName: product.name,
        systemQty, countedQty,
        piecesPerUnit: product.piecesPerUnit,
      });
      const delta = countedQty - systemQty;
      if (delta !== 0) {
        applyStock(product, delta, {
          type: delta > 0 ? "adjustment-in" : "adjustment-out",
          referenceId: stocktakeId, when,
        });
      }
    }
    stocktakes.push({
      id: stocktakeId, date: dateAt(when), status: "applied",
      notes: "جرد دوري ربع سنوي", items,
      appliedAt: isoAt(when), createdAt: isoAt(when),
    });
    logAudit("stocktake_applied", `جرد ${dateAt(when)}`, when);
  }

  // 11. Marketing, roughly monthly.
  if (day > 30 && day % 30 === 0 && customerPointer > 50) {
    const when = nextEventTime();
    const goal = pick(["winback", "vip", "welcome", "cross_sell", "maintenance"]);
    const audience = Math.min(customerPointer, int(80, 400));
    const campaignName = `حملة ${monthAt(midnight)}`;
    marketingCampaigns.push({
      id: `camp-${marketingCampaigns.length + 1}`,
      name: campaignName,
      goal,
      segment: pick(["all", "vip", "at_risk", "new", "active"]),
      message: "أهلاً {customerName}، عرض خاص من {companyName}.",
      audienceCount: audience,
      createdAt: isoAt(when),
    });
    for (let i = 0; i < Math.min(60, audience); i++) {
      const customer = activeCustomers[int(0, customerPointer - 1)];
      marketingContactLog.push({
        id: `mkt-${marketingContactLog.length + 1}`,
        customerId: customer.id,
        campaignName,
        status: pick(["contacted", "responded", "converted", "skipped"]),
        createdAt: isoAt(when),
      });
    }
  }

  // 12. Close the shift on what actually happened in it.
  shift.expectedCash = money(
    shift.openingCash + shift.totalCashSales - shift.totalRefunds - shift.totalExpenses,
  );
  shift.actualCash = shift.expectedCash;
  shift.difference = 0;
}

// Anything still queued past the horizon simply never happened, which is the
// same thing a real shop's data shows on the day you export it.
deferred.clear();

// ── Derived: per-branch stock ────────────────────────────────────────────
// Split each product's final quantity across the branches that exist, so
// branchQuantity() and the branch transfer screen have something real. The
// split sums back to the product total; a branch view that did not would
// contradict the ledger.
const branchStocks = [];
for (const product of products) {
  if (product.quantity <= 0) continue;
  const shares = branches.map(() => rnd());
  const shareSum = shares.reduce((sum, value) => sum + value, 0) || 1;
  let assigned = 0;
  for (let index = 0; index < branches.length; index++) {
    const isLast = index === branches.length - 1;
    const quantity = isLast
      ? product.quantity - assigned
      : Math.floor((shares[index] / shareSum) * product.quantity);
    assigned += quantity;
    if (quantity <= 0) continue;
    branchStocks.push({
      branchId: branches[index].id,
      productId: product.id,
      quantity,
      updatedAt: isoAt(END - DAY),
    });
  }
}

// ── Settings ─────────────────────────────────────────────────────────────
// The full current shape. A fixture missing half of it exercises whatever
// defaults the app happens to apply rather than what a configured shop has.
const settings = {
  ownerName: "عمرو حسن",
  ownerPhone: "01118445625",
  companyName: "Helpers Auto Parts",
  companyNameAr: "هيلبرز اوتو لقطع الغيار",
  invoiceFooter: "شكراً لتعاملكم معنا — يرجى مراجعة الفاتورة قبل الاستلام.",
  currency: "ج.م",
  lowStockThreshold: 10,
  arabicLabels: true,
  openingBalance: 50000,
  printPaperSize: "A4",
  logoText: "هي",
  logoImage: "",
  autoBackupEnabled: true,
  autoBackupFrequency: "daily",
  lastBackupDate: dateAt(END - DAY),
  lastInternalBackupDate: dateAt(END - DAY),
  backupPath: "",
  invoicesSavePath: "",
  subscriptionType: "unlimited",
  subscriptionStartDate: dateAt(START),
  subscriptionMonths: 0,
  warrantyType: "none",
  warrantyStartDate: "",
  warrantyMonths: 0,
  idleLockMinutes: 15,
  paymentTermDays: 30,
  maxReturnDays: 14,
  backupOnClose: true,
};

// ── The ledger ships oldest-first, because that is what the app requires ──
//
// The day loop already emits movements in order, but a deferred task runs at
// the START of its day while that day's own sales are stamped later in the
// trading window — so same-day ordering can still invert. Sorting with the
// push order as the tie-break fixes that without disturbing causal order
// (a purchase stays before the sale it supplied).
//
// The app checks this invariant at sign-in (lsIsOldestFirst) and, when it
// fails, runs a one-time ledger migration: load every movement, sort,
// re-persist. On an unsorted fixture that ran on EVERY login and put ~100
// seconds of blank screen in front of every measurement.
const movementOrder = new Map(stockMovements.map((movement, index) => [movement, index]));
stockMovements.sort((a, b) => {
  const byDate = String(a.date).localeCompare(String(b.date));
  return byDate !== 0 ? byDate : movementOrder.get(a) - movementOrder.get(b);
});

// Cash entries are read newest-first by the cashbox but stored oldest-first.
cashEntries.sort((a, b) => String(a.date).localeCompare(String(b.date)));

const dataset = {
  products, customers, suppliers, users, branches,
  salesInvoices, purchaseInvoices, salesReturns, purchaseReturns,
  stockMovements, shifts, warrantyClaims, customerVehicles, cashEntries,
  drivers, offlineEmployees, offlineTransactions, auditLogs,
  quotations, stocktakes, branchStocks, stockTransfers, priceTiers,
  vehicleMakes, vehicleModels, vehicleGenerations, vehicleEngines,
  productFitments, productAlternatives,
  marketingCampaigns, marketingContactLog,
  shippingProviders, shippingRates, deliveryOrders,
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
  quotations        ${quotations.length}
  stocktakes        ${stocktakes.length}
  branch stocks     ${branchStocks.length}
  stock transfers   ${stockTransfers.length}
  delivery orders   ${deliveryOrders.length}
  fitments          ${productFitments.length}
  alternatives      ${productAlternatives.length}
  audit logs        ${auditLogs.length}
`);
