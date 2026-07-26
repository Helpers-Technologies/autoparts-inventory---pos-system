import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  Branch,
  BranchCreationResult,
  BranchStock,
  CustomerVehicle,
  PriceTier,
  Product,
  ProductFitment,
  StockTransfer,
  VehicleMake,
  VehicleModel,
  WarrantyClaim,
} from "../types";
import { lsGet, lsSetBatch } from "../lib/storage";
import { uid } from "../lib/utils";
import { useAuth } from "./AuthContext";
import { useCatalog } from "./CatalogContext";
import { useAuditLog } from "./AuditLogContext";

export const MAIN_BRANCH_ID = "branch_main";

export const DEFAULT_BRANCHES: Branch[] = [
  {
    id: MAIN_BRANCH_ID,
    code: "MAIN",
    name: "الفرع الرئيسي",
    isMain: true,
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

export const DEFAULT_PRICE_TIERS: PriceTier[] = [
  { id: "tier_wholesale", name: "جملة", basis: "wholesale", adjustmentPct: 0, minMarginPct: 8, isDefault: true, active: true, createdAt: "2026-01-01T00:00:00.000Z" },
  { id: "tier_retail", name: "قطاعي", basis: "retail", adjustmentPct: 0, minMarginPct: 15, active: true, createdAt: "2026-01-01T00:00:00.000Z" },
  { id: "tier_mechanic", name: "ميكانيكي / ورشة", basis: "retail", adjustmentPct: -10, minMarginPct: 12, active: true, createdAt: "2026-01-01T00:00:00.000Z" },
  { id: "tier_distributor", name: "موزع", basis: "wholesale", adjustmentPct: -5, minMarginPct: 6, active: true, createdAt: "2026-01-01T00:00:00.000Z" },
];

export function normalizeVin(value: string): string {
  return value.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "").slice(0, 17);
}

export function isValidVin(value: string): boolean {
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(normalizeVin(value));
}

const VIN_MAKE_PREFIXES: Array<[RegExp, string]> = [
  [/^(KMH|KMF)/, "Hyundai"],
  [/^(KNA|KND|KNE)/, "Kia"],
  [/^(LVV|LVT)/, "Chery"],
  [/^LSJ/, "MG"],
  [/^(L6T|LBE)/, "Geely"],
  [/^LGW/, "Haval"],
];

export function inferMakeNameFromVin(value: string): string | undefined {
  const vin = normalizeVin(value);
  return VIN_MAKE_PREFIXES.find(([pattern]) => pattern.test(vin))?.[1];
}

export function calculateTierPrice(product: Product, tier?: PriceTier): number {
  if (!tier) return product.wholesalePrice;
  const basis = tier.basis === "cost"
    ? product.purchasePrice
    : tier.basis === "retail"
      ? product.retailPrice
      : product.wholesalePrice;
  const adjusted = basis * (1 + tier.adjustmentPct / 100);
  const floor = product.purchasePrice * (1 + Math.max(0, tier.minMarginPct) / 100);
  return Math.round(Math.max(adjusted, floor) * 100) / 100;
}

export type FitmentStatus = "compatible" | "incompatible" | "unknown";

export function productVehicleFitmentStatus(
  productId: string,
  vehicle: CustomerVehicle | undefined,
  fitments: ProductFitment[],
): FitmentStatus {
  if (!vehicle) return "unknown";
  const links = fitments.filter((fitment) => fitment.productId === productId);
  if (links.length === 0) return "unknown";
  const matches = links.some((fitment) => {
    if (fitment.makeId !== vehicle.makeId) return false;
    if (fitment.modelId && fitment.modelId !== vehicle.modelId) return false;
    if (fitment.generationId && vehicle.generationId && fitment.generationId !== vehicle.generationId) return false;
    if (fitment.engineId && vehicle.engineId && fitment.engineId !== vehicle.engineId) return false;
    if (vehicle.year && fitment.yearFrom && vehicle.year < fitment.yearFrom) return false;
    if (vehicle.year && fitment.yearTo && vehicle.year > fitment.yearTo) return false;
    return true;
  });
  return matches ? "compatible" : "incompatible";
}

export function vehicleDisplayName(
  vehicle: CustomerVehicle,
  makes: VehicleMake[],
  models: VehicleModel[],
): string {
  const make = makes.find((item) => item.id === vehicle.makeId)?.name ?? "سيارة";
  const model = models.find((item) => item.id === vehicle.modelId)?.name;
  return [make, model, vehicle.year, vehicle.plateNumber].filter(Boolean).join(" · ");
}

function initialBranchStocks(products: Product[]): BranchStock[] {
  const updatedAt = new Date().toISOString();
  return products.map((product) => ({
    branchId: MAIN_BRANCH_ID,
    productId: product.id,
    quantity: product.quantity,
    updatedAt,
  }));
}

export function reconcileBranchStocks(
  current: BranchStock[],
  products: Product[],
  branches: Branch[],
): BranchStock[] {
  const productIds = new Set(products.map((product) => product.id));
  const branchIds = new Set(branches.map((branch) => branch.id));
  const mainId = branches.find((branch) => branch.isMain)?.id ?? branches[0]?.id ?? MAIN_BRANCH_ID;
  const now = new Date().toISOString();
  const next = current
    .filter((row) => productIds.has(row.productId) && branchIds.has(row.branchId))
    .map((row) => ({ ...row, quantity: Math.max(0, Number(row.quantity) || 0) }));
  const byKey = new Map(next.map((row) => [`${row.branchId}:${row.productId}`, row]));

  for (const product of products) {
    const productRows = next.filter((row) => row.productId === product.id);
    const allocated = productRows.reduce((sum, row) => sum + row.quantity, 0);
    const diff = product.quantity - allocated;
    if (Math.abs(diff) < 0.000001) continue;
    const key = `${mainId}:${product.id}`;
    const main = byKey.get(key);
    if (diff > 0 && main) {
      main.quantity += diff;
      main.updatedAt = now;
    } else if (diff > 0) {
      const row = { branchId: mainId, productId: product.id, quantity: Math.max(0, diff), updatedAt: now };
      next.push(row);
      byKey.set(key, row);
    } else {
      // A stock correction or a sale made outside a branch can reduce the global
      // quantity below the current allocations. Consume the main branch first,
      // then the remaining branches, while keeping every row non-negative.
      let excess = -diff;
      const orderedRows = [...productRows].sort((a, b) => Number(b.branchId === mainId) - Number(a.branchId === mainId));
      for (const row of orderedRows) {
        if (excess <= 0) break;
        const removed = Math.min(row.quantity, excess);
        row.quantity -= removed;
        row.updatedAt = now;
        excess -= removed;
      }
    }
  }
  return next;
}

type NewCustomerVehicle = Omit<CustomerVehicle, "id" | "createdAt" | "updatedAt">;
type NewWarrantyClaim = Omit<WarrantyClaim, "id" | "openedAt" | "updatedAt" | "status">;
type NewBranch = Omit<Branch, "id" | "code" | "createdAt" | "isMain">;
type NewPriceTier = Omit<PriceTier, "id" | "createdAt">;

export interface AutoPartsProContextValue {
  customerVehicles: CustomerVehicle[];
  warrantyClaims: WarrantyClaim[];
  branches: Branch[];
  branchStocks: BranchStock[];
  stockTransfers: StockTransfer[];
  priceTiers: PriceTier[];
  addCustomerVehicle: (input: NewCustomerVehicle) => CustomerVehicle;
  updateCustomerVehicle: (id: string, patch: Partial<CustomerVehicle>) => void;
  archiveCustomerVehicle: (id: string, archived: boolean) => void;
  addWarrantyClaim: (input: NewWarrantyClaim) => WarrantyClaim;
  updateWarrantyClaim: (id: string, patch: Partial<WarrantyClaim>) => void;
  addBranch: (input: NewBranch) => Promise<BranchCreationResult>;
  updateBranch: (id: string, patch: Partial<Branch>) => void;
  transferStock: (input: Omit<StockTransfer, "id" | "transferNumber" | "createdAt" | "status">) => StockTransfer | null;
  branchQuantity: (branchId: string, productId: string) => number;
  consumeBranchStock: (branchId: string, lines: Array<{ productId: string; quantity: number }>) => void;
  receivePurchaseStock: (branchId: string, lines: Array<{ productId: string; quantity: number }>) => void;
  addPriceTier: (input: NewPriceTier) => PriceTier;
  updatePriceTier: (id: string, patch: Partial<PriceTier>) => void;
  deletePriceTier: (id: string) => boolean;
  reloadProData: () => void;
}

const AutoPartsProContext = createContext<AutoPartsProContextValue | null>(null);

export function AutoPartsProProvider({ children }: { children: ReactNode }) {
  const { auth, isDesktop } = useAuth();
  const { products } = useCatalog();
  const { logAudit } = useAuditLog();
  const productsRef = useRef(products);
  const [customerVehicles, setCustomerVehicles] = useState<CustomerVehicle[]>(() => lsGet("customerVehicles", []));
  const [warrantyClaims, setWarrantyClaims] = useState<WarrantyClaim[]>(() => lsGet("warrantyClaims", []));
  const [branches, setBranches] = useState<Branch[]>(() => lsGet("branches", DEFAULT_BRANCHES));
  const [branchStocks, setBranchStocks] = useState<BranchStock[]>(() => lsGet("branchStocks", initialBranchStocks(products)));
  const [stockTransfers, setStockTransfers] = useState<StockTransfer[]>(() => lsGet("stockTransfers", []));
  const [priceTiers, setPriceTiers] = useState<PriceTier[]>(() => lsGet("priceTiers", DEFAULT_PRICE_TIERS));
  // Hard execution lock for transferStock — a double-click fires two calls
  // before React re-renders, so both would read the same stale `branchStocks`
  // availability snapshot and both could pass the check. The lock rejects the
  // second call outright, and only clears once branchStocks has actually
  // committed (see the effect below), so the next real transfer sees fresh data.
  const transferInFlightRef = useRef(false);

  useEffect(() => {
    productsRef.current = products;
  }, [products]);

  useEffect(() => {
    transferInFlightRef.current = false;
  }, [branchStocks]);

  const reloadProData = useCallback(() => {
    const storedBranches = lsGet<Branch[]>("branches", DEFAULT_BRANCHES);
    setCustomerVehicles(lsGet("customerVehicles", []));
    setWarrantyClaims(lsGet("warrantyClaims", []));
    setBranches(storedBranches.length ? storedBranches : DEFAULT_BRANCHES);
    setBranchStocks(lsGet("branchStocks", initialBranchStocks(productsRef.current)));
    setStockTransfers(lsGet("stockTransfers", []));
    setPriceTiers(lsGet("priceTiers", DEFAULT_PRICE_TIERS));
  }, []);

  useEffect(() => {
    if (!auth.isAuthenticated) return;
    reloadProData();
  }, [auth.isAuthenticated, reloadProData]);

  useEffect(() => {
    setBranchStocks((current) => {
      const next = reconcileBranchStocks(current, products, branches);
      const before = current.map((row) => `${row.branchId}:${row.productId}:${row.quantity}`).sort().join("|");
      const after = next.map((row) => `${row.branchId}:${row.productId}:${row.quantity}`).sort().join("|");
      return before === after ? current : next;
    });
  }, [products, branches]);

  useEffect(() => {
    if (isDesktop && !auth.isAuthenticated) return;
    const timer = window.setTimeout(() => {
      lsSetBatch({ customerVehicles, warrantyClaims, branches, branchStocks, stockTransfers, priceTiers });
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [auth.isAuthenticated, isDesktop, customerVehicles, warrantyClaims, branches, branchStocks, stockTransfers, priceTiers]);

  useEffect(() => {
    window.addEventListener("autoparts:pro-data-restored", reloadProData);
    return () => window.removeEventListener("autoparts:pro-data-restored", reloadProData);
  }, [reloadProData]);

  const addCustomerVehicle = useCallback((input: NewCustomerVehicle) => {
    const now = new Date().toISOString();
    const item: CustomerVehicle = {
      ...input,
      vin: input.vin ? normalizeVin(input.vin) : undefined,
      plateNumber: input.plateNumber?.trim().toUpperCase() || undefined,
      id: uid("vehicle"),
      createdAt: now,
      updatedAt: now,
    };
    setCustomerVehicles((items) => [item, ...items]);
    return item;
  }, []);

  const updateCustomerVehicle = useCallback((id: string, patch: Partial<CustomerVehicle>) => {
    setCustomerVehicles((items) => items.map((item) => item.id === id ? {
      ...item,
      ...patch,
      vin: patch.vin === undefined ? item.vin : normalizeVin(patch.vin),
      updatedAt: new Date().toISOString(),
    } : item));
  }, []);

  const archiveCustomerVehicle = useCallback((id: string, archived: boolean) => {
    setCustomerVehicles((items) => items.map((item) => item.id === id ? { ...item, archived, updatedAt: new Date().toISOString() } : item));
  }, []);

  const addWarrantyClaim = useCallback((input: NewWarrantyClaim) => {
    const now = new Date().toISOString();
    const item: WarrantyClaim = { ...input, id: uid("claim"), status: "open", openedAt: now, updatedAt: now };
    setWarrantyClaims((items) => [item, ...items]);
    return item;
  }, []);

  const updateWarrantyClaim = useCallback((id: string, patch: Partial<WarrantyClaim>) => {
    setWarrantyClaims((items) => items.map((item) => item.id === id ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item));
  }, []);

  const addBranch = useCallback(async (input: NewBranch): Promise<BranchCreationResult> => {
    const api = window.desktopAPI?.branchLicensing;
    if (!api) return { ok: false, error: "desktop_required" };
    try {
      const result = await api.createBranch({
        name: input.name,
        address: input.address,
        phone: input.phone,
      });
      if (!result.ok || !result.branch) return result;
      setBranches((items) => items.some((item) => item.id === result.branch!.id)
        ? items
        : [...items, result.branch!]);
      logAudit?.("branch_created", result.branch.name, `كود الفرع: ${result.branch.code}`);
      return result;
    } catch {
      return { ok: false, error: "desktop_required" };
    }
  }, [logAudit]);

  const updateBranch = useCallback((id: string, patch: Partial<Branch>) => {
    setBranches((items) => items.map((item) => {
      if (item.id === id) {
        logAudit?.("branch_updated", patch.name || item.name, "تعديل بيانات فرع");
        return { ...item, ...patch, isMain: item.isMain };
      }
      return item;
    }));
  }, [logAudit]);

  const branchQuantity = useCallback((branchId: string, productId: string) => (
    branchStocks.find((row) => row.branchId === branchId && row.productId === productId)?.quantity ?? 0
  ), [branchStocks]);

  const transferStock = useCallback((input: Omit<StockTransfer, "id" | "transferNumber" | "createdAt" | "status">) => {
    if (transferInFlightRef.current) return null;
    if (input.fromBranchId === input.toBranchId || input.quantity <= 0) return null;
    const available = branchStocks.find((row) => row.branchId === input.fromBranchId && row.productId === input.productId)?.quantity ?? 0;
    if (available < input.quantity) return null;
    transferInFlightRef.current = true;
    const now = new Date().toISOString();
    const item: StockTransfer = {
      ...input,
      id: uid("transfer"),
      transferNumber: `TR-${String(stockTransfers.length + 1).padStart(5, "0")}`,
      status: "completed",
      createdAt: now,
    };
    setBranchStocks((rows) => {
      const map = new Map(rows.map((row) => [`${row.branchId}:${row.productId}`, { ...row }]));
      const fromKey = `${input.fromBranchId}:${input.productId}`;
      const toKey = `${input.toBranchId}:${input.productId}`;
      const from = map.get(fromKey)!;
      // Re-check against the freshest state (not the closure snapshot above)
      // and clamp to zero — a hard backstop even if the lock above is ever bypassed.
      from.quantity = Math.max(0, from.quantity - input.quantity);
      from.updatedAt = now;
      const to = map.get(toKey) ?? { branchId: input.toBranchId, productId: input.productId, quantity: 0, updatedAt: now };
      to.quantity += input.quantity;
      to.updatedAt = now;
      map.set(toKey, to);
      return [...map.values()];
    });
    setStockTransfers((items) => [item, ...items]);
    logAudit?.("stock_transfer_created", input.productName, `تحويل مخزون: ${input.quantity} وحدة`);
    return item;
  }, [branchStocks, stockTransfers.length, logAudit]);

  const consumeBranchStock = useCallback((branchId: string, lines: Array<{ productId: string; quantity: number }>) => {
    const soldByProduct = new Map<string, number>();
    for (const line of lines) soldByProduct.set(line.productId, (soldByProduct.get(line.productId) ?? 0) + line.quantity);
    const now = new Date().toISOString();
    setBranchStocks((rows) => rows.map((row) => row.branchId === branchId && soldByProduct.has(row.productId)
      ? { ...row, quantity: Math.max(0, row.quantity - soldByProduct.get(row.productId)!), updatedAt: now }
      : row));
  }, []);

  // Routes incoming purchase-invoice stock to the branch that actually
  // received it, instead of leaving it for reconcileBranchStocks' generic
  // diff-reconciliation to silently dump onto the main branch.
  const receivePurchaseStock = useCallback((branchId: string, lines: Array<{ productId: string; quantity: number }>) => {
    const receivedByProduct = new Map<string, number>();
    for (const line of lines) receivedByProduct.set(line.productId, (receivedByProduct.get(line.productId) ?? 0) + line.quantity);
    const now = new Date().toISOString();
    setBranchStocks((rows) => {
      const map = new Map(rows.map((row) => [`${row.branchId}:${row.productId}`, { ...row }]));
      for (const [productId, quantity] of receivedByProduct) {
        const key = `${branchId}:${productId}`;
        const existing = map.get(key) ?? { branchId, productId, quantity: 0, updatedAt: now };
        existing.quantity += quantity;
        existing.updatedAt = now;
        map.set(key, existing);
      }
      return [...map.values()];
    });
  }, []);

  const addPriceTier = useCallback((input: NewPriceTier) => {
    const item: PriceTier = { ...input, id: uid("tier"), createdAt: new Date().toISOString() };
    setPriceTiers((items) => [...items, item]);
    return item;
  }, []);

  const updatePriceTier = useCallback((id: string, patch: Partial<PriceTier>) => {
    setPriceTiers((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item));
  }, []);

  const deletePriceTier = useCallback((id: string) => {
    const target = priceTiers.find((item) => item.id === id);
    if (!target) return false;
    if (priceTiers.length <= 1) return false;
    setPriceTiers((items) => {
      const nextItems = items.filter((item) => item.id !== id);
      if (target.isDefault && nextItems.length > 0) {
        nextItems[0] = { ...nextItems[0], isDefault: true };
      }
      return nextItems;
    });
    return true;
  }, [priceTiers]);

  const value = useMemo<AutoPartsProContextValue>(() => ({
    customerVehicles, warrantyClaims, branches, branchStocks, stockTransfers, priceTiers,
    addCustomerVehicle, updateCustomerVehicle, archiveCustomerVehicle,
    addWarrantyClaim, updateWarrantyClaim, addBranch, updateBranch, transferStock,
    branchQuantity, consumeBranchStock, receivePurchaseStock, addPriceTier, updatePriceTier, deletePriceTier, reloadProData,
  }), [customerVehicles, warrantyClaims, branches, branchStocks, stockTransfers, priceTiers, addCustomerVehicle, updateCustomerVehicle, archiveCustomerVehicle, addWarrantyClaim, updateWarrantyClaim, addBranch, updateBranch, transferStock, branchQuantity, consumeBranchStock, receivePurchaseStock, addPriceTier, updatePriceTier, deletePriceTier, reloadProData]);

  return <AutoPartsProContext.Provider value={value}>{children}</AutoPartsProContext.Provider>;
}

export function useAutoPartsPro(): AutoPartsProContextValue {
  const value = useContext(AutoPartsProContext);
  if (!value) throw new Error("useAutoPartsPro must be used within AutoPartsProProvider");
  return value;
}
