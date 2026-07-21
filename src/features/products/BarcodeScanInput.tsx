import { useState } from "react";
import { ScanBarcode } from "lucide-react";
import { Input } from "../../components/ui/Input";
import { useFeatures } from "../../lib/useFeatures";

/**
 * A point-of-sale barcode field. A USB scanner types the code and sends Enter;
 * on Enter we hand the trimmed code to `onScan` and clear the field for the next
 * scan. Typing a code manually and pressing Enter works the same way.
 */
export function BarcodeScanInput({
  onScan,
  disabled,
  placeholder = "امسح الباركود أو رقم القطعة أو OEM ثم اضغط Enter",
  className,
}: {
  onScan: (code: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const { isEnabled } = useFeatures();
  const [value, setValue] = useState("");
  if (!isEnabled("barcodeSystem")) return null;

  return (
    <div className={`flex items-center gap-2 ${className ?? ""}`}>
      <ScanBarcode className="w-4 h-4 shrink-0 text-ink-faint" />
      <Input
        autoFocus
        autoComplete="off"
        inputMode="text"
        value={value}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            const code = value.trim();
            if (code) onScan(code);
            setValue("");
          }
        }}
        placeholder={placeholder}
        className="flex-1"
      />
    </div>
  );
}
