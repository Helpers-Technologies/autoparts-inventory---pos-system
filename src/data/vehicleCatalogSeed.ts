import generatedCatalog from "./vehicle-catalog.generated.json";
import generationsSeed from "./vehicle-generations-seed.json";
import type { VehicleGeneration, VehicleMake, VehicleModel } from "../types";

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
// Hand-curated generations (name + production years + body types) for the
// models most common in Egypt's car parc. See src/data/vehicle-generations-seed.json.
export const seedVehicleGenerations: VehicleGeneration[] = generationsSeed as VehicleGeneration[];
