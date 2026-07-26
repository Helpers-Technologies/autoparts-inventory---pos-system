// @vitest-environment jsdom
/**
 * AutoPartsReportsPage component tests.
 *
 * Covers the three report cards added in this change:
 *  - "الربحية حسب درجة الجودة" — profitability grouped by product.qualityGrade.
 *  - "مقارنة مبيعات وربحية الفروع" — sales/profit comparison grouped by
 *    invoice.branchId/branchName (including an "unassigned" bucket for
 *    invoices with no branch).
 *  - "فجوة تغطية التوافق حسب الفئة" — fitment coverage gap per category,
 *    only rendered when at least one category has missing fitment rows.
 *
 * TC-COMP-APREPORTS-001
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import { AutoPartsReportsPage } from "../../src/pages/AutoPartsReportsPage";
import { renderWithProviders } from "../helpers/render";
import { createPermissions } from "../../src/lib/permissions";
import type {
  Product,
  SalesInvoice,
  Settings,
  ProductFitment,
  AppUser,
} from "../../src/types";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const recentDate = (daysAgo: number) =>
  new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();

// Category "فلاتر": two products, only one fitted → partial (50%) coverage
// gap, so the fitment-gap card is guaranteed to render.
const productFitted: Product = {
  id: "p1",
  code: "A1",
  name: "فلتر زيت أصلي توكيل",
  category: "فلاتر",
  unit: "قطعة",
  purchasePrice: 10,
  avgCost: 10,
  wholesalePrice: 15,
  retailPrice: 20,
  quantity: 10,
  minStock: 2,
  hasExpiry: false,
  qualityGrade: "genuine",
  createdAt: recentDate(200),
};

const productUnfitted: Product = {
  id: "p2",
  code: "A2",
  name: "فلتر هواء بديل",
  category: "فلاتر",
  unit: "قطعة",
  purchasePrice: 8,
  avgCost: 8,
  wholesalePrice: 12,
  retailPrice: 16,
  quantity: 5,
  minStock: 1,
  hasExpiry: false,
  // no qualityGrade set — should bucket under "غير محدد"
  createdAt: recentDate(200),
};

// Different category, has a qualityGrade, no fitment — its category
// ("زيوت") ends up 0% covered, also contributing to the gap list.
const productOilOem: Product = {
  id: "p3",
  code: "B1",
  name: "زيت محرك OEM",
  category: "زيوت",
  unit: "لتر",
  purchasePrice: 15,
  avgCost: 15,
  wholesalePrice: 22,
  retailPrice: 30,
  quantity: 20,
  minStock: 5,
  hasExpiry: false,
  qualityGrade: "oem",
  createdAt: recentDate(200),
};

const fitments: ProductFitment[] = [
  {
    id: "f1",
    productId: "p1",
    makeId: "m1",
    createdAt: recentDate(200),
  },
];

// Invoice with a branch — feeds the "مقارنة مبيعات وربحية الفروع" card and
// the "genuine" quality-grade row.
const invoiceWithBranch: SalesInvoice = {
  id: "inv1",
  invoiceNumber: "INV-1",
  date: recentDate(5),
  customerId: "c1",
  customerName: "عميل تجريبي",
  lines: [
    {
      id: "l1",
      productId: "p1",
      productName: productFitted.name,
      unit: "قطعة",
      quantity: 2,
      price: 20,
      costPrice: 10,
      subtotal: 40,
    },
  ],
  total: 40,
  amountReceived: 40,
  remaining: 0,
  paymentType: "cash",
  priceType: "retail",
  status: "paid",
  branchId: "br1",
  branchName: "الفرع الرئيسي",
  createdAt: recentDate(5),
};

// Invoice with NO branch — should fall into the "بدون فرع" / unassigned
// bucket, and feeds the "oem" quality-grade row.
const invoiceWithoutBranch: SalesInvoice = {
  id: "inv2",
  invoiceNumber: "INV-2",
  date: recentDate(3),
  customerId: "c2",
  customerName: "عميل آخر",
  lines: [
    {
      id: "l2",
      productId: "p3",
      productName: productOilOem.name,
      unit: "لتر",
      quantity: 3,
      price: 30,
      costPrice: 15,
      subtotal: 90,
    },
  ],
  total: 90,
  amountReceived: 90,
  remaining: 0,
  paymentType: "cash",
  priceType: "retail",
  status: "paid",
  createdAt: recentDate(3),
};

const owner: AppUser = {
  id: "u1",
  username: "owner",
  name: "Owner",
  role: "owner",
  passwordHash: "[REDACTED]",
  permissions: createPermissions(true),
};

const settings = {
  currency: "ج.م",
} as Settings;

// ── Module-level mocks ────────────────────────────────────────────────────────

vi.mock("../../src/store/CatalogContext", () => ({
  useCatalog: () => ({
    products: [productFitted, productUnfitted, productOilOem],
  }),
}));

vi.mock("../../src/store/SettingsContext", () => ({
  useSettings: () => ({ settings }),
}));

vi.mock("../../src/store/InvoicingContext", () => ({
  useInvoicing: () => ({
    salesInvoices: [invoiceWithBranch, invoiceWithoutBranch],
    salesReturns: [],
  }),
}));

vi.mock("../../src/store/VehicleCatalogContext", () => ({
  useVehicleCatalog: () => ({
    productFitments: fitments,
  }),
}));

vi.mock("../../src/store/AutoPartsProContext", () => ({
  useAutoPartsPro: () => ({
    branches: [],
    branchStocks: [],
    warrantyClaims: [],
  }),
}));

vi.mock("../../src/store/AuthContext", () => ({
  useAuth: () => ({ currentUser: owner }),
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("AutoPartsReportsPage — TC-COMP-APREPORTS", () => {
  afterEach(() => {
    cleanup();
  });

  it("TC-COMP-APREPORTS-001 — renders quality-grade, branch-comparison, and fitment-gap cards from mock data", () => {
    renderWithProviders(<AutoPartsReportsPage />);

    // New card: profitability by quality grade.
    expect(screen.getByText("الربحية حسب درجة الجودة")).toBeInTheDocument();

    // New card: branch sales/profit comparison — both the named branch and
    // the "no branch" bucket derived from invoice.branchId/branchName.
    expect(screen.getByText("مقارنة مبيعات وربحية الفروع")).toBeInTheDocument();
    expect(screen.getByText("الفرع الرئيسي")).toBeInTheDocument();
    expect(screen.getByText("بدون فرع")).toBeInTheDocument();

    // New card: fitment coverage gap by category — only rendered because
    // "فلاتر" has partial (50%) coverage and "زيوت" has 0% coverage, so
    // fitmentGapByCategory is non-empty.
    expect(screen.getByText("فجوة تغطية التوافق حسب الفئة")).toBeInTheDocument();
    expect(screen.getByText("فلاتر")).toBeInTheDocument();
    expect(screen.getByText("زيوت")).toBeInTheDocument();
  });
});
