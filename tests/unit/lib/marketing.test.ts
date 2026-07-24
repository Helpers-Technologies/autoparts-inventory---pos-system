import { describe, expect, it } from "vitest";
import {
  buildCategoryInsights,
  buildCustomerMarketingProfiles,
  normalizeMarketingPhone,
  renderMarketingMessage,
  selectMarketingAudience,
  summarizeMarketingProfiles,
  type CustomerMarketingProfile,
} from "../../../src/lib/marketing";
import type {
  Customer,
  InvoiceLine,
  Product,
  ReturnLine,
  SalesInvoice,
  SalesReturn,
} from "../../../src/types";

function customer(
  id: string,
  overrides: Partial<Customer> = {},
): Customer {
  return {
    id,
    name: `عميل ${id}`,
    createdAt: "2026-01-01",
    ...overrides,
  };
}

function product(
  id: string,
  category: string,
  overrides: Partial<Product> = {},
): Product {
  return {
    id,
    code: id,
    name: `منتج ${id}`,
    category,
    unit: "قطعة",
    purchasePrice: 10,
    wholesalePrice: 15,
    retailPrice: 20,
    quantity: 10,
    minStock: 1,
    hasExpiry: false,
    createdAt: "2026-01-01",
    ...overrides,
  };
}

function invoiceLine(
  productId: string,
  quantity: number,
  price: number,
  overrides: Partial<InvoiceLine> = {},
): InvoiceLine {
  return {
    id: `${productId}-${quantity}-${price}`,
    productId,
    productName: `منتج ${productId}`,
    unit: "قطعة",
    quantity,
    price,
    subtotal: quantity * price,
    ...overrides,
  };
}

function invoice(
  id: string,
  customerId: string,
  date: string,
  lines: InvoiceLine[],
  overrides: Partial<SalesInvoice> = {},
): SalesInvoice {
  const total = lines.reduce((sum, line) => sum + line.subtotal, 0);
  return {
    id,
    invoiceNumber: id,
    date,
    customerId,
    customerName: `عميل ${customerId}`,
    lines,
    total,
    amountReceived: total,
    remaining: 0,
    paymentType: "cash",
    priceType: "retail",
    status: "paid",
    createdAt: `${date}T12:00:00.000Z`,
    ...overrides,
  };
}

function returnLine(
  productId: string,
  quantity: number,
  price: number,
  overrides: Partial<ReturnLine> = {},
): ReturnLine {
  return {
    id: `return-${productId}-${quantity}-${price}`,
    productId,
    productName: `منتج ${productId}`,
    unit: "قطعة",
    quantity,
    price,
    subtotal: quantity * price,
    ...overrides,
  };
}

function salesReturn(
  id: string,
  originalInvoiceId: string,
  customerId: string,
  lines: ReturnLine[],
  overrides: Partial<SalesReturn> = {},
): SalesReturn {
  const total = lines.reduce((sum, line) => sum + line.subtotal, 0);
  return {
    id,
    returnNumber: id,
    date: "2026-06-30",
    originalInvoiceId,
    originalInvoiceNumber: originalInvoiceId,
    customerId,
    customerName: `عميل ${customerId}`,
    lines,
    total,
    refundCash: true,
    createdAt: "2026-06-30T12:00:00.000Z",
    ...overrides,
  };
}

function singleLineInvoice(
  id: string,
  customerId: string,
  date: string,
  total: number,
  overrides: Partial<SalesInvoice> = {},
): SalesInvoice {
  return invoice(
    id,
    customerId,
    date,
    [invoiceLine("P-GENERAL", 1, total)],
    overrides,
  );
}

describe("normalizeMarketingPhone", () => {
  it.each([
    ["010 1234 5678", "201012345678"],
    ["+20 (101) 234-5678", "201012345678"],
    ["00201012345678", "201012345678"],
    ["1234567890", "1234567890"],
  ])("normalizes a reachable phone %s", (input, expected) => {
    expect(normalizeMarketingPhone(input)).toBe(expected);
  });

  it.each([undefined, "", "12345", "1234567890123456"])(
    "rejects an empty or unusable phone: %s",
    (input) => {
      expect(normalizeMarketingPhone(input)).toBeUndefined();
    },
  );

  it("rejects an invalid number even when it starts with the international 00 prefix", () => {
    expect(normalizeMarketingPhone("001")).toBeUndefined();
  });
});

describe("buildCustomerMarketingProfiles", () => {
  it("uses only active invoices, subtracts returns of active originals, and excludes archived customers", () => {
    const products = [
      product("P-BRAKE", "فرامل", { name: "تيل فرامل" }),
      product("P-OIL", "زيوت", { name: "زيت محرك" }),
    ];
    const customers = [
      customer("C1", { phone: "01012345678" }),
      customer("ARCHIVED", { archived: true }),
    ];
    const older = invoice(
      "INV-OLD",
      "C1",
      "2026-01-10",
      [
        invoiceLine("P-BRAKE", 2, 100, { productName: "تيل فرامل" }),
        invoiceLine("P-OIL", 1, 100, { productName: "زيت محرك" }),
      ],
      { vehicleLabel: "هيونداي إلنترا", branchName: "الفرع الرئيسي" },
    );
    const newer = invoice(
      "INV-NEW",
      "C1",
      "2026-03-10",
      [invoiceLine("P-BRAKE", 2, 100, { productName: "تيل فرامل" })],
      { vehicleLabel: "هيونداي إلنترا", branchName: "فرع المدينة" },
    );
    const cancelled = singleLineInvoice(
      "INV-CANCELLED",
      "C1",
      "2026-04-09",
      5_000,
      { cancelled: true, vehicleLabel: "سيارة ملغاة", branchName: "فرع ملغى" },
    );
    const archivedCustomerInvoice = singleLineInvoice(
      "INV-ARCHIVED",
      "ARCHIVED",
      "2026-03-01",
      1_000,
    );
    const returns = [
      salesReturn("RET-ACTIVE", older.id, "C1", [returnLine("P-BRAKE", 1, 75)]),
      salesReturn("RET-CANCELLED", cancelled.id, "C1", [returnLine("P-GENERAL", 1, 1_000)]),
    ];

    const profiles = buildCustomerMarketingProfiles(
      customers,
      // Deliberately unordered: the implementation must establish chronology.
      [cancelled, newer, archivedCustomerInvoice, older],
      returns,
      products,
      "2026-04-10",
    );

    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({
      invoiceCount: 2,
      netRevenue: 425,
      averageOrderValue: 212.5,
      firstPurchaseDate: "2026-01-10",
      lastPurchaseDate: "2026-03-10",
      daysSinceLastPurchase: 31,
      topCategory: "فرامل",
      topProduct: "تيل فرامل",
      vehicleLabels: ["هيونداي إلنترا"],
      branchNames: ["الفرع الرئيسي", "فرع المدينة"],
      normalizedPhone: "201012345678",
      hasReachablePhone: true,
    });
    expect(profiles[0].vehicleLabels).not.toContain("سيارة ملغاة");
    expect(profiles[0].branchNames).not.toContain("فرع ملغى");
  });

  it("assigns VIP, loyal, new, active, at-risk, dormant, and lead segments", () => {
    const customers = [
      customer("VIP"),
      customer("LOYAL"),
      customer("NEW"),
      customer("ACTIVE"),
      customer("RISK"),
      customer("DORMANT"),
      customer("LEAD"),
    ];
    const invoices = [
      singleLineInvoice("VIP-1", "VIP", "2026-04-01", 300),
      singleLineInvoice("VIP-2", "VIP", "2026-06-01", 300),
      singleLineInvoice("VIP-3", "VIP", "2026-06-20", 300),
      singleLineInvoice("LOYAL-1", "LOYAL", "2026-03-01", 100),
      singleLineInvoice("LOYAL-2", "LOYAL", "2026-06-01", 100),
      singleLineInvoice("LOYAL-3", "LOYAL", "2026-06-20", 100),
      singleLineInvoice("NEW-1", "NEW", "2026-06-25", 150),
      singleLineInvoice("ACTIVE-1", "ACTIVE", "2026-05-17", 100),
      singleLineInvoice("RISK-1", "RISK", "2026-02-01", 200),
      singleLineInvoice("RISK-2", "RISK", "2026-04-02", 200),
      singleLineInvoice("DORMANT-1", "DORMANT", "2026-01-01", 50),
    ];

    const profiles = buildCustomerMarketingProfiles(
      customers,
      invoices,
      [],
      [product("P-GENERAL", "عام")],
      "2026-07-01",
    );
    const segments = Object.fromEntries(
      profiles.map((profile) => [profile.customer.id, profile.segment]),
    );

    expect(segments).toEqual({
      VIP: "vip",
      LOYAL: "loyal",
      NEW: "new",
      ACTIVE: "active",
      RISK: "at_risk",
      DORMANT: "dormant",
      LEAD: "lead",
    });

    const summary = summarizeMarketingProfiles(profiles);
    expect(summary).toMatchObject({
      customerCount: 7,
      purchasingCustomerCount: 6,
      invoiceCount: 11,
      netRevenue: 1_900,
      averageOrderValue: 1_900 / 11,
      repeatCustomerRate: 0.5,
      unknownConsent: 7,
      atRiskRevenue: 450,
      segmentCounts: {
        vip: 1,
        loyal: 1,
        new: 1,
        active: 1,
        at_risk: 1,
        dormant: 1,
        lead: 1,
      },
    });
  });

  it("never reports negative customer revenue after oversized returns", () => {
    const activeInvoice = singleLineInvoice("INV-1", "C1", "2026-06-01", 100);
    const profiles = buildCustomerMarketingProfiles(
      [customer("C1")],
      [activeInvoice],
      [salesReturn("RET-1", activeInvoice.id, "C1", [returnLine("P-GENERAL", 2, 100)])],
      [product("P-GENERAL", "عام")],
      "2026-07-01",
    );

    expect(profiles[0].netRevenue).toBe(0);
    expect(profiles[0].averageOrderValue).toBe(0);
  });

  it("keeps recent repeat customers out of at-risk and moves stale high-value customers to dormant", () => {
    const recentInvoices = [
      singleLineInvoice("RECENT-1", "RECENT", "2026-04-01", 100),
      singleLineInvoice("RECENT-2", "RECENT", "2026-06-30", 100),
    ];
    const staleInvoices = [
      singleLineInvoice("STALE-1", "STALE", "2025-10-01", 10_000),
      singleLineInvoice("STALE-2", "STALE", "2025-11-01", 10_000),
      singleLineInvoice("STALE-3", "STALE", "2026-01-01", 10_000),
    ];
    const profiles = buildCustomerMarketingProfiles(
      [customer("RECENT"), customer("STALE")],
      [...recentInvoices, ...staleInvoices],
      [],
      [product("P-GENERAL", "عام")],
      "2026-07-01",
    );
    const segments = Object.fromEntries(profiles.map((profile) => [profile.customer.id, profile.segment]));

    expect(segments.RECENT).toBe("active");
    expect(segments.STALE).toBe("dormant");
  });
});

describe("selectMarketingAudience", () => {
  const customers = [
    customer("OPTED-IN", { phone: "01011111111", marketingConsent: "opted_in" }),
    customer("UNKNOWN", { phone: "+20 102 222 2222", marketingConsent: "unknown" }),
    customer("UNSET", { phone: "01033333333" }),
    customer("OPTED-OUT", { phone: "01044444444", marketingConsent: "opted_out" }),
    customer("BAD-PHONE", { phone: "12345", marketingConsent: "opted_in" }),
  ];
  const profiles = buildCustomerMarketingProfiles(
    customers,
    [],
    [],
    [],
    "2026-07-01",
  );

  it("defaults to reachable opted-in customers only", () => {
    expect(
      selectMarketingAudience(profiles, "all", false).map((profile) => profile.customer.id),
    ).toEqual(["OPTED-IN"]);
  });

  it("can include reachable unknown consent, but never opt-outs or invalid phones", () => {
    expect(
      selectMarketingAudience(profiles, "all", true).map((profile) => profile.customer.id),
    ).toEqual(["OPTED-IN", "UNKNOWN", "UNSET"]);
  });

  it("applies the selected segment as well as consent rules", () => {
    expect(selectMarketingAudience(profiles, "vip", true)).toEqual([]);
    expect(selectMarketingAudience(profiles, "lead", false)).toHaveLength(1);
  });
});

describe("renderMarketingMessage", () => {
  const profile: CustomerMarketingProfile = {
    customer: customer("C1", { name: "أحمد" }),
    segment: "loyal",
    invoiceCount: 4,
    netRevenue: 1_234.5,
    averageOrderValue: 308.625,
    firstPurchaseDate: "2026-01-01",
    lastPurchaseDate: "2026-06-20",
    daysSinceLastPurchase: 11,
    topCategory: "فرامل",
    topProduct: "تيل فرامل أمامي",
    vehicleLabels: ["تويوتا كورولا 2020"],
    branchNames: ["الرئيسي"],
    normalizedPhone: "201012345678",
    hasReachablePhone: true,
  };

  it("replaces every supported token, including repeated tokens", () => {
    const rendered = renderMarketingMessage(
      "مرحبًا {customerName} من {companyName}. {customerName}: آخر شراء {lastPurchase}، إجمالي {totalPurchases}، {topCategory}، {topProduct}، {vehicle}.",
      profile,
      { companyName: "عمر لقطع الغيار", currency: "ج.م" },
    );

    expect(rendered).toContain("مرحبًا أحمد من عمر لقطع الغيار");
    expect(rendered.match(/أحمد/g)).toHaveLength(2);
    expect(rendered).toContain("2026-06-20");
    expect(rendered).toContain(
      `${profile.netRevenue.toLocaleString("ar-EG", { maximumFractionDigits: 2 })} ج.م`,
    );
    expect(rendered).toContain("فرامل");
    expect(rendered).toContain("تيل فرامل أمامي");
    expect(rendered).toContain("تويوتا كورولا 2020");
    expect(rendered).not.toMatch(/\{(?:customerName|companyName|lastPurchase|totalPurchases|topCategory|topProduct|vehicle)\}/);
  });

  it("uses readable fallbacks when purchase affinity data is absent", () => {
    const rendered = renderMarketingMessage(
      "{lastPurchase}|{topCategory}|{topProduct}|{vehicle}",
      {
        ...profile,
        lastPurchaseDate: undefined,
        topCategory: undefined,
        topProduct: undefined,
        vehicleLabels: [],
      },
      { companyName: "المحل", currency: "ج.م" },
    );

    expect(rendered).toBe("لا يوجد|قطع الغيار|قطع الغيار|سيارتك");
  });
});

describe("buildCategoryInsights", () => {
  it("nets valid returns, ignores cancelled sales/returns, classifies unknown products, and sorts by revenue", () => {
    const products = [
      product("P-BRAKE", "فرامل"),
      product("P-OIL", "زيوت"),
    ];
    const first = invoice("INV-1", "C1", "2026-06-01", [
      invoiceLine("P-BRAKE", 2, 100),
      invoiceLine("P-OIL", 1, 80),
    ]);
    const second = invoice("INV-2", "C2", "2026-06-02", [
      invoiceLine("P-BRAKE", 1, 150),
      invoiceLine("MISSING", 1, 50),
    ]);
    const cancelled = invoice(
      "INV-CANCELLED",
      "C3",
      "2026-06-03",
      [invoiceLine("P-OIL", 99, 100)],
      { cancelled: true },
    );
    const returns = [
      salesReturn("RET-VALID", first.id, "C1", [returnLine("P-BRAKE", 1, 100)]),
      salesReturn("RET-CANCELLED", cancelled.id, "C3", [returnLine("P-OIL", 99, 100)]),
    ];

    const insights = buildCategoryInsights(
      [first, cancelled, second],
      returns,
      products,
    );

    expect(insights).toEqual([
      { category: "فرامل", revenue: 250, units: 2, customers: 2 },
      { category: "زيوت", revenue: 80, units: 1, customers: 1 },
      { category: "غير مصنف", revenue: 50, units: 1, customers: 1 },
    ]);
  });

  it("floors returned revenue and units at zero", () => {
    const sale = invoice("INV-1", "C1", "2026-06-01", [
      invoiceLine("P-BRAKE", 1, 100),
    ]);
    const oversizedReturn = salesReturn("RET-1", sale.id, "C1", [
      returnLine("P-BRAKE", 3, 100),
    ]);

    expect(
      buildCategoryInsights(
        [sale],
        [oversizedReturn],
        [product("P-BRAKE", "فرامل")],
      ),
    ).toEqual([{ category: "فرامل", revenue: 0, units: 0, customers: 1 }]);
  });
});
