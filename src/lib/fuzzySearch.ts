// Common Arabic transliteration variants for car makes & models
const ARABIC_BRAND_ALIASES: Record<string, string[]> = {
  mitsubishi: ["ميتسوبيشي", "متسوبيشي", "متسوبيشى", "مستوبيشي"],
  mercedes: ["مرسيدس", "مرسيدس بنز", "مارسيدس"],
  bmw: ["بي ام دبليو", "بي ام", "بى ام دبليو", "بي امw"],
  volkswagen: ["فولكس", "فولكس فاجن", "فولكسفاجن", "فولكس واجن"],
  chevrolet: ["شيفروليه", "شفروليه", "شيفرولية", "شفرولية"],
  hyundai: ["هيونداي", "هيونداى", "هونداي", "هنداي"],
  honda: ["هوندا"],
  toyota: ["تويوتا", "تيوتا"],
  nissan: ["نيسان"],
  kia: ["كيا"],
  peugeot: ["بيجو", "بجو"],
  renault: ["رينو"],
  subaru: ["سوبارو"],
  audi: ["أودي", "اودي"],
  skoda: ["سكودا", "أشكودا", "اشكودا"],
  seat: ["سيات"],
  fiat: ["فيات"],
  "alfa romeo": ["الفا روميو", "ألفا روميو", "الفاروميو"],
  suzuki: ["سوزوكي", "سزوكي", "سوزوكى"],
  mazda: ["مازدا"],
  lexus: ["لكزس", "لكسز"],
  infiniti: ["انفينيتي", "إنفينيتي", "انفينيتى"],
  byd: ["بي واي دي", "بي واى دي", "بيوايدي"],
  chery: ["شيري", "شيرى"],
  geely: ["جيلي", "جيلى"],
  haval: ["هافال"],
  mg: ["ام جي", "ام جى", "امجى"],
  jmc: ["جي ام سي", "جي امسي"],
  gmc: ["جمس", "جي ام سي"],
  ford: ["فورد"],
  jeep: ["جيب"],
  dodge: ["دودج"],
  chrysler: ["كرايسلر"],
  cadillac: ["كاديلاك"],
  porsche: ["بورش", "بورشه"],
  jaguar: ["جاكوار", "جاجوار"],
  "land rover": ["لاند روفر", "لاندروفر"],
  opel: ["أوبل", "اوبل"],
  citroen: ["ستروين", "سيتروين"],
  volvo: ["فولفو"],
  ssangyong: ["سانج يونج", "سانجيونج"],
  changan: ["شانجان", "تشانجان"],
  baic: ["بايك"],
  jetour: ["جيتور"],
  soueast: ["سواست", "جنوب شرق"],
  dongfeng: ["دونج فنج", "دونج فينج"],
  "great wall": ["جريت وول", "جريتوول"],
};

/**
 * Normalizes text by converting to lowercase, stripping diacritics,
 * and mapping similar Arabic characters (e.g., أ/إ/آ -> ا, ى/ئ -> ي, ة -> ه).
 */
export function normalizeArabicAndEnglish(text: string): string {
  if (!text) return "";
  return text
    .toLowerCase()
    .trim()
    .replace(/[\u064B-\u065F\u0670]/g, "") // remove tashkeel
    .replace(/[أإآ]/g, "ا")
    .replace(/[ىئ]/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ـ/g, ""); // remove tatweel
}

/**
 * Strips non-alphanumeric chars for strict character comparison
 */
export function stripWhitespaceAndPunctuation(text: string): string {
  return normalizeArabicAndEnglish(text).replace(/[^a-z0-9\u0621-\u064A]/g, "");
}

/**
 * Levenshtein distance calculation for typo tolerance
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Subsequence matching (returns true if all characters of query appear in target in order)
 */
export function isSubsequence(query: string, target: string): boolean {
  let qIdx = 0;
  let tIdx = 0;
  while (qIdx < query.length && tIdx < target.length) {
    if (query[qIdx] === target[tIdx]) {
      qIdx++;
    }
    tIdx++;
  }
  return qIdx === query.length;
}

export function getMakeSearchText(make: { name: string; nameAr?: string }): string {
  const nameLower = make.name.toLowerCase().trim();
  const aliases = ARABIC_BRAND_ALIASES[nameLower] || [];
  const extraAliases = Object.entries(ARABIC_BRAND_ALIASES)
    .filter(([key]) => nameLower.includes(key) || key.includes(nameLower))
    .flatMap(([, list]) => list);
  const all = new Set([make.name, make.nameAr ?? "", ...aliases, ...extraAliases]);
  return Array.from(all).filter(Boolean).join(" ");
}

export function normalizeArabicPhonetic(text: string): string {
  if (!text) return "";
  const norm = normalizeArabicAndEnglish(text);
  if (/[\u0621-\u064A]/.test(norm) && norm.length >= 3) {
    return norm.replace(/[يوا]/g, "");
  }
  return norm;
}

/**
 * Main fuzzy match function.
 * Evaluates whether a search query matches candidate target text.
 */
export function isFuzzyMatch(query: string, candidateTexts: (string | undefined | null)[]): boolean {
  const normQuery = normalizeArabicAndEnglish(query);
  if (!normQuery) return true;

  const strippedQuery = stripWhitespaceAndPunctuation(query);
  if (!strippedQuery) return true;

  for (const rawCandidate of candidateTexts) {
    if (!rawCandidate) continue;

    const normCandidate = normalizeArabicAndEnglish(rawCandidate);
    const strippedCandidate = stripWhitespaceAndPunctuation(rawCandidate);

    // 1. Direct substring match on normalized text
    if (normCandidate.includes(normQuery) || strippedCandidate.includes(strippedQuery)) {
      return true;
    }

    // 2. Arabic Phonetic Skeleton match (handles vowel typos like متسوبيشي vs ميتسوبيشي)
    const skelQuery = normalizeArabicPhonetic(query);
    const skelCandidate = normalizeArabicPhonetic(rawCandidate);
    if (skelQuery.length >= 3 && skelCandidate.includes(skelQuery)) {
      return true;
    }

    // 3. Check Arabic Alias mappings (e.g., query "متسوبيشي" matching candidate "Mitsubishi")
    for (const [key, aliases] of Object.entries(ARABIC_BRAND_ALIASES)) {
      const matchKey = normCandidate.includes(key) || aliases.some((a) => normCandidate.includes(normalizeArabicAndEnglish(a)));
      if (matchKey) {
        const queryMatchesKey = normQuery.includes(key) || aliases.some((a) => {
          const normA = normalizeArabicAndEnglish(a);
          const strippedA = stripWhitespaceAndPunctuation(a);
          return normQuery.includes(normA) ||
            normA.includes(normQuery) ||
            strippedQuery.includes(strippedA) ||
            strippedA.includes(strippedQuery) ||
            levenshteinDistance(strippedQuery, strippedA) <= (strippedQuery.length > 5 ? 2 : 1);
        });
        if (queryMatchesKey) return true;
      }
    }

    // 4. Subsequence match for queries of length >= 3
    if (strippedQuery.length >= 3 && isSubsequence(strippedQuery, strippedCandidate)) {
      return true;
    }

    // 5. Levenshtein edit distance for typo tolerance
    // Max allowed distance depends on query length:
    // 3-4 chars: max 1 typo
    // 5+ chars: max 2 typos
    const maxDist = strippedQuery.length > 4 ? 2 : strippedQuery.length >= 3 ? 1 : 0;
    if (maxDist > 0) {
      // Check distance against words in candidate or full stripped candidate
      const candidateWords = normCandidate.split(/\s+/).map(stripWhitespaceAndPunctuation).filter(Boolean);
      for (const word of candidateWords) {
        if (levenshteinDistance(strippedQuery, word) <= maxDist) {
          return true;
        }
      }
      if (levenshteinDistance(strippedQuery, strippedCandidate) <= maxDist) {
        return true;
      }
    }
  }

  return false;
}
