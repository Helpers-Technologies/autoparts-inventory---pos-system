import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type {
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
  addVehicleModel: (input: NewModel) => VehicleModel;
  updateVehicleModel: (id: string, patch: Partial<VehicleModel>) => void;
  addVehicleGeneration: (input: NewGeneration) => VehicleGeneration;
  updateVehicleGeneration: (id: string, patch: Partial<VehicleGeneration>) => void;
  addVehicleEngine: (input: NewEngine) => VehicleEngine;
  updateVehicleEngine: (id: string, patch: Partial<VehicleEngine>) => void;
  addProductFitment: (input: NewFitment) => ProductFitment;
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

function enrichMakeCountry(make: VehicleMake): VehicleMake {
  const countryCode = inferVehicleCountryCode(make);
  return countryCode && make.countryCode !== countryCode ? { ...make, countryCode } : make;
}

export function VehicleCatalogProvider({ children }: { children: ReactNode }) {
  const { auth, isDesktop } = useAuth();
  const { products } = useCatalog();
  const loadMakes = useCallback(
    () => mergeSeedRecords(lsGet<VehicleMake[]>("vehicleMakes", []), seedVehicleMakes).map(enrichMakeCountry),
    [],
  );
  const loadModels = useCallback(
    () => mergeSeedRecords(lsGet<VehicleModel[]>("vehicleModels", []), seedVehicleModels),
    [],
  );
  const [vehicleMakes, setVehicleMakes] = useState<VehicleMake[]>(loadMakes);
  const [vehicleCatalogPreferences, setVehicleCatalogPreferences] =
    useState<VehicleCatalogPreferences>(() =>
      normalizePreferences(lsGet("vehicleCatalogPreferences", DEFAULT_VEHICLE_CATALOG_PREFERENCES)),
    );
  const [vehicleModels, setVehicleModels] = useState<VehicleModel[]>(loadModels);
  const [vehicleGenerations, setVehicleGenerations] = useState<VehicleGeneration[]>(() =>
    lsGet("vehicleGenerations", []),
  );
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

  const reloadVehicleCatalog = useCallback(() => {
    setVehicleMakes(loadMakes());
    setVehicleCatalogPreferences(
      normalizePreferences(lsGet("vehicleCatalogPreferences", DEFAULT_VEHICLE_CATALOG_PREFERENCES)),
    );
    setVehicleModels(loadModels());
    setVehicleGenerations(lsGet("vehicleGenerations", []));
    setVehicleEngines(lsGet("vehicleEngines", []));
    setProductFitments(
      buildStarterProductFitments(
        products,
        loadMakes(),
        loadModels(),
        lsGet("productFitments", []),
      ),
    );
    setProductAlternatives(lsGet("productAlternatives", []));
  }, [loadMakes, loadModels, products]);

  useEffect(() => {
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
    if (isDesktop && !auth.isAuthenticated) return;
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

  const addVehicleModel = useCallback((input: NewModel) => {
    const item: VehicleModel = { ...input, id: uid("model"), source: "user", createdAt: now() };
    setVehicleModels((items) => [...items, item]);
    return item;
  }, []);

  const updateVehicleModel = useCallback((id: string, patch: Partial<VehicleModel>) => {
    setVehicleModels((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
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

  const addProductFitment = useCallback((input: NewFitment) => {
    const item: ProductFitment = { ...input, id: uid("fitment"), createdAt: now() };
    setProductFitments((items) => [...items, item]);
    return item;
  }, []);

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
      setVehicleCatalogPreferences((current) =>
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
      addVehicleModel,
      updateVehicleModel,
      addVehicleGeneration,
      updateVehicleGeneration,
      addVehicleEngine,
      updateVehicleEngine,
      addProductFitment,
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
      addVehicleModel,
      updateVehicleModel,
      addVehicleGeneration,
      updateVehicleGeneration,
      addVehicleEngine,
      updateVehicleEngine,
      addProductFitment,
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
