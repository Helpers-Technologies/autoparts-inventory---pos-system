import generatedCatalog from "./vehicle-catalog.generated.json";
import type { VehicleMake, VehicleModel } from "../types";

type GeneratedCatalog = {
  schemaVersion: number;
  generatedAt: string;
  makes: VehicleMake[];
  models: VehicleModel[];
};

const catalog = generatedCatalog as GeneratedCatalog;

export const vehicleCatalogSchemaVersion = catalog.schemaVersion;
export const vehicleCatalogGeneratedAt = catalog.generatedAt;
export const seedVehicleMakes: VehicleMake[] = catalog.makes;
export const seedVehicleModels: VehicleModel[] = catalog.models;
