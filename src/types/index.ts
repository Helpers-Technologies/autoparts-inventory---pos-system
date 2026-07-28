export type ID = string;

export type PaymentStatus = "paid" | "partial" | "unpaid";
export type SalesPaymentType = "cash" | "account";
export type SalesPriceType = "wholesale" | "retail";
export type MfaPolicyMode =
  "disabled" | "optional" | "required_owner" | "required_all";
export type LoginResult = {
  ok: boolean;
  error?:
    | "invalid_credentials"
    | "rate_limited"
    | "second_factor_required"
    | "mfa_enrollment_required"
    | "invalid_code"
    | "code_reused"
    | "challenge_expired"
    | "invalid_challenge"
    | "not_authenticated";
  remainSeconds?: number;
  attemptsRemaining?: number;
  requiresSecondFactor?: boolean;
  requiresMfaEnrollment?: boolean;
  challengeId?: string;
  expiresAt?: string;
  methods?: Array<"totp" | "recovery_code">;
  manualKey?: string;
  otpauthUri?: string;
};

export interface MfaPolicy {
  mode: MfaPolicyMode;
}

export interface MfaStatus {
  enabled: boolean;
  required: boolean;
  available: boolean;
  recoveryCodesRemaining: number;
  policy: MfaPolicy;
}

export interface MfaUserStatus extends MfaStatus {
  userId: string;
  name: string;
  username: string;
  role: UserRole;
}

export type MfaActionError =
  | "not_authorized"
  | "invalid_input"
  | "invalid_password"
  | "invalid_code"
  | "code_reused"
  | "challenge_expired"
  | "invalid_challenge"
  | "rate_limited"
  | "already_enabled"
  | "not_enabled"
  | "required_by_policy"
  | "feature_disabled"
  | "feature_not_licensed"
  | "user_missing"
  | "cannot_reset_owner"
  | "invalid_policy"
  | "users_not_enrolled";

export type UserRole = "owner" | "employee";
export type ActivationState =
  "inactive" | "active" | "expired" | "machine_mismatch" | "clock_tampered";

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

export interface BranchLicenseStatus {
  machineCode: string;
  branchCount: number;
  branchLimit: number;
  availableSlots: number;
  activatedSlots: number;
  legacySlots: number;
}

export type BranchLicenseError =
  | "not_authorized"
  | "license_inactive"
  | "invalid_code"
  | "machine_mismatch"
  | "code_already_used"
  | "slot_already_available"
  | "activation_required"
  | "invalid_branch"
  | "desktop_required";

export interface BranchActivationResult {
  ok: boolean;
  status?: BranchLicenseStatus;
  error?: BranchLicenseError;
}

export interface UserPermissions {
  pos: {
    view: boolean;
    createSale: boolean;
    openShift: boolean;
    closeShift: boolean;
    viewShifts: boolean;
    supervisorOverride: boolean;
    applyDiscount: boolean;
    holdCart: boolean;
  };
  products: {
    view: boolean;
    add: boolean;
    edit: boolean;
    delete: boolean;
    printBarcode: boolean;
  };
  inventory: {
    view: boolean;
    adjust: boolean;
    stocktakes: boolean;
    transfers: boolean;
  };
  purchaseInvoices: {
    view: boolean;
    add: boolean;
    edit: boolean;
    pay: boolean;
    delete: boolean;
    purchasingAssistant: boolean;
  };
  salesInvoices: {
    view: boolean;
    add: boolean;
    edit: boolean;
    receive: boolean;
    cancel: boolean;
    delete: boolean;
  };
  customers: { view: boolean; add: boolean; edit: boolean; delete: boolean };
  suppliers: {
    view: boolean;
    add: boolean;
    edit: boolean;
    delete: boolean;
    commissions: boolean;
  };
  drivers: { view: boolean; add: boolean; edit: boolean; delete: boolean };
  returns: { view: boolean; add: boolean; approve: boolean };
  alerts: { view: boolean };
  cashbox: {
    view: boolean;
    add: boolean;
    spend: boolean;
    editOpeningBalance: boolean;
  };
  reports: { view: boolean; analytics: boolean; export: boolean };
}

export interface MonthlyEmployeeConfig {
  target?: number;
  commissionPct?: number;
  bonus?: number;
  penalty?: number;
  advance?: number;
}

export interface AppUser {
  id: ID;
  name: string;
  username: string;
  passwordHash: string;
  role: UserRole;
  permissions: UserPermissions;
  /**
   * The branch this user is restricted to (POS, shifts, stock views…).
   * Absent ⇒ unrestricted (all branches) — always true for "owner", and can
   * be left unset for employees who legitimately need multi-branch access.
   */
  branchId?: ID;
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
  /** Structured delivery addresses. Legacy `address` remains as the primary
   * display value so old invoices and imports continue to work. */
  addresses?: CustomerAddress[];
  shippingDirection?: "qibli" | "bahri";
  /** Consent captured by the shop before sending promotional messages. */
  marketingConsent?: "unknown" | "opted_in" | "opted_out";
  /** Maximum allowed outstanding balance (on-account sales). Unset/0 ⇒ no limit enforced. */
  creditLimit?: number;
  notes?: string;
  archived?: boolean;
  createdAt: string;
}

export interface CustomerAddress {
  id: ID;
  label: string;
  recipientName?: string;
  phone?: string;
  /** Optional recipient email forwarded to the shipping provider. */
  recipientEmail?: string;
  governorate: string;
  city: string;
  district?: string;
  addressLine: string;
  landmark?: string;
  buildingNumber?: string;
  floor?: string;
  apartment?: string;
  postalCode?: string;
  isDefault?: boolean;
  /** Provider-specific address identifiers, populated from Bosta coverage data. */
  bosta?: {
    cityId?: string;
    cityName?: string;
    zoneId?: string;
    zoneName?: string;
    districtId?: string;
    districtName?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface Driver {
  id: ID;
  name: string;
  phone?: string;
  licenseNumber?: string;
  salary?: number;
  monthlyConfigs?: Record<string, MonthlyEmployeeConfig>;
  createdAt: string;
}

export interface Product {
  id: ID;
  code: string;
  name: string;
  /** Optional part number for auto parts. */
  partNumber?: string;
  /** Optional brand / manufacturer for auto parts. */
  partBrand?: string;
  /** Optional shelf / rack location. */
  rackLocation?: string;
  /** Optional OEM part numbers list. */
  oemNumbers?: string[];
  /** Optional scannable barcode (EAN/UPC/Code-128). Used by the POS scan input. */
  barcode?: string;
  category: string;
  unit: string;
  retailUnit?: string;
  purchasePrice: number;
  /**
   * Moving weighted-average unit cost, maintained from the real per-unit
   * cost recorded on purchase-invoice lines (as opposed to purchasePrice,
   * which is a user-editable standard/list cost used for pricing floors).
   * Falls back to purchasePrice wherever unset (new/legacy products before
   * their first purchase invoice under this scheme).
   */
  avgCost?: number;
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
  warrantyMonths?: number;
  condition?: "new" | "used" | "refurbished" | "remanufactured";
  qualityGrade?: string;
  originCountry?: string;
  reorderQuantity?: number;
  manufacturer?: string;
  position?: string;
  /** Whether a customer can return this product for a refund/credit. Defaults
   * to true when unset, so existing products stay returnable unless someone
   * explicitly marks them otherwise (e.g. electrical parts, special orders). */
  returnable?: boolean;
  createdAt: string;
}

export interface InvoiceLine {
  id: ID;
  productId: ID;
  productName: string;
  partNumber?: string;
  partBrand?: string;
  unit: string;
  quantity: number;
  price: number;
  priceType?: SalesPriceType;
  /** Purchase cost per unit at time of sale — used for gross profit calculation. */
  costPrice?: number;
  expiryDate?: string;
  warrantyMonths?: number;
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
  branchId?: ID;
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
  deliveryMethod?: DeliveryMethod;
  deliveryAddress?: CustomerAddressSnapshot;
  shippingProviderId?: ID;
  shippingProviderName?: string;
  shippingFee?: number;
  deliveryOrderId?: ID;
  /** The carrier collects the invoice amount on delivery; this is not a licensed credit sale. */
  collectOnDelivery?: boolean;
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
  customerVehicleId?: ID;
  vehicleLabel?: string;
  branchId?: ID;
  branchName?: string;
  priceTierId?: ID;
  priceTierName?: string;
  createdByUserId?: ID;
  shiftId?: ID;
  createdAt: string;
}

export type DeliveryMethod = "pickup" | "branch_driver" | "shipping_company";

export interface CustomerAddressSnapshot {
  addressId?: ID;
  label?: string;
  recipientName: string;
  phone: string;
  recipientEmail?: string;
  governorate: string;
  city: string;
  district?: string;
  addressLine: string;
  landmark?: string;
  buildingNumber?: string;
  floor?: string;
  apartment?: string;
  postalCode?: string;
  bosta?: CustomerAddress["bosta"];
}

export type ShippingProviderKind = "manual" | "bosta";

export interface ShippingProvider {
  id: ID;
  name: string;
  kind: ShippingProviderKind;
  /** Locally stored company logo used in POS provider cards. */
  logoDataUrl?: string;
  phone?: string;
  trackingUrlTemplate?: string;
  active: boolean;
  supportsCashOnDelivery: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ShippingRate {
  id: ID;
  providerId: ID;
  governorate: string;
  city?: string;
  district?: string;
  fee: number;
  cashOnDeliveryFee?: number;
  returnFee?: number;
  estimatedDaysMin?: number;
  estimatedDaysMax?: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export type DeliveryOrderStatus =
  | "draft"
  | "ready"
  | "assigned"
  | "pickup_requested"
  | "picked_up"
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "exception"
  | "returned"
  | "cancelled";

export interface DeliveryStatusEvent {
  id: ID;
  status: DeliveryOrderStatus;
  label: string;
  occurredAt: string;
  source: "system" | "user" | "bosta";
  externalCode?: number;
  note?: string;
}

export interface DeliveryOrder {
  id: ID;
  orderNumber: string;
  invoiceId: ID;
  invoiceNumber: string;
  customerId: ID;
  customerName: string;
  branchId?: ID;
  branchName?: string;
  method: Exclude<DeliveryMethod, "pickup">;
  address: CustomerAddressSnapshot;
  shippingFee: number;
  codAmount: number;
  codSettledAmount?: number;
  codSettledAt?: string;
  codSettlementMethod?: PaymentMethod;
  driverId?: ID;
  driverName?: string;
  providerId?: ID;
  providerName?: string;
  status: DeliveryOrderStatus;
  externalShipmentId?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  externalStateCode?: number;
  promisedDate?: string;
  exceptionReason?: string;
  packageType?: "SMALL" | "MEDIUM" | "LARGE" | "Light Bulky" | "Heavy Bulky";
  itemsCount?: number;
  packageDescription?: string;
  allowOpenPackage?: boolean;
  notes?: string;
  events: DeliveryStatusEvent[];
  createdAt: string;
  updatedAt: string;
}

export interface BostaIntegrationConfig {
  enabled: boolean;
  autoTrackingEnabled?: boolean;
  autoTrackingIntervalMinutes?: number;
  businessLocationId?: string;
  webhookUrl?: string;
  webhookHeaderName?: string;
  webhookHeaderConfigured?: boolean;
  webhookHeaderHint?: string;
  webhookRelayReady?: boolean;
  webhookPollTokenConfigured?: boolean;
  webhookPollTokenHint?: string;
  defaultPackageType: DeliveryOrder["packageType"];
  allowOpenPackage: boolean;
  configured: boolean;
  apiKeyHint?: string;
  lastTestedAt?: string;
  lastTestOk?: boolean;
}

export interface CashierShift {
  id: ID;
  shiftNumber: number;
  cashierId: ID;
  cashierName: string;
  cashierUsername: string;
  openedAt: string;
  closedAt?: string;
  status: "open" | "closed";
  openingCash: number;
  closingCashActual?: number;
  expectedCash: number;
  difference?: number;
  note?: string;
  totalSalesCount: number;
  totalSalesAmount: number;
  /** نقدية دخلت الدرج بخلاف تحصيلات المبيعات (عهدة/إضافة يدوية/مرتجع مشتريات). */
  totalCashAdditions?: number;
  totalCashSales: number;
  /** @deprecated Kept for old records only — every non-cash, non-credit method used to be lumped in here as "Visa". New shifts populate {@link paymentMethodTotals} instead. */
  totalVisaSales: number;
  totalCreditSales: number;
  /** Per-method breakdown of non-cash, non-credit sales (bank/vodafone/instapay/other), keyed by the real {@link PaymentMethod}. */
  paymentMethodTotals?: Partial<Record<PaymentMethod, number>>;
  totalRefunds: number;
  totalExpenses: number;
  salesInvoiceIds: ID[];
  branchId?: ID;
  branchName?: string;
}

export type StockMovementType =
  "purchase" | "sale" | "adjustment-in" | "adjustment-out" | "return";

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
  customerVehicleId?: ID;
  vehicleLabel?: string;
  branchId?: ID;
  branchName?: string;
  priceTierId?: ID;
  priceTierName?: string;
  createdAt: string;
}

export type CashEntryType =
  | "sales-receipt"
  | "purchase-payment"
  | "manual-add"
  | "manual-remove"
  | "adjustment";

export type PaymentMethod =
  "cash" | "bank" | "card" | "vodafone" | "instapay" | "other" | "credit";

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
  /** الوردية التي حدثت خلالها الحركة، لمنع خلط خزنة أكثر من كاشير. */
  shiftId?: ID;
  createdByUserId?: ID;
  createdAt?: string;
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
  /** Timestamp of the last internal (in-browser localStorage) safety backup.
   *  Kept separate from `lastBackupDate` which tracks external file-system
   *  backups — otherwise the 30-minute internal timer gives false confidence
   *  that the real backup (to an external drive/network share) ran recently. */
  lastInternalBackupDate: string;
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
  /** Days after purchase date within which sales returns are allowed (default 14). */
  maxReturnDays?: number;
  /** Days after which old activity log entries are automatically pruned (0 = keep all). */
  auditLogPruneDays?: number;
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
  jobTitle?: string;
  phone?: string;
  notes?: string;
  archived?: boolean;
  createdAt: string;
}

export type OfflineEmployeeTransactionType =
  "salary" | "advance" | "incentive" | "deduction" | "advance-deduction";

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
  | "shift_opened"
  | "shift_closed"
  | "invoice_restored"
  | "user_login"
  | "user_logout"
  | "settings_updated"
  | "backup_created"
  | "backup_failed"
  | "backup_restored"
  | "quotation_created"
  | "quotation_updated"
  | "quotation_deleted"
  | "stocktake_created"
  | "branch_created"
  | "branch_updated"
  | "branch_deleted"
  | "user_created"
  | "user_updated"
  | "user_permissions_updated"
  | "user_deleted"
  | "stock_transfer_created";

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

export interface CustomerVehicle {
  id: ID;
  customerId: ID;
  vin?: string;
  plateNumber?: string;
  makeId: ID;
  modelId?: ID;
  generationId?: ID;
  engineId?: ID;
  year?: number;
  engineCode?: string;
  color?: string;
  mileageKm?: number;
  notes?: string;
  archived?: boolean;
  createdAt: string;
  updatedAt: string;
}

export type WarrantyClaimStatus =
  | "open"
  | "inspecting"
  | "supplier"
  | "approved"
  | "rejected"
  | "replaced"
  | "compensated";

export interface WarrantyClaim {
  id: ID;
  invoiceId: ID;
  invoiceNumber: string;
  invoiceLineId: ID;
  customerId: ID;
  customerName: string;
  productId: ID;
  productName: string;
  supplierId?: ID;
  complaint: string;
  serialNumber?: string;
  status: WarrantyClaimStatus;
  /** Set once the "replaced" transition has deducted a replacement unit from stock — guards against double-deduction. */
  stockDeducted?: boolean;
  /** Cost of the replacement unit given to the customer (product avgCost/purchasePrice at the time of replacement). */
  replacementCost?: number;
  /** Cash paid back to the customer as a warranty settlement instead of replacing the part. */
  compensationAmount?: number;
  /** Cash-entry reference; its presence prevents paying the same compensation twice. */
  compensationCashEntryId?: ID;
  compensatedAt?: string;
  openedAt: string;
  updatedAt: string;
}

export interface Branch {
  id: ID;
  code: string;
  name: string;
  isMain: boolean;
  active: boolean;
  address?: string;
  phone?: string;
  createdAt: string;
}

export interface BranchCreationResult extends BranchActivationResult {
  branch?: Branch;
}

export interface BranchStock {
  branchId: ID;
  productId: ID;
  quantity: number;
  updatedAt: string;
}

export type PriceTierBasis = "cost" | "wholesale" | "retail";

export interface PriceTier {
  id: ID;
  name: string;
  basis: PriceTierBasis;
  adjustmentPct: number;
  minMarginPct: number;
  isDefault?: boolean;
  active: boolean;
  createdAt: string;
}

export interface ProductFitment {
  id: ID;
  productId: ID;
  makeId: ID;
  modelId?: ID;
  generationId?: ID;
  engineId?: ID;
  yearFrom?: number;
  yearTo?: number;
  notes?: string;
  createdAt: string;
}

export interface StockTransfer {
  id: ID;
  transferNumber: string;
  fromBranchId: ID;
  toBranchId: ID;
  productId: ID;
  productName: string;
  quantity: number;
  date: string;
  status: "completed" | "pending" | string;
  notes?: string;
  createdAt: string;
}

export interface VehicleMake {
  id: ID;
  name: string;
  nameAr?: string;
  slug: string;
  logoPath?: string;
  priority?: number;
  active: boolean;
  source: string;
  sourceUrl?: string;
  countryCode?: string;
  country?: string;
  createdAt?: string;
}

export interface VehicleModel {
  id: ID;
  makeId: ID;
  name: string;
  nameAr?: string;
  vehicleType?: string;
  sourceId?: number;
  active: boolean;
  source: string;
  createdAt?: string;
}

export interface VehicleGeneration {
  id: ID;
  modelId: ID;
  name: string;
  yearFrom?: number;
  yearTo?: number;
  bodyTypes?: string[];
  active: boolean;
  createdAt: string;
}

export interface VehicleEngine {
  id: ID;
  generationId: ID;
  name: string;
  code?: string;
  capacityCc?: number;
  fuelType?: "petrol" | "diesel" | "hybrid" | "electric" | "other";
  powerHp?: number;
  active: boolean;
  createdAt: string;
}

export type PartAlternativeRelation =
  "equivalent" | "economy" | "premium" | "superseded";

export interface ProductAlternative {
  id: ID;
  productId: ID;
  alternativeProductId: ID;
  relation: PartAlternativeRelation;
  notes?: string;
  createdAt: string;
}

export interface VehicleCatalogPreferences {
  includeAllMakes: boolean;
  selectedCountryCodes: string[];
  selectedMakeIds: ID[];
  updatedAt?: string;
}
