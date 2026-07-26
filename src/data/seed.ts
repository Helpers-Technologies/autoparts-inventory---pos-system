import type {
  AppUser,
  CashEntry,
  Customer,
  Product,
  PurchaseInvoice,
  SalesInvoice,
  Settings,
  StockMovement,
  Supplier,
} from "../types";
import { todayISO, uid } from "../lib/utils";
import { DEFAULT_INVOICE_WHATSAPP_TEMPLATE } from "../lib/whatsappTemplate";
import {
  starterProductRows,
  upgradeLegacyAutoPartsProduct,
} from "./autoPartsStarterCatalog";

const today = todayISO();

export const seedSettings: Settings = {
  ownerName: "",
  ownerPhone: "",
  companyName: "AutoParts Store",
  companyNameAr: "محل قطع غيار السيارات",
  invoiceFooter: "شكراً لتعاملكم معنا — يرجى مراجعة الفاتورة قبل الاستلام.",
  whatsappInvoiceTemplate: DEFAULT_INVOICE_WHATSAPP_TEMPLATE,
  currency: "ج.م",
  lowStockThreshold: 10,
  arabicLabels: true,
  openingBalance: 0,
  printPaperSize: "A4",
  logoText: "AP",
  logoImage: "",
  autoBackupEnabled: true,
  autoBackupFrequency: "daily",
  lastBackupDate: "",
  lastInternalBackupDate: "",
  backupPath: "",
  invoicesSavePath: "",
  subscriptionType: "limited",
  subscriptionStartDate: today,
  subscriptionMonths: 0,
  warrantyType: "none",
  warrantyStartDate: "",
  warrantyMonths: 0,
  idleLockMinutes: 0,
  paymentTermDays: 7,
  maxReturnDays: 14,
  backupOnClose: true,
};

export const seedUsers: AppUser[] = [];
export const seedSuppliers: Supplier[] = [];
export const seedCustomers: Customer[] = [];
const legacySeedProducts: Product[] = [
  // ===== فلاتر =====
  { id: uid("p"), code: "FIL-001", name: "فلتر زيت موتور - شيري (S11/Tiggo)", category: "فلاتر", unit: "قطعة", purchasePrice: 35, wholesalePrice: 50, retailPrice: 65, quantity: 50, minStock: 10, hasExpiry: false, createdAt: today },
  { id: uid("p"), code: "FIL-002", name: "فلتر هواء - BYD F3", category: "فلاتر", unit: "قطعة", purchasePrice: 40, wholesalePrice: 60, retailPrice: 80, quantity: 40, minStock: 10, hasExpiry: false, createdAt: today },
  { id: uid("p"), code: "FIL-003", name: "فلتر هواء - شيري Tiggo (جميع الموديلات)", category: "فلاتر", unit: "قطعة", purchasePrice: 45, wholesalePrice: 65, retailPrice: 85, quantity: 35, minStock: 10, hasExpiry: false, createdAt: today },
  { id: uid("p"), code: "FIL-004", name: "فلتر زيت - BYD F3 / L3", category: "فلاتر", unit: "قطعة", purchasePrice: 30, wholesalePrice: 45, retailPrice: 60, quantity: 60, minStock: 10, hasExpiry: false, createdAt: today },
  { id: uid("p"), code: "FIL-005", name: "فلتر بنزين - شيري (S11/A15)", category: "فلاتر", unit: "قطعة", purchasePrice: 25, wholesalePrice: 40, retailPrice: 55, quantity: 45, minStock: 10, hasExpiry: false, createdAt: today },
  { id: uid("p"), code: "FIL-006", name: "فلتر زيت - جيلي Emgrand (جميع الموديلات)", category: "فلاتر", unit: "قطعة", purchasePrice: 35, wholesalePrice: 50, retailPrice: 70, quantity: 40, minStock: 10, hasExpiry: false, createdAt: today },
  { id: uid("p"), code: "FIL-007", name: "فلتر هواء - جيلي Emgrand 7/GT", category: "فلاتر", unit: "قطعة", purchasePrice: 45, wholesalePrice: 65, retailPrice: 85, quantity: 30, minStock: 10, hasExpiry: false, createdAt: today },
  { id: uid("p"), code: "FIL-008", name: "فلتر مكيف - شيري Tiggo 2/3/5", category: "فلاتر", unit: "قطعة", purchasePrice: 30, wholesalePrice: 45, retailPrice: 60, quantity: 35, minStock: 10, hasExpiry: false, createdAt: today },

  // ===== فرامل =====
  { id: uid("p"), code: "BRK-001", name: "طقم فرامل أمامي (فنص) - شيري A15", category: "فرامل", unit: "طقم", purchasePrice: 120, wholesalePrice: 170, retailPrice: 220, quantity: 25, minStock: 5, hasExpiry: false, createdAt: today },
  { id: uid("p"), code: "BRK-002", name: "طقم فرامل خلفي - BYD F3", category: "فرامل", unit: "طقم", purchasePrice: 110, wholesalePrice: 160, retailPrice: 200, quantity: 20, minStock: 5, hasExpiry: false, createdAt: today },
  { id: uid("p"), code: "BRK-003", name: "طقم فرامل أمامي - جيلي Emgrand EC7", category: "فرامل", unit: "طقم", purchasePrice: 130, wholesalePrice: 180, retailPrice: 240, quantity: 20, minStock: 5, hasExpiry: false, createdAt: today },
  { id: uid("p"), code: "BRK-004", name: "اسطوانة فرامل رئيسية - شيري Tiggo", category: "فرامل", unit: "قطعة", purchasePrice: 200, wholesalePrice: 280, retailPrice: 370, quantity: 10, minStock: 3, hasExpiry: false, createdAt: today },
  { id: uid("p"), code: "BRK-005", name: "سير فرامل (يدوي) - BYD F3", category: "فرامل", unit: "قطعة", purchasePrice: 45, wholesalePrice: 65, retailPrice: 90, quantity: 30, minStock: 5, hasExpiry: false, createdAt: today },
  { id: uid("p"), code: "BRK-006", name: "بواري فرامل أمامي - جيلي Emgrand 7", category: "فرامل", unit: "طقم", purchasePrice: 90, wholesalePrice: 130, retailPrice: 170, quantity: 20, minStock: 5, hasExpiry: false, createdAt: today },

  // ===== نظام التبريد =====
  { id: uid("p"), code: "CLR-001", name: "رادياتير مياه - شيري Tiggo 3/5", category: "تبريد", unit: "قطعة", purchasePrice: 350, wholesalePrice: 480, retailPrice: 620, quantity: 8, minStock: 3, hasExpiry: false, createdAt: today },
  { id: uid("p"), code: "CLR-002", name: "رادياتير مياه - BYD F3", category: "تبريد", unit: "قطعة", purchasePrice: 300, wholesalePrice: 420, retailPrice: 550, quantity: 10, minStock: 3, hasExpiry: false, createdAt: today },
  { id: uid("p"), code: "CLR-003", name: "مروحة تبريد (كهرباء) - شيري S11", category: "تبريد", unit: "قطعة", purchasePrice: 250, wholesalePrice: 350, retailPrice: 460, quantity: 12, minStock: 3, hasExpiry: false, createdAt: today },
  { id: uid("p"), code: "CLR-004", name: "ثرموستات (منظم حرارة) - جيلي Emgrand", category: "تبريد", unit: "قطعة", purchasePrice: 55, wholesalePrice: 80, retailPrice: 110, quantity: 25, minStock: 5, hasExpiry: false, createdAt: today },
  { id: uid("p"), code: "CLR-005", name: "طلمبة مياه - شيري Tiggo 2", category: "تبريد", unit: "قطعة", purchasePrice: 180, wholesalePrice: 250, retailPrice: 330, quantity: 15, minStock: 5, hasExpiry: false, createdAt: today },
  { id: uid("p"), code: "CLR-006", name: "خرطوم مياه (طقم) - BYD F3", category: "تبريد", unit: "طقم", purchasePrice: 85, wholesalePrice: 120, retailPrice: 160, quantity: 18, minStock: 5, hasExpiry: false, createdAt: today },

  // ===== محرك وأجزاؤه =====
  { id: uid("p"), code: "ENG-001", name: "سيور كاتينة (طقم) - شيري A15/S11", category: "محرك", unit: "طقم", purchasePrice: 180, wholesalePrice: 250, retailPrice: 340, quantity: 15, minStock: 3, hasExpiry: false, createdAt: today },
  { id: uid("p"), code: "ENG-002", name: "بوجيهات (شمعة احتراق) - BYD F3 (طقم 4)", category: "محرك", unit: "طقم", purchasePrice: 60, wholesalePrice: 90, retailPrice: 120, quantity: 40, minStock: 10, hasExpiry: false, createdAt: today },
  { id: uid("p"), code: "ENG-003", name: "بوجيهات - جيلي Emgrand (طقم 4)", category: "محرك", unit: "طقم", purchasePrice: 70, wholesalePrice: 100, retailPrice: 140, quantity: 35, minStock: 10, hasExpiry: false, createdAt: today },
  { id: uid("p"), code: "ENG-004", name: "طقم سيور (كاتينة + دينامو + مكيف) - شيري Tiggo", category: "محرك", unit: "طقم", purchasePrice: 220, wholesalePrice: 310, retailPrice: 410, quantity: 12, minStock: 3, hasExpiry: false, createdAt: today },
  { id: uid("p"), code: "ENG-005", name: "كويلات بوجيهي - BYD F3 (قطعة)", category: "محرك", unit: "قطعة", purchasePrice: 95, wholesalePrice: 140, retailPrice: 190, quantity: 20, minStock: 5, hasExpiry: false, createdAt: today },
  { id: uid("p"), code: "ENG-006", name: "حساس الأكسجين (O2 Sensor) - جيلي Emgrand", category: "محرك", unit: "قطعة", purchasePrice: 150, wholesalePrice: 210, retailPrice: 280, quantity: 12, minStock: 3, hasExpiry: false, createdAt: today },
  { id: uid("p"), code: "ENG-007", name: "طرمبة بنزين (كهرباء) - شيري Tiggo 3", category: "محرك", unit: "قطعة", purchasePrice: 280, wholesalePrice: 390, retailPrice: 510, quantity: 8, minStock: 3, hasExpiry: false, createdAt: today },
  { id: uid("p"), code: "ENG-008", name: "دينامو (مولد كهرباء) - BYD F3", category: "محرك", unit: "قطعة", purchasePrice: 400, wholesalePrice: 550, retailPrice: 720, quantity: 6, minStock: 2, hasExpiry: false, createdAt: today },

  // ===== نظام التعليق والعفشة =====
  { id: uid("p"), code: "SUS-001", name: "مساعد أمامي (شوك) - شيري Tiggo 5", category: "عفشة و تعليق", unit: "قطعة", purchasePrice: 320, wholesalePrice: 450, retailPrice: 590, quantity: 10, minStock: 3, hasExpiry: false, createdAt: today },
  { id: uid("p"), code: "SUS-002", name: "مساعد خلفي - BYD F3", category: "عفشة و تعليق", unit: "قطعة", purchasePrice: 200, wholesalePrice: 290, retailPrice: 380, quantity: 12, minStock: 3, hasExpiry: false, createdAt: today },
  { id: uid("p"), code: "SUS-003", name: "ياي (سوستة) أمامي - جيلي Emgrand EC7", category: "عفشة و تعليق", unit: "قطعة", purchasePrice: 140, wholesalePrice: 200, retailPrice: 270, quantity: 15, minStock: 5, hasExpiry: false, createdAt: today },
  { id: uid("p"), code: "SUS-004", name: "بلية كرة مثبت (Ball Joint) - شيري A15", category: "عفشة و تعليق", unit: "قطعة", purchasePrice: 55, wholesalePrice: 80, retailPrice: 110, quantity: 30, minStock: 5, hasExpiry: false, createdAt: today },
  { id: uid("p"), code: "SUS-005", name: "ذراع تعليق سفلي - BYD F3", category: "عفشة و تعليق", unit: "قطعة", purchasePrice: 170, wholesalePrice: 240, retailPrice: 320, quantity: 12, minStock: 3, hasExpiry: false, createdAt: today },
  { id: uid("p"), code: "SUS-006", name: "أكمامة (كتاوت) تعليق - شيري Tiggo 3", category: "عفشة و تعليق", unit: "طقم", purchasePrice: 40, wholesalePrice: 60, retailPrice: 85, quantity: 35, minStock: 10, hasExpiry: false, createdAt: today },

  // ===== إضاءة =====
  { id: uid("p"), code: "LGT-001", name: "كلاكس (طقم) عالي ونازل - شيري Tiggo", category: "إضاءة و كهرباء", unit: "قطعة", purchasePrice: 75, wholesalePrice: 110, retailPrice: 150, quantity: 25, minStock: 5, hasExpiry: false, createdAt: today },
  { id: uid("p"), code: "LGT-002", name: "لمبة أمامي (هاي/لو) H4 - BYD F3", category: "إضاءة و كهرباء", unit: "قطعة", purchasePrice: 25, wholesalePrice: 40, retailPrice: 55, quantity: 50, minStock: 10, hasExpiry: false, createdAt: today },
  { id: uid("p"), code: "LGT-003", name: "إشارة جانب (ليمون) - جيلي Emgrand", category: "إضاءة و كهرباء", unit: "قطعة", purchasePrice: 20, wholesalePrice: 35, retailPrice: 50, quantity: 40, minStock: 10, hasExpiry: false, createdAt: today },
  { id: uid("p"), code: "LGT-004", name: "كشف أمامي كامل (شمال/يمين) - شيري A15", category: "إضاءة و كهرباء", unit: "واحدة", purchasePrice: 350, wholesalePrice: 490, retailPrice: 640, quantity: 6, minStock: 2, hasExpiry: false, createdAt: today },
  { id: uid("p"), code: "LGT-005", name: "لمبة ضباب أمامي - شيري Tiggo 5", category: "إضاءة و كهرباء", unit: "قطعة", purchasePrice: 45, wholesalePrice: 65, retailPrice: 90, quantity: 20, minStock: 5, hasExpiry: false, createdAt: today },

  // ===== زجاج =====
  { id: uid("p"), code: "GLS-001", name: "زجاج أمامي (قزازة) - BYD F3", category: "زجاج", unit: "قطعة", purchasePrice: 400, wholesalePrice: 550, retailPrice: 720, quantity: 5, minStock: 2, hasExpiry: false, createdAt: today },
  { id: uid("p"), code: "GLS-002", name: "زجاج باب أمامي (شمال) - شيري Tiggo 3", category: "زجاج", unit: "قطعة", purchasePrice: 180, wholesalePrice: 260, retailPrice: 350, quantity: 8, minStock: 2, hasExpiry: false, createdAt: today },
  { id: uid("p"), code: "GLS-003", name: "زجاج باب خلفي (يمين) - جيلي Emgrand EC7", category: "زجاج", unit: "قطعة", purchasePrice: 160, wholesalePrice: 230, retailPrice: 310, quantity: 6, minStock: 2, hasExpiry: false, createdAt: today },

  // ===== كاوتش =====
  { id: uid("p"), code: "TRE-001", name: "كاوتش 195/65R15 - ميشلان (صيني)", category: "كاوتش", unit: "قطعة", purchasePrice: 500, wholesalePrice: 700, retailPrice: 920, quantity: 20, minStock: 4, hasExpiry: false, createdAt: today },
  { id: uid("p"), code: "TRE-002", name: "كاوتش 205/55R16 - هانكوك (صيني)", category: "كاوتش", unit: "قطعة", purchasePrice: 550, wholesalePrice: 770, retailPrice: 1000, quantity: 16, minStock: 4, hasExpiry: false, createdAt: today },
  { id: uid("p"), code: "TRE-003", name: "كاوتش 215/60R17 - شيري Tiggo 5/7", category: "كاوتش", unit: "قطعة", purchasePrice: 620, wholesalePrice: 860, retailPrice: 1120, quantity: 12, minStock: 4, hasExpiry: false, createdAt: today },
  { id: uid("p"), code: "TRE-004", name: "كاوتش 185/65R14 - BYD F3", category: "كاوتش", unit: "قطعة", purchasePrice: 380, wholesalePrice: 540, retailPrice: 710, quantity: 24, minStock: 4, hasExpiry: false, createdAt: today },

  // ===== أجزاء كهربائية =====
  { id: uid("p"), code: "ELC-001", name: "بطارية 60 أمبير - شاهين/جندور (Chinese brand)", category: "كهرباء", unit: "قطعة", purchasePrice: 350, wholesalePrice: 490, retailPrice: 650, quantity: 15, minStock: 3, hasExpiry: false, createdAt: today },
  { id: uid("p"), code: "ELC-002", name: "بطارية 70 أمبير - شيري Tiggo", category: "كهرباء", unit: "قطعة", purchasePrice: 420, wholesalePrice: 590, retailPrice: 770, quantity: 12, minStock: 3, hasExpiry: false, createdAt: today },
  { id: uid("p"), code: "ELC-003", name: "سلف (مارش) - شيري A15", category: "كهرباء", unit: "قطعة", purchasePrice: 380, wholesalePrice: 530, retailPrice: 700, quantity: 8, minStock: 2, hasExpiry: false, createdAt: today },
  { id: uid("p"), code: "ELC-004", name: "سلف (مارش) - BYD F3", category: "كهرباء", unit: "قطعة", purchasePrice: 350, wholesalePrice: 490, retailPrice: 650, quantity: 8, minStock: 2, hasExpiry: false, createdAt: today },

  // ===== أجزاء جسم السيارة =====
  { id: uid("p"), code: "BOD-001", name: "مراية باب جانبي (يمين) - شيري Tiggo 3", category: "جسم و هيكل", unit: "قطعة", purchasePrice: 180, wholesalePrice: 260, retailPrice: 350, quantity: 10, minStock: 3, hasExpiry: false, createdAt: today },
  { id: uid("p"), code: "BOD-002", name: "مراية باب جانبي (شمال) - BYD F3", category: "جسم و هيكل", unit: "قطعة", purchasePrice: 150, wholesalePrice: 220, retailPrice: 290, quantity: 12, minStock: 3, hasExpiry: false, createdAt: today },
  { id: uid("p"), code: "BOD-003", name: "شنطة كبوت أمامي - جيلي Emgrand EC7", category: "جسم و هيكل", unit: "قطعة", purchasePrice: 450, wholesalePrice: 630, retailPrice: 820, quantity: 4, minStock: 1, hasExpiry: false, createdAt: today },
  { id: uid("p"), code: "BOD-004", name: "باب أمامي (شمال) - شيري A15", category: "جسم و هيكل", unit: "قطعة", purchasePrice: 500, wholesalePrice: 700, retailPrice: 920, quantity: 3, minStock: 1, hasExpiry: false, createdAt: today },
  { id: uid("p"), code: "BOD-005", name: "بوجيهات مطر (Weatherstrip) طقم باب - شيري Tiggo", category: "جسم و هيكل", unit: "طقم", purchasePrice: 60, wholesalePrice: 90, retailPrice: 120, quantity: 20, minStock: 5, hasExpiry: false, createdAt: today },

  // ===== ناقل الحركة =====
  { id: uid("p"), code: "TRN-001", name: "طقم دبرياج (قابض) - شيري A15 (كلتش)", category: "ناقل حركة", unit: "طقم", purchasePrice: 500, wholesalePrice: 700, retailPrice: 920, quantity: 8, minStock: 2, hasExpiry: false, createdAt: today },
  { id: uid("p"), code: "TRN-002", name: "طقم دبرياج - BYD F3", category: "ناقل حركة", unit: "طقم", purchasePrice: 480, wholesalePrice: 670, retailPrice: 880, quantity: 8, minStock: 2, hasExpiry: false, createdAt: today },
  { id: uid("p"), code: "TRN-003", name: "زيت جيربوكس (علبة تروس) - 1 لتر", category: "ناقل حركة", unit: "لتر", purchasePrice: 40, wholesalePrice: 60, retailPrice: 80, quantity: 30, minStock: 10, hasExpiry: false, createdAt: today },
  { id: uid("p"), code: "TRN-004", name: "أكصورة (اكس) داخلية - شيري Tiggo", category: "ناقل حركة", unit: "قطعة", purchasePrice: 80, wholesalePrice: 120, retailPrice: 160, quantity: 15, minStock: 5, hasExpiry: false, createdAt: today },
];
export const seedProducts: Product[] = [
  ...legacySeedProducts.map(upgradeLegacyAutoPartsProduct),
  ...starterProductRows(today, (code) => `p_starter_${code.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`),
];
export const seedPurchaseInvoices: PurchaseInvoice[] = [];
export const seedSalesInvoices: SalesInvoice[] = [];
export const seedStockMovements: StockMovement[] = [];
export const seedCashEntries: CashEntry[] = [];
