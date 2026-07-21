export type ID = string;

export type PaymentStatus = "paid" | "partial" | "unpaid";
export type SalesPaymentType = "cash" | "account";
export type SalesPriceType = "wholesale" | "retail";
export type LoginResult = {
  ok: boolean;
  error?: "invalid_credentials" | "rate_limited";
  remainSeconds?: number;
  attemptsRemaining?: number;
};

export type UserRole = "owner" | "employee";
export type ActivationState =
  | "inactive"
  | "active"
  | "expired"
  | "machine_mismatch"
  | "clock_tampered";

export interface LicensePayload {
  licenseId: string;
  machineHash: string;
  subscriptionType: "limited" | "lifetime";
  subscriptionStartDate: string;
  subscriptionExpiresAt: string | null;
  warrantyStartDate: string | null;
  warrantyExpiresAt: string | null;
  /** Optional package label (informational), e.g. "basic" | "pro". */
  plan?: string;
  /**
   * Optional whitelist of enabled feature keys (the package the client bought).
   * Signed into the serial, so it is tamper-proof. Absent/empty ⇒ all features
   * allowed (back-compat with serials issued before feature packaging).
   */
  features?: string[];
  issuedAt: string;
  signature: string;
}

export interface LicenseStatus {
  state: ActivationState;
  machineCode: string;
  machineHash: string;
  license?: LicensePayload;
  message?: string;
}

export interface UserPermissions {
  products: { view: boolean; add: boolean; edit: boolean; delete: boolean };
  inventory: { view: boolean; adjust: boolean };
  purchaseInvoices: { view: boolean; add: boolean; edit: boolean; pay: boolean; delete: boolean };
  salesInvoices: { view: boolean; add: boolean; edit: boolean; receive: boolean; cancel: boolean; delete: boolean };
  customers: { view: boolean; add: boolean; edit: boolean; delete: boolean };
  suppliers: { view: boolean; add: boolean; edit: boolean; delete: boolean; commissions: boolean };
  drivers: { view: boolean; add: boolean; edit: boolean; delete: boolean };
  returns: { view: boolean; add: boolean };
  alerts: { view: boolean };
  cashbox: { view: boolean; add: boolean; spend: boolean; editOpeningBalance: boolean };
  reports: { view: boolean };
}

export interface MonthlyEmployeeConfig {
  target?: number;
  commissionPct?: number;
}

export interface AppUser {
  id: ID;
  name: string;
  username: string;
  passwordHash: string;
  role: UserRole;
  permissions: UserPermissions;
  monthlySalary?: number;
  salesCommissionPct?: number;
  monthlySalesTarget?: number;
  monthlyConfigs?: Record<string, MonthlyEmployeeConfig>;
  createdAt: string;
}

export type CommissionType = "percentage" | "fixed";

export interface CommissionTier {
  id: ID;
  threshold: number;
  commissionType: CommissionType;
  commissionValue: number;
  periodDays: number;
}

export interface Supplier {
  id: ID;
  code?: string;
  name: string;
  phone?: string;
  address?: string;
  notes?: string;
  commissionNote?: string;
  commissionTiers?: CommissionTier[];
  archived?: boolean;
  createdAt: string;
}

export interface Customer {
  id: ID;
  code?: string;
  name: string;
  phone?: string;
  address?: string;
  shippingDirection?: "qibli" | "bahri";
  notes?: string;
  archived?: boolean;
  createdAt: string;
}

export interface Driver {
  id: ID;
  name: string;
  phone?: string;
  licenseNumber?: string;
  createdAt: string;
}

export interface Product {
  id: ID;
  code: string;
  name: string;
  /** Optional scannable barcode (EAN/UPC/Code-128). Used by the POS scan input. */
  barcode?: string;
  category: string;
  unit: string;
  retailUnit?: string;
  purchasePrice: number;
  wholesalePrice: number;
  retailPrice: number;
  piecesPerUnit?: number;
  quantity: number;
  looseQuantity?: number;
  minStock: number;
  hasExpiry: boolean;
  expiryDate?: string;
  supplierId?: ID;
  notes?: string;
  archived?: boolean;
  createdAt: string;
}

export interface InvoiceLine {
  id: ID;
  productId: ID;
  productName: string;
  unit: string;
  quantity: number;
  price: number;
  priceType?: SalesPriceType;
  /** Purchase cost per unit at time of sale — used for gross profit calculation. */
  costPrice?: number;
  expiryDate?: string;
  subtotal: number;
  isRetailUnit?: boolean;
}

export interface PurchaseInvoice {
  id: ID;
  invoiceNumber: string;
  date: string;
  supplierId: ID;
  supplierName: string;
  lines: InvoiceLine[];
  total: number;
  amountPaid: number;
  remaining: number;
  overpayment?: number;
  status: PaymentStatus;
  notes?: string;
  paymentLog?: PaymentLogEntry[];
  createdAt: string;
}

export interface SalesInvoice {
  id: ID;
  invoiceNumber: string;
  date: string;
  customerId: ID;
  customerName: string;
  driverId?: ID;
  driverName?: string;
  lines: InvoiceLine[];
  total: number;
  discount?: number;
  amountReceived: number;
  remaining: number;
  overpayment?: number;
  paymentType: SalesPaymentType;
  paymentMethod?: PaymentMethod;
  paymentMethodLabel?: string;
  priceType: SalesPriceType;
  paymentDueDate?: string;
  status: PaymentStatus;
  notes?: string;
  cancelled?: boolean;
  paymentLog?: PaymentLogEntry[];
  createdByUserId?: ID;
  createdAt: string;
}

export type StockMovementType =
  | "purchase"
  | "sale"
  | "adjustment-in"
  | "adjustment-out"
  | "return";

export interface ReturnLine {
  id: ID;
  sourceLineId?: ID;
  productId: ID;
  productName: string;
  unit: string;
  quantity: number;
  price: number;
  priceType?: SalesPriceType;
  subtotal: number;
  isRetailUnit?: boolean;
}

export interface SalesReturn {
  id: ID;
  returnNumber: string;
  date: string;
  originalInvoiceId: ID;
  originalInvoiceNumber: string;
  customerId: ID;
  customerName: string;
  lines: ReturnLine[];
  total: number;
  refundCash: boolean;
  notes?: string;
  createdAt: string;
}

export interface PurchaseReturn {
  id: ID;
  returnNumber: string;
  date: string;
  originalInvoiceId: ID;
  originalInvoiceNumber: string;
  supplierId: ID;
  supplierName: string;
  lines: ReturnLine[];
  total: number;
  notes?: string;
  createdAt: string;
}

export interface StockMovement {
  id: ID;
  productId: ID;
  productName: string;
  type: StockMovementType;
  quantity: number;
  reason?: string;
  referenceId?: ID;
  referenceType?: "purchase" | "sale" | "manual";
  date: string;
}

export interface StocktakeItem {
  productId: ID;
  productName: string;
  systemQty: number;
  countedQty: number | null;
  /** Snapshot of the product's piecesPerUnit — set only for piece-enabled products. */
  piecesPerUnit?: number;
  /** Loose pieces in the system at snapshot time (piece-enabled products only). */
  systemLoose?: number;
  /** Counted loose pieces (piece-enabled products only). */
  countedLoose?: number | null;
}

export type StocktakeStatus = "draft" | "applied";

export interface Stocktake {
  id: ID;
  date: string;
  status: StocktakeStatus;
  notes?: string;
  items: StocktakeItem[];
  appliedAt?: string;
  createdAt: string;
}

export type QuotationStatus = "draft" | "converted";

export interface Quotation {
  id: ID;
  quotationNumber: string;
  date: string;
  validUntil?: string;
  customerId: ID;
  customerName: string;
  lines: InvoiceLine[];
  total: number;
  discount?: number;
  notes?: string;
  status: QuotationStatus;
  convertedInvoiceId?: ID;
  createdAt: string;
}

export type CashEntryType =
  | "sales-receipt"
  | "purchase-payment"
  | "manual-add"
  | "manual-remove"
  | "adjustment";

export type PaymentMethod = "cash" | "bank" | "vodafone" | "instapay" | "other" | "credit";

export interface PaymentLogEntry {
  id: ID;
  date: string;
  amount: number;
  paymentMethod: PaymentMethod;
  notes?: string;
}

export interface CashEntry {
  id: ID;
  type: CashEntryType;
  amount: number;
  description: string;
  referenceId?: ID;
  date: string;
  paymentMethod?: PaymentMethod;
}

export interface Settings {
  companyName: string;
  companyNameAr: string;
  ownerName: string;
  ownerPhone: string;
  invoiceFooter: string;
  /** Custom WhatsApp message template for sales/purchase invoices. */
  whatsappInvoiceTemplate?: string;
  currency: string;
  lowStockThreshold: number;
  arabicLabels: boolean;
  openingBalance: number;
  printPaperSize: "A4" | "A5";
  logoText: string;
  logoImage: string;
  autoBackupEnabled: boolean;
  autoBackupFrequency: "daily" | "weekly" | "monthly";
  lastBackupDate: string;
  /** Destination folder for automatic backups (local, external drive, or network/NAS share). */
  backupPath: string;
  invoicesSavePath: string;
  subscriptionType: "limited" | "lifetime";
  subscriptionStartDate: string;
  subscriptionMonths: number;
  warrantyType: "none" | "limited";
  warrantyStartDate: string;
  warrantyMonths: number;
  /** Minutes of inactivity before session locks. 0 = disabled. */
  idleLockMinutes: number;
  /** Days after which an unpaid supplier invoice is flagged overdue in alerts. */
  paymentTermDays: number;
  /** Take an automatic backup to the configured folder when the app closes. */
  backupOnClose: boolean;
  /** Days before product expiry to show alert (default 14). */
  expiryAlertDays?: number;
  /**
   * Owner-controlled per-module visibility. Keys are FeatureKey (see
   * lib/features.ts). Missing key ⇒ that module's default state. This is the
   * "hide" layer; the license still caps what can be enabled.
   */
  features?: Record<string, boolean>;
}

export interface OfflineEmployee {
  id: ID;
  name: string;
  idNumber?: string;
  basicSalary: number;
  notes?: string;
  archived?: boolean;
  createdAt: string;
}

export type OfflineEmployeeTransactionType =
  | "salary"
  | "advance"
  | "incentive"
  | "deduction"
  | "advance-deduction";

export interface OfflineEmployeeTransaction {
  id: ID;
  employeeId: ID;
  type: OfflineEmployeeTransactionType;
  amount: number;
  month?: string;
  notes?: string;
  date: string;
  createdAt: string;
}

export interface ActivityItem {
  id: ID;
  icon: string;
  title: string;
  subtitle?: string;
  date: string;
  amount?: number;
  type: "sale" | "purchase" | "stock" | "cash" | "other";
}

export type AuditAction =
  | "invoice_sale_created"
  | "invoice_sale_updated"
  | "invoice_sale_cancelled"
  | "invoice_sale_deleted"
  | "invoice_purchase_created"
  | "invoice_purchase_updated"
  | "invoice_purchase_deleted"
  | "return_sale_created"
  | "return_purchase_created"
  | "stock_adjusted"
  | "product_created"
  | "product_updated"
  | "product_deleted"
  | "product_archived"
  | "product_restored"
  | "customer_created"
  | "customer_updated"
  | "customer_deleted"
  | "customer_archived"
  | "customer_restored"
  | "supplier_created"
  | "supplier_updated"
  | "supplier_deleted"
  | "supplier_archived"
  | "supplier_restored"
  | "driver_created"
  | "driver_updated"
  | "driver_deleted"
  | "cash_manual_add"
  | "cash_manual_remove"
  | "invoice_restored"
  | "user_login"
  | "user_logout"
  | "settings_updated"
  | "backup_created"
  | "backup_restored"
  | "quotation_created"
  | "quotation_updated"
  | "quotation_deleted"
  | "stocktake_created"
  | "branch_created"
  | "branch_updated"
  | "branch_deleted";

/**
 * Full snapshot captured when an invoice is deleted — everything the delete
 * removed (the invoice, its cash entries, its stock movements) so the audit
 * log can restore the operation exactly.
 */
export interface AuditSnapshot {
  kind: "sales-invoice" | "purchase-invoice";
  invoice: SalesInvoice | PurchaseInvoice;
  cashEntries: CashEntry[];
  stockMovements: StockMovement[];
}

export interface AuditLog {
  id: ID;
  action: AuditAction;
  entityLabel: string;
  userId: ID;
  userName: string;
  timestamp: string;
  details?: string;
  /** Present on restorable deletions; cleared once the entry is restored. */
  snapshot?: AuditSnapshot;
}
