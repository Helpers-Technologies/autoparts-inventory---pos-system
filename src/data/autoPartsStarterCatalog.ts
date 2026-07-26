import type { Product, ProductFitment, VehicleMake, VehicleModel } from "../types";

export const AUTO_PARTS_STARTER_CATALOG_VERSION = 3;

export type StarterFitmentSpec = {
  makeName: string;
  modelNames?: string[];
  yearFrom?: number;
  yearTo?: number;
};

type StarterProduct = Omit<Product, "id" | "createdAt"> & {
  fitments: StarterFitmentSpec[];
};

const LEGACY_NAME_CORRECTIONS: Record<string, string> = {
  "BRK-001": "طقم تيل فرامل أمامي — Chery A15",
  "BRK-002": "طقم أحذية فرامل خلفية — BYD F3",
  "BRK-003": "طقم تيل فرامل أمامي — Geely Emgrand EC7",
  "BRK-004": "ماستر فرامل عمومي — Chery Tiggo",
  "BRK-005": "سلك فرامل يد — BYD F3",
  "BRK-006": "طقم تيل فرامل أمامي — Geely Emgrand 7",
  "ENG-001": "طقم سير كاتينة — Chery A15 / QQ",
  "ENG-002": "طقم بوجيهات (4 قطع) — BYD F3",
  "ENG-004": "طقم سيور محرك — Chery Tiggo",
  "ENG-005": "كويل إشعال — BYD F3",
  "SUS-001": "مساعد أمامي — Chery Tiggo 5",
  "SUS-003": "سوستة أمامية — Geely Emgrand EC7",
  "SUS-004": "بيضة مقص (Ball Joint) — Chery A15",
  "SUS-006": "طقم جلب مقص — Chery Tiggo 3",
  "LGT-001": "طقم كلاكس عالي ومنخفض — Chery Tiggo",
  "LGT-003": "فانوس إشارة جانبي — Geely Emgrand",
  "LGT-004": "كشاف أمامي كامل — Chery A15",
  "GLS-001": "زجاج أمامي — BYD F3",
  "GLS-002": "زجاج باب أمامي شمال — Chery Tiggo 3",
  "GLS-003": "زجاج باب خلفي يمين — Geely Emgrand EC7",
  "TRE-001": "إطار Michelin مقاس 195/65R15",
  "TRE-002": "إطار Hankook مقاس 205/55R16",
  "ELC-001": "بطارية 60 أمبير — قطبية قياسية",
  "BOD-001": "مرآة باب يمين — Chery Tiggo 3",
  "BOD-002": "مرآة باب شمال — BYD F3",
  "BOD-003": "كبوت أمامي — Geely Emgrand EC7",
  "BOD-005": "طقم كاوتش أبواب (Weatherstrip) — Chery Tiggo",
  "TRN-001": "طقم دبرياج — Chery A15",
  "TRN-003": "زيت ناقل حركة يدوي GL-4 — عبوة 1 لتر",
  "TRN-004": "كوبلن داخلي — Chery Tiggo",
};

const RACK_BY_PREFIX: Record<string, string> = {
  FIL: "A",
  BRK: "B",
  CLR: "C",
  ENG: "D",
  SUS: "E",
  LGT: "F",
  GLS: "G",
  TRE: "H",
  ELC: "I",
  BOD: "J",
  TRN: "K",
};

function marketForLegacyProduct(product: Product): { partBrand: string; originCountry: string } {
  if (product.code === "TRE-001") return { partBrand: "Michelin", originCountry: "FR" };
  if (product.code === "TRE-002") return { partBrand: "Hankook", originCountry: "KR" };
  if (/شيري|Chery|BYD|جيلي|Geely/i.test(product.name)) {
    return { partBrand: "Aftermarket CN", originCountry: "CN" };
  }
  return { partBrand: "Aftermarket", originCountry: "" };
}

function installPosition(name: string): string | undefined {
  const positions = ["أمامي شمال", "أمامي يمين", "خلفي شمال", "خلفي يمين", "أمامي", "خلفي", "يمين", "شمال"];
  return positions.find((position) => name.includes(position));
}

/** Upgrade only untouched legacy demo rows; user-edited automotive data wins. */
export function upgradeLegacyAutoPartsProduct(product: Product): Product {
  const isLegacyDemo = /^[A-Z]{3}-\d{3}$/.test(product.code) &&
    !product.partBrand &&
    (!product.oemNumbers || product.oemNumbers.length === 0) &&
    (!product.partNumber || product.partNumber === product.code);
  if (!isLegacyDemo) return product;

  const market = marketForLegacyProduct(product);
  const [prefix, sequence = "00"] = product.code.split("-");
  const correctedName = LEGACY_NAME_CORRECTIONS[product.code] ?? product.name.replace(/\s+-\s+/g, " — ");
  return {
    ...product,
    name: correctedName,
    partNumber: `AP-${product.code}`,
    oemNumbers: [],
    partBrand: market.partBrand,
    manufacturer: market.partBrand,
    originCountry: market.originCountry || undefined,
    qualityGrade: "aftermarket-economy",
    condition: "new",
    position: installPosition(correctedName),
    rackLocation: `${RACK_BY_PREFIX[prefix] ?? "Z"}-${sequence.padStart(3, "0")}`,
    warrantyMonths: prefix === "ELC" ? 6 : prefix === "TRE" ? 12 : 3,
    reorderQuantity: Math.max(product.minStock * 2, 4),
  };
}

const common = {
  unit: "قطعة",
  purchasePrice: 0,
  wholesalePrice: 0,
  retailPrice: 0,
  quantity: 0,
  minStock: 2,
  hasExpiry: false,
  condition: "new" as const,
  archived: false,
  notes: "سجل كتالوج تمهيدي — يجب مطابقة رقم القطعة وVIN وكود المحرك قبل التسعير أو البيع.",
};

export const ADDITIONAL_STARTER_PRODUCTS: StarterProduct[] = [
  // Korean — Hyundai / Kia
  { ...common, code: "KOR-001", partNumber: "26300-35505", oemNumbers: ["26300-35504", "26300-35505"], name: "فلتر زيت محرك Hyundai / Kia", category: "فلاتر", partBrand: "Hyundai MOBIS", manufacturer: "Hyundai MOBIS", originCountry: "KR", qualityGrade: "oem", rackLocation: "KR-A-001", warrantyMonths: 3, reorderQuantity: 12, fitments: [{ makeName: "Hyundai", modelNames: ["Accent", "Elantra", "Tucson"] }, { makeName: "Kia", modelNames: ["Rio", "Cerato", "Sportage"] }] },
  { ...common, code: "KOR-002", partNumber: "28113-1R100", oemNumbers: ["28113-1R100"], name: "فلتر هواء محرك — Hyundai Accent (2011–2017)", category: "فلاتر", partBrand: "Hyundai MOBIS", manufacturer: "Hyundai MOBIS", originCountry: "KR", qualityGrade: "oem", rackLocation: "KR-A-002", warrantyMonths: 3, reorderQuantity: 10, fitments: [{ makeName: "Hyundai", modelNames: ["Accent"], yearFrom: 2011, yearTo: 2017 }] },
  { ...common, code: "KOR-003", partNumber: "28113-3X000", oemNumbers: ["28113-3X000"], name: "فلتر هواء محرك — Hyundai Elantra MD (2011–2015)", category: "فلاتر", partBrand: "Hyundai MOBIS", manufacturer: "Hyundai MOBIS", originCountry: "KR", qualityGrade: "oem", rackLocation: "KR-A-003", warrantyMonths: 3, reorderQuantity: 10, fitments: [{ makeName: "Hyundai", modelNames: ["Elantra"], yearFrom: 2011, yearTo: 2015 }] },
  { ...common, code: "KOR-004", partNumber: "28113-2S000", oemNumbers: ["28113-2S000"], name: "فلتر هواء محرك — Hyundai Tucson (2009–2015)", category: "فلاتر", partBrand: "Hyundai MOBIS", manufacturer: "Hyundai MOBIS", originCountry: "KR", qualityGrade: "oem", rackLocation: "KR-A-004", warrantyMonths: 3, reorderQuantity: 10, fitments: [{ makeName: "Hyundai", modelNames: ["Tucson"], yearFrom: 2009, yearTo: 2015 }] },
  { ...common, code: "KOR-005", partNumber: "KR-CABIN-ACCRIO", oemNumbers: [], name: "فلتر تكييف — Hyundai Accent / Kia Rio", category: "فلاتر", partBrand: "Aftermarket KR", manufacturer: "Aftermarket KR", originCountry: "KR", qualityGrade: "aftermarket-premium", rackLocation: "KR-A-005", warrantyMonths: 3, reorderQuantity: 10, fitments: [{ makeName: "Hyundai", modelNames: ["Accent"] }, { makeName: "Kia", modelNames: ["Rio"] }] },
  { ...common, code: "KOR-006", partNumber: "KR-BP-ACCRIO-F", oemNumbers: [], name: "طقم تيل فرامل أمامي — Accent / Rio", category: "فرامل", partBrand: "Sangsin HI-Q", manufacturer: "Sangsin Brake", originCountry: "KR", qualityGrade: "aftermarket-premium", position: "أمامي", rackLocation: "KR-B-001", warrantyMonths: 6, reorderQuantity: 8, fitments: [{ makeName: "Hyundai", modelNames: ["Accent"] }, { makeName: "Kia", modelNames: ["Rio"] }] },
  { ...common, code: "KOR-007", partNumber: "KR-BP-ELANCER-F", oemNumbers: [], name: "طقم تيل فرامل أمامي — Elantra / Cerato", category: "فرامل", partBrand: "Sangsin HI-Q", manufacturer: "Sangsin Brake", originCountry: "KR", qualityGrade: "aftermarket-premium", position: "أمامي", rackLocation: "KR-B-002", warrantyMonths: 6, reorderQuantity: 8, fitments: [{ makeName: "Hyundai", modelNames: ["Elantra"] }, { makeName: "Kia", modelNames: ["Cerato"] }] },
  { ...common, code: "KOR-008", partNumber: "KR-BP-TUCSPT-F", oemNumbers: [], name: "طقم تيل فرامل أمامي — Tucson / Sportage", category: "فرامل", partBrand: "Sangsin HI-Q", manufacturer: "Sangsin Brake", originCountry: "KR", qualityGrade: "aftermarket-premium", position: "أمامي", rackLocation: "KR-B-003", warrantyMonths: 6, reorderQuantity: 6, fitments: [{ makeName: "Hyundai", modelNames: ["Tucson"] }, { makeName: "Kia", modelNames: ["Sportage"] }] },
  { ...common, code: "KOR-009", partNumber: "KR-CTR-LINK-ACCRIO", oemNumbers: [], name: "وصلة ميزان أمامية — Accent / Rio", category: "عفشة و تعليق", partBrand: "CTR", manufacturer: "CTR", originCountry: "KR", qualityGrade: "aftermarket-premium", position: "أمامي", rackLocation: "KR-E-001", warrantyMonths: 6, reorderQuantity: 6, fitments: [{ makeName: "Hyundai", modelNames: ["Accent"] }, { makeName: "Kia", modelNames: ["Rio"] }] },
  { ...common, code: "KOR-010", partNumber: "KR-CTR-ARM-ELANCER", oemNumbers: [], name: "مقص أمامي — Elantra / Cerato", category: "عفشة و تعليق", partBrand: "CTR", manufacturer: "CTR", originCountry: "KR", qualityGrade: "aftermarket-premium", position: "أمامي", rackLocation: "KR-E-002", warrantyMonths: 6, reorderQuantity: 4, fitments: [{ makeName: "Hyundai", modelNames: ["Elantra"] }, { makeName: "Kia", modelNames: ["Cerato"] }] },
  { ...common, code: "KOR-011", partNumber: "KR-CTR-TIE-TUCSPT", oemNumbers: [], name: "طرف دركسيون — Tucson / Sportage", category: "عفشة و تعليق", partBrand: "CTR", manufacturer: "CTR", originCountry: "KR", qualityGrade: "aftermarket-premium", position: "أمامي", rackLocation: "KR-E-003", warrantyMonths: 6, reorderQuantity: 6, fitments: [{ makeName: "Hyundai", modelNames: ["Tucson"] }, { makeName: "Kia", modelNames: ["Sportage"] }] },
  { ...common, code: "KOR-012", partNumber: "18855-10060", oemNumbers: ["18855-10060"], name: "طقم بوجيهات (4 قطع) — Hyundai / Kia Gamma", category: "محرك", partBrand: "Hyundai MOBIS", manufacturer: "Hyundai MOBIS", originCountry: "KR", qualityGrade: "oem", rackLocation: "KR-D-001", warrantyMonths: 3, reorderQuantity: 10, unit: "طقم", fitments: [{ makeName: "Hyundai", modelNames: ["Accent", "Elantra"] }, { makeName: "Kia", modelNames: ["Rio", "Cerato"] }] },
  { ...common, code: "KOR-013", partNumber: "KR-COIL-GAMMA", oemNumbers: [], name: "كويل إشعال — Hyundai / Kia Gamma", category: "محرك", partBrand: "Mando", manufacturer: "HL Mando", originCountry: "KR", qualityGrade: "aftermarket-premium", rackLocation: "KR-D-002", warrantyMonths: 6, reorderQuantity: 8, fitments: [{ makeName: "Hyundai", modelNames: ["Accent", "Elantra"] }, { makeName: "Kia", modelNames: ["Rio", "Cerato"] }] },
  { ...common, code: "KOR-014", partNumber: "KR-WP-ACCRIO", oemNumbers: [], name: "طلمبة مياه — Accent / Rio", category: "تبريد", partBrand: "Mando", manufacturer: "HL Mando", originCountry: "KR", qualityGrade: "aftermarket-premium", rackLocation: "KR-C-001", warrantyMonths: 6, reorderQuantity: 4, fitments: [{ makeName: "Hyundai", modelNames: ["Accent"] }, { makeName: "Kia", modelNames: ["Rio"] }] },
  { ...common, code: "KOR-015", partNumber: "KR-CKP-GAMMA", oemNumbers: [], name: "حساس كرنك — Hyundai / Kia Gamma", category: "كهرباء", partBrand: "Mando", manufacturer: "HL Mando", originCountry: "KR", qualityGrade: "aftermarket-premium", rackLocation: "KR-I-001", warrantyMonths: 6, reorderQuantity: 6, fitments: [{ makeName: "Hyundai", modelNames: ["Accent", "Elantra"] }, { makeName: "Kia", modelNames: ["Rio", "Cerato"] }] },
  { ...common, code: "KOR-016", partNumber: "KR-CLUTCH-ACCRIO", oemNumbers: [], name: "طقم دبرياج — Accent / Rio", category: "ناقل حركة", partBrand: "PHC Valeo", manufacturer: "PHC Valeo", originCountry: "KR", qualityGrade: "aftermarket-premium", rackLocation: "KR-K-001", warrantyMonths: 6, reorderQuantity: 3, unit: "طقم", fitments: [{ makeName: "Hyundai", modelNames: ["Accent"] }, { makeName: "Kia", modelNames: ["Rio"] }] },
  { ...common, code: "KOR-017", partNumber: "KR-CLUTCH-ELANCER", oemNumbers: [], name: "طقم دبرياج — Elantra / Cerato", category: "ناقل حركة", partBrand: "PHC Valeo", manufacturer: "PHC Valeo", originCountry: "KR", qualityGrade: "aftermarket-premium", rackLocation: "KR-K-002", warrantyMonths: 6, reorderQuantity: 3, unit: "طقم", fitments: [{ makeName: "Hyundai", modelNames: ["Elantra"] }, { makeName: "Kia", modelNames: ["Cerato"] }] },
  { ...common, code: "KOR-018", partNumber: "HANKOOK-2055516", oemNumbers: [], name: "إطار Hankook مقاس 205/55R16", category: "كاوتش", partBrand: "Hankook", manufacturer: "Hankook Tire", originCountry: "KR", qualityGrade: "aftermarket-premium", rackLocation: "KR-H-001", warrantyMonths: 12, reorderQuantity: 4, fitments: [] },

  // Chinese — modern Egyptian-market models
  { ...common, code: "CHN-001", partNumber: "CN-CHERY-OF-T7P", oemNumbers: [], name: "فلتر زيت محرك — Chery Tiggo 7 Pro", category: "فلاتر", partBrand: "Aftermarket CN", manufacturer: "Aftermarket CN", originCountry: "CN", qualityGrade: "aftermarket-economy", rackLocation: "CN-A-001", warrantyMonths: 3, reorderQuantity: 10, fitments: [{ makeName: "Chery", modelNames: ["Tiggo 7 Pro"] }] },
  { ...common, code: "CHN-002", partNumber: "CN-CHERY-AF-T7P", oemNumbers: [], name: "فلتر هواء محرك — Chery Tiggo 7 Pro", category: "فلاتر", partBrand: "Aftermarket CN", manufacturer: "Aftermarket CN", originCountry: "CN", qualityGrade: "aftermarket-economy", rackLocation: "CN-A-002", warrantyMonths: 3, reorderQuantity: 10, fitments: [{ makeName: "Chery", modelNames: ["Tiggo 7 Pro"] }] },
  { ...common, code: "CHN-003", partNumber: "CN-MG-AF-MG5", oemNumbers: [], name: "فلتر هواء محرك — MG 5", category: "فلاتر", partBrand: "Aftermarket CN", manufacturer: "Aftermarket CN", originCountry: "CN", qualityGrade: "aftermarket-economy", rackLocation: "CN-A-003", warrantyMonths: 3, reorderQuantity: 10, fitments: [{ makeName: "MG", modelNames: ["MG 5"] }] },
  { ...common, code: "CHN-004", partNumber: "CN-MG-CF-ZS", oemNumbers: [], name: "فلتر تكييف — MG ZS", category: "فلاتر", partBrand: "Aftermarket CN", manufacturer: "Aftermarket CN", originCountry: "CN", qualityGrade: "aftermarket-economy", rackLocation: "CN-A-004", warrantyMonths: 3, reorderQuantity: 10, fitments: [{ makeName: "MG", modelNames: ["MG ZS"] }] },
  { ...common, code: "CHN-005", partNumber: "CN-JETOUR-AF-X70", oemNumbers: [], name: "فلتر هواء محرك — Jetour X70", category: "فلاتر", partBrand: "Aftermarket CN", manufacturer: "Aftermarket CN", originCountry: "CN", qualityGrade: "aftermarket-economy", rackLocation: "CN-A-005", warrantyMonths: 3, reorderQuantity: 8, fitments: [{ makeName: "Jetour", modelNames: ["X70", "X70 Plus"] }] },
  { ...common, code: "CHN-006", partNumber: "CN-BP-T7P-F", oemNumbers: [], name: "طقم تيل فرامل أمامي — Chery Tiggo 7 Pro", category: "فرامل", partBrand: "Aftermarket CN", manufacturer: "Aftermarket CN", originCountry: "CN", qualityGrade: "aftermarket-economy", position: "أمامي", rackLocation: "CN-B-001", warrantyMonths: 3, reorderQuantity: 6, fitments: [{ makeName: "Chery", modelNames: ["Tiggo 7 Pro"] }] },
  { ...common, code: "CHN-007", partNumber: "CN-BP-MG5-F", oemNumbers: [], name: "طقم تيل فرامل أمامي — MG 5", category: "فرامل", partBrand: "Aftermarket CN", manufacturer: "Aftermarket CN", originCountry: "CN", qualityGrade: "aftermarket-economy", position: "أمامي", rackLocation: "CN-B-002", warrantyMonths: 3, reorderQuantity: 6, fitments: [{ makeName: "MG", modelNames: ["MG 5"] }] },
  { ...common, code: "CHN-008", partNumber: "CN-BP-JOLION-F", oemNumbers: [], name: "طقم تيل فرامل أمامي — Haval Jolion", category: "فرامل", partBrand: "Aftermarket CN", manufacturer: "Aftermarket CN", originCountry: "CN", qualityGrade: "aftermarket-economy", position: "أمامي", rackLocation: "CN-B-003", warrantyMonths: 3, reorderQuantity: 6, fitments: [{ makeName: "Haval", modelNames: ["Jolion"] }] },
  { ...common, code: "CHN-009", partNumber: "CN-ARM-T7-F", oemNumbers: [], name: "مقص أمامي — Chery Tiggo 7", category: "عفشة و تعليق", partBrand: "Aftermarket CN", manufacturer: "Aftermarket CN", originCountry: "CN", qualityGrade: "aftermarket-economy", position: "أمامي", rackLocation: "CN-E-001", warrantyMonths: 6, reorderQuantity: 4, fitments: [{ makeName: "Chery", modelNames: ["Tiggo 7", "Tiggo 7 Pro"] }] },
  { ...common, code: "CHN-010", partNumber: "CN-LINK-MG5-F", oemNumbers: [], name: "وصلة ميزان أمامية — MG 5", category: "عفشة و تعليق", partBrand: "Aftermarket CN", manufacturer: "Aftermarket CN", originCountry: "CN", qualityGrade: "aftermarket-economy", position: "أمامي", rackLocation: "CN-E-002", warrantyMonths: 6, reorderQuantity: 6, fitments: [{ makeName: "MG", modelNames: ["MG 5"] }] },
  { ...common, code: "CHN-011", partNumber: "CN-SHOCK-EMGRAND-F", oemNumbers: [], name: "مساعد أمامي — Geely Emgrand", category: "عفشة و تعليق", partBrand: "Aftermarket CN", manufacturer: "Aftermarket CN", originCountry: "CN", qualityGrade: "aftermarket-economy", position: "أمامي", rackLocation: "CN-E-003", warrantyMonths: 6, reorderQuantity: 4, fitments: [{ makeName: "Geely", modelNames: ["Emgrand", "Emgrand 7"] }] },
  { ...common, code: "CHN-012", partNumber: "CN-COIL-T7P", oemNumbers: [], name: "كويل إشعال — Chery Tiggo 7 Pro", category: "محرك", partBrand: "Aftermarket CN", manufacturer: "Aftermarket CN", originCountry: "CN", qualityGrade: "aftermarket-economy", rackLocation: "CN-D-001", warrantyMonths: 6, reorderQuantity: 6, fitments: [{ makeName: "Chery", modelNames: ["Tiggo 7 Pro"] }] },
  { ...common, code: "CHN-013", partNumber: "CN-SPARK-MG5-SET", oemNumbers: [], name: "طقم بوجيهات (4 قطع) — MG 5", category: "محرك", partBrand: "Aftermarket CN", manufacturer: "Aftermarket CN", originCountry: "CN", qualityGrade: "aftermarket-economy", rackLocation: "CN-D-002", warrantyMonths: 3, reorderQuantity: 8, unit: "طقم", fitments: [{ makeName: "MG", modelNames: ["MG 5"] }] },
  { ...common, code: "CHN-014", partNumber: "CN-WP-X70", oemNumbers: [], name: "طلمبة مياه — Jetour X70", category: "تبريد", partBrand: "Aftermarket CN", manufacturer: "Aftermarket CN", originCountry: "CN", qualityGrade: "aftermarket-economy", rackLocation: "CN-C-001", warrantyMonths: 6, reorderQuantity: 4, fitments: [{ makeName: "Jetour", modelNames: ["X70", "X70 Plus"] }] },
  { ...common, code: "CHN-015", partNumber: "CN-CKP-JOLION", oemNumbers: [], name: "حساس كرنك — Haval Jolion", category: "كهرباء", partBrand: "Aftermarket CN", manufacturer: "Aftermarket CN", originCountry: "CN", qualityGrade: "aftermarket-economy", rackLocation: "CN-I-001", warrantyMonths: 6, reorderQuantity: 4, fitments: [{ makeName: "Haval", modelNames: ["Jolion"] }] },
  { ...common, code: "CHN-016", partNumber: "CN-CLUTCH-ARRIZO5", oemNumbers: [], name: "طقم دبرياج — Chery Arrizo 5", category: "ناقل حركة", partBrand: "Aftermarket CN", manufacturer: "Aftermarket CN", originCountry: "CN", qualityGrade: "aftermarket-economy", rackLocation: "CN-K-001", warrantyMonths: 6, reorderQuantity: 3, unit: "طقم", fitments: [{ makeName: "Chery", modelNames: ["Arrizo 5"] }] },
  { ...common, code: "CHN-017", partNumber: "CN-MIRROR-MG5-R", oemNumbers: [], name: "مرآة باب يمين — MG 5", category: "جسم و هيكل", partBrand: "Aftermarket CN", manufacturer: "Aftermarket CN", originCountry: "CN", qualityGrade: "aftermarket-economy", position: "يمين", rackLocation: "CN-J-001", warrantyMonths: 3, reorderQuantity: 2, fitments: [{ makeName: "MG", modelNames: ["MG 5"] }] },
  { ...common, code: "CHN-018", partNumber: "CN-HEADLAMP-T7P-R", oemNumbers: [], name: "كشاف أمامي يمين — Chery Tiggo 7 Pro", category: "إضاءة و كهرباء", partBrand: "Aftermarket CN", manufacturer: "Aftermarket CN", originCountry: "CN", qualityGrade: "aftermarket-economy", position: "أمامي يمين", rackLocation: "CN-F-001", warrantyMonths: 3, reorderQuantity: 2, fitments: [{ makeName: "Chery", modelNames: ["Tiggo 7 Pro"] }] },

  // OEM manufacturer brands — genuine-manufacture parts (in the manufacturer's own
  // commercial box, not the car brand's agency box) — Bosch, Denso, NGK, Valeo, Mahle...
  { ...common, code: "OEM-001", partNumber: "BOSCH-SP-COROLLA", oemNumbers: [], name: "طقم بوجيهات (4 قطع) Bosch — Toyota Corolla", category: "محرك", unit: "طقم", partBrand: "Bosch", manufacturer: "Bosch", originCountry: "DE", qualityGrade: "oem", rackLocation: "OE-D-001", warrantyMonths: 12, reorderQuantity: 8, fitments: [{ makeName: "Toyota", modelNames: ["Corolla"] }] },
  { ...common, code: "OEM-002", partNumber: "BOSCH-OF-COROLLA-YARIS", oemNumbers: [], name: "فلتر زيت محرك Bosch — Toyota Corolla / Yaris", category: "فلاتر", partBrand: "Bosch", manufacturer: "Bosch", originCountry: "DE", qualityGrade: "oem", rackLocation: "OE-A-001", warrantyMonths: 6, reorderQuantity: 12, fitments: [{ makeName: "Toyota", modelNames: ["Corolla", "Yaris"] }] },
  { ...common, code: "OEM-003", partNumber: "BOSCH-AF-ELANTRA", oemNumbers: [], name: "فلتر هواء محرك Bosch — Hyundai Elantra", category: "فلاتر", partBrand: "Bosch", manufacturer: "Bosch", originCountry: "DE", qualityGrade: "oem", rackLocation: "OE-A-002", warrantyMonths: 6, reorderQuantity: 10, fitments: [{ makeName: "Hyundai", modelNames: ["Elantra"] }] },
  { ...common, code: "OEM-004", partNumber: "BOSCH-BP-COROLLA-F", oemNumbers: [], name: "طقم تيل فرامل أمامي Bosch — Toyota Corolla", category: "فرامل", partBrand: "Bosch", manufacturer: "Bosch", originCountry: "DE", qualityGrade: "oem", position: "أمامي", rackLocation: "OE-B-001", warrantyMonths: 12, reorderQuantity: 8, fitments: [{ makeName: "Toyota", modelNames: ["Corolla"] }] },
  { ...common, code: "OEM-005", partNumber: "BOSCH-WIPER-SET-UNIV", oemNumbers: [], name: "طقم مساحات زجاج أمامي Bosch — مقاس عام", category: "زجاج", unit: "طقم", partBrand: "Bosch", manufacturer: "Bosch", originCountry: "DE", qualityGrade: "oem", rackLocation: "OE-G-001", warrantyMonths: 6, reorderQuantity: 10, fitments: [] },
  { ...common, code: "OEM-006", partNumber: "BOSCH-ALT-ELANTRA", oemNumbers: [], name: "دينامو (Alternator) Bosch — Hyundai Elantra", category: "إضاءة و كهرباء", partBrand: "Bosch", manufacturer: "Bosch", originCountry: "DE", qualityGrade: "oem", rackLocation: "OE-I-001", warrantyMonths: 12, reorderQuantity: 2, fitments: [{ makeName: "Hyundai", modelNames: ["Elantra"] }] },
  { ...common, code: "OEM-007", partNumber: "BOSCH-FP-TIGGO7P", oemNumbers: [], name: "طرمبة بنزين Bosch — Chery Tiggo 7 Pro", category: "محرك", partBrand: "Bosch", manufacturer: "Bosch", originCountry: "DE", qualityGrade: "oem", rackLocation: "OE-D-002", warrantyMonths: 12, reorderQuantity: 3, fitments: [{ makeName: "Chery", modelNames: ["Tiggo 7 Pro"] }] },
  { ...common, code: "OEM-008", partNumber: "DENSO-SP-IRID-COROLLA", oemNumbers: [], name: "طقم بوجيهات إيريديوم (4 قطع) Denso — Toyota Corolla", category: "محرك", unit: "طقم", partBrand: "Denso", manufacturer: "Denso", originCountry: "JP", qualityGrade: "oem", rackLocation: "OE-D-003", warrantyMonths: 12, reorderQuantity: 6, fitments: [{ makeName: "Toyota", modelNames: ["Corolla"] }] },
  { ...common, code: "OEM-009", partNumber: "DENSO-ACCOMP-SUNNY", oemNumbers: [], name: "كمبروسر تكييف Denso — Nissan Sunny", category: "تبريد", partBrand: "Denso", manufacturer: "Denso", originCountry: "JP", qualityGrade: "oem", rackLocation: "OE-C-001", warrantyMonths: 12, reorderQuantity: 2, fitments: [{ makeName: "Nissan", modelNames: ["Sunny"] }] },
  { ...common, code: "OEM-010", partNumber: "DENSO-ALT-YARIS", oemNumbers: [], name: "دينامو (Alternator) Denso — Toyota Yaris", category: "إضاءة و كهرباء", partBrand: "Denso", manufacturer: "Denso", originCountry: "JP", qualityGrade: "oem", rackLocation: "OE-I-002", warrantyMonths: 12, reorderQuantity: 2, fitments: [{ makeName: "Toyota", modelNames: ["Yaris"] }] },
  { ...common, code: "OEM-011", partNumber: "NGK-SP-MGZS", oemNumbers: [], name: "طقم بوجيهات (4 قطع) NGK — MG ZS", category: "محرك", unit: "طقم", partBrand: "NGK", manufacturer: "NGK", originCountry: "JP", qualityGrade: "oem", rackLocation: "OE-D-004", warrantyMonths: 12, reorderQuantity: 8, fitments: [{ makeName: "MG", modelNames: ["MG ZS"] }] },
  { ...common, code: "OEM-012", partNumber: "NGK-COIL-TIGGO7P", oemNumbers: [], name: "بوبينة إشعال NGK — Chery Tiggo 7 Pro", category: "محرك", partBrand: "NGK", manufacturer: "NGK", originCountry: "JP", qualityGrade: "oem", rackLocation: "OE-D-005", warrantyMonths: 6, reorderQuantity: 6, fitments: [{ makeName: "Chery", modelNames: ["Tiggo 7 Pro"] }] },
  { ...common, code: "OEM-013", partNumber: "VALEO-CLUTCH-LOGAN", oemNumbers: [], name: "طقم دبرياج Valeo — Renault Logan", category: "ناقل حركة", unit: "طقم", partBrand: "Valeo", manufacturer: "Valeo", originCountry: "FR", qualityGrade: "oem", rackLocation: "OE-K-001", warrantyMonths: 12, reorderQuantity: 3, fitments: [{ makeName: "Renault", modelNames: ["Logan"] }] },
  { ...common, code: "OEM-014", partNumber: "VALEO-HEADLAMP-301-R", oemNumbers: [], name: "كشاف أمامي يمين Valeo — Peugeot 301", category: "إضاءة و كهرباء", partBrand: "Valeo", manufacturer: "Valeo", originCountry: "FR", qualityGrade: "oem", position: "أمامي يمين", rackLocation: "OE-F-001", warrantyMonths: 6, reorderQuantity: 2, fitments: [{ makeName: "Peugeot", modelNames: ["301"] }] },
  { ...common, code: "OEM-015", partNumber: "MAHLE-OF-GOLF", oemNumbers: [], name: "فلتر زيت محرك Mahle — Volkswagen Golf", category: "فلاتر", partBrand: "Mahle", manufacturer: "Mahle", originCountry: "DE", qualityGrade: "oem", rackLocation: "OE-A-003", warrantyMonths: 6, reorderQuantity: 10, fitments: [{ makeName: "Volkswagen", modelNames: ["Golf"] }] },
  { ...common, code: "OEM-016", partNumber: "MAHLE-WP-3SERIES", oemNumbers: [], name: "طلمبة مياه Mahle — BMW 3 Series", category: "تبريد", partBrand: "Mahle", manufacturer: "Mahle", originCountry: "DE", qualityGrade: "oem", rackLocation: "OE-C-002", warrantyMonths: 12, reorderQuantity: 2, fitments: [{ makeName: "BMW", modelNames: ["3 Series"] }] },
  { ...common, code: "OEM-017", partNumber: "MANN-AF-CCLASS", oemNumbers: [], name: "فلتر هواء محرك Mann-Filter — Mercedes-Benz C-Class", category: "فلاتر", partBrand: "Mann-Filter", manufacturer: "Mann-Filter", originCountry: "DE", qualityGrade: "oem", rackLocation: "OE-A-004", warrantyMonths: 6, reorderQuantity: 8, fitments: [{ makeName: "Mercedes-Benz", modelNames: ["C-Class"] }] },
  { ...common, code: "OEM-018", partNumber: "MANN-CF-PASSAT", oemNumbers: [], name: "فلتر تكييف (كابينة) Mann-Filter — Volkswagen Passat", category: "فلاتر", partBrand: "Mann-Filter", manufacturer: "Mann-Filter", originCountry: "DE", qualityGrade: "oem", rackLocation: "OE-A-005", warrantyMonths: 6, reorderQuantity: 8, fitments: [{ makeName: "Volkswagen", modelNames: ["Passat"] }] },
  { ...common, code: "OEM-019", partNumber: "SACHS-SHOCK-OPTRA-F", oemNumbers: [], name: "مساعد أمامي Sachs — Chevrolet Optra", category: "عفشة و تعليق", partBrand: "Sachs", manufacturer: "Sachs", originCountry: "DE", qualityGrade: "oem", position: "أمامي", rackLocation: "OE-E-001", warrantyMonths: 12, reorderQuantity: 4, fitments: [{ makeName: "Chevrolet", modelNames: ["Optra"] }] },
  { ...common, code: "OEM-020", partNumber: "ACDELCO-BAT60-AVEO", oemNumbers: [], name: "بطارية 60 أمبير ACDelco — Chevrolet Aveo", category: "إضاءة و كهرباء", partBrand: "ACDelco", manufacturer: "ACDelco", originCountry: "US", qualityGrade: "oem", rackLocation: "OE-I-003", warrantyMonths: 18, reorderQuantity: 3, fitments: [{ makeName: "Chevrolet", modelNames: ["Aveo"] }] },
];

export function starterProductRows(now: string, makeId: (code: string) => string): Product[] {
  return ADDITIONAL_STARTER_PRODUCTS.map(({ fitments: _fitments, ...product }) => ({
    ...product,
    id: makeId(product.code),
    createdAt: now,
  }));
}

export function mergeAutoPartsStarterCatalog(existing: Product[], seed: Product[]): Product[] {
  const seedByCode = new Map(seed.map((product) => [product.code, product]));
  const upgraded = existing.map((product) => {
    const catalogRow = seedByCode.get(product.code);
    const corrected = upgradeLegacyAutoPartsProduct(product);
    const isManagedStarterRow = /^(KOR|CHN|OEM)-\d+$/.test(product.code);
    if (!catalogRow || (corrected === product && !isManagedStarterRow)) return corrected;
    return {
      ...corrected,
      name: catalogRow.name,
      category: catalogRow.category,
      unit: catalogRow.unit,
      partNumber: catalogRow.partNumber,
      oemNumbers: catalogRow.oemNumbers,
      partBrand: catalogRow.partBrand,
      manufacturer: catalogRow.manufacturer,
      originCountry: catalogRow.originCountry,
      qualityGrade: catalogRow.qualityGrade,
      condition: catalogRow.condition,
      position: catalogRow.position,
      rackLocation: catalogRow.rackLocation,
      warrantyMonths: catalogRow.warrantyMonths,
      reorderQuantity: catalogRow.reorderQuantity,
      notes: product.notes?.trim() || catalogRow.notes,
    };
  });
  const existingCodes = new Set(existing.map((product) => product.code));
  return [...upgraded, ...seed.filter((product) => !existingCodes.has(product.code))];
}

function inferredLegacyFitments(product: Product): StarterFitmentSpec[] {
  const text = product.name;
  if (/شيري|Chery/i.test(text)) {
    const models: string[] = [];
    if (/A15/i.test(text)) models.push("A15");
    if (/S11|QQ/i.test(text)) models.push("QQ");
    for (const number of [2, 3, 5, 7, 8]) {
      if (new RegExp(`Tiggo\\s*${number}`, "i").test(text)) models.push(`Tiggo ${number}`);
    }
    return [{ makeName: "Chery", modelNames: models.length ? models : undefined }];
  }
  if (/BYD/i.test(text)) {
    const models = ["F3", "L3"].filter((model) => new RegExp(`\\b${model}\\b`, "i").test(text));
    return [{ makeName: "BYD", modelNames: models.length ? models : undefined }];
  }
  if (/جيلي|Geely/i.test(text)) {
    return [{ makeName: "Geely", modelNames: ["Emgrand", "Emgrand 7"] }];
  }
  return [];
}

export function buildStarterProductFitments(
  products: Product[],
  makes: VehicleMake[],
  models: VehicleModel[],
  existing: ProductFitment[],
): ProductFitment[] {
  const now = new Date().toISOString();
  const makeByName = new Map(makes.map((make) => [make.name.toLowerCase(), make]));
  // Generated links are replaceable catalog data. User-created links always win.
  const productIds = new Set(products.map((product) => product.id));
  const preserved = existing.filter(
    (fitment) => productIds.has(fitment.productId) && !fitment.id.startsWith("starter_fitment_"),
  );
  const existingProductIds = new Set(preserved.map((fitment) => fitment.productId));
  const specsByCode = new Map(ADDITIONAL_STARTER_PRODUCTS.map((product) => [product.code, product.fitments]));
  const additions: ProductFitment[] = [];

  for (const product of products) {
    if (existingProductIds.has(product.id)) continue;
    const specs = specsByCode.get(product.code) ?? inferredLegacyFitments(product);
    for (const spec of specs) {
      const make = makeByName.get(spec.makeName.toLowerCase());
      if (!make) continue;
      const matchingModels = spec.modelNames?.length
        ? models.filter((model) => model.makeId === make.id && spec.modelNames!.some((name) => name.toLowerCase() === model.name.toLowerCase()))
        : [];
      const targets = matchingModels.length ? matchingModels : [undefined];
      for (const model of targets) {
        additions.push({
          id: `starter_fitment_${product.id}_${model?.id ?? make.id}`,
          productId: product.id,
          makeId: make.id,
          modelId: model?.id,
          yearFrom: spec.yearFrom,
          yearTo: spec.yearTo,
          createdAt: now,
        });
      }
    }
  }

  // Keep deterministic order and guard against accidental duplicate specs.
  const byId = new Map(preserved.map((fitment) => [fitment.id, fitment]));
  for (const fitment of additions) if (!byId.has(fitment.id)) byId.set(fitment.id, fitment);
  return [...byId.values()];
}
