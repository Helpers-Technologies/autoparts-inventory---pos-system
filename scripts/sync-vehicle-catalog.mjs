#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(SCRIPT_DIR, "..");
const LOGO_DIR = join(ROOT_DIR, "public", "vehicle-logos");
const OUTPUT_FILE = join(ROOT_DIR, "src", "data", "vehicle-catalog.generated.json");
const MODEL_CACHE_FILE = join(ROOT_DIR, ".cache", "vehicle-models.json");
const LOGO_DATA_URL =
  "https://raw.githubusercontent.com/filippofilip95/car-logos-dataset/master/logos/data.json";
const LOCAL_LOGO_DATA_URL =
  "https://raw.githubusercontent.com/filippofilip95/car-logos-dataset/master/local-logos/metadata.json";
const VPIC_URL = "https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMake";

// vPIC is authoritative but focused on vehicles sold/imported in the U.S.
// These additions cover common Egypt/MENA nameplates that are legitimately
// absent from (or sparse in) the U.S. catalog. They are merged, never used to
// overwrite an official model record.
const REGIONAL_MODELS = {
  Toyota: ["Corolla", "Yaris", "Belta", "Camry", "Avanza", "Rush", "Fortuner", "Hilux", "Land Cruiser", "Prado", "RAV4", "C-HR"],
  Nissan: ["Sunny", "Sentra", "Tiida", "Qashqai", "Juke", "X-Trail", "Patrol", "Pathfinder", "Navara", "Micra"],
  Hyundai: ["Verna", "Accent", "Elantra", "Avante", "Tucson", "Santa Fe", "Creta", "Matrix", "Getz", "i10", "i20", "i30"],
  Kia: ["Pride", "Sephia", "Shuma", "Rio", "Picanto", "Cerato", "Carens", "Sportage", "Sorento", "Seltos", "Sonet", "Carnival"],
  Chevrolet: ["Lanos", "Aveo", "Optra", "Cruze", "Spark", "Captiva", "Malibu", "Equinox", "N300", "Move"],
  Renault: ["Logan", "Sandero", "Sandero Stepway", "Duster", "Megane", "Fluence", "Kadjar", "Austral", "Clio", "Symbol"],
  Peugeot: ["106", "206", "207", "208", "301", "307", "308", "405", "406", "407", "408", "508", "2008", "3008", "5008", "Partner"],
  Fiat: ["128", "Uno", "Palio", "Punto", "Siena", "Linea", "Tipo", "Doblo", "Fiorino", "500", "500X"],
  Volkswagen: ["Polo", "Golf", "Jetta", "Bora", "Passat", "Tiguan", "T-Roc", "Touareg", "Caddy", "Transporter"],
  "Škoda": ["Felicia", "Fabia", "Rapid", "Scala", "Octavia", "Superb", "Kamiq", "Karoq", "Kodiaq"],
  SEAT: ["Ibiza", "Cordoba", "Toledo", "Leon", "Arona", "Ateca", "Tarraco"],
  Opel: ["Corsa", "Astra", "Vectra", "Insignia", "Mokka", "Crossland", "Grandland", "Meriva", "Zafira"],
  Mitsubishi: ["Lancer", "Lancer Evolution", "Mirage", "Attrage", "Galant", "Pajero", "Eclipse Cross", "Outlander", "Xpander"],
  Suzuki: ["Maruti", "Alto", "Celerio", "Swift", "Dzire", "Baleno", "Ertiga", "Vitara", "S-Cross", "Jimny"],
  Honda: ["City", "Civic", "Accord", "Jazz", "HR-V", "CR-V", "Pilot"],
  Mazda: ["Mazda 2", "Mazda 3", "Mazda 6", "CX-3", "CX-5", "CX-9", "BT-50"],
  Subaru: ["Impreza", "Legacy", "Forester", "XV", "Outback", "BRZ"],
  Daihatsu: ["Mira", "Charade", "Sirion", "Terios", "Gran Max"],
  Isuzu: ["D-Max", "MU-X", "Trooper", "Pickup"],
  Jeep: ["Renegade", "Compass", "Cherokee", "Grand Cherokee", "Wrangler"],
  Ford: ["Fiesta", "Focus", "Fusion", "Mondeo", "EcoSport", "Kuga", "Everest", "Ranger"],
  "Mercedes-Benz": ["A-Class", "B-Class", "C-Class", "E-Class", "S-Class", "CLA", "CLS", "GLA", "GLC", "GLE", "GLS", "G-Class", "V-Class"],
  BMW: ["1 Series", "2 Series", "3 Series", "4 Series", "5 Series", "6 Series", "7 Series", "X1", "X2", "X3", "X4", "X5", "X6", "X7"],
  Audi: ["A1", "A3", "A4", "A5", "A6", "A7", "A8", "Q2", "Q3", "Q5", "Q7", "Q8"],
  "Citroën": ["C-Elysee", "C3", "C3 Aircross", "C4", "C4X", "C5 Aircross", "Berlingo", "Xsara"],
  Chery: ["QQ", "A11", "A15", "Envy", "Arrizo 5", "Arrizo 6", "Arrizo 8", "Tiggo 2", "Tiggo 3", "Tiggo 4 Pro", "Tiggo 7", "Tiggo 7 Pro", "Tiggo 8", "Tiggo 8 Pro Max"],
  BYD: ["F0", "F3", "F3R", "L3", "S5", "F7", "Qin Plus", "Song Plus", "Yuan Plus", "Atto 3", "Dolphin", "Seal", "Han"],
  Geely: ["Panda", "Emgrand", "Emgrand 7", "Emgrand X7", "GX3 Pro", "Coolray", "Okavango", "Starray", "Geometry C"],
  MG: ["MG 3", "MG 4", "MG 5", "MG 6", "MG 7", "MG GT", "MG ZS", "MG HS", "MG RX5", "MG RX8", "MG One", "Marvel R"],
  Haval: ["Jolion", "H2", "H6", "Dargo", "H9"],
  "Great Wall": ["Wingle 5", "Wingle 7", "Poer", "C30", "C50"],
  JAC: ["J3", "J4", "J7", "JS2", "JS3", "JS4", "JS6", "S2", "S3", "S4"],
  Jetour: ["X70", "X70 Plus", "X90 Plus", "Dashing", "T1", "T2"],
  Omoda: ["C5", "C7", "E5"],
  Exeed: ["LX", "TXL", "RX", "VX"],
  "BAIC Motor": ["X35", "X55", "X7", "U5 Plus"],
  Dongfeng: ["Aeolus A30", "Aeolus Mage", "Aeolus Huge", "Shine", "Shine Max"],
  Lada: ["2105", "2107", "Samara", "Granta", "Vesta", "Niva"],
  Daewoo: ["Lanos", "Nubira", "Leganza", "Matiz", "Espero"],
  Proton: ["Saga", "Gen-2", "Persona", "Preve", "X50", "X70"],
  SsangYong: ["Tivoli", "Korando", "Rexton", "Musso", "Torres", "XLV"],
  "Land Rover": ["Defender", "Discovery", "Discovery Sport", "Range Rover", "Range Rover Sport", "Range Rover Evoque", "Range Rover Velar"],
  Volvo: ["S40", "S60", "S80", "S90", "V40", "V60", "XC40", "XC60", "XC90"],
  Lexus: ["IS", "ES", "LS", "UX", "NX", "RX", "GX", "LX"],
  // Chinese/regional makes already present from car-logos-dataset but with
  // zero or near-zero vPIC coverage (not sold in the U.S.) despite being
  // common on Egyptian/MENA roads.
  "GAC Group": ["GA3", "GA4", "GA6", "GA8", "GS3", "GS4", "GS8", "Empow", "Aion S", "Aion Y"],
  Changan: ["Alsvin", "Eado", "CS35", "CS35 Plus", "CS55", "CS55 Plus", "CS75", "CS75 Plus", "CS85", "CS95", "UNI-T", "UNI-K", "Hunter"],
  Brilliance: ["H220", "H230", "H320", "H330", "H530", "V3", "V5", "V6", "V7"],
  Foton: ["Tunland", "View C2", "Sauvana", "Aumark", "Ollin"],
  Landwind: ["X2", "X5", "X6", "X7", "X8", "CV9"],
  Haima: ["3", "7", "S5", "S7", "M3", "Family"],
  Soueast: ["DX3", "DX5", "DX7", "DX8", "V3 Lingyue"],
  Hawtai: ["Santa Fe", "B11", "Boliger", "Xiongshi", "EV"],
  Gonow: ["GA200", "GA202", "Way", "Aoosed", "Riich"],
  Saipa: ["Pride", "Tiba", "Quick", "Saina", "Shahin", "Aria"],
  IKCO: ["Samand", "Peugeot Pars", "Dena", "Runna", "Soren", "Tara"],
  JMC: ["Vigus", "Yuhu", "N601", "N720", "Kaiyun", "Baodian"],
  Zotye: ["T600", "T700", "T800", "Z300", "Z500", "SR9", "Damai"],
  FAW: ["Besturn B30", "Besturn B50", "Besturn B70", "Besturn X40", "Besturn X80", "V2", "N5"],
  Lifan: ["320", "330", "520", "620", "720", "X50", "X60", "X70", "Solano", "Myway"],
  // Famous Chinese marques not yet present at all in the vPIC-derived catalog.
  Roewe: ["RX5", "RX8", "i5", "i6", "ei5"],
  Hongqi: ["H5", "H9", "HS5", "E-HS9"],
  Wuling: ["Hongguang", "Hongguang Mini EV", "Zhiguang"],
};

// This catalog is scoped to passenger cars only. car-logos-dataset also
// includes trucks, buses, and other heavy/commercial marques (and one
// motorcycle brand) that vPIC returns under the same "make" concept — strip
// them here so every resync stays in scope instead of re-adding them.
const NON_PASSENGER_MAKE_SLUGS = new Set([
  // Buses
  "golden-dragon", "king-long", "higer", "yutong", "zhongtong", "setra", "ic-bus", "irizar",
  // Heavy trucks
  "sinotruk", "shacman", "hongyan", "faw-jiefang", "man", "international", "ih", "navistar",
  "kenworth", "mack", "freightliner", "peterbilt", "paccar", "western-star", "hino", "ud",
  "pegaso", "scania", "bharatbenz", "eicher", "kamaz", "daf", "maz", "sisu", "erf", "foden",
  // Motorcycles
  "ktm",
]);

const args = new Set(process.argv.slice(2));
const skipModels = args.has("--skip-models");
const skipLogos = args.has("--skip-logos");

async function fetchWithRetry(url, options = {}, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25_000);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      if (!response.ok) {
        if ((response.status === 403 || response.status === 429) && attempt < attempts) {
          const retryAfter = Number(response.headers.get("retry-after"));
          const delayMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : attempt * 15_000;
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }
        throw new Error(`${response.status} ${response.statusText}`);
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 700));
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

async function fetchJson(url) {
  return (await fetchWithRetry(url)).json();
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function normalizeKey(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildMakeMetadata(main, local) {
  const merged = new Map();
  for (const item of main) {
    merged.set(item.slug, {
      name: item.name,
      slug: item.slug,
      sourceUrl: item.image?.source,
      logoUrl: item.image?.thumb,
    });
  }
  for (const item of local) {
    if (merged.has(item.slug)) continue;
    merged.set(item.slug, {
      name: item.name,
      slug: item.slug,
      sourceUrl: `https://github.com/filippofilip95/car-logos-dataset/blob/master/local-logos/${item.fileName}`,
      logoUrl: `https://raw.githubusercontent.com/filippofilip95/car-logos-dataset/master/local-logos/${item.fileName}`,
    });
  }
  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name, "en"));
}

async function downloadLogos(makes) {
  await mkdir(LOGO_DIR, { recursive: true });
  let completed = 0;
  await mapLimit(makes, 14, async (make) => {
    if (!make.logoUrl) return;
    const response = await fetchWithRetry(make.logoUrl);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const fileName = `${make.slug}.png`;
    await writeFile(join(LOGO_DIR, fileName), bytes);
    make.logoPath = `/vehicle-logos/${fileName}`;
    completed += 1;
    if (completed % 25 === 0 || completed === makes.length) {
      process.stdout.write(`\rDownloaded logos: ${completed}/${makes.length}`);
    }
  });
  process.stdout.write("\n");
}

async function loadModels(make) {
  if (skipModels) return [];
  const url = `${VPIC_URL}/${encodeURIComponent(make.name)}?format=json`;
  try {
    const data = await fetchJson(url);
    const unique = new Map();
    for (const row of data.Results ?? []) {
      // GetModelsForMake performs a LIKE search. Without an exact Make_Name
      // guard, short brands such as "AC" incorrectly absorb Acura and dozens
      // of unrelated makes into their model list.
      if (normalizeKey(row.Make_Name) !== normalizeKey(make.name)) continue;
      const name = String(row.Model_Name ?? "").trim();
      if (!name) continue;
      const key = normalizeKey(name);
      if (!unique.has(key)) {
        unique.set(key, {
          id: `model_${make.slug}_${key}`,
          makeId: `make_${make.slug}`,
          name,
          sourceId: typeof row.Model_ID === "number" ? row.Model_ID : undefined,
          active: true,
          source: "nhtsa-vpic",
        });
      }
    }
    return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name, "en"));
  } catch (error) {
    console.warn(`\nModels skipped for ${make.name}: ${error?.message ?? error}`);
    return [];
  }
}

async function readModelCache() {
  try {
    return JSON.parse(await readFile(MODEL_CACHE_FILE, "utf8"));
  } catch {
    return {};
  }
}

async function main() {
  await mkdir(dirname(OUTPUT_FILE), { recursive: true });
  const [mainLogoData, localLogoData] = await Promise.all([
    fetchJson(LOGO_DATA_URL),
    fetchJson(LOCAL_LOGO_DATA_URL),
  ]);
  const makesMetadata = buildMakeMetadata(mainLogoData, localLogoData).filter(
    (make) => !NON_PASSENGER_MAKE_SLUGS.has(make.slug),
  );

  if (!skipLogos) await downloadLogos(makesMetadata);

  const modelCache = await readModelCache();
  await mkdir(dirname(MODEL_CACHE_FILE), { recursive: true });
  let completed = 0;
  const modelsByMake = await mapLimit(makesMetadata, skipModels ? 10 : 1, async (make) => {
    const cached = Object.prototype.hasOwnProperty.call(modelCache, make.slug);
    const models = skipModels ? [] : cached ? modelCache[make.slug] : await loadModels(make);
    if (!skipModels && !cached) {
      modelCache[make.slug] = models;
      await writeFile(MODEL_CACHE_FILE, `${JSON.stringify(modelCache, null, 2)}\n`, "utf8");
      await new Promise((resolve) => setTimeout(resolve, 900));
    }
    completed += 1;
    if (!skipModels && (completed % 20 === 0 || completed === makesMetadata.length)) {
      process.stdout.write(`\rLoaded models: ${completed}/${makesMetadata.length}`);
    }
    return models;
  });
  if (!skipModels) process.stdout.write("\n");

  for (const [makeName, regionalModels] of Object.entries(REGIONAL_MODELS)) {
    const makeIndex = makesMetadata.findIndex((make) => make.name === makeName);
    if (makeIndex < 0) continue;
    const make = makesMetadata[makeIndex];
    const existing = new Set(modelsByMake[makeIndex].map((model) => normalizeKey(model.name)));
    for (const name of regionalModels) {
      const key = normalizeKey(name);
      if (existing.has(key)) continue;
      modelsByMake[makeIndex].push({
        id: `model_${make.slug}_${key}`,
        makeId: `make_${make.slug}`,
        name,
        vehicleType: "Passenger Car",
        active: true,
        source: "regional-seed",
      });
      existing.add(key);
    }
    modelsByMake[makeIndex].sort((a, b) => a.name.localeCompare(b.name, "en"));
  }

  const makes = makesMetadata.map((make, index) => ({
    id: `make_${make.slug}`,
    name: make.name,
    slug: make.slug,
    logoPath: make.logoPath ?? `/vehicle-logos/${make.slug}.png`,
    priority: index,
    active: true,
    source: "car-logos-dataset",
    sourceUrl: make.sourceUrl,
  }));
  const models = modelsByMake.flat();
  const payload = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sources: {
      makesAndLogos: "https://github.com/filippofilip95/car-logos-dataset",
      models: "https://vpic.nhtsa.dot.gov/api/",
    },
    makes,
    models,
  };
  await writeFile(OUTPUT_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  console.log(
    `Vehicle catalog ready: ${makes.length} makes, ${models.length} models -> ${basename(OUTPUT_FILE)}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
