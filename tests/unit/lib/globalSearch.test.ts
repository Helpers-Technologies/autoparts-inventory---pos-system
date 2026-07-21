/**
 * Unit tests for src/lib/globalSearch.ts
 * Verifies search logic, field coverage, permissions, and edge cases.
 *
 * TC-GS-001 through TC-GS-025
 */
import { describe, it, expect } from "vitest";
import {
  globalSearch,
  MIN_QUERY_LENGTH,
  MAX_PER_KIND,
  KIND_LABELS,
  normalizeGlobalSearchText,
  type SearchCatalog,
  type SearchPermissions,
} from "../../../src/lib/globalSearch";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ALL_PERMS: SearchPermissions = {
  products: true,
  customers: true,
  suppliers: true,
  salesInvoices: true,
  purchaseInvoices: true,
  quotations: true,
};

const NO_PERMS: SearchPermissions = {
  products: false,
  customers: false,
  suppliers: false,
  salesInvoices: false,
  purchaseInvoices: false,
  quotations: false,
};

const CATALOG: SearchCatalog = {
  products: [
    {
      id: "p1",
      name: "فلتر زيت محرك — هيونداي إلنترا",
      code: "AP-FIL-001",
      barcode: "1234567890",
      partNumber: "26300-35505",
      oemNumbers: ["26300-35504", "26300-35505"],
      partBrand: "MOBIS",
    },
    {
      id: "p2",
      name: "تيل فرامل أمامي — كيا سيراتو",
      code: "AP-BRK-002",
      barcode: "0987654321",
      partNumber: "58101-2WA00",
      oemNumbers: ["58101-2WA70"],
      partBrand: "Hi-Q",
    },
    { id: "p3", name: "بوجيه إشعال — BYD F3", code: "AP-IGN-003", partNumber: "BKR6E-11" },
  ],
  customers: [
    { id: "c1", name: "مركز أحمد محمد للصيانة", code: "C001", phone: "01012345678" },
    { id: "c2", name: "ورشة سارة علي", code: "C002", phone: "01198765432" },
    { id: "c3", name: "خالد إبراهيم", phone: "01234567890" },
  ],
  suppliers: [
    { id: "s1", name: "شركة النور لقطع الغيار", code: "S001", phone: "0221234567" },
    { id: "s2", name: "مورد قطع كوري جملة", code: "S002" },
  ],
  salesInvoices: [
    {
      id: "inv1",
      invoiceNumber: "INV-001",
      customerName: "مركز أحمد محمد للصيانة",
      vehicleLabel: "هيونداي إلنترا 2021 — س ع ر 1234",
      branchName: "فرع مدينة نصر",
      partTerms: ["فلتر زيت محرك", "26300-35505", "MOBIS"],
    },
    { id: "inv2", invoiceNumber: "INV-002", customerName: "ورشة سارة علي", vehicleLabel: "كيا سيراتو 2019" },
    { id: "inv3", invoiceNumber: "SALE-099", customerName: "خالد إبراهيم" },
  ],
  purchaseInvoices: [
    { id: "pur1", invoiceNumber: "PUR-001", supplierName: "شركة النور لقطع الغيار", partTerms: ["58101-2WA00"] },
    { id: "pur2", invoiceNumber: "PUR-002", supplierName: "مورد قطع كوري جملة" },
  ],
  quotations: [
    {
      id: "q1",
      quotationNumber: "QT-001",
      customerName: "مركز أحمد محمد للصيانة",
      vehicleLabel: "هيونداي إلنترا 2021",
      branchName: "فرع مدينة نصر",
      partTerms: ["26300-35505"],
    },
  ],
};

// ── TC-GS-001: Query length gate ─────────────────────────────────────────────

describe("query length gate — TC-GS-001", () => {
  it("returns [] for empty string", () => {
    expect(globalSearch("", CATALOG, ALL_PERMS)).toEqual([]);
  });

  it(`returns [] for query shorter than ${MIN_QUERY_LENGTH} chars`, () => {
    expect(globalSearch("ز", CATALOG, ALL_PERMS)).toEqual([]);
  });

  it("returns results for query exactly at MIN_QUERY_LENGTH", () => {
    const res = globalSearch("زي", CATALOG, ALL_PERMS);
    expect(res.length).toBeGreaterThan(0);
  });

  it("trims whitespace before length check", () => {
    expect(globalSearch("  ", CATALOG, ALL_PERMS)).toEqual([]);
    expect(globalSearch(" ز ", CATALOG, ALL_PERMS)).toEqual([]);
  });
});

// ── TC-GS-002: Products search fields ────────────────────────────────────────

describe("products — TC-GS-002", () => {
  it("matches by product name", () => {
    const res = globalSearch("زيت", CATALOG, ALL_PERMS);
    expect(res.some((r) => r.id === "p1" && r.kind === "product")).toBe(true);
  });

  it("matches by product code", () => {
    const res = globalSearch("AP-BRK-002", CATALOG, ALL_PERMS);
    expect(res.some((r) => r.id === "p2" && r.kind === "product")).toBe(true);
  });

  it("matches by barcode", () => {
    const res = globalSearch("1234567890", CATALOG, ALL_PERMS);
    expect(res.some((r) => r.id === "p1" && r.kind === "product")).toBe(true);
  });

  it("search is case-insensitive for latin codes", () => {
    const res = globalSearch("ap-fil-001", CATALOG, ALL_PERMS);
    expect(res.some((r) => r.id === "p1")).toBe(true);
  });

  it("result to is /products", () => {
    const res = globalSearch("زيت", CATALOG, ALL_PERMS);
    const product = res.find((r) => r.kind === "product");
    expect(product?.to).toBe("/products");
  });

  it("result has initialSearch set to the Part No when available", () => {
    const res = globalSearch("زيت", CATALOG, ALL_PERMS);
    const product = res.find((r) => r.kind === "product");
    expect(product?.initialSearch).toBe("26300-35505");
  });

  it("does not return products when permission is false", () => {
    const res = globalSearch("زيت", CATALOG, { ...ALL_PERMS, products: false });
    expect(res.every((r) => r.kind !== "product")).toBe(true);
  });
});

// ── TC-GS-003: Customers search fields ───────────────────────────────────────

describe("customers — TC-GS-003", () => {
  it("matches by customer name", () => {
    const res = globalSearch("أحمد", CATALOG, ALL_PERMS);
    expect(res.some((r) => r.id === "c1" && r.kind === "customer")).toBe(true);
  });

  it("matches by customer phone", () => {
    const res = globalSearch("01012345678", CATALOG, ALL_PERMS);
    expect(res.some((r) => r.id === "c1" && r.kind === "customer")).toBe(true);
  });

  it("matches by customer code", () => {
    const res = globalSearch("C002", CATALOG, ALL_PERMS);
    expect(res.some((r) => r.id === "c2" && r.kind === "customer")).toBe(true);
  });

  it("does not return customers when permission is false", () => {
    const res = globalSearch("أحمد", CATALOG, { ...ALL_PERMS, customers: false });
    expect(res.every((r) => r.kind !== "customer")).toBe(true);
  });

  it("result to is /customers", () => {
    const res = globalSearch("أحمد", CATALOG, ALL_PERMS);
    const customer = res.find((r) => r.kind === "customer");
    expect(customer?.to).toBe("/customers");
  });
});

// ── TC-GS-004: Suppliers search fields ───────────────────────────────────────

describe("suppliers — TC-GS-004", () => {
  it("matches by supplier name", () => {
    const res = globalSearch("النور", CATALOG, ALL_PERMS);
    expect(res.some((r) => r.id === "s1" && r.kind === "supplier")).toBe(true);
  });

  it("matches by supplier phone", () => {
    const res = globalSearch("0221234567", CATALOG, ALL_PERMS);
    expect(res.some((r) => r.id === "s1" && r.kind === "supplier")).toBe(true);
  });

  it("matches by supplier code", () => {
    const res = globalSearch("S002", CATALOG, ALL_PERMS);
    expect(res.some((r) => r.id === "s2" && r.kind === "supplier")).toBe(true);
  });

  it("does not return suppliers when permission is false", () => {
    const res = globalSearch("النور", CATALOG, { ...ALL_PERMS, suppliers: false });
    expect(res.every((r) => r.kind !== "supplier")).toBe(true);
  });
});

// ── TC-GS-005: Sales invoices search ─────────────────────────────────────────

describe("salesInvoices — TC-GS-005", () => {
  it("matches by invoice number", () => {
    const res = globalSearch("INV-001", CATALOG, ALL_PERMS);
    expect(res.some((r) => r.id === "inv1" && r.kind === "salesInvoice")).toBe(true);
  });

  it("matches by customer name in invoice", () => {
    const res = globalSearch("سارة", CATALOG, ALL_PERMS);
    expect(res.some((r) => r.id === "inv2" && r.kind === "salesInvoice")).toBe(true);
  });

  it("result navigates to /sales/:id", () => {
    const res = globalSearch("INV-001", CATALOG, ALL_PERMS);
    const inv = res.find((r) => r.kind === "salesInvoice" && r.id === "inv1");
    expect(inv?.to).toBe("/sales/inv1");
  });

  it("result has no initialSearch (direct navigation to detail)", () => {
    const res = globalSearch("INV-001", CATALOG, ALL_PERMS);
    const inv = res.find((r) => r.kind === "salesInvoice");
    expect(inv?.initialSearch).toBeUndefined();
  });

  it("does not return sales invoices when permission is false", () => {
    const res = globalSearch("INV", CATALOG, { ...ALL_PERMS, salesInvoices: false });
    expect(res.every((r) => r.kind !== "salesInvoice")).toBe(true);
  });
});

// ── TC-GS-006: Purchase invoices search ──────────────────────────────────────

describe("purchaseInvoices — TC-GS-006", () => {
  it("matches by purchase invoice number", () => {
    const res = globalSearch("PUR-001", CATALOG, ALL_PERMS);
    expect(res.some((r) => r.id === "pur1" && r.kind === "purchaseInvoice")).toBe(true);
  });

  it("matches by supplier name in invoice", () => {
    const res = globalSearch("النور", CATALOG, ALL_PERMS);
    expect(res.some((r) => r.id === "pur1" && r.kind === "purchaseInvoice")).toBe(true);
  });

  it("result navigates to /purchases/:id", () => {
    const res = globalSearch("PUR-001", CATALOG, ALL_PERMS);
    const inv = res.find((r) => r.kind === "purchaseInvoice" && r.id === "pur1");
    expect(inv?.to).toBe("/purchases/pur1");
  });
});

// ── TC-GS-007: Quotations search ─────────────────────────────────────────────

describe("quotations — TC-GS-007", () => {
  it("matches by quotation number", () => {
    const res = globalSearch("QT-001", CATALOG, ALL_PERMS);
    expect(res.some((r) => r.id === "q1" && r.kind === "quotation")).toBe(true);
  });

  it("matches by customer name in quotation", () => {
    const res = globalSearch("أحمد", CATALOG, ALL_PERMS);
    expect(res.some((r) => r.kind === "quotation")).toBe(true);
  });

  it("does not return quotations when permission is false", () => {
    const res = globalSearch("QT-001", CATALOG, { ...ALL_PERMS, quotations: false });
    expect(res.every((r) => r.kind !== "quotation")).toBe(true);
  });
});

// ── TC-GS-008: No permissions returns empty ───────────────────────────────────

describe("no permissions — TC-GS-008", () => {
  it("returns [] when all permissions are false", () => {
    expect(globalSearch("أحمد", CATALOG, NO_PERMS)).toEqual([]);
  });
});

// ── TC-GS-009: MAX_PER_KIND cap ──────────────────────────────────────────────

describe("MAX_PER_KIND cap — TC-GS-009", () => {
  it(`caps products at ${MAX_PER_KIND} results`, () => {
    const bigCatalog: SearchCatalog = {
      ...CATALOG,
      products: Array.from({ length: MAX_PER_KIND + 3 }, (_, i) => ({
        id: `p${i}`,
        name: `منتج مشترك ${i}`,
        code: `P${i}`,
      })),
    };
    const res = globalSearch("منتج", bigCatalog, ALL_PERMS);
    const productResults = res.filter((r) => r.kind === "product");
    expect(productResults.length).toBe(MAX_PER_KIND);
  });

  it(`caps customers at ${MAX_PER_KIND} results`, () => {
    const bigCatalog: SearchCatalog = {
      ...CATALOG,
      customers: Array.from({ length: MAX_PER_KIND + 2 }, (_, i) => ({
        id: `c${i}`,
        name: `عميل مشترك ${i}`,
      })),
    };
    const res = globalSearch("عميل", bigCatalog, ALL_PERMS);
    const customerResults = res.filter((r) => r.kind === "customer");
    expect(customerResults.length).toBe(MAX_PER_KIND);
  });
});

// ── TC-GS-010: Kind labels completeness ──────────────────────────────────────

describe("KIND_LABELS completeness — TC-GS-010", () => {
  const kinds = ["product", "customer", "supplier", "salesInvoice", "purchaseInvoice", "quotation"] as const;
  for (const kind of kinds) {
    it(`has a label for kind "${kind}"`, () => {
      expect(KIND_LABELS[kind]).toBeTruthy();
    });
  }
});

// ── TC-GS-011: Partial match ─────────────────────────────────────────────────

describe("partial / substring match — TC-GS-011", () => {
  it("matches a substring anywhere in the name", () => {
    const res = globalSearch("محرك", CATALOG, ALL_PERMS);
    expect(res.some((r) => r.id === "p1")).toBe(true);
  });

  it("matches a partial invoice number", () => {
    const res = globalSearch("SALE", CATALOG, ALL_PERMS);
    expect(res.some((r) => r.id === "inv3")).toBe(true);
  });
});

// ── TC-GS-012: Optional fields (no barcode / no phone) ───────────────────────

describe("optional fields gracefully absent — TC-GS-012", () => {
  it("product without barcode does not crash", () => {
    const res = globalSearch("بوجيه", CATALOG, ALL_PERMS);
    expect(res.some((r) => r.id === "p3")).toBe(true);
  });

  it("customer without phone or code still matches by name", () => {
    const res = globalSearch("خالد", CATALOG, ALL_PERMS);
    expect(res.some((r) => r.id === "c3")).toBe(true);
  });

  it("supplier without phone still matches by name", () => {
    const res = globalSearch("جملة", CATALOG, ALL_PERMS);
    expect(res.some((r) => r.id === "s2")).toBe(true);
  });
});

// ── TC-GS-013: Result shape ───────────────────────────────────────────────────

describe("result shape contract — TC-GS-013", () => {
  it("every result has id, kind, title, subtitle, to", () => {
    const results = globalSearch("أحمد", CATALOG, ALL_PERMS);
    for (const r of results) {
      expect(r).toHaveProperty("id");
      expect(r).toHaveProperty("kind");
      expect(r).toHaveProperty("title");
      expect(r).toHaveProperty("subtitle");
      expect(r).toHaveProperty("to");
    }
  });
});

// ── TC-GS-014: Auto-parts normalization and ranking ─────────────────────────

describe("auto-parts smart matching — TC-GS-014", () => {
  it("normalizes Arabic letter variants, punctuation and Arabic digits", () => {
    expect(normalizeGlobalSearchText("إلنترا / ٢٠٢١")).toBe("النترا 2021");
  });

  it("matches a Part No with spaces or no punctuation", () => {
    expect(globalSearch("26300 35505", CATALOG, ALL_PERMS).some((r) => r.id === "p1")).toBe(true);
    expect(globalSearch("2630035505", CATALOG, ALL_PERMS).some((r) => r.id === "p1")).toBe(true);
  });

  it("matches Arabic digits against an ASCII Part No", () => {
    const res = globalSearch("٢٦٣٠٠-٣٥٥٠٥", CATALOG, ALL_PERMS);
    expect(res.some((r) => r.id === "p1" && r.kind === "product")).toBe(true);
  });

  it("matches Arabic hamza variants in a vehicle/product name", () => {
    const res = globalSearch("النترا", CATALOG, ALL_PERMS);
    expect(res.some((r) => r.id === "p1")).toBe(true);
  });

  it("matches multi-word terms even when their order differs", () => {
    const res = globalSearch("سيراتو فرامل", CATALOG, ALL_PERMS);
    expect(res.some((r) => r.id === "p2")).toBe(true);
  });

  it("puts an exact Part No before earlier partial matches, then applies the cap", () => {
    const products = [
      ...Array.from({ length: MAX_PER_KIND + 2 }, (_, index) => ({
        id: `partial-${index}`,
        name: `قطعة بديلة ${index}`,
        code: `ALT-${index}`,
        partNumber: `26300-35505-${index}`,
      })),
      { id: "exact-part", name: "فلتر الزيت الأصلي", code: "EXACT", partNumber: "26300-35505" },
    ];
    const results = globalSearch("26300-35505", { ...CATALOG, products }, ALL_PERMS)
      .filter((result) => result.kind === "product");

    expect(results).toHaveLength(MAX_PER_KIND);
    expect(results[0]?.id).toBe("exact-part");
  });

  it("prioritizes exact barcode and OEM matches over partial identifiers", () => {
    const products: SearchCatalog["products"] = [
      { id: "partial", name: "قطعة برقم ممتد", code: "PARTIAL", partNumber: "1234567890-X" },
      { id: "exact-oem", name: "قطعة برقم OEM", code: "OEM", oemNumbers: ["1234567890"] },
      { id: "exact-barcode", name: "قطعة بالباركود", code: "BAR", barcode: "1234567890" },
    ];
    const results = globalSearch("1234567890", { ...CATALOG, products }, ALL_PERMS)
      .filter((result) => result.kind === "product");

    expect(results.map((result) => result.id)).toEqual(["exact-barcode", "exact-oem", "partial"]);
  });

  it("finds invoices and quotations by vehicle, branch and line Part No", () => {
    const byVehicle = globalSearch("النترا 2021", CATALOG, ALL_PERMS);
    const byBranch = globalSearch("مدينه نصر", CATALOG, ALL_PERMS);
    const byPart = globalSearch("26300-35505", CATALOG, ALL_PERMS);

    expect(byVehicle.some((r) => r.id === "inv1" && r.kind === "salesInvoice")).toBe(true);
    expect(byBranch.some((r) => r.id === "q1" && r.kind === "quotation")).toBe(true);
    expect(byPart.some((r) => r.id === "inv1" && r.kind === "salesInvoice")).toBe(true);
    expect(byPart.some((r) => r.id === "q1" && r.kind === "quotation")).toBe(true);
  });

  it("shows automotive context in invoice search results", () => {
    const invoice = globalSearch("26300-35505", CATALOG, ALL_PERMS)
      .find((result) => result.id === "inv1" && result.kind === "salesInvoice");

    expect(invoice?.subtitle).toContain("هيونداي إلنترا 2021");
    expect(invoice?.subtitle).toContain("فرع مدينة نصر");
  });
});
