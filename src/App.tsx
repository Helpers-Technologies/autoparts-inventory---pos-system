import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./store/AuthContext";
import { ProtectedShell } from "./components/layout/ProtectedShell";
import { PageLoading } from "./components/layout/PageLoading";

// Route-level code splitting — each page becomes its own chunk instead of all
// ~50 pages (charts, xlsx export, etc. included) landing in one ~2.8MB bundle
// that has to be parsed before the very first screen can render.
function lazyPage<T extends Record<string, unknown>>(
  loader: () => Promise<T>,
  exportName: keyof T,
) {
  return lazy(() => loader().then((m) => ({ default: m[exportName] as React.ComponentType })));
}

const LoginPage = lazyPage(() => import("./pages/LoginPage"), "LoginPage");
const ActivationPage = lazyPage(() => import("./pages/ActivationPage"), "ActivationPage");
const FirstRunSetupPage = lazyPage(() => import("./pages/FirstRunSetupPage"), "FirstRunSetupPage");
const DashboardPage = lazyPage(() => import("./pages/DashboardPage"), "DashboardPage");
const ProductsPage = lazyPage(() => import("./pages/ProductsPage"), "ProductsPage");
const ProductDetailPage = lazyPage(() => import("./pages/ProductDetailPage"), "ProductDetailPage");
const InventoryPage = lazyPage(() => import("./pages/InventoryPage"), "InventoryPage");
const SuppliersPage = lazyPage(() => import("./pages/SuppliersPage"), "SuppliersPage");
const SupplierDetailPage = lazyPage(() => import("./pages/SupplierDetailPage"), "SupplierDetailPage");
const CustomersPage = lazyPage(() => import("./pages/CustomersPage"), "CustomersPage");
const CustomerDetailPage = lazyPage(() => import("./pages/CustomerDetailPage"), "CustomerDetailPage");
const PurchaseInvoicesPage = lazyPage(() => import("./pages/PurchaseInvoicesPage"), "PurchaseInvoicesPage");
const PurchaseInvoiceNewPage = lazyPage(() => import("./pages/PurchaseInvoiceNewPage"), "PurchaseInvoiceNewPage");
const PurchaseInvoiceDetailPage = lazyPage(() => import("./pages/PurchaseInvoiceDetailPage"), "PurchaseInvoiceDetailPage");
const PurchaseInvoiceEditPage = lazyPage(() => import("./pages/PurchaseInvoiceEditPage"), "PurchaseInvoiceEditPage");
const PurchaseInvoicePrintPage = lazyPage(() => import("./pages/PurchaseInvoicePrintPage"), "PurchaseInvoicePrintPage");
const ProductBarcodePrintPage = lazyPage(() => import("./pages/ProductBarcodePrintPage"), "ProductBarcodePrintPage");
const SalesInvoicesPage = lazyPage(() => import("./pages/SalesInvoicesPage"), "SalesInvoicesPage");
const SalesInvoiceNewPage = lazyPage(() => import("./pages/SalesInvoiceNewPage"), "SalesInvoiceNewPage");
const SalesInvoiceEditPage = lazyPage(() => import("./pages/SalesInvoiceEditPage"), "SalesInvoiceEditPage");
const SalesInvoiceDetailPage = lazyPage(() => import("./pages/SalesInvoiceDetailPage"), "SalesInvoiceDetailPage");
const SalesInvoicePrintPage = lazyPage(() => import("./pages/SalesInvoicePrintPage"), "SalesInvoicePrintPage");
const AlertsPage = lazyPage(() => import("./pages/AlertsPage"), "AlertsPage");
const QuotationsPage = lazyPage(() => import("./pages/QuotationsPage"), "QuotationsPage");
const StocktakesPage = lazyPage(() => import("./pages/StocktakesPage"), "StocktakesPage");
const ImportPage = lazyPage(() => import("./pages/ImportPage"), "ImportPage");
const StocktakeDetailPage = lazyPage(() => import("./pages/StocktakeDetailPage"), "StocktakeDetailPage");
const QuotationNewPage = lazyPage(() => import("./pages/QuotationNewPage"), "QuotationNewPage");
const QuotationEditPage = lazyPage(() => import("./pages/QuotationEditPage"), "QuotationEditPage");
const QuotationDetailPage = lazyPage(() => import("./pages/QuotationDetailPage"), "QuotationDetailPage");
const QuotationPrintPage = lazyPage(() => import("./pages/QuotationPrintPage"), "QuotationPrintPage");
const CashboxPage = lazyPage(() => import("./pages/CashboxPage"), "CashboxPage");
const DuesPage = lazyPage(() => import("./pages/DuesPage"), "DuesPage");
const ReportsPage = lazyPage(() => import("./pages/ReportsPage"), "ReportsPage");
const AdvancedAnalyticsPage = lazyPage(() => import("./pages/AdvancedAnalyticsPage"), "AdvancedAnalyticsPage");
const EmployeeReportPage = lazyPage(() => import("./pages/EmployeeReportPage"), "EmployeeReportPage");
const SettingsPage = lazyPage(() => import("./pages/SettingsPage"), "SettingsPage");
const UsersPage = lazyPage(() => import("./pages/UsersPage"), "UsersPage");
const ReturnsPage = lazyPage(() => import("./pages/ReturnsPage"), "ReturnsPage");
const DriversPage = lazyPage(() => import("./pages/DriversPage"), "DriversPage");
const EmployeeProfilePage = lazyPage(() => import("./pages/EmployeeProfilePage"), "EmployeeProfilePage");
const HelpPage = lazyPage(() => import("./pages/HelpPage"), "HelpPage");
const AuditLogPage = lazyPage(() => import("./pages/AuditLogPage"), "AuditLogPage");
const CustomerStatementPrintPage = lazyPage(() => import("./pages/CustomerStatementPrintPage"), "CustomerStatementPrintPage");
const SupplierStatementPrintPage = lazyPage(() => import("./pages/SupplierStatementPrintPage"), "SupplierStatementPrintPage");
const POSPage = lazyPage(() => import("./pages/POSPage"), "POSPage");
const SalesInvoiceReceiptPrintPage = lazyPage(() => import("./pages/SalesInvoiceReceiptPrintPage"), "SalesInvoiceReceiptPrintPage");
const VehicleCatalogPage = lazyPage(() => import("./pages/VehicleCatalogPage"), "VehicleCatalogPage");
const PartsFinderPage = lazyPage(() => import("./pages/PartsFinderPage"), "PartsFinderPage");
const AutoPartsReportsPage = lazyPage(() => import("./pages/AutoPartsReportsPage"), "AutoPartsReportsPage");
const CustomerGaragePage = lazyPage(() => import("./pages/CustomerGaragePage"), "CustomerGaragePage");
const PartAlternativesPage = lazyPage(() => import("./pages/PartAlternativesPage"), "PartAlternativesPage");
const WarrantyCenterPage = lazyPage(() => import("./pages/WarrantyCenterPage"), "WarrantyCenterPage");
const PurchasingAssistantPage = lazyPage(() => import("./pages/PurchasingAssistantPage"), "PurchasingAssistantPage");
const BranchesPage = lazyPage(() => import("./pages/BranchesPage"), "BranchesPage");
const PricingRulesPage = lazyPage(() => import("./pages/PricingRulesPage"), "PricingRulesPage");
const MarketingPage = lazyPage(() => import("./pages/MarketingPage"), "MarketingPage");
const ShiftsPage = lazyPage(() => import("./pages/ShiftsPage"), "ShiftsPage");

export default function App() {
  const { auth, isDesktop, licenseStatus, ownerExists, ownerCheckPending } = useAuth();

  if (isDesktop) {
    if (!licenseStatus || licenseStatus.state !== "active") {
      return (
        <Suspense fallback={<PageLoading />}>
          <ActivationPage />
        </Suspense>
      );
    }
    if (ownerCheckPending) {
      return (
        <div className="min-h-screen grid place-items-center bg-canvas" dir="rtl">
          <div className="text-sm text-ink-faint">جاري فحص حساب المدير...</div>
        </div>
      );
    }
    if (!ownerExists) {
      return (
        <Suspense fallback={<PageLoading />}>
          <FirstRunSetupPage />
        </Suspense>
      );
    }
  }

  return (
    <Suspense fallback={<PageLoading />}>
    <Routes>
      <Route
        path="/login"
        element={auth.isAuthenticated ? <Navigate to="/" replace /> : <LoginPage />}
      />
      {/* Print routes (no layout) */}
      <Route path="/sales/:id/print" element={<SalesInvoicePrintPage />} />
      <Route path="/sales/:id/receipt" element={<SalesInvoiceReceiptPrintPage />} />
      <Route path="/purchases/:id/print" element={<PurchaseInvoicePrintPage />} />
      <Route path="/customers/:id/statement" element={<CustomerStatementPrintPage />} />
      <Route path="/suppliers/:id/statement" element={<SupplierStatementPrintPage />} />
      <Route path="/quotations/:id/print" element={<QuotationPrintPage />} />
      <Route path="/products/:id/barcode/print" element={<ProductBarcodePrintPage />} />

      <Route
        path="/"
        element={
          <ProtectedShell>
            <DashboardPage />
          </ProtectedShell>
        }
      />
      <Route
        path="/products"
        element={
          <ProtectedShell permission="products" feature="products">
            <ProductsPage />
          </ProtectedShell>
        }
      />
      <Route
        path="/products/:id"
        element={
          <ProtectedShell permission="products" feature="products">
            <ProductDetailPage />
          </ProtectedShell>
        }
      />
      <Route
        path="/parts-finder"
        element={
          <ProtectedShell permission="products" feature="products">
            <PartsFinderPage />
          </ProtectedShell>
        }
      />
      <Route
        path="/vehicle-catalog"
        element={
          <ProtectedShell permission="products" feature="products">
            <VehicleCatalogPage />
          </ProtectedShell>
        }
      />
      <Route
        path="/customer-garage"
        element={
          <ProtectedShell permission="customers">
            <CustomerGaragePage />
          </ProtectedShell>
        }
      />
      <Route
        path="/part-alternatives"
        element={
          <ProtectedShell permission="products" feature="partAlternatives">
            <PartAlternativesPage />
          </ProtectedShell>
        }
      />
      <Route
        path="/warranty-center"
        element={
          <ProtectedShell permission="returns">
            <WarrantyCenterPage />
          </ProtectedShell>
        }
      />
      <Route
        path="/purchasing-assistant"
        element={
          <ProtectedShell permission="purchaseInvoices">
            <PurchasingAssistantPage />
          </ProtectedShell>
        }
      />
      <Route
        path="/branches"
        element={
          <ProtectedShell permission="inventory">
            <BranchesPage />
          </ProtectedShell>
        }
      />
      <Route
        path="/pricing-rules"
        element={
          <ProtectedShell ownerOnly>
            <PricingRulesPage />
          </ProtectedShell>
        }
      />
      <Route
        path="/inventory"
        element={
          <ProtectedShell permission="inventory" feature="inventory">
            <InventoryPage />
          </ProtectedShell>
        }
      />
      <Route
        path="/suppliers"
        element={
          <ProtectedShell permission="suppliers" feature="suppliers">
            <SuppliersPage />
          </ProtectedShell>
        }
      />
      <Route
        path="/suppliers/:id"
        element={
          <ProtectedShell permission="suppliers" feature="suppliers">
            <SupplierDetailPage />
          </ProtectedShell>
        }
      />
      <Route
        path="/customers"
        element={
          <ProtectedShell permission="customers" feature="customers">
            <CustomersPage />
          </ProtectedShell>
        }
      />
      <Route
        path="/customers/:id"
        element={
          <ProtectedShell permission="customers" feature="customers">
            <CustomerDetailPage />
          </ProtectedShell>
        }
      />
      <Route
        path="/marketing"
        element={
          <ProtectedShell ownerOnly feature="marketingHub">
            <MarketingPage />
          </ProtectedShell>
        }
      />
      <Route
        path="/purchases"
        element={
          <ProtectedShell permission="purchaseInvoices" feature="purchaseInvoices">
            <PurchaseInvoicesPage />
          </ProtectedShell>
        }
      />
      <Route
        path="/purchases/new"
        element={
          <ProtectedShell permission="purchaseInvoices" permissionAction="add" feature="purchaseInvoices">
            <PurchaseInvoiceNewPage />
          </ProtectedShell>
        }
      />
      <Route
        path="/purchases/:id"
        element={
          <ProtectedShell permission="purchaseInvoices" feature="purchaseInvoices">
            <PurchaseInvoiceDetailPage />
          </ProtectedShell>
        }
      />
      <Route
        path="/purchases/:id/edit"
        element={
          <ProtectedShell permission="purchaseInvoices" permissionAction="edit" feature="purchaseInvoices">
            <PurchaseInvoiceEditPage />
          </ProtectedShell>
        }
      />
      <Route
        path="/pos"
        element={
          <ProtectedShell permission="pos" feature="pos">
            <POSPage />
          </ProtectedShell>
        }
      />
      <Route
        path="/shifts"
        element={
          <ProtectedShell permission="pos">
            <ShiftsPage />
          </ProtectedShell>
        }
      />
      <Route
        path="/sales"
        element={
          <ProtectedShell permission="salesInvoices" feature="salesInvoices">
            <SalesInvoicesPage />
          </ProtectedShell>
        }
      />
      <Route
        path="/sales/new"
        element={
          <ProtectedShell permission="salesInvoices" permissionAction="add" feature="salesInvoices">
            <SalesInvoiceNewPage />
          </ProtectedShell>
        }
      />
      <Route
        path="/sales/:id"
        element={
          <ProtectedShell permission="salesInvoices" feature="salesInvoices">
            <SalesInvoiceDetailPage />
          </ProtectedShell>
        }
      />
      <Route
        path="/sales/:id/edit"
        element={
          <ProtectedShell permission="salesInvoices" permissionAction="edit" feature="salesInvoices">
            <SalesInvoiceEditPage />
          </ProtectedShell>
        }
      />
      <Route
        path="/import"
        element={
          <ProtectedShell feature="dataImport">
            <ImportPage />
          </ProtectedShell>
        }
      />
      <Route
        path="/stocktakes"
        element={
          <ProtectedShell permission="inventory" feature="stocktakes">
            <StocktakesPage />
          </ProtectedShell>
        }
      />
      <Route
        path="/stocktakes/:id"
        element={
          <ProtectedShell permission="inventory" feature="stocktakes">
            <StocktakeDetailPage />
          </ProtectedShell>
        }
      />
      <Route
        path="/quotations"
        element={
          <ProtectedShell permission="salesInvoices" feature="quotations">
            <QuotationsPage />
          </ProtectedShell>
        }
      />
      <Route
        path="/quotations/new"
        element={
          <ProtectedShell permission="salesInvoices" permissionAction="add" feature="quotations">
            <QuotationNewPage />
          </ProtectedShell>
        }
      />
      <Route
        path="/quotations/:id/edit"
        element={
          <ProtectedShell permission="salesInvoices" permissionAction="edit" feature="quotations">
            <QuotationEditPage />
          </ProtectedShell>
        }
      />
      <Route
        path="/quotations/:id"
        element={
          <ProtectedShell permission="salesInvoices" feature="quotations">
            <QuotationDetailPage />
          </ProtectedShell>
        }
      />
      <Route
        path="/returns"
        element={
          <ProtectedShell permission="returns" feature="returns">
            <ReturnsPage />
          </ProtectedShell>
        }
      />
      <Route
        path="/alerts"
        element={
          <ProtectedShell permission="alerts" feature="advancedAlerts">
            <AlertsPage />
          </ProtectedShell>
        }
      />
      <Route
        path="/drivers"
        element={
          <ProtectedShell permission="drivers" feature="drivers">
            <DriversPage />
          </ProtectedShell>
        }
      />
      <Route
        path="/cashbox"
        element={
          <ProtectedShell permission="cashbox" feature="cashbox">
            <CashboxPage />
          </ProtectedShell>
        }
      />
      <Route
        path="/dues"
        element={
          <ProtectedShell permission="reports" feature="dues">
            <DuesPage />
          </ProtectedShell>
        }
      />
      <Route
        path="/reports"
        element={
          <ProtectedShell permission="reports" feature="reports">
            <AutoPartsReportsPage />
          </ProtectedShell>
        }
      />
      <Route
        path="/reports/financial"
        element={
          <ProtectedShell permission="reports" feature="reports">
            <ReportsPage />
          </ProtectedShell>
        }
      />
      <Route path="/reports/autoparts" element={<Navigate to="/reports" replace />} />
      <Route
        path="/reports/analytics"
        element={
          <ProtectedShell permission="reports" feature="advancedAnalytics">
            <AdvancedAnalyticsPage />
          </ProtectedShell>
        }
      />
      <Route
        path="/reports/employees"
        element={
          <ProtectedShell ownerOnly feature="employeesReport">
            <EmployeeReportPage />
          </ProtectedShell>
        }
      />
      <Route
        path="/audit-log"
        element={
          <ProtectedShell ownerOnly feature="activityLog">
            <AuditLogPage />
          </ProtectedShell>
        }
      />
      <Route
        path="/settings"
        element={
          <ProtectedShell ownerOnly>
            <SettingsPage />
          </ProtectedShell>
        }
      />
      <Route
        path="/users"
        element={
          <ProtectedShell ownerOnly>
            <UsersPage />
          </ProtectedShell>
        }
      />
      <Route
        path="/my-profile"
        element={
          <ProtectedShell>
            <EmployeeProfilePage />
          </ProtectedShell>
        }
      />
      <Route
        path="/employees/:id"
        element={
          <ProtectedShell>
            <EmployeeProfilePage />
          </ProtectedShell>
        }
      />
      <Route
        path="/users/:id"
        element={
          <ProtectedShell>
            <EmployeeProfilePage />
          </ProtectedShell>
        }
      />
      <Route
        path="/help"
        element={
          <ProtectedShell>
            <HelpPage />
          </ProtectedShell>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  );
}
