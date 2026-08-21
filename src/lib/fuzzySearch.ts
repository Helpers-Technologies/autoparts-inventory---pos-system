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

    // 4. Cross-script match: Arabic query against a Latin-only catalogue name
    //    (or the reverse). See isCrossScriptMatch for why skeletons, not
    //    letters. Placed before the loose strategies because it is precise.
    if (isCrossScriptMatch(query, rawCandidate)) {
      return true;
    }

    // 5. Subsequence match for queries of length >= 3
    if (strippedQuery.length >= 3 && isSubsequence(strippedQuery, strippedCandidate)) {
      return true;
    }

    // 6. Levenshtein edit distance for typo tolerance
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

// ── Cross-script matching: Arabic query ↔ Latin catalogue ────────────────
//
// The vehicle catalogue carries 3,058 models and not one of them has an
// Arabic name — they arrive from NHTSA vPIC as "Lancer", "Corolla", "Accent".
// An Egyptian shop types the model the way it is said: "لانسر", "كورولا",
// "اكسنت". Letter-by-letter comparison cannot bridge that, and an alias table
// would have to be maintained per model forever.
//
// What both scripts DO agree on is the consonant skeleton. Arabic does not
// write short vowels at all, and English vowels carry no information here, so
// dropping them from both sides leaves the part that actually matches:
//
//   "Lancer"  → l n s r      "لانسر"  → l n s r
//   "Corolla" → k r l        "كورولا" → k r l
//   "Volvo"   → f l f        "فولفو"  → f l f
//
// English spelling is resolved phonetically first (c before e/i/y is /s/, not
// /k/), and letters that Arabic writes with a single character are folded to
// one class on both sides: v and p have no Arabic letter, so ف/ب stand in for
// them; ق and ك are both /k/; ج is /g/ in Egyptian Arabic.
//
// This runs ONLY when the query and the candidate are in different scripts,
// so same-script searches keep their existing behaviour exactly.

const LATIN_VOWELS = /[aeiouwy]/g;

/** Reduces a Latin string to the consonant skeleton Arabic would share. */
function latinSkeleton(text: string): string {
  let s = text.toLowerCase().replace(/[^a-z]/g, "");
  if (!s) return "";
  // Digraphs first: each is one sound and Arabic writes it with one letter.
  s = s
    .replace(/sh/g, "\u0001") // ش
    .replace(/ch/g, "\u0001") // شيري / Chery — Arabic writes ش
    .replace(/ph/g, "f")
    .replace(/gh/g, "g")
    .replace(/kh/g, "k")
    .replace(/th/g, "t")
    .replace(/ck/g, "k");
  // "c" is /s/ before e, i, y and /k/ everywhere else — Lancer vs Corolla.
  s = s.replace(/c(?=[eiy])/g, "s").replace(/c/g, "k");
  s = s
    .replace(/x/g, "ks")
    .replace(/q/g, "k")
    .replace(/v/g, "f") // no Arabic ⟨v⟩: فولفو
    .replace(/p/g, "b") // no Arabic ⟨p⟩: بيجو
    .replace(/j/g, "g"); // ج is /g/ in Egyptian Arabic
  s = s.replace(LATIN_VOWELS, "");
  return collapseRuns(s);
}

const ARABIC_TO_CLASS: Record<string, string> = {
  "ا": "", "أ": "", "إ": "", "آ": "", "ى": "", "ء": "", "ؤ": "", "ئ": "",
  "ة": "", "و": "", "ي": "", "ع": "",
  "ب": "b", "پ": "b",
  "ت": "t", "ط": "t", "ث": "t",
  "س": "s", "ص": "s",
  "ج": "g", "غ": "g",
  "چ": "\u0001", "ش": "\u0001",
  "ح": "h", "ه": "h",
  "د": "d", "ض": "d", "ذ": "d",
  "ر": "r",
  "ز": "z", "ظ": "z",
  "ف": "f", "ڤ": "f",
  "ق": "k", "ك": "k", "خ": "k",
  "ل": "l", "م": "m", "ن": "n",
};

/** Reduces an Arabic string to the same consonant skeleton as {@link latinSkeleton}. */
function arabicSkeleton(text: string): string {
  const normalized = normalizeArabicAndEnglish(text);
  let out = "";
  for (const ch of normalized) {
    const mapped = ARABIC_TO_CLASS[ch];
    if (mapped !== undefined) out += mapped;
    else if (/[a-z0-9]/.test(ch)) out += ch; // mixed strings keep their Latin part
  }
  return collapseRuns(out);
}

/** "lancerr" → "lancer"; doubles are an orthographic accident, not a sound. */
function collapseRuns(text: string): string {
  let out = "";
  for (const ch of text) if (ch !== out[out.length - 1]) out += ch;
  return out;
}

const HAS_ARABIC = /[\u0621-\u064A]/;
const HAS_LATIN = /[A-Za-z]/;

/** The skeleton of `text`, chosen by the script it is written in. */
export function scriptSkeleton(text: string): string {
  return HAS_ARABIC.test(text) ? arabicSkeleton(text) : latinSkeleton(text);
}

/**
 * True when an Arabic query names the same thing as a Latin candidate (or the
 * reverse). Returns false for same-script pairs — those are already handled by
 * the substring, alias and edit-distance strategies in {@link isFuzzyMatch}.
 */
export function isCrossScriptMatch(query: string, candidate: string): boolean {
  const queryIsArabic = HAS_ARABIC.test(query);
  const candidateIsArabic = HAS_ARABIC.test(candidate);
  if (queryIsArabic === candidateIsArabic) return false;
  // A candidate has to actually carry the other script to be comparable.
  if (queryIsArabic ? !HAS_LATIN.test(candidate) : !HAS_ARABIC.test(candidate)) {
    return false;
  }

  const q = scriptSkeleton(query);
  const c = scriptSkeleton(candidate);
  if (q.length < 2 || c.length === 0) return false;

  // Two consonants carry little information ("تيجو" → "tg"), so they only
  // match at the start of a name; longer skeletons may match anywhere.
  if (q.length === 2) return c.startsWith(q);
  if (c.includes(q)) return true;
  // One sound of slack, which absorbs the letters the two scripts genuinely
  // disagree on: "توسان" → "tsn" against Tucson's "tksn". Anchoring on the
  // first consonant keeps that from turning into a wildcard — a name has to
  // at least start with the same sound to be reachable by a typo.
  return q[0] === c[0] && levenshteinDistance(q, c) <= 1;
}
