/**
 * Auto-formats Egyptian vehicle license plate numbers.
 * Format: 2-3 Arabic letters (spaced) + 3-4 digits (spaced).
 * Example: "أ ب ج 1 2 3 4" or "أ ب 1 2 3"
 */
export function formatEgyptianPlateNumber(raw: string): string {
  if (!raw) return "";

  // Convert Arabic-Indic numerals (٠١٢٣٤٥٦٧٨٩) to standard ASCII numerals (0-9)
  const arabicNumerals = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];
  let text = raw;
  arabicNumerals.forEach((num, index) => {
    text = text.replaceAll(num, String(index));
  });

  const letters: string[] = [];
  const digits: string[] = [];

  for (const char of text) {
    if (/[0-9]/.test(char)) {
      if (digits.length < 4) {
        digits.push(char);
      }
    } else if (/[\u0621-\u064A]/.test(char)) {
      if (letters.length < 3) {
        letters.push(char);
      }
    }
  }

  const formattedLetters = letters.join(" ");
  const formattedDigits = digits.join(" ");

  if (formattedLetters && formattedDigits) {
    return `${formattedLetters}    ${formattedDigits}`;
  } else if (formattedLetters) {
    return formattedLetters;
  } else if (formattedDigits) {
    return formattedDigits;
  }

  // Unsupported characters, including Latin letters, must never reach the
  // stored plate number. An English-only paste therefore clears immediately.
  return "";
}

/**
 * Validates Egyptian license plate format requirements:
 * 2-3 Arabic letters and 3-4 numbers.
 */
export function validateEgyptianPlateNumber(plate: string): { isValid: boolean; message?: string } {
  if (!plate || !plate.trim()) return { isValid: true };

  const letters = (plate.match(/[\u0621-\u064A]/g) || []).length;
  const digits = (plate.match(/[0-9]/g) || []).length;

  if (letters < 2 || letters > 3) {
    return { isValid: false, message: "يجب أن تحتوي اللوحة المصرية على 2 إلى 3 أحرف" };
  }
  if (digits < 3 || digits > 4) {
    return { isValid: false, message: "يجب أن تحتوي اللوحة المصرية على 3 إلى 4 أرقام" };
  }

  return { isValid: true };
}
