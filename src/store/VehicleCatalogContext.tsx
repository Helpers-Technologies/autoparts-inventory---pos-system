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
  Product,
  ProductAlternative,
  ProductFitment,
  VehicleCatalogPreferences,
  VehicleEngine,
  VehicleGeneration,
  VehicleMake,
  VehicleModel,
} from "../types";
import {
  inferVehicleCountryCode,
  isMakeIncludedInSpecialization,
} from "../data/vehicleCountries";
import {
  seedVehicleGenerations,
  seedVehicleMakes,
  seedVehicleModels,
  vehicleCatalogSchemaVersion,
} from "../data/vehicleCatalogSeed";
import { buildStarterProductFitments } from "../data/autoPartsStarterCatalog";
import { lsGet, lsSetBatch } from "../lib/storage";
import { uid } from "../lib/utils";
import { useAuth } from "./AuthContext";
import { useCatalog } from "./CatalogContext";

type NewMake = Omit<VehicleMake, "id" | "slug" | "source" | "createdAt"> & {
  slug?: string;
};
type NewModel = Omit<VehicleModel, "id" | "source" | "createdAt">;
type NewGeneration = Omit<VehicleGeneration, "id" | "createdAt">;
type NewEngine = Omit<VehicleEngine, "id" | "createdAt">;
type NewFitment = Omit<ProductFitment, "id" | "createdAt">;
type NewAlternative = Omit<ProductAlternative, "id" | "createdAt">;

function sameStarterFitmentInputs(previous: readonly Product[], next: readonly Product[]): boolean {
  if (previous.length !== next.length) return false;
  for (let index = 0; index < next.length; index += 1) {
    const before = previous[index];
    const after = next[index];
    if (before === after) continue;
    if (
      before.id !== after.id || before.code !== after.code || before.name !== after.name ||
      before.partBrand !== after.partBrand || before.manufacturer !== after.manufacturer ||
      Boolean(before.archived) !== Boolean(after.archived)
    ) return false;
  }
  return true;
}

export interface VehicleCatalogContextValue {
  vehicleMakes: VehicleMake[];
  specializedVehicleMakes: VehicleMake[];
  vehicleCatalogPreferences: VehicleCatalogPreferences;
  vehicleModels: VehicleModel[];
  vehicleGenerations: VehicleGeneration[];
  vehicleEngines: VehicleEngine[];
  productFitments: ProductFitment[];
  productAlternatives: ProductAlternative[];
  addVehicleMake: (input: NewMake) => VehicleMake;
  updateVehicleMake: (id: string, patch: Partial<VehicleMake>) => void;
  deleteVehicleMake: (id: string) => void;
  addVehicleModel: (input: NewModel) => VehicleModel;
  updateVehicleModel: (id: string, patch: Partial<VehicleModel>) => void;
  deleteVehicleModel: (id: string) => void;
  addVehicleGeneration: (input: NewGeneration) => VehicleGeneration;
  updateVehicleGeneration: (id: string, patch: Partial<VehicleGeneration>) => void;
  deleteVehicleGeneration: (id: string) => void;
  addVehicleEngine: (input: NewEngine) => VehicleEngine;
  updateVehicleEngine: (id: string, patch: Partial<VehicleEngine>) => void;
  deleteVehicleEngine: (id: string) => void;
  addProductFitment: (input: NewFitment) => ProductFitment;
  addBulkProductFitments: (
    productIds: string[],
    fitmentSpec: Omit<ProductFitment, "id" | "productId" | "createdAt">
  ) => void;
  deleteProductFitment: (id: string) => void;
  addProductAlternative: (input: NewAlternative) => ProductAlternative;
  deleteProductAlternative: (id: string) => void;
  updateVehicleCatalogPreferences: (patch: Partial<VehicleCatalogPreferences>) => void;
  isVehicleMakeVisible: (makeId: string) => boolean;
  reloadVehicleCatalog: () => void;
}

const VehicleCatalogContext = createContext<VehicleCatalogContextValue | null>(null);

function mergeSeedRecords<T extends { id: string }>(stored: T[], seed: T[]): T[] {
  const storedIds = new Set(stored.map((item) => item.id));
  return [...stored, ...seed.filter((item) => !storedIds.has(item.id))];
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function now() {
  return new Date().toISOString();
}

const DEFAULT_VEHICLE_CATALOG_PREFERENCES: VehicleCatalogPreferences = {
  includeAllMakes: true,
  selectedCountryCodes: [],
  selectedMakeIds: [],
};

function normalizePreferences(value?: Partial<VehicleCatalogPreferences>): VehicleCatalogPreferences {
  return {
    includeAllMakes: value?.includeAllMakes !== false,
    selectedCountryCodes: [...new Set(value?.selectedCountryCodes ?? [])],
    selectedMakeIds: [...new Set(value?.selectedMakeIds ?? [])],
    updatedAt: value?.updatedAt,
  };
}

/**
 * Brand logos ship as "/vehicle-logos/<slug>.png" — an ABSOLUTE path, which
 * the desktop build cannot resolve. The packaged app is loaded over file://,
 * where a leading slash means the root of the drive, not the app folder, so
 * every one of the 352 logos failed with ERR_FILE_NOT_FOUND and each screen
 * that lists makes fell back to a generic car icon.
 *
 * Rewritten on the way in rather than at each <img>, because the bad value is
 * in the DATA: it is baked into the seeded catalogue and already persisted in
 * every existing shop, so fixing the call sites alone would leave installed
 * customers looking at the same blank icons.
 */
export function normaliseLogoPath(make: VehicleMake): VehicleMake {
  const logoPath = make.logoPath;
  if (!logoPath || !logoPath.startsWith("/")) return make;
  return { ...make, logoPath: `.${logoPath}` };
}

function enrichMakeCountry(make: VehicleMake): VehicleMake {
  const countryCode = inferVehicleCountryCode(make);
  const withCountry =
    countryCode && make.countryCode !== countryCode ? { ...make, countryCode } : make;
  return normaliseLogoPath(withCountry);
}

export function VehicleCatalogProvider({ children }: { children: ReactNode }) {
  const { auth, isDesktop } = useAuth();
  const { products } = useCatalog();
  const authenticatedIdentity = auth.isAuthenticated
    ? auth.userId ?? auth.username ?? "authenticated"
    : null;
  const [hydratedIdentity, setHydratedIdentity] = useState<string | null>(
    isDesktop ? null : "web",
  );
  const skipHydrationPersistenceRef = useRef<string | null>(null);
  const loadMakes = useCallback(
    () => mergeSeedRecords(lsGet<VehicleMake[]>("vehicleMakes", []), seedVehicleMakes).map(enrichMakeCountry),
    [],
  );
  const loadModels = useCallback(
    () => mergeSeedRecords(lsGet<VehicleModel[]>("vehicleModels", []), seedVehicleModels),
    [],
  );
  const loadGenerations = useCallback(
    () => mergeSeedRecords(lsGet<VehicleGeneration[]>("vehicleGenerations", []), seedVehicleGenerations),
    [],
  );
  const [vehicleMakes, setVehicleMakes] = useState<VehicleMake[]>(loadMakes);
  const [vehicleCatalogPreferences, setVehicleCatalogPreferences] =
    useState<VehicleCatalogPreferences>(() =>
      normalizePreferences(lsGet("vehicleCatalogPreferences", DEFAULT_VEHICLE_CATALOG_PREFERENCES)),
    );
  const [vehicleModels, setVehicleModels] = useState<VehicleModel[]>(loadModels);
  const [vehicleGenerations, setVehicleGenerations] = useState<VehicleGeneration[]>(loadGenerations);
  const [vehicleEngines, setVehicleEngines] = useState<VehicleEngine[]>(() =>
    lsGet("vehicleEngines", []),
  );
  const [productFitments, setProductFitments] = useState<ProductFitment[]>(() =>
    buildStarterProductFitments(
      products,
      vehicleMakes,
      vehicleModels,
      lsGet("productFitments", []),
    ),
  );
  const [productAlternatives, setProductAlternatives] = useState<ProductAlternative[]>(() =>
    lsGet("productAlternatives", []),
  );
  const productsRef = useRef(products);
  const fitmentInputsRef = useRef({ products, vehicleMakes, vehicleModels });

  useEffect(() => {
    productsRef.current = products;
  }, [products]);

  const reloadVehicleCatalog = useCallback(() => {
    const currentProducts = productsRef.current;
    setVehicleMakes(loadMakes());
    setVehicleCatalogPreferences(
      normalizePreferences(lsGet("vehicleCatalogPreferences", DEFAULT_VEHICLE_CATALOG_PREFERENCES)),
    );
    setVehicleModels(loadModels());
    setVehicleGenerations(loadGenerations());
    setVehicleEngines(lsGet("vehicleEngines", []));
    setProductFitments(
      buildStarterProductFitments(
        currentProducts,
        loadMakes(),
        loadModels(),
        lsGet("productFitments", []),
      ),
    );
    setProductAlternatives(lsGet("productAlternatives", []));
  }, [loadMakes, loadModels, loadGenerations]);

  useEffect(() => {
    const previous = fitmentInputsRef.current;
    if (
      previous.vehicleMakes === vehicleMakes &&
      previous.vehicleModels === vehicleModels &&
      sameStarterFitmentInputs(previous.products, products)
    ) {
      fitmentInputsRef.current = { products, vehicleMakes, vehicleModels };
      return;
    }
    fitmentInputsRef.current = { products, vehicleMakes, vehicleModels };
    setProductFitments((current) =>
      buildStarterProductFitments(products, vehicleMakes, vehicleModels, current),
    );
  }, [products, vehicleMakes, vehicleModels]);

  useEffect(() => {
    window.addEventListener("autoparts:vehicle-catalog-restored", reloadVehicleCatalog);
    return () =>
      window.removeEventListener("autoparts:vehicle-catalog-restored", reloadVehicleCatalog);
  }, [reloadVehicleCatalog]);

  useEffect(() => {
    if (!authenticatedIdentity) {
      setHydratedIdentity(isDesktop ? null : "web");
      return;
    }
    skipHydrationPersistenceRef.current = authenticatedIdentity;
    reloadVehicleCatalog();
    // React batches this with the collection state updates above. Persistence
    // is enabled only on the following committed render, so the pre-login
    // fallback arrays can never win a race against authoritative storage.
    setHydratedIdentity(authenticatedIdentity);
  }, [authenticatedIdentity, isDesktop, reloadVehicleCatalog]);

  useEffect(() => {
    if (isDesktop && hydratedIdentity !== authenticatedIdentity) return;
    if (isDesktop && skipHydrationPersistenceRef.current === authenticatedIdentity) {
      skipHydrationPersistenceRef.current = null;
      return;
    }
    const timer = window.setTimeout(() => {
      lsSetBatch({
        vehicleCatalogSchemaVersion,
        vehicleMakes,
        vehicleCatalogPreferences,
        vehicleModels,
        vehicleGenerations,
        vehicleEngines,
        productFitments,
        productAlternatives,
      });
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [
    auth.isAuthenticated,
    authenticatedIdentity,
    hydratedIdentity,
    isDesktop,
    vehicleMakes,
    vehicleCatalogPreferences,
    vehicleModels,
    vehicleGenerations,
    vehicleEngines,
    productFitments,
    productAlternatives,
  ]);

  const addVehicleMake = useCallback((input: NewMake) => {
    const slug = input.slug?.trim() || slugify(input.name) || uid("make");
    const item: VehicleMake = {
      ...input,
      id: uid("make"),
      slug,
      source: "user",
      createdAt: now(),
    };
    setVehicleMakes((items) => [...items, item]);
    return item;
  }, []);

  const updateVehicleMake = useCallback((id: string, patch: Partial<VehicleMake>) => {
    setVehicleMakes((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  // Deleting a make/model/generation/engine cascades to whatever hangs off it
  // (models/generations/engines/fitments) so the catalog never keeps rows
  // pointing at an id that no longer exists.
  const deleteVehicleMake = useCallback((id: string) => {
    setVehicleModels((models) => {
      const modelIdsUnderMake = new Set(models.filter((m) => m.makeId === id).map((m) => m.id));
      setVehicleGenerations((generations) => {
        const generationIdsUnderMake = new Set(
          generations.filter((g) => modelIdsUnderMake.has(g.modelId)).map((g) => g.id),
        );
        setVehicleEngines((engines) =>
          engines.filter((e) => !generationIdsUnderMake.has(e.generationId)),
        );
        return generations.filter((g) => !modelIdsUnderMake.has(g.modelId));
      });
      setProductFitments((fitments) => fitments.filter((f) => f.makeId !== id));
      return models.filter((m) => m.makeId !== id);
    });
    setVehicleMakes((items) => items.filter((item) => item.id !== id));
  }, []);

  const addVehicleModel = useCallback((input: NewModel) => {
    const item: VehicleModel = { ...input, id: uid("model"), source: "user", createdAt: now() };
    setVehicleModels((items) => [...items, item]);
    return item;
  }, []);

  const updateVehicleModel = useCallback((id: string, patch: Partial<VehicleModel>) => {
    setVehicleModels((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const deleteVehicleModel = useCallback((id: string) => {
    setVehicleGenerations((generations) => {
      const generationIdsUnderModel = new Set(
        generations.filter((g) => g.modelId === id).map((g) => g.id),
      );
      setVehicleEngines((engines) =>
        engines.filter((e) => !generationIdsUnderModel.has(e.generationId)),
      );
      return generations.filter((g) => g.modelId !== id);
    });
    setProductFitments((fitments) => fitments.filter((f) => f.modelId !== id));
    setVehicleModels((items) => items.filter((item) => item.id !== id));
  }, []);

  const addVehicleGeneration = useCallback((input: NewGeneration) => {
    const item: VehicleGeneration = { ...input, id: uid("generation"), createdAt: now() };
    setVehicleGenerations((items) => [...items, item]);
    return item;
  }, []);

  const updateVehicleGeneration = useCallback(
    (id: string, patch: Partial<VehicleGeneration>) => {
      setVehicleGenerations((items) =>
        items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
      );
    },
    [],
  );

  const deleteVehicleGeneration = useCallback((id: string) => {
    setVehicleEngines((engines) => engines.filter((e) => e.generationId !== id));
    setProductFitments((fitments) => fitments.filter((f) => f.generationId !== id));
    setVehicleGenerations((items) => items.filter((item) => item.id !== id));
  }, []);

  const addVehicleEngine = useCallback((input: NewEngine) => {
    const item: VehicleEngine = { ...input, id: uid("engine"), createdAt: now() };
    setVehicleEngines((items) => [...items, item]);
    return item;
  }, []);

  const updateVehicleEngine = useCallback((id: string, patch: Partial<VehicleEngine>) => {
    setVehicleEngines((items) =>
      items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }, []);

  const deleteVehicleEngine = useCallback((id: string) => {
    setProductFitments((fitments) => fitments.filter((f) => f.engineId !== id));
    setVehicleEngines((items) => items.filter((item) => item.id !== id));
  }, []);

  const addProductFitment = useCallback((input: NewFitment) => {
    const item: ProductFitment = { ...input, id: uid("fitment"), createdAt: now() };
    setProductFitments((items) => [...items, item]);
    return item;
  }, []);

  const addBulkProductFitments = useCallback(
    (
      productIds: string[],
      fitmentSpec: Omit<ProductFitment, "id" | "productId" | "createdAt">
    ) => {
      const createdAt = now();
      const newItems: ProductFitment[] = productIds.map((pid) => ({
        ...fitmentSpec,
        id: uid("fitment"),
        productId: pid,
        createdAt,
      }));
      setProductFitments((items) => {
        const existingKeys = new Set(
          items.map(
            (f) =>
              `${f.productId}:${f.makeId}:${f.modelId ?? ""}:${f.generationId ?? ""}:${f.engineId ?? ""}:${f.yearFrom ?? ""}:${f.yearTo ?? ""}`
          )
        );
        const filteredNew = newItems.filter(
          (f) =>
            !existingKeys.has(
              `${f.productId}:${f.makeId}:${f.modelId ?? ""}:${f.generationId ?? ""}:${f.engineId ?? ""}:${f.yearFrom ?? ""}:${f.yearTo ?? ""}`
            )
        );
        return [...items, ...filteredNew];
      });
    },
    []
  );

  const deleteProductFitment = useCallback((id: string) => {
    setProductFitments((items) => items.filter((item) => item.id !== id));
  }, []);

  const addProductAlternative = useCallback((input: NewAlternative) => {
    const item: ProductAlternative = { ...input, id: uid("alternative"), createdAt: now() };
    setProductAlternatives((items) => [...items, item]);
    return item;
  }, []);

  const deleteProductAlternative = useCallback((id: string) => {
    setProductAlternatives((items) => items.filter((item) => item.id !== id));
  }, []);

  const updateVehicleCatalogPreferences = useCallback(
    (patch: Partial<VehicleCatalogPreferences>) => {
      setVehicleCatalogPreferences((current: VehicleCatalogPreferences) =>
        normalizePreferences({ ...current, ...patch, updatedAt: now() }),
      );
    },
    [],
  );

  const visibleMakeIds = useMemo(() => {
    return new Set(
      vehicleMakes
        .filter((make) => isMakeIncludedInSpecialization(make, vehicleCatalogPreferences))
        .map((make) => make.id),
    );
  }, [vehicleCatalogPreferences, vehicleMakes]);

  const specializedVehicleMakes = useMemo(
    () => vehicleMakes.filter((make) => visibleMakeIds.has(make.id)),
    [vehicleMakes, visibleMakeIds],
  );

  const isVehicleMakeVisible = useCallback(
    (makeId: string) => visibleMakeIds.has(makeId),
    [visibleMakeIds],
  );

  const value = useMemo<VehicleCatalogContextValue>(
    () => ({
      vehicleMakes,
      specializedVehicleMakes,
      vehicleCatalogPreferences,
      vehicleModels,
      vehicleGenerations,
      vehicleEngines,
      productFitments,
      productAlternatives,
      addVehicleMake,
      updateVehicleMake,
      deleteVehicleMake,
      addVehicleModel,
      updateVehicleModel,
      deleteVehicleModel,
      addVehicleGeneration,
      updateVehicleGeneration,
      deleteVehicleGeneration,
      addVehicleEngine,
      updateVehicleEngine,
      deleteVehicleEngine,
      addProductFitment,
      addBulkProductFitments,
      deleteProductFitment,
      addProductAlternative,
      deleteProductAlternative,
      updateVehicleCatalogPreferences,
      isVehicleMakeVisible,
      reloadVehicleCatalog,
    }),
    [
      vehicleMakes,
      specializedVehicleMakes,
      vehicleCatalogPreferences,
      vehicleModels,
      vehicleGenerations,
      vehicleEngines,
      productFitments,
      productAlternatives,
      addVehicleMake,
      updateVehicleMake,
      deleteVehicleMake,
      addVehicleModel,
      updateVehicleModel,
      deleteVehicleModel,
      addVehicleGeneration,
      updateVehicleGeneration,
      deleteVehicleGeneration,
      addVehicleEngine,
      updateVehicleEngine,
      deleteVehicleEngine,
      addProductFitment,
      addBulkProductFitments,
      deleteProductFitment,
      addProductAlternative,
      deleteProductAlternative,
      updateVehicleCatalogPreferences,
      isVehicleMakeVisible,
      reloadVehicleCatalog,
    ],
  );

  return <VehicleCatalogContext.Provider value={value}>{children}</VehicleCatalogContext.Provider>;
}

export function useVehicleCatalog(): VehicleCatalogContextValue {
  const context = useContext(VehicleCatalogContext);
  if (!context) throw new Error("useVehicleCatalog must be used within VehicleCatalogProvider");
  return context;
}
