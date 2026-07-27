import { Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./store/AuthContext";
import { ProtectedShell } from "./components/layout/ProtectedShell";
import { PageLoading } from "./components/layout/PageLoading";

import { LoginPage } from "./pages/LoginPage";
import { ActivationPage } from "./pages/ActivationPage";
import { FirstRunSetupPage } from "./pages/FirstRunSetupPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ProductsPage } from "./pages/ProductsPage";
import { ProductDetailPage } from "./pages/ProductDetailPage";
import { InventoryPage } from "./pages/InventoryPage";
import { SuppliersPage } from "./pages/SuppliersPage";
import { SupplierDetailPage } from "./pages/SupplierDetailPage";
import { CustomersPage } from "./pages/CustomersPage";
import { CustomerDetailPage } from "./pages/CustomerDetailPage";
import { PurchaseInvoicesPage } from "./pages/PurchaseInvoicesPage";
import { PurchaseInvoiceNewPage } from "./pages/PurchaseInvoiceNewPage";
import { PurchaseInvoiceDetailPage } from "./pages/PurchaseInvoiceDetailPage";
import { PurchaseInvoiceEditPage } from "./pages/PurchaseInvoiceEditPage";
import { PurchaseInvoicePrintPage } from "./pages/PurchaseInvoicePrintPage";
import { ProductBarcodePrintPage } from "./pages/ProductBarcodePrintPage";
import { SalesInvoicesPage } from "./pages/SalesInvoicesPage";
import { SalesInvoiceNewPage } from "./pages/SalesInvoiceNewPage";
import { SalesInvoiceEditPage } from "./pages/SalesInvoiceEditPage";
import { SalesInvoiceDetailPage } from "./pages/SalesInvoiceDetailPage";
import { SalesInvoicePrintPage } from "./pages/SalesInvoicePrintPage";
import { AlertsPage } from "./pages/AlertsPage";
import { QuotationsPage } from "./pages/QuotationsPage";
import { StocktakesPage } from "./pages/StocktakesPage";
import { ImportPage } from "./pages/ImportPage";
import { StocktakeDetailPage } from "./pages/StocktakeDetailPage";
import { QuotationNewPage } from "./pages/QuotationNewPage";
import { QuotationEditPage } from "./pages/QuotationEditPage";
import { QuotationDetailPage } from "./pages/QuotationDetailPage";
import { QuotationPrintPage } from "./pages/QuotationPrintPage";
import { CashboxPage } from "./pages/CashboxPage";
import { DuesPage } from "./pages/DuesPage";
import { ReportsPage } from "./pages/ReportsPage";
import { AdvancedAnalyticsPage } from "./pages/AdvancedAnalyticsPage";
import { EmployeeReportPage } from "./pages/EmployeeReportPage";
import { SettingsPage } from "./pages/SettingsPage";
import { UsersPage } from "./pages/UsersPage";
import { ReturnsPage } from "./pages/ReturnsPage";
import { DriversPage } from "./pages/DriversPage";
import { EmployeeProfilePage } from "./pages/EmployeeProfilePage";
import { HelpPage } from "./pages/HelpPage";
import { AuditLogPage } from "./pages/AuditLogPage";
import { CustomerStatementPrintPage } from "./pages/CustomerStatementPrintPage";
import { SupplierStatementPrintPage } from "./pages/SupplierStatementPrintPage";
import { POSPage } from "./pages/POSPage";
import { SalesInvoiceReceiptPrintPage } from "./pages/SalesInvoiceReceiptPrintPage";
import { VehicleCatalogPage } from "./pages/VehicleCatalogPage";
import { PartsFinderPage } from "./pages/PartsFinderPage";
import { AutoPartsReportsPage } from "./pages/AutoPartsReportsPage";
import { CustomerGaragePage } from "./pages/CustomerGaragePage";
import { PartAlternativesPage } from "./pages/PartAlternativesPage";
import { WarrantyCenterPage } from "./pages/WarrantyCenterPage";
import { PurchasingAssistantPage } from "./pages/PurchasingAssistantPage";
import { BranchesPage } from "./pages/BranchesPage";
import { PricingRulesPage } from "./pages/PricingRulesPage";
import { MarketingPage } from "./pages/MarketingPage";
import { ShiftsPage } from "./pages/ShiftsPage";

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
          <ProtectedShell permission="products" feature="vehicleCatalog">
            <PartsFinderPage />
          </ProtectedShell>
        }
      />
      <Route
        path="/vehicle-catalog"
        element={
          <ProtectedShell permission="products" feature="vehicleCatalog">
            <VehicleCatalogPage />
          </ProtectedShell>
        }
      />
      <Route
        path="/customer-garage"
        element={
          <ProtectedShell permission="customers" feature="vehicleCatalog">
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
          <ProtectedShell permission="returns" feature="warrantyCenter">
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
          <ProtectedShell permission="pos" feature="pos">
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
  );
}
