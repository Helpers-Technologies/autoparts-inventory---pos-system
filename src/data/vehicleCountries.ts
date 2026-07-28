import type { VehicleCatalogPreferences, VehicleMake } from "../types";

export type VehicleCountry = {
  code: string;
  nameAr: string;
  nameEn: string;
  flag: string;
};

/**
 * Automotive market classification used by Egyptian spare-parts shops.
 * It describes the commercial origin of the marque, not the assembly plant of
 * an individual VIN. For example MG is classified with the Chinese market
 * because modern MG vehicles and parts are supplied by SAIC.
 */
export const VEHICLE_COUNTRIES: VehicleCountry[] = [
  { code: "CN", nameAr: "الصين", nameEn: "China", flag: "🇨🇳" },
  { code: "KR", nameAr: "كوريا الجنوبية", nameEn: "South Korea", flag: "🇰🇷" },
  { code: "DE", nameAr: "ألمانيا", nameEn: "Germany", flag: "🇩🇪" },
  { code: "US", nameAr: "الولايات المتحدة", nameEn: "United States", flag: "🇺🇸" },
  { code: "JP", nameAr: "اليابان", nameEn: "Japan", flag: "🇯🇵" },
  { code: "FR", nameAr: "فرنسا", nameEn: "France", flag: "🇫🇷" },
  { code: "IT", nameAr: "إيطاليا", nameEn: "Italy", flag: "🇮🇹" },
  { code: "GB", nameAr: "بريطانيا", nameEn: "United Kingdom", flag: "🇬🇧" },
  { code: "ES", nameAr: "إسبانيا", nameEn: "Spain", flag: "🇪🇸" },
  { code: "CZ", nameAr: "التشيك", nameEn: "Czech Republic", flag: "🇨🇿" },
  { code: "SE", nameAr: "السويد", nameEn: "Sweden", flag: "🇸🇪" },
  { code: "IN", nameAr: "الهند", nameEn: "India", flag: "🇮🇳" },
  { code: "RU", nameAr: "روسيا", nameEn: "Russia", flag: "🇷🇺" },
  { code: "RO", nameAr: "رومانيا", nameEn: "Romania", flag: "🇷🇴" },
  { code: "NL", nameAr: "هولندا", nameEn: "Netherlands", flag: "🇳🇱" },
  { code: "AU", nameAr: "أستراليا", nameEn: "Australia", flag: "🇦🇺" },
  { code: "PL", nameAr: "بولندا", nameEn: "Poland", flag: "🇵🇱" },
  { code: "TR", nameAr: "تركيا", nameEn: "Turkey", flag: "🇹🇷" },
  { code: "MY", nameAr: "ماليزيا", nameEn: "Malaysia", flag: "🇲🇾" },
  { code: "TW", nameAr: "تايوان", nameEn: "Taiwan", flag: "🇹🇼" },
  { code: "VN", nameAr: "فيتنام", nameEn: "Vietnam", flag: "🇻🇳" },
  { code: "BR", nameAr: "البرازيل", nameEn: "Brazil", flag: "🇧🇷" },
  { code: "MX", nameAr: "المكسيك", nameEn: "Mexico", flag: "🇲🇽" },
  { code: "IR", nameAr: "إيران", nameEn: "Iran", flag: "🇮🇷" },
  { code: "AE", nameAr: "الإمارات", nameEn: "United Arab Emirates", flag: "🇦🇪" },
  { code: "HR", nameAr: "كرواتيا", nameEn: "Croatia", flag: "🇭🇷" },
  { code: "CH", nameAr: "سويسرا", nameEn: "Switzerland", flag: "🇨🇭" },
  { code: "DK", nameAr: "الدنمارك", nameEn: "Denmark", flag: "🇩🇰" },
  { code: "UA", nameAr: "أوكرانيا", nameEn: "Ukraine", flag: "🇺🇦" },
  { code: "RS", nameAr: "صربيا", nameEn: "Serbia", flag: "🇷🇸" },
  { code: "MA", nameAr: "المغرب", nameEn: "Morocco", flag: "🇲🇦" },
  { code: "BE", nameAr: "بلجيكا", nameEn: "Belgium", flag: "🇧🇪" },
  { code: "CA", nameAr: "كندا", nameEn: "Canada", flag: "🇨🇦" },
  { code: "GR", nameAr: "اليونان", nameEn: "Greece", flag: "🇬🇷" },
  { code: "LV", nameAr: "لاتفيا", nameEn: "Latvia", flag: "🇱🇻" },
];

const COUNTRY_MAKES: Record<string, string[]> = {
  CN: [
    "aiways", "arcfox", "baic-motor", "baojun", "beiben", "bestune", "brilliance", "byd", "byton",
    "camc", "changan", "changfeng", "chery", "dayun", "dongfeng", "englon", "exeed", "faw",
    "foton", "gac-group", "geely", "geometry", "gonow", "great-wall",
    "hafei", "haima", "haval", "hawtai", "hiphi", "hongqi", "jac", "jetour",
    "jetta", "jmc", "landwind", "leapmotor", "li-auto", "lifan", "lynk-and-co", "maxus",
    "mg", "nio", "omoda", "qoros", "ranz", "roewe", "saic-motor", "singulato",
    "soueast", "venucia", "weltmeister", "wey", "wuling", "xpeng", "zeekr",
    "zinoro", "zotye", "karlmann-king",
  ],
  KR: ["daewoo", "genesis", "hyundai", "kia", "renault-samsung", "spirra", "ssangyong"],
  DE: [
    "9ff", "abt", "alpina", "apollo", "artega", "audi", "audi-sport", "bitter", "bmw", "bmw-m",
    "borgward", "brabus", "carlsson", "dkw", "edag", "gumpert", "horch", "isdera", "lloyd",
    "mansory", "maybach", "melkus", "mercedes-amg", "mercedes-benz", "merkur", "opel", "porsche",
    "ruf", "smart", "techart", "volkswagen", "wanderer", "wartburg", "wiesmann",
  ],
  US: [
    "abbott-detroit", "amc", "auburn", "brammo", "buick", "cadillac", "canoo", "chevrolet",
    "chevrolet-corvette", "chrysler", "cole", "desoto", "detroit-electric", "dodge", "dodge-viper",
    "drako", "duesenberg", "eagle", "edsel", "faraday-future", "fisker", "ford", "ford-mustang",
    "franklin", "general-motors", "geo", "gmc", "hennessey", "hudson", "hummer",
    "hupmobile", "jeep", "kaiser", "karma", "lincoln",
    "lordstown", "lucid", "mercury", "mosler", "nikola", "oldsmobile",
    "packard", "panoz", "pierce-arrow", "plymouth", "pontiac", "ram", "rambler", "rezvani",
    "rivian", "rossion", "saleen", "saturn", "ssc", "sterling", "studebaker", "stutz", "tesla", "trion",
    "tucker", "vector", "vlf", "willys-overland", "workhorse",
  ],
  JP: [
    "acura", "aspark", "autobacs", "daihatsu", "datsun", "honda", "infiniti", "isuzu", "lexus",
    "mazda", "mitsubishi", "mitsuoka", "nissan", "nissan-gt-r", "nissan-nismo", "scion", "subaru", "suzuki",
    "toyota", "toyota-alphard", "toyota-century", "toyota-crown",
  ],
  FR: [
    "aixam", "alpine", "berliet", "bugatti", "citroen", "corre-la-licorne", "delage", "ds", "facel-vega",
    "hommell", "ligier", "microcar", "panhard", "peugeot", "pgo", "renault", "simca", "talbot", "venturi",
  ],
  IT: [
    "abarth", "alfa-romeo", "autobianchi", "bertone", "bizzarrini", "cisitalia", "cizeta", "de-tomaso",
    "diatto", "ferrari", "fiat", "fioravanti", "innocenti", "iso", "iveco", "lamborghini", "lancia", "maserati",
    "mazzanti", "osca", "pagani", "pininfarina",
  ],
  GB: [
    "ac", "alvis", "arash", "ariel", "arrival", "ascari", "aston-martin", "atalanta", "austin", "axon",
    "bac", "bentley", "berkeley", "bowler", "bristol", "brooke", "caparo", "caterham", "daimler",
    "david-brown", "dmc", "elemental", "elva", "eterniti", "gardner-douglas", "gilbern", "ginetta",
    "grinnall", "hillman", "jaguar", "jba-motors", "jensen", "keating", "lagonda", "land-rover", "levc",
    "leyland", "lister", "lotus", "marcos", "marlin", "mclaren", "mev", "mini", "mk", "morgan", "morris",
    "noble", "prodrive", "radical", "riley", "rolls-royce", "ronart", "rover", "singer", "suffolk",
    "triumph", "tvr", "ultima", "vauxhall", "westfield", "zenos",
  ],
  ES: ["abadal", "cupra", "hispano-suiza", "seat", "spania-gta", "tauro", "tramontana"],
  CZ: ["jawa", "praga", "skoda", "tatra"],
  SE: ["koenigsegg", "nevs", "polestar", "saab", "volvo"],
  IN: ["force-motors", "hindustan-motors", "mahindra", "premier", "tata"],
  RU: ["gaz", "lada", "uaz"],
  RO: ["aro", "dacia", "oltcit"],
  NL: ["donkervoort", "spyker", "vandenbrink", "vencer"],
  AU: ["elfin", "fpv", "holden", "hsv"],
  PL: ["arrinera", "fso"],
  TR: ["askam"],
  MY: ["bufori", "perodua", "proton"],
  TW: ["luxgen", "yulon"],
  VN: ["vinfast"],
  BR: ["lobini", "troller"],
  MX: ["dina", "mastretta"],
  IR: ["ikco", "saipa"],
  AE: ["devel-sixteen", "w-motors", "zarooq-motors"],
  HR: ["rimac"],
  CH: ["rinspeed"],
  DK: ["zenvo"],
  UA: ["zaz"],
  RS: ["zastava"],
  MA: ["laraki"],
  BE: ["gillet"],
  CA: ["intermeccanica"],
  GR: ["alta"],
  LV: ["dartz"],
};

const COUNTRY_BY_SLUG = new Map(
  Object.entries(COUNTRY_MAKES).flatMap(([countryCode, slugs]) =>
    slugs.map((slug) => [slug, countryCode] as const),
  ),
);

const COUNTRY_CODE_ALIASES: Record<string, string> = {
  china: "CN", chinese: "CN", "الصين": "CN", "صيني": "CN",
  korea: "KR", korean: "KR", "south korea": "KR", "كوريا": "KR", "كوري": "KR",
  germany: "DE", german: "DE", "ألمانيا": "DE", "المانيا": "DE", "ألماني": "DE",
  usa: "US", us: "US", america: "US", american: "US", "united states": "US", "أمريكا": "US", "امريكا": "US",
  japan: "JP", japanese: "JP", "اليابان": "JP", "ياباني": "JP",
  france: "FR", french: "FR", "فرنسا": "FR", italy: "IT", italian: "IT", "إيطاليا": "IT", "ايطاليا": "IT",
  uk: "GB", britain: "GB", british: "GB", "united kingdom": "GB", "بريطانيا": "GB",
};

export function normalizeVehicleCountryCode(value?: string): string | undefined {
  if (!value?.trim()) return undefined;
  const normalized = value.trim();
  const upper = normalized.toUpperCase();
  if (VEHICLE_COUNTRIES.some((country) => country.code === upper)) return upper;
  return COUNTRY_CODE_ALIASES[normalized.toLowerCase()];
}

export function inferVehicleCountryCode(make: { slug: string; country?: string; countryCode?: string }): string | undefined {
  return normalizeVehicleCountryCode(make.countryCode) ??
    normalizeVehicleCountryCode(make.country) ??
    COUNTRY_BY_SLUG.get(make.slug);
}

export function getVehicleCountry(code?: string): VehicleCountry | undefined {
  return VEHICLE_COUNTRIES.find((country) => country.code === code);
}

export function vehicleCountryLabel(code?: string): string {
  const country = getVehicleCountry(code);
  return country ? `${country.flag} ${country.nameAr}` : "🌐 غير محدد";
}

export function isMakeIncludedInSpecialization(
  make: VehicleMake,
  preferences: VehicleCatalogPreferences,
): boolean {
  if (preferences.includeAllMakes) return true;
  if (preferences.selectedMakeIds.includes(make.id)) return true;
  return Boolean(
    make.countryCode && preferences.selectedCountryCodes.includes(make.countryCode),
  );
}
