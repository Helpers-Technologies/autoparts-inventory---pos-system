const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
const persianDigits = "۰۱۲۳۴۵۶۷۸۹";

export function parseNumericInput(value: string, fallback = 0): number {
  const normalized = value
    .trim()
    .replace(/[٠-٩]/g, (digit) => String(arabicDigits.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String(persianDigits.indexOf(digit)))
    .replace(/,(?=\d{3}(?:[,\d]|$))/g, "")
    .replace(/,/g, ".")
    .replace(/\s+/g, "");

  if (normalized === "") return 0;
  if (normalized === "." || normalized === "-" || normalized === "+") return fallback;

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}
